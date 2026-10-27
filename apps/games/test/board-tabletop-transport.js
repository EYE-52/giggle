'use strict';
// The native tabletop fixture must exercise the production ready protocol.
const assert=require('node:assert/strict'),vm=require('node:vm'),{once,EventEmitter}=require('node:events'),WebSocket=require('ws');
const {createServer}=require('./board-tabletop-browser');
let checks=0;
function ok(v,m){assert(v,m);checks++;}
function eq(a,b,m){assert.deepEqual(a,b,m);checks++;}
const revision=S=>S.game==='chess'?S.history.length:S.rev;
async function main(){
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 try{
 const html=await(await fetch(base+'/client')).text(),shell={document:{querySelector:()=>shell.error},error:{textContent:''},clears:0,resets:0,paints:0};
 const hooks=html.match(/function recordError\(packet\)\{[^\n]+/)[0]+'\n'+html.match(/async function handleRoom\(nextRoom\)\{[^\n]+/)[0];
 vm.runInNewContext("let host,roomEnded=false,active=true,rendered='old paint',childState='old child',S={instanceId:'old'};const errors=[],el={replaceChildren(){clears++}};function reset(){resets++}async function paint(){paints++}\n"+hooks+"\nglobalThis.inspect=()=>({roomEnded,active,rendered,childState,errors});globalThis.handle=handleRoom;globalThis.errorPacket=recordError;",shell);
 await shell.handle({hostId:'host',game:'chain-reaction'});eq(shell.paints,1,'live fixture room updates retain the running view');eq(shell.resets,0,'live room update does not dispose a game');
 shell.errorPacket({t:'error',msg:'The round could not load for everyone in time.'});await shell.handle({hostId:'host',game:null});
 eq(shell.error.textContent,'The round could not load for everyone in time.','actual Room error msg remains visible during recovery');ok(shell.inspect().roomEnded&&!shell.inspect().active,'game:null stops fixture rendering and identifies lobby recovery');eq(shell.inspect().rendered,null,'aborted match cannot remain a released paint');eq(shell.inspect().childState,null,'aborted match cannot retain a child-ready snapshot');eq(shell.clears,1,'recovery clears the stale Getting ready board');eq(shell.resets,1,'recovery disposes the shipped view');
 shell.errorPacket({t:'error',error:'Legacy fixture error'});eq(shell.error.textContent,'Legacy fixture error','legacy fixture error field remains readable');
 for(const game of ['chess','four-in-a-row','reversi']){
  const {session}=await(await fetch(base+'/session?game='+game)).json(),clients=[];
  async function join(role){const c={role,packets:[],events:new EventEmitter(),ws:new WebSocket(base.replace('http','ws')+'/socket')};
   c.ws.on('message',data=>{const packet=JSON.parse(data);c.packets.push(packet);if(packet.t==='state')c.state=packet;c.events.emit('packet');});await once(c.ws,'open');
   c.wait=(after,predicate)=>new Promise((resolve,reject)=>{const check=()=>{const state=c.packets.slice(after).find(p=>p.t==='state'&&predicate(p));if(state){cleanup();resolve(state);}};const cleanup=()=>{clearTimeout(timeout);c.events.off('packet',check);};const timeout=setTimeout(()=>{cleanup();reject(Error(game+' '+role+' state boundary timed out'));},4000);c.events.on('packet',check);check();});
   c.send=packet=>c.ws.send(JSON.stringify(packet));c.send({t:'join',session,role});await c.wait(0,()=>true);clients.push(c);return c;
  }
  // Rejoining the same live seat is a server-ordered state barrier, without
  // sleeps or a test-only acknowledgement that could bypass preparation.
  async function barrier(c,packets){const after=c.packets.length;for(const p of packets)c.send(p);c.send({t:'join',session,role:c.role});return c.wait(after,()=>true);}
  function ready(c,w=c.state.w){return{t:'game-ready',i:c.state.instanceId,w};}
  function action(c,a,w=c.state.w){return{t:'action',i:c.state.instanceId,w,a:{...a,...(game==='chess'?{}:{rev:c.state.rev})}};}
  try{
   const a=await join('a'),b=await join('b'),watcher=await join('watcher');
   ok(clients.every(c=>c.state.preparing),game+' fixture starts with real preparation');ok(watcher.state.spectator,game+' watcher is outside the starting roster');
   const move=game==='chess'?{move:{from:'e2',to:'e4'}}:game==='reversi'?{place:19}:{drop:3};
   watcher.send(ready(watcher));const held=await barrier(a,[action(a,move),ready(a,'stale-window'),ready(a)]);
   ok(held.preparing,game+' watcher/stale ACK/one active ACK cannot release');eq(revision(held),0,game+' action before client readiness cannot mutate authority');
   const after=clients.map(c=>c.packets.length);b.send(ready(b));await Promise.all(clients.map((c,i)=>c.wait(after[i],S=>!S.preparing)));eq(clients.map(c=>revision(c.state)),[0,0,0],game+' release is a state boundary, not a move');
   const liveW=a.state.w,before=clients.map(c=>c.packets.length);a.send(action(a,move));await Promise.all(clients.map((c,i)=>c.wait(before[i],S=>revision(S)===1)));
   if(game==='chess'){ok(clients.every(c=>!c.state.preparing),game+' ordinary chess move keeps the established action window');eq(a.state.w,liveW,game+' move settlement belongs to the Chess client');}
   else{
    ok(clients.every(c=>c.state.preparing),game+' confirmed turn opens production readiness');ok(a.state.w!==liveW,game+' new turn has a fresh ready token');
    const next=game==='reversi'?{place:b.state.legal[0]}:{drop:4};const pending=await barrier(b,[action(b,next),ready(b,liveW)]);eq(revision(pending),1,game+' pending next-turn action and stale ready token are rejected');ok(pending.preparing,game+' rejected next action stays held');
    const stillHeld=await barrier(a,[ready(a)]);ok(stillHeld.preparing,game+' every new turn requires both active clients');
    const released=clients.map(c=>c.packets.length);b.send(ready(b));await Promise.all(clients.map((c,i)=>c.wait(released[i],S=>!S.preparing&&revision(S)===1)));
   }
  }finally{await Promise.all(clients.map(c=>new Promise(resolve=>{if(c.ws.readyState===WebSocket.CLOSED)return resolve();c.ws.once('close',resolve);c.ws.close();})));}
 }}finally{await new Promise(resolve=>server.close(resolve));}
 console.log('BOARD_TABLETOP_TRANSPORT_PASS: '+checks+' native-fixture real-WebSocket assertions (initial/turn preparation, two-seat quorum, stale/watcher ACKs, pending actions, actual release and Chess stable window)');
}
main().catch(e=>{console.error(e);process.exitCode=1});
