const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
function harness({deferAuthorization=false}={}){
  const filename=path.join(__dirname,'../src/services/socketService.js'), realRequire=createRequire(filename);
  const member={memberId:'member',userId:'user'}, squad={squadId:'room',members:[member]}, emissions=[];
  let connect, state, allowed=true, active=true;
  let authorizationCalls=0, releaseAuthorization;
  const authorizationReady=deferAuthorization?new Promise(resolve=>{releaseAuthorization=resolve;}):Promise.resolve();
  const media={
    async begin(user,socket,scope){state={socket,scope,generation:Math.random().toString()};return state.generation;},
    async update(user,socket,generation,scope,sharing){if(state?.socket!==socket||state.generation!==generation)return false;state.sharing=sharing;return true;},
    async end(user,socket,generation){if(state?.socket!==socket||state.generation!==generation)return false;state=null;return true;},
  };
  class Server{adapter(){}use(){}on(name,fn){if(name==='connection')connect=fn;}to(room){return{emit:(event,payload)=>emissions.push({room,event,payload})};}close(done){done();}}
  const module={exports:{}}, timers=[];
  const fakeRedis={smembers:async()=>[],srem:async()=>{},del:async()=>{},multi(){return{sadd(){return this;},expire(){return this;},set(){return this;},exec:async()=>[]};}};
  const context={module,exports:module.exports,process,Buffer,console:{log(){},warn(){},error(){}},setTimeout,clearInterval,setInterval(fn,ms){const id=setInterval(fn,ms);timers.push(id);return id;},require(id){
    if(id==='socket.io')return{Server};if(id==='@socket.io/redis-adapter')return{createAdapter:()=>({})};
    if(id==='./memberMediaService')return media;
    if(id==='./groupPresenceService')return{begin:async()=> 'generation',update:async()=>true,end:async()=>true};
    if(id==='../config/redisConfig')return{redis:fakeRedis,pubClient:{},subClient:{}};
    if(id==='../models/Squad')return{Squad:{findOne:async()=>squad,find:query=>query.status?Promise.resolve([]):{select:async()=>[]}}};
    if(id==='../utils/socketAccess')return{...realRequire(id),authorizeSquadRoomJoin:async()=>{authorizationCalls++;await authorizationReady;return{allowed,room:'squad_room'};},authorizeEncounterRoomJoin:async()=>{authorizationCalls++;await authorizationReady;return{allowed,room:'encounter_call'};},authorizeRealtimeSend:async({encounterId})=>{authorizationCalls++;await authorizationReady;return{allowed,room:encounterId?'encounter_call':'squad_room',ownSquadId:'room',squadA:squad,squadB:{squadId:'other',members:[]},encounter:{status:active?'active':'ended'}};}};
    return realRequire(id);
  }};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename});module.exports.init({});
  function open(id){const handlers={},rooms=new Set(['squad_room','encounter_call']);connect({id,userId:'user',rooms,join(){},on(event,fn){handlers[event]=fn;}});return{rooms,send:input=>new Promise(resolve=>handlers.member_media(input,resolve)),sendEvent:(event,input)=>new Promise(resolve=>handlers[event](input,resolve)),join:(event,id)=>handlers[event](id),disconnect:()=>handlers.disconnect()};}
  return{open,emissions,get authorizationCalls(){return authorizationCalls;},release:()=>releaseAuthorization?.(),get state(){return state;},deny:()=>{allowed=false;},inactive:()=>{active=false;},close:async()=>{timers.forEach(clearInterval);await module.exports.close();}};
}
test('socket source updates require joined authorized room, owning call and active encounter',async t=>{
 const h=harness();t.after(()=>h.close());const a=h.open('first'), b=h.open('second');
 a.rooms.delete('squad_room');assert.equal((await a.send({squadId:'room',action:'begin'})).ok,false);a.rooms.add('squad_room');
 const first=await a.send({squadId:'room',action:'begin'});assert.equal(first.ok,true);
 assert.equal((await a.send({squadId:'room',action:'update',mediaSessionId:first.mediaSessionId,screenSharing:'yes'})).ok,false);
 assert.equal((await a.send({squadId:'room',action:'update',mediaSessionId:first.mediaSessionId,screenSharing:true})).ok,true);
 const second=await b.send({squadId:'room',action:'begin'});
 assert.equal((await a.send({squadId:'room',action:'end',mediaSessionId:first.mediaSessionId})).ok,false);
 await a.disconnect();assert.equal(h.state.generation,second.mediaSessionId);
 assert.equal((await b.send({squadId:'room',encounterId:'call',action:'update',mediaSessionId:second.mediaSessionId,screenSharing:true})).ok,false);
 h.inactive();assert.equal((await b.send({squadId:'room',encounterId:'call',action:'begin'})).ok,false);
 h.deny();assert.equal((await b.send({squadId:'room',action:'update',mediaSessionId:second.mediaSessionId,screenSharing:true})).ok,false);
 await b.disconnect();assert.equal(h.state,null);
 for(const emission of h.emissions){assert.equal(emission.event,'SQUAD_UPDATED');assert.equal(Object.keys(emission.payload).length,0);}
});

for(const event of ['member_media','group_presence'])test(`${event} flood has bounded queued work and recovers after a reconnect`,async t=>{
 const h=harness({deferAuthorization:true});t.after(()=>h.close());const socket=h.open('flood');
 const results=[];
 const requests=Array.from({length:100},()=>socket.sendEvent(event,{squadId:'room',action:'begin'}).then(result=>{results.push(result);return result;}));
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.authorizationCalls,1,'only one queued operation starts while authorization is slow');
 assert.equal(results.length,92,'excess work is rejected before joining the promise chain');
 assert.ok(results.every(result=>result.error==='BUSY'));
 h.release();await Promise.all(requests);
 assert.equal(h.authorizationCalls,8);
 assert.equal(results.filter(result=>result.ok).length,8);
 await socket.disconnect();
 const fresh=h.open('flood');
 assert.equal((await fresh.sendEvent(event,{squadId:'room',action:'begin'})).ok,true);
 await fresh.disconnect();
});

test('room join controls share a pending cap and a sustained rate limit',async t=>{
 const h=harness({deferAuthorization:true});t.after(()=>h.close());const socket=h.open('joins');
 const joins=Array.from({length:100},(_,index)=>socket.join(index%2?'join_squad':'join_encounter','room'));
 assert.equal(h.authorizationCalls,8);
 h.release();await Promise.all(joins);
 for(let i=0;i<100;i++)await socket.join('join_squad','room');
 assert.equal(h.authorizationCalls,60,'quick controls cannot bypass the time-window limit');
 await socket.disconnect();
});
