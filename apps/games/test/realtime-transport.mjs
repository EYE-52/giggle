// Real-time layer: codec round trips, delta/patch fuzz, interest tiers,
// interpolation buffer, tick governor, and the shipping Pocket Karts room
// delivering binary frames that decode to the same state as JSON snapshots.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as codec from '../public/js/toolkit/realtime/codec.mjs';
import { interestPeriods, due } from '../public/js/toolkit/realtime/interest.mjs';
import { decodeFrame, createInterpolationBuffer, createInputHistory, reconcile } from '../public/js/toolkit/realtime/client.mjs';
import { createKartBot } from '../tools/realtime/kart-bot.mjs';
const require = createRequire(import.meta.url);
const { createRealtimeChannel, createTickGovernor } = require('../server/realtime.js');
const { Room } = require('../server/room.js');
const pocket = require('../games/pocket-karts/server.js');
const { KART_STREAM } = require('../games/engines/kart-realtime.js');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

// --- diff/patch: random structural edits round-trip exactly, inputs untouched.
{
  let seed = 3; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const value = d => { const x = r(); if (d > 3 || x < .3) return x < .1 ? null : x < .2 ? 'str' + Math.floor(r() * 5) : Math.floor(r() * 9);
    if (x < .55) return Array.from({ length: Math.floor(r() * 4) }, (_, i) => r() < .5 ? { id: 'e' + Math.floor(r() * 6) + i, v: value(d + 1) } : value(d + 1));
    const o = {}; for (let i = 0; i < 4; i++) if (r() < .6) o['k' + i] = value(d + 1); return o; };
  for (let i = 0; i < 400; i++) {
    const a = value(0), b = value(0), frozenA = JSON.stringify(a);
    const node = codec.diff(a, b), out = codec.patch(a, JSON.parse(JSON.stringify(node ?? {})));
    if (node === undefined) eq(JSON.stringify(a), JSON.stringify(b), 'no patch only when equal');
    else assert.deepEqual(out, b); checks++;
    eq(JSON.stringify(a), frozenA, 'patch never mutates its base');
  }
  const prev = { list: [{ id: 'a', n: 1 }, { id: 'b', n: 2 }], same: { deep: [1, 2] } };
  const next = { list: [{ id: 'b', n: 2 }, { id: 'c', n: 3 }], same: { deep: [1, 2] } };
  const node = codec.diff(prev, next), out = codec.patch(prev, node);
  eq(out, next, 'keyed list reorder/add/remove'); ok(out.same === prev.same, 'unchanged subtree keeps identity');
  ok(out.list[0] === prev.list[1], 'unchanged keyed item keeps identity');
}

