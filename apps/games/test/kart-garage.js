// Planar-mutating unit fixtures use an explicit generic variant, not physical Pocket.
'use strict';
/* Garage Battle progression: room-scoped wallet, results-only purchases,
 * upgrade tuning, fast projectiles, and rocket splash — all on the real
 * Pocket Karts backend (no client, no deps).
 * - Selectable garage mode (rulesKey stays battle): Pocket Karts offers a
 *   Garage Battle mode (default Zap Battle); Star Rush ignores it; thin
 *   engine games without the flag never see the setting.
 * - Wallet: KO +10, crate pickup +1, participation +5, winners +15 extra,
 *   awarded exactly once server-side; persists across rematches, classic
 *   interludes, and away/back for the game; capped at 24 seats with
 *   ghost pruning; fixture fallback (no ctx.session) stays functional.
 * - Purchases: results-only, own connected seat only, validated id /
 *   balance / cap / stage / nonce (exact-once, bounded 200, clear
 *   errors); engine/handling/reload to 3 at 20/35/55; upgrades apply
 *   next garage rematch, classic stays unmodified (wallet persists).
 * - Tuning: engine +5% top+accel/level, handling +4% turn/level, reload
 *   -6% fire-cd/level; mirrored as kart tuning + public levels.
 * - Projectiles (garage pace): pulse 110/1.6, scatter 95/1.2, rocket 85
 *   (splash 3, LOS only, max 1 KO, TTL fizzles), rail 160/1.2 (first
 *   hit stops); sweeping, wall-first, and exactly-once hold; both battle modes
 *   use the complete, faster eight-weapon arsenal (grenade canisters +
 *   EMP discharge join the pool with no garage gate).
 * Run: node test/kart-garage.js */

const assert = require('assert');

const karts = require('./fixtures/kart-planar-variant.cjs');
const engine = require('../games/engines/kart-engine');
const battle = require('../games/engines/kart-rules-battle');
const { Rooms } = require('../server/room');

function stubCtx({ players, settings, now, session }) {
  const ctx = {
    _now: now !== undefined ? now : 8000000,
    _broadcasts: 0,
    _awards: {},
    _connected: null,
    _session: session || null,
    players() { return (this._connected || players).slice(); },
    allPlayers: () => players.slice(),
    content: () => ({}),
    settings: () => ({ ...(settings || {}) }),
    hostId: () => players[0].id,
    broadcast() { ctx._broadcasts += 1; },
    lobby() {},
    later: () => () => {},
    award(pid, pts) { ctx._awards[pid] = (ctx._awards[pid] || 0) + pts; },
    now: () => ctx._now,
  };
  if (session) ctx.session = () => session;
  return ctx;
}

function mkPlayers(n) {
  return Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
}

function racing(settings, n = 2, now = 8000000, session) {
  const players = mkPlayers(n);
  const ctx = stubCtx({ players, settings, now, session });
  const st = karts.create(ctx);
  ctx._now += 3000;
  karts.onTick(st, ctx);
  assert.strictEqual(st.phase, 'drive', 'countdown reaches drive');
  return [st, ctx];
}

function tick(ctx, st, ms = 100) {
  ctx._now += ms;
  karts.onTick(st, ctx);
}

function parkFar(st, except = []) {
  const c = st.bound - 4;
  let i = 0;
  for (const k of st.karts) {
    if (except.includes(k.pid)) continue;
    k.x = i % 2 === 0 ? c : -c;
    k.z = i % 4 < 2 ? c : -c;
    i += 1;
    k.angle = 0; k.speed = 0;
    k.input = { steer: 0, throttle: 0, boost: false };
  }
}

function finishTimeout(st, ctx) {
  for (const k of st.karts) { k.x = 20; k.z = 20; k.speed = 0; }
  st.karts[1].x = -20; st.karts[1].z = -20;
  ctx._now = st.endsAt + 1;
  karts.onTick(st, ctx);
  assert.strictEqual(st.phase, 'done', 'timeout finishes');
}

