'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { createRunLog } = require('../public/js/toolkit/run-log.mjs');
const source = fs.readFileSync(path.join(__dirname, '../public/js/telemetry.js'), 'utf8');

async function harness({ failure = false, beaconFailure = false } = {}) {
  let time = 1000, nextTimer = 0;
  const timers = new Map(), handlers = new Map(), packets = [];
  const on = (type, fn) => { if (!handlers.has(type)) handlers.set(type, []); handlers.get(type).push(fn); };
  const math = Object.create(Math); math.random = () => 0;
  const context = { document: { hidden: false, addEventListener: on },
    location: { pathname: '/practice/', search: '?name=Alice&room=PRIVATE' },
    navigator: { userAgent: 'Chrome/123 Alice', hardwareConcurrency: 8, deviceMemory: 8,
      sendBeacon(url, blob) { packets.push({ url, blob }); if (beaconFailure) throw Error('offline'); return true; } },
    innerWidth: 390, innerHeight: 844, screen: { width: 390, height: 844 },
    addEventListener: on, frameElement: null, Math: math, Date: { now: () => time }, Blob, AbortSignal,
    fetch: async () => { if (failure) throw Error('offline'); return { ok: true, json: async () => ({ reportingEnabled: true, version: '1.2.3' }) }; },
    setTimeout: (fn, ms) => { timers.set(++nextTimer, { fn, at: time + ms }); return nextTimer; }, clearTimeout: id => timers.delete(id),
  };
  context.window = context;
  vm.runInNewContext(source, context);
  const telemetry = context.GiggleTelemetry;
  await telemetry.configPromise;
  const advance = ms => { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.fn(); } };
  const emit = (type, event = {}) => { for (const fn of handlers.get(type) || []) fn(event); };
  return { context, telemetry, emit, packets, advance, timers, async events() {
    const result = [];
    for (const packet of packets) { assert.equal(packet.url, '/api/telemetry'); assert(packet.blob.size <= 16384); result.push(...JSON.parse(await packet.blob.text()).events); }
    return result;
  } };
}
(async () => {
  const h = await harness();
  h.telemetry.context({ game: 'chess', screen: 'practice', phase: 'playing' });
  h.emit('error', { target: h.context, error: { name: 'TypeError', message: 'Alice PRIVATE https://site/?token=secret' } });
  h.emit('error', { target: h.context, error: { name: 'TypeError' } });
  h.emit('unhandledrejection', { reason: { name: 'Alice', message: 'PRIVATE' } });
  h.emit('error', { target: { tagName: 'IMG', src: 'https://site/Alice?token=PRIVATE' } });
  h.advance(5000);
  let events = await h.events();
  assert.equal(events.length, 3, 'batch and local fingerprint suppression');
  assert.equal(events[0].message, 'TypeError'); assert.equal(events[1].message, 'Error'); assert.equal(events[2].message, 'image');
  assert.equal(events[0].browser, 'Chrome'); assert.equal(events[0].tier, 'high');
  assert(!/Alice|PRIVATE|https:|token|userAgent/.test(JSON.stringify(events)), 'sensitive error, URL and UA text never enter beacon');
  h.telemetry.capture('load-error', 'failed'); h.context.document.hidden = true; h.emit('visibilitychange'); h.advance(5000);
  assert.equal(h.packets.length, 1, 'no hidden-tab beacon');
  h.context.document.hidden = false; h.advance(60000); h.telemetry.capture('load-error', 'failed'); h.advance(5000);
  assert.equal(h.packets.length, 1, 'no idle-tab beacon');
  h.emit('pointerdown'); h.telemetry.capture('load-retry', 'retry'); h.advance(5000);
  assert.equal(h.packets.length, 2, 'input resumes capture');
  h.telemetry.capture('socket-close', 'disconnected'); h.advance(5000); h.telemetry.capture('socket-loop', 'loop'); h.advance(5000);
  assert.equal(h.packets.length, 3, 'at most two batches in the new minute');
  assert.equal(h.timers.size, 0, 'no polling timer when queue is empty');
  const idle = await harness(); idle.telemetry.capture('runtime-error', 'Error'); idle.advance(65000);
  assert.equal(idle.packets.length, 0, 'queue expires if flush occurs while idle');
  const hiddenSeat = await harness(); hiddenSeat.context.frameElement = { closest: () => ({}) };
  hiddenSeat.telemetry.capture('runtime-error', 'Error'); hiddenSeat.advance(5000); assert.equal(hiddenSeat.packets.length, 0);
  const offline = await harness({ failure: true }); offline.telemetry.capture('runtime-error', 'Error'); offline.advance(5000);
  assert.equal(offline.packets.length, 0); assert.equal(offline.timers.size, 0, 'config failure does not retry forever');
  const brokenBeacon = await harness({ beaconFailure: true }); brokenBeacon.telemetry.capture('runtime-error', 'Error'); brokenBeacon.advance(5000);
  assert.equal(brokenBeacon.timers.size, 0, 'beacon failure does not retry or throw');
  const perf = await harness(); perf.telemetry.context({ game: 'pocket-karts', screen: 'game', phase: 'playing', map: 'Garden Circuit' });
  perf.telemetry.frames({ fps: 20, p95: 60 }); perf.advance(5000);
  perf.telemetry.frames({ fps: 20, p95: 60 }); perf.advance(5000);
  events = await perf.events(); assert(events.some(e => e.type === 'low-fps' && e.map === 'Garden Circuit' && e.p95 === 60));
  const sampled = await harness(); sampled.context.Math.random = () => .5;
  sampled.telemetry.capture('layout-shift', 'unstable'); sampled.telemetry.capture('long-task', 'blocked'); sampled.telemetry.capture('runtime-error', 'Error'); sampled.advance(5000);
  assert.deepEqual((await sampled.events()).map(e => e.type), ['runtime-error'], 'noisy performance signals sampled at ten percent; errors retained');
  let time = 0, frame, hidden = false, samples = [];
  const log = createRunLog({ now: () => time, visible: () => !hidden, storage: { getItem: () => null, setItem: () => {} }, requestFrame: fn => { frame = fn; return 1; }, cancelFrame: () => {}, onFrames: sample => samples.push(sample) });
  log.snapshot({ game: 'pocket-karts', instanceId: 'private', phase: 'play' });
  for (let i = 0; i < 260; i++) { time += 40; frame(time); }
  assert.equal(samples.length, 2); assert.equal(samples[0].fps, 25); assert.equal(samples[0].p95, 40);
  hidden = true; log.visibility(); time += 60000; frame(time); hidden = false; log.visibility();
  for (let i = 0; i < 130; i++) { time += 16; frame(time); }
  assert.equal(samples.length, 2, 'no hidden-time/partial-window FPS alerts');
  log.finish();
  const min = fs.readFileSync(path.join(__dirname, '../public/js/telemetry.min.js'));
  assert(gzipSync(min).length <= 2048, 'early collector gzip budget');
  console.log('TELEMETRY_CLIENT_PASS: privacy, batching, sampling, dedupe, idle/hidden seats, bounded sends, offline, sustained FPS and existing frame sampler');
})().catch(error => { console.error(error); process.exitCode = 1; });
