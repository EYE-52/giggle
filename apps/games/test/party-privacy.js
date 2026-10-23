'use strict';
// These inputs reproduced author leaks, non-emoji letters, and a setting
// that timed the spin screen instead of the landed dare.
const assert=require('node:assert/strict');
const roster=['p1','p2','p3','p4'].map(id=>({id,name:id}));
function ctx(settings={}) {
  return {time:1000,timers:[],awards:{},allPlayers:()=>roster,players:()=>roster,
    settings:()=>settings,content:()=>({}),hostId:()=>roster[0].id,
    now(){return this.time;},later(ms,fn){this.timers.push(fn);},broadcast(){},
    award(pid,pts){this.awards[pid]=(this.awards[pid]||0)+pts;}};
}
const failures=[];
function check(name,fn){try{fn();}catch(error){failures.push(name+': '+error.message.split('\n')[0]);}}
check('Hot Takes author identifiers',()=>{
  const g=require('../games/hot-takes/server'),c=ctx(),s=g.create(c);
  for(const p of roster)g.onAction(s,c,p.id,{take:'A secret take from '+p.id});
  const v=g.view(s,'watch');
  const inferred=v.order.map(tid=>roster.find(p=>tid==='t-'+p.id)?.id).filter(Boolean);
  assert.equal(inferred.length,0,'observer must not recover authors from anonymous take IDs');
  assert.equal(v.current.author,null);
  const author=s.takes.find(t=>t.tid===v.current.tid).author;
  assert.equal(g.view(s,author).current.mine,true,'author still sits out their own take');
});
check('Punchline submission-order identifiers',()=>{
  const real=Math.random;Math.random=()=>0;
  try {
    const g=require('../games/funny-answer/server'),c=ctx(),s=g.create(c),submitted=[];
    for(const p of roster){g.onAction(s,c,p.id,{answer:'Secret answer '+p.id});if(s.phase==='answer')submitted.push(...g.view(s,'watch').submitted.filter(pid=>!submitted.includes(pid)));}
    submitted.push(...roster.map(p=>p.id).filter(pid=>!submitted.includes(pid)));
    const ballot=g.view(s,'watch').options;
    const recovered=ballot.map(o=>submitted[Number(o.aid.slice(1))]);
    const actual=ballot.map(o=>s.options.find(x=>x.aid===o.aid).pid);
    assert.notDeepEqual(recovered,actual,'prior public submission order must not recover anonymous authors');
    for(const p of roster)assert.equal(g.view(s,p.id).myEntry,s.options.find(o=>o.pid===p.id).aid,'own entry exclusion retained');
  } finally {Math.random=real;}
});
check('Emoji Story letter validation',()=>{
  const g=require('../games/emoji-story/server'),c=ctx(),s=g.create(c);
  g.onAction(s,c,s.director,{emoji:'गुप्त कहानी'});
  assert.equal(s.phase,'emoji','letters from any language must not expose the phrase as an emoji story');
  g.onAction(s,c,s.director,{emoji:'🌊🐟🎉'});
  assert.equal(s.phase,'guess','real emoji story still accepted');
  assert.equal(g.view(s,'watch').phrase,'','watcher secret remains hidden');
});
check('Dare Roulette configured seconds',()=>{
  const g=require('../games/dare-roulette/server');
  for(const seconds of [10,90,180]) {
    const c=ctx({dareSeconds:seconds}),s=g.create(c);
    g.onAction(s,c,'p1',{spin:true});
    assert.equal(s.phase,'perform');
    assert.equal(s.endsAt-c.now(),seconds*1000,'landed dare must use the configured duration');
    g.onAction(s,c,s.victim,{ready:true});
    assert.equal(s.phase,'verdict','The actor opens judging after performing');
    assert.equal(s.endsAt-c.now(),25000,'Judging has a separate full interval');
  }
});
assert.deepEqual(failures,[], 'Reproduced party privacy and configuration bugs');
console.log('PARTY_PRIVACY_PASS: author leaks blocked, Unicode letters rejected, configured dare duration used');
