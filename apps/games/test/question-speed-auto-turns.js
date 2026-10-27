'use strict';
const assert = require('node:assert/strict');
// Auto promises one turn per player even above the old six/ten-player caps.
// Drive each production deadline to settlement, preserving the sampled order.
for (const [id, count, role] of [['twenty-questions',12,'answerer'],['five-second',20,'performer']]) {
  const game = require('../games/'+id+'/server');
  const roster = Array.from({length:count}, (_,i)=>({id:'p'+i,name:'Player '+i}));
  let now=1000, settings={}, timers=[];
  const ctx = {allPlayers:()=>roster,players:()=>roster,content:()=>({}),settings:()=>settings,
    now:()=>now,later:(ms,fn)=>{timers.push({at:now+ms,fn});},award(){},broadcast(){}};
  const s=game.create(ctx), turns=[];
  assert.equal(s.rounds,count,id+' auto covers every player');
  while(s.phase!=='done') {
    if ((id==='twenty-questions' && s.phase==='play') || (id==='five-second' && s.phase==='answer')) turns.push(s[role]);
    timers.sort((a,b)=>a.at-b.at);const next=timers.shift();assert(next);now=next.at;next.fn();
  }
  assert.equal(turns.length,count);
  assert.deepEqual([...turns].sort(),roster.map(p=>p.id).sort(),id+' every participant gets exactly one turn');
  settings={rounds:2};timers=[];
  assert.equal(game.create(ctx).rounds,2,id+' explicit short match still honored');
}
console.log('QUESTION_SPEED_AUTO_TURNS_PASS: 12-player Questions and 20-player Five Second auto matches give every seat exactly one turn; explicit rounds preserved');