// --- schema records: kart motion fields survive within quantization.
{
  const schema = codec.compileSchema(KART_STREAM);
  const kart = { pid: 'p1', health: 3, motionIntent: { steer: -.5, throttle: 1, drift: true, nitro: false },
    physicalPose: { position: { x: 12.345678, y: .65, z: -40.5 }, rotation: { x: 0, y: -.7071, z: 0, w: .7071 },
      linearVelocity: { x: 18.2, y: -.3, z: 4.1 }, angularVelocity: { x: 0, y: 1.25, z: -.01 }, epoch: 7, speed: 18.7, grounded: true,
      wheels: Array.from({ length: 4 }, (_, i) => ({ length: .29 + i / 100, rotation: 36.8 + i, steering: i < 2 ? .14 : 0 })) },
    x: 12.346, z: -40.5, angle: -1.5708, speed: 18.7, vx: 18.2, vz: 4.1, slip: .171 };
  ok(codec.streamable(schema, kart), 'complete kart streams');
  ok(!codec.streamable(schema, { ...kart, physicalPose: undefined }), 'kart without a pose stays JSON');
  const bytes = codec.encodeRecord(schema, kart), stripped = codec.stripStreamed(schema, kart);
  eq(Object.keys(stripped).sort(), ['health', 'pid'], 'only non-motion fields stay in JSON');
  const frame = codec.encodeFrame({ seq: 1, simAt: 5, keyframe: true, json: { p: {} }, streams: [{ index: 0, records: [{ entity: 0, bytes }] }] });
  const back = codec.decodeFrameBytes(frame, () => schema).streams[0].records[0].fields, k = codec.mergeStreamed(stripped, back);
  const near = (a, b, tol, m) => { ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b}`); };
  near(k.physicalPose.position.x, kart.physicalPose.position.x, 1e-5, 'position float32');
  near(k.physicalPose.rotation.y, kart.physicalPose.rotation.y, 1e-4, 'rotation');
  near(k.physicalPose.linearVelocity.x, 18.2, .006, 'velocity');
  near(k.angle, kart.angle, 1e-4, 'yaw'); near(k.motionIntent.steer, -.5, .005, 'steer');
  eq([k.motionIntent.drift, k.motionIntent.nitro, k.physicalPose.grounded, k.physicalPose.epoch], [true, false, true, 7], 'bits and epoch');
  eq(k.physicalPose.wheels.length, 4, 'wheel list'); near(Math.cos(k.physicalPose.wheels[3].rotation), Math.cos(39.8), 1e-3, 'wheel spin mod 2 pi');
  ok(bytes.length < JSON.stringify(kart).length / 4, `record ${bytes.length} B vs JSON ${JSON.stringify(kart).length} B`);
}

// --- interest tiers and staggering.
{
  const pts = Array.from({ length: 32 }, (_, i) => ({ x: i * 4, z: 0 }));
  const periods = interestPeriods({ x: 0, z: 0 }, pts);
  eq(periods.slice(0, 10), Array(10).fill(1), 'nearest ten full rate');
  ok(periods.at(-1) === 4, 'far karts quarter rate');
  eq(interestPeriods(null, pts.slice(0, 3)), [2, 2, 2], 'no focus: half rate');
  const hits = Array.from({ length: 8 }, (_, t) => due(t, 5, 4)).filter(Boolean).length;
  eq(hits, 2, 'period 4 is due twice in 8 ticks');
}

// --- interpolation buffer: adapts to jitter, interpolates on server time.
{
  const smooth = createInterpolationBuffer(), rough = createInterpolationBuffer();
  let seed = 9; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let t = 0; t < 4000; t += 33) {
    smooth.observe(t, t + 40); rough.observe(t, t + 40 + r() * 60);
    smooth.push('a', t, { x: t / 1000 * 10 });
  }
  for (let i = 0; i < 200; i++) { smooth.advance(4000 + i); rough.advance(4000 + i); }
  ok(smooth.stats().delay < 100, 'steady 40 ms link settles below the old fixed 100 ms + transit: ' + smooth.stats().delay.toFixed(1));
  ok(rough.stats().delay > smooth.stats().delay + 20, 'jittery link buffers more');
  const mix = (a, b, t, ahead) => ({ x: a.x + (b.x - a.x) * t + ahead * 10 });
  const s = smooth.sample('a', 4000, mix), expect = (4000 - smooth.stats().delay) / 100;
  ok(Math.abs(s.x - expect) < 0.05, `interpolates on server time (${s.x.toFixed(3)} vs ${expect.toFixed(3)})`);
  const h = createInputHistory(); for (let i = 1; i <= 5; i++) h.record(i, { v: 1 }, 100, i);
  const st = reconcile({ authoritative: { x: 0 }, ackSeq: 3, history: h, step: (s0, input, dt) => ({ x: s0.x + input.v * dt }), now: 6 });
  ok(Math.abs(st.x - .2) < 1e-9, 'reconcile replays only unacknowledged inputs');
}

// --- governor: slows expensive rooms, recovers when calm.
{
  let t = 0; const g = createTickGovernor({ now: () => t }), room = {}, rate = { target: 33, max: 66 };
  eq(g.interval(room, rate), 33, 'starts at target');
  for (let i = 0; i < 80; i++) { t += 33; g.record(room, 25, rate); }
  ok(g.interval(room, rate) > 33, 'expensive tick steps down: ' + g.interval(room, rate));
  for (let i = 0; i < 400; i++) { t += 50; g.record(room, 1, rate); }
  eq(g.interval(room, rate), 33, 'calm room returns to 30 Hz');
}

// --- channel: missed frames resync from history or keyframe.
{
  const ch = createRealtimeChannel({ streams: [], publicView: s => ({ n: s.n }), privateView: () => ({}) });
  const dec = decodeFrame(), sock = {};
  for (let n = 0; n < 3; n++) { ch.prepare({ n }, null, {}); eq(dec.apply(ch.frameFor(sock, null, { mine: n })).n, n, 'delta ' + n); }
  for (let n = 3; n < 6; n++) ch.prepare({ n }, null, {}); // socket skipped three ticks
  eq(dec.apply(ch.frameFor(sock, null, {})).n, 5, 'gap inside history still patches');
  for (let n = 6; n < 12; n++) ch.prepare({ n }, null, {});
  eq(dec.apply(ch.frameFor(sock, null, {})).n, 11, 'long gap sends keyframe');
  const other = decodeFrame(); ch.prepare({ n: 12 }, null, {}); ch.frameFor(sock, null, {});
  ch.prepare({ n: 13 }, null, {});
  eq(other.apply(ch.frameFor(sock, null, {})), null, 'decoder without the base refuses a delta');
  ch.resync(sock); ch.prepare({ n: 14 }, null, {});
  eq(other.apply(ch.frameFor(sock, null, {})).n, 14, 'resync forces a keyframe');
}

// --- channel interest: a recipient's own entity is its focus; far ones thin out.
{
  const stream = { path: 'units', key: 'id', fields: [['x', 'f32'], ['z', 'f32']] };
  const units = Array.from({ length: 32 }, (_, i) => ({ id: 'u' + i, x: i * 5, z: 0, hp: 3 }));
  const ch = createRealtimeChannel({ streams: [stream], publicView: st => ({ units, simAt: st.t * 33 }), privateView: () => ({}) });
  const dec = decodeFrame(), sock = {}, seen = new Map();
  for (let t = 0; t < 9; t++) {
    ch.prepare({ t }, null, {});
    const view = dec.apply(ch.frameFor(sock, 'u0', {}));
    for (const u of view.units) if (u.rtAge === 0 && t > 0) seen.set(u.id, (seen.get(u.id) || 0) + 1);
  }
  eq(seen.get('u0'), 8, 'own and nearest entities every tick');
  eq(seen.get('u5'), 8, 'tenth nearest every tick');
  ok(seen.get('u31') === 2, 'farthest every fourth tick: ' + seen.get('u31'));
  ok(seen.get('u15') === 4, 'middle tier every other tick: ' + seen.get('u15'));
}

// --- shipping Pocket Karts room: rt1 decode equals JSON state.
await pocket.initialize();
{
  const room = new Room('RTT1', {});
  const sink = rt => ({ readyState: 1, bufferedAmount: 0, frames: [], ...(rt ? { realtime: 'rt1' } : {}), send(d) { this.frames.push(d); }, close() {} });
  const seats = [];
  for (let i = 0; i < 6; i++) { const s = sink(i % 2 === 0), r = room.addPlayer('D' + i, s); seats.push({ id: r.player.id, s, bot: createKartBot(r.player.id), dec: decodeFrame({ eventDeltas: false }), seq: 0, view: null }); }
  ok(!room.startGame(pocket, { settings: { map: 'Garden Circuit', mode: 'Zap Battle', winRule: 'Time limit', roundSeconds: 60 } }, seats[0].id).error, 'start');
  let now = Date.now(), compared = 0, bytesRt = 0, bytesJson = 0;
  const realNow = Date.now; Date.now = () => now;
  try {
    for (let step = 0; step < 220; step++) {
      now += 33; room.onTick(now);
      for (const seat of seats) {
        for (const f of seat.s.frames) {
          if (typeof f === 'string') { bytesJson += f.length; const m = JSON.parse(f); if (m.t === 'state') seat.view = m; }
          else { bytesRt += f.byteLength; const v = seat.dec.apply(f); ok(v, 'frame applies'); seat.view = v; }
        }
        seat.s.frames = [];
        const v = seat.view;
        if (v?.inputAck && v.phase === 'drive') room.onAction(seat.s, { input: seat.bot(v, now), seq: ++seat.seq, life: v.inputAck.life, controlEpoch: v.inputAck.controlEpoch }, { i: v.instanceId, w: v.w });
      }
      // Every recipient in a tick sees the same public state: compare an rt
      // seat's decode against a JSON seat's snapshot of the same tick.
      if (step % 10 === 9 && seats[0].view && seats[1].view && seats[0].view.serverNow === seats[1].view.serverNow) {
        const a = seats[0].view, b = { ...seats[1].view, you: a.you, inputAck: a.inputAck, coins: a.coins, garageResult: a.garageResult, youDrive: a.youDrive };
        const strip = v => JSON.parse(JSON.stringify({ ...v, karts: v.karts.map(k => ({ ...codec.stripStreamed(codec.compileSchema(KART_STREAM), k), rtAge: undefined })), events: undefined }));
        eq(strip(a), strip(b), 'decoded non-motion state equals JSON snapshot at step ' + step);
        for (const k of b.karts) {
          const d = a.karts.find(x => x.pid === k.pid);
          ok(Math.abs(d.physicalPose.position.x - k.physicalPose.position.x) < 1e-3 && Math.abs(d.angle - k.angle) < 2e-3, 'pose matches for near karts');
          ok(d.rtAge === 0, 'six karts are all full rate');
        }
        compared++;
      }
    }
  } finally { Date.now = realNow; pocket.dispose(room.game.state); }
  ok(compared >= 15, 'compared many ticks: ' + compared);
  ok(bytesRt * 4 < bytesJson, `binary ${bytesRt} B vs JSON ${bytesJson} B for the same seats`);
}
console.log(JSON.stringify({ pass: true, checks }));
