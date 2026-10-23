'use strict';
// Preparation snapshots from the actual native drawing fixtures are painted
// by the shipped modules. The host supplies the same release/baseline contract.
const assert=require('node:assert/strict');
let checks=0;
function eq(a,b,m){assert.deepEqual(a,b,m);checks++;}
function ok(v,m){assert(v,m);checks++;}
function table(game){
 const session=require('./'+game+'-browser').createSession(),{room,clock,roles}=session,rig=require('./'+game+'-view').rig,peers=[];
 for(const [role,seat]of Object.entries(roles)){
  const p={role,seat,r:rig(),baseline:true,acks:0,S:null};p.socket={readyState:1,bufferedAmount:0,close(){},send(data){const m=JSON.parse(data);if(m.t!=='state')return;p.S={...m,me:m.you,audioBaseline:p.baseline};p.baseline=false;p.r.view.render(p.r.el,p.S,p.r.api);}};
  peers.push(p);room.addPlayer(seat.name,p.socket,seat.token);
 }
 room.broadcastState();
 function send(p,a){room.onAction(p.socket,a,{i:p.S.instanceId,w:p.S.w});}
 function release(){ok(room.game.preparing,game+' real fixture requires readiness');const meta={i:room.game.instanceId,w:room._actionToken()},active=peers.filter(p=>!p.S.spectator),watcher=peers.find(p=>p.S.spectator);room.onReady(watcher.socket,meta);ok(room.game.preparing,game+' watcher cannot release');
  active.forEach((p,i)=>{room.onReady(p.socket,meta);p.acks++;if(i<active.length-1)ok(room.game.preparing,game+' incomplete active quorum holds');});ok(!room.game.preparing,game+' every active seat releases');ok(peers.every(p=>!p.S.preparing),game+' released snapshots render on every actual client');
 }
 function expire(p){clock.time=room.game.state.endsAt;send(p,{});}
 function quietReconnect(p){p.baseline=true;room.broadcastState();}
 function close(){peers.forEach(p=>p.r.view.dispose());room.destroy();}
 const byRole=Object.fromEntries(peers.map(p=>[p.role,p]));release();eq(peers.map(p=>p.r.cues.length),peers.map(()=>0),game+' initial ready/release is quiet');return{room,clock,peers,send,release,expire,quietReconnect,close,...byRole};
}
function doodle(){
 const t=table('doodle-guess');try{
  t.send(t.artist,{choose:t.artist.S.choices[0]});t.release();const word=t.artist.S.wordShown;
  t.send(t.guesser,{guess:word});eq(t.peers.map(p=>p.r.cues.map(c=>c.name)),t.peers.map(()=>['correct']),'same-window first accepted guess cues once');
  t.send(t.other,{guess:word});ok(t.room.game.preparing,'last correct opens a real reveal preparation');eq(t.peers.map(p=>p.r.cues.length),[1,1,1,1],'pending reveal cannot sound');
  t.quietReconnect(t.artist);t.release();eq(t.artist.r.cues.map(c=>c.name),['correct'],'reconnect seeds historical correct/reveal while prepared');
  for(const p of [t.guesser,t.other,t.watcher])eq(p.r.cues.map(c=>c.name),['correct','correct','reveal'],'release retains last correct then public word reveal');
  t.room.broadcastState();eq(t.peers.map(p=>p.r.cues.length),[1,3,3,3],'released reveal heartbeat stays quiet');
 }finally{t.close();}
}
function phone(){
 const t=table('draw-phone');try{
  for(const p of [t.first,t.second,t.third])t.send(p,{phrase:'Private phrase by '+p.role});ok(t.room.game.preparing,'last phrase opens a real drawing preparation');for(const p of t.peers)p.r.cues.length=0;
  t.release();eq(t.peers.map(p=>p.r.cues.map(c=>c.name)),t.peers.map(()=>['deal']),'release deals each assigned drawing page once');
  t.expire(t.first);ok(t.room.game.preparing,'drawing deadline opens real caption preparation');t.release();eq(t.peers.map(p=>p.r.cues.map(c=>c.name)),t.peers.map(()=>['deal','deal']),'release deals assigned captions after deadline');
  for(const p of [t.first,t.second,t.third])t.send(p,{guess:'Caption by '+p.role});ok(t.room.game.preparing,'last caption prepares public reveal');for(const p of t.peers)p.r.cues.length=0;
  t.quietReconnect(t.first);t.release();eq(t.first.r.cues,[],'prepared reveal reconnect is quiet');for(const p of [t.second,t.third,t.watcher])eq(p.r.cues.map(c=>c.name),['reveal'],'release reveals each public book once');
  t.send(t.first,{next:true});eq(t.peers.map(p=>p.r.cues.at(-1)?.name),t.peers.map(()=>'reveal'),'next accepted story has public reveal feedback');const sizes=t.peers.map(p=>p.r.cues.length);t.send(t.first,{prev:true});eq(t.peers.map(p=>p.r.cues.length),sizes,'revisiting a seen page cannot replay the reveal');t.room.broadcastState();eq(t.peers.map(p=>p.r.cues.length),sizes,'page heartbeat cannot replay feedback');
 }finally{t.close();}
}
const failures=[];for(const run of [doodle,phone])try{run();}catch(error){failures.push(run.name+': '+error.message);}if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('DRAWING_READINESS_PASS: '+checks+' real-fixture/shipped-client quorum, accepted-answer/deal/reveal timing, deadline, reconnect and revisited-page assertions');
