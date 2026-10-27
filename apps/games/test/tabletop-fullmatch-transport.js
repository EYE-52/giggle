'use strict';
// Narrow transport regression for the native fixture's three complete paths.
// Real readiness ACKs are sent here by socket peers; no browser/render claim.
const assert=require('node:assert/strict'),{once,EventEmitter}=require('node:events'),WebSocket=require('ws');
const {createServer}=require('./board-tabletop-browser');
const progress=S=>S.game==='chess'?S.history.length:S.rev;
const projection=(game,S)=>game==='chess'?S.fen:S.board;
async function main(){
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port,summary=[];
 try{for(const game of ['chess','four-in-a-row','reversi']){
  const {session}=await(await fetch(base+'/session?game='+game)).json(),peers=[];
  async function join(role){const c={role,packets:[],events:new EventEmitter(),ws:new WebSocket(base.replace('http','ws')+'/socket')};peers.push(c);c.ws.on('message',raw=>{const m=JSON.parse(raw);c.packets.push(m);if(m.t==='state')c.S=m;c.events.emit('packet')});await once(c.ws,'open');
   c.wait=(after,predicate)=>new Promise((resolve,reject)=>{const inspect=()=>{const found=c.packets.slice(after).find(m=>m.t==='state'&&predicate(m));if(found){cleanup();resolve(found)}};const cleanup=()=>{clearTimeout(timer);c.events.off('packet',inspect)};const timer=setTimeout(()=>{cleanup();reject(Error(game+' '+role+' state timeout'))},4000);c.events.on('packet',inspect);inspect()});c.send=m=>c.ws.send(JSON.stringify(m));c.send({t:'join',session,role});await c.wait(0,()=>true);return c;
  }
  const a=await join('a'),b=await join('b'),watcher=await join('watcher');
  async function release(){if(!a.S.preparing)return;const before=peers.map(c=>c.packets.length);for(const c of [a,b])c.send({t:'game-ready',i:c.S.instanceId,w:c.S.w});await Promise.all(peers.map((c,i)=>c.wait(before[i],S=>!S.preparing)));}
  async function barrier(c,action,meta={}){const after=c.packets.length;c.send({t:'action',i:c.S.instanceId,w:c.S.w,a:action,...meta});c.send({t:'join',session,role:c.role});await c.wait(after,()=>true);}
  try{assert(watcher.S.spectator);await release();let n=0;const chess=[['f2','f3'],['e7','e5'],['g2','g4'],['d8','h4']],four=[0,6,1,6,2,5,3];
   while(a.S.phase==='play'&&n<64){await release();const actor=game==='chess'?(a.S.turn==='w'?a:b):(a.S.turn===1?a:b),move=game==='chess'?{move:{from:chess[n][0],to:chess[n][1]}}:game==='four-in-a-row'?{drop:four[n],rev:actor.S.rev}:{place:actor.S.legal[n%actor.S.legal.length],rev:actor.S.rev};const before=peers.map(c=>c.packets.length);actor.send({t:'action',i:actor.S.instanceId,w:actor.S.w,a:move});await Promise.all(peers.map((c,i)=>c.wait(before[i],S=>progress(S)===n+1)));n++;assert(peers.every(c=>game==='chess'?typeof c.S.fen==='string':Array.isArray(c.S.board)));assert(peers.every(c=>JSON.stringify(projection(game,c.S))===JSON.stringify(projection(game,a.S))));}
   assert.equal(a.S.phase,'done');assert.equal(progress(a.S),n);const old=a.S.instanceId,oldWindow=a.S.w,final=a.S.result;const before=peers.map(c=>c.packets.length);a.send({t:'rematch'});await Promise.all(peers.map((c,i)=>c.wait(before[i],S=>S.instanceId!==old)));await release();assert(peers.every(c=>progress(c.S)===0&&!c.S.preparing));assert(watcher.S.spectator);
   const opening=game==='chess'?{move:{from:'e2',to:'e4'}}:game==='four-in-a-row'?{drop:3,rev:0}:{place:a.S.legal[0],rev:0};await barrier(a,opening,{i:old,w:oldWindow});assert.equal(progress(a.S),0);await barrier(a,opening,{w:'retired-window'});assert.equal(progress(a.S),0);const live=peers.map(c=>c.packets.length);a.send({t:'action',i:a.S.instanceId,w:a.S.w,a:opening});await Promise.all(peers.map((c,i)=>c.wait(live[i],S=>progress(S)===1)));summary.push({game,actions:n,final,readyRematch:true,staleRejected:true});
  }finally{await Promise.all(peers.map(c=>new Promise(resolve=>{c.ws.once('close',resolve);c.ws.close()})))}
 }}finally{await new Promise(resolve=>server.close(resolve))}
 console.log('TABLETOP_FULLMATCH_TRANSPORT_PASS '+JSON.stringify(summary));
}
main().catch(error=>{console.error(error);process.exitCode=1});
