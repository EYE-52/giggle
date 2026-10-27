'use strict';
/* Build-battle event-sequencing tests: reliable ordered accepted-action
 * events in S.log for 3D siege projectiles. Drives the REAL shared engine
 * (games/engines/build-battle.js) with a fake server clock: every entry
 * must carry a server-assigned monotonic numeric id and a server-clock
 * `when`, so scene clients can baseline the max id and play each accepted
 * shot exactly once with no reconnect doubles. Covers identical-timestamp
 * uniqueness, bounded-rollover + cross-round monotonicity, snapshot/
 * reconnect id stability, rejection silence (replay/cooldown/empty/zone/
 * spectator/locked), participant/watcher consistency, and effect dedupe.
 * Run: node test/build-battle-events.js */
const assert = require('assert');

const { createBuildBattle } = require('../games/engines/build-battle');

const T0 = 9000000; // fake server epoch: far from wall time (~1.7e12)

/* Castle-like 8x8 with an objective (siege always runs), but earnable
 * unlocks parked at 9999 so accepted shots log exactly one entry each and
 * rejection tests isolate their own denial path. */
const EV_CFG = {
  contentId: 'events-test',
  teamNames: ['Red', 'Blue'],
  arena: { cols: 8, rows: 8, zones: { red: { x0: 0, y0: 0, x1: 7, y1: 2 }, blue: { x0: 0, y0: 5, x1: 7, y1: 7 } } },
  pieces: {
    wall: { cost: 10, hp: 30, unlockAt: 0, maxLevel: 2, ward: 0, boost: 0, coverWeight: 1 },
    tower: { cost: 25, hp: 60, unlockAt: 0, maxLevel: 2, ward: 0.1, boost: 0, coverWeight: 2 },
    cannon: { cost: 40, hp: 50, unlockAt: 9999, maxLevel: 2, ward: 0, boost: 0.15, coverWeight: 1 },
  },
  weapons: {
    catapult: { damage: 12, cooldownMs: 3000, unlockAt: 0 },
    firearrow: { damage: 6, cooldownMs: 1200, unlockAt: 0 },
    trebuchet: { damage: 25, cooldownMs: 8000, unlockAt: 9999 },
  },
  economy: { startResources: 100, maxResources: 200, refundRate: 0.5, destroyBonus: 10, resourceName: 'bricks', pointsName: 'authority' },
  objective: { piece: 'core', hp: 100, destroyBonus: 60, surviveRate: 0.5, positions: { red: { x: 3, y: 0 }, blue: { x: 3, y: 7 } } },
  defense: { coverPerAdjacent: 0.08, maxCover: 0.5, maxWard: 0.3, maxBoost: 0.3 },
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
    _now: opts.now !== undefined ? opts.now : T0,
    _timers: [],
    _broadcasts: 0,
    _awards: {},
    players: () => players.slice(),
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

function fireLast(ctx) {
  const live = ctx._timers.filter((t) => !t.cancelled);
  assert(live.length > 0, 'expected a pending timer');
  live[live.length - 1].fn();
}

function idsOf(log) {
  return log.map((e) => e.id);
}

function assertIncreasing(log, label) {
  let prev = -Infinity;
  const seen = new Set();
  for (const e of log) {
    assert(Number.isInteger(e.id) && e.id > 0, `${label}: entry has a positive int id`);
    assert(!seen.has(e.id), `${label}: duplicate id ${e.id}`);
    seen.add(e.id);
    assert(e.id > prev, `${label}: ids strictly increase (${prev} -> ${e.id})`);
    prev = e.id;
  }
}

function shotEntries(log) {
  return log.filter((e) => e.kind === 'hit' || e.kind === 'destroy' || e.kind === 'corefall');
}

function logStats(state) {
  return { len: state.log.length, seq: state._eventSeq, last: state.log[state.log.length - 1] };
}

function main() {
  // --- 1. first event: server id 1, server-clock when, deadline broadcast ---
  {
    const eng = createBuildBattle(EV_CFG);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    assert.strictEqual(st._eventSeq, 0, 'sequence seeds at 0');
    assert.strictEqual(st.log.length, 0, 'setup logs nothing (starters silent)');
    ctx._now = T0 + 45000;
    fireLast(ctx); // build deadline -> siege
    assert.strictEqual(st.phase, 'siege', 'timer enters siege');
    assert.strictEqual(st.log.length, 1, 'one siege entry');
    const e = st.log[0];
    assert.strictEqual(e.id, 1, 'first id is 1');
    assert.strictEqual(e.when, T0 + 45000, 'when is the server clock, not wall time');
    assert(e.when < 1e11, 'when cannot be Date.now() wall time');
    assert.strictEqual(e.at, 1, 'round preserved in at');
    assert(ctx._broadcasts >= 1, 'siege deadline still broadcasts (deadline fix intact)');
    console.log('EVENTS ok: id 1 + server when + broadcast on first deadline');
  }

  // --- 2. identical timestamp: unique increasing ids, forged fields ignored ---
  {
    const eng = createBuildBattle(EV_CFG);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    // Walls far from both cores: no cover, no ward, clean 12/6 damage.
    eng.onAction(st, ctx, 'p1', { build: { piece: 'wall', x: 0, y: 5, nonce: 'e-b0' } });
    eng.onAction(st, ctx, 'p1', { build: { piece: 'wall', x: 1, y: 5, nonce: 'e-b1' } });
    eng.onAction(st, ctx, 'p3', { build: { piece: 'wall', x: 2, y: 5, nonce: 'e-b2' } });
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 0, y: 2, nonce: 'e-r0' } });
    eng.onAction(st, ctx, 'p2', { build: { piece: 'wall', x: 1, y: 2, nonce: 'e-r1' } });
    ctx._now = T0 + 45000;
    fireLast(ctx);
    const T = T0 + 60000; // frozen: every shot below shares one timestamp
    ctx._now = T;
    const n0 = st.log.length;
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'e-s0' } });
    eng.onAction(st, ctx, 'p2', { fire: { weapon: 'catapult', x: 1, y: 5, nonce: 'e-s1' } });
    // Forged id/when/at ride along with an otherwise valid shot.
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'firearrow', x: 2, y: 5, nonce: 'e-s2', id: 9999, when: 0, at: 999 } });
    eng.onAction(st, ctx, 'p1', { fire: { weapon: 'catapult', x: 0, y: 2, nonce: 'e-s3' } });
    eng.onAction(st, ctx, 'p3', { fire: { weapon: 'catapult', x: 1, y: 2, nonce: 'e-s4' } });
    const fresh = st.log.slice(n0);
    assert.strictEqual(fresh.length, 5, 'five accepted shots log five entries');
    assert(fresh.every((e) => e.when === T), 'all five share the identical server timestamp');
    assertIncreasing(st.log, 'full log');
    assert.deepStrictEqual(idsOf(fresh), [2, 3, 4, 5, 6], 'ids rise once per shot despite one timestamp');
    assert.strictEqual(st.grids.blue['0,5'].hp, 18, 'damage unchanged: catapult 12');
    assert.strictEqual(st.grids.blue['2,5'].hp, 24, 'damage unchanged: firearrow 6');
    const forged = fresh[2];
    assert.notStrictEqual(forged.id, 9999, 'client id never reaches the log');
    assert.strictEqual(forged.when, T, 'client when never reaches the log');
    assert.strictEqual(forged.at, 1, 'client at never reaches the log (round wins)');
    assert.strictEqual(forged.victimTeam, 'blue', 'victimTeam names the hit side');
    assert.strictEqual(forged.by, 'red', 'by still names the attacking team');
    assert.strictEqual(fresh[3].victimTeam, 'red', 'blue shots victimize red');
    for (const e of fresh) {
      assert(!('pid' in e) && !('actor' in e) && !('nonce' in e), 'no actor/cooldown-leaking fields');
    }
    console.log('EVENTS ok: 5 shots, 1 timestamp, ids 2..6, forged fields dropped');
  }

  // --- 3. rejections mint no event; accepted shots add exactly one ---
  {
    const eng = createBuildBattle(EV_CFG);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    eng.onAction(st, ctx, 'p1', { build: { piece: 'wall', x: 0, y: 5, nonce: 'r-b0' } });
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 0, y: 2, nonce: 'r-r0' } });
    ctx._now = T0 + 45000;
    fireLast(ctx);
    const T = T0 + 60000;
    ctx._now = T;
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'r-s0' } });
    assert.strictEqual(shotEntries(st.log).length, 1, 'one accepted shot, one shot event');
    const before = logStats(st);
    const silent = (label, fn) => {
      fn();
      const after = logStats(st);
      assert.strictEqual(after.len, before.len, `${label}: no log entry`);
      assert.strictEqual(after.seq, before.seq, `${label}: sequence untouched`);
      assert.strictEqual(shotEntries(st.log).length, 1, `${label}: no shot event`);
    };
    // Cooling weapon (clock still frozen inside p0's catapult window).
    silent('cooling weapon', () =>
      eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'r-cool' } }));
    ctx._now = T + 5000; // cooldowns expired: each denial below isolates its own path
    silent('empty tile', () =>
      eng.onAction(st, ctx, 'p2', { fire: { weapon: 'catapult', x: 7, y: 7, nonce: 'r-empty' } }));
    silent('wrong zone (own cell)', () =>
      eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 2, nonce: 'r-zone' } }));
    silent('spectator', () =>
      eng.onAction(st, ctx, 'ghost', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'r-spec' } }));
    silent('locked weapon', () =>
      eng.onAction(st, ctx, 'p0', { fire: { weapon: 'trebuchet', x: 0, y: 5, nonce: 'r-lock' } }));
    silent('unknown weapon', () =>
      eng.onAction(st, ctx, 'p0', { fire: { weapon: 'deathray', x: 0, y: 5, nonce: 'r-unk' } }));
    silent('replayed nonce', () =>
      eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'r-s0' } }));
    assert.strictEqual(st.grids.blue['0,5'].hp, 18, 'rejections deal no damage');
    // Build-phase fire is rejected too, and burns no cooldown.
    const engB = createBuildBattle(EV_CFG);
    const ctxB = stubCtx();
    const stB = engB.create(ctxB);
    engB.onAction(stB, ctxB, 'p1', { build: { piece: 'wall', x: 0, y: 5, nonce: 'r-bb0' } });
    engB.onAction(stB, ctxB, 'p0', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'r-early' } });
    assert.strictEqual(stB.log.length, 0, 'build-phase fire logs nothing');
    fireLast(ctxB);
    engB.onAction(stB, ctxB, 'p0', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'r-early' } });
    assert.strictEqual(shotEntries(stB.log).length, 1, 'nonce from denied fire still usable');
    // One more accepted shot: exactly one new entry, next id, fresh when.
    const shotsBefore = shotEntries(st.log).length;
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'r-s1' } });
    assert.strictEqual(shotEntries(st.log).length, shotsBefore + 1, 'accepted shot adds one shot event');
    assert.strictEqual(st.log.length, before.len + 1, 'accepted shot adds exactly one entry');
    const last = st.log[st.log.length - 1];
    assert.strictEqual(last.id, before.seq + 1, 'next id in sequence');
    assert.strictEqual(last.when, T + 5000, 'fresh server time on the new event');
    console.log('EVENTS ok: 7 rejection paths silent, accepted shots add one');
  }

  // --- 4. bounded rollover keeps ids unique + increasing (31 events, 24 kept) ---
  let rollCtx;
  let rollSt;
  {
    const eng = createBuildBattle(EV_CFG);
    const ctx = stubCtx();
    rollCtx = ctx;
    const st = eng.create(ctx);
    rollSt = st;
    // Blue fills 10 walls (10x10 bricks); red shoots only walls, core live.
    const walls = [];
    for (let x = 0; x < 8; x++) walls.push([x, 5]);
    walls.push([0, 6], [1, 6]);
    walls.forEach(([x, y], i) => {
      const pid = i % 2 === 0 ? 'p1' : 'p3';
      eng.onAction(st, ctx, pid, { build: { piece: 'wall', x, y, nonce: 'w-b' + i } });
    });
    assert.strictEqual(Object.keys(st.grids.blue).length, 11, '10 walls + core');
    let T = T0 + 45000;
    ctx._now = T;
    fireLast(ctx);
    const everSeen = [];
    for (const e of st.log) everSeen.push(e.id);
    const shooters = ['p0', 'p2'];
    let target = 0;
    for (let s = 0; s < 30; s++) {
      T += 3000; // catapult window per shot
      ctx._now = T;
      while (target < walls.length && !st.grids.blue[walls[target][0] + ',' + walls[target][1]]) target += 1;
      assert(target < walls.length, 'walls must outlast the 30-shot loop');
      const [x, y] = walls[target];
      const before = st.log.length;
      eng.onAction(st, ctx, shooters[s % 2], { fire: { weapon: 'catapult', x, y, nonce: 'w-s' + s } });
      assert.strictEqual(st.phase, 'siege', 'walls alone never end the round');
      assert.strictEqual(st.log.length, Math.min(before + 1, 24), 'log stays within its bound');
      for (const e of st.log) {
        if (!everSeen.includes(e.id)) {
          assert(e.id > everSeen[everSeen.length - 1], 'global sequence never steps back');
          everSeen.push(e.id);
        }
      }
    }
    assert.deepStrictEqual(everSeen, Array.from({ length: 31 }, (_, i) => i + 1),
      'every minted id observed exactly once, 1..31 in order');
    assert.strictEqual(st.log.length, 24, 'state keeps the bounded 24');
    assertIncreasing(st.log, 'rolled-over log');
    assert.deepStrictEqual(idsOf(st.log)[0], 8, 'oldest evicted, newest kept (8..31)');
    assert.strictEqual(st.log[st.log.length - 1].id, 31, 'tail id matches the sequence');
    assert.strictEqual(st._eventSeq, 31, 'sequence counts every entry incl. evicted');
    const v = eng.view(st, 'p0');
    assert.strictEqual(v.log.length, 12, 'view keeps the bounded 12');
    assert.deepStrictEqual(idsOf(v.log), idsOf(st.log).slice(-12), 'view is the tail, same ids');
    console.log('EVENTS ok: rollover 31->24, ids contiguous 1..31, view tail 20..31');
  }

  // --- 5. monotonic across rounds; reconnect + watchers see the same ids ---
  {
    const eng = createBuildBattle(EV_CFG);
    const ctx = rollCtx;
    const st = rollSt;
    const maxBefore = st.log[st.log.length - 1].id;
    ctx._now = T0 + 500000;
    const bcBefore = ctx._broadcasts;
    fireLast(ctx); // siege deadline -> survive x2 + roundEnd -> round 2 build
    assert.strictEqual(st.phase, 'build', 'deadline opens round 2');
    assert.strictEqual(st.round, 2, 'round advanced');
    assert(ctx._broadcasts > bcBefore, 'round deadline still broadcasts');
    const fresh = st.log.slice(-3);
    assert.deepStrictEqual(fresh.map((e) => e.kind), ['survive', 'survive', 'roundEnd'],
      'deadline logs in legacy order');
    assert(fresh.every((e) => e.when === T0 + 500000), 'deadline events use the deadline clock');
    assertIncreasing(st.log, 'cross-round log');
    assert(st.log.every((e) => e.id > 0), 'no id reset at the round boundary');
    assert.strictEqual(st.log[st.log.length - 1].id, maxBefore + 3, 'sequence continues across rounds');
    assert.strictEqual(st.teams.red.points, 400 + 50, 'rules untouched: 300 dmg + 100 bonus + 50 survival');
    // Round 2 plays on with rising ids.
    eng.onAction(st, ctx, 'p1', { build: { piece: 'wall', x: 0, y: 5, nonce: 'm-b0' } });
    ctx._now = T0 + 600000;
    fireLast(ctx);
    ctx._now = T0 + 610000;
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'm-s0' } });
    assertIncreasing(st.log, 'round-2 log');
    assert.strictEqual(st.log[st.log.length - 1].id, maxBefore + 5, 'round 2 keeps rising');
    // Reconnect + every seat class: identical accepted sequence.
    const idsP0 = idsOf(eng.view(st, 'p0').log);
    const idsAgain = idsOf(eng.view(st, 'p0').log);
    assert.deepStrictEqual(idsAgain, idsP0, 'reconnect replays the same ids');
    for (const pid of ['p1', 'p2', 'p3', 'watcher-late']) {
      assert.deepStrictEqual(idsOf(eng.view(st, pid).log), idsP0,
        `same accepted sequence for ${pid}`);
    }
    assert.deepStrictEqual(eng.view(st, 'p0').log, eng.view(st, 'watcher-late').log,
      'participant and spectator snapshots match entry-for-entry');
    const v0 = eng.view(st, 'p0');
    assert((v0.cooldowns.catapult || 0) > ctx._now, 'shooter still sees own cooldown');
    assert.deepStrictEqual(eng.view(st, 'p2').cooldowns, {}, 'teammate sees no borrowed cooldown');
    assert.deepStrictEqual(eng.view(st, 'watcher-late').cooldowns, {}, 'watcher sees no cooldowns');
    for (const pid of ['p0', 'watcher-late']) {
      const v = eng.view(st, pid);
      assert(!('_eventSeq' in v) && !('seen' in v) && !('_cancel' in v), 'no internals leak');
    }
    console.log('EVENTS ok: cross-round monotonic, reconnect/watcher parity, no leaks');
  }

  // --- 6. client dedupe sim: each id plays exactly once, no doubles ---
  {
    const eng = createBuildBattle(EV_CFG);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    eng.onAction(st, ctx, 'p1', { build: { piece: 'wall', x: 0, y: 5, nonce: 'd-b0' } });
    eng.onAction(st, ctx, 'p0', { build: { piece: 'wall', x: 0, y: 2, nonce: 'd-r0' } });
    ctx._now = T0 + 45000;
    fireLast(ctx);
    const seenIds = new Set();
    const effects = [];
    const ingest = (log) => {
      let added = 0;
      for (const e of log) {
        if (!seenIds.has(e.id)) {
          seenIds.add(e.id);
          effects.push(e);
          added += 1;
        }
      }
      return added;
    };
    assert.strictEqual(ingest(eng.view(st, 'p0').log), 1, 'baseline: the siege entry');
    ctx._now = T0 + 60000;
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'd-s0' } });
    assert.strictEqual(ingest(eng.view(st, 'p0').log), 1, 'one accepted shot plays once');
    assert.strictEqual(effects[effects.length - 1].kind, 'hit', 'effect is the hit');
    assert.strictEqual(ingest(eng.view(st, 'p0').log), 0, 'same snapshot replays nothing');
    assert.strictEqual(ingest(eng.view(st, 'p1').log), 0, 'other team replays nothing');
    assert.strictEqual(ingest(eng.view(st, 'watcher').log), 0, 'watcher replays nothing');
    // Rejections add no playable event.
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'd-cool' } });
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'd-s0' } });
    eng.onAction(st, ctx, 'p2', { fire: { weapon: 'catapult', x: 7, y: 7, nonce: 'd-empty' } });
    eng.onAction(st, ctx, 'ghost', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'd-spec' } });
    assert.strictEqual(ingest(eng.view(st, 'p0').log), 0, 'cooling/replay/empty/spectator play nothing');
    ctx._now = T0 + 70000;
    eng.onAction(st, ctx, 'p2', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'd-s1' } });
    assert.strictEqual(ingest(eng.view(st, 'p0').log), 1, 'next accepted shot plays once');
    // Corefall: exactly one corefall effect, follow-ons are round events.
    st.grids.blue['3,7'].hp = 4;
    ctx._now = T0 + 80000;
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 3, y: 7, nonce: 'd-core' } });
    const before = effects.length;
    const added = ingest(eng.view(st, 'p0').log);
    assert(added >= 2, 'corefall plus round follow-ons arrive');
    const newOnes = effects.slice(before);
    assert.strictEqual(newOnes.filter((e) => e.kind === 'corefall').length, 1,
      'exactly one corefall effect');
    const fall = newOnes.find((e) => e.kind === 'corefall');
    assert.strictEqual(fall.victimTeam, 'blue', 'corefall names the fallen side');
    assert.strictEqual(fall.x, 3, 'corefall x matches the tapped cell');
    assert.strictEqual(fall.y, 7, 'corefall y matches the tapped cell');
    assert.strictEqual(newOnes.filter((e) => e.kind === 'hit' || e.kind === 'destroy').length, 0,
      'core kill emits no extra hit/destroy twin');
    assert.strictEqual(ingest(eng.view(st, 'watcher').log), 0, 'reconnect after corefall plays nothing twice');
    assertIncreasing(effects, 'played effects');
    console.log('EVENTS ok: dedupe by id, one corefall, no doubles on reconnect');
  }

  // --- 7. unlock entries join the same sequence; threshold `at` preserved ---
  {
    const cfg = JSON.parse(JSON.stringify(EV_CFG));
    cfg.pieces.cannon.unlockAt = 60;
    const eng = createBuildBattle(cfg);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    assert(!st.log.some((e) => e.kind === 'unlock'), 'starters still silent');
    ctx._now = T0 + 45000;
    fireLast(ctx);
    let T = T0 + 60000;
    for (let s = 0; s < 5; s++) { // bare core: 5x12 = 60 -> cannon
      ctx._now = T;
      eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 3, y: 7, nonce: 'u-s' + s } });
      T += 3000;
    }
    assert(st.teams.red.unlocks.includes('piece:cannon'), 'cannon earned at 60');
    const ups = st.log.filter((e) => e.kind === 'unlock');
    assert.strictEqual(ups.length, 1, 'unlock logged exactly once');
    assert.strictEqual(ups[0].at, 60, 'unlock threshold `at` preserved (not the round)');
    assert.strictEqual(ups[0].when, T0 + 60000 + 4 * 3000, 'unlock uses the triggering server clock');
    assertIncreasing(st.log, 'log with unlock');
    assert(ups[0].id > st.log[0].id && ups[0].id < st.log[st.log.length - 1].id + 1,
      'unlock id sits inside the same monotonic sequence');
    console.log('EVENTS ok: unlock sequenced, threshold at=60 intact');
  }

  // --- 8. final-deadline broadcast preserved (engine half of race T17) ---
  {
    const eng = createBuildBattle(EV_CFG);
    const ctx = stubCtx({ settings: { rounds: 1 } });
    const st = eng.create(ctx);
    assert.strictEqual(st.rounds, 1, 'one-round game');
    fireLast(ctx); // build deadline -> siege
    assert.strictEqual(st.phase, 'siege', 'siege runs');
    const bcSiege = ctx._broadcasts;
    assert(bcSiege >= 1, 'siege deadline broadcasts');
    fireLast(ctx); // idle final siege deadline -> done, no action involved
    assert.strictEqual(st.phase, 'done', 'final deadline finishes');
    assert(ctx._broadcasts > bcSiege, 'final deadline broadcasts the result');
    assert.strictEqual(st.endsAt, 0, 'terminal state clears the deadline');
    assert(st.result && st.result.winners.length >= 1, 'terminal state carries the result');
    const v = eng.view(st, 'watcher');
    assert.strictEqual(v.endsAt, 0, 'snapshot clears the deadline');
    assert(v.result, 'snapshot carries the result');
    console.log('EVENTS ok: idle final deadline still broadcasts done + result');
  }

  // --- 9. snapshot shape: complete ids, stable victimTeam, no private fields ---
  {
    const eng = createBuildBattle(EV_CFG);
    const ctx = stubCtx();
    const st = eng.create(ctx);
    eng.onAction(st, ctx, 'p1', { build: { piece: 'wall', x: 0, y: 5, nonce: 'q-b0' } });
    ctx._now = T0 + 45000;
    fireLast(ctx);
    ctx._now = T0 + 60000;
    eng.onAction(st, ctx, 'p0', { fire: { weapon: 'catapult', x: 0, y: 5, nonce: 'q-s0' } });
    eng.onAction(st, ctx, 'p1', { fire: { weapon: 'catapult', x: 3, y: 0, nonce: 'q-s1' } });
    for (const e of st.log) {
      assert(Number.isInteger(e.id) && e.id > 0, 'every state entry has a numeric id');
      assert(typeof e.when === 'number' && Number.isFinite(e.when), 'every entry has a numeric when');
      assert(typeof e.kind === 'string' && e.kind, 'every entry has a kind');
      assert(typeof e.at === 'number', 'every entry keeps legacy at');
      for (const k of ['pid', 'actor', 'shooter', 'cooldowns', 'readyAt', 'nonce', 'seatToken']) {
        assert(!(k in e), `no private field ${k} on ${e.kind}`);
      }
    }
    for (const e of shotEntries(st.log)) {
      assert(e.by === 'red' || e.by === 'blue', 'shot names its attacking team');
      assert.strictEqual(e.victimTeam, e.by === 'red' ? 'blue' : 'red', 'victimTeam is the other side');
      assert(typeof e.weapon === 'string' && e.weapon, 'shot names its weapon');
      assert(Number.isInteger(e.x) && Number.isInteger(e.y), 'shot carries int x/y');
    }
    assert(st.log.length <= 24, 'state log bounded at 24');
    const v = eng.view(st, 'p0');
    assert(v.log.length <= 12, 'view log bounded at 12');
    assert.deepStrictEqual(idsOf(v.log), idsOf(st.log).slice(-12), 'view ids match the state tail');
    // Per-instance scope: a restart/fresh instance starts its own sequence.
    const eng2 = createBuildBattle(EV_CFG);
    const ctx2 = stubCtx();
    const st2 = eng2.create(ctx2);
    fireLast(ctx2);
    assert.strictEqual(st2.log[0].id, 1, 'fresh instance restarts at id 1 (no fake globals)');
    console.log('EVENTS ok: snapshot shape complete, victimTeam stable, ids per-instance');
  }

  console.log('EVENTS_PASS');
}

main();
