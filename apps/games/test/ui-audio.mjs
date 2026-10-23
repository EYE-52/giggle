import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createGameCuePlayer } from '../public/js/toolkit/game-cues.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bank = path.join(root, 'public/assets/game-audio');
const manifest = JSON.parse(fs.readFileSync(path.join(bank, 'manifest.json'), 'utf8'));
const files = Object.entries(manifest.cues);
assert.equal(files.length, 9);
assert.equal(new Set(files.map(([, cue]) => cue.sourceSha256)).size, 9, 'distinct recordings for game actions');
assert.equal(manifest.license, 'CC0-1.0');
assert.match(fs.readFileSync(path.join(bank, 'LICENSE.txt'), 'utf8'), /Creative Commons Zero, CC0/);
let bytes = 0;
for (const [name, cue] of files) {
  const wav = fs.readFileSync(path.join(bank, cue.file));
  assert.equal(crypto.createHash('sha256').update(wav).digest('hex'), cue.outputSha256, name + ' shipped hash');
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1, name + ' PCM codec');
  assert.equal(wav.readUInt16LE(22), 1, name + ' mono');
  assert.equal(wav.readUInt32LE(24), 22050);
  assert.equal(wav.readUInt16LE(34), 16);
  const duration = wav.readUInt32LE(40) / 44100;
  assert(duration > 0 && duration <= 0.65, name + ' brief nonempty recording');
  assert(Math.abs(duration - cue.durationSeconds) < 0.000001);
  let peak = 0;
  for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)) / 32767);
  assert(peak <= 0.551 && peak > 0, name + ' normalized, unclipped PCM');
  bytes += wav.length;
}
assert(bytes < 160000, 'small gameplay bank');

const source = fs.readFileSync(path.join(root, 'public/js/fx.js'), 'utf8');
const data = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64');
const util = data(fs.readFileSync(path.join(root, 'public/js/util.js'), 'utf8'));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
let serial = 0;
function harness({ off = false, active = false, unavailable = false } = {}) {
  const storage = new Map(off ? [['pb_sound', 'off']] : []);
  const requests = [], contexts = [], starts = [], stops = [], gains = [];
  let now = 1000;
  class Context {
    constructor() {
      if (unavailable) throw new Error('Audio unavailable');
      this.state = 'suspended'; this.destination = {}; this.resumeGate = deferred(); this.decodes = new Map(); contexts.push(this);
    }
    resume() { return this.resumeGate.promise; }
    releaseResume() { this.state = 'running'; this.resumeGate.resolve(); }
    decodeAudioData(buffer) { const gate = deferred(); this.decodes.set(buffer.file, gate); return gate.promise; }
    createBufferSource() {
      if (this.failSource) throw new Error('Source unavailable');
      return { playbackRate: { value: 1 }, disconnects: 0, connect: node => node, disconnect() { this.disconnects++; },
        start(...args) { starts.push({ source: this, args }); }, stop() { stops.push(this); } };
    }
    createGain() { const gain = { gain: { value: 1 }, disconnect() {}, connect: node => node }; gains.push(gain); return gain; }
  }
  globalThis.window = { AudioContext: Context, navigator: { userActivation: { isActive: active } } };
  globalThis.document = { hidden: false };
  globalThis.performance = { now: () => now };
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  globalThis.fetch = url => { const gate = deferred(); requests.push({ file: url.split('/').at(-1), gate }); return gate.promise; };
  const sound = import(data(source.replace("'./util.js'", JSON.stringify(util)) + '\n// instance ' + serial++)).then(module => module.sound);
  return { sound, contexts, requests, starts, stops, storage, gains, advance(ms = 1000) { now += ms; },
    async load(missing = []) {
      for (const request of requests) request.gate.resolve({ ok: !missing.includes(request.file), async arrayBuffer() { const value = new ArrayBuffer(1); value.file = request.file; return value; } });
      await flush();
    },
    async decode() {
      for (const [file, gate] of contexts[0].decodes) gate.resolve({ duration: manifest.cues[file.replace('.wav', '')].durationSeconds });
      await flush();
    },
  };
}

