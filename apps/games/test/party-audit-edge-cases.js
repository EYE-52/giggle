'use strict';
// Sparse ballots, translated answers, and interrupted streaks use real server
// actions and timers. Run: node test/party-audit-edge-cases.js
const assert = require('node:assert/strict');
const registry = require('../games/registry');
const { RaceCtx } = require('./party-races');
const players = ['p1','p2','p3','p4'].map(id=>({id,name:id}));
const results = [];
function check(name, fn) { try { fn(); results.push({name,pass:true}); } catch (e) { results.push({name,pass:false,error:e.message}); } }
for (const id of ['compliment-battle','roast-toast']) check(id+' sole author completes without waiting for an impossible self-vote',()=>{
  const def=registry.get(id),ctx=new RaceCtx(players,{rounds:1}),s=def.create(ctx);
  const author=players.find(p=>p.id!==s.target).id;
  def.onAction(s,ctx,author,{entry:'A kind, funny note.'});
  ctx.fireTimer(ctx.lastTimer());
  assert.equal(s.phase,'vote');
  def.onAction(s,ctx,author,{vote:0});
  assert.equal(s.votes[author],undefined,'self vote remains rejected');
  const voters=players.filter(p=>p.id!==author&&(id!=='roast-toast'||p.id!==s.target));
  voters.forEach(p=>def.onAction(s,ctx,p.id,{vote:0}));
  if(id==='roast-toast')def.onAction(s,ctx,s.target,{pick:0});
  assert.equal(s.phase,'reveal');
  const awarded=JSON.stringify(ctx.awards);
  def.onAction(s,ctx,author,{vote:0});
  assert.equal(JSON.stringify(ctx.awards),awarded,'late duplicate cannot award twice');
});
check('lyric-fill preserves Hindi, Japanese, Cyrillic, and combining accents',()=>{
  for (const [answer,wrong,equivalent] of [['दिलवाले','नमस्ते','दिलवाले'],['ありがとう','さようなら','ありがとう'],['любовь','привет','любовь'],['café','bananas','cafe\u0301']]){
    const def=registry.get('lyric-fill'),ctx=new RaceCtx(players,{rounds:1});
    ctx.content=()=>({lines:[{before:'A local song',after:'',answer,song:'Local QA',artist:'Fixture'}]});
    const s=def.create(ctx);
    for(const p of players)def.onAction(s,ctx,p.id,{text:p.id==='p1'?wrong:p.id==='p4'?'!!!':equivalent});
    assert.equal(s.last.verdicts.p1.verdict,'miss',answer+' unrelated guess must miss');
    assert.equal(s.last.verdicts.p2.verdict,'exact',answer+' correct guess must match');
    assert.equal(s.last.verdicts.p4.verdict,'miss',answer+' punctuation cannot match');
  }
});
for(const id of ['most-likely','never-ever','pick-one','would-you-rather'])check(id+' skipped vote breaks consecutive streak',()=>{
  const def=registry.get(id),ctx=new RaceCtx(players,{rounds:3}),s=def.create(ctx);
  const vote=p=>({vote:id==='never-ever'?'not':id==='most-likely'?(p.id==='p2'?'p3':'p2'):'a'});
  players.forEach(p=>def.onAction(s,ctx,p.id,vote(p)));
  assert.equal(s.streaks.p1,1);
  def.onAction(s,ctx,s.hostId,{next:true});
  players.slice(1).forEach(p=>def.onAction(s,ctx,p.id,vote(p)));
  ctx.fireTimer(ctx.lastTimer());
  assert.equal(s.streaks.p1,0,'timeout resets an interrupted streak');
  def.onAction(s,ctx,s.hostId,{next:true});
  const before=ctx.awards.p1;
  players.forEach(p=>def.onAction(s,ctx,p.id,vote(p)));
  assert.equal(ctx.awards.p1-before,100,'returning win starts at base points');
});
console.log(JSON.stringify({checks:results.length,passed:results.filter(r=>r.pass).length,results},null,2));
if(results.some(r=>!r.pass))process.exitCode=1;
