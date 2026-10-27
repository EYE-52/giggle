'use strict';
// Room wire filtering and actual asynchronous shipping host; DOM doubles,
// not a rendered game or a physical-device/perceptual audio verdict.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { Room } = require('../server/room');
let checks = 0;
const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const event = id => ({ id, type: 'blast', weapon: 'rocket', position: { x: 1, y: 2, z: 3 } });
const socket = delta => ({ readyState: 1, bufferedAmount: 0, kartEventDeltas: delta, frames: [], fail: false,
  send(raw) { if (this.fail) throw Error('send failure'); this.frames.push(JSON.parse(raw)); }, close() {} });
const latest = s => s.frames.at(-1);
function capabilityAdvertisement() {
  const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
  const definition = source.match(/function send\(o\) \{[\s\S]*?\n\}/)?.[0];
  assert(definition, 'extract the shipping app.send function'); checks++;
  const packets = [], context = vm.createContext({ ws: { readyState: 1, send: raw => packets.push(JSON.parse(raw)) } });
  vm.runInContext(definition + '\nglobalThis.dispatch = send;', context);
  for (const t of ['create', 'join', 'giggleJoin', 'giggleRenew']) {
    const input = Object.freeze({ t, name: 'Local test', n: 'test-nonce', kartEvents: false });
    context.dispatch(input);
    eq(packets.at(-1), { ...input, kartEvents: 'delta-v1' }, t + ' advertises the exact supported capability and preserves fields');
    eq(input.kartEvents, false, t + ' leaves the caller payload unchanged');
  }
  for (const t of ['clock', 'games', 'start', 'game-ready', 'action', 'lobby', 'configure', 'kick', 'leave']) {
    const input = Object.freeze({ t, n: 'test-nonce' }); context.dispatch(input);
    eq(packets.at(-1), input, t + ' remains an unchanged nonidentity packet');
  }
  for (const readyState of [0, 2, 3]) {
    const count = packets.length; context.ws.readyState = readyState; context.dispatch({ t: 'join' });
    eq(packets.length, count, 'socket state ' + readyState + ' sends no identity packet');
  }
  const count = packets.length; context.ws = null; context.dispatch({ t: 'giggleRenew' });
  eq(packets.length, count, 'missing socket sends no identity packet');
}
function wire(transport = false) {
  const room = new Room('EVNT', {}), modern = socket(true), old = socket(false), slow = socket(true);
  for (const [i, s] of [modern, old, slow].entries()) room.addPlayer('Seat ' + i, s);
  const publicView = { phase: 'live', events: [event('e1')], inputAck: { receivedSeq: 7 }, coins: 9 };
  room.game = { def: { id: 'pocket-karts', manifest: { seats: 2 }, view: (_, id) => ({ ...publicView,
    inputAck: id === room.players[2].id ? null : publicView.inputAck, coins: id === room.players[2].id ? 0 : publicView.coins }) },
    state: { phase: 'live' }, roster: room.players.slice(0, 2).map(p => p.id), instanceId: 'one', clockOffset: 0 };
  if (transport) room.game.def.viewForTransport = function(state, id) {
    eq(this, room.game.def, 'transport method retains definition receiver');
    const view = this.view(state, id);
    Object.freeze(view.events);
    return Object.freeze(view);
  };
  try {
    room.broadcastState();
    eq(latest(modern).events, publicView.events, 'first opted connection gets retained baseline');
    room.broadcastState();
    eq(latest(modern).events, [], 'unchanged history costs no repeated event bytes');
    eq(latest(old).events, publicView.events, 'older clients keep complete event history');
    eq(latest(modern).inputAck, { receivedSeq: 7 }, 'private input acknowledgement remains intact');
    eq([latest(slow).spectator, latest(slow).inputAck, latest(slow).coins], [true, null, 0], 'watcher privacy is unchanged');
    publicView.events = Object.freeze([event('e1'), event('e2')]);
    const count = slow.frames.length; slow.bufferedAmount = 9000;
    room.broadcastState({ discardable: true });
    eq(slow.frames.length, count, 'backlogged tick is skipped');
    eq(latest(modern).events.map(e => e.id), ['e2'], 'only new event is delivered');
    eq(publicView.events.map(e => e.id), ['e1', 'e2'], 'wire filtering never mutates authoritative projection');
    slow.bufferedAmount = 0; room.broadcastState({ discardable: true });
    eq(latest(slow).events.map(e => e.id), ['e2'], 'drained socket receives retained event it missed');
    modern.fail = true; publicView.events = [...publicView.events, event('e3')]; room.broadcastState();
    modern.fail = false; room.broadcastState();
    eq(latest(modern).events.map(e => e.id), ['e3'], 'throwing send cannot consume the event');
    publicView.events = [...publicView.events, event('e4')]; publicView.unserializable = 1n; room.broadcastState();
    delete publicView.unserializable; room.broadcastState();
    eq(latest(modern).events.map(e => e.id), ['e4'], 'failed JSON serialization cannot consume the event');
    const resumed = socket(true), seat = room.players[0]; room.addPlayer(seat.name, resumed, seat.token); room.broadcastState();
    eq(latest(resumed).events, publicView.events, 'new socket for resumed seat receives full quiet baseline');
    room.broadcastState(); eq(latest(resumed).events, [], 'resumed connection then receives only new events');
    publicView.events = [...publicView.events, event('e5')]; publicView.phase = room.game.state.phase = 'done'; publicView.result = { winner: seat.id };
    slow.bufferedAmount = 9000; room.broadcastState();
    eq([latest(slow).phase, latest(slow).events.map(e => e.id), latest(slow).result], ['done', ['e5'], publicView.result], 'terminal result and final event bypass tick backlog guard');
    room.game.instanceId = 'two'; publicView.events = [event('e1')]; room.broadcastState();
    eq(latest(resumed).events, publicView.events, 'new instance resets cursor even if event ID is reused');
    room.game.def.id = 'other-game'; room.broadcastState(); room.broadcastState();
    eq(latest(resumed).events, publicView.events, 'other games never get delta filtering');
  } finally { room.game = null; room.destroy(); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function hostDelivery() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-event-host-'));
  const original = global.document;
  let host;
  try {
    fs.mkdirSync(path.join(tmp, 'games')); fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
    fs.copyFileSync(process.env.GAME_HOST_SOURCE || path.join(__dirname, '../public/js/game-host.js'), path.join(tmp, 'game-host.js'));
    fs.writeFileSync(path.join(tmp, 'games/pocket-karts.js'), `export default {
      async mount(el) { await el.mount.promise; },
      async update(el,S) { el.updates.push(S); if (el.render) await el.render.promise; },
      dispose(el) { el.disposes++; }
    };`);
    global.document = { visibilityState: 'hidden', activeElement: null, getElementById: () => null,
      querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
    host = await import(pathToFileURL(path.join(tmp, 'game-host.js')).href);
    const el = { mount: deferred(), updates: [], disposes: 0 };
    const S = (events, extra = {}) => ({ instanceId: 'one', w: 'live', phase: 'live', events, ...extra });
    const first = host.show(el, 'pocket-karts', S([event('e1')], { value: 1, audioBaseline: true }), {});
    await flush(); await flush();
    host.show(el, 'pocket-karts', S([], { value: 2 }), {});
    host.show(el, 'pocket-karts', S([event('e2')], { value: 3 }), {});
    el.mount.resolve(); await first;
    eq(el.updates.at(-1).events.map(e => e.id), ['e1', 'e2'], 'mount coalescing preserves unique events');
    eq([el.updates.at(-1).value, el.updates.at(-1).audioBaseline], [3, true], 'latest pose and unconsumed baseline survive coalescing');
    await host.show(el, 'pocket-karts', S([event('e3')]), {});
    eq(el.updates.at(-1).audioBaseline, false, 'consumed baseline does not silence subsequent live events');
    el.render = deferred(); const render = host.show(el, 'pocket-karts', S([event('e4')]), {}); await flush();
    host.show(el, 'pocket-karts', S([event('historic')], { audioBaseline: true }), {});
    host.show(el, 'pocket-karts', S([event('new')]), {});
    el.render.resolve(); await render; delete el.render;
    eq(el.updates.at(-1).events.map(e => e.id), ['historic', 'new'], 'reconnect baseline discards previous pending connection history');
    eq(el.updates.at(-1).audioBaseline, true, 'unpainted reconnect baseline stays quiet when a later delta arrives');
    el.render = deferred(); const live = host.show(el, 'pocket-karts', S([event('blast')]), {}); await flush();
    host.show(el, 'pocket-karts', S([], { phase: 'done', result: { winner: 'p1' }, inputAck: { receivedSeq: 99 } }), {});
    el.render.resolve(); await live; delete el.render;
    const done = el.updates.at(-1);
    eq(done.events.at(-1).id, 'blast', 'terminal coalescing preserves last live explosion');
    eq([done.phase, done.result, done.inputAck], ['done', { winner: 'p1' }, { receivedSeq: 99 }], 'terminal result and latest private ACK remain current');
    await host.show(el, 'pocket-karts', S(Array.from({ length: 40 }, (_, i) => event('bounded-' + i))), {});
    eq(el.updates.at(-1).events.map(e => e.id), Array.from({ length: 32 }, (_, i) => 'bounded-' + (i + 8)), 'render history stays bounded to existing 32-event authority ceiling');
    await host.show(el, 'pocket-karts', S([event('bounded-39')]), {});
    eq(new Set(el.updates.at(-1).events.map(e => e.id)).size, 32, 'repeated IDs never duplicate render history');
    await host.show(el, 'pocket-karts', S([event('e1')], { instanceId: 'two' }), {});
    eq(el.updates.at(-1).events.map(e => e.id), ['e1'], 'rematch mount clears old event union');
    eq(el.disposes, 1, 'new instance disposes old renderer');
  } finally { host?.reset(); global.document = original; fs.rmSync(tmp, { recursive: true, force: true }); }
}
(async () => { capabilityAdvertisement(); wire(); wire(true); await hostDelivery(); console.log('KART_EVENT_DELIVERY_PASS: ' + checks + ' shipping app capability, Room/async-host event, baseline, privacy, failure and lifecycle assertions'); })()
  .catch(error => { console.error(error); process.exitCode = 1; });
