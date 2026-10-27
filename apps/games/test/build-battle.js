'use strict';
/* Build-battle engine tests: real rule execution through direct engine ctx
 * (the room protocol is owned by a concurrent session, so these drive the
 * engine's create/onAction/view/dispose with a stub ctx, plus manual timer
 * firing). Covers teams, economy, cross-team denial, phases, duplicates,
 * expiry, spectators, reset, disconnects, and TWO config variants sharing
 * one rule implementation. Run: node test/build-battle.js */
const assert = require('assert');

const { createBuildBattle } = require('../games/engines/build-battle');

/* Variant A: classic castles. Variant B: a different game on the same
 * rules — different arena, pieces, weapons, economy, progression. */
const CFG_A = {
  contentId: 'variant-a',
  teamNames: ['Red', 'Blue'],
  arena: { cols: 8, rows: 8, zones: { red: { x0: 0, y0: 0, x1: 7, y1: 2 }, blue: { x0: 0, y0: 5, x1: 7, y1: 7 } } },
  pieces: {
    wall: { cost: 10, hp: 30, unlockAt: 0, maxLevel: 2 },
    tower: { cost: 25, hp: 60, unlockAt: 0, maxLevel: 2 },
    cannon: { cost: 40, hp: 50, unlockAt: 60, maxLevel: 2 },
  },
  weapons: {
    catapult: { damage: 12, cooldownMs: 3000, unlockAt: 0 },
    trebuchet: { damage: 25, cooldownMs: 8000, unlockAt: 80 },
  },
  economy: { startResources: 100, maxResources: 200, refundRate: 0.5, destroyBonus: 10, resourceName: 'bricks', pointsName: 'authority' },
  phases: { buildMs: 45000, siegeMs: 45000 },
  rounds: 2,
  bounds: { buildSeconds: { min: 15, max: 120 }, siegeSeconds: { min: 15, max: 120 }, rounds: { min: 1, max: 5 } },
  winBonus: 50,
};

const CFG_B = {
  contentId: 'variant-b',
  teamNames: ['Sky', 'Stone'],
  arena: { cols: 6, rows: 6, zones: { red: { x0: 0, y0: 0, x1: 2, y1: 5 }, blue: { x0: 3, y0: 0, x1: 5, y1: 5 } } },
  pieces: {
    hut: { cost: 5, hp: 10, unlockAt: 0, maxLevel: 3 },
    bunker: { cost: 30, hp: 90, unlockAt: 40, maxLevel: 1 },
  },
  weapons: {
    sling: { damage: 4, cooldownMs: 500, unlockAt: 0 },
    mortar: { damage: 50, cooldownMs: 15000, unlockAt: 100 },
  },
  economy: { startResources: 50, maxResources: 80, refundRate: 0.25, destroyBonus: 5, resourceName: 'scrap', pointsName: 'glory' },
  phases: { buildMs: 30000, siegeMs: 20000 },
  rounds: 1,
  bounds: { buildSeconds: { min: 10, max: 60 }, siegeSeconds: { min: 10, max: 60 }, rounds: { min: 1, max: 3 } },
  winBonus: 20,
};

/* Variant C: same 8x8 arena as A but WITH a configured objective/base and
 * defense auras — different numbers from castle-clash to prove the rules
 * are config-driven, not per-game hacks. */
const CFG_C = {
  contentId: 'variant-c',
  teamNames: ['Red', 'Blue'],
  arena: { cols: 8, rows: 8, zones: { red: { x0: 0, y0: 0, x1: 7, y1: 2 }, blue: { x0: 0, y0: 5, x1: 7, y1: 7 } } },
  pieces: {
    wall: { cost: 10, hp: 30, unlockAt: 0, maxLevel: 2, ward: 0, boost: 0, coverWeight: 1 },
    tower: { cost: 25, hp: 60, unlockAt: 0, maxLevel: 2, ward: 0.1, boost: 0, coverWeight: 2 },
    cannon: { cost: 40, hp: 50, unlockAt: 60, maxLevel: 2, ward: 0, boost: 0.15, coverWeight: 1 },
  },
  weapons: {
    catapult: { damage: 12, cooldownMs: 3000, unlockAt: 0 },
    trebuchet: { damage: 25, cooldownMs: 8000, unlockAt: 80 },
  },
  economy: { startResources: 100, maxResources: 200, refundRate: 0.5, destroyBonus: 10, resourceName: 'bricks', pointsName: 'authority' },
  objective: { piece: 'core', hp: 60, destroyBonus: 40, surviveRate: 0.25, positions: { red: { x: 1, y: 0 }, blue: { x: 6, y: 7 } } },
  defense: { coverPerAdjacent: 0.1, maxCover: 0.4, maxWard: 0.25, maxBoost: 0.3 },
  phases: { buildMs: 45000, siegeMs: 45000 },
  rounds: 2,
  bounds: { buildSeconds: { min: 15, max: 120 }, siegeSeconds: { min: 15, max: 120 }, rounds: { min: 1, max: 5 } },
  winBonus: 50,
};

function mkPlayers(n) {
  const names = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve', 'Fin', 'Gus', 'Hal'];
  const out = [];
  for (let i = 0; i < n; i++) out.push({ id: 'p' + i, name: names[i] });
  return out;
}

