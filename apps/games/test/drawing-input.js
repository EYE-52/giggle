'use strict';
const assert = require('node:assert/strict');
const doodle = require('../games/doodle-guess/server');
const phone = require('../games/draw-phone/server');
const roster = ['a','b','c'].map(id => ({id,name:id}));
const ctx = { allPlayers:()=>roster, players:()=>roster, settings:()=>({rounds:1}), content:()=>({words:['apple','rocket','pizza']}), now:()=>1000, later:()=>()=>{}, award() {}, broadcast() {} };
const ds = doodle.create(ctx);
doodle.onAction(ds,ctx,ds.drawer,{choose:ds.choices[0]});
const ps = phone.create(ctx);
for (const p of roster) phone.onAction(ps,ctx,p.id,{phrase:'private '+p.id});
let gesture = 0;
for (const [game,state,pid,strokes] of [[doodle,ds,ds.drawer,ds.strokes],[phone,ps,'a',ps.drawings.a.strokes]]) {
  const meta = () => ({inkNonce:game.view(state,pid).inkNonce,inkRevision:game.view(state,pid).inkRevision,gestureId:++gesture,chunk:0,finished:true});
  for (const pts of [[null,[0,0]], [{x:1,y:1},[0,0]], [[NaN,0],[1,1]], [['0',0],[1,1]], [[0],[1,1]], [[0,0],[]], [[,0],[1,1]]]) {
    assert.doesNotThrow(()=>game.onAction(state,ctx,pid,{stroke:{pts,color:'#111',size:4},...meta()}),'malformed point arrays never throw');
    assert.equal(strokes.length,0,'malformed strokes are rejected atomically');
  }
  game.onAction(state,ctx,pid,{stroke:{pts:[[-1,2],[0.2,0.3]],color:'#ffbe35',size:50},...meta()});
  const {tool,gestureId,chunk,...normalized}=strokes[0];
  assert.deepEqual(normalized,{pts:[[0,1],[0.2,0.3]],color:'#ffbe35',size:30});
  if(game===phone) assert.equal(tool,undefined,'Draw Phone format stays unchanged');
}
console.log('DRAWING INPUT PASS: both games reject malformed points and keep valid bounded strokes');
