'use strict';
// Real production-server matches. Peers send ordinary protocol actions;
// this verifies rules/transport, not physical camera or microphone capture.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');
const path = require('node:path');
const port = 18549;
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
let checks = 0;
function eq(a,b,message) { assert.deepEqual(a,b,message); checks++; }
function ok(a,message) { assert(a,message); checks++; }
async function until(predicate,message,timeout=4000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) { if(predicate())return; await sleep(10); }
  throw Error(message);
}
async function main() {
  const child=spawn(process.execPath,['server/server.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
  let log=''; child.stdout.on('data',d=>log+=d); child.stderr.on('data',d=>log+=d);
  const clients=[];
  const send=(p,m)=>p.ws.send(JSON.stringify(m));
  async function connect(name,code,token) {
    const p={name,ws:new WebSocket('ws://127.0.0.1:'+port),state:null,room:null,hello:null,frames:[],ready:true}; clients.push(p);
    p.ws.on('message',raw=>{
      const m=JSON.parse(raw); p.frames.push(m);
      if(m.t==='hello')p.hello=m;
      if(m.t==='room')p.room=m.room;
      if(m.t==='state') { p.state=m; if(m.preparing&&p.ready)send(p,{t:'game-ready',i:m.instanceId,w:m.w}); }
    });
    await once(p.ws,'open'); send(p,code?{t:'join',name,code,seatToken:token}:{t:'create',name});
    await until(()=>p.hello,'join '+name); return p;
  }
  const action=(p,a,meta={})=>send(p,{t:'action',a,i:p.state.instanceId,w:p.state.w,...meta});
  async function released(ps,phase,round) { await until(()=>ps.every(p=>p.state?.phase===phase&&!p.state.preparing&&(round===undefined||p.state.round===round)),'released '+phase+' '+round,16000); }
  try {
    await until(()=>log.includes('PartyBox on'),'server boot');
    const a=await connect('Camera A'), code=a.hello.code;
    let b=await connect('Camera B',code); const c=await connect('Camera C',code);
    let active=[a,b,c];
    for(const game of ['charades','pose-party','show-and-go']) {
      const before=a.state?.instanceId;
      send(a,{t:'start',game,ready:true,settings:game==='charades'?{rounds:3,roundSeconds:10}:{rounds:2,performSeconds:10,voteSeconds:8}});
      await until(()=>a.state?.instanceId!==before&&a.state?.game===game,'new '+game);
      const initial=a.state.instanceId;
      await released(active,game==='charades'?'act':'perform',1);
      // Joining after start must not become a performer or judge this match.
      const watcher=await connect('Watching '+game,code); await until(()=>watcher.state,'watcher snapshot');
      ok(watcher.state.spectator,'late participant is watching '+game);
      const all=[...active,watcher];
      const rounds=game==='charades'?3:2;
      for(let round=1;round<=rounds;round++) {
        await released(all,game==='charades'?'act':'perform',round);
        if(game==='charades') {
          const actor=active.find(p=>p.hello.you===a.state.actor), word=actor.state.wordShown;
          ok(word,'actor receives private word');
          for(const p of all.filter(p=>p!==actor))ok(!('word' in p.state)&&!('wordShown' in p.state),'other seats do not receive private word');
          action(watcher,{guess:word}); await sleep(30); eq(a.state.guessed,{},'watcher cannot score');
          const guessers=active.filter(p=>p!==actor);
          action(guessers[0],{guess:word});
          await until(()=>a.state.guessed?.[guessers[0].hello.you],'first correct guess');
          const points=a.state.scores[guessers[0].hello.you];
          action(guessers[0],{guess:word}); await sleep(30);
          eq(a.state.scores[guessers[0].hello.you],points,'duplicate guess cannot score twice');
          for(const p of guessers.slice(1))action(p,{guess:word});
          await released(all,'reveal',round);
          eq(a.state.endReason,'Everyone guessed it','early reveal has a real completion reason');
          const old=actor.state.w; action(actor,{next:true});
          if(round<rounds) {
            await released(all,'act',round+1);
            action(actor,{guess:word},{w:old}); await sleep(25);
            eq(a.state.guessed,{},'old turn actions do not enter next turn');
          }
        } else {
          const candidates=game==='pose-party'?active.filter(p=>p.hello.you===a.state.actor):active;
          for(const p of candidates)action(p,{ready:true});
          await until(()=>candidates.every(p=>a.state.ready?.[p.hello.you]),'ready acknowledgements');
          action(watcher,{ready:true}); await sleep(75);
          eq(a.state.phase,'perform','Ready does not shorten the perform deadline');
          ok(!a.state.ready[watcher.hello.you],'watcher cannot claim performance');
          await released(all,'vote',round);
          for(const candidate of a.state.candidates) {
            const self=active.find(p=>p.hello.you===candidate); action(self,{vote:candidate,approve:true});
            await sleep(15); ok(!self.state.myVotes?.[candidate],'self ballot rejected');
            for(const judge of active.filter(p=>p.hello.you!==candidate))action(judge,{vote:candidate,approve:true});
          }
          await released(all,'reveal',round);
          ok(a.state.last.outcomes.every(o=>o.approved&&o.points>=50),'real peer majority awards each shown performer');
          const scores={...a.state.scores}; action(watcher,{next:true}); await sleep(20);
          eq(a.state.phase,'reveal','watcher cannot advance results'); eq(a.state.scores,scores,'results cannot rescore');
          action(a,{next:true});
        }
      }
      await released(all,'done');
      for(const p of all)eq(p.state.scores,a.state.scores,'final match ledger agrees '+game);
      ok(Object.values(a.state.scores).some(n=>n>0),'match was played/scored '+game);
      const final={...a.state.scores}; action(a,{ready:true,guess:'late'}); await sleep(20); eq(a.state.scores,final,'terminal actions are inert');
      // Reconnect the exact seat without duplicating it or erasing results.
      b.ws.close(); await once(b.ws,'close');
      const resumed=await connect(b.name,code,b.hello.seatToken); await until(()=>resumed.state,'resume snapshot');
      eq(resumed.hello.you,b.hello.you,'reconnect keeps identity'); eq(resumed.state.scores,final,'reconnect keeps completed scores');
      active=active.map(p=>p===b?resumed:p);
      b=resumed;
      send(a,{t:'start',game,ready:true}); await until(()=>a.state.instanceId!==initial,'native rematch protocol');
      await released([...active,watcher],game==='charades'?'act':'perform',1);
      ok(Object.values(a.state.scores).every(n=>n===0),'rematch resets match points');
      action(a,{ready:true,guess:'stale'},{i:initial}); await sleep(20);
      ok(Object.values(a.state.scores).every(n=>n===0),'retired match cannot score in rematch');
      send(a,{t:'lobby'}); await until(()=>a.room.game===null,'End to lobby');
      watcher.ws.close(); await once(watcher.ws,'close');
      console.log('CAMERA_ACCEPTANCE_GAME_PASS',game);
    }
    console.log('CAMERA_ACCEPTANCE_PASS:',checks,'production WebSocket assertions; full scored matches, private words, spectator/self/duplicate/stale gates, exact-seat reconnect, rematch, End');
  } finally {
    for(const p of clients)p.ws.terminate();
    if(child.exitCode===null) { child.kill(); await once(child,'exit'); }
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