function stubCtx(opts = {}) {
  const players = opts.players || mkPlayers(4);
  const ctx = {
    _now: opts.now !== undefined ? opts.now : 5000000,
    _timers: [], // {ms, fn, cancelled}
    _broadcasts: 0,
    _awards: {},
    _connected: null,
    players() { return (this._connected || players).slice(); },
    allPlayers: () => players.slice(),
    content: () => (opts.content || {}),
    settings: () => ({ ...(opts.settings || {}) }),
    hostId: () => players[0].id,
    broadcast: () => { ctx._broadcasts += 1; },
    lobby: () => {},
    later(ms, fn) {
      const t = { ms, fn, cancelled: false };
      ctx._timers.push(t);
      return () => { t.cancelled = true; };
    },
    award: (pid, pts) => { ctx._awards[pid] = (ctx._awards[pid] || 0) + pts; },
    now: () => ctx._now,
  };
  return ctx;
}

/* Fire the most recently scheduled live timer (manual ctx.later). */
function fireLast(ctx) {
  const live = ctx._timers.filter((t) => !t.cancelled);
  assert(live.length > 0, 'expected a pending timer');
  live[live.length - 1].fn();
}

function teamOf(state, pid) {
  return state.memberTeam[pid];
}

function main() {
  // --- 1. stable balanced teams, visible names + teammates ---
  {
    const eng = createBuildBattle(CFG_A);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    assert.strictEqual(st.phase, 'build', 'starts in build');
    assert.deepStrictEqual(st.teams.red.members, ['p0', 'p2'], 'red = even seats');
    assert.deepStrictEqual(st.teams.blue.members, ['p1', 'p3'], 'blue = odd seats');
    assert.strictEqual(st.teams.red.name, 'Red', 'red name visible');
    assert.strictEqual(st.teams.blue.name, 'Blue', 'blue name visible');
    const v = eng.view(st, 'p0');
    assert.strictEqual(v.myTeam, 'red', 'myTeam for member');
    assert.deepStrictEqual(v.teams.red.members, ['p0', 'p2'], 'teammates visible');
    assert.deepStrictEqual(v.teams.blue.members, ['p1', 'p3'], 'opponents visible');
    // Stable across re-create with the same roster.
    const st2 = eng.create(stubCtx());
    assert.deepStrictEqual(st2.memberTeam, st.memberTeam, 'assignment is deterministic');
    console.log('BUILD ok: stable 2v2 teams, names + teammates visible');
  }

  // --- 2. purchases: atomic, zoned, budgeted, phased, nonce-gated ---
  {
    const eng = createBuildBattle(CFG_A);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    const before = st.teams.red.resources;
    assert.strictEqual(before, 100, 'starting resources');
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 1, y: 1, nonce: 'b1' } });
    assert.strictEqual(st.teams.red.resources, 90, 'cost deducted');
    assert(st.grids.red['1,1'] && st.grids.red['1,1'].piece === 'wall', 'wall placed');
    // Occupied / unknown / over-budget / enemy-zone / no-nonce: all denied.
    eng.onAction(st, ctx, 'p2', { build: { piece: 'tower', x: 1, y: 1, nonce: 'b2' } });
    assert.strictEqual(st.grids.red['1,1'].piece, 'wall', 'occupied tile denied');
    eng.onAction(st, ctx, 'p2', { build: { piece: 'dragon', x: 2, y: 1, nonce: 'b3' } });
    assert(!st.grids.red['2,1'], 'unknown piece denied');
    eng.onAction(st, ctx, 'p2', { build: { piece: 'tower', x: 2, y: 1 } });
    assert(!st.grids.red['2,1'], 'missing nonce denied');
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 0, y: 6, nonce: 'b4' } });
    assert(!st.grids.red['0,6'] && !st.grids.blue['0,6'], 'enemy zone denied');
    st.teams.red.resources = 5;
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 3, y: 0, nonce: 'b5' } });
    assert(!st.grids.red['3,0'], 'over budget denied');
    assert.strictEqual(st.teams.red.resources, 5, 'failed buy leaves resources');
    // Locked piece denied until unlocked.
    eng.onAction(st, ctx, 'p0', { build: { piece: 'cannon', x: 4, y: 0, nonce: 'b6' } });
    assert(!st.grids.red['4,0'], 'locked cannon denied');
    // Arbitrary teamId in the action changes nothing: spend is by membership.
    st.teams.red.resources = 100;
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', teamId: 'blue', x: 5, y: 0, nonce: 'b7' } });
    assert(st.grids.red['5,0'], 'spends own team despite forged teamId');
    assert.strictEqual(st.teams.blue.resources, 100, 'other team untouched');
    assert.strictEqual(st.teams.red.resources, 90, 'own team charged');
    console.log('BUILD ok: atomic zoned purchases, forged teamId ignored');
  }

  // --- 3. duplicate nonces never double-charge ---
  {
    const eng = createBuildBattle(CFG_A);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 0, y: 0, nonce: 'dup' } });
    eng.onAction(st, ctx, 'p0', { build: { piece: 'tower', x: 1, y: 0, nonce: 'dup' } });
    assert.strictEqual(st.teams.red.resources, 90, 'replayed purchase charged once');
    assert(!st.grids.red['1,0'], 'replayed purchase placed nothing');
    console.log('BUILD ok: duplicate purchase ignored');
  }

  // --- 4. upgrade + teardown: bounded, no point mint ---
  {
    const eng = createBuildBattle(CFG_A);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    eng.onAction(st, ctx, 'p0', { build: { piece: 'tower', x: 0, y: 0, nonce: 'u0' } });
    assert.strictEqual(st.teams.red.resources, 75, 'tower costs 25');
    eng.onAction(st, ctx, 'p2', { upgrade: { x: 0, y: 0, nonce: 'u1' } });
    assert.strictEqual(st.teams.red.resources, 50, 'upgrade costs base again');
    assert.strictEqual(st.grids.red['0,0'].level, 2, 'level 2');
    assert.strictEqual(st.grids.red['0,0'].maxHp, 120, 'hp doubled');
    eng.onAction(st, ctx, 'p2', { upgrade: { x: 0, y: 0, nonce: 'u2' } });
    assert.strictEqual(st.grids.red['0,0'].level, 2, 'max level capped');
    assert.strictEqual(st.teams.red.resources, 50, 'capped upgrade not charged');
    const ptsBefore = st.teams.red.points;
    eng.onAction(st, ctx, 'p0', { teardown: { x: 0, y: 0, nonce: 'u3' } });
    assert(!st.grids.red['0,0'], 'tower removed');
    // Invested 50 (25+25), refund floor(50*0.5)=25.
    assert.strictEqual(st.teams.red.resources, 75, 'bounded refund 25');
    assert.strictEqual(st.teams.red.points, ptsBefore, 'teardown mints no points');
    eng.onAction(st, ctx, 'p0', { teardown: { x: 0, y: 0, nonce: 'u3' } });
    assert.strictEqual(st.teams.red.resources, 75, 'replayed teardown refunds once');
    // Refund capped at maxResources.
    st.teams.red.resources = 199;
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 2, y: 2, nonce: 'u4' } });
    eng.onAction(st, ctx, 'p0', { teardown: { x: 2, y: 2, nonce: 'u5' } });
    assert(st.teams.red.resources <= 200, 'refund capped at max');
    console.log('BUILD ok: upgrade/teardown bounded, no mint');
  }

  // --- 5. siege: real damage, points, cooldowns, destroy bonus ---
  {
    const eng = createBuildBattle(CFG_A);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 0, y: 0, nonce: 's0' } });
    eng.onAction(st, ctx, 'p1', { build: { piece: 'wall', x: 0, y: 7, nonce: 's1' } });
    // Build actions are illegal in siege; fire is illegal in build.
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 7, nonce: 's2' } });
    assert.strictEqual(st.grids.blue['0,7'].hp, 30, 'fire in build phase denied');
    fireLast(ctx); // build timer -> siege
    assert.strictEqual(st.phase, 'siege', 'timer enters siege');
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 1, y: 0, nonce: 's3' } });
    assert(!st.grids.red['1,0'], 'build in siege phase denied');
    const pts0 = st.teams.red.points;
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 7, nonce: 's4', t: 1 } });
    assert.strictEqual(st.grids.blue['0,7'].hp, 18, 'catapult deals 12');
    assert.strictEqual(st.teams.red.points, pts0 + 12, 'points equal damage dealt');
    // Cooldown: same weapon blocked until server now passes readyAt.
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 7, nonce: 's5' } });
    assert.strictEqual(st.grids.blue['0,7'].hp, 18, 'cooldown blocks second shot');
    ctx._now += 3000;
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 7, nonce: 's5' } });
    assert.strictEqual(st.grids.blue['0,7'].hp, 6, 'cooldown expiry allows the shot');
    // Own-structure targeting + empty tiles denied; no cooldown burned.
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 0, nonce: 's6' } });
    assert.strictEqual(st.grids.red['0,0'].hp, 30, 'own structures untargetable');
    ctx._now += 3000;
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 5, y: 5, nonce: 's7' } });
    assert.strictEqual(st.teams.red.points, pts0 + 12 + 12, 'empty tile scores nothing');
    // Locked weapon denied (while the siege is still running).
    eng.onAction(st, ctx, 'p1', { fire: { weapon: 'trebuchet', x: 0, y: 0, nonce: 's9' } });
    assert.strictEqual(st.grids.red['0,0'].hp, 30, 'locked trebuchet denied');
    // Finish it: no overkill mint (6 hp left, 12 damage -> 6 + bonus).
    // Wiping blue ends the round early (covered again in test 6).
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 7, nonce: 's8' } });
    assert.strictEqual(st.teams.red.points, pts0 + 12 + 12 + 6 + 10, 'damage capped + destroy bonus');
    assert.strictEqual(st.phase, 'build', 'wiping a side ends the siege early');
    assert.strictEqual(st.round, 2, 'early end advances the round');
    console.log('BUILD ok: siege damage/points/cooldowns/bonus, no overkill mint');
  }

  // --- 6. transitions happen exactly once; reset keeps unlocks/points ---
  {
    const eng = createBuildBattle(CFG_A);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 0, y: 0, nonce: 'r0' } });
    eng.onAction(st, ctx, 'p1', { build: { piece: 'wall', x: 0, y: 7, nonce: 'r1' } });
    const buildCb = ctx._timers[ctx._timers.length - 1].fn;
    buildCb();
    assert.strictEqual(st.phase, 'siege', 'build timer -> siege');
    buildCb();
    assert.strictEqual(st.phase, 'siege', 'duplicate build fire is a no-op');
    // Score some points, then end the siege twice.
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 7, nonce: 'r2' } });
    const siegeCb = ctx._timers[ctx._timers.length - 1].fn;
    siegeCb();
    assert.strictEqual(st.phase, 'build', 'siege timer -> round 2 build');
    assert.strictEqual(st.round, 2, 'round advanced');
    siegeCb();
    assert.strictEqual(st.round, 2, 'duplicate siege fire cannot skip a round');
    assert.strictEqual(st.phase, 'build', 'still round 2 build');
    // Reset kept points, cleared structures, refilled resources.
    assert.strictEqual(st.teams.red.points, 12, 'points retained');
    assert.deepStrictEqual(st.grids.red, {}, 'structures cleared');
    assert.strictEqual(st.teams.red.resources, 100, 'resources refilled');
    assert.deepStrictEqual(st.cooldowns, {}, 'cooldowns cleared');
    console.log('BUILD ok: exactly-once transitions, reset keeps points');
  }

  // --- 7. unlocks + progression between rounds; full game to done ---
  {
    const eng = createBuildBattle(CFG_A);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    // Round 1: build, siege, farm 60+ points for red via a fat target.
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 0, y: 0, nonce: 'p0' } });
    eng.onAction(st, ctx, 'p1', { build: { piece: 'tower', x: 0, y: 7, nonce: 'p1' } });
    eng.onAction(st, ctx, 'p1', { build: { piece: 'tower', x: 1, y: 7, nonce: 'p2' } });
    fireLast(ctx);
    let n = 0;
    while (st.phase === 'siege' && st.teams.red.points < 70 && n < 40) {
      n += 1;
      ctx._now += 3000;
      const target = st.grids.blue['0,7'] ? { x: 0, y: 7 } : { x: 1, y: 7 };
      eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', ...target, nonce: 'farm' + n } });
    }
    assert(st.teams.red.points >= 60, `farmed points, saw ${st.teams.red.points}`);
    assert(st.teams.red.unlocks.includes('piece:cannon'), 'cannon unlocked by points');
    const v1 = eng.view(st, 'p0');
    assert(v1.teams.red.unlocks.includes('piece:cannon'), 'unlock visible in view');
    fireLast(ctx); // -> round 2 build
    assert.strictEqual(st.round, 2, 'round 2');
    assert(st.teams.red.unlocks.includes('piece:cannon'), 'unlock retained across rounds');
    eng.onAction(st, ctx, 'p0', { build: { piece: 'cannon', x: 3, y: 1, nonce: 'p3' } });
    assert(st.grids.red['3,1'], 'unlocked cannon builds in round 2');
    // Round 2 with no blue structures at all: siege is skipped, game ends.
    fireLast(ctx); // build -> (empty blue... red has cannon, so siege runs)
    if (st.phase === 'siege') fireLast(ctx); // siege -> done (rounds=2)
    assert.strictEqual(st.phase, 'done', 'final siege ends the game');
    assert(st.result, 'result set');
    assert.strictEqual(st.result.winners.length, 1, 'red wins outright');
    assert.strictEqual(st.result.winner, 'red', 'winner is red');
    assert(ctx._awards.p0 > 0 && ctx._awards.p2 > 0, 'winners awarded');
    assert.strictEqual(st.scores.p0, st.teams.red.points, 'scores mirror team points');
    // Post-game actions change nothing.
    const pts = st.teams.red.points;
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 7, nonce: 'late' } });
    assert.strictEqual(st.teams.red.points, pts, 'done phase is inert');
    console.log('BUILD ok: unlock progression + full 2-round game to done');
  }

  // --- 8. spectator-safe view; disconnects never trap the game ---
  {
    const eng = createBuildBattle(CFG_A);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    const spec = eng.view(st, 'stranger');
    assert.strictEqual(spec.myTeam, null, 'spectator has no team');
    assert.deepStrictEqual(spec.cooldowns, {}, 'no cooldowns leak to spectators');
    assert(Array.isArray(spec.grids.red), 'spectator sees both castles');
    assert(!('seen' in spec) && !('_cancel' in spec), 'no internals leak');
    eng.onAction(st, ctx, 'stranger', { build: { piece: 'wall', x: 0, y: 0, nonce: 'x1' } });
    assert(!st.grids.red['0,0'], 'spectator builds are no-ops');
    // Everyone disconnects mid-build: the timer still advances the game,
    // and with nothing built the empty siege is skipped, not stalled.
    ctx._connected = [];
    fireLast(ctx);
    assert.strictEqual(st.phase, 'build', 'empty siege skips to next build');
    assert.strictEqual(st.round, 2, 'skipped into round 2');
    fireLast(ctx);
    assert.strictEqual(st.phase, 'done', 'second empty round ends the game');
    console.log('BUILD ok: spectator-safe view, disconnect-proof timers');
  }

  // --- 9. dispose cancels the pending phase timer ---
  {
    const eng = createBuildBattle(CFG_A);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    assert(ctx._timers.some((t) => !t.cancelled), 'timer pending after create');
    eng.dispose(st);
    assert(ctx._timers.every((t) => t.cancelled), 'dispose cancels pending timers');
    const phase = st.phase;
    for (const t of ctx._timers) t.fn();
    assert.strictEqual(st.phase, phase, 'cancelled timers never transition');
    console.log('BUILD ok: dispose cancels timers');
  }

  // --- 10. variant B: same rules, genuinely different game ---
  {
    const engB = createBuildBattle(CFG_B);
    const ctx = stubCtx({ players: mkPlayers(6) });
    const st = engB.create(ctx);
    assert.strictEqual(st.rounds, 1, 'variant B plays 1 round');
    assert.strictEqual(st.teams.red.resources, 50, 'variant B economy');
    assert.strictEqual(st.teams.red.name, 'Sky', 'variant B names');
    // Left/right zones (not top/bottom): red x0..2, blue x3..5.
    engB.onAction(st, ctx, 'p0', { build: { piece: 'hut', x: 1, y: 3, nonce: 'v0' } });
    assert(st.grids.red['1,3'], 'variant B zone accepted');
    engB.onAction(st, ctx, 'p0', { build: { piece: 'hut', x: 4, y: 3, nonce: 'v1' } });
    assert(!st.grids.red['4,3'], 'variant B zone enforced');
    // maxLevel 3 hut upgrades twice.
    engB.onAction(st, ctx, 'p0', { upgrade: { x: 1, y: 3, nonce: 'v2' } });
    engB.onAction(st, ctx, 'p0', { upgrade: { x: 1, y: 3, nonce: 'v3' } });
    assert.strictEqual(st.grids.red['1,3'].level, 3, 'variant B maxLevel 3');
    engB.onAction(st, ctx, 'p1', { build: { piece: 'hut', x: 4, y: 0, nonce: 'v4' } });
    fireLast(ctx);
    assert.strictEqual(st.phase, 'siege', 'variant B sieges');
    engB.onAction(st, ctx, 'p0', { fire: { weapon: 'sling', x: 4, y: 0, nonce: 'v5' } });
    assert.strictEqual(st.grids.blue['4,0'].hp, 6, 'variant B weapon damage');
    fireLast(ctx);
    assert.strictEqual(st.phase, 'done', 'variant B ends after 1 round');
    assert.strictEqual(ctx._awards.p0, st.teams.red.points + 20, 'variant B win bonus');
    // Both variants are instances of the same factory (one rule module,
    // two data configs — no rule copy-paste).
    const engA2 = createBuildBattle(CFG_A);
    assert.notStrictEqual(engB, engA2, 'distinct game instances');
    for (const fn of ['create', 'onAction', 'view', 'dispose']) {
      assert.strictEqual(typeof engB[fn], 'function', 'variant B exposes ' + fn);
      assert.strictEqual(typeof engA2[fn], 'function', 'variant A exposes ' + fn);
    }
    assert.strictEqual(engB.create.toString(), engA2.create.toString(), 'identical rule code, different data');
    console.log('BUILD ok: variant B differs in data, shares all rules');
  }

  // --- 11. garbage actions never throw (check-game parity) ---
  {
    const eng = createBuildBattle(CFG_A);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    for (const a of [{}, { vote: 'a' }, { build: null }, { build: 'x' }, { fire: [1] }, 'nope', 42, [1], { build: { piece: {}, x: NaN, y: 1e9, nonce: {} } }]) {
      for (const pid of ['p0', 'p1', 'ghost']) eng.onAction(st, ctx, pid, a || {});
    }
    eng.view(st, 'p0');
    eng.view(st, 'ghost');
    console.log('BUILD ok: garbage actions survive');
  }

  // --- 12. objective seeded both teams each round, valid cells, exposed ---
  {
    const eng = createBuildBattle(CFG_C);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    assert(st.grids.red['1,0'] && st.grids.red['1,0'].objective, 'red core seeded');
    assert(st.grids.blue['6,7'] && st.grids.blue['6,7'].objective, 'blue core seeded');
    assert.strictEqual(st.grids.red['1,0'].hp, 60, 'core hp from config');
    assert.strictEqual(st.grids.red['1,0'].piece, 'core', 'core piece id');
    const v = eng.view(st, 'p0');
    assert(v.objective && v.objective.piece === 'core', 'objective config exposed');
    assert.strictEqual(v.objective.destroyBonus, 40, 'destroy bonus exposed');
    assert.strictEqual(v.objective.surviveRate, 0.25, 'survive rate exposed');
    assert(v.objectives.red.alive && v.objectives.blue.alive, 'both cores alive in view');
    assert.strictEqual(v.objectives.red.hp, 60, 'core health visible');
    assert(v.auras && typeof v.auras.red.ward === 'number', 'auras exposed');
    assert.strictEqual(v.catalog.pieces.tower.ward, 0.1, 'tower ward in catalog');
    assert.strictEqual(v.catalog.pieces.cannon.boost, 0.15, 'cannon boost in catalog');
    // Building on the objective cell is denied (occupied).
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 1, y: 0, nonce: 'oc0' } });
    assert(st.grids.red['1,0'].objective, 'core cell not overwritten');
    // Auto-placement when positions are missing: valid back-zone cells.
    const noPos = JSON.parse(JSON.stringify(CFG_C));
    delete noPos.objective.positions;
    const engAuto = createBuildBattle(noPos);
    const stAuto = engAuto.create(stubCtx());
    const reds = Object.values(stAuto.grids.red).filter((c) => c.objective);
    const blues = Object.values(stAuto.grids.blue).filter((c) => c.objective);
    assert.strictEqual(reds.length, 1, 'auto red core seeded');
    assert.strictEqual(blues.length, 1, 'auto blue core seeded');
    assert(reds[0].y === 0, `auto red core on back row, saw y=${reds[0].y}`);
    assert(blues[0].y === 7, `auto blue core on back row, saw y=${blues[0].y}`);
    console.log('BUILD ok: objective seeded, valid, exposed; auto back-zone works');
  }

  // --- 13. no-build-no-score exploit fixed: empty fort cannot hide ---
  {
    // With objective: nobody builds, siege still runs and cores score.
    const eng = createBuildBattle(CFG_C);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    fireLast(ctx); // build -> siege (cores guarantee targets)
    assert.strictEqual(st.phase, 'siege', 'objective siege runs even with no builds');
    const pts0 = st.teams.red.points;
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 6, y: 7, nonce: 'ex0' } });
    assert(st.teams.red.points > pts0, 'empty fort still yields core damage points');
    assert(st.grids.blue['6,7'].hp < 60, 'enemy core took the hit');
    // Without objective (legacy): nobody builds, siege is skipped, no score.
    const engA = createBuildBattle(CFG_A);
    const ctxA = stubCtx();
    const stA = engA.create(ctxA);
    fireLast(ctxA);
    assert.strictEqual(stA.phase, 'build', 'legacy empty siege skips');
    assert.strictEqual(stA.teams.red.points, 0, 'legacy empty round scores nothing');
    console.log('BUILD ok: no-build exploit fixed (core always attackable)');
  }

  // --- 14. defense helps: cover/ward/boost deterministic, no redirect ---
  {
    const eng = createBuildBattle(CFG_C);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    // Blue rings its core (6,7) with one wall (5,7); red builds nothing.
    eng.onAction(st, ctx, 'p1', { build: { piece: 'wall', x: 5, y: 7, nonce: 'df0' } });
    const vCover = eng.view(st, 'p1');
    assert(vCover.objectives.blue.cover > 0, 'adjacent wall gives cover');
    assert.strictEqual(vCover.objectives.blue.coverCount, 1, 'one adjacent counted');
    fireLast(ctx); // -> siege
    // Covered core: floor(12 * (1-0.1)) = 10.
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 6, y: 7, nonce: 'df1' } });
    assert.strictEqual(st.grids.blue['6,7'].hp, 50, 'cover cuts 12 to 10');
    const hitLog = st.log.filter((e) => e.kind === 'hit').pop();
    assert(hitLog && Math.abs(hitLog.cover - 0.1) < 1e-9, 'cover logged for feedback');
    assert.strictEqual(hitLog.x, 6, 'no redirection: logged x matches target');
    assert.strictEqual(hitLog.y, 7, 'no redirection: logged y matches target');
    // Tower counts double: fresh game, blue builds tower (5,6) diagonal to core.
    const eng2 = createBuildBattle(CFG_C);
    const ctx2 = stubCtx();
    const st2 = eng2.create(ctx2);
    eng2.onAction(st2, ctx2, 'p1', { build: { piece: 'tower', x: 5, y: 6, nonce: 'df2' } });
    const v2 = eng2.view(st2, 'p1');
    assert(Math.abs(v2.objectives.blue.cover - 0.2) < 1e-9, 'tower cover x2 = 0.2');
    assert(Math.abs(v2.auras.blue.ward - 0.1) < 1e-9, 'tower ward aura 0.1');
    fireLast(ctx2);
    // Core hit: floor(12 * (1-0.1 ward) * (1-0.2 cover)) = floor(8.64) = 8.
    eng2.onAction(st2, ctx2, 'p0', { fire: { weapon: 'catapult', x: 6, y: 7, nonce: 'df3' } });
    assert.strictEqual(st2.grids.blue['6,7'].hp, 52, 'tower cover+ward cuts 12 to 8');
    // Ward alone on a normal structure: blue tower + wall, red hits the wall.
    const eng3 = createBuildBattle(CFG_C);
    const ctx3 = stubCtx();
    const st3 = eng3.create(ctx3);
    eng3.onAction(st3, ctx3, 'p1', { build: { piece: 'tower', x: 0, y: 5, nonce: 'df4' } });
    eng3.onAction(st3, ctx3, 'p1', { build: { piece: 'wall', x: 1, y: 5, nonce: 'df5' } });
    fireLast(ctx3);
    eng3.onAction(st3, ctx3, 'p0', { fire: { weapon: 'catapult', x: 1, y: 5, nonce: 'df6' } });
    assert.strictEqual(st3.grids.blue['1,5'].hp, 20, 'ward cuts wall hit 12 to 10');
    // Boost: red needs 60 points to unlock cannon, so grant via direct state
    // (mirrors earned unlocks) then verify the aura raises damage.
    const eng4 = createBuildBattle(CFG_C);
    const ctx4 = stubCtx();
    const st4 = eng4.create(ctx4);
    st4.teams.red.points = 60;
    eng4.onAction(st4, ctx4, 'p1', { build: { piece: 'wall', x: 0, y: 5, nonce: 'df7' } });
    fireLast(ctx4); // siege; round-2 build keeps points -> cannon unlocked
    fireLast(ctx4); // siege ends (survival) -> round 2 build
    assert(st4.teams.red.unlocks.includes('piece:cannon'), 'earned points unlock cannon');
    eng4.onAction(st4, ctx4, 'p0', { build: { piece: 'cannon', x: 0, y: 0, nonce: 'df8' } });
    const v4 = eng4.view(st4, 'p0');
    assert(Math.abs(v4.auras.red.boost - 0.15) < 1e-9, 'cannon boost aura 0.15');
    fireLast(ctx4); // round 2 siege
    eng4.onAction(st4, ctx4, 'p1', { build: { piece: 'wall', x: 0, y: 5, nonce: 'df9' } }); // siege: denied, no-op
    eng4.onAction(st4, ctx4, 'p0', { fire: { weapon: 'catapult', x: 6, y: 7, nonce: 'df10' } });
    // Blue core uncovered, no ward: floor(12 * 1.15) = 13.
    assert.strictEqual(st4.grids.blue['6,7'].hp, 47, 'cannon boost raises 12 to 13');
    console.log('BUILD ok: cover/ward/boost deterministic, logged, no redirect');
  }

  // --- 15. corekill matters + surviving core pays ---
  {
    const eng = createBuildBattle(CFG_C);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    fireLast(ctx); // -> siege, no builds but cores live
    st.grids.blue['6,7'].hp = 5; // crack the core, then finish it
    const pts0 = st.teams.red.points;
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 6, y: 7, nonce: 'ck0' } });
    // 5 damage + 40 destroyBonus, and the round ends immediately.
    assert.strictEqual(st.teams.red.points, pts0 + 5 + 40 + Math.floor(60 * 0.25),
      'corekill pays damage + bonus + own survival');
    assert.strictEqual(st.phase, 'build', 'corekill ends the round at once');
    assert.strictEqual(st.round, 2, 'advanced to round 2');
    assert(st.log.some((e) => e.kind === 'corefall'), 'corefall logged');
    assert(st.log.some((e) => e.kind === 'survive'), 'survival bonus logged');
    // Fresh game: both cores survive to the timer, both get survival pay.
    const eng2 = createBuildBattle(CFG_C);
    const ctx2 = stubCtx();
    const st2 = eng2.create(ctx2);
    fireLast(ctx2); // -> siege
    eng2.onAction(st2, ctx2, 'p0', { fire: { weapon: 'catapult', x: 6, y: 7, nonce: 'ck1' } });
    const redBefore = st2.teams.red.points;
    const blueBefore = st2.teams.blue.points;
    fireLast(ctx2); // siege timer -> survival + round 2
    // Red core 60hp -> floor(60*0.25)=15; blue core 48hp -> 12.
    assert.strictEqual(st2.teams.red.points, redBefore + 15, 'red survival pays 15');
    assert.strictEqual(st2.teams.blue.points, blueBefore + 12, 'blue survival pays 12');
    assert(st2.grids.red['1,0'] && st2.grids.red['1,0'].hp === 60, 'cores reseed fresh');
    console.log('BUILD ok: corekill bonus + instant end, survival pays');
  }

  // --- 16. forged objective remove/upgrade denied, no refund/mint ---
  {
    const eng = createBuildBattle(CFG_C);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    const res0 = st.teams.red.resources;
    const pts0 = st.teams.red.points;
    eng.onAction(st, ctx, 'p0', { teardown: { x: 1, y: 0, nonce: 'fo0' } });
    assert(st.grids.red['1,0'] && st.grids.red['1,0'].objective, 'core teardown denied');
    assert.strictEqual(st.teams.red.resources, res0, 'no refund from forged remove');
    assert.strictEqual(st.teams.red.points, pts0, 'no points from forged remove');
    eng.onAction(st, ctx, 'p0', { upgrade: { x: 1, y: 0, nonce: 'fo1' } });
    assert.strictEqual(st.grids.red['1,0'].level, 1, 'core upgrade denied');
    assert.strictEqual(st.grids.red['1,0'].hp, 60, 'core hp not minted');
    assert.strictEqual(st.teams.red.resources, res0, 'no charge for denied upgrade');
    // Denied objective actions do not burn the nonce: reuse succeeds.
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 2, y: 0, nonce: 'fo0' } });
    assert(st.grids.red['2,0'], 'nonce from denied teardown still usable');
    // Cross-team objective teardown denied too.
    eng.onAction(st, ctx, 'p1', { teardown: { x: 1, y: 0, nonce: 'fo2' } });
    assert(st.grids.red['1,0'], 'blue cannot teardown red core');
    // The objective piece id itself is not buildable.
    eng.onAction(st, ctx, 'p0', { build: { piece: 'core', x: 3, y: 0, nonce: 'fo3' } });
    assert(!st.grids.red['3,0'], 'core piece not buildable');
    console.log('BUILD ok: forged objective remove/upgrade denied');
  }

  // --- 17. no double finish/reward on duplicate timer fires ---
  {
    const eng = createBuildBattle(CFG_C);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    fireLast(ctx); // r1 siege
    fireLast(ctx); // r1 end -> r2 build
    fireLast(ctx); // r2 siege
    const siegeCb = ctx._timers[ctx._timers.length - 1].fn;
    siegeCb(); // r2 end -> done
    assert.strictEqual(st.phase, 'done', 'game done');
    const awards = { ...ctx._awards };
    const pts = { red: st.teams.red.points, blue: st.teams.blue.points };
    siegeCb(); // duplicate final fire
    for (const t of ctx._timers) t.fn(); // every stale timer
    assert.strictEqual(st.phase, 'done', 'still done');
    assert.deepStrictEqual(ctx._awards, awards, 'awards granted exactly once');
    assert.strictEqual(st.teams.red.points, pts.red, 'no double survival mint');
    console.log('BUILD ok: no double finish/reward');
  }

  // --- 18. generic variant without objective keeps legacy behavior ---
  {
    const engB = createBuildBattle(CFG_B);
    const ctx = stubCtx({ players: mkPlayers(6) });
    const st = engB.create(ctx);
    const v = engB.view(st, 'p0');
    assert.strictEqual(v.objective, null, 'no objective config exposed');
    assert.strictEqual(v.objectives, null, 'no objectives state without config');
    assert.deepStrictEqual(st.grids.red, {}, 'no seeded base without config');
    fireLast(ctx); // empty -> skip
    assert.strictEqual(st.phase, 'done', 'single empty round ends the game');
    assert.strictEqual(st.teams.red.points, 0, 'no survival mint without objective');
    console.log('BUILD ok: generic variant unaffected without objective');
  }

  // --- 19. earned unlocks are logged once; starting unlocks stay silent ---
  {
    const eng = createBuildBattle(CFG_C);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    assert(!st.log.some((e) => e.kind === 'unlock'), 'no unlock noise at setup');
    fireLast(ctx); // -> siege, cores live
    st.grids.blue['6,7'].hp = 5; // crack the core, then finish it
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 6, y: 7, nonce: 'ul0' } });
    // 5 damage + 40 destroyBonus + floor(60*0.25)=15 own survival = 60.
    assert(st.teams.red.unlocks.includes('piece:cannon'), 'cannon earned at 60');
    const ups = st.log.filter((e) => e.kind === 'unlock' && e.by === 'red');
    assert(ups.some((e) => e.unlockKind === 'piece' && e.unlockId === 'cannon' && e.at === 60),
      'cannon unlock logged once with its threshold');
    assert(!ups.some((e) => !(e.at > 0)), 'starting unlocks never logged');
    assert.strictEqual(ups.filter((e) => e.unlockId === 'cannon').length, 1, 'logged exactly once');
    // Finish the game (round 2 build -> siege -> done): red gains survival
    // only (60+15=75, short of trebuchet at 80), so no dupes, no extras.
    fireLast(ctx); // round 2 siege
    fireLast(ctx); // survival + done
    assert.strictEqual(st.phase, 'done', 'game done');
    assert.strictEqual(st.log.filter((e) => e.kind === 'unlock').length, 1, 'no duplicate unlock logs');
    const v = eng.view(st, 'p0');
    assert(v.log.some((e) => e.kind === 'unlock'), 'unlock feedback reaches the view');
    // Generic variant without objective: earned unlocks log the same way.
    const engB = createBuildBattle(CFG_B);
    const ctxB = stubCtx({ players: mkPlayers(4) });
    const stB = engB.create(ctxB);
    engB.onAction(stB, ctxB, 'p1', { build: { piece: 'hut', x: 3, y: 0, nonce: 'ulb0' } });
    engB.onAction(stB, ctxB, 'p1', { build: { piece: 'hut', x: 4, y: 0, nonce: 'ulb1' } });
    engB.onAction(stB, ctxB, 'p1', { build: { piece: 'hut', x: 5, y: 0, nonce: 'ulb2' } });
    engB.onAction(stB, ctxB, 'p0', { build: { piece: 'hut', x: 0, y: 0, nonce: 'ulb3' } });
    fireLast(ctxB); // -> siege (non-empty)
    for (const t of [{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }]) {
      for (let s = 0; s < 3; s++) { // hut 10hp vs sling 4dmg: 3 shots each
        ctxB._now += 600; // sling cools 500ms
        engB.onAction(stB, ctxB, 'p0', { fire: { weapon: 'sling', ...t, nonce: `ulb-s${t.x}-${s}` } });
      }
    }
    // 3 huts x (10 damage + 5 destroy) = 45: bunker (40) earned, logged.
    assert(stB.teams.red.unlocks.includes('piece:bunker'), 'generic bunker earned');
    assert(stB.log.some((e) => e.kind === 'unlock' && e.by === 'red' && e.unlockId === 'bunker' && e.at === 40),
      'generic unlock logged with threshold');
    console.log('BUILD ok: earned unlocks logged once, starters silent, generic too');
  }

  console.log('BUILD_PASS');
}

main();