function main() {
  // --- 1. selectable garage mode, classic defaults, pocket-only setting ---
  {
    const mode = karts.manifest.settings.find((s) => s.key === 'mode');
    assert.deepStrictEqual(mode.options, ['Star Rush', 'Zap Battle', 'Garage Battle'], 'garage is a discoverable mode');
    assert.strictEqual(mode.def, 'Zap Battle', 'default mode unchanged');
    const bare = engine.createKartGame({ id: 'bare-karts', name: 'Bare' });
    assert(!bare.manifest.settings.some((s) => s.key === 'garage'), 'thin games lack garage');
    const [classic] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' });
    assert.strictEqual(classic.rulesKey, 'battle', 'classic rulesKey');
    assert.strictEqual(classic.garage, false, 'classic garage off');
    assert.strictEqual(karts.view(classic, 'p0').modeLabel, 'Zap Battle', 'classic label');
    const [gar] = racing({ mode: 'Garage Battle', map: 'Rookie Ring' });
    assert.strictEqual(gar.rulesKey, 'battle', 'garage keeps battle rulesKey');
    assert.strictEqual(gar.garage, true, 'garage flag on');
    assert.strictEqual(karts.view(gar, 'p0').modeLabel, 'Garage Battle', 'garage label');
    assert.strictEqual(karts.view(gar, 'p0').garage, true, 'view carries garage');
    const [rush] = racing({ mode: 'Star Rush', map: 'Rookie Ring', garage: true });
    assert.strictEqual(rush.garage, false, 'rush ignores garage');
    console.log('GARAGE ok: selectable mode, classic defaults, pocket-only setting');
  }

  // --- 2. rolls: full arsenal in both battle modes ---
  {
    const sample = (garage, n) => {
      const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', garage }, 2, 8100000);
      const seen = new Set();
      for (let i = 0; i < n; i++) {
        const k = st.karts[0];
        k.x = st.crates[i % st.crates.length].x;
        k.z = st.crates[i % st.crates.length].z;
        k.weapon = null;
        k.speed = 0;
        tick(ctx, st);
        if (k.weapon) seen.add(k.weapon);
      }
      return seen;
    };
    const classic = sample(false, 200);
    for (const w of classic) {
      assert(['pulse', 'scatter', 'mine', 'shield', 'rocket', 'rail', 'grenade', 'emp'].includes(w), 'classic rolls full arsenal, saw ' + w);
    }
    assert(classic.has('rocket') && classic.has('rail'), 'new weapons available without garage');
    assert(classic.has('grenade') && classic.has('emp'), 'grenade + emp available without garage');
    const garage = sample(true, 200);
    assert(garage.has('rocket'), 'garage rolls rockets');
    assert(garage.has('rail'), 'garage rolls rails');
    assert(garage.has('grenade') && garage.has('emp'), 'garage rolls grenades + emps');
    for (const w of garage) {
      assert(['pulse', 'scatter', 'mine', 'shield', 'rocket', 'rail', 'grenade', 'emp'].includes(w), 'garage rolls eight, saw ' + w);
    }
    console.log('GARAGE ok: both modes deal eight weapons');
  }

  // --- 3. KO +10 and pickup +1 exactly once (scatter fan, contested crate) ---
  {
    const session = {};
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', garage: true }, 2, 8200000, session);
    const [a, b] = st.karts;
    parkFar(st, ['p0', 'p1']);
    for (const c of st.crates) { c.x = 24; c.z = -24; }
    // Wounded victim isolates fan exact-once KO/economy.
    b.health=1;
    // Scatter fan: 3 pellets, one victim, one KO, +10 once.
    a.weapon = 'scatter'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
    a.x = 0; a.z = -6; a.angle = 0; a.speed = 0;
    b.x = 0; b.z = 0; b.angle = 0; b.speed = 0; b.shield = 0;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st);
    assert.strictEqual(b.deaths, 1, 'wounded fan victim KOs once');
    assert.strictEqual(a.hits, 1, 'fan scores once');
    assert.strictEqual(session.coins.p0, 10, 'KO pays +10 once, saw ' + session.coins.p0);
    assert.strictEqual(karts.view(st, 'p0').coins, 10, 'view projects +10');
    // Contested crate: roster-first claims the item and the +1.
    for (let i = 0; i < 25 && b.respawn > 0; i++) tick(ctx, st);
    assert.strictEqual(b.respawn, 0, 'victim rejoins');
    a.weapon = null; b.weapon = null;
    st.crates[0].x = 5; st.crates[0].z = 5;
    a.x = 5; a.z = 5; b.x = 5; b.z = 5; a.speed = 0; b.speed = 0;
    const before0 = session.coins.p0 || 0;
    const before1 = session.coins.p1 || 0;
    tick(ctx, st);
    assert(a.weapon, 'first claims');
    assert.strictEqual(b.weapon, null, 'second gets nothing');
    assert.strictEqual(session.coins.p0, before0 + 1, 'first banks +1');
    assert.strictEqual(session.coins.p1 || 0, before1, 'second banks nothing');
    console.log('GARAGE ok: KO +10 and pickup +1 exactly once');
  }

  // --- 4. participation +5, winners +15 extra, exactly once ---
  {
    const session = {};
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', garage: true }, 2, 8300000, session);
    st.karts[0].hits = 2;
    st.karts[1].hits = 1;
    finishTimeout(st, ctx);
    assert.deepStrictEqual(st.result.winners, ['p0'], 'p0 wins');
    assert.strictEqual(session.coins.p0, 5 + 15, 'winner banks 20, saw ' + session.coins.p0);
    assert.strictEqual(session.coins.p1, 5, 'loser banks 5, saw ' + session.coins.p1);
    const c0 = session.coins.p0;
    const c1 = session.coins.p1;
    for (let i = 0; i < 5; i++) tick(ctx, st);
    assert.strictEqual(session.coins.p0, c0, 'finish pays once (winner)');
    assert.strictEqual(session.coins.p1, c1, 'finish pays once (loser)');
    // Scoreless timeout: no winners, both bank participation only.
    const s2 = {};
    const [st2, ctx2] = racing({ mode: 'Zap Battle', map: 'Rookie Ring' }, 2, 8310000, s2);
    finishTimeout(st2, ctx2);
    assert.deepStrictEqual(st2.result.winners, ['p0', 'p1'], 'scoreless match is a draw shared by both');
    assert.strictEqual(st2.result.draw, true, 'scoreless match is flagged as a draw');
    assert.strictEqual(s2.coins.p0, 5, 'scoreless p0 banks 5');
    assert.strictEqual(s2.coins.p1, 5, 'scoreless p1 banks 5');
    console.log('GARAGE ok: participation +5, winners +15, exactly once');
  }

  // --- 5. purchases: results-only, own seat, id, balance, cap, nonce ---
  {
    const session = { coins: { p0: 200, p1: 5 }, upgrades: {}, seen: {}, seenOrder: [] };
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', garage: true }, 2, 8400000, session);
    // Wrong stage: drive rejects.
    let r = karts.onAction(st, ctx, 'p0', { garage: { category: 'engine', nonce: 'drive1' } });
    assert.strictEqual(r, undefined, 'purchase broadcasts');
    assert.match(karts.view(st, 'p0').garageResult.error, /results screen/, 'drive rejected');
    assert.strictEqual(session.coins.p0, 200, 'drive rejection charges nothing');
    finishTimeout(st, ctx); // p0/p1 bank +5 each (scoreless)
    assert.strictEqual(session.coins.p0, 205, 'finish banks before shopping');
    // Unknown id.
    karts.onAction(st, ctx, 'p0', { garage: { category: 'wings', nonce: 'bad1' } });
    assert.match(karts.view(st, 'p0').garageResult.error, /Unknown upgrade/, 'bad id rejected');
    // Cross-seat spend.
    karts.onAction(st, ctx, 'p0', { garage: { category: 'engine', nonce: 'x1', pid: 'p1' } });
    assert.match(karts.view(st, 'p0').garageResult.error, /own kart/, 'cross-seat rejected');
    // Missing nonce.
    karts.onAction(st, ctx, 'p0', { garage: { category: 'engine' } });
    assert.match(karts.view(st, 'p0').garageResult.error, /nonce/, 'nonce required');
    // Poor balance.
    karts.onAction(st, ctx, 'p1', { garage: { category: 'engine', nonce: 'poor1' } });
    assert.match(karts.view(st, 'p1').garageResult.error, /Need 20 coins/, 'poor rejected');
    assert.strictEqual(session.coins.p1, 10, 'poor charges nothing');
    // Escalating 20/35/55 to max 3.
    karts.onAction(st, ctx, 'p0', { garage: { category: 'engine', nonce: 'e1' } });
    assert.deepStrictEqual(karts.view(st, 'p0').garageResult, { ok: true, category: 'engine', level: 1, coins: 185, nonce: 'e1' }, 'engine 1 costs 20');
    karts.onAction(st, ctx, 'p0', { garage: { category: 'engine', nonce: 'e2' } });
    assert.strictEqual(session.coins.p0, 150, 'engine 2 costs 35');
    karts.onAction(st, ctx, 'p0', { garage: { category: 'engine', nonce: 'e3' } });
    assert.strictEqual(session.coins.p0, 95, 'engine 3 costs 55');
    assert.deepStrictEqual(session.upgrades.p0, { engine: 3, handling: 0, reload: 0 }, 'levels stored');
    karts.onAction(st, ctx, 'p0', { garage: { category: 'engine', nonce: 'e4' } });
    assert.match(karts.view(st, 'p0').garageResult.error, /max level 3/, 'at-cap rejected');
    assert.strictEqual(session.coins.p0, 95, 'cap charges nothing');
    // Duplicate nonce: no double charge.
    karts.onAction(st, ctx, 'p0', { garage: { category: 'handling', nonce: 'e1' } });
    assert.match(karts.view(st, 'p0').garageResult.error, /Duplicate/, 'replay rejected');
    assert.strictEqual(session.coins.p0, 95, 'replay charges nothing');
    assert.strictEqual(session.upgrades.p0.handling || 0, 0, 'replay levels nothing');
    // Disconnected seat cannot spend.
    ctx._connected = [{ id: 'p1', name: 'P1' }];
    karts.onAction(st, ctx, 'p0', { garage: { category: 'reload', nonce: 'off1' } });
    assert.match(karts.view(st, 'p0').garageResult.error, /Reconnect/, 'offline rejected');
    ctx._connected = null;
    // Star Rush results reject.
    const [sr, cr] = racing({ mode: 'Star Rush', map: 'Rookie Ring' }, 2, 8410000, {});
    finishTimeout(sr, cr);
    karts.onAction(sr, cr, 'p0', { garage: { category: 'engine', nonce: 'rush1' } });
    assert.match(karts.view(sr, 'p0').garageResult.error, /Zap Battle/, 'rush rejected');
    console.log('GARAGE ok: purchase validation (stage, seat, id, balance, cap, nonce)');
  }

  // Connected overflow seats watch, even when their room wallet has coins.
  {
    const session = { coins: { p8: 100 }, upgrades: {}, seen: {}, seenOrder: [] };
    const players = mkPlayers(9);
    const ctx = stubCtx({ players, settings: { mode: 'Garage Battle', map: 'Rookie Ring' }, now: 8490000, session });
    ctx.players = () => players.slice(0, 8); // Room gives the engine eight active seats.
    ctx.allPlayers = () => players.slice(0, 8);
    const st = karts.create(ctx);
    ctx._now += 3000; karts.onTick(st, ctx);
    finishTimeout(st, ctx);
    assert.strictEqual(karts.view(st, 'p8').youDrive, false, 'ninth seat watches');
    karts.onAction(st, ctx, 'p8', { garage: { category: 'engine', nonce: 'watcher-shop' } });
    assert.match(karts.view(st, 'p8').garageResult.error, /Only drivers/, 'watcher cannot buy');
    assert.strictEqual(session.coins.p8, 100, 'watcher wallet unchanged');
    assert(!session.upgrades.p8 || !session.upgrades.p8.engine, 'watcher gains no upgrade');
  }

  // --- 6. mirrored data: private wallet/result, public levels/tuning/prices ---
  {
    const session = { coins: { p0: 100, p1: 7 }, upgrades: { p0: { engine: 2, handling: 1, reload: 3 } }, seen: {}, seenOrder: [] };
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', garage: true }, 2, 8500000, session);
    const v0 = karts.view(st, 'p0');
    const v1 = karts.view(st, 'p1');
    assert.strictEqual(v0.coins, 100, 'owner sees own wallet');
    assert.strictEqual(v1.coins, 7, 'other sees own wallet');
    assert.strictEqual(typeof v0.coins, 'number', 'wallet projection is one own balance');
    assert(!('garageResults' in v0) && !('coinsMap' in v0), 'no private wallet or result maps exposed');
    assert.deepStrictEqual(v0.upgrades.p0, { engine: 2, handling: 1, reload: 3 }, 'public levels p0');
    assert.deepStrictEqual(v1.upgrades.p0, { engine: 2, handling: 1, reload: 3 }, 'levels visible to rivals');
    const k0 = v0.karts.find((k) => k.pid === 'p0');
    assert.deepStrictEqual(k0.upgrades, { engine: 2, handling: 1, reload: 3 }, 'kart carries levels');
    assert.deepStrictEqual(k0.tuning, { top: 1.1, accel: 1.1, turn: 1.04, reload: 0.82 }, 'tuning mirrors formulas');
    assert.deepStrictEqual(v0.garagePrices, { cats: ['engine', 'handling', 'reload'], prices: [20, 35, 55], max: 3 }, 'price table');
    assert.strictEqual(v0.garageResult, null, 'no result yet');
    assert.strictEqual(v0.simAt, st.lastTick, 'simAt mirrors lastTick');
    finishTimeout(st, ctx);
    karts.onAction(st, ctx, 'p0', { garage: { category: 'handling', nonce: 'm1' } });
    assert.strictEqual(karts.view(st, 'p0').garageResult.ok, true, 'buyer sees success');
    assert.strictEqual(karts.view(st, 'p1').garageResult, null, 'rival sees no result');
    assert.strictEqual(karts.view(st, 'p0').coins, 100 + 5 - 35, 'wallet updates (finish +5, handling 35)');
    console.log('GARAGE ok: mirrored wallet/levels/tuning/prices/results/simAt');
  }

  // --- 7. tuning applies in garage, classic unmodified; persists rematch ---
  {
    const session = { coins: {}, upgrades: { p0: { engine: 3, handling: 3, reload: 3 } }, seen: {}, seenOrder: [] };
    const drive = (settings, now) => {
      const [st, ctx] = racing(settings, 2, now, session);
      const k = st.karts[0];
      parkFar(st, ['p0']);
      k.x = 0; k.z = -20; k.angle = 0; k.speed = 0;
      return [st, ctx, k];
    };
    // Garage: higher top speed and sharper turn than stock.
    const [sg, cg, kg] = drive({ mode: 'Zap Battle', map: 'Rookie Ring', garage: true }, 8600000);
    assert.strictEqual(kg.garage, true, 'garage kart flagged');
    karts.onAction(sg, cg, 'p0', { input: { steer: 0, throttle: 1 } });
    for (let i = 0; i < 20; i++) {
      if (i % 5 === 0) karts.onAction(sg, cg, 'p0', { input: { steer: 0, throttle: 1 } });
      tick(cg, sg);
    }
    assert(kg.speed > engine.constants.MAX_SPEED, `tuned top exceeds stock, saw ${kg.speed.toFixed(2)}`);
    assert(kg.speed <= engine.constants.MAX_SPEED * 1.15 + 0.01, 'tuned top respects 1.15x');
    kg.x = 0; kg.z = -20; kg.angle = 0; kg.speed = 10;
    karts.onAction(sg, cg, 'p0', { input: { steer: 1, throttle: 1 } });
    tick(cg, sg);
    const tunedTurn = kg.angle;
    // Classic rematch, same wallet: stock physics, wallet persists.
    const [sc, cc, kc] = drive({ mode: 'Zap Battle', map: 'Rookie Ring' }, 8700000);
    assert.strictEqual(kc.garage, false, 'classic kart unflagged');
    assert.deepStrictEqual(kc.upgrades, { engine: 3, handling: 3, reload: 3 }, 'classic keeps owned levels');
    assert.deepStrictEqual(karts.view(sc, 'p0').karts[0].tuning, { top: 1, accel: 1, turn: 1, reload: 1 }, 'classic tuning flat');
    karts.onAction(sc, cc, 'p0', { input: { steer: 0, throttle: 1 } });
    for (let i = 0; i < 20; i++) {
      if (i % 5 === 0) karts.onAction(sc, cc, 'p0', { input: { steer: 0, throttle: 1 } });
      tick(cc, sc);
    }
    assert(kc.speed <= engine.constants.MAX_SPEED + 1e-9, `classic top stays stock, saw ${kc.speed.toFixed(2)}`);
    kc.x = 0; kc.z = -20; kc.angle = 0; kc.speed = 10;
    karts.onAction(sc, cc, 'p0', { input: { steer: 1, throttle: 1 } });
    tick(cc, sc);
    assert(Math.abs(tunedTurn) > Math.abs(kc.angle), 'tuned turn sharper than classic');
    // Reload: garage Pulse cooldown0.12*0.82, classic flat0.12.
    kg.weapon = 'pulse'; kg.ammo = 3; kg.fireCd = 0; kg.prevAction = false; kg.shield = 0;
    karts.onAction(sg, cg, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(cg, sg);
    assert(Math.abs(kg.fireCd - 0.12 * 0.82) < 0.11, `garage Pulse reload0.0984, saw ${kg.fireCd}`);
    kc.weapon = 'pulse'; kc.ammo = 3; kc.fireCd = 0; kc.prevAction = false; kc.shield = 0;
    karts.onAction(sc, cc, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(cc, sc);
    assert(Math.abs(kc.fireCd - 0.12) < 0.11, `classic Pulse reload0.12, saw ${kc.fireCd}`);
    console.log('GARAGE ok: tuning applies in garage, classic stock, persists rematch');
  }

  // --- 8. wallet persists away/back per game; sessions bounded by game id ---
  {
    const rooms = new Rooms({});
    const room = rooms.create();
    const fakeSock = () => ({ readyState: 1, send() {}, close() { this.readyState = 3; } });
    const sA = fakeSock();
    const sB = fakeSock();
    const { player: pa } = room.addPlayer('Ann', sA);
    room.addPlayer('Bob', sB);
    let r = room.startGame(karts, { settings: { mode: 'Garage Battle', map: 'Rookie Ring' } }, pa.id);
    assert(!r.error, 'garage starts: ' + (r.error || 'ok'));
    const st = room.game.state;
    st.karts[0].hits = 1;
    st.karts[0].x = 20; st.karts[0].z = 20;
    st.karts[1].x = -20; st.karts[1].z = -20;
    room.game.state.endsAt = Date.now() - 1;
    // Drive the finish through the real tick (awards +5/+15 into session).
    const sums = () => Object.values(room._sessions['pocket-karts'].coins || {});
    room.onTick();
    // If the 10 Hz wall clock has not elapsed, force the timeout path.
    if (room.game.state.phase !== 'done') {
      room.game.state.endsAt = 0;
      room.onTick();
    }
    assert.strictEqual(room.game.state.phase, 'done', 'room match finishes');
    assert(sums().reduce((a, b) => a + b, 0) >= 10, 'room session banks coins');
    const banked = JSON.stringify(room._sessions['pocket-karts'].coins);
    // Away to a foreign game id: pocket-karts session untouched.
    const foreign = {
      id: 'foreign-game', minPlayers: 2, maxPlayers: 24, manifest: {},
      create: () => ({ phase: 'lobby' }),
      onAction: () => {},
      onTick: () => {},
      view: () => ({}),
    };
    r = room.startGame(foreign, {}, pa.id);
    assert(!r.error, 'foreign starts');
    room.ctx().session().marker = 1;
    assert(room._sessions['foreign-game'], 'foreign session scoped');
    assert.strictEqual(JSON.stringify(room._sessions['pocket-karts'].coins), banked, 'away keeps wallet');
    // Back: the wallet is still there for the rematch.
    r = room.startGame(karts, { settings: { mode: 'Garage Battle', map: 'Rookie Ring' } }, pa.id);
    assert(!r.error, 'back starts');
    assert.strictEqual(JSON.stringify(room._sessions['pocket-karts'].coins), banked, 'back restores wallet');
    assert(Object.keys(room._sessions).length <= 64, 'sessions bounded');
    assert(!Object.prototype.hasOwnProperty.call(room._sessions, '__proto__'), 'no proto pollution');
    assert(!Object.prototype.hasOwnProperty.call(room._sessions, 'constructor'), 'no ctor pollution');
    console.log('GARAGE ok: wallet persists away/back, sessions game-scoped + bounded');
  }

  // --- 9. garage ballistics: fast swept pulse/rail wall + hull, no tunnel ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Bumper Blocks', garage: true }, 2, 8800000, {});
    st.karts.forEach(k=>k.health=1); // Wounded sweep/KO contract.
    const [a, b] = st.karts;
    for (const c of st.crates) { c.x = -24; c.z = 24; }
    const fireAs = (kind) => {
      a.weapon = kind; a.ammo = kind === 'pulse' ? 3 : 1;
      a.fireCd = 0; a.prevAction = false; a.shield = 0;
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    };
    // Pulse 110 across a 250 ms hitch still sweeps the hull (no teleport).
    a.x = 0; a.z = -12; a.angle = 0; a.speed = 0;
    b.x = 0; b.z = 2; b.angle = 0; b.speed = 0; b.shield = 0;
    fireAs('pulse');
    tick(ctx, st, 250);
    assert.strictEqual(a.hits, 1, 'hitch pulse sweeps the hull');
    assert.strictEqual(st.zaps.length, 0, 'impact consumes');
    assert.strictEqual(b.deaths, 1, 'hitch KO recorded');
    // Rail 160 stops at the first hull (tight slug, not piercing).
    const [st3, ctx3] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', garage: true }, 3, 8810000, {});
    st3.karts.forEach(k=>k.health=1); // Wounded sweep/KO contract.
    const [r0, r1, r2] = st3.karts;
    for (const c of st3.crates) { c.x = 24; c.z = 24; }
    r0.x = 0; r0.z = -14; r0.angle = 0; r0.speed = 0; r0.shield = 0;
    r0.weapon = 'rail'; r0.ammo = 1; r0.fireCd = 0; r0.prevAction = false;
    r1.x = 0; r1.z = 0; r1.speed = 0; r1.shield = 0;
    r2.x = 0; r2.z = 6; r2.speed = 0; r2.shield = 0;
    karts.onAction(st3, ctx3, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx3, st3);
    const rail = st3.zaps[0] || null;
    if (rail) assert.strictEqual(karts.view(st3, 'p0').zaps[0].speed, 160, 'rail pace 160');
    for (let i = 0; i < 3 && r1.respawn <= 0; i++) tick(ctx3, st3);
    assert(r1.respawn > 0, 'rail stops the first hull');
    assert.strictEqual(r2.respawn, 0, 'rail never pierces to the second');
    assert.strictEqual(r0.hits, 1, 'rail scores once');
    // Rail vs cover: the block swallows the 160 slug (swept, no tunnel).
    a.x = 16; a.z = 5; a.angle = 0; a.speed = 0;
    b.x = 16; b.z = 20; b.speed = 0; b.shield = 0; b.respawn = 0;
    a.respawn = 0;
    fireAs('rail');
    tick(ctx, st, 250);
    assert.strictEqual(st.zaps.length, 0, 'block swallows rail');
    assert.strictEqual(b.respawn, 0, 'cover protects the far hull');
    console.log('GARAGE ok: fast swept pulse/rail (hull, first-stop, wall, no tunnel)');
  }

  // --- 10. wounded rocket KO/splash/cover contracts and full-health area damage ---
  {
    const mk = (now) => {const r=racing({ mode: 'Zap Battle', map: 'Bumper Blocks', garage: true }, 3, now, {});r[0].karts.forEach(k=>k.health=1);return r;};
    // Direct hit KOs.
    {
      const [st, ctx] = mk(8900000);
      const [a, b] = st.karts;
      for (const c of st.crates) { c.x = -24; c.z = 24; }
      a.weapon = 'rocket'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
      a.x = 0; a.z = -8; a.angle = 0; a.speed = 0;
      b.x = 0; b.z = 0; b.speed = 0; b.shield = 0;
      st.karts[2].x = 24; st.karts[2].z = 24;
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      tick(ctx, st);
      assert(b.respawn > 0, 'rocket direct KOs');
      assert.strictEqual(a.hits, 1, 'rocket scores once');
    }
    // Splash KO: wall impact blasts a neighbor 2u away (no direct hit).
    {
      const [st, ctx] = mk(8910000);
      const [a, b] = st.karts;
      for (const c of st.crates) { c.x = -24; c.z = 24; }
      st.karts[2].x = -24; st.karts[2].z = -24;
      a.weapon = 'rocket'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
      a.x = 16; a.z = 5; a.angle = 0; a.speed = 0; // fires into the (16,16) block
      b.x = 16; b.z = 11.5; b.speed = 0; b.shield = 0; // 2u short of the face
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      tick(ctx, st);
      assert(b.respawn > 0, 'splash KOs near the impact');
      assert.strictEqual(a.hits, 1, 'splash scores once');
    }
    // Wall blocks splash: victim behind the block is safe.
    {
      const [st, ctx] = mk(8920000);
      const [a, b] = st.karts;
      for (const c of st.crates) { c.x = -24; c.z = 24; }
      st.karts[2].x = -24; st.karts[2].z = -24;
      a.weapon = 'rocket'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
      a.x = 16; a.z = 5; a.angle = 0; a.speed = 0;
      b.x = 16; b.z = 20; b.speed = 0; b.shield = 0; // behind the block from the blast
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      tick(ctx, st);
      assert.strictEqual(b.respawn, 0, 'cover blocks splash');
      assert.strictEqual(a.hits, 0, 'blocked blast scores nothing');
      assert.strictEqual(st.zaps.length, 0, 'rocket consumed on the block');
    }
    // One area damage per full-health victim, including the direct target.
    {
      const [st, ctx] = mk(8930000);
      const [a, b, c] = st.karts;
      b.health=c.health=100;
      for (const k of st.crates) { k.x = -24; k.z = 24; }
      a.weapon = 'rocket'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
      a.x = 0; a.z = -8; a.angle = 0; a.speed = 0;
      b.x = 0.5; b.z = 0; b.speed = 0; b.shield = 0;
      c.x = -0.5; c.z = 0; c.speed = 0; c.shield = 0;
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      tick(ctx, st);
      const down = [b, c].filter((k) => k.respawn > 0).length;
      assert.strictEqual(down, 1, 'one rocket knocks out its direct full-health rival');
      assert.strictEqual(a.hits, 1, 'direct Rocket KO scores once');
      const hits=st.events.filter(e=>e.type==='hit');assert(hits.length===2&&hits.filter(e=>e.damage===100&&e.health===0).length===1&&hits.filter(e=>e.damage===40&&e.health===60).length===1,'one direct100-health KO and one indirect40-damage wound');
      assert.strictEqual(new Set(hits.map(e=>e.other)).size,hits.length,'direct and splash cannot double-count a victim');
    }
    // Owner immune to own blast; TTL fizzle blasts nothing.
    {
      const [st, ctx] = mk(8940000);
      const [a, b] = st.karts;
      for (const c of st.crates) { c.x = -24; c.z = 24; }
      st.karts[2].x = -24; st.karts[2].z = -24;
      a.weapon = 'rocket'; a.ammo = 1; a.shield = 0; a.fireCd = 0; a.prevAction = false;
      a.x = 0; a.z = 5; a.angle = 0; a.speed = 0;
      b.x = 0; b.z = 8; b.speed = 0; b.shield = 0; // ahead of the muzzle
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      tick(ctx, st);
      assert.strictEqual(a.respawn, 0, 'owner immune to own blast');
      // Fizzle: a lone rocket expires short of a far victim: no blast.
      st.zaps.push({ id: 'zfz', owner: 'p0', kind: 'rocket', x: 0, z: -20, angle: Math.PI, ttl: 0.05 });
      b.x = 0; b.z = -27; b.respawn = 0; b.shield = 0;
      tick(ctx, st);
      assert.strictEqual(st.zaps.length, 0, 'expired rocket clears');
      assert.strictEqual(b.respawn, 0, 'TTL fizzle blasts nothing');
    }
    console.log('GARAGE ok: rockets (wounded KO, full-health damage, walls, owner-safe, fizzle)');
  }

  // --- 11. authoritative fire/mine/shield events (one per acceptance) ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', garage: true }, 2, 9000000, {});
    const a = st.karts[0];
    parkFar(st, ['p0']);
    a.x = 0; a.z = -20; a.angle = 0; a.speed = 0; a.shield = 0; a.fireCd = 0; a.prevAction = false;
    const fireKind = (kind) => {
      a.weapon = kind; a.ammo = kind === 'pulse' ? 3 : 1; a.fireCd = 0; a.prevAction = false;
      const n = st.events.length;
      karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
      tick(ctx, st);
      return st.events.slice(n);
    };
    for (const kind of ['pulse', 'scatter', 'rocket', 'rail']) {
      const evs = fireKind(kind);
      assert.strictEqual(evs.filter((e) => e.type === 'fire').length, 1, `${kind} emits one fire`);
      assert.strictEqual(evs.find((e) => e.type === 'fire').weapon, kind, `${kind} fire carries weapon`);
      assert.strictEqual(a.hits, 0, 'no input-predicted KO');
    }
    const mineEvs = fireKind('mine');
    assert.strictEqual(mineEvs.filter((e) => e.type === 'mine').length, 1, 'mine emits one mine event');
    assert.strictEqual(mineEvs.find((e) => e.type === 'mine').weapon, 'mine', 'mine carries weapon');
    const shEvs = fireKind('shield');
    assert.strictEqual(shEvs.filter((e) => e.type === 'shield').length, 1, 'shield emits once');
    assert.strictEqual(shEvs.find((e) => e.type === 'shield').weapon, 'shield', 'shield carries weapon');
    // Capped fire is silent: no event, item kept.
    for (let i = st.zaps.length; i < 64; i++) {
      st.zaps.push({ id: 'zcap' + i, owner: 'p1', kind: 'pulse', x: 20, z: 20, angle: 0, ttl: 1 });
    }
    const n = st.events.length;
    fireKind('pulse');
    assert.strictEqual(st.events.length, n, 'capped fire emits nothing');
    assert.strictEqual(a.weapon, 'pulse', 'capped fire keeps the item');
    // Zap view carries velocity data for rendering.
    st.zaps.length = 0;
    fireKind('rail');
    const zv = karts.view(st, 'p0').zaps[0];
    assert.strictEqual(zv.kind, 'rail', 'zap kind projected');
    assert.strictEqual(zv.speed, 160, 'zap speed projected');
    assert(Number.isFinite(zv.ttl) && zv.ttl > 0, 'zap ttl projected');
    assert(Number.isFinite(zv.vx) && Number.isFinite(zv.vz), 'zap velocity projected');
    assert.strictEqual(typeof zv.angle, 'number', 'zap angle projected');
    console.log('GARAGE ok: authoritative fire/mine/shield events + zap projection');
  }

  // --- 12. fixture fallback (no ctx.session) stays functional, caps hold ---
  {
    const players = mkPlayers(2);
    const ctx = stubCtx({ players, settings: { mode: 'Garage Battle', map: 'Rookie Ring' }, now: 9100000 });
    assert.strictEqual(typeof ctx.session, 'undefined', 'legacy fixture lacks session');
    const st = karts.create(ctx);
    ctx._now += 3000;
    karts.onTick(st, ctx);
    const [a, b] = st.karts;
    b.health=1; // Wounded KO isolates fallback economy persistence.
    a.x = 0; a.z = -8; a.angle = 0; a.speed = 0; a.shield = 0;
    a.weapon = 'pulse'; a.ammo = 3; a.fireCd = 0; a.prevAction = false;
    b.x = 0; b.z = 0; b.speed = 0; b.shield = 0;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st);
    tick(ctx, st);
    assert.strictEqual(a.hits, 1, 'fallback KO scores');
    assert.strictEqual(karts.view(st, 'p0').coins, 10, 'fallback wallet banks KO');
    finishTimeout(st, ctx);
    assert(karts.view(st, 'p0').coins >= 15, 'fallback banks finish');
    karts.onAction(st, ctx, 'p0', { garage: { category: 'engine', nonce: 'fb1' } });
    assert.strictEqual(karts.view(st, 'p0').garageResult.ok, true, 'fallback purchase works');
    // Nonce store stays bounded under replay pressure.
    const store = st._garageLocal;
    for (let i = 0; i < 250; i++) {
      karts.onAction(st, ctx, 'p0', { garage: { category: 'reload', nonce: 'spam' + i } });
    }
    assert(store.seenOrder.length <= 200, `nonces bounded, saw ${store.seenOrder.length}`);
    // Wallet never exceeds 24 seats: ghosts yield to drivers.
    const roomy = { coins: {}, upgrades: {}, seen: {}, seenOrder: [] };
    for (let i = 0; i < 24; i++) roomy.coins['ghost' + i] = i + 1;
    const [sw, cw] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', garage: true }, 2, 9110000, roomy);
    finishTimeout(sw, cw);
    assert(Object.keys(roomy.coins).length <= 24, 'wallet capped at 24');
    assert(roomy.coins.p0 >= 5 && roomy.coins.p1 >= 5, 'drivers bank through the cap');
    console.log('GARAGE ok: fixture fallback, bounded nonces, 24-seat wallet cap');
  }

  // --- 13. caps kept: 64 projectiles, 16 mines, 12 events ---
  {
    const [st, ctx] = racing({ mode: 'Zap Battle', map: 'Rookie Ring', garage: true }, 2, 9200000, {});
    assert.strictEqual(battle.constants.MAX_ZAPS, 64, 'zap cap 64');
    assert.strictEqual(battle.constants.MAX_MINES, 16, 'mine cap 16');
    assert.strictEqual(battle.constants.MAX_GRENADES, 12, 'grenade cap 12');
    assert.strictEqual(battle.constants.MAX_EVENTS, 12, 'event cap 12');
    assert.strictEqual(engine.constants.GARAGE_NONCE_CAP, 200, 'nonce cap 200');
    for (let i = 0; i < 70; i++) {
      st.zaps.push({ id: 'zx' + i, owner: 'p1', kind: 'pulse', x: 20, z: 20, angle: 0, ttl: 1 });
    }
    const a = st.karts[0];
    a.weapon = 'rocket'; a.ammo = 1; a.fireCd = 0; a.prevAction = false; a.shield = 0;
    karts.onAction(st, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
    tick(ctx, st);
    assert.strictEqual(a.weapon, 'rocket', 'zap cap keeps the rocket loaded');
    console.log('GARAGE ok: caps (64 zaps, 16 mines, 12 grenades, 12 events, 200 nonces)');
  }

  console.log('KART_GARAGE_PASS');
}

main();