const originals = Object.fromEntries(['window', 'document', 'performance', 'fetch', 'localStorage'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
try {
  const h = harness(), sound = await h.sound;
  for (const name of ['click', 'lock', 'tick', 'turn', 'pop']) sound[name]();
  assert.equal(h.contexts.length, 0, 'legacy navigation APIs stay silent without loading audio');
  sound.cue('piece');
  assert.equal(h.contexts.length, 0, 'background phase cannot create/unlock audio');
  assert.equal(h.requests.length, 0, 'module/render has no audio load barrier');
  sound.unlock(); sound.cue('dice');
  assert.equal(h.requests.length, 9);
  assert.equal(h.starts.length, 0, 'cold and resuming cues are dropped synchronously');
  sound.toggle();
  h.contexts[0].releaseResume(); await h.load(); await h.decode();
  assert.equal(h.starts.length, 0, 'decode/resume after mute cannot replay a stale cue');
  assert.equal(sound.enabled, false);
  assert.equal(h.storage.get('pb_sound'), 'off');
  sound.toggle();
  assert.equal(h.starts.length, 0, 'unmute does not flush an old cue');
  for (const name of ['click', 'lock', 'tick', 'turn', 'pop']) sound[name]();
  assert.equal(h.starts.length, 0, 'warm homepage/menu calls also remain silent');
  assert.equal(sound.cue('piece', { gain: 8, rate: 3 }), true);
  assert.equal(h.gains.at(-1).gain.value, 0.30, 'gain cannot exceed the quiet per-action level');
  assert.equal(h.starts.at(-1).source.playbackRate.value, 1.1, 'bounded playback rate');
  assert.equal(sound.cue('piece'), false, 'dense repeats are throttled');
  h.advance(80); assert.equal(sound.cue('piece'), true);
  sound.cue('capture'); sound.cue('dice');
  assert.equal(sound.cue('burst'), false, 'at most four concurrent voices');
  assert(h.starts.every(start => start.args.length === 0), 'only immediate starts, no future scheduling');
  h.starts[0].source.onended(); assert.equal(sound.cue('burst'), true, 'ended voice frees the bounded slot');
  sound.unlock(); assert.equal(h.requests.length, 9, 'decoded asset cache is warmed once');
  sound.toggle(); assert.equal(h.stops.length, 4, 'mute stops every remaining voice immediately');
  for (const start of h.starts) start.source.onended();
  assert(h.starts.every(start => start.source.disconnects === 1), 'mute/ended cleanup is idempotent');
  sound.toggle();
  const before = h.starts.length;
  h.contexts[0].state = 'suspended'; h.contexts[0].resumeGate = deferred();
  window.navigator.userActivation.isActive = true;
  sound.cue('piece'); assert.equal(h.starts.length, before, 'a gesture during resume does not queue that cue');
  h.contexts[0].releaseResume(); await flush();
  assert.equal(h.starts.length, before, 'resume completion remains silent');
  sound.cue('piece'); assert.equal(h.starts.length, before + 1, 'fresh cue works after gesture resume');
  document.hidden = true; h.advance(); assert.equal(sound.cue('capture'), false, 'hidden game drops audio');
  document.hidden = false;
  h.contexts[0].failSource = true;
  assert.doesNotThrow(() => sound.cue('capture'), 'audio failure cannot throw through input/render');
  sound.stop(); assert.equal(sound.cue('not-a-cue'), false);

  const keyboard = harness({ active: true }), keys = await keyboard.sound;
  keys.cue('piece'); assert.equal(keyboard.contexts.length, 1, 'first keyboard gameplay gesture can warm audio');
  assert.equal(keyboard.starts.length, 0, 'first cold keyboard cue is not deferred');
  keyboard.contexts[0].releaseResume(); await keyboard.load(); await keyboard.decode();
  keys.cue('piece'); assert.equal(keyboard.starts.length, 1); keys.toggle();

  const failed = harness({ off: true }), muted = await failed.sound;
  muted.cue('dice'); muted.unlock();
  assert.equal(failed.contexts.length, 0, 'saved mute refuses even sample loading');
  muted.toggle(); muted.unlock(); failed.contexts[0].releaseResume();
  await failed.load(['win.wav']); await failed.decode();
  muted.win(); assert.equal(failed.starts.length, 0, 'failed assets stay silent');
  assert.equal(failed.requests.length, 9, 'background cues do not retry failed assets');
  window.navigator.userActivation.isActive = true;
  muted.win(); assert.equal(failed.requests.length, 10, 'later trusted activation retries only the missing clip');
  muted.unlock(); muted.win(); assert.equal(failed.requests.length, 10, 'in-flight retry is shared by later cues');
  await failed.load(); await failed.decode();
  assert.equal(failed.starts.length, 0, 'retry completion cannot replay a stale cue');
  muted.win(); assert.equal(failed.starts.length, 1, 'fresh next cue uses recovered recording');
  muted.unlock(); assert.equal(failed.requests.length, 10, 'successful recordings stay cached'); muted.toggle();

  const absent = harness({ unavailable: true, active: true }), unsupported = await absent.sound;
  assert.doesNotThrow(() => { unsupported.unlock(); unsupported.cue('piece'); unsupported.toggle(); });

  let snapshot = { instanceId: 'one', game: 'ludo' }, env = { game: 'ludo', connected: true }, available = true;
  const audible = [], attempts = [];
  const cue = createGameCuePlayer((name, options) => { attempts.push(options.id); if (available) audible.push([name, options.id]); return available; }, () => snapshot, () => env);
  assert.equal(cue('piece', { id: 'one:move:1' }), true);
  assert.equal(cue('piece', { id: 'one:move:1' }), false, 'same observed event sounds once');
  for (const reason of ['preparing', 'audioBaseline', 'hidden', 'pending']) {
    if (reason in { preparing: 1, audioBaseline: 1 }) snapshot[reason] = true; else env[reason] = true;
    const id = 'one:' + reason;
    assert.equal(cue('piece', { id }), false);
    delete snapshot[reason]; delete env[reason];
    assert.equal(cue('piece', { id }), false, reason + ' event is consumed, never queued');
  }
  available = false; assert.equal(cue('piece', { id: 'one:cold' }), false);
  available = true; assert.equal(cue('piece', { id: 'one:cold' }), false, 'cold/muted event never sounds after availability changes');
  assert.equal(cue('piece', { id: 'old:move' }), false, 'stale instance cue rejected');
  assert.equal(cue('piece', {}), false, 'unidentified cues rejected');
  env.game = 'other'; assert.equal(cue('piece', { id: 'one:wrong-game' }), false); env.game = 'ludo';
  env.connected = false; assert.equal(cue('piece', { id: 'one:offline' }), false); env.connected = true;
  snapshot = { instanceId: 'two', game: 'ludo' };
  assert.equal(cue('piece', { id: 'one:late-timer' }), false);
  assert.equal(cue('piece', { id: 'two:move:1' }), true, 'rematch uses a fresh event scope');
  assert.equal(audible.length, 2); assert.equal(attempts.length, 3);
  console.log(`GAME_AUDIO_PASS: nine recorded CC0 WAVs (${bytes} bytes); quiet navigation, cold/resume/mute/cache/voice/gain lifecycle; instance-scoped semantic event gate`);
} finally {
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
}
