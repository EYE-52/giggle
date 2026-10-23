'use strict';
const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');
const { createServer } = require('./board-duels-browser');
let checks=0;
function eq(a,b,message){assert.deepEqual(a,b,message);checks++;}
function ok(a,message){assert(a,message);checks++;}
async function until(fn,message){for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error(message);}
async function main(){
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 try{for(const game of ['reversi','four-in-a-row']){
  const {session}=await(await fetch(base+'/session?game='+game)).json(),clients={};
  async function join(role){const ws=new WebSocket(base.replace('http','ws')+'/socket'),client={ws,frames:[],state:null};ws.on('message',raw=>{const m=JSON.parse(raw);client.frames.push(m);if(m.t==='state')client.state=m;});await once(ws,'open');ws.send(JSON.stringify({t:'join',session,role}));await until(()=>client.state,role+' snapshot');clients[role]=client;return client;}
  async function send(role,a,meta={}){const c=clients[role],before=c.frames.length;c.ws.send(JSON.stringify({t:'action',a,i:c.state.instanceId,w:c.state.w,...meta}));await until(()=>c.frames.slice(before).some(f=>f.t==='qa-ack'),role+' ack');}
  const all=fn=>Object.values(clients).every(c=>fn(c.state));
  try{
   for(const role of ['a','b','earlier','watcher'])await join(role);
   eq(clients.a.state.players.length,2,'two active seats');eq(clients.a.state.seats.length,2,'two side owners projected');ok(clients.earlier.state.spectator,'pre-start extra seat watches');ok(clients.watcher.state.spectator,'late join watches');
   eq(clients.earlier.state.legal,[]);eq(clients.watcher.state.legal,[]);eq(clients.b.state.legal,[]);
   const move=game==='reversi'?{place:19}:{drop:0};
   await send('watcher',{...move,rev:0});await send('earlier',{resign:true,rev:0});eq(clients.a.state.rev,0,'watchers cannot act');
   await send('a',move);eq(clients.a.state.rev,0,'missing revision rejected even with room tokens');
   await send('b',{...move,rev:0});eq(clients.a.state.rev,0,'waiting seat rejected');
   const first=clients.a,oldI=first.state.instanceId,oldW=first.state.w,before=first.frames.length;
   first.ws.send(JSON.stringify({t:'action',a:{...move,rev:0},i:oldI,w:oldW}));first.ws.send(JSON.stringify({t:'action',a:{...move,rev:0},i:oldI,w:oldW}));
   await until(()=>first.frames.slice(before).filter(f=>f.t==='qa-ack').length===2,'duplicate ack');await until(()=>all(s=>s.rev===1),'same revision delivered');
   eq(first.state.board.filter(Boolean).length,game==='reversi'?5:1,'duplicate applies once');ok(all(s=>JSON.stringify(s.board)===JSON.stringify(first.state.board)),'all projected boards agree');
   await send('b',{...(game==='reversi'?{place:20}:{drop:1}),rev:0},{w:undefined});eq(first.state.rev,1,'revision independently rejects stale move without window');
   await send('a',{resign:true,rev:1});await until(()=>all(s=>s.phase==='done'),'resign snapshots');eq(first.state.result.winnerPid,clients.b.state.you,'waiting player may resign');
   const totals={...first.state.totals};await send('b',{resign:true,rev:first.state.rev});eq(first.state.totals,totals,'terminal score once');
   const dropped=clients.watcher.ws;dropped.close();await once(dropped,'close');await join('watcher');eq(clients.watcher.state.board,first.state.board,'reconnect preserves completed board');eq(clients.watcher.state.phase,'done');
   clients.b.ws.send(JSON.stringify({t:'qa-rematch'}));await until(()=>clients.b.frames.some(f=>f.t==='qa-error'),'non-host rematch rejection');eq(first.state.instanceId,oldI);
   first.ws.send(JSON.stringify({t:'qa-rematch'}));await until(()=>all(s=>s.instanceId!==oldI),'host rematch');eq(first.state.rev,0);eq(first.state.phase,'play');
   await send('a',{...move,rev:0},{i:oldI,w:oldW});eq(first.state.rev,0,'dead instance cannot act on rematch');
   let moves=0;
   if(game==='reversi'){while(first.state.phase==='play'&&moves<64){const role=first.state.turn===1?'a':'b',c=clients[role],legal=c.state.legal;ok(legal.length,'projected move available');await send(role,{place:legal[(moves*7)%legal.length],rev:c.state.rev});moves++;await until(()=>all(s=>s.rev===moves),'turn broadcast');}}
   else for(const drop of [0,6,1,6,2,5,3]){const role=first.state.turn===1?'a':'b';await send(role,{drop,rev:clients[role].state.rev});moves++;await until(()=>all(s=>s.rev===moves),'drop broadcast');}
   eq(first.state.phase,'done','complete authority match');ok(all(s=>s.phase==='done'));eq(first.state.rev,moves);ok(first.state.result);
   if(game==='four-in-a-row')eq(first.state.winning.length,4,'winning cells projected');
   const finalTotals={...first.state.totals};await send('a',{...move,rev:first.state.rev});eq(first.state.totals,finalTotals,'complete result not rescored');
   first.ws.send(JSON.stringify({t:'qa-rematch'}));const doneI=first.state.instanceId;await until(()=>all(s=>s.instanceId!==doneI),'second rematch');eq(first.state.rev,0);eq(first.state.lastMove,null);
  }finally{for(const c of Object.values(clients))c.ws.terminate();await fetch(base+'/close?session='+session,{method:'POST'});}
 }}finally{await new Promise(resolve=>server.close(resolve));}
 console.log(`BOARD_DUELS_TRANSPORT_PASS: ${checks} real WebSocket/Room assertions across two complete matches, stale/duplicate/ownership gates, two watcher types, resign, reconnect and two rematches each`);
}
main().catch(error=>{console.error(error);process.exitCode=1});
