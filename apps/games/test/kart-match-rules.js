'use strict';
/* Pocket Karts match rules from specs/GAME_RULES_STANDARD.md:
 * - round length 1 to 5 minutes, 3 by default;
 * - a score target can end a match early on every map (classic + elevated);
 * - places pay 300 / 200 / 100 / 0 at match end, ties share rank and
 *   points, a full draw pays 150 each;
 * - a driver who leaves (def.onPlayerGone) or stays away 60 s drops out
 *   and the others play on.
 * Run: node test/kart-match-rules.js */
const assert = require('assert');
const product = require('../games/pocket-karts/server.js');
const { createKartGame, constants } = require('../games/engines/kart-engine');
const { rankStandings } = require('../games/engines/kart-standings');
const { GONE_AFTER_MS } = require('../games/engines/kart-elevated-adapter');

let checks = 0;
const ok = (value, msg) => { assert.ok(value, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

// Planar fixture engine: same factory as Pocket Karts, no physics bodies.
const karts = createKartGame({ id: 'pocket-karts', name: 'Pocket Karts', modes: ['starrush', 'battle'], maps: ['ring', 'blocks'],
  defaults: { roundSeconds: 180, mode: 'battle', map: 'ring', winRule: 'Time limit', targetHits: 3 } });

function stubCtx(settings = {}, ids = ['pa', 'pb', 'pc']) {
  const players = ids.map((id) => ({ id, name: id.toUpperCase() }));
  const ctx = {
    _now: 5000000, _awards: {}, _broadcasts: 0, _connected: null, instanceId: 'rules-' + Math.random().toString(36).slice(2),
    players() { return (this._connected || players).slice(); },
    allPlayers: () => players.slice(),
    content: () => ({}), settings: () => ({ ...settings }), hostId: () => ids[0],
    broadcast: () => { ctx._broadcasts++; }, lobby: () => {}, later: () => () => {},
    award: (pid, pts) => { ctx._awards[pid] = (ctx._awards[pid] || 0) + pts; },
    now: () => ctx._now,
  };
  return ctx;
}
function racing(settings, ids) {
  const ctx = stubCtx(settings, ids);
  const st = karts.create(ctx);
  ctx._now += constants.COUNTDOWN_MS;
  karts.onTick(st, ctx);
  eq(st.phase, 'drive', 'countdown reaches drive');
  return [st, ctx];
}
const park = (st) => st.karts.forEach((k, i) => { k.x = -20 + i * 20; k.z = 20; });

// ---- round length: 1..5 minutes, default 3 ----
{
  const setting = product.manifest.settings.find((s) => s.key === 'roundSeconds');
  eq([setting.min, setting.max, setting.def], [60, 300, 180], 'Pocket Karts offers 1 to 5 minutes, 3 by default');
  eq(karts.manifest.settings.find((s) => s.key === 'roundSeconds').def, 180, 'engine default is 3 minutes');
  const roundMs = (s) => karts.create(stubCtx(s)).roundMs;
  eq(roundMs({}), 180000, 'no setting plays 3 minutes');
  eq(roundMs({ roundSeconds: 30 }), 60000, 'too short clamps to 1 minute');
  eq(roundMs({ roundSeconds: 900 }), 300000, 'too long clamps to 5 minutes');
  eq(roundMs({ roundSeconds: 240 }), 240000, '4 minutes is honoured');
  eq(createKartGame({ id: 'x', name: 'X' }).manifest.settings.find((s) => s.key === 'roundSeconds').def, 180, 'thin variants default to 3 minutes too');
}

// ---- place points ----
{
  const r = rankStandings([{ pid: 'a', score: 5 }, { pid: 'b', score: 3 }, { pid: 'c', score: 5 }, { pid: 'd', score: 0 }]);
  eq(r.standings.map((s) => [s.pid, s.rank, s.points]), [['a', 1, 300], ['c', 1, 300], ['b', 3, 100], ['d', 4, 0]], 'tied leaders share rank 1 and 300; the next rank is 3');
  eq(r.winners, ['a', 'c'], 'every tied leader is a winner'); eq(r.winner, null, 'a tie has no sole winner'); eq(r.draw, false, 'a partial tie is not a draw');
  const s = rankStandings([{ pid: 'a', score: 4 }, { pid: 'b', score: 2 }, { pid: 'c', score: 2 }]);
  eq(s.standings.map((x) => [x.pid, x.rank, x.points]), [['a', 1, 300], ['b', 2, 200], ['c', 2, 200]], 'tied seconds share 200');
  const d = rankStandings([{ pid: 'a', score: 2 }, { pid: 'b', score: 2 }, { pid: 'c', score: 2 }]);
  ok(d.draw && d.standings.every((x) => x.rank === 1 && x.points === 150), 'everyone level is a draw worth 150 each');
  const g = rankStandings([{ pid: 'a', score: 9, out: true }, { pid: 'b', score: 1 }, { pid: 'c', score: 0 }]);
  eq(g.standings.map((x) => [x.pid, x.rank, x.points]), [['b', 1, 300], ['c', 2, 200], ['a', 3, 0]], 'a driver who dropped out ranks last with 0, whatever the score');
  eq(rankStandings([{ pid: 'a', score: 0 }, { pid: 'b', score: 3, out: true }]).winners, ['a'], 'the last driver standing wins even on zero');
  const five = rankStandings(['a', 'b', 'c', 'd', 'e'].map((pid, i) => ({ pid, score: 10 - i })));
  eq(five.standings.map((x) => x.points), [300, 200, 100, 0, 0], 'fourth place and below earn 0');
}

// ---- match end awards (classic engine) ----
{
  const [st, ctx] = racing({ mode: 'Zap Battle' });
  park(st);
  st.karts[0].hits = 2; st.karts[1].hits = 2; st.karts[2].hits = 1;
  eq(ctx._awards, {}, 'nothing is awarded during the match');
  ctx._now = st.endsAt + 1; karts.onTick(st, ctx);
  eq(st.phase, 'done', 'timer ends the match');
  eq(ctx._awards, { pa: 300, pb: 300, pc: 100 }, 'tied winners share 300; third place earns 100');
  eq(st.result.standings.map((s) => s.rank), [1, 1, 3], 'equal scores share a rank');
  eq(st.result.winners, ['pa', 'pb'], 'both tied leaders are named winners');
  const view = karts.view(st, 'pa');
  eq(view.result.standings[0].points, 300, 'view carries points for the final screen');
  karts.onTick(st, ctx); eq(ctx._awards.pa, 300, 'awards land once');
}

// ---- score target ends classic matches early ----
{
  const [st, ctx] = racing({ mode: 'Zap Battle', winRule: 'Score target', targetHits: 3 });
  park(st);
  st.karts[1].hits = 3;
  ctx._now += 100; karts.onTick(st, ctx);
  eq([st.phase, st.result.endReason, st.result.winner], ['done', 'goal', 'pb'], 'reaching the KO target ends the match early');
}

// ---- leaving: onPlayerGone drops a driver, the others play on ----
{
  const [st, ctx] = racing({ mode: 'Zap Battle' });
  park(st);
  st.karts[2].hits = 5;
  const b0 = ctx._broadcasts;
  eq(product.onPlayerGone === undefined, false, 'Pocket Karts implements onPlayerGone');
  eq(karts.onPlayerGone(st, ctx, 'pc'), true, 'onPlayerGone drops the driver');
  ok(ctx._broadcasts > b0, 'the drop is broadcast at once');
  eq(karts.onPlayerGone(st, ctx, 'pc'), false, 'dropping twice is a no-op');
  eq(karts.onPlayerGone(st, ctx, 'nobody'), false, 'unknown players are ignored');
  const pc = st.karts.find((k) => k.pid === 'pc');
  ok(pc.out === true && pc.connected === false, 'the kart is out and offline');
  eq(st.phase, 'drive', 'two drivers left keep playing');
  eq(karts.view(st, 'pa').karts.find((k) => k.pid === 'pc').out, true, 'views mark the dropped kart');
  karts.onConnection(st, ctx, 'pc', true);
  eq(pc.connected, false, 'a dropped driver cannot reconnect into the match');
  eq(karts.onAction(st, ctx, 'pc', { input: { steer: 1, throttle: 1 } }), false, 'a dropped driver cannot steer');
  ctx._now += 100; karts.onTick(st, ctx);
  eq(pc.input.throttle, 0, 'dropped kart holds no input');
  st.karts[0].hits = 1;
  ctx._now = st.endsAt + 1; karts.onTick(st, ctx);
  eq(st.result.standings.map((s) => [s.pid, s.rank, s.points, s.out === true]), [['pa', 1, 300, false], ['pb', 2, 200, false], ['pc', 3, 0, true]],
    'the dropped driver ranks last with 0 despite the most KOs');
  eq(ctx._awards.pc, undefined, 'a dropped driver earns nothing');
}
{
  // Two drivers: the one left wins at once.
  const [st, ctx] = racing({ mode: 'Star Rush' }, ['pa', 'pb']);
  park(st);
  st.karts[1].stars = 4;
  karts.onPlayerGone(st, ctx, 'pb');
  eq([st.phase, st.result.endReason, st.result.winner], ['done', 'players-left', 'pa'], 'the last driver left wins at once');
  eq(ctx._awards, { pa: 300 }, 'the last driver earns first place');
}
{
  // Gone for 60 s without the room hook: the tick applies the same rule.
  const [st, ctx] = racing({ mode: 'Zap Battle' });
  park(st);
  ctx._connected = [{ id: 'pa' }, { id: 'pb' }];
  ctx._now += 100; karts.onTick(st, ctx);
  ok(!st.karts[2].out, 'a short disconnect only freezes the kart');
  ctx._now += constants.GONE_AFTER_MS - 200; karts.onTick(st, ctx);
  ok(!st.karts[2].out, 'not yet a minute');
  ctx._connected = null; ctx._now += 100; karts.onTick(st, ctx);
  ok(!st.karts[2].out && st.karts[2].goneSince === undefined, 'coming back in time resets the clock');
  ctx._connected = [{ id: 'pa' }, { id: 'pb' }];
  ctx._now += 100; karts.onTick(st, ctx);
  ctx._now += constants.GONE_AFTER_MS; karts.onTick(st, ctx);
  ok(st.karts[2].out === true, 'a minute away drops the driver');
  eq(st.phase, 'drive', 'the others play on');
  eq(constants.GONE_AFTER_MS, 60000, 'the window is 60 seconds');
}

// ---- elevated arenas: score target + leaving through the production def ----
async function elevated() {
  await product.initialize();
  ok(product.preflight({ map: 'Alpine Courtyard', mode: 'Zap Battle', winRule: 'Score target' }).ok, 'elevated arenas accept a score target');
  ok(product.preflight({ map: 'Alpine Courtyard', mode: 'Star Rush' }).error, 'elevated arenas still need Zap Battle');
  const ctx = stubCtx({ map: 'Alpine Courtyard', mode: 'Zap Battle', winRule: 'Score target', targetHits: 4, roundSeconds: 120 });
  const st = product.create(ctx);
  try {
    const v = product.view(st, 'pa');
    eq([v.winRule, v.targetHits, v.roundMs], ['Score target', 4, 120000], 'elevated view carries the score target and round length');
    ctx._now += 3500; product.onTick(st, ctx);
    eq(product.onPlayerGone(st, ctx, 'pc'), true, 'elevated onPlayerGone drops the driver');
    const after = product.view(st, 'pa');
    ok(after.karts.find((k) => k.id === 'pc').out === true, 'elevated view marks the dropped kart');
    eq(after.phase, 'live', 'two drivers left keep playing');
    product.onConnection(st, ctx, 'pc', true);
    eq(product.view(st, 'pa').karts.find((k) => k.id === 'pc').connected, false, 'a dropped driver stays out');
    // Gone a minute: the adapter applies the rule on its own tick.
    product.onConnection(st, ctx, 'pb', false);
    ctx._now += 1000; product.onTick(st, ctx);
    eq(product.view(st, 'pa').phase, 'live', 'a short disconnect keeps the match running');
    ctx._now += GONE_AFTER_MS; product.onTick(st, ctx);
    const done = product.view(st, 'pa');
    eq([done.phase, done.result.endReason, done.result.winner], ['done', 'players-left', 'pa'], 'the last driver left wins at once');
    eq(done.result.standings.map((s) => [s.pid, s.points]), [['pa', 300], ['pb', 0], ['pc', 0]], 'dropped drivers earn nothing');
    eq(ctx._awards, { pa: 300 }, 'awards land once at match end');
    product.onTick(st, ctx); eq(ctx._awards, { pa: 300 }, 'no second award');
  } finally { product.dispose(st); }
}

// ---- final screen (shared by classic and elevated views) ----
async function finalScreen() {
  const { kartResultView, joinNames } = await import('../public/js/engines/kart-results.mjs');
  const names = { pa: 'Ann', pb: 'Bob', pc: 'Cy' };
  const unit = (n) => `${n} KO${n === 1 ? '' : 's'}`;
  const view = (result, you = 'pb') => kartResultView({ result, you, nameOf: (id) => names[id], unit, target: 3, targetUnit: 'KOs' });
  const tie = view(rankStandings([{ pid: 'pa', score: 2 }, { pid: 'pb', score: 2 }, { pid: 'pc', score: 1 }]));
  eq(tie.title, "It's a tie", 'a shared win reads "It\'s a tie"');
  eq(tie.line, 'Ann and Bob share first place with 2 KOs.', 'the tie names everyone tied');
  eq([...tie.html.matchAll(/aria-label="Rank (\d)"/g)].map((m) => +m[1]), [1, 1, 3], 'shared ranks on screen');
  ok(/pk-final-self[^>]*>[^]*?Bob/.test(tie.html) && (tie.html.match(/pk-final-self/g) || []).length === 1, 'only the viewer row is highlighted');
  ok(tie.html.includes('+300 pts') && tie.html.includes('+100 pts'), 'points are shown per row');
  const draw = view(rankStandings([{ pid: 'pa', score: 0 }, { pid: 'pb', score: 0 }]));
  eq([draw.title, draw.line], ["It's a tie", 'Ann and Bob finish level with 0 KOs.'], 'a scoreless draw is a tie, not a missing winner');
  const goal = view({ ...rankStandings([{ pid: 'pa', score: 3 }, { pid: 'pb', score: 1 }]), endReason: 'goal' });
  eq([goal.title, goal.line], ['Ann wins', 'First to 3 KOs.'], 'a score target win names the target');
  const left = view({ ...rankStandings([{ pid: 'pa', score: 0 }, { pid: 'pb', score: 4, out: true }]), endReason: 'players-left' });
  eq([left.title, left.line], ['Ann wins', 'Everyone else left the match.'], 'the last driver left wins');
  ok(left.html.includes('pk-final-left">Left<'), 'dropped drivers are tagged Left');
  const hostile = kartResultView({ result: rankStandings([{ pid: 'x', score: 1 }]), you: 'x', nameOf: () => '<img src=x>', unit, target: 1, targetUnit: 'KO' });
  ok(!hostile.html.includes('<img'), 'names are escaped');
  eq(joinNames(['A', 'B', 'C']), 'A, B and C', 'three-way ties list every name');
}

finalScreen().then(elevated).then(() => {
  console.log(`KART_MATCH_RULES ${checks} checks passed: 1-5 minute rounds, score targets on every map, 300/200/100 places with shared ties, drop-outs`);
  process.exit(0);
}).catch((error) => { console.error(error); process.exit(1); });
