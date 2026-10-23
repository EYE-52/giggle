'use strict';
const assert=require('node:assert/strict'),castle=require('../games/castle-clash/server'),{Room}=require('../server/room'),{validateManifest,manifestPlayers}=require('../games/_validate'),{actionWindow}=require('../games/_sdk');
assert(validateManifest(castle).ok,'Castle manifest validates');assert.deepEqual(manifestPlayers(castle),{min:2,max:24});assert.equal(castle.manifest.seats,4);assert.equal(castle.manifest.runtime.waitForResult,true);
assert.equal(castle.CASTLE_CONFIG.buildMs,60000);assert.equal(castle.CASTLE_CONFIG.siegeMs,90000);assert.equal(castle.CASTLE_CONFIG.rounds,3);
assert(Object.values(castle.CASTLE_CONFIG.cards).reduce((n,c)=>n+c.quantity,0)>=24,'meaningful finite hand');
function sock(){return{readyState:1,sent:[],send(m){this.sent.push(JSON.parse(m));},close(){this.readyState=3;}};}
for(const n of [2,3,4]){
 const room=new Room('castle'+n,{'castle-clash':{}}),sockets=Array.from({length:n+1},sock),seats=sockets.slice(0,n).map((s,i)=>room.addPlayer('Player '+i,s).player);
 assert(room.startGame(castle,{},'outsider').error);assert(room.startGame(castle,{},room.hostId).ok);assert.equal(room.game.state.castles.length,n);
 const original=room.game.instanceId,seat=seats[1],token=seat.token,pid=seat.id;room.disconnect(sockets[1]);const resume=sock();assert(room.addPlayer('Player 1',resume,token).resumed);sockets[1]=resume;assert.equal(room.game.state.castles[1].pid,pid);
 const late=room.addPlayer('Watcher',sockets[n]).player;assert(room.isSpectator(late.id));const before=room.game.state.castles[0].pieces.length;
 room.onAction(sockets[n],{place:{card:'cube',x:4,y:0,z:4,rotation:0,nonce:'watch'}},{i:original,w:actionWindow(room.game.state)});assert.equal(room.game.state.castles[0].pieces.length,before);
 room.onAction(sockets[0],{place:{card:'cube',x:4,y:0,z:4,rotation:0,nonce:'real'}},{i:original,w:actionWindow(room.game.state)});assert.equal(room.game.state.castles[0].pieces.length,before+1);
 room.onAction(sockets[0],{place:{card:'cube',x:5,y:0,z:4,rotation:0,nonce:'stale-window'}},{i:original,w:'{"phase":"siege","round":1}'});assert.equal(room.game.state.castles[0].pieces.length,before+1,'stale window refused');
 const oldState=room.game.state;assert(room.startGame(castle,{},room.hostId).ok);assert.notEqual(room.game.instanceId,original);assert(oldState.disposed,'rematch disposes old authority');assert.equal(room.game.state.castles.length,Math.min(4,n+1),'next-match watcher can take available active seat');
 const count=room.game.state.castles[0].pieces.length;room.onAction(sockets[0],{place:{card:'cube',x:4,y:0,z:4,rotation:0,nonce:'old-instance'}},{i:original,w:actionWindow(room.game.state)});assert.equal(room.game.state.castles[0].pieces.length,count,'stale instance refused');
 assert(room.endGameToLobby(seats[1].id).error);assert(room.endGameToLobby(room.hostId).ok);assert.equal(room.game,null);room.destroy();assert.equal(room.timers.size,0);
}
// Full Room-driven matches on the same authority clock used by its windows.
const realNow=Date.now;let clock=realNow();Date.now=()=>clock;
try{
 for(const n of [2,3,4]){
  const room=new Room('full'+n,{'castle-clash':{}}),sockets=Array.from({length:n},sock),seats=sockets.map((s,i)=>room.addPlayer('Castle '+i,s).player);assert(room.startGame(castle,{},room.hostId).ok);
  let nonce=0;const act=(i,type,data={})=>room.onAction(sockets[i],{[type]:{...data,nonce:'room-'+(++nonce)}},{i:room.game.instanceId,w:actionWindow(room.game.state)});
  const clockRules=require('../games/engines/block-siege').createBlockSiege(castle.CASTLE_CONFIG); const pulse=()=>{clockRules.advance(room.game.state,room.ctx());room.broadcastState();};
  for(let round=1;round<=3;round++){
   assert.equal(room.game.state.phase,'build');assert.equal(room.game.state.round,round);
   for(let i=0;i<n;i++){act(i,'place',{card:'cube',x:2,y:.5,z:0,rotation:0});act(i,'place',{card:'beam',x:2,y:1.5,z:0,rotation:0});}
   for(let i=0;i<n;i++)act(i,'ready',{value:true});assert.equal(room.game.state.phase,'siege');
   for(let i=0;i<n;i++)act(i,'fire',{weapon:'ballista',target:seats[(i+1)%n].id,x:0,y:.9,z:0});
   clock+=4000;pulse();assert(room.game.state.events.some(e=>e.type==='impact'&&e.round===round));
   clock=room.game.state.endsAt+1;pulse();assert.equal(room.game.state.phase,'resolving');clock+=1001;pulse();
   if(round<3){assert.equal(room.game.state.phase,'round-result');clock=room.game.state.endsAt+1;pulse();}else{assert.equal(room.game.state.phase,'done');assert.equal(room.game.state.endsAt,0);}
  }
  const totals={...room.totals};pulse();assert.deepEqual(room.totals,totals,'Room totals never score twice');const old=room.game.instanceId;assert(room.startGame(castle,{},room.hostId).ok);assert.notEqual(room.game.instanceId,old);assert.equal(room.game.state.phase,'build');assert(room.endGameToLobby(room.hostId).ok);room.destroy();assert.equal(room.timers.size,0);
 }
}finally{Date.now=realNow;}
console.log('CASTLE_PASS: full 2/3/4-player Room matches, roster/watchers, reconnect, phase windows, scoring, rematch and change-game');
