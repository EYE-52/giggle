'use strict';

const assert = require('node:assert/strict');
const COMBAT = require('../games/engines/kart-combat-config').config;
const { Room } = require('../server/room');
const { actionWindow } = require('../games/_sdk');
const { createElevatedCombat } = require('../games/engines/kart-elevated-combat');
const { loadElevatedDependencies } = require('../games/engines/kart-elevated-adapter');

let checks = 0;
const ok = (value, label) => { assert.ok(value, label); checks++; };
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const freshDef = () => {
  delete require.cache[require.resolve('../games/pocket-karts/server')];
  return require('../games/pocket-karts/server');
};
const socket = () => ({ readyState: 1, frames: [], bufferedAmount: 0,
  send(value) { this.frames.push(JSON.parse(value)); }, close() { this.readyState = 3; } });
const latest = ws => ws.frames.filter(f => f.t === 'state').at(-1);
function room(def, count = 2, giggle = false) {
  const r = new Room('TEST', {}, giggle ? { giggle: { squadId: 'test' } } : {});
  const clients = Array.from({ length: count }, (_, i) => {
    const ws = socket();
    const p = giggle ? r.addGigglePlayer('sub-' + i, 'Driver ' + i, ws).player : r.addPlayer('Driver ' + i, ws).player;
    return { ws, p };
  });
  return { r, clients, start: settings => r.startGame(def, { settings }, r.hostId) };
}
const settings = map => ({ map, mode: 'Zap Battle', winRule: 'Time limit', roundSeconds: 60 });
const input = (s, seq, extra = {}) => ({ type: 'input', seq, life: s.inputAck.life, controlEpoch: s.inputAck.controlEpoch,
  steer: 0, throttle: 0, brake: 0, nitro: false, use: false, ...extra });
function send(r, client, action, meta) {
  const s = latest(client.ws);
  r.onAction(client.ws, action, meta === undefined ? { i: s.instanceId, w: s.w } : meta);
}
function diagnosticMap(id) {
  const point = (name, x, z, angle = 0) => ({ id: name, surface: 'floor', x, y: 0, z, angle });
  return { id, revision: 'production-integration-diagnostic-1', name: id === 'garden' ? 'Alpine Courtyard' : id === 'frost' ? 'Frost Quarry' : 'Neon Harbor',
    environment: id, half: 60,
    colliders: [{ id: 'floor', shape: 'box', half: { x: 60, y: 1, z: 60 }, position: { x: 0, y: -1, z: 0 } }],
    spawns: [point('a', 0, 0), point('b', 0, 10, Math.PI)],
    sockets: [point('s0', -0.7, 0), point('s1', 0.7, 0)] };
}

