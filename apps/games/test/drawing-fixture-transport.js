'use strict';
// Native drawing fixtures exercise the same held/released transport boundary
// as production. UI/asset paint timing is verified separately by the host and
// the root's native browser run; these peers deliberately withhold their ACKs.
const assert=require('node:assert/strict'),{once,EventEmitter}=require('node:events'),WebSocket=require('ws'),{spawnSync}=require('node:child_process');
let checks=0;
function ok(v,m){assert(v,m);checks++;}
function eq(a,b,m){assert.deepEqual(a,b,m);checks++;}
async function run(game){
 const server=require('./'+game+'-browser').createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port,clients=[];
 try{
  for(const route of ['/','/client']){const html=await(await fetch(base+route)).text();for(const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)){const result=spawnSync(process.execPath,['--check','--input-type=module'],{input:script[1],encoding:'utf8'});eq(result.status,0,game+' embedded '+route+' script syntax: '+result.stderr);}}
  const {session}=await(await fetch(base+'/session')).json(),roles=game==='doodle-guess'?['artist','guesser','other','watcher']:['first','second','third','watcher'];
  async function join(role){const c={role,packets:[],events:new EventEmitter(),ws:new WebSocket(base.replace('http','ws')+'/socket')};c.ws.on('message',data=>{const m=JSON.parse(data);c.packets.push(m);if(m.t==='state')c.state=m;c.events.emit('packet')});await once(c.ws,'open');
   c.wait=(after,predicate)=>new Promise((resolve,reject)=>{const inspect=()=>{const m=c.packets.slice(after).find(predicate);if(m){cleanup();resolve(m)}};const cleanup=()=>{clearTimeout(timer);c.events.off('packet',inspect)};const timer=setTimeout(()=>{cleanup();reject(Error(game+' '+role+' packet boundary timed out'))},4000);c.events.on('packet',inspect);inspect()});c.send=m=>c.ws.send(JSON.stringify(m));c.send({t:'join',session,role});await c.wait(0,m=>m.t==='state');clients.push(c);return c;
  }
  const [a,b,c,watcher]=await Promise.all(roles.map(join)); // Each socket owns its own named seat.
  ok(clients.every(p=>p.state.preparing),game+' initial ready gate is active');ok(watcher.state.spectator,game+' late watcher has no active ownership');
  const meta=p=>({i:p.state.instanceId,w:p.state.w}),ready=p=>({t:'game-ready',...meta(p)});
  async function action(p,a,override={}){const after=p.packets.length;p.send({t:'action',a,...meta(p),...override});await p.wait(after,m=>m.t==='qa-ack');}
  async function barrier(p,packets){const after=p.packets.length;packets.forEach(m=>p.send(m));p.send({t:'join',session,role:p.role});return p.wait(after,m=>m.t==='state');}
  async function release(){const starts=clients.map(p=>p.packets.length);for(const p of [a,b,c])p.send(ready(p));await Promise.all(clients.map((p,i)=>p.wait(starts[i],m=>m.t==='state'&&!m.preparing)));}
  const first=game==='doodle-guess'?{choose:a.state.choices[0]}:{phrase:'Before readiness'};
  await action(a,first);eq(a.state.phase,game==='doodle-guess'?'pick':'write',game+' early UI action cannot enter the next phase');if(game==='draw-phone')eq(a.state.myPhrase,'',game+' early phrase stays unsaved');
  watcher.send(ready(watcher));const held=await barrier(a,[ready(a),{...ready(a),w:'stale'}]);ok(held.preparing,game+' watcher and one active ACK cannot release');
  const two=await barrier(b,[ready(b)]);ok(two.preparing,game+' third active seat must also finish loading');await release();ok(clients.every(p=>!p.state.preparing),game+' loaded quorum release reaches all four peers');
  const initialW=a.state.w;
  if(game==='doodle-guess')await action(a,{choose:a.state.choices[0]});else for(const p of [a,b,c])await action(p,{phrase:'Private story from '+p.role});
  for(const p of clients)if(p.state.phase!=='draw')await p.wait(0,m=>m.t==='state'&&m.phase==='draw');
  ok(clients.every(p=>p.state.phase==='draw'&&p.state.preparing),game+' drawing phase prepares through Room');ok(a.state.w!==initialW,game+' drawing phase mints a fresh readiness token');
  const rejected=a.packets.length;a.send({t:'qa-expire',...meta(a)});await a.wait(rejected,m=>m.t==='qa-error');eq(a.state.phase,'draw',game+' fixture deadline cannot bypass a held phase');
  const stale=await barrier(a,[{t:'game-ready',i:a.state.instanceId,w:initialW}]);ok(stale.preparing,game+' old write/pick readiness cannot release drawing');await release();
  const expired=clients.map(p=>p.packets.length);a.send({t:'qa-expire',...meta(a)});const next=game==='doodle-guess'?'reveal':'guess';await Promise.all(clients.map((p,i)=>p.wait(expired[i],m=>m.t==='state'&&m.phase===next&&m.preparing)));eq(clients.map(p=>p.state.phase),clients.map(()=>next),game+' authorized fixture deadline preserves actual authority transition');await release();
  const liveOffset=b.state.clockOffset,old=b.ws;b.ws.close();await once(old,'close');const resumed=await join(b.role);ok(!resumed.state.preparing,game+' reconnect into a live phase cannot restart readiness');eq(resumed.state.clockOffset,liveOffset,game+' live reconnect cannot extend the clock');
  await action(resumed,game==='doodle-guess'?{guess:'late'}:{guess:'Reconnected private caption'},{i:'retired-instance'});if(game==='draw-phone')eq(resumed.state.myGuess,'',game+' stale-instance caption stays unsaved');
  await fetch(base+'/close?session='+session,{method:'POST'});
 }finally{await Promise.all(clients.map(p=>new Promise(resolve=>{if(p.ws.readyState===WebSocket.CLOSED)return resolve();p.ws.once('close',resolve);p.ws.close()})));await new Promise(resolve=>server.close(resolve));}
}
(async()=>{await run('doodle-guess');await run('draw-phone');console.log('DRAWING_FIXTURE_TRANSPORT_PASS: '+checks+' embedded-script syntax and real WebSocket quorum, held input/deadline, released phase, stale token and live reconnect assertions')})().catch(e=>{console.error(e);process.exitCode=1});
