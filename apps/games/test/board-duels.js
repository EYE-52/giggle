'use strict';
const assert = require('node:assert/strict');
const { validateManifest } = require('../games/_validate');
const reversi = require('../games/reversi/server');
const four = require('../games/four-in-a-row/server');
let checks = 0;
function eq(actual, expected, reason) { assert.deepEqual(actual, expected, reason); checks++; }
function ok(value, reason) { assert(value, reason); checks++; }
function context() {
  const awards = {};
  return { allPlayers: () => [{ id: 'a', name: 'Ada' }, { id: 'b', name: 'Bo' }], award: (pid, n) => { awards[pid] = (awards[pid] || 0) + n; }, awards };
}
function take(game, state, ctx, move) {
  game.onAction(state, ctx, state.seats[state.turn - 1], { ...move, rev: state.rev });
}
function unchanged(game, state, ctx, pid, action, description) {
  const before = JSON.stringify({ state, awards: ctx.awards });
  eq(game.onAction(state, ctx, pid, action), false, description + ' is rejected');
  eq(JSON.stringify({ state, awards: ctx.awards }), before, description + ' has no mutation');
}
for (const game of [reversi, four]) {
  eq(validateManifest(game), { ok: true }, game.id + ' valid registry manifest');
  eq(game.manifest.seats, 2); eq(game.manifest.runtime, { type: 'module', waitForResult: true });
  const ctx = context(), state = game.create(ctx);
  eq(game.view(state, 'watcher').youAre, null); eq(game.view(state, 'watcher').legal, []);
  eq(game.view(state, 'b').legal, [], 'waiting seat has no placement preview');
  const projected = game.view(state, 'a'); projected.board[0] = 99; projected.seats[0] = 'evil';
  eq(state.board[0], 0, 'projection board is detached'); eq(state.seats[0], 'a');
  for (const action of [null, [], {}, {rev:'0'}, {rev:NaN}, {rev:-1}, {rev:0.5}, {rev:999}, {rev:0,place:-1,drop:-1}, {rev:0,place:64,drop:7}, {rev:0,place:1.5,drop:1.5}, {rev:0,place:'19',drop:'0'}]) unchanged(game, state, ctx, 'a', action, 'invalid ' + JSON.stringify(action));
  unchanged(game, state, ctx, 'watcher', { rev:0, resign:true }, 'watcher resignation');
  unchanged(game, state, ctx, 'b', { rev:0, place:19, drop:0 }, 'waiting seat placement');
  take(game, state, ctx, game === reversi ? {place:19} : {drop:0});
  eq(state.rev, 1); eq(state.turnNo, 1);
  unchanged(game, state, ctx, 'a', { rev:0, place:26, drop:1 }, 'duplicate revision');
  unchanged(game, state, ctx, 'b', { rev:0, place:20, drop:1 }, 'other seat stale revision');
  game.onAction(state, ctx, 'a', { resign:true, rev:1 });
  eq(state.phase, 'done'); eq(state.result.winnerPid, 'b'); eq(ctx.awards, {b:300}); eq(game.view(state,'watcher').scores, {a:0,b:300}, 'match scoreboard');
  for (const pid of ['a','b','watcher']) unchanged(game, state, ctx, pid, {resign:true,rev:state.rev}, 'after done');
  const fresh = game.create(ctx); eq(fresh.rev, 0); eq(fresh.phase, 'play'); eq(fresh.result, null);
}
{
  const ctx = context(), s = reversi.create(ctx);
  eq(reversi.view(s,'a').legal, [19,26,37,44], 'four opening captures');
  unchanged(reversi,s,ctx,'a',{place:0,rev:0},'empty but no capture');
  unchanged(reversi,s,ctx,'a',{place:27,rev:0},'occupied square');
  take(reversi,s,ctx,{place:19}); eq(s.lastMove.flips,[27]); eq(reversi.view(s,'a').counts,[4,1]);
}
// Targeted board fixtures prove all eight independent ray directions. Complete
// matches below never mutate state and use only projected legal moves.
{
  const ctx=context(),s=reversi.create(ctx); s.board=Array(64).fill(0);
  for(const [dy,dx] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
    s.board[(3+dy)*8+3+dx]=2; s.board[(3+2*dy)*8+3+2*dx]=1;
  }
  take(reversi,s,ctx,{place:27}); eq(s.lastMove.flips.length,8,'all eight directions flip');
  eq(s.board.filter(x=>x===2).length,0); eq(s.result.winner,1);
}
{
  const ctx=context(),s=reversi.create(ctx);s.board=Array(64).fill(1);s.board[0]=s.board[63]=0;s.board[1]=s.board[62]=2;
  take(reversi,s,ctx,{place:0}); eq(s.phase,'play');eq(s.turn,1,'forced pass automatically returns same player');eq(s.lastMove.passed,2);eq(reversi.view(s,'a').legal,[63]);
  take(reversi,s,ctx,{place:63});eq(s.phase,'done');eq(s.result.counts,[64,0]);eq(ctx.awards,{a:300});
}
{
  const ctx=context(),s=reversi.create(ctx);s.board=Array(64).fill(1);s.board[0]=s.board[63]=0;s.board[1]=2;
  take(reversi,s,ctx,{place:0});eq(s.phase,'done','both no moves ends with an unfilled square');eq(s.board[63],0);eq(ctx.awards,{a:300});
}
let passes=0, ties=0;
for(let seed=1;seed<=30;seed++) {
  const ctx=context(),s=reversi.create(ctx);let n=0,rng=seed;
  while(s.phase==='play'&&n<64) {
    const v=reversi.view(s,s.seats[s.turn-1]);ok(v.legal.length,'active Reversi seat always has a move');
    rng=(Math.imul(rng,1664525)+1013904223)>>>0; const cell=v.legal[rng%v.legal.length];const total=s.board.filter(Boolean).length;
    take(reversi,s,ctx,{place:cell});eq(s.board.filter(Boolean).length,total+1,'one disc added per turn');eq(s.rev,++n);
    if(s.lastMove.passed)passes++;
  }
  eq(s.phase,'done','full legal match ends');const c=reversi.view(s,'a').counts;
  eq(s.result.winner,c[0]===c[1]?null:c[0]>c[1]?1:2);
  if(!s.result.winner) {ties++;eq(ctx.awards,{a:150,b:150});} else eq(ctx.awards,{[s.result.winnerPid]:300});
  const before=JSON.stringify(ctx.awards);reversi.onAction(s,ctx,'a',{resign:true,rev:s.rev});eq(JSON.stringify(ctx.awards),before,'score once after complete');
}
ok(passes>0,'complete matches include automatic passes');
const winSequences = [
  [0,6,1,6,2,5,3], [0,1,0,1,0,1,0],
  [0,1,1,2,4,2,2,3,4,3,5,3,3], [6,5,5,4,2,4,4,3,2,3,1,3,3],
  [0,1,0,1,2,1,2,1],
];
for(const columns of winSequences) {
  const ctx=context(),s=four.create(ctx);
  columns.forEach((drop,i)=>{eq(s.phase,'play','no premature four');take(four,s,ctx,{drop});eq(s.rev,i+1);});
  eq(s.phase,'done');ok(s.winning.length>=4);const winner=s.result.winner;
  ok(s.winning.every(cell=>s.board[cell]===winner));eq(ctx.awards,{[s.result.winnerPid]:300});
}
{
  const ctx=context(),s=four.create(ctx);for(let n=0;n<6;n++)take(four,s,ctx,{drop:0});
  unchanged(four,s,ctx,'a',{drop:0,rev:s.rev},'full column');ok(!four.view(s,'a').legal.includes(0));
}
// This balanced target contains no line of four. Find a gravity-respecting
// alternating sequence to reach it; no fixtures bypass authority for the draw.
const target=Array.from({length:42},(_,i)=>Math.floor(i/7)%2===0?[1,1,2,2,1,1,2][i%7]:[2,2,1,1,2,2,1][i%7]);
const memo=new Set();
function drawPath(heights,side,path) {
  if(path.length===42)return path;
  const key=heights.join(',');if(memo.has(key))return null;memo.add(key);
  for(let col=0;col<7;col++)if(heights[col]<6&&target[(5-heights[col])*7+col]===side) {
    const next=heights.slice();next[col]++;const found=drawPath(next,3-side,[...path,col]);if(found)return found;
  }
  return null;
}
const DRAW_COLUMNS=drawPath(Array(7).fill(0),1,[]);ok(DRAW_COLUMNS,'reachable full draw');
{
  const ctx=context(),s=four.create(ctx);for(const drop of DRAW_COLUMNS){eq(s.phase,'play');take(four,s,ctx,{drop});}
  eq(s.phase,'done');eq(s.result.reason,'draw');eq(s.result.winner,null);eq(s.winning,[]);eq(ctx.awards,{a:150,b:150});eq(s.board,target);
  unchanged(four,s,ctx,'a',{drop:3,rev:s.rev},'full draw already scored');
}
// Standard rules: draw offers, the optional move timer and forfeits.
function timed(settings = {}) {
  const ctx = context(); ctx.t = 1000; ctx.now = () => ctx.t; ctx.settings = () => settings; ctx.broadcasts = 0; ctx.broadcast = () => { ctx.broadcasts++; };
  return ctx;
}
for (const game of [reversi, four]) {
  const first = game === reversi ? {place:19} : {drop:0}, second = game === reversi ? {place:18} : {drop:1};
  ok(game.manifest.settings.some(x => x.key === 'moveTimer' && x.label === 'Move timer' && x.def === 'Off' && x.options.join() === 'Off,30 seconds,60 seconds'), game.id + ' move timer setting');
  let ctx = timed(), s = game.create(ctx);
  eq(s.endsAt, null, 'move timer off by default');
  unchanged(game, s, ctx, 'watcher', {offerDraw:true, rev:0}, 'watcher draw offer');
  game.onAction(s, ctx, 'a', {offerDraw:true, rev:0}); eq(game.view(s,'b').drawOffer, 'a', 'offer visible to the opponent');
  unchanged(game, s, ctx, 'a', {acceptDraw:true, rev:s.rev}, 'accepting your own offer');
  game.onAction(s, ctx, 'b', {declineDraw:true, rev:s.rev}); eq(s.drawOffer, null, 'declined');
  unchanged(game, s, ctx, 'a', {offerDraw:true, rev:s.rev}, 'offer again before a move');
  take(game, s, ctx, first); eq(s.drawBlocked, null, 'a move lets both offer again');
  game.onAction(s, ctx, 'a', {offerDraw:true, rev:s.rev}); take(game, s, ctx, second); eq(s.drawOffer, null, 'a move withdraws the offer');
  game.onAction(s, ctx, 'b', {offerDraw:true, rev:s.rev}); game.onAction(s, ctx, 'a', {acceptDraw:true, rev:s.rev});
  eq(s.phase, 'done'); eq(s.result.reason, 'agreement'); eq(s.result.winner, null); eq(ctx.awards, {a:150, b:150}, 'agreed draw 150 each');
  ctx = timed({moveTimer:'30 seconds'}); s = game.create(ctx);
  eq(s.endsAt, 31000, 'deadline armed at start');
  ctx.t += 25000; take(game, s, ctx, first); eq(s.endsAt, ctx.t + 30000, 'each move re-arms');
  ctx.t += 29999; game.onTick(s, ctx); eq(s.phase, 'play');
  ctx.t += 1; game.onTick(s, ctx); eq(s.phase, 'done'); eq(s.result.reason, 'timeout'); eq(s.result.winnerPid, 'a', 'the player to move loses on time');
  eq(ctx.awards, {a:300}); eq(ctx.broadcasts, 1);
  ctx = timed({moveTimer:'60 seconds'}); s = game.create(ctx); ctx.t += 60000;
  game.onAction(s, ctx, 'a', {...first, rev:0}); eq(s.result.reason, 'timeout', 'a late move loses instead of landing'); eq(s.board.filter(Boolean).length, game === reversi ? 4 : 0);
  ctx = timed(); s = game.create(ctx);
  eq(game.onPlayerGone(s, ctx, 'watcher'), false, 'a watcher leaving changes nothing');
  eq(game.onPlayerGone(s, ctx, 'b'), true); eq(s.result.reason, 'forfeit'); eq(s.result.winnerPid, 'a'); eq(ctx.awards, {a:300});
  eq(game.onPlayerGone(s, ctx, 'a'), false, 'finished games stay finished');
}
console.log(`BOARD_DUELS_PASS: ${checks} rule/revision/projection assertions; 30 complete Reversi matches (${passes} forced passes, ${ties} ties), all four line directions, second-seat win, full-column rejection, legal 42-drop draw`);
module.exports={DRAW_COLUMNS};
