'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const COMBAT = require('../games/engines/kart-combat-config').config;

const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
const ok = (value, label) => { assert.ok(value, label); checks++; };
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
async function until(fn, label, ms = 4000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (fn()) return; await sleep(15); }
  throw Error(label);
}
async function boot(preload) {
  const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [...(preload ? ['--require', preload] : []), 'server/server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { output += value; });
  try { await until(() => output.includes('PartyBox on'), 'actual production server did not initialize: ' + output); }
  catch (error) { child.kill(); throw error; }
  return { child, url: 'ws://127.0.0.1:' + port, output: () => output };
}
async function connect(server) {
  const ws = new WebSocket(server.url), client = { ws, frames: [], state: null, hello: null, room: null };
  ws.on('message', text => {
    const m = JSON.parse(text); client.frames.push(m);
    if (m.t === 'state') client.state = m;
    if (m.t === 'hello') client.hello = m;
    if (m.t === 'room') client.room = m.room;
  });
  await once(ws, 'open'); return client;
}
const send = (client, msg) => client.ws.send(JSON.stringify(msg));
const params = label => ({ map: label, mode: 'Zap Battle', winRule: 'Time limit', roundSeconds: 60 });
const intent = (s, seq, extra = {}) => ({ type: 'input', seq, life: s.inputAck.life, controlEpoch: s.inputAck.controlEpoch,
  steer: 0, throttle: 0, brake: 0, nitro: false, use: false, ...extra });
const action = (client, a, meta = {}) => send(client, { t: 'action', i: client.state.instanceId, w: client.state.w, a, ...meta });
const stateCount = client => client.frames.filter(m => m.t === 'state').length;
async function settle(client, fn, label) {
  const count = stateCount(client); fn();
  await until(() => stateCount(client) >= count + 2, label);
}
async function createRoom(server, count) {
  const clients = [await connect(server)]; send(clients[0], { t: 'create', name: 'Driver 0' });
  await until(() => clients[0].hello, 'creator attached');
  for (let i = 1; i < count; i++) {
    const c = await connect(server); clients.push(c);
    send(c, { t: 'join', code: clients[0].hello.code, name: 'Driver ' + i });
    await until(() => c.hello, 'seat ' + i + ' attached');
  }
  return clients;
}
async function start(clients, settings, host = clients[0]) {
  const previous = host.state?.instanceId;
  send(host, { t: 'start', game: 'pocket-karts', ...(settings ? { settings } : {}) });
  await until(() => clients.every(c => c.state?.instanceId && c.state.instanceId !== previous), 'production start broadcast');
}
const finiteWire = v => typeof v === 'number' ? Number.isFinite(v) : v && typeof v === 'object' ? Object.values(v).every(finiteWire) : true;

async function main() {
  const server = await boot(), sockets = [], metrics = {};
  try {
    const legacy = await createRoom(server, 2), clients = await createRoom(server, 24);
    sockets.push(...legacy, ...clients);
    await start(legacy, { roundSeconds: 60, map: 'Garden Circuit', mode: 'Zap Battle', winRule: 'Time limit' });
    await start(clients, params('Alpine Courtyard'));
    const first = clients[0], other = clients[1], watcher = clients[23], initial = first.state;
    eq(first.state.profile, 'elevated-combat-v1'); eq(first.state.map.label, 'Alpine Courtyard');
    eq(first.state.configVersion, 1); eq(first.state.physicsVersion, 2); eq(first.state.mapRevision, 'combat-elevation-1');
    eq(first.state.waitForResult, true); eq(first.state.phase, 'countdown');
    eq(first.state.players.length, 8); eq(first.state.spectators.length, 16); eq(first.state.karts.length, 8);
    for (const c of clients) {
      eq(c.state.you, c.hello.you, 'outer player ID is never replaced by private object');
      ok(finiteWire(c.state), 'finite full-pose packet');
      ok(c.state.karts.every(k => !('coins' in k) && !('name' in k) && !('input' in k) &&
        k.pose.rotation.w !== undefined && k.pose.linearVelocity.y !== undefined && k.pose.angularVelocity.y !== undefined &&
        k.pose.wheels.every(w => !('contact' in w) && !('surfaceId' in w))), 'public poses omit private/diagnostic fields');
      ok(!('droppedMs' in c.state) && !('seed' in c.state) && !('world' in c.state), 'internal diagnostics remain private');
      if (c.state.spectator) { eq(c.state.inputAck, null); eq(c.state.coins, 0); }
    }
    metrics.initialActivePacketBytes = Buffer.byteLength(JSON.stringify(first.state));
    metrics.initialWatcherPacketBytes = Buffer.byteLength(JSON.stringify(watcher.state));
    eq(first.state.combat, COMBAT, 'actual wire health rules agree with shared authority');
    const withoutHealth = structuredClone(first.state);
    delete withoutHealth.combat;
    for (const k of withoutHealth.karts) { delete k.health; delete k.maxHealth; }
    metrics.packetBeforeHealthBytes = Buffer.byteLength(JSON.stringify(withoutHealth));
    metrics.healthWireBytes = metrics.initialActivePacketBytes - metrics.packetBeforeHealthBytes;
    const healthBudget = Buffer.byteLength(JSON.stringify({ combat: COMBAT })) + 8 * (Buffer.byteLength(JSON.stringify({ health: 100, maxHealth: 100 })) - 1);
    ok(metrics.packetBeforeHealthBytes < 9000, `original compact full room packet budget retained (${metrics.packetBeforeHealthBytes} bytes)`);
    ok(metrics.healthWireBytes > 0 && metrics.healthWireBytes <= healthBudget, `health description and eight health pairs stay bounded (${metrics.healthWireBytes}/${healthBudget} bytes)`);
    ok(metrics.initialActivePacketBytes < 9000 + healthBudget, `full health packet stays within its measured incremental budget (${metrics.initialActivePacketBytes} bytes)`);
    const valid = intent(first.state, 1);
    await settle(first, () => {
      action(first, valid, { i: undefined, w: undefined }); action(first, valid, { i: undefined });
      action(first, valid, { w: undefined }); action(first, valid, { i: 'wrong' }); action(first, valid, { w: 'wrong' });
    }, 'rejected outer token tick');
    eq(first.state.inputAck.receivedSeq, 0, 'network missing/wrong outer tokens rejected');
    action(first, valid); action(first, valid);
    await until(() => first.state.inputAck?.receivedSeq === 1, 'valid sequence acknowledged');
    eq(first.state.inputAck.receivedSeq, 1, 'valid sequence accepted exactly once');
    await settle(first, () => {
      for (const extra of [{ position: { x: 999, y: 999, z: 999 } }, { x: 999 }, { seq: 6000 }, { life: 999 }, { controlEpoch: 999 }, { steer: null }]) {
        action(first, intent(first.state, 2, extra));
      }
      action(watcher, valid);
    }, 'invalid intents tick');
    eq(first.state.inputAck.receivedSeq, 1, 'coordinates, sequence jumps, stale epochs, malformed input and watcher intent rejected');
    const elevatedCount = stateCount(first), legacyCount = stateCount(legacy[0]), measuredAt = Date.now();
    await sleep(1100);
    const duration = Date.now() - measuredAt, elevatedFrames = stateCount(first) - elevatedCount, legacyFrames = stateCount(legacy[0]) - legacyCount;
    metrics.cadence = { durationMs: duration, elevatedFrames, legacyFrames, elevatedHz: elevatedFrames * 1000 / duration, legacyHz: legacyFrames * 1000 / duration };
    ok(elevatedFrames >= 16 && elevatedFrames <= 24, 'new profile receives approximately 20 Hz');
    ok(legacyFrames >= 16 && legacyFrames <= 24, 'physical original map receives approximately 20 Hz');
    ok(Math.abs(elevatedFrames - legacyFrames) <= 3, 'both independent physical instances retain 20 Hz cadence');
    await until(() => clients.every(c => c.state.phase === 'live'), 'live transition', 4500);
    eq(first.state.endsAt, initial.deadline, 'deadline remains anchored through countdown/live');
    await settle(first, () => action(first, intent(first.state, 2, { use: true }), { w: initial.w }), 'previous phase token tick');
    eq(first.state.inputAck.receivedSeq, 1, 'actual countdown token cannot fire after live starts');
    ok(!legacy[0].state.profile && !legacy[0].state.waitForResult, 'original-map rules schema remains separate');
    eq(legacy[0].state.motionProfile, 'rapier-classic-v1');
    const position = first.state.karts.find(k => k.id === first.hello.you).pose.position;
    action(first, intent(first.state, 2, { steer: 1, throttle: 1, nitro: true }));
    await until(() => first.state.inputAck.appliedInputSeq === 2, 'physical input acknowledged');
    await sleep(200);
    ok(Math.hypot(...Object.entries(first.state.karts.find(k => k.id === first.hello.you).pose.position).map(([key, value]) => value - position[key])) > 0.02,
      'real accepted input changes authoritative full position');
    ok(first.state.karts.find(k => k.id === first.hello.you).pose.wheels.some(w => w.steering !== 0), 'held input physically steers before disconnect');
    eq(first.state.karts.find(k => k.id === first.hello.you).nitroActive, true, 'held input boosts before disconnect');
    const oldEpoch = first.state.inputAck.controlEpoch, oldToken = first.hello.seatToken, pid = first.hello.you, code = first.hello.code;
    first.ws.close(); await once(first.ws, 'close');
    await until(() => other.state.karts.find(k => k.id === pid).connected === false, 'disconnect hook broadcast');
    const offline = other.state.karts.find(k => k.id === pid);
    eq(offline.pose.linearVelocity, { x: 0, y: 0, z: 0 }); eq(offline.pose.angularVelocity, { x: 0, y: 0, z: 0 });
    await sleep(200); eq(other.state.karts.find(k => k.id === pid).pose.position, offline.pose.position, 'disconnect freezes all axes over real pumps');
    const resumed = await connect(server); sockets.push(resumed);
    send(resumed, { t: 'join', code, name: 'Driver 0', seatToken: oldToken });
    await until(() => resumed.state, 'resumed authoritative state'); clients[0] = resumed;
    // The join snapshot is synchronous. A later real pump may already have
    // replaced client.state by the time the polling wait resumes, and neutral
    // suspension can settle after the body becomes dynamic again.
    const joined = resumed.frames.find(f => f.t === 'state'), joinedKart = joined.karts.find(k => k.id === pid);
    eq(resumed.hello.you, pid); eq(joined.instanceId, initial.instanceId);
    eq(joinedKart.pose.position, offline.pose.position, 'first resumed frame preserves the exact frozen position');
    eq(joinedKart.pose.rotation, offline.pose.rotation, 'first resumed frame preserves the exact frozen rotation');
    eq(joinedKart.pose.linearVelocity, { x: 0, y: 0, z: 0 }); eq(joinedKart.pose.angularVelocity, { x: 0, y: 0, z: 0 });
    eq(joined.inputAck.controlEpoch, offline.controlEpoch + 1, 'first resumed frame has the immediate connection epoch');
    eq(joinedKart.controlEpoch, joined.inputAck.controlEpoch); eq(joinedKart.connected, true);
    ok(joined.inputAck.controlEpoch > oldEpoch, 'connection hook increments control epoch immediately');
    await until(() => resumed.frames.filter(f => f.t === 'state' && f.simTick > joined.simTick).length >= 2, 'neutral resume pumps');
    const neutralFrames = resumed.frames.filter(f => f.t === 'state' && f.simTick > joined.simTick).slice(0, 2);
    ok(neutralFrames[1].simTick > neutralFrames[0].simTick, 'neutral resume is checked across separate physical pumps');
    for (const frame of neutralFrames) {
      const kart = frame.karts.find(k => k.id === pid);
      eq(frame.inputAck, { receivedSeq: 2, appliedInputSeq: 2, life: joined.inputAck.life, controlEpoch: joined.inputAck.controlEpoch }, 'resume pumps do not apply old queued input');
      eq(kart.pose.wheels.map(w => w.steering), [0, 0, 0, 0], 'old steering is neutral after resume pumps');
      eq(kart.nitroActive, false, 'old throttle/Nitro intent does not resume');
      ok(kart.nitro >= joinedKart.nitro, 'neutral resume recharges rather than spends Nitro');
    }
    const later = neutralFrames.at(-1), laterKart = later.karts.find(k => k.id === pid);
    metrics.reconnect = { offlinePosition: offline.pose.position,
      firstFrame: { simTick: joined.simTick, position: joinedKart.pose.position, controlEpoch: joined.inputAck.controlEpoch },
      laterFrame: { simTick: later.simTick, position: laterKart.pose.position, controlEpoch: later.inputAck.controlEpoch },
      laterPhysicalDelta: Math.hypot(...Object.entries(laterKart.pose.position).map(([key, value]) => value - offline.pose.position[key])) };
    await settle(resumed, () => action(resumed, intent(resumed.state, 3, { controlEpoch: oldEpoch, throttle: 1, use: true })), 'old epoch rejection tick');
    eq(resumed.state.inputAck.receivedSeq, 2, 'old held actions cannot resume');
    action(resumed, intent(resumed.state, 3));
    await until(() => resumed.state.inputAck?.receivedSeq === 3, 'fresh resume input acknowledged');
    eq(resumed.state.inputAck.receivedSeq, 3, 'fresh neutral input accepted');

    // Real 60-second round (the shortest allowed) with wall deadlines, no fixture clock or target edits.
    await until(() => clients.every(c => c.state.phase === 'done'), 'full production timed result', 64000);
    const done = resumed.state, totals = { ...done.totals };
    eq(done.endsAt, 0); eq(done.result.endReason, 'timeout'); eq(done.result.endedAt, initial.deadline);
    eq(done.result.winner, null); eq(done.result.winners, done.result.standings.map(s => s.pid)); eq(done.result.draw, true);
    ok(done.result.standings.every(s => totals[s.pid] === 150), 'zero KOs for everyone is a draw worth 150 each, never a sole winner');
    eq(done.events.find(e => e.type === 'result').winners, done.result.winners, 'result event agrees with normalized result');
    metrics.donePacketBytes = Buffer.byteLength(JSON.stringify(done));
    await sleep(150); action(resumed, intent(done, 4, { use: true }));
    const host = clients.find(c => c.hello.you === other.room.hostId);
    ok(host && host !== resumed, 'disconnect migrated host stays authoritative');
    await start(clients, undefined, host);
    const rematch = resumed.state;
    ok(rematch.instanceId !== initial.instanceId); eq(rematch.map.label, 'Alpine Courtyard'); eq(rematch.inputAck.receivedSeq, 0);
    eq(rematch.totals, totals, 'rematch does not replay Room awards');
    await settle(resumed, () => action(resumed, intent(rematch, 1), { i: initial.instanceId, w: done.w }), 'old-instance rejection tick');
    eq(resumed.state.inputAck.receivedSeq, 0);
    await start(clients, params('Frost Quarry'), host); eq(resumed.state.mapId, 'frost'); eq(resumed.state.map.label, 'Frost Quarry');
    await start(clients, params('Neon Harbor'), host); eq(resumed.state.mapId, 'neon'); eq(resumed.state.map.label, 'Neon Harbor');
    const beforeInvalid = resumed.state.instanceId, errors = host.frames.filter(f => f.t === 'error').length;
    send(host, { t: 'start', game: 'pocket-karts', settings: { ...params('Neon Harbor'), mode: 'Star Rush' } });
    await until(() => host.frames.filter(f => f.t === 'error').length > errors, 'unsupported combination error');
    ok(host.frames.filter(f => f.t === 'error').at(-1).msg.includes('require Zap Battle'));
    eq(resumed.state.instanceId, beforeInvalid, 'incompatible start preserves current World');
    await start(clients, { mode: 'Star Rush', map: 'Neon Yard', winRule: 'Score target', roundSeconds: 60 }, host);
    eq(resumed.state.mode, 'starrush'); eq(resumed.state.winRule, 'Score target'); ok(!resumed.state.profile);
    await settle(resumed, () => action(resumed, { input: { throttle: 1, steer: 0 } }, { i: undefined, w: undefined }), 'unstamped original-map input tick');
    eq(resumed.state.inputAck.receivedSeq, 0, 'physical original map rejects unstamped input');
    const classicAck = resumed.state.inputAck;
    action(resumed, { seq: 1, life: classicAck.life,
      controlEpoch: classicAck.controlEpoch, input: { throttle: 1, steer: 0, boost: false } });
    await until(() => resumed.state.inputAck?.receivedSeq === 1, 'legal original-map input acknowledged');
    eq(resumed.state.inputAck.receivedSeq, 1, 'physical original map accepts legal current input');
    eq(resumed.state.motionProfile, 'rapier-classic-v1');
    await start(clients, { mode: 'Garage Battle', map: 'Frosty Pass', winRule: 'Score target', roundSeconds: 60 }, host);
    eq(resumed.state.garage, true); eq(resumed.state.mode, 'battle'); eq(resumed.state.winRule, 'Score target'); ok(!resumed.state.profile);
    const resetFrames = host.frames.length; send(host, { t: 'configure', game: 'pocket-karts', reset: true });
    await until(() => host.frames.slice(resetFrames).some(f => f.t === 'room'), 'configuration reset');
    await start(clients, undefined, host);
    eq(resumed.state.map.label, 'Garden Circuit'); eq(resumed.state.roundMs, 180000);
    eq(resumed.state.modeLabel, 'Zap Battle'); eq(resumed.state.garage, false); eq(resumed.state.winRule, 'Time limit'); ok(!resumed.state.profile);
    metrics.scope = 'Node 24 real production server/WebSocket, localhost 8 drivers plus 16 watchers and a separate classic room; complete 60s deadline, no simulated clock; not WAN/device performance.';
    ok(!/game tick error|game view error|handle error|elevated arena retired/.test(server.output()), 'production route has no unexpected lifecycle exceptions');
  } finally {
    for (const c of sockets) c.ws.terminate();
    server.child.kill(); await once(server.child, 'exit');
  }

  // Simulate dependency initialization failure before registry loads. Only
  // this scratch child is affected; no production flag/contract is added.
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kart-init-failure-'));
  const preload = path.join(scratch, 'fail-init.cjs');
  fs.writeFileSync(preload, `require(${JSON.stringify(path.join(ROOT, 'games/engines/kart-elevated-adapter.js'))}).loadElevatedDependencies = async () => { throw new Error('test-only initialization failure'); };\n`);
  const unavailable = await boot(preload), clients = [];
  try {
    clients.push(...await createRoom(unavailable, 2));
    const initialRoom = JSON.stringify(clients[0].room);
    for (const map of ['Garden Circuit','Alpine Courtyard']) {
      const before = clients[0].frames.length;
      send(clients[0], { t: 'start', game: 'pocket-karts', settings: params(map) });
      await until(() => clients[0].frames.slice(before).some(f => f.t === 'error'), 'init failure preflight error');
      ok(clients[0].frames.filter(f => f.t === 'error').at(-1).msg.includes('Kart arenas are unavailable'), 'all arena init failures are a plain user error');
      ok(clients.every(c => !c.state), 'failed bootstrap emits no game state');
      eq(JSON.stringify(clients[0].room), initialRoom, 'failed bootstrap preserves lobby');
    }
    send(clients[0], { t: 'start', game: 'typing-race', settings: { rounds: 1, raceSeconds: 15 } });
    await until(() => clients.every(c => c.state?.game === 'typing-race'), 'supported game starts without kart physics');
    const playing = clients[0].state;
    for (const map of ['Garden Circuit','Alpine Courtyard']) {
      const before = clients[0].frames.length;
      send(clients[0], { t: 'start', game: 'pocket-karts', settings: params(map) });
      await until(() => clients[0].frames.slice(before).some(f => f.t === 'error'), 'failed kart start preserves supported game');
      eq(clients[0].state.instanceId, playing.instanceId, 'failed preflight preserves another active instance');
      eq(clients[0].state.endsAt, playing.endsAt, 'failed preflight preserves another active deadline');
      ok(!clients[0].frames.slice(before).some(f => f.t === 'state' && f.game === 'pocket-karts'), 'failed preflight never emits kart state');
    }
    const beforeCatalogue = clients[0].frames.length;
    send(clients[0], { t: 'games' });
    await until(() => clients[0].frames.slice(beforeCatalogue).some(f => f.t === 'games'), 'catalogue stays responsive');
    ok(unavailable.output().includes('Elevated arenas unavailable'), 'bootstrap failure is handled before network listens');
  } finally {
    for (const c of clients) c.ws.terminate(); unavailable.child.kill(); await once(unavailable.child, 'exit');
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ pass: true, checks, node: process.version, metrics }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
