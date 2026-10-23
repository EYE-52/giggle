'use strict';
// Authority/fixture lifecycle regression on socket sinks. Does not certify a
// native paint or synthesize readiness in the browser fixture.
const assert=require('node:assert/strict');
const {createSession}=require('./party-native-browser');
const s=createSession('would-you-rather'),clients={};
try{
 for(const [role,p]of Object.entries(s.roles)){
  const socket={readyState:1,bufferedAmount:0,frames:[],send(text){this.frames.push(JSON.parse(text));},close(){}};
  assert.equal(s.room.addPlayer(p.name,socket,p.token).player.id,p.id);clients[role]=socket;
 }
 const release=()=>{for(const [role,p]of Object.entries(s.roles))s.room.onReady(clients[role],{i:s.room.game.instanceId,w:s.room._actionToken()});assert(!s.room.game.preparing);};
 const act=(role,a)=>s.room.onAction(clients[role],a,{i:s.room.game.instanceId,w:s.room._actionToken()});
 release();
 for(let n=0;s.room.game.state.phase!=='done'&&n<20;n++){
  if(s.room.game.state.phase==='vote')for(const role of ['a','b','c'])act(role,{vote:'a'});
  else if(s.room.game.state.phase==='reveal')act('a',{next:true});
  release();
 }
 assert.equal(s.room.game.state.phase,'done');const old=s.room.game.instanceId,w=s.room._actionToken();
 s.room.disconnect(clients.a);assert.equal(s.room.hostId,s.roles.b.id,'finished owner disconnect elects player b');
 s.room.addPlayer(s.roles.a.name,clients.a,s.roles.a.token);assert.equal(s.room.hostId,s.roles.b.id,'reconnect does not reclaim host');
 assert.match(s.room.startGame(s.game,{ready:true},s.roles.a.id).error,/Only the host/,'old fixture owner rematch reproduces rejected action');
 assert.equal(s.room.game.instanceId,old,'rejected rematch leaves completed UI instance valid');
 assert(s.room.startGame(s.game,{ready:true},s.room.hostId).ok);assert.notEqual(s.room.game.instanceId,old);release();
 assert(!s.room.game.preparing);assert.equal(s.room.activeRosterIds().length,4,'connected former watcher participates in fresh match');
 const before=JSON.stringify(s.room.game.state);s.room.onAction(clients.a,{vote:'a',next:true},{i:old,w});assert.equal(JSON.stringify(s.room.game.state),before);
 console.log('PARTY_NATIVE_LIFECYCLE_AUTHORITY_PASS: legal WYR final, finished host migration, old-owner rejection, current-host ready rematch, four active seats, retired-instance rejection; socket sinks, no native browser verdict');
}finally{s.room.destroy();}
