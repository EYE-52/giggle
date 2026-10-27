'use strict';
const assert = require('node:assert/strict');
const checkers = require('../games/checkers/server');
const kalah = require('../games/kalah/server');
const fs = require('node:fs');
function context(id) {
  const ctx = { awards: {}, now: () => 1000000, allPlayers: () => [{ id: 'a', name: 'Alex' }, { id: 'b', name: 'Bo' }],
    content: () => JSON.parse(fs.readFileSync(require.resolve('../locales/en/' + id + '.json'), 'utf8')),
    award: (pid, n) => { ctx.awards[pid] = (ctx.awards[pid] || 0) + n; } };
  return ctx;
}
function setup(def, pieces) {
  const ctx = context(def.id), s = def.create(ctx);
  if (pieces && def === checkers) { s.board.fill(0); for (const [i, p] of Object.entries(pieces)) s.board[i] = p; s.repetition = {}; }
  if (pieces && def === kalah) { s.pits.fill(0); for (const [i, n] of Object.entries(pieces)) s.pits[i] = n; s.pits[13] += 48 - s.pits.reduce((a, b) => a + b, 0); }
  return { ctx, s };
}
function move(def, s, ctx, action, pid = s.seats[s.turn]) { def.onAction(s, ctx, pid, { ...action, revision: s.revision }); }
function unchanged(def, run, action, pid) { const before = JSON.stringify(run.s); def.onAction(run.s, run.ctx, pid, action); assert.equal(JSON.stringify(run.s), before); }
for (const def of [checkers, kalah]) {
  const r = setup(def);
  assert.equal(def.manifest.seats, 2); assert.equal(def.manifest.players.max, 24);
  assert.equal(def.manifest.runtime.waitForResult, true);
  assert.deepEqual(r.s.seats, ['a', 'b']); assert.equal(def.view(r.s, 'watcher').youAre, null);
  const valid = def === checkers ? { from: 40, to: 33 } : { pit: 2 };
  for (const bad of [null, [], {}, { ...valid }, { ...valid, revision: -1 }, { ...valid, revision: '0' }, { ...valid, revision: NaN }, { ...valid, revision: Infinity }]) unchanged(def, r, bad, 'a');
  unchanged(def, r, { ...valid, revision: 0 }, 'watcher'); unchanged(def, r, { ...valid, revision: 0 }, 'b');
  move(def, r.s, r.ctx, valid); assert.equal(r.s.revision, 1);
  unchanged(def, r, { ...valid, revision: 0 }, 'a');
  move(def, r.s, r.ctx, { resign: true }, 'b'); assert.equal(r.s.phase, 'done'); assert.equal(r.ctx.awards.a, 300); assert.deepEqual(def.view(r.s, 'watcher').scores, { a: 300, b: 0 });
  const end = JSON.stringify(r.s); for (let i = 0; i < 10; i++) move(def, r.s, r.ctx, { resign: true }, 'a');
  assert.equal(JSON.stringify(r.s), end); assert.equal(r.ctx.awards.a, 300); assert.equal(def.view(r.s, 'a').endsAt, null);
  assert.equal(def.view(r.s, 'a').legal.length || Object.keys(def.view(r.s, 'a').legal).length, 0);
}
{
  const { s } = setup(checkers);
  assert.equal(s.board.filter(p => p === 1).length, 12); assert.equal(s.board.filter(p => p === 2).length, 12);
  assert.equal(Object.values(checkers.view(s, 'a').legal).flat().length, 7);
  s.board.forEach((p, i) => { if (p) assert.equal((Math.floor(i / 8) + i % 8) % 2, 1); });
}
{
  const r = setup(checkers, { 49: 1, 42: 2, 28: 2, 55: 1, 46: 2, 7: 2 });
  const legal = checkers.view(r.s, 'a').legal; assert.deepEqual(legal[49], [{ to: 35, capture: 42 }]);
  unchanged(checkers, r, { from: 55, to: 48, revision: 0 }, 'a');
  move(checkers, r.s, r.ctx, { from: 49, to: 35 }); assert.equal(r.s.turn, 0); assert.equal(r.s.forced, 35);
  assert.deepEqual(Object.keys(checkers.view(r.s, 'a').legal), ['35']);
  unchanged(checkers, r, { from: 55, to: 37, revision: r.s.revision }, 'a');
  unchanged(checkers, r, { from: 35, to: 21, revision: 0 }, 'a');
  move(checkers, r.s, r.ctx, { from: 35, to: 21 }); assert.equal(r.s.turn, 1); assert.equal(r.s.forced, null); assert.equal(r.s.board[42], 0); assert.equal(r.s.board[28], 0);
}
{
  const r = setup(checkers, { 44: 1, 35: 2, 37: 2, 17: 2, 7: 2 });
  assert.deepEqual(checkers.view(r.s, 'a').legal[44], [{ to: 26, capture: 35 }, { to: 30, capture: 37 }]);
  move(checkers, r.s, r.ctx, { from: 44, to: 30 }); assert.equal(r.s.turn, 1, 'shorter capture branch is legal');
}
{
  const r = setup(checkers, { 17: 1, 10: 2, 12: 2 });
  move(checkers, r.s, r.ctx, { from: 17, to: 3 });
  assert.equal(r.s.board[3], 3); assert.equal(r.s.forced, null); assert.equal(r.s.turn, 1); assert.equal(r.s.board[12], 2, 'crowning stops even when a new king could jump backwards');
  assert.equal(r.s.lastMove.crowned, true);
}
{
  const r = setup(checkers, { 26: 1, 35: 2, 1: 2 });
  assert(!checkers.view(r.s, 'a').legal[26].some(m => m.to === 44), 'men cannot jump backwards');
  r.s.board[26] = 3;
  assert(checkers.view(r.s, 'a').legal[26].some(m => m.to === 44), 'king can jump backwards');
  r.s.board.fill(0); r.s.board[42] = 3; r.s.board[24] = 2;
  assert(!checkers.view(r.s, 'a').legal[42].some(m => m.to === 24 || m.to === 17), 'king cannot fly');
  for (const from of [-1, 64, 1.5, '42', NaN, Infinity]) unchanged(checkers, r, { from, to: 33, revision: 0 }, 'a');
}
{
  const r = setup(checkers, { 17: 1, 56: 2 }); move(checkers, r.s, r.ctx, { from: 17, to: 8 });
  assert.equal(r.s.phase, 'done'); assert.equal(r.s.result.winner, 0, 'immobile opponent loses with a piece remaining');
}
{
  const r = setup(checkers, { 57: 3, 3: 4 });
  for (let i = 0; i < 2; i++) for (const [from, to] of [[57, 48], [3, 10], [48, 57], [10, 3]]) move(checkers, r.s, r.ctx, { from, to });
  // Custom fixtures have no recorded opening, so the next repetition establishes three visits.
  if (r.s.phase !== 'done') for (const [from, to] of [[57, 48], [3, 10], [48, 57], [10, 3]]) { if (r.s.phase !== 'done') move(checkers, r.s, r.ctx, { from, to }); }
  assert.equal(r.s.result.reason, 'repetition'); assert.deepEqual(r.ctx.awards, { a: 150, b: 150 });
}
{
  const r = setup(checkers, { 49: 3, 14: 4 }); r.s.noProgress = 79;
  move(checkers, r.s, r.ctx, { from: 49, to: 40 }); assert.equal(r.s.result.reason, 'no-progress');
  const man = setup(checkers, { 49: 1, 14: 4 }); man.s.noProgress = 79;
  move(checkers, man.s, man.ctx, { from: 49, to: 40 }); assert.equal(man.s.noProgress, 0); assert.equal(man.s.phase, 'play');
}
{
  const r = setup(checkers); move(checkers, r.s, r.ctx, { offerDraw: true }); assert.equal(r.s.drawOffer, 'a');
  unchanged(checkers, r, { acceptDraw: true, revision: 1 }, 'a');
  move(checkers, r.s, r.ctx, { acceptDraw: true }, 'b'); assert.equal(r.s.result.reason, 'agreement');
  const v = checkers.view(r.s, 'a'); v.board.fill(0); v.seats[0] = 'hacked'; assert.equal(r.s.seats[0], 'a'); assert(r.s.board.some(Boolean));
}
{
  const r = setup(kalah); move(kalah, r.s, r.ctx, { pit: 2 });
  assert.equal(r.s.turn, 0); assert.equal(r.s.lastMove.extra, true); assert.deepEqual(r.s.lastMove.steps, [3, 4, 5, 6]);
  assert.equal(r.s.pits[6], 1); assert.equal(r.s.pits.reduce((a, b) => a + b), 48);
}
{
  const r = setup(kalah, { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 16, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1 });
  move(kalah, r.s, r.ctx, { pit: 5 }); assert(!r.s.lastMove.steps.includes(13)); assert.equal(r.s.lastMove.steps.filter(i => i === 6).length, 2); assert.equal(r.s.pits.reduce((a, b) => a + b), 48);
}
{
  const r = setup(kalah, { 0: 2, 1: 1, 3: 1, 7: 2, 10: 5, 6: 20 });
  move(kalah, r.s, r.ctx, { pit: 1 }); assert.deepEqual(r.s.lastMove.captures, [2, 10]); assert.equal(r.s.pits[6], 26); assert.equal(r.s.pits[2], 0); assert.equal(r.s.pits[10], 0);
  const empty = setup(kalah, { 0: 2, 1: 1, 7: 2 }); move(kalah, empty.s, empty.ctx, { pit: 1 });
  assert.equal(empty.s.pits[2], 1); assert.deepEqual(empty.s.lastMove.captures, []);
}
{
  const r = setup(kalah, { 5: 1, 7: 2, 12: 3, 6: 22, 13: 20 });
  move(kalah, r.s, r.ctx, { pit: 5 }); assert.equal(r.s.phase, 'done'); assert.equal(r.s.lastMove.extra, false); assert.equal(r.s.pits[6], 23); assert.equal(r.s.pits[13], 25); assert.equal(r.s.result.winner, 1);
  assert(r.s.pits.every((n, i) => i === 6 || i === 13 || n === 0));
  const tie = setup(kalah, { 5: 1, 7: 1, 6: 23, 13: 23 }); move(kalah, tie.s, tie.ctx, { pit: 5 });
  assert.equal(tie.s.pits[6], 24); assert.equal(tie.s.pits[13], 24); assert.equal(tie.s.result.winner, null); assert.deepEqual(tie.ctx.awards, { a: 150, b: 150 });
}
{
  const r = setup(kalah, { 0: 2, 4: 5, 7: 1, 9: 2 }); r.s.turn = 1;
  move(kalah, r.s, r.ctx, { pit: 7 }); assert.deepEqual(r.s.lastMove.captures, [8, 4]); assert.equal(r.s.pits[4], 0);
  const wrap = setup(kalah, { 0: 2, 7: 1, 12: 8 }); wrap.s.turn = 1; move(kalah, wrap.s, wrap.ctx, { pit: 12 });
  assert(!wrap.s.lastMove.steps.includes(6)); assert.equal(wrap.s.lastMove.steps[0], 13); assert.equal(wrap.s.pits.reduce((a, b) => a + b), 48);
}
{
  const r = setup(kalah);
  for (const pit of [6, 13, -1, 14, 0.5, '0', null, NaN, Infinity]) unchanged(kalah, r, { pit, revision: 0 }, 'a');
  const v = kalah.view(r.s, 'a'); v.pits[0] = 99; v.seats[0] = 'hacked'; assert.equal(r.s.pits[0], 4); assert.equal(r.s.seats[0], 'a');
}
// Standard rules for both: draw offers, the optional move timer, forfeits.
for (const def of [checkers, kalah]) {
  const valid = def === checkers ? { from: 40, to: 33 } : { pit: 0 };
  const reply = def === checkers ? { from: 17, to: 24 } : { pit: 7 };
  const setting = def.manifest.settings.find(x => x.key === 'moveTimer');
  assert.deepEqual([setting.label, setting.def, setting.options], ['Move timer', 'Off', ['Off', '30 seconds', '60 seconds']]);
  let r = setup(def);
  assert.equal(r.s.endsAt, null, 'timer off by default');
  move(def, r.s, r.ctx, { offerDraw: true }); assert.equal(def.view(r.s, 'b').drawOffer, 'a');
  move(def, r.s, r.ctx, { declineDraw: true }, 'b'); assert.equal(r.s.drawOffer, null);
  unchanged(def, r, { offerDraw: true, revision: r.s.revision }, 'a');
  move(def, r.s, r.ctx, valid); move(def, r.s, r.ctx, { offerDraw: true }, 'a'); assert.equal(r.s.drawOffer, 'a', 'a move lifts the block');
  move(def, r.s, r.ctx, reply); assert.equal(r.s.drawOffer, null, 'a move withdraws the offer');
  move(def, r.s, r.ctx, { offerDraw: true }, 'b'); move(def, r.s, r.ctx, { acceptDraw: true }, 'a');
  assert.equal(r.s.result.reason, 'agreement'); assert.deepEqual(r.ctx.awards, { a: 150, b: 150 });
  r = setup(def); let t = 5000; r.ctx.now = () => t; r.ctx.settings = () => ({ moveTimer: '30 seconds' }); r.ctx.broadcast = () => { r.ctx.broadcasts = (r.ctx.broadcasts || 0) + 1; };
  r.s = def.create(r.ctx); assert.equal(r.s.endsAt, 35000);
  t += 10000; move(def, r.s, r.ctx, valid); assert.equal(r.s.endsAt, t + 30000, 'each move re-arms');
  t += 29999; def.onTick(r.s, r.ctx); assert.equal(r.s.phase, 'play');
  t += 1; def.onTick(r.s, r.ctx); assert.equal(r.s.result.reason, 'timeout'); assert.equal(r.ctx.broadcasts, 1);
  assert.equal(r.s.result.winnerPid, r.s.seats[1 - r.s.turn], 'the player to move loses on time');
  assert.equal(r.ctx.awards[r.s.result.winnerPid], 300);
  r = setup(def);
  assert.equal(def.onPlayerGone(r.s, r.ctx, 'watcher'), false);
  assert.equal(def.onPlayerGone(r.s, r.ctx, 'a'), true); assert.equal(r.s.result.reason, 'forfeit'); assert.equal(r.s.result.winnerPid, 'b');
  assert.deepEqual(r.ctx.awards, { b: 300 }); assert.equal(def.onPlayerGone(r.s, r.ctx, 'b'), false);
}
let turns = 0;
for (let match = 0; match < 25; match++) {
  const r = setup(kalah); let seed = match + 1;
  for (let n = 0; r.s.phase === 'play' && n < 500; n++) {
    const legal = kalah.view(r.s, 'a').legal; seed = (seed * 1664525 + 1013904223) >>> 0;
    move(kalah, r.s, r.ctx, { pit: legal[seed % legal.length] }); turns++;
    assert.equal(r.s.pits.reduce((a, b) => a + b), 48); assert(r.s.pits.every(n => Number.isInteger(n) && n >= 0));
  }
  assert.equal(r.s.phase, 'done', 'complete Kalah match');
}
console.log('CHECKERS_KALAH_PASS: legal paths, forced jumps/crown-stop, draws, turn/revision/role validation, wrap/capture/sweep/ties, exact-once awards and ' + turns + ' invariant-checked sowing turns');
