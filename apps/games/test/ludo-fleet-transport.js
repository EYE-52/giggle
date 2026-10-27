'use strict';
const assert=require('node:assert/strict'),{once}=require('node:events'),WebSocket=require('ws'),{createServer}=require('./ludo-fleet-browser');
let checks=0;function ok(v,msg){assert(v,msg);checks++;}function eq(a,b,msg){assert.deepEqual(a,b,msg);checks++;}
async function until(fn,msg){for(let n=0;n<300;n++){if(fn())return;await new Promise(r=>setTimeout(r,2));}throw Error(msg);}
async function main(){const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
for(const route of ['/', '/client']){const html=await(await fetch(base+route)).text();for(const [,script]of html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g))new AsyncFunction(script.replace(/^import .*;$/gm,''));ok(true,route+' embedded module parses');}
try{for(const game of ['ludo','fleet-duel']){const data=await(await fetch(base+'/session?game='+game)).json(),clients={};
function ready(c,meta={}){const s=c.state;if(!s?.preparing||s.spectator)return;c.ws.send(JSON.stringify({t:'game-ready',i:s.instanceId,w:s.w,...meta}));}
async function join(role,autoReady=false){const ws=new WebSocket(base.replace('http','ws')+'/socket'),c={ws,frames:[],state:null,autoReady,readyWindows:new Set()};ws.on('message',raw=>{const m=JSON.parse(raw);c.frames.push(m);if(m.t==='state'){c.state=m;const key=m.instanceId+':'+m.w;if(c.autoReady&&m.preparing&&!m.spectator&&!c.readyWindows.has(key)){c.readyWindows.add(key);ready(c);}}if(m.t==='room')c.host=m.room.hostId;});await once(ws,'open');ws.send(JSON.stringify({t:'join',session:data.session,role}));await until(()=>c.state,role+' join');clients[role]=c;return c;}
async function send(role,a,meta={},duringPreparation=false){if(!duringPreparation)await until(()=>all(s=>!s.preparing),'released action window');const c=clients[role],before=c.frames.length;c.ws.send(JSON.stringify({t:'action',a,i:c.state.instanceId,w:c.state.w,...meta}));await until(()=>c.frames.slice(before).some(f=>f.t==='qa-ack'),role+' ack');}
const all=fn=>Object.values(clients).every(c=>fn(c.state));
try{for(const role of data.roles)await join(role);const a=clients.a,oldI=a.state.instanceId,oldW=a.state.w;
eq(a.host,a.state.you,'initial room host context projected');ok(Object.values(clients).every(c=>c.host===a.state.you),'all initial clients receive room host context');
eq(a.state.players.length,game==='ludo'?4:2,'active seat cap');ok(clients.earlier.state.spectator);ok(clients.watcher.state.spectator);
ok(all(s=>s.preparing),'fixture starts in production preparation');
await send('a',game==='ludo'?{roll:true,rev:0}:{auto:true,rev:0},{},true);eq(a.state.rev,0,'valid early action is held before readiness');
clients.watcher.ws.send(JSON.stringify({t:'game-ready',i:oldI,w:oldW}));await send('watcher',{}, {},true);ok(a.state.preparing,'watcher cannot release readiness');
ready(a,{w:'retired-window'});await send('a',{}, {},true);ok(a.state.preparing,'stale readiness token cannot release');
const active=Object.values(clients).filter(c=>!c.state.spectator),held=active.at(-1);
for(const c of active.slice(0,-1)){c.autoReady=true;ready(c);}await send('a',{}, {},true);ok(all(s=>s.preparing),'every active seat must acknowledge');
held.autoReady=true;ready(held);await until(()=>all(s=>!s.preparing),'all active seats release preparation');eq(a.state.rev,0,'release is not a game action');
const beforeAuto=a.frames.length;a.ws.send(JSON.stringify({t:'qa-autoplay'}));await until(()=>a.frames.slice(beforeAuto).some(m=>m.t==='qa-error'),'server autoplay rejected');eq(a.state.rev,0,'fixture cannot bypass client settlement through server autoplay');
await send('watcher',{resign:true,rev:0});await send('a',game==='ludo'?{roll:true}:{auto:true});eq(a.state.rev,0,'watcher/missing revision rejected');
if(game==='ludo'){
 await send('b',{roll:true,rev:0});eq(a.state.rev,0,'out of turn roll');
 held.autoReady=false;
 const before=a.frames.length;for(let n=0;n<2;n++)a.ws.send(JSON.stringify({t:'action',a:{roll:true,rev:0},i:oldI,w:oldW}));await until(()=>a.frames.slice(before).filter(m=>m.t==='qa-ack').length===2,'duplicate rolls');eq(a.state.rev,1,'one server roll');
 ok(all(s=>s.rev===1&&JSON.stringify(s.pawns)===JSON.stringify(a.state.pawns)),'synchronized pawns');
 ok(all(s=>s.preparing),'confirmed roll opens real next-window preparation');
 const actor=['a','b','c','d'][a.state.turn],next=clients[actor].state;await send(actor,next.phase==='roll'?{roll:true,rev:1}:{move:next.legal[0],rev:1},{},true);eq(a.state.rev,1,'next move cannot cross held roll preparation');
 ready(held,{w:oldW});await send('a',{}, {},true);ok(a.state.preparing,'previous turn ACK cannot release roll');held.autoReady=true;ready(held);await until(()=>all(s=>!s.preparing),'fresh all-seat ACK releases roll');
}else{
 await send('a',{place:{ship:0,at:9,vertical:false},rev:0});eq(a.state.rev,0,'invalid placement');
 await send('a',{auto:true,rev:a.state.actionRev});await send('b',{auto:true,rev:clients.b.state.actionRev});
 ok(clients.b.state.enemyFleet.length===0&&clients.watcher.state.publicFleets.every(f=>f.length===0));eq(clients.watcher.state.lastMove,null);
 const window=a.state.w,ar=a.state.actionRev,br=clients.b.state.actionRev;
 a.ws.send(JSON.stringify({t:'action',a:{ready:true,rev:ar},i:a.state.instanceId,w:window}));clients.b.ws.send(JSON.stringify({t:'action',a:{ready:true,rev:br},i:a.state.instanceId,w:window}));
 await until(()=>all(s=>s.phase==='play'),'concurrent ready');ok(a.state.ready.every(Boolean));
 await send('b',{fire:0,rev:clients.b.state.actionRev});eq(a.state.shots[1][0],0,'waiting shooter blocked');
}
await until(()=>all(s=>!s.preparing),'released reconnect boundary');const live=clients.a.ws,offset=a.state.clockOffset;live.close();await once(live,'close');await join('a',true);eq(clients.a.state.instanceId,oldI,'same active instance reconnect');ok(clients.a.state.youAre===0&&!clients.a.state.spectator,'same owner reconnect');ok(!clients.a.state.preparing,'live reconnect cannot restart preparation');eq(clients.a.state.clockOffset,offset,'live reconnect cannot extend the game clock');
let actions=0;const first=clients.a;
while(first.state.phase!=='done'&&actions++<20000){const side=first.state.turn,role=['a','b','c','d'][side],c=clients[role],s=c.state;
const action=game==='ludo'?(s.phase==='roll'?{roll:true}:{move:s.legal.sort((x,y)=>s.pawns[side][y]-s.pawns[side][x])[0]}):{fire:s.shots[side].findIndex(v=>!v)};
await send(role,{...action,rev:s.actionRev??s.rev});
if(game==='fleet-duel'){const v=clients.watcher.state;for(let target=0;target<2;target++)for(const ship of v.publicFleets[target])ok(ship.sunk&&Array.from({length:ship.length},(_,i)=>ship.at+i*(ship.vertical?10:1)).every(index=>v.shots[1-target][index]===2),'only sunk vessels public');}
}
ok(first.state.phase==='done','complete initial-position match');ok(all(s=>s.phase==='done'));ok(first.state.result.winnerPid);const totals={...first.state.totals};await send('a',{resign:true,rev:first.state.actionRev??first.state.rev});eq(first.state.totals,totals,'score once');
const dead=first.state.instanceId,w=first.state.w;clients.watcher.ws.close();await once(clients.watcher.ws,'close');await join('watcher',true);eq(clients.watcher.state.result,first.state.result,'finished watcher reconnect');
Object.values(clients).find(c=>c.state.you===c.host).ws.send(JSON.stringify({t:'qa-rematch'}));await until(()=>all(s=>s.instanceId!==dead),'host rematch');eq(first.state.rev,0);eq(first.state.lastMove,null);eq(first.state.phase,game==='ludo'?'roll':'place');
await until(()=>all(s=>!s.preparing),'rematch readiness release');ok(Object.values(clients).filter(c=>!c.state.spectator).every(c=>c.readyWindows.has(c.state.instanceId+':'+c.state.w)),'rematch requires fresh active-seat ACKs');ok(Object.values(clients).filter(c=>c.state.spectator).every(c=>c.readyWindows.size===0),'both watcher types never ACK');
await send('a',game==='ludo'?{roll:true,rev:0}:{auto:true,rev:0},{i:dead,w});eq(first.state.rev,0,'old instance blocked');
await send('b',{resign:true,rev:clients.b.state.actionRev??clients.b.state.rev});if(game==='ludo'){await send('c',{resign:true,rev:clients.c.state.rev});await send('d',{resign:true,rev:clients.d.state.rev});}
await until(()=>all(s=>s.phase==='done'),'confirmed resign finish');eq(first.state.result.winnerPid,first.state.you);
console.log(game,'real Room complete match:',actions,'legal actions');
}finally{for(const c of Object.values(clients))c.ws.terminate();await fetch(base+'/close?session='+data.session,{method:'POST'});}
}}finally{await new Promise(r=>server.close(r));}console.log('LUDO_FLEET_TRANSPORT_PASS:',checks,'real WebSocket assertions, full wins, simultaneous ready, two watcher types, reconnect and rematch');}
main().catch(e=>{console.error(e);process.exitCode=1});