async function main() {
  const def = freshDef(), unready = room(def);
  const probe = { id: 'probe', create: () => ({ phase: 'play', endsAt: 123 }), onAction() {}, view: s => s,
    dispose() { probe.disposals++; }, disposals: 0 };
  eq(unready.r.startGame(probe, {}, unready.clients[0].p.id), { ok: true });
  const old = unready.r.game;
  for (const bad of [{ ...settings('Alpine Courtyard'), mode: 'Star Rush' },
    { ...settings('Frost Quarry'), mode: 'Garage Battle' }, { ...settings('Neon Harbor'), winRule: 'Score target' }]) {
    ok(unready.start(bad).error.includes('unavailable'), 'all arenas fail closed before initialization');
    eq(unready.r.game, old, 'preflight preserves active game');
    eq(probe.disposals, 0, 'preflight never disposes old game');
    eq(unready.r.config['pocket-karts'], undefined, 'failed start leaves stored settings unchanged');
  }
  ok(unready.start(settings('Alpine Courtyard')).error.includes('unavailable'), 'new map is unavailable before initialization');
  eq(unready.r.game, old);
  const base = await loadElevatedDependencies();
  eq(base.RAPIER.version(), '0.21.0', 'pinned Rapier initializes before synchronous create');
  const labels = def.manifest.settings.find(s => s.key === 'map');
  eq(labels.options, ['Rookie Ring', 'Bumper Blocks', 'Garden Circuit', 'Frosty Pass', 'Neon Yard', 'Alpine Courtyard', 'Frost Quarry', 'Neon Harbor', 'Harbor Heights']);
  eq(labels.def, 'Garden Circuit', 'classic default unchanged');
  const mode = def.manifest.settings.find(s => s.key === 'mode');
  eq(mode.options, ['Star Rush', 'Zap Battle', 'Garage Battle']);

  let frees = 0, creations = 0, loaderCalls = 0, resolveLoad;
  class CountedWorld extends base.RAPIER.World {
    constructor(...args) { super(...args); creations++; }
    free() { frees++; super.free(); }
  }
  const matches = new Map(), advances = new Map(), snapshots = new Map(), privateReads = new Map();
  const tracked = { ...base, config: structuredClone(base.config), maps: structuredClone(base.maps), RAPIER: { ...base.RAPIER, World: CountedWorld },
    createMatch(R, C, M, seats, opts) {
      const match = createElevatedCombat(R, C, M, seats, opts);
      matches.set(opts.instance, match); advances.set(opts.instance, 0); snapshots.set(opts.instance, 0); privateReads.set(opts.instance, 0);
      return Object.freeze({ ...match, snapshot(pid) { snapshots.set(opts.instance, snapshots.get(opts.instance)+1); return match.snapshot(pid); }, privateStatus(pid) { privateReads.set(opts.instance, privateReads.get(opts.instance)+1); return match.privateStatus(pid); }, advance(now) { advances.set(opts.instance, advances.get(opts.instance) + 1); return match.advance(now); } });
    } };
  const initializing = def.initialize(() => { loaderCalls++; return new Promise(resolve => { resolveLoad = resolve; }); });
  await Promise.resolve();
  ok(unready.start(settings('Alpine Courtyard')).error.includes('unavailable'), 'pending init leaves elevated starts unavailable');
  const secondInit = def.initialize(() => { throw Error('second loader must not run'); });
  resolveLoad(tracked); await initializing; await secondInit;
  eq(loaderCalls, 1, 'initialize runs once and does not replace dependencies');
  for (const bad of [{ ...settings('Alpine Courtyard'), mode: 'Star Rush' },
    { ...settings('Frost Quarry'), mode: 'Garage Battle' }]) {
    ok(unready.start(bad).error.includes('require Zap Battle'), 'initialized unsupported combination stays rejected');
    eq(unready.r.game, old);eq(probe.disposals,0);
  }
  eq(def.preflight({ ...settings('Neon Harbor'), winRule: 'Score target' }), { ok: true }, 'elevated arenas accept a score target');
  eq(def.preflight({ map: 'Garden Circuit' }), { ok: true }, 'initialized original arena available');
  tracked.maps.garden.half = 400; tracked.config.gravity = { x: 0, y: 100, z: 0 };

  const originalNow = Date.now;
  let now = 1000000;
  Date.now = () => now;
  try {
    for (const label of ['Alpine Courtyard', 'Frost Quarry', 'Neon Harbor', 'Harbor Heights']) {
      const t = room(def, 24), { r, clients } = t;
      for (const key of ['initialHealth', 'health', 'maxHealth']) {
        ok(t.start({ ...settings(label), [key]: 1 }).error.includes('Unknown setting'), 'production Room rejects diagnostic health settings');
        eq(r.game, null, 'rejected diagnostic health never creates a game');
        eq(r.config['pocket-karts'], undefined, 'rejected diagnostic health never persists in configuration');
      }
      eq(t.start(settings(label)), { ok: true }, label + ' real authored map starts synchronously');
      const s = latest(clients[0].ws), i = s.instanceId, ctx = r.ctx();
      ok(r.game.state && typeof r.game.state.then !== 'function', 'create returns state, not a Promise');
      eq(s.map.label, label); eq(s.map.half, label==='Harbor Heights'?86:60, 'injected map remains immutable');
      eq(s.profile, 'elevated-combat-v1'); eq(s.waitForResult, true);
      eq(s.configVersion, 1); eq(s.physicsVersion, 2); eq(s.mapRevision, 'combat-elevation-1');
      eq(s.karts.length, 8); eq(s.players.length, 8); eq(s.spectators.length, 16);
      eq(typeof s.you, 'string', 'outer you remains player ID');
      ok(s.inputAck && !('coins' in s.inputAck) && !('you' in def.view(r.game.state, s.you)), 'ACK cannot overwrite envelope');
      ok(s.karts.every(k => !('name' in k) && !('coins' in k) && !('contact' in k.pose.wheels[0]) && !('surfaceId' in k.pose.wheels[0])), 'compact poses strip duplicated names and diagnostics');
      ok(s.karts.every(k => k.pose.position.y > 0.5 && k.pose.position.y < 0.9 && k.pose.rotation.w !== undefined && k.pose.linearVelocity.y !== undefined), 'full supported pose survives projection');
      eq(latest(clients[23].ws).inputAck, null, 'seat-cap watcher has no ACK');
      eq(latest(clients[23].ws).coins, 0, 'watcher has no wallet');
      eq(ctx.instanceId, i); assert.throws(() => { ctx.instanceId = 'forged'; }); checks++;
      const before = advances.get(i), snapshot = JSON.stringify(def.view(r.game.state, s.you));
      for (let n = 0; n < 24; n++) def.view(r.game.state, clients[n].p.id);
      eq(advances.get(i), before, 'view never advances World');
      eq(JSON.stringify(def.view(r.game.state, s.you)), snapshot, 'view has no simulation side effects');
      now += 49; r.onTick(now); eq(advances.get(i), before, 'instance gate waits 50ms');
      const readsBefore=privateReads.get(i), snapshotsBefore=snapshots.get(i);
      now += 1; r.onTick(now); eq(advances.get(i), before + 1, 'one advance per room pump');
      eq(snapshots.get(i), snapshotsBefore, 'pump never rebuilds full world for private ACKs');
      eq(privateReads.get(i)-readsBefore, 8, 'pump reads eight compact private statuses');
      r.broadcastState(); eq(advances.get(i), before + 1, 'broadcast does not advance per seat');
      const slow = clients[23].ws, slowFrames = slow.frames.length;
      slow.bufferedAmount = 9000; now += 50; r.onTick();
      eq(slow.frames.length, slowFrames, 'backlogged watcher skips discardable elevated tick');
      slow.bufferedAmount = 0; r.broadcastState();
      const after = latest(clients[0].ws), action = input(after, 1, { throttle: 1 });
      for (const meta of [{}, { i }, { w: after.w }, { i: 'wrong', w: after.w }, { i, w: 'wrong' }]) send(r, clients[0], action, meta);
      now += 50; r.onTick(); eq(latest(clients[0].ws).inputAck.receivedSeq, 0, 'missing/wrong outer i/w are rejected');
      send(r, clients[0], action); send(r, clients[0], action);
      now += 50; r.onTick(); eq(latest(clients[0].ws).inputAck.receivedSeq, 1, 'duplicate sequence accepted once');
      for (const extra of [{ x: 999 }, { position: { x: 999, y: 999, z: 999 } }, { life: 999 }, { controlEpoch: 999 }, { throttle: NaN }, { health: 1 }, { maxHealth: 1 }, { initialHealth: 1 }]) {
        send(r, clients[0], input(latest(clients[0].ws), 2, extra));
      }
      send(r, clients[23], action);
      now += 50; r.onTick(); eq(latest(clients[0].ws).inputAck.receivedSeq, 1, 'coordinates malformed values stale life and watcher intents do not enter queue');
      eq(latest(clients[0].ws).karts.map(k => [k.health, k.maxHealth]), Array.from({ length: 8 }, () => [100, 100]), 'health fields in client inputs cannot mutate production authority');
      now = after.liveAt; r.onTick();
      eq(r.game.state.phase, 'live'); eq(r.game.state.endsAt, after.deadline, 'live deadline is stable from start');
      eq(actionWindow(r.game.state), '{"phase":"live"}');
      send(r, clients[0], input(latest(clients[0].ws), 2, { use: true }), { i, w: after.w });
      now += 50; r.onTick(); eq(latest(clients[0].ws).inputAck.receivedSeq, 1, 'actual previous countdown window cannot fire in live');
      const drive = latest(clients[0].ws); send(r, clients[0], input(drive, 2, { throttle: 1, nitro: true }));
      now += 150; r.onTick();
      const moving = latest(clients[0].ws).karts[0];
      ok(Math.hypot(...Object.values(moving.pose.linearVelocity)) > 0.1, 'real legal intent moves physical body');
      const oldSocket = clients[0].ws; r.disconnect(oldSocket);
      const frozen = def.view(r.game.state, clients[1].p.id).karts[0];
      eq(frozen.connected, false, 'disconnect hook updates authority immediately');
      eq(frozen.pose.linearVelocity, { x: 0, y: 0, z: 0 }); eq(frozen.pose.angularVelocity, { x: 0, y: 0, z: 0 });
      now += 500; r.onTick(); eq(def.view(r.game.state, clients[1].p.id).karts[0].pose.position, frozen.pose.position, 'offline body freezes all axes');
      const resumed = socket(); r.addPlayer(clients[0].p.name, resumed, clients[0].p.token); clients[0].ws = resumed; r.broadcastState();
      const resumedView = latest(resumed);
      ok(resumedView.inputAck.controlEpoch > drive.inputAck.controlEpoch, 'resume clears held controls with fresh epoch');
      eq(resumedView.karts[0].pose.position, frozen.pose.position);
      r.disconnect(oldSocket); eq(clients[0].p.connected, true, 'stale socket close cannot clobber resume');
      const replacement = socket(), epoch = resumedView.inputAck.controlEpoch;
      r.addPlayer(clients[0].p.name, replacement, clients[0].p.token); clients[0].ws = replacement; r.broadcastState();
      ok(latest(replacement).inputAck.controlEpoch >= epoch + 2, 'attached socket replacement also releases controls');
      eq(resumed.readyState, 3, 'old socket is closed');
      slow.bufferedAmount = 9000; now = after.deadline; r.onTick();
      const done = latest(replacement);
      eq(latest(slow).phase, 'done', 'terminal result reaches backlogged watcher'); slow.bufferedAmount = 0;
      eq(done.phase, 'done'); eq(done.endsAt, 0); eq(done.result.winners, done.result.standings.map(s => s.pid)); eq(done.result.winner, null);
      eq(done.result.draw, true, 'zero KOs for everyone is a draw');
      ok(done.result.standings.every(s => s.rank === 1 && done.totals[s.pid] === 150), 'a zero-KO draw gives each driver 150, never a fabricated sole winner');
      eq(done.events.find(e => e.type === 'result').winners, done.result.winners, 'result event matches normalized zero-KO result');
      const totals = { ...r.totals }, ticks = advances.get(i);
      now += 5000; r.onTick(); r.broadcastState(); eq(r.totals, totals); eq(advances.get(i), ticks, 'done match is never advanced or awarded again');
      const originalFrees = frees;
      ok(r.startGame(def, { settings: settings(label) }, clients[0].p.id).error.includes('Only the host'), 'resumed earlier seat does not reclaim host');
      const oldState = r.game.state;
      eq(t.start(settings(label)), { ok: true }, 'normal Room start rematches');
      eq(frees, originalFrees + 1, 'rematch frees old World once');
      ok(r.game.instanceId !== i && latest(replacement).inputAck.receivedSeq === 0, 'rematch starts fresh instance/ACK');
      send(r, clients[0], action, { i, w: done.w }); now += 50; r.onTick(); eq(latest(replacement).inputAck.receivedSeq, 0, 'old instance cannot inject rematch controls');
      def.onTick(oldState, ctx); eq(def.onAction(oldState, ctx, clients[0].p.id, action), false);
      eq(advances.get(i), ticks, 'retained callbacks never retry disposed World');
      eq(ctx.instanceId, i, 'retained context cannot acquire a later instance identity');
      r.destroy(); r.destroy(); eq(matches.get(i).stats().disposed, true);
    }
    const classic = room(def);
    eq(classic.start({ mode: 'Star Rush', map: 'Garden Circuit', winRule: 'Score target' }), { ok: true });
    const c = classic.r, oldTick = c.game.state.lastTick;
    now += 50; c.onTick(now); eq(c.game.state.lastTick, now, 'physical original map pumps at 50ms');
    now += 50; c.onTick(now); eq(c.game.state.lastTick, now, 'next physical 50ms tick advances once');
    const fixed = c.game.state.lastTick; c.onTick(); eq(c.game.state.lastTick, fixed, 'manual same-clock tick contract retained');
    c.onAction(classic.clients[0].ws, { input: { throttle: 1, steer: 0 } });
    eq(c.game.state.karts[0].input.throttle, 0, 'unstamped physical input rejected');
    const classicFrame = latest(classic.clients[0].ws), ack = classicFrame.inputAck;
    send(c, classic.clients[0], { seq: 1, life: ack.life, controlEpoch: ack.controlEpoch,
      input: { throttle: 1, steer: 0, boost: false } });
    eq(c.game.state.karts[0].input.throttle, 1, 'current acknowledged physical input accepted');
    eq(latest(classic.clients[0].ws).motionProfile, 'rapier-classic-v1');
    eq(c.game.state.mode, 'starrush'); ok(!latest(classic.clients[0].ws).profile, 'classic packet path unchanged');
    c.destroy();

    const counts = { elevated: 0, classic: 0 }, cadenceDef = { ...def, onTick(state, ctx) {
      counts[state.profile ? 'elevated' : 'classic']++; def.onTick(state, ctx);
    } };
    const elevatedCadence = room(cadenceDef), classicCadence = room(cadenceDef), origin = now;
    elevatedCadence.start(settings('Alpine Courtyard')); classicCadence.start({ map: 'Garden Circuit' });
    for (let n = 1; n <= 41; n++) {
      now = origin + n * 25 - (n % 2 === 0 ? 1 : 0);
      elevatedCadence.r.onTick(now); classicCadence.r.onTick(now);
    }
    eq(counts.elevated, 20, 'jitter does not drift 50ms cadence'); eq(counts.classic, 20, 'jitter does not drift original-map 50ms cadence');
    now += 10000; elevatedCadence.r.onTick(now); classicCadence.r.onTick(now);
    eq(counts.elevated, 21); eq(counts.classic, 21, 'stall advances once instead of retrying disposed/catch-up slots');
    elevatedCadence.r.destroy(); classicCadence.r.destroy();

    const verified = room(def, 2, true); verified.start(settings('Alpine Courtyard'));
    const v = verified.clients[0], before = latest(v.ws).inputAck.controlEpoch;
    const resumed = socket(); verified.r.addGigglePlayer('sub-0', 'Driver 0', resumed); verified.r.broadcastState();
    ok(latest(resumed).inputAck.controlEpoch >= before + 2, 'verified attach hooks release old controls');
    verified.r.disconnect(v.ws); eq(v.p.connected, true, 'verified stale close cannot detach replacement');
    verified.r.destroy();

    const late = room(def); late.start(settings('Alpine Courtyard'));
    const lateSocket = socket(), latePlayer = late.r.addPlayer('Late watcher', lateSocket).player;
    late.r.broadcastState(); const lateView = latest(lateSocket);
    eq(lateView.spectator, true); eq(lateView.youDrive, false); eq(lateView.inputAck, null); eq(lateView.coins, 0);
    eq(lateView.karts.length, 2, 'late join never adds an authority body');
    late.r.onAction(lateSocket, { type: 'input', seq: 1, life: 0, controlEpoch: 0, steer: 0, throttle: 1, brake: 0, nitro: false, use: true }, { i: lateView.instanceId, w: lateView.w });
    now += 50; late.r.onTick(); eq(latest(lateSocket).inputAck, null, 'late watcher cannot act with valid outer tokens');
    eq(late.start(settings('Alpine Courtyard')), { ok: true });
    ok(latest(lateSocket).inputAck && latest(lateSocket).karts.some(k => k.id === latePlayer.id), 'normal rematch promotes connected late seat');
    late.r.destroy();
  } finally { Date.now = originalNow; unready.r.destroy(); }
  eq(creations, frees, 'every initialized World released exactly once');

  const failDef = freshDef(); let attempted = 0;
  await assert.rejects(failDef.initialize(async () => { attempted++; throw Error('WASM failure'); })); checks++;
  await assert.rejects(failDef.initialize(async () => base)); checks++;
  eq(attempted, 1, 'failed init has no disposed async retry');
  ok(failDef.preflight(settings('Alpine Courtyard')).error.includes('unavailable'));
  ok(failDef.preflight({ map: 'Garden Circuit' }).error.includes('unavailable'), 'init failure leaves original maps unavailable');

  const failureDef = freshDef(); let broken = false, failedFrees = 0, failures = 0;
  class FailingWorld extends base.RAPIER.World {
    step(...args) { super.step(...args); if (broken) { failures++; throw Error('post-step failure'); } }
    free() { failedFrees++; super.free(); }
  }
  await failureDef.initialize(async () => ({ ...base, RAPIER: { ...base.RAPIER, World: FailingWorld } }));
  const failed = room(failureDef); failed.start(settings('Frost Quarry'));
  const start = latest(failed.clients[0].ws), log = console.error;
  Date.now = () => start.liveAt + 50; broken = true; console.error = () => {};
  try {
    failed.r.onTick();
    const s = latest(failed.clients[0].ws);
    eq(s.phase, 'done'); eq(s.endsAt, 0); eq(s.waitForResult, false);
    eq(s.result.endReason, 'simulation-failure'); ok(s.error.includes('Start a new round'));
    eq(failedFrees, 1); eq(failures, 1);
    for (let i = 0; i < 3; i++) failed.r.onTick();
    eq(failures, 1, 'retired World is not retried'); eq(failed.r.totals, Object.fromEntries(failed.clients.map(c => [c.p.id, 0])));
    failed.r.destroy(); eq(failedFrees, 1, 'retirement disposal is idempotent');
  } finally { Date.now = originalNow; console.error = log; failed.r.destroy(); }

  // Actual pickup -> Pulse -> KO -> respawn -> Room result on a diagnostic
  // flat numeric map. No item grants, teleports, hit or score mutation hooks.
  const diagnostic = Object.fromEntries(['garden', 'frost', 'neon', 'harbor'].map(id => [id, diagnosticMap(id)]));
  let seed = 0;
  for (; seed < 256; seed++) {
    const m = createElevatedCombat(base.RAPIER, base.config, diagnostic.garden, [{ id: 'a' }, { id: 'b' }],
      { instance: 'seed-search', seed, startAt: 0, countdownMs: 0, roundMs: 5000, crates: 1 });
    m.advance(20); const weapon = m.snapshot().karts[0].weapon; m.dispose(); if (weapon === 'pulse') break;
  }
  ok(seed < 256, 'bounded real pickup selects a Pulse seed');
  const legal = freshDef();
  await legal.initialize(async () => ({ ...base, maps: diagnostic,
    createMatch: (R, C, M, seats, opts) => createElevatedCombat(R, C, M, seats, { ...opts, seed, crates: 1 }) }));
  const battle = room(legal), b = battle.r;
  now = 2000000; Date.now = () => now;
  try {
    battle.start(settings('Alpine Courtyard'));
    const initial = latest(battle.clients[0].ws), pump = n => { for (let i = 0; i < n; i++) { now += 50; b.onTick(); } };
    now = initial.liveAt + 50; b.onTick();
    eq(latest(battle.clients[0].ws).karts[0].weapon, 'pulse');
    eq(latest(battle.clients[0].ws).coins, 1); eq(latest(battle.clients[1].ws).coins, 0, 'pickup wallet stays private');
    ok(Object.values(b.totals).every(v => v === 0), 'pickup coins do not become Room points');
    pump(55);
    eq(COMBAT.weapons.pulse.damage,10);eq(COMBAT.weapons.pulse.ammo,12);
    ok(10<=Math.ceil(COMBAT.weapons.pulse.ammo*.8),'ten-hit KO stays inside rounded80%-clip budget');
    const ready=latest(battle.clients[0].ws);send(b,battle.clients[0],input(ready,1,{use:true}));send(b,battle.clients[0],input(ready,2,{use:false}));
    const connectedHits=new Map();
    for(let tick=0;tick<60&&latest(battle.clients[0].ws).karts[1].alive;tick++){
      pump(1);const current=latest(battle.clients[0].ws);
      for(const event of current.events)if(event.type==='hit'&&event.weapon==='pulse')connectedHits.set(event.id,event);
      eq(current.karts[1].health,100-connectedHits.size*10,'one activation projects every preceding10-damage wound');eq(current.karts[1].maxHealth,100);
      if(current.karts[1].alive)eq(current.karts[0].hits,0,'automatic rounds cannot award before the lethal health boundary');
    }
    eq(connectedHits.size,10,'one tap/release delivers the ten real connected rounds required for KO');
    ok([...connectedHits.values()].every((hit,i)=>hit.damage===10&&hit.health===90-i*10),'transport preserves every automatic wound and exact lethal boundary');
    const ko = latest(battle.clients[0].ws);
    eq(ko.karts[0].hits, 1); eq(ko.karts[1].deaths, 1); eq(ko.karts[1].alive, false);eq(ko.karts[1].health,0);
    const hit=ko.events.filter(e=>e.type==='hit').at(-1);eq(hit.damage,10);eq(hit.health,0);eq(hit.maxHealth,100);ok(hit.position&&Object.values(hit.position).every(Number.isFinite),'Room projects bounded health hit position');
    const impact=ko.events.filter(e=>e.type==='impact'&&e.weapon==='pulse').at(-1);ok(impact.from&&Object.values(impact.from).every(Number.isFinite)&&impact.position.z>impact.from.z,'Room projects the authoritative final Pulse sweep for confirmed feedback');
    eq(ko.coins, 11); ok(Object.values(b.totals).every(v => v === 0), 'KO coins remain distinct from deferred Room score');
    pump(45); ok(latest(battle.clients[0].ws).karts[1].alive, 'real safe respawn completes');
    now = initial.deadline; b.onTick(); const done = latest(battle.clients[0].ws);
    eq(done.result.winner, battle.clients[0].p.id); eq(done.result.winners, [battle.clients[0].p.id]);
    eq(b.totals[battle.clients[0].p.id], 300); eq(b.totals[battle.clients[1].p.id], 200, 'Room awards place points (300 / 200) exactly once');
    pump(5); b.broadcastState(); eq(b.totals[battle.clients[0].p.id], 300);
  } finally { Date.now = originalNow; b.destroy(); }
  console.log(JSON.stringify({ pass: true, checks, node: process.version, rapier: base.RAPIER.version(),
    scope: 'Production facade/Room with real Rapier, authored three-map starts, 8 drivers/16 watchers, controlled server clock, legal combat on an explicitly diagnostic map; no browser claim.' }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
