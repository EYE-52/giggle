'use strict';
// Compare a delayed deadline callback with a legal action received at the
// same deadline. Both must close the old window with exactly the same result.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../games/registry');
const PLAYERS = ['p1','p2','p3','p4'].map(id => ({id,name:id}));
class Ctx {
  constructor() { this.time=1000; this.timers=[]; this.awards={}; }
  allPlayers() { return PLAYERS.slice(); } players() { return this.allPlayers(); }
  hostId() { return 'p1'; } settings() { return {rounds:2}; }
  content(id) { return JSON.parse(fs.readFileSync(path.join(__dirname,'../locales/en',id+'.json'),'utf8')); }
  now() { return this.time; } later(ms,fn) { this.timers.push({at:this.time+ms,fn}); }
  broadcast() {} award(pid,pts) { this.awards[pid]=(this.awards[pid]||0)+pts; }
}
function legal(id,s,pid) {
  const phase=s.phase;
  if (id==='would-you-rather'||id==='pick-one') return {vote:'a'};
  if (id==='never-ever') return {vote:'not'};
  if (id==='most-likely') return {vote:PLAYERS.find(p=>p.id!==pid).id};
  if (id==='rank-it') return {order:[0,1,2,3,4]};
  if (id==='rapid-polls') return phase==='pose' ? {pose:{q:'LateMarker question?',options:['Yes','No','Sometimes']}} : {vote:0};
  if (id==='hot-takes') return phase==='submit' ? {take:'LateMarker take'} : s.takes.find(t=>t.tid===s.order[s.index])?.author!==pid ? {vote:'agree'} : null;
  if (id==='funny-answer') return phase==='answer' ? {answer:'LateMarker answer '+pid} : {vote:s.options.find(o=>o.pid!==pid).aid};
  if (id==='bluff') return phase==='bluff' ? {fake:'LateMarker bluff '+pid} : {pick:s.options.find(o=>o.pid===null).oid};
  if (id==='two-truths') return phase==='write' ? pid===s.subject ? {statements:['LateMarker one','Two','Three'],lie:2} : null : pid!==s.subject ? {vote:2} : null;
  if (id==='story-builder') return phase==='build' ? pid===s.turn ? {line:'LateMarker line '+pid} : null : {vote:s.lines.findIndex(l=>l.pid!==pid)};
  if (id==='emoji-story') return phase==='emoji' ? pid===s.director ? {emoji:'🌊🐟🎉'} : null : pid!==s.director ? {guess:s.phrase} : null;
  if (id==='five-second') return phase==='answer' ? pid===s.performer ? {answers:'LateMarker, second, third'} : null : pid!==s.performer ? {vote:'pass'} : null;
  if (id==='compliment-battle'||id==='roast-toast') {
    if (phase==='write') return pid!==s.target ? {entry:'LateMarker note '+pid} : null;
    if (id==='roast-toast'&&pid===s.target) return {pick:0};
    return {vote:s.order.findIndex(author=>author!==pid)};
  }
  if (id==='truth-dare') return phase==='choose' ? pid===s.target ? {deck:'wild',kind:'dare'} : null : phase==='perform' ? pid===s.target ? {ready:true} : null : pid!==s.target ? {vote:'yes'} : null;
  if (id==='dare-roulette') return phase==='spin' ? {spin:true} : phase==='perform' ? pid===s.victim ? {ready:true} : null : pid!==s.victim ? {vote:'done'} : null;
  if (id==='trivia') return {pick:s.question.answer};
  if (id==='lyric-fill') return {text:s.line.answer};
  throw new Error('Unknown game '+id);
}
function make(id,phase) {
  const def=registry.get(id),ctx=new Ctx(),s=def.create(ctx);
  let attempts=0;
  while(s.phase!==phase&&attempts++<30) {
    const prior=s.phase;
    if(prior==='spin'&&id==='truth-dare') {
      const timer=ctx.timers.find(t=>t.at===s.endsAt);ctx.time=timer.at;timer.fn();
    } else {
      for(const p of PLAYERS) {
        if(s.phase!==prior)break;
        const a=legal(id,s,p.id);if(a)def.onAction(s,ctx,p.id,a);
      }
    }
  }
  assert.equal(s.phase,phase,id+' setup reaches '+phase);
  return {def,ctx,s};
}
const snapshot=s=>JSON.stringify(s,(k,v)=>typeof v==='function'?'[fn]':typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(v)?'[anonymous]':v);
const WINDOWS={
  'would-you-rather':['vote'],'never-ever':['vote'],'most-likely':['vote'],'pick-one':['vote'],'rank-it':['rank'],
  'rapid-polls':['pose','vote'],'hot-takes':['submit','vote'],'funny-answer':['answer','vote'],'bluff':['bluff','pick'],
  'two-truths':['write','vote'],'story-builder':['build','vote'],'emoji-story':['emoji','guess'],'five-second':['answer','vote'],
  'compliment-battle':['write','vote'],'roast-toast':['write','vote'],'truth-dare':['choose','perform','vote'],
  'dare-roulette':['perform','verdict'],'trivia':['answer'],'lyric-fill':['fill'],
};
const realRandom=Math.random;
let windows=0;
const failures=[];
try {
  Math.random=()=>0;
  for(const [id,phases] of Object.entries(WINDOWS)) for(const phase of phases) {
    try {
    const expected=make(id,phase),late=make(id,phase);
    const expectedTimer=expected.ctx.timers.findLast(t=>t.at===expected.s.endsAt);
    const delayed=late.ctx.timers.findLast(t=>t.at===late.s.endsAt);
    assert(expectedTimer&&delayed,id+' '+phase+' has a deadline callback');
    expected.ctx.time=expected.s.endsAt;expectedTimer.fn();
    late.ctx.time=late.s.endsAt;
    const actor=PLAYERS.find(p=>legal(id,late.s,p.id));
    const a=legal(id,late.s,actor.id);
    late.def.onAction(late.s,late.ctx,actor.id,a);
    assert.equal(snapshot(late.s),snapshot(expected.s),id+' '+phase+' late action must produce the timeout result');
    assert.deepEqual(late.ctx.awards,expected.ctx.awards,id+' '+phase+' late action cannot add points');
    const once=snapshot(late.s),awards={...late.ctx.awards};delayed.fn();
    assert.equal(snapshot(late.s),once,id+' '+phase+' delayed callback cannot alter closed window');
    assert.deepEqual(late.ctx.awards,awards,id+' '+phase+' rewards exactly once');
    windows++;
    } catch (error) { failures.push(id+' '+phase+': '+error.message.split('\n')[0]); }
  }
} finally { Math.random=realRandom; }
assert.deepEqual(failures,[], 'Expired windows must match the authoritative timeout');
console.log('PARTY_DEADLINE_PASS: '+windows+' expired windows match timeout results and rewards exactly once');
