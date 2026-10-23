'use strict';
// Real isolated production server/localhost WS; legal driving supplies events.
// No state/preload/event hooks, browser, real credentials or deployment.
const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{once}=require('node:events'),{randomBytes}=require('node:crypto'),net=require('node:net'),path=require('node:path'),WebSocket=require('ws');
const {mintTicket}=require('../server/bridge');
const ROOT=path.resolve(__dirname,'..'),sleep=ms=>new Promise(r=>setTimeout(r,ms));let checks=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;},ok=(v,label)=>{assert(v,label);checks++;};
async function until(fn,label,ms=6000){const end=Date.now()+ms;while(Date.now()<end){if(fn())return;await sleep(15);}throw Error(label);}
async function boot(){const reserve=net.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));const secret=randomBytes(32).toString('hex'),origin='http://127.0.0.1:4012';const child=spawn(process.execPath,['server/server.js'],{cwd:ROOT,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test',GAME_BRIDGE_SECRET:secret,GIGGLE_ALLOWED_ORIGINS:origin},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);try{await until(()=>output.includes('PartyBox on'),'isolated server boot: '+output);}catch(error){child.kill();throw error;}return{child,url:'ws://127.0.0.1:'+port,secret,origin,output:()=>output};}
const peers=[],send=(c,m)=>c.ws.send(JSON.stringify(m));
async function connect(server,origin){const ws=new WebSocket(server.url,origin?{origin}:{}),c={ws,frames:[],states:[],state:null,hello:null,room:null,seq:0};peers.push(c);ws.on('message',raw=>{const m=JSON.parse(raw);c.frames.push(m);if(m.t==='hello')c.hello=m;if(m.t==='room')c.room=m.room;if(m.t==='state'){c.state=m;c.states.push(m);if(m.preparing&&!m.spectator)send(c,{t:'game-ready',i:m.instanceId,w:m.w});}});await once(ws,'open');return c;}
async function join(server,code,name,capability,token){const c=await connect(server);send(c,{t:'join',code,name,...(capability===undefined?{}:{kartEvents:capability}),...(token?{seatToken:token}:{})});await until(()=>c.hello,'join '+name);return c;}
function auth(server,c,t,claims,capability,nonce){send(c,{t,ticket:mintTicket(claims,server.secret),n:nonce,...(capability===undefined?{}:{kartEvents:capability})});}
async function giggleJoin(server,claims,capability,nonce){const c=await connect(server,server.origin);auth(server,c,'giggleJoin',claims,capability,nonce);await until(()=>c.hello?.n===nonce,'fresh authenticated '+nonce);return c;}
const occurrences=(c,id,from=0)=>c.states.slice(from).filter(s=>s.events?.some(e=>e.id===id)).length;
async function close(c){if(c.ws.readyState===WebSocket.CLOSED)return;const ended=once(c.ws,'close');c.ws.close();await ended;}
(async()=>{let server,timer;try{
 server=await boot();const host=await connect(server);send(host,{t:'create',name:'Delta driver',kartEvents:'delta-v1'});await until(()=>host.hello,'exact-capability create');
 const code=host.hello.code,legacy=await join(server,code,'Old driver'),boolean=await join(server,code,'Boolean driver',true),wrong=await join(server,code,'Wrong-version driver','delta-v1 '),falseCapability=await join(server,code,'False-capability driver',false);
 send(host,{t:'start',game:'pocket-karts',ready:true,settings:{map:'Harbor Heights',mode:'Zap Battle',winRule:'Time limit',roundSeconds:60}});
 await until(()=>[host,legacy,boolean,wrong,falseCapability].every(c=>c.state&&!c.state.preparing&&c.state.phase==='live'),'actual readiness and natural live start',10000);
 timer=setInterval(()=>{if(host.ws.readyState!==1||!host.state?.inputAck||host.state.preparing)return;const s=host.state;send(host,{t:'action',i:s.instanceId,w:s.w,a:{type:'input',seq:++host.seq,life:s.inputAck.life,controlEpoch:s.inputAck.controlEpoch,steer:0,throttle:1,brake:0,nitro:false,use:false}});},80);
 const eligible=e=>e.type==='collision'&&e.pid===host.hello.you;
 await until(()=>legacy.states.some(s=>s.events?.some(eligible)),'legal elevated driver creates retained collision event',18000);
 clearInterval(timer);timer=null;const live=host.state;send(host,{t:'action',i:live.instanceId,w:live.w,a:{type:'input',seq:++host.seq,life:live.inputAck.life,controlEpoch:live.inputAck.controlEpoch,steer:0,throttle:0,brake:1,nitro:false,use:false}});
 const event=legacy.state.events.find(eligible);ok(event,'natural event selected');
 await until(()=>occurrences(legacy,event.id)>=4&&occurrences(boolean,event.id)>=4&&occurrences(wrong,event.id)>=4&&occurrences(falseCapability,event.id)>=4,'legacy/malformed clients retain repeated history');
 eq(occurrences(host,event.id),1,'exact-capability creator receives semantic event once');
 ok(occurrences(legacy,event.id)>=4,'missing capability repeats retained history');ok(occurrences(boolean,event.id)>=4,'boolean true does not opt in');ok(occurrences(wrong,event.id)>=4,'near-matching string does not opt in');ok(occurrences(falseCapability,event.id)>=4,'boolean false keeps full history');
 const watcher=await join(server,code,'Delta watcher','delta-v1');await until(()=>watcher.states.length>=3,'opted new watcher state stream');ok(watcher.state.spectator,'late opted seat is watcher');eq(watcher.states[0].inputAck,null,'watcher ACK stays private');eq(occurrences(watcher,event.id),1,'new opted join first gets full retained baseline then delta');
 const token=host.hello.seatToken,id=host.hello.you;await close(host);
 const resumed=await join(server,code,'Delta driver','delta-v1',token);await until(()=>resumed.states.length>=3,'opted resume state stream');eq(resumed.hello.you,id,'new socket resumes original seat');ok(!resumed.state.spectator,'resume preserves active seat');eq(occurrences(resumed,event.id),1,'new opted resume receives full baseline once');ok(resumed.states[0].events.some(e=>e.id===event.id),'resume baseline includes retained event');
 await close(resumed);const oldResume=await join(server,code,'Delta driver',undefined,token);await until(()=>oldResume.states.length>=3,'non-opted resume stream');eq(oldResume.hello.you,id,'old client resumes same seat');ok(occurrences(oldResume,event.id)>=3,'capability does not persist through seat token onto unadvertised new socket');
 const current=peers.find(c=>c.ws.readyState===1&&c.hello?.you===oldResume.room.hostId);ok(current,'cleanup finds elected current host');send(current,{t:'lobby'});await until(()=>peers.filter(c=>c.ws.readyState===1).every(c=>c.room?.game===null),'owned room returned to lobby');
 // Fresh signed test envelopes traverse the shipping bridge and private Room.
 // Renew keeps this exact socket: replacing it would legitimately seed history.
 const deltaClaims={squadId:'sq-kart-events',sub:'auth-delta',displayName:'Auth delta driver'},legacyClaims={...deltaClaims,sub:'auth-legacy',displayName:'Auth old driver'};
 const authDelta=await giggleJoin(server,deltaClaims,'delta-v1','auth-join-delta'),authLegacy=await giggleJoin(server,legacyClaims,undefined,'auth-join-legacy');
 eq(authDelta.hello.giggle,true,'opted GiggleJoin authenticates through real bridge');eq('seatToken' in authDelta.hello,false,'authenticated seat has no anonymous resume token');eq(authLegacy.hello.code,authDelta.hello.code,'signed squad claims attach both drivers to the same private Room');
 send(authDelta,{t:'start',game:'pocket-karts',ready:true,settings:{map:'Harbor Heights',mode:'Zap Battle',winRule:'Time limit',roundSeconds:60}});
 await until(()=>[authDelta,authLegacy].every(c=>c.state&&!c.state.preparing&&c.state.phase==='live'),'authenticated readiness and natural live start',10000);
 timer=setInterval(()=>{const s=authDelta.state;if(authDelta.ws.readyState!==1||!s?.inputAck||s.preparing)return;send(authDelta,{t:'action',i:s.instanceId,w:s.w,a:{type:'input',seq:++authDelta.seq,life:s.inputAck.life,controlEpoch:s.inputAck.controlEpoch,steer:0,throttle:1,brake:0,nitro:false,use:false}});},80);
 const authEligible=e=>e.type==='collision'&&e.pid===authDelta.hello.you;
 await until(()=>authLegacy.states.some(s=>s.events?.some(authEligible)),'authenticated legal driving creates retained collision event',18000);
 clearInterval(timer);timer=null;const authLive=authDelta.state;send(authDelta,{t:'action',i:authLive.instanceId,w:authLive.w,a:{type:'input',seq:++authDelta.seq,life:authLive.inputAck.life,controlEpoch:authLive.inputAck.controlEpoch,steer:0,throttle:0,brake:1,nitro:false,use:false}});
 const authEvent=authLegacy.state.events.find(authEligible);ok(authEvent,'authenticated natural event selected');
 await until(()=>occurrences(authLegacy,authEvent.id)>=4,'default legacy GiggleJoin repeats retained history');
 eq(occurrences(authDelta,authEvent.id),1,'opted GiggleJoin receives new semantic event once');ok(occurrences(authLegacy,authEvent.id)>=4,'missing authenticated capability retains full history');
 const authSocket=authDelta.ws,authId=authDelta.hello.you,authInstance=authDelta.state.instanceId,authSeats=authDelta.room.players.length,renewFrom=authDelta.states.length;
 auth(server,authDelta,'giggleRenew',deltaClaims,'delta-v1','auth-renew-delta');
 await until(()=>authDelta.hello?.n==='auth-renew-delta'&&authDelta.states.length>=renewFrom+3,'same-socket opted GiggleRenew fresh acknowledgement and state stream');
 eq(authDelta.ws,authSocket,'opted renewal retains exact WebSocket');eq(authDelta.hello.you,authId,'opted renewal retains authenticated seat');eq(authDelta.state.instanceId,authInstance,'renewal retains active game instance');eq(authDelta.room.players.length,authSeats,'renewal does not duplicate seats');eq(occurrences(authDelta,authEvent.id,renewFrom),0,'same-socket opted renewal preserves consumed-event cursor');
 const oldFrom=authLegacy.states.length,oldId=authLegacy.hello.you;
 auth(server,authLegacy,'giggleRenew',legacyClaims,undefined,'auth-renew-legacy');
 await until(()=>authLegacy.hello?.n==='auth-renew-legacy'&&authLegacy.states.length>=oldFrom+3,'default legacy GiggleRenew fresh acknowledgement and state stream');
 eq(authLegacy.hello.you,oldId,'default renewal retains authenticated seat');ok(occurrences(authLegacy,authEvent.id,oldFrom)>=3,'unadvertised authenticated renewal continues complete retained history');
 const authWatcher=await giggleJoin(server,{...deltaClaims,sub:'auth-watcher',displayName:'Auth delta watcher'},'delta-v1','auth-join-watcher');
 await until(()=>authWatcher.states.length>=3,'fresh authenticated opted watcher state stream');
 ok(authWatcher.state.spectator,'fresh authenticated late join remains watcher');eq(authWatcher.states[0].inputAck,null,'authenticated watcher has no driver ACK');eq(authWatcher.states[0].coins,0,'authenticated watcher has no private driver coins');ok(authWatcher.states[0].events.some(e=>e.id===authEvent.id),'fresh authenticated socket seeds full retained event baseline');eq(occurrences(authWatcher,authEvent.id),1,'fresh authenticated opted socket receives retained baseline once');
 send(authDelta,{t:'lobby'});await until(()=>[authDelta,authLegacy,authWatcher].every(c=>c.room?.game===null),'private test Room returned to lobby');
 console.log(JSON.stringify({pass:true,checks,node:process.version,eventType:event.type,legacyOccurrences:occurrences(legacy,event.id),optedOccurrences:occurrences(host,event.id),authenticated:{legacyOccurrences:occurrences(authLegacy,authEvent.id),optedOccurrences:occurrences(authDelta,authEvent.id),sameSocketRenewRepeated:occurrences(authDelta,authEvent.id,renewFrom),freshWatcherOccurrences:occurrences(authWatcher,authEvent.id)},scope:'Actual production server and localhost WebSockets; natural wall clock/readiness and legal elevated driving. Exact/missing/malformed capability, opted watcher and fresh-socket seat resume; ephemeral signed GiggleJoin, same-socket opted/default GiggleRenew and fresh authenticated watcher baseline. No browser/audio/physical verdict.'},null,2));
 }finally{clearInterval(timer);await Promise.all(peers.map(close));if(server){const exit=once(server.child,'exit');server.child.kill();await exit;}}
})().catch(e=>{console.error(e);process.exitCode=1;});
