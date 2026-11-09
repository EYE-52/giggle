'use strict';
// Real server moves, shipped view, controlled presentation clock. No rules are
// duplicated here: every path's destination is checked against server authority.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {rig} = require('./new-games-b5-view');
const {rig: ludoRig} = require('./ludo-fleet-view');
let checks = 0;
const eq = (a,b,n) => { assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),n); checks++; };
const ok = (v,n) => { assert(v,n); checks++; };
function roll(r, die) {
  const original = crypto.randomInt;
  try { crypto.randomInt = () => die; r.def.onAction(r.state,r.ctx,r.state.seats[r.state.turn],{roll:true,rev:r.state.rev}); }
  finally { crypto.randomInt = original; }
}
function pose(r,side=0) {
  const p=r.el.querySelector(`[data-sl-pawn="${side}"]`), move=p.querySelector('.sl-pawn-motion');
  const pair=n=>n.getAttribute('transform').match(/translate\(([-.\d]+) ([-.\d]+)\)/).slice(1).map(Number);
  const a=pair(p),b=move.getAttribute('transform')?pair(move):[0,0];return a.map((v,i)=>v+b[i]);
}
for (const exactFinish of [false,true]) {
 const r=rig('snakes-ladders',{reduced:false});
 for (let from=0;from<100;from++) for (let die=1;die<=6;die++) {
  r.fresh();r.view.dispose(r.el);r.view.mount(r.el,r.api);
  r.state.positions.a=from;r.state.exactFinish=exactFinish;r.render();roll(r,die);r.render();
  const m=r.state.lastMove, squares=r.raceSquares(from,die,100,exactFinish);
  eq(squares[0],from,'path starts at the authoritative previous square');
  eq(squares.at(-1),m.landing,'last hop is the server landing, including exact-finish bounce');
  for(let i=1;i<squares.length;i++)eq(Math.abs(squares[i]-squares[i-1]),1,'every hop visits the next square');
  for(let i=0;i<squares.length;i++) {
    // Inspect the live pawn at the start of each hop, before any transport.
    r.el._b5.motion.stop();
    const track=r.trailMotion(r.el,r.el._b5.S);track.frame(500+i*130);
    const expected=r.point(squares[i]);expected[0]-=12;
    eq(pose(r),expected,'rendered square order matches the actual board path');
  }
  const track=r.trailMotion(r.el,r.el._b5.S);track.frame(track.duration);
  const target=r.point(r.state.positions.a);target[0]-=12;
  eq(pose(r),target,'last rendered position equals server state');
  eq(r.el.querySelectorAll('[data-sl-pawn]').length,2,'one pawn per active seat');
  r.view.dispose(r.el);eq(r.frames.size+r.timers.size,0,'unmount leaves no scheduled work');
 }
}
{
  const r=rig('snakes-ladders',{reduced:false});r.render();roll(r,3);r.render();
  r.advance(600);const retired=[...r.frames.values()][0];ok(retired,'ladder move owns one frame');
  const movingNode=r.el.querySelector('[data-sl-pawn="0"]');r.render();ok(r.el.querySelector('[data-sl-pawn="0"]')===movingNode,'heartbeat keeps the running pawn');eq(r.frames.size,1,'heartbeat keeps just one RAF');
  roll(r,4);r.render('a');const latest=r.el.querySelector('[data-sl-pawn="0"]');ok(latest!==movingNode,'new revision fast-forwards old SVG');
  retired(99999);ok(r.el.querySelector('[data-sl-pawn="0"]')===latest,'retired frame cannot touch new state');
  r.advance(5000);eq(r.el.querySelector('[data-sl-pawn="0"]').getAttribute('data-square'),String(r.state.positions.a),'interruption preserves server square');
  r.render('a','one',{audioBaseline:true});eq(r.frames.size,0,'reconnect cancels presentation');
  eq(r.el.querySelector(`[data-face="${r.state.die}"]`).getAttribute('opacity'),'1','reconnect restores the actual die');
  r.view.dispose(r.el);eq(r.timers.size+r.frames.size,0,'interrupted mount disposes all work');
}
{
  const r=rig('snakes-ladders',{reduced:false});r.state.positions.a=21;r.render();roll(r,2);r.render();
  r.el._b5.motion.stop();const snake=r.el.querySelector('[data-snake="23"]').querySelector('.sl-snake-body');
  const sampled=[];snake.getTotalLength=()=>200;snake.getPointAtLength=n=>{sampled.push(n);return{x:100+n,y:200+n};};
  const track=r.trailMotion(r.el,r.el._b5.S);track.frame(500+2*130+180+400);
  eq(sampled,[100],'snake slide samples its drawn curve at half its length');eq(pose(r),[200,300],'pawn rides the actual centre of the snake');
  track.frame(track.duration);const expected=r.point(r.state.positions.a);expected[0]-=12;eq(pose(r),expected,'curve ride ends in its exact server seat slot');r.view.dispose(r.el);
}
{
  const r=ludoRig('ludo');r.state.phase='move';r.state.die=6;r.state.pawns[0][0]=10;r.render();
  const original=r.el.querySelector('#ld-pawn-0-0').getAttribute('transform');r.action({move:0});
  r.view.render(r.el,{...r.S(),preparing:true},r.api);
  eq(r.el.querySelector('#ld-pawn-0-0').getAttribute('transform'),original,'preparation cannot flash the Ludo destination');r.render();
  const t=r.el._ludo.tracks.find(t=>!t.captured);
  eq(t.points[0],[Number(original.match(/translate\(([-.\d]+)/)[1]),Number(original.match(/translate\([-.\d]+ ([-.\d]+)/)[1])],'released Ludo hop starts at previous server square');
  r.view.dispose(r.el);
}
{
  const r=rig('snakes-ladders',{reduced:false});r.state.positions.a=98;r.render();roll(r,4);r.render();
  eq(r.results,[],'win presentation waits for the final hop and confetti');ok(r.el.querySelector('.bk-final').hidden,'result cannot cover final movement');
  r.render('a','one',{audioBaseline:true});r.advance(5000);eq(r.results,[],'reconnect during final animation stays quiet');
  eq(r.el.querySelector('[data-sl-pawn="0"]').getAttribute('data-square'),'100','reconnect final position is server square 100');r.view.dispose(r.el);
}
for(const id of ['snakes-ladders','pig-dice']) {
  const r=rig(id,{reduced:true});r.render();roll(r,3);r.render();
  ok(r.el._b5.animating,'reduced motion runs only a short fade');r.advance(120);ok(!r.el._b5.animating,'fade ends in 120ms');
  const face=r.el.querySelector('[data-face="3"]');eq(face.getAttribute('opacity'),'1','reduced-motion die shows real value');
  r.view.dispose(r.el);eq(r.frames.size+r.timers.size,0,'reduced-motion cleanup');
}
{
  const r=ludoRig('ludo');r.state.phase='move';r.state.die=6;r.state.pawns[0][0]=48;r.render();r.action({move:0});r.render();
  const t=r.el._ludo.tracks.find(t=>!t.captured);eq(t.points.length,7,'Ludo six walks all six squares across the home-lane turn');
  r.advance(130);const motion=r.el.querySelector('#ld-pawn-0-0').querySelector('.ld-pawn-motion');ok(motion.getAttribute('transform'),'Ludo paints a hop transform');
  r.advance(2000);eq(motion.getAttribute('transform'),'translate(0 0) scale(1 1)','Ludo lands at authority');r.view.dispose(r.el);eq(r.frames.size+r.timers.size,0,'Ludo cleanup');
}
console.log(`BOARD_MOTION_PASS: ${checks} assertions; 1200 server rolls, hop order, end state, bounce, interruption, heartbeat, reconnect, Ludo home lane, reduced motion and disposal`);
