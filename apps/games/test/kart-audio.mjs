/* Pocket Karts audio tests: sampled lifecycle + audibility.
 * No browser, no server, no new deps. The stub AudioContext records every
 * node, ramp, start/stop, resume, decode and close; the stub loader records
 * every asset request with controllable resolve/reject so the suite proves:
 * nothing before a gesture, local exact paths, every cue schedules its
 * decoded buffer (never an oscillator), sampled engine pitch/gain riding,
 * latest-frame-after-ready, no late/queued cues, mute/inactive/hidden/KO
 * silence, bounded steal, rejected-resume recovery, bounded retries with no
 * per-frame fetch storm, Safari callback decode, quiet failure + partial
 * packs, and clean disposal (abort/inert/close once).
 * Run: node test/kart-audio.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createKartAudio, CUE_NAMES, ASSET_MAP, LOOP_MAP, COLLISION_VARIANTS, ASSET_BASE, PACK_VERSION, WEAPON_POP, SYNTH_CUE_NAMES, SYNTH_CUE_SPEC } from '../public/js/engines/kart-audio.mjs';

let passed = 0;
function ok(cond, msg) {
  assert(cond, msg);
  passed += 1;
}
const tick = (n = 5) => new Promise((r) => { const f = () => (n-- <= 0 ? r() : queueMicrotask(f)); f(); });
/* Bank v5: phase-coherent recorded combustion, four loop beds,19 named cues. */
const FILE_COUNT = new Set([...Object.values(LOOP_MAP),...Object.values(ASSET_MAP),...Object.values(COLLISION_VARIANTS)]).size;

/* ---------- stubs ---------- */

function makeEmitter() {
  const listeners = new Map();
  return {
    hidden: false,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
    },
    dispatch(type, ev) {
      for (const fn of [...(listeners.get(type) || [])]) fn(ev || {});
    },
    total() {
      let n = 0;
      for (const set of listeners.values()) n += set.size;
      return n;
    },
  };
}

function makeParam() {
  return {
    value: 0,
    max: -Infinity,
    calls: 0,
    targets: [],
    sampleAt(t) {
      // Evaluate Web Audio's exponential target law, including a new target
      // while the previous ramp is still moving. Targets are not immediate.
      let value=0, target=0, time=0, tc=0;
      for(const event of this.targets){
        if(event.time>t)break;
        value=tc ? target+(value-target)*Math.exp(-(event.time-time)/tc) : target;
        target=event.value;time=event.time;tc=event.tc;
      }
      return tc ? target+(value-target)*Math.exp(-(t-time)/tc) : target;
    },
    set(v) {
      this.value = v;
      this.calls += 1;
      if (v > this.max) this.max = v;
    },
    setValueAtTime(v) { this.set(v); },
    linearRampToValueAtTime(v) { this.set(v); },
    exponentialRampToValueAtTime(v) { this.set(v); },
    setTargetAtTime(v,t,tc) { this.targets.push({value:v,time:t,tc}); this.set(v); },
  };
}

/* options: resume 'ok'|'reject', noComp, noBufSrc, noPan, panThrows,
 * decode 'promise'|'callback'|'reject' */
function makeFakeAudio(opts = {}) {
  const nodes = [];
  const stats = {
    osc: 0, gain: 0, filter: 0, bufSrc: 0, comp: 0,
    starts: 0, stops: 0, resumes: 0, closes: 0, disconnects: 0, connects: 0, decodes: 0, buffers: 0,
  };
  let resumeMode = opts.resume || 'ok';
  const decodeMode = opts.decode || 'promise';
  const decodedBytes = new WeakSet();
  const base = (kind) => {
    const node = {
      id: nodes.length, kind, stops: [], starts: [], disconnects: 0, onended: null,
      connect() { stats.connects += 1; },
      disconnect() { stats.disconnects += 1; node.disconnects += 1; },
    };
    nodes.push(node);
    return node;
  };
  const source = (node) => {
    node.start = (t) => { stats.starts += 1; node.starts.push(t); };
    node.stop = (t) => { stats.stops += 1; node.stops.push(t); };
    return node;
  };
  const fakeBuffer = (bytes) => ({ duration: 0.5, sampleRate: 44100, bytes: bytes || null });
  const ctx = {
    currentTime: 10,
    state: 'suspended',
    sampleRate: 44100,
    destination: { kind: 'destination' },
    setResumeMode(m) { resumeMode = m; },
    createGain() {
      stats.gain += 1;
      return Object.assign(base('gain'), { gain: makeParam() });
    },
    createOscillator() {
      stats.osc += 1;
      return source(Object.assign(base('osc'), {
        type: 'sine', frequency: makeParam(), detune: makeParam(),
      }));
    },
    createBuffer(channels, length, rate) {
      stats.buffers += 1;
      const data = new Float32Array(length);
      return { duration: length / rate, sampleRate: rate, numberOfChannels: channels, getChannelData: () => data };
    },
    createBiquadFilter() {
      stats.filter += 1;
      return Object.assign(base('filter'), {
        type: 'lowpass', frequency: makeParam(), Q: makeParam(),
      });
    },
    createBufferSource() {
      if (opts.noBufSrc) throw new Error('no buffers');
      stats.bufSrc += 1;
      return source(Object.assign(base('buf'), {
        buffer: null, loop: false, playbackRate: makeParam(),
      }));
    },
    createDynamicsCompressor() {
      if (opts.noComp) throw new Error('no compressor');
      stats.comp += 1;
      return Object.assign(base('comp'), {
        threshold: makeParam(), ratio: makeParam(),
        attack: makeParam(), release: makeParam(),
      });
    },
    decodeAudioData(bytes, onSuccess, onFailure) {
      stats.decodes += 1;
      if (decodedBytes.has(bytes)) throw new Error('ArrayBuffer already detached by decode');
      decodedBytes.add(bytes);
      if (decodeMode === 'reject') {
        const err = new Error('bad bytes');
        if (typeof onSuccess === 'function') { queueMicrotask(() => onFailure && onFailure(err)); return undefined; }
        return Promise.reject(err);
      }
      if (decodeMode === 'callback') {
        // Safari-style: single-arg call returns undefined and decodes nothing;
        // the 3-arg form delivers the buffer via callback.
        if (typeof onSuccess !== 'function') return undefined;
        queueMicrotask(() => onSuccess(fakeBuffer(bytes)));
        return undefined;
      }
      const p = Promise.resolve(fakeBuffer(bytes));
      if (typeof onSuccess === 'function') p.then(onSuccess, onFailure);
      return p;
    },
    resume() {
      stats.resumes += 1;
      if (resumeMode === 'reject') return Promise.reject(new Error('NotAllowedError'));
      ctx.state = 'running';
      return Promise.resolve();
    },
    close() {
      stats.closes += 1;
      ctx.state = 'closed';
      return Promise.resolve();
    },
  };
  if (!opts.noPan) ctx.createStereoPanner = () => {
    if (opts.panThrows) throw new Error('panner unavailable');
    return Object.assign(base('panner'), { pan: makeParam() });
  };
  return { ctx, nodes, stats };
}

/* Controllable asset loader: captures urls/signals; impl swappable. */
function makeLoader() {
  const calls = [];
  let impl = () => Promise.resolve(new Uint8Array([1, 2, 3, 4]).buffer);
  const fn = (url, signal) => {
    calls.push({ url, signal });
    try {
      return Promise.resolve(impl(url, signal));
    } catch (e) {
      return Promise.reject(e);
    }
  };
  fn.calls = calls;
  fn.urls = () => calls.map((c) => c.url);
  fn.setImpl = (f) => { impl = f; };
  return fn;
}

/* Manual loader: each request parks until released (per-file control). */
function makeManualLoader() {
  const inner = makeLoader();
  const parked = [];
  inner.setImpl((url) => new Promise((resolve, reject) => parked.push({ url, resolve, reject })));
  inner.parked = parked;
  inner.releaseAll = (failUrls = []) => {
    const fail = new Set(failUrls);
    for (const p of parked.splice(0)) {
      if ([...fail].some((f) => p.url.includes(f))) p.reject(new Error('404 ' + p.url));
      else p.resolve(new Uint8Array([9, 9, 9]).buffer);
    }
  };
  return inner;
}

function withGlobals(stubs, fn) {
  const saved = {};
  const had = {};
  for (const k of Object.keys(stubs)) {
    had[k] = Object.prototype.hasOwnProperty.call(globalThis, k);
    saved[k] = globalThis[k];
    if (stubs[k] === undefined) delete globalThis[k];
    else globalThis[k] = stubs[k];
  }
  const restore = () => {
    for (const k of Object.keys(stubs)) {
      if (!had[k]) delete globalThis[k];
      else globalThis[k] = saved[k];
    }
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.then((v) => { restore(); return v; }, (e) => { restore(); throw e; });
    restore();
    return out;
  } catch (e) {
    restore();
    throw e;
  }
}

const gainsOf = (nodes) => nodes.filter((n) => n.kind === 'gain');
const bufSourcesOf = (nodes) => nodes.filter((n) => n.kind === 'buf');

/* Persistent-graph gain order: master, engineBus, cueBus, engG, driftG, revG. */
function graphGains(nodes) {
  const g = gainsOf(nodes);
  return {
    master: g[0].gain, engineBus: g[1].gain, cueBus: g[2].gain, idleG:g[3].gain, loadG:g[6].gain,
    driftG: g[4].gain, revG: g[5].gain,
  };
}
// Recorded loop beds play decoded sample buffers (fakeBuffer carries bytes);
// the engine's generated noise texture loop (createBuffer) is not a bed.
const loopSourcesOf = (nodes) => bufSourcesOf(nodes).filter((n) => n.loop === true && n.buffer && 'bytes' in n.buffer);
const noiseLoopsOf = (nodes) => bufSourcesOf(nodes).filter((n) => n.loop === true && n.buffer && !('bytes' in n.buffer));
const cueVoicesOf = (nodes) => bufSourcesOf(nodes).filter((n) => n.loop === false);

/* Contact loudness/material selection does not allocate chatter voices. */
await withGlobals({document:makeEmitter()},async()=>{
  const {ctx,nodes}=makeFakeAudio(),audio=createKartAudio({createContext:()=>ctx,loader:makeLoader()});
  audio.unlock();await audio.ready();audio.update({active:true});
  ok(audio.cue('collision',{strength:.2}),'contact: small bump plays');
  const soft=cueVoicesOf(nodes).at(-1),softPeak=gainsOf(nodes).at(-1).gain.max;
  ok(!audio.cue('collision',{strength:1})&&cueVoicesOf(nodes).length===1,'contact: resting repeats allocate no chatter voice');
  ctx.currentTime+=.12;
  ok(audio.cue('collision',{strength:1}),'contact: later real impact plays');
  ok(cueVoicesOf(nodes).at(-1).buffer!==soft.buffer,'contact: stronger body contact uses distinct metal recording');
  ok(gainsOf(nodes).at(-1).gain.max>softPeak,'contact: measured strength scales bounded loudness');
  ok(audio.cue('landing')&&audio.cue('rocketBlast')&&audio.cue('bombBlast')&&audio.cue('nukeBlast'),'contact: landing and distinct detonation keys are ready');
  audio.dispose();
});

// The same running tyre nodes change texture between surfaces; no new voices.
await withGlobals({document:makeEmitter()},async()=>{
  const {ctx,nodes}=makeFakeAudio(),audio=createKartAudio({createContext:()=>ctx,loader:makeLoader()});
  audio.unlock();await audio.ready();const initial=nodes.length;
  const sample=surface=>{audio.update({speed:18,throttle:1,drifting:true,surface,grounded:true,active:true});return nodes.filter(n=>n.kind==='filter').map(n=>n.frequency.value);};
  const road=sample('road'),sand=sample('sand'),ice=sample('ice');
  ok(sand.some((hz,i)=>Math.abs(hz-road[i])>300),'sand changes the continuous tyre texture');
  ok(ice.some((hz,i)=>hz>road[i]+1000),'ice has a distinct glassy high squeal');
  ok(nodes.length===initial,'surface changes reuse continuous nodes');
  audio.update({speed:18,drifting:true,surface:'ice',grounded:false,active:true});
  audio.dispose();ok(nodes.every(n=>n.disconnects===1),'surface texture nodes dispose once');
});

/* ---------- 0. static contract ---------- */

/* Arsenal aliases share decoded buffers and keep launch levels/lifecycle. */
await withGlobals({document:makeEmitter()},async()=>{
  const {ctx,nodes}=makeFakeAudio(),loader=makeLoader();
  const audio=createKartAudio({createContext:()=>ctx,loader});
  audio.unlock();await audio.ready();audio.update({active:true});
  for(const [alias,original] of [['seeker','rocket'],['block','shield']]){
    ok(audio.cue(original),`alias: ${original} plays`);
    const canonical=cueVoicesOf(nodes).at(-1),peak=gainsOf(nodes).at(-1).gain.max;
    ok(audio.cue(alias),`alias: ${alias} does not drop as an unknown cue`);
    ok(cueVoicesOf(nodes).at(-1).buffer===canonical.buffer,`alias: ${alias} shares cached launch buffer`);
    ok(gainsOf(nodes).at(-1).gain.max===peak,`alias: ${alias} preserves launch gain`);
  }
  // Hit feedback reuses recordings at its own level.
  for(const [alias,original] of [['hurt','collision'],['hitConfirm','pickup']]){
    ctx.currentTime+=.2;
    ok(audio.cue(original),`alias: ${original} plays`);
    const canonical=cueVoicesOf(nodes).at(-1);
    ok(audio.cue(alias),`alias: ${alias} does not drop as an unknown cue`);
    ok(cueVoicesOf(nodes).at(-1).buffer===canonical.buffer,`alias: ${alias} shares the cached ${original} buffer`);
  }
  ok(loader.calls.length===20,'alias: exactly20 unique sample requests');
  audio.setMuted(true);
  ok(!audio.cue('seeker')&&!audio.cue('nuke')&&!audio.cue('hurt'),'alias: mute also blocks new arsenal names');
  audio.dispose();
  ok(nodes.every(n=>n.disconnects===1),'alias: every owned node disconnects once');
});

/* Caller attenuation/pan changes the actual voice graph, with bounded ownership. */
await withGlobals({document:makeEmitter()},async()=>{
  const {ctx,nodes}=makeFakeAudio(),audio=createKartAudio({createContext:()=>ctx,loader:makeLoader()});
  audio.unlock();await audio.ready();audio.update({active:true});
  const panners=()=>nodes.filter(n=>n.kind==='panner');
  ok(audio.cue('pulse',{gain:.25,pan:-3}),'mix: attenuated cue plays');
  ok(gainsOf(nodes).at(-1).gain.max===.08,'mix: quarter gain scales cue peak to0.08');
  ok(panners().at(-1).pan.value===-1,'mix: left pan clamps to-1');
  const ended=cueVoicesOf(nodes).at(-1),endedPan=panners().at(-1);
  ended.onended();ended.onended();
  ok(endedPan.disconnects===1,'mix: natural end cleans panner exactly once');
  ok(audio.cue('pulse'),'mix: original one-argument caller still plays');
  ok(gainsOf(nodes).at(-1).gain.max===.32&&panners().at(-1).pan.value===0,'mix: defaults preserve full gain and centered pan');
  ok(audio.cue('pulse',{gain:4,pan:4}),'mix: oversized values clamp and play');
  ok(gainsOf(nodes).at(-1).gain.max===.32&&panners().at(-1).pan.value===1,'mix: gain caps at1 and right pan at1');
  const count=nodes.length;
  ok(!audio.cue('pulse',{gain:0})&&!audio.cue('pulse',{gain:-1})&&nodes.length===count,'mix: zero/negative attenuation allocates no voice');
  for(let i=0;i<20;i++)audio.cue('pulse',{gain:.1,pan:.5});
  ok(panners().filter(n=>n.disconnects===0).length===16,'mix: panners remain within16 live voice cap');
  audio.dispose();
  ok(panners().every(n=>n.disconnects===1),'mix: steal/end/dispose disconnect every panner once');
});

for(const opts of [{noPan:true},{panThrows:true}])await withGlobals({document:makeEmitter()},async()=>{
  const {ctx,nodes}=makeFakeAudio(opts),audio=createKartAudio({createContext:()=>ctx,loader:makeLoader()});
  audio.unlock();await audio.ready();audio.update({active:true});
  ok(audio.cue('proximity',{gain:.5,pan:-.8}),'mix fallback: no usable StereoPanner still schedules');
  ok(gainsOf(nodes).at(-1).gain.max===.16,'mix fallback: attenuation retained without pan backend');
  ok(!nodes.some(n=>n.kind==='panner'),'mix fallback: unsupported pan has no extra owned node');
  audio.dispose();
  ok(nodes.every(n=>n.disconnects===1),'mix fallback: safe clean disposal');
});

{
  const src = fs.readFileSync(
    fileURLToPath(new URL('../public/js/engines/kart-audio.mjs', import.meta.url)), 'utf8');
  assert.deepEqual([...src.matchAll(/^import.*from ['"]([^'"]+)['"]/gm)].map(m=>m[1]),['./kart-surface.mjs'],'audio imports only the pure shared surface profiles; no new package dependency');
  ok(!/getUserMedia|getDisplayMedia|MediaStream/.test(src), 'contract: audio-only, never microphone capture');
  ok(!/setInterval|setTimeout|requestAnimationFrame/.test(src), 'contract: no timers (frame-driven only)');
  const synthAt = src.indexOf('export function createSynthCues'), sampled = synthAt < 0 ? src : src.slice(0, synthAt);
  ok((sampled.match(/createOscillator\(\)/g)||[]).length === 3, 'contract: outside the synthesized weapon cues, oscillators only in the engine voice, weapon pops and the warning beep');
  ok(synthAt > 0 && !/fetch|decodeAudioData|\.wav/.test(src.slice(synthAt)), 'contract: the second-eight weapon cues are synthesized, never loaded from files');
  const V1_CUES = ['boost', 'ko', 'mine', 'pickup', 'pulse', 'respawn', 'rocket', 'scatter', 'shield'];
  ok(V1_CUES.every((n) => CUE_NAMES.includes(n)),
    'contract: original cue names preserved (rail retired)');
  ok(CUE_NAMES.length === 20 && ['landing','rocketBlast','bombBlast','nukeBlast','seeker','proximity','nuke','hurt','hitConfirm','block'].every((n) => CUE_NAMES.includes(n)),
    'contract: landing/blasts, arsenal and hit-feedback cues present (20 cues)');
  ok(['rail','emp','grenade','bomb','grenadeBlast','sentry','spikes'].every((n) => !CUE_NAMES.includes(n) && !(n in ASSET_MAP)),
    'contract: retired weapon cues are gone');
  ok(!Object.values(ASSET_MAP).some((f) => f === 'rail.wav' || f === 'emp.wav'), 'contract: deleted rail/emp samples are never requested');
  ok(JSON.stringify(Object.keys(ASSET_MAP).sort()) === JSON.stringify([...CUE_NAMES].sort()),
    'contract: ASSET_MAP covers every cue');
  ok(Object.values(ASSET_MAP).every((f) => typeof f === 'string' && f.endsWith('.wav')),
    'contract: every cue maps to a local WAV file');
  ok(new Set(Object.values(ASSET_MAP)).size === CUE_NAMES.length-5, 'contract: only the five documented aliases share samples');
  ok(ASSET_MAP.seeker === ASSET_MAP.rocket && ASSET_MAP.proximity === 'grenade.wav' && ASSET_MAP.nuke === 'grenade.wav' && ASSET_MAP.nukeBlast === 'grenadeBlast.wav',
    'contract: seeker reuses rocket launch, proximity/nuke reuse canister throw and blast');
  ok(ASSET_MAP.hurt === ASSET_MAP.collision && ASSET_MAP.hitConfirm === ASSET_MAP.pickup && ASSET_MAP.block === ASSET_MAP.shield,
    'contract: hurt, hit confirm and block reuse collision, pickup and shield');
  ok(JSON.stringify(Object.keys(LOOP_MAP).sort()) === JSON.stringify(['drift', 'engine', 'engineLoad', 'reverse']),
    'contract: 4 loop beds exported');
  ok(ASSET_BASE === '../../assets/karts/audio/', 'contract: versioned relative local asset base');
  ok(Number.isInteger(PACK_VERSION) && PACK_VERSION >= 1, 'contract: pack version present');
}

/* ---------- 1. nothing before a gesture ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  let made = 0;
  const { ctx } = makeFakeAudio();
  const loader = makeLoader();
  const audio = createKartAudio({ createContext: () => { made += 1; return ctx; }, loader });
  ok(made === 0, 'lazy: no context before gesture');
  ok(loader.calls.length === 0, 'lazy: zero asset requests before gesture');
  ok(audio.isUnlocked() === false, 'lazy: starts locked');
  ok(audio.update({ speed: 12, throttle: 1 }) === false, 'lazy: update schedules nothing');
  ok(audio.cue('ko') === false, 'lazy: cue schedules nothing');
  ok(loader.calls.length === 0, 'lazy: update/cue request nothing while locked');
  ok((await audio.ready()) === false, 'lazy: not ready before gesture');
  ok(audio.status().pending.length === FILE_COUNT, `lazy: all ${FILE_COUNT} samples pending`);
  ok(audio.cues().length === CUE_NAMES.length, 'lazy: cue list available pre-unlock');
  audio.dispose();
});

/* Explicit loading-screen preparation leaves the gesture gate closed. */
await withGlobals({ document: makeEmitter() }, async () => {
  let made = 0;
  const { ctx, nodes, stats } = makeFakeAudio(), loader = makeLoader();
  const audio = createKartAudio({ createContext: () => { made++; return ctx; }, loader });
  ok(audio.prep() === true && made === 1, 'prep: creates context during loading');
  ok(!audio.isUnlocked() && stats.resumes === 0, 'prep: never unlocks or resumes outside a gesture');
  ok(nodes[0].gain.value === 0 && !audio.cue('machinegun'), 'prep: master is silent and cues remain locked');
  ok(stats.buffers === 2, 'prep: engine and weapon noise are generated before first drive/fire');
  ok(await audio.ready(), 'prep: all sample decodes finish before readiness');
  ok(loopSourcesOf(nodes).length === 4, 'prep: silent loop sources are already built');
  const nodeCount = nodes.length, bufferCount = stats.buffers, requests = loader.calls.length;
  audio.prep(); await audio.ready();
  ok(made === 1 && nodes.length === nodeCount && stats.buffers === bufferCount && loader.calls.length === requests, 'prep: repeated loading checks reuse graph, noise and decoded samples');
  audio.unlock();
  ok(made === 1 && nodes.length === nodeCount && stats.resumes === 1 && nodes[0].gain.value === .8, 'prep: first gesture only resumes and enables existing graph');
  audio.update({ active: true, speed: 8, throttle: 1 });
  audio.cue('machinegun'); audio.cue('cannonBoom');
  ok(stats.buffers === bufferCount && stats.decodes === FILE_COUNT && loader.calls.length === requests, 'prep: first drive and weapon/explosion reuse prepared noise and samples');
  audio.dispose();
  ok(stats.closes === 1 && nodes.every(n => n.disconnects >= 1), 'prep: silent and played graph resources retire together');
  ok(!audio.prep() && !await audio.ready(), 'prep: disposed loading handle stays inert');
});

await withGlobals({ document: makeEmitter() }, async () => {
  const { ctx, stats } = makeFakeAudio(), loader = makeManualLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  audio.prep(); const pending = audio.ready(); audio.dispose();
  ok(!await pending && stats.closes === 1, 'prep: leaving loading settles readiness and closes the locked context');
  loader.releaseAll();
});

/* ---------- 2. unlock loads once from exact local paths; no per-frame fetch ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  const { ctx, nodes, stats } = makeFakeAudio();
  const loader = makeLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  ok(audio.unlock() === true, 'unlock: graph builds');
  ok(ctx.state === 'running' && stats.resumes === 1, 'unlock: resumes suspended ctx');
  ok(stats.comp === 1, 'unlock: safety compressor in chain');
  ok(stats.osc === 3, 'unlock: three-oscillator synthesized engine voice');
  ok(loader.calls.length === FILE_COUNT, `unlock: one request per sample (got ${loader.calls.length})`);
  for (const f of [...Object.values(LOOP_MAP), ...Object.values(ASSET_MAP)]) {
    const want = `assets/karts/audio/${f}?v=${PACK_VERSION}`;
    ok(loader.urls().some((u) => u.includes(want)), `unlock: exact local path for ${f}`);
  }
  ok(loader.urls().every((u) => !/^[a-z]+:\/\//i.test(u) || u.startsWith('file:')),
    'unlock: no remote fetch (local relative resolution only)');
  ok((await audio.ready()) === true, 'unlock: ready once every sample decodes');
  ok(stats.decodes === FILE_COUNT, 'unlock: every sample decoded once');
  const loops = loopSourcesOf(nodes);
  ok(loops.length === 4, `unlock: 4 loop beds started (got ${loops.length})`);
  ok(loops.every((s) => s.buffer && s.starts.length === 1), 'unlock: loops carry decoded buffers');

  // 60 hot frames: ramps only, zero nodes, zero refetch.
  audio.update({ speed: 8, throttle: 1, active: true });
  const before = { ...stats };
  const callsBefore = loader.calls.length;
  for (let i = 0; i < 60; i++) {
    audio.update({ speed: (i % 15) - 3, throttle: (i % 3) - 1, drifting: i % 2 === 0, boost: i % 7, active: true });
  }
  ok(stats.osc === before.osc && stats.gain === before.gain &&
    stats.filter === before.filter && stats.bufSrc === before.bufSrc,
    'engine: 60 updates allocate zero nodes (ramps only)');
  ok(loader.calls.length === callsBefore, 'engine: 60 updates fetch zero assets');
  ok(loopSourcesOf(nodes).length === 4, 'engine: loop sources created once, never per frame');
  audio.dispose();
});

/* Locked state must gate asynchronous decoding after the first gesture. */
await withGlobals({ document: makeEmitter() }, async () => {
  const { ctx, nodes } = makeFakeAudio();
  const loader = makeManualLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  ok(audio.update({speed:12,throttle:1,active:false,engineActive:false}) === false,
    'locked state: retains inactive/KO pose without creating audio');
  audio.unlock(); loader.releaseAll(); await audio.ready();
  ok(loopSourcesOf(nodes).length === 0, 'locked state: decode cannot start an inactive engine');
  ok(audio.cue('ko') === false, 'locked state: inactive event is refused');
  audio.update({speed:12,throttle:1,active:true,engineActive:false});
  ok(loopSourcesOf(nodes).length === 0, 'locked state: watcher/KO keeps continuous beds quiet');
  ok(audio.cue('ko') === true, 'locked state: nearby authoritative watcher cue remains available');
  audio.update({speed:12,throttle:1,active:true,engineActive:true});
  const engine=loopSourcesOf(nodes)[0];
  ok(engine.playbackRate.value > 1.05, 'locked state: first audible frame uses current drive pitch');
  audio.dispose();
});

/* Public options cannot redirect shipping assets away from the module. */
for (const baseURL of ['https://outside.invalid/audio/', '//outside.invalid/', '../wrong/']) {
  const {ctx}=makeFakeAudio(); const loader=makeLoader();
  const audio=createKartAudio({createContext:()=>ctx,loader,baseURL,allowRemote:true});
  audio.unlock(); await audio.ready();
  const expected=new URL('../public/assets/karts/audio/',import.meta.url);
  ok(loader.urls().every(u=>u.startsWith(expected.href)), 'local-only: legacy/arbitrary base ignored '+baseURL);
  audio.dispose();
}

/* ---------- 3. sampled engine rides pitch/gain/filter without wild buzz ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  const { ctx, nodes } = makeFakeAudio();
  const loader = makeLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  audio.unlock();
  ok((await audio.ready()) === true, 'sampled: pack ready');
  const g = graphGains(nodes);
  ok(g.master.value <= 0.9, 'sampled: volume-safe master');
  const engine = loopSourcesOf(nodes)[0];

  ok(audio.update({ speed: 0, throttle: 0, active: true }) === true, 'sampled: idle update applies');
  const idleBus = g.engineBus.value;
  ok(g.idleG.value>.19&&g.loadG.value<.001,'sampled: idle uses its own recorded putter under the synth voice');
  const idleRate = engine.playbackRate.value;
  const filt = nodes.find((n) => n.kind === 'filter').frequency;
  ok(filt.value >= 1200, 'sampled: idle filter preserves recorded engine midrange');
  ok(idleBus > 0.15, `sampled: idle bed audible (bus ${idleBus.toFixed(2)})`);
  ok(idleRate >= 0.8 && idleRate <= 1.0, `sampled: idle rate near unity (${idleRate.toFixed(2)}x)`);

  const synthOsc = nodes.filter((n) => n.kind === 'osc'), synthHz = synthOsc[0].frequency.value;
  ok(synthOsc.length === 3 && synthOsc.every((o) => o.starts.length === 1), 'synth: three engine oscillators started once');
  ok(synthHz >= 55 && synthHz <= 75, `synth: idle fires near 62 Hz (${synthHz.toFixed(0)})`);
  ok(audio.update({ speed: 12, throttle: 1, active: true }) === true, 'sampled: drive update applies');
  ok(synthOsc[0].frequency.value > synthHz * 1.8, `synth: pitch climbs with speed (${synthOsc[0].frequency.value.toFixed(0)} Hz)`);
  ok(Math.abs(synthOsc[1].frequency.value / synthOsc[0].frequency.value - 2.012) < 1e-6, 'synth: detuned octave square rides with the saw');
  const hotRate = engine.playbackRate.value;
  ok(hotRate > idleRate + 0.08, `sampled: rate rises with speed (${idleRate.toFixed(2)}->${hotRate.toFixed(2)}x)`);
  ok(hotRate <= 1.5, `sampled: lower-RPM idle recording stays inside tuned span (${hotRate.toFixed(2)}x <= 1.5x)`);
  ok(g.engineBus.value > idleBus, 'sampled: bus opens with speed/throttle');
  ok(g.loadG.value > g.idleG.value, 'sampled: independent load recording dominates at speed');
  ok(g.idleG.value<.0001,'sampled: held full gas uses one combustion voice, preventing idle/load beating');
  ok(loopSourcesOf(nodes)[3].playbackRate.value<=1.14,'sampled: higher-RPM load recording stays close to its native pitch');

  audio.update({speed:18,throttle:1,active:true});
  const pressed={load:g.loadG.value,idle:g.idleG.value,rate:engine.playbackRate.value,bus:g.engineBus.value,filter:filt.value};
  audio.update({speed:18,throttle:0,active:true});
  ok(g.loadG.value<pressed.load*.2,'lift-off: loaded recording releases at unchanged road speed');
  ok(g.idleG.value>pressed.idle*2,'lift-off: coasting returns to the recorded idle bed');
  ok(engine.playbackRate.value<pressed.rate-.05,'lift-off: pitch follows accelerator release before speed falls');
  ok(g.engineBus.value<pressed.bus-.08&&filt.value<pressed.filter,'lift-off: bus/filter distinguish coast from full gas at the same speed');
  ok(engine.playbackRate.targets.at(-1).tc>engine.playbackRate.targets.at(-2).tc,'lift-off: rev decay is smoother than its attack');
  const coastRate=engine.playbackRate.value,allocationCount=nodes.length;
  for (const speed of [18, -6]) {
    audio.update({speed,throttle:0,active:true});
    const coast={load:g.loadG.value,rate:engine.playbackRate.value,bus:g.engineBus.value};
    audio.update({speed,throttle:-Math.sign(speed),active:true});
    ok(g.loadG.value===coast.load&&engine.playbackRate.value===coast.rate&&g.engineBus.value===coast.bus,
      `opposing pedal: braking at speed ${speed} does not rev the loaded engine`);
    audio.update({speed,throttle:Math.sign(speed),active:true});
    ok(g.loadG.value>coast.load+.12&&engine.playbackRate.value>coast.rate+.05,
      `travel pedal: acceleration at speed ${speed} restores engine load`);
  }
  audio.update({speed:0,throttle:-1,active:true});
  ok(g.loadG.value>.15,'opposing pedal: reverse acceleration from rest still loads the engine');
  audio.update({speed:.2,throttle:-1,active:true});
  ok(g.loadG.value>.15,'opposing pedal: near-rest threshold matches authority engine-force gate');
  audio.update({speed:18,throttle:1,active:true});
  ok(g.loadG.value>pressed.load*.95&&engine.playbackRate.value>coastRate+.05,'accelerator: load/revs return at unchanged road speed');
  for(let i=0;i<120;i++)audio.update({speed:18,throttle:i%3-1,active:true});
  ok(nodes.length===allocationCount&&loopSourcesOf(nodes).length===4,'drive envelopes reuse four decoded loop sources without per-frame nodes');
  audio.update({speed:26,throttle:1,boost:true,active:true});
  ok(engine.playbackRate.value<=1.5&&loopSourcesOf(nodes)[3].playbackRate.value<=1.14&&g.engineBus.value<=.54,'full-speed boosted revs and engine mix remain bounded');

  audio.update({ speed: 8, throttle: 1, boost: 0, active: true });
  const plainFilter = filt.value;
  const plainRate = engine.playbackRate.value;
  audio.update({ speed: 8, throttle: 1, boost: 2, active: true });
  ok(filt.value > plainFilter, 'sampled: boost opens the filter');
  ok(engine.playbackRate.value > plainRate, 'sampled: boost lifts playback rate');
  ctx.currentTime += 2; audio.update({ speed: 8, throttle: 1, boost: 0, active: true });
  const beforeBlip = synthOsc[0].frequency.value;
  audio.update({ speed: 8, throttle: 1, boost: true, active: true });
  const blipped = synthOsc[0].frequency.value;
  ok(blipped > beforeBlip * 1.25, 'synth: a fresh boost blips the revs');
  ctx.currentTime += 1; audio.update({ speed: 8, throttle: 1, boost: true, active: true });
  ok(synthOsc[0].frequency.value < blipped * .85, 'synth: the blip settles while boost is held');

  // Drift/skid: looped bed gain rides slide speed only.
  ok(audio.update({ speed: 8, throttle: 1, drifting: true, active: true }) === true, 'drift: update applies');
  ok(g.driftG.value > 0.1, `drift: skid bed audible (${g.driftG.value.toFixed(2)})`);
  const drift = loopSourcesOf(nodes)[1];
  ok(drift.buffer && drift.playbackRate.value > 0.9, 'drift: loop carries a decoded buffer');
  audio.update({ speed: 8, throttle: 1, drifting: false, active: true });
  ok(g.driftG.value < 0.01, 'drift: silent without slide');
  audio.update({ speed: 0.5, throttle: 0, drifting: true, active: true });
  ok(g.driftG.value < 0.01, 'drift: parked wiggle stays silent');

  // Reverse: low bed + update-driven beeper (t=10 -> beep half-cycle on).
  audio.update({ speed: -6, throttle: -1, active: true });
  ok(g.revG.value > 0.01, `reverse: beeper audible (${g.revG.value.toFixed(3)})`);
  const revRate = engine.playbackRate.value;
  audio.update({ speed: 6, throttle: 1, active: true });
  ok(revRate < engine.playbackRate.value, 'reverse: lower rate than forward');
  ok(g.revG.value < 0.01, 'reverse: beeper off going forward');
  audio.dispose();
});

/* Temporal pedal regression: actual ramp values, rather than targets alone. */
await withGlobals({document:makeEmitter()},async()=>{
  const doc=globalThis.document,{ctx,nodes,stats}=makeFakeAudio(),loader=makeLoader();
  const audio=createKartAudio({createContext:()=>ctx,loader});
  audio.unlock();await audio.ready();const g=graphGains(nodes),engine=loopSourcesOf(nodes)[0],load=loopSourcesOf(nodes)[3];
  const initialNodes=nodes.length,initialLoads=loader.calls.length;
  const frame=(time,throttle,extra={})=>{ctx.currentTime=time;audio.update({speed:18,throttle,active:true,engineActive:true,...extra});};
  frame(20,0);frame(21,1);
  const fullLoad=g.loadG.value;
  ok(g.loadG.sampleAt(21.08)>fullLoad*.95,'temporal: loaded combustion arrives within80ms at unchanged speed');
  // Keep the same target moving at render cadence: scheduling it every frame
  // must not postpone the attack or let an old loaded state survive lift.
  for(let i=1;i<=60;i++)frame(21+i/60,1);
  frame(22.001,0);
  ok(g.loadG.value===0,'temporal: coast contains no prerecorded acceleration at any speed');
  ok(g.loadG.sampleAt(22.121)<fullLoad*.06,'temporal: 120ms lift removes >94% of loaded combustion before speed falls');
  ok(engine.playbackRate.sampleAt(22.121)>engine.playbackRate.value,'temporal: speed-driven coast revs decay after the faster load release');
  frame(22.2,1);
  ok(g.loadG.sampleAt(22.28)>fullLoad*.95,'temporal: pressing again interrupts the release without waiting for a loop restart');
  const highLoadRate=load.playbackRate.value;
  frame(22.5,1,{speed:0});
  ok(load.playbackRate.value<highLoadRate-.25,'temporal: takeoff revs differ materially from full-road-speed revs');
  frame(23,-1,{boost:true});
  const brakeRate=load.playbackRate.value;
  ok(g.loadG.value===0,'temporal: opposing pedal plus stale boost stays unloaded while braking');
  frame(23.2,-1,{speed:-6});
  ok(g.loadG.value>.2&&load.playbackRate.value>brakeRate-.25,'temporal: reverse travel restores recorded engine load');
  frame(23.4,1);const plainRate=load.playbackRate.value;
  frame(23.5,1,{boost:true});
  ok(load.playbackRate.value>plainRate+.07,'temporal: nitro has a distinct but bounded rev lift');
  audio.cue('boost');audio.setMuted(true);
  ok(g.engineBus.sampleAt(23.59)<.002,'temporal lifecycle: mute ramps all engine beds to silence within90ms');
  audio.setMuted(false);frame(23.6,1);
  doc.hidden=true;doc.dispatch('visibilitychange');
  ok(g.engineBus.sampleAt(23.69)<.002,'temporal lifecycle: hidden listener silences without another render frame');
  doc.hidden=false;frame(23.7,1,{engineActive:false});
  ok(g.engineBus.sampleAt(23.79)<.002&&audio.cue('ko'),'temporal lifecycle: KO engine stays silent while nearby cues play');
  frame(23.8,1,{active:false});
  ok(!audio.cue('pulse'),'temporal lifecycle: non-drive phase rejects cues');
  frame(24,0);
  ok(g.loadG.sampleAt(24.2)<.001,'temporal lifecycle: return to live drive uses the current released pedal');
  ok(loader.calls.length===initialLoads&&loopSourcesOf(nodes).length===4&&noiseLoopsOf(nodes).length===1&&stats.bufSrc===7,
    'temporal lifecycle: ramps reuse four loop sources and only two real cues');
  ok(nodes.length===initialNodes+6,'temporal lifecycle: no per-frame allocation across pedal/lifecycle transitions');
  audio.dispose();
  ok(nodes.every(node=>node.disconnects===1)&&stats.closes===1,'temporal lifecycle: all owned nodes disconnect and context closes once');
});

/* ---------- 4. every cue schedules its decoded buffer (never an osc) ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  const { ctx, nodes, stats } = makeFakeAudio();
  const loader = makeLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  audio.unlock();
  ok((await audio.ready()) === true, 'cue: pack ready');
  audio.update({ speed: 6, active: true });
  ok(audio.cue('nope') === false, 'cue: unknown name rejected');
  ok(audio.cue(null) === false && audio.cue(7) === false && audio.cue(undefined) === false,
    'cue: invalid names rejected');
  for (const name of CUE_NAMES.filter(n=>!SYNTH_CUE_NAMES.includes(n))) {
    const from = nodes.length;
    ok(audio.cue(name) === true, `cue: ${name} schedules`);
    const fresh = nodes.slice(from);
    const voices = fresh.filter((n) => n.kind === 'buf');
    const oscs = fresh.filter((n) => n.kind === 'osc');
    ok(oscs.length === (WEAPON_POP[name] ? 1 : 0), `cue: ${name} adds ${WEAPON_POP[name] ? 'one bounded pop' : 'no'} oscillator`);
    if (oscs.length) ok(oscs[0].starts.length === 1 && oscs[0].stops.length === 1, `cue: ${name} pop has a bounded start/stop`);
    ok(voices.length === 1, `cue: ${name} schedules one sample voice`);
    ok(voices[0].buffer && voices[0].buffer.duration > 0, `cue: ${name} carries a decoded buffer`);
    ok(voices[0].loop === false, `cue: ${name} one-shot, not looped`);
    const peak = fresh.filter((n) => n.gain).map((n) => n.gain.max).slice(oscs.length);
    ok(peak.length === 1 && peak[0] >= 0.14 && peak[0] <= 0.4 + 1e-9,
      `cue: ${name} modest peak (${peak[0].toFixed(2)}, audible not clipping)`);
    ok(voices[0].starts.length === 1 && voices[0].stops.length === 1,
      `cue: ${name} voice bounded start/stop`);
  }
  ok(stats.osc === 3 + CUE_NAMES.filter((n) => WEAPON_POP[n]&&!SYNTH_CUE_NAMES.includes(n)).length, 'cue: engine voice plus one pop per weapon cue');
  audio.dispose();
});

/* ---------- 4a. second-eight weapon cues are synthesized and distinct ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  const { ctx, nodes, stats } = makeFakeAudio();
  const loader = makeLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  ok(audio.cue('laser') === false, 'synth: locked audio stays silent');
  audio.unlock();
  ok((await audio.ready()) === true, 'synth: pack ready');
  audio.update({ speed: 6, active: true });
  const fetched = loader.calls.length;
  ok(SYNTH_CUE_NAMES.length === 27 && new Set(SYNTH_CUE_NAMES).size === 27, 'synth: distinct weapon, blast and hit-ding cues');
  for (const weapon of ['laser', 'thunder', 'boomerang', 'oil', 'frost', 'cluster', 'bouncer', 'ram'])
    ok(SYNTH_CUE_NAMES.includes(weapon), `synth: ${weapon} has its own fire cue`);
  ok(['thunderClap', 'oilSkid', 'frostShatter', 'clusterPop', 'boing', 'ramClang'].every((n) => SYNTH_CUE_NAMES.includes(n)), 'synth: clap, skid, shatter, pop, boing and clang cues');
  ok(SYNTH_CUE_NAMES.filter(n=>!['mine','nuke','nukeBlast'].includes(n)).every((n) => !CUE_NAMES.includes(n) && !(n in ASSET_MAP)), 'synth: no sample file backs a synthesized cue');
  ok(JSON.stringify(audio.synthCues()) === JSON.stringify(SYNTH_CUE_NAMES) && audio.cues().length === CUE_NAMES.length, 'synth: separate cue list, sampled list unchanged');
  const signatures = new Map();
  for (const name of SYNTH_CUE_NAMES) {
    const from = nodes.length;
    ok(audio.cue(name, { gain: 1, pan: .3 }) === true, `synth: ${name} schedules`);
    const fresh = nodes.slice(from), sources = fresh.filter((n) => n.kind === 'osc' || n.kind === 'buf');
    ok(fresh.some((n) => n.kind === 'osc'), `synth: ${name} is built from oscillators`);
    ok(sources.every((n) => n.starts.length === 1 && n.stops.length === 1), `synth: ${name} every layer has one bounded start/stop`);
    ok(new Set(sources.map((n) => n.stops[0])).size === 1, `synth: ${name} layers end together (no clipped tails)`);
    ok(sources[0].stops[0] - sources[0].starts[0] <= SYNTH_CUE_SPEC[name][1] + .05 && sources[0].stops[0] - sources[0].starts[0] <= (name==='nukeBlast'?1.9:1.4), `synth: ${name} is short`);
    ok(sources.filter((n) => n.kind === 'buf').every((n) => n.loop === true && n.buffer && !n.buffer.bytes), `synth: ${name} noise is generated, not a decoded file`);
    const amp = fresh.find((n) => n.kind === 'gain');
    ok(amp && amp.gain.max > .1 && amp.gain.max <= .4 + 1e-9, `synth: ${name} modest peak (${amp?.gain.max.toFixed(2)})`);
    ok(fresh.some((n) => n.kind === 'panner'), `synth: ${name} pans with the event`);
    signatures.set(name, JSON.stringify(fresh.map((n) => [n.kind, n.type || '', n.frequency ? Math.round(n.frequency.value) : 0])));
  }
  ok(new Set(signatures.values()).size === SYNTH_CUE_NAMES.length, 'synth: every cue has its own distinct voice');
  ok(loader.calls.length === fetched, 'synth: no extra requests for synthesized cues');
  audio.setMuted(true);
  ok(audio.cue('boing') === false, 'synth: muted refuses');
  audio.setMuted(false);
  ok(audio.cue('ramClang', { gain: 0 }) === false, 'synth: zero gain refuses');
  for (let i = 0; i < 40; i++) audio.cue(SYNTH_CUE_NAMES[i % SYNTH_CUE_NAMES.length]);
  const before = stats.stops;
  audio.dispose();
  ok(stats.stops > before, 'synth: dispose stops live synthesized voices');
  ok(audio.cue('laser') === false, 'synth: disposed refuses');
});

/* ---------- 4b. new weapon/impact voices respect mute + dispose ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  const { ctx, nodes } = makeFakeAudio();
  const loader = makeLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  audio.unlock();
  ok((await audio.ready()) === true, 'weapons: pack ready');
  audio.update({ speed: 6, active: true });
  const addedCues = ['proximity','collision','hurt','hitConfirm','block'];
  for (const cue of addedCues) ok(audio.cue(cue) === true, `weapons: ${cue} schedules`);
  const voices = cueVoicesOf(nodes);
  ok(voices.length === addedCues.length, 'weapons: one voice per new cue');
  ok(voices.every((v) => v.buffer && v.loop === false),
    'weapons: new cues carry one-shot decoded buffers');
  ok(voices.every((v) => v.stops.length === 1), 'weapons: scheduled ends only');
  audio.setMuted(true);
  ok(voices.every((v) => v.stops.length === 2), 'weapons: mute kills new weapon/impact voices');
  ok(addedCues.every((cue) => audio.cue(cue) === false),
    'weapons: new cues refused while muted');
  audio.setMuted(false);
  ok(addedCues.every((cue) => audio.cue(cue) === true),
    'weapons: unmute restores new cues');
  audio.dispose();
  ok(addedCues.every((cue) => audio.cue(cue) === false),
    'weapons: disposed handle refuses new cues');
});

/* ---------- 5. latest drive frame wins once samples are ready ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  const { ctx, nodes } = makeFakeAudio();
  const loader = makeManualLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  audio.unlock();
  ok(loader.calls.length === FILE_COUNT, 'latest: load starts on unlock');
  // Hot frame lands while every sample is still in flight.
  audio.update({ speed: 12, throttle: 1, boost: 2, active: true });
  const g = graphGains(nodes);
  ok(g.engineBus.value > 0.45, 'latest: hot frame ramps the bus pre-decode');
  ok(loopSourcesOf(nodes).length === 0, 'latest: no loop source before decode');
  loader.releaseAll();
  ok((await audio.ready()) === true, 'latest: pack resolves');
  const engine = loopSourcesOf(nodes)[0];
  ok(engine && engine.buffer, 'latest: engine bed starts after decode');
  ok(engine.playbackRate.value > 1.05,
    `latest: hot frame applied at ready (${engine.playbackRate.value.toFixed(2)}x, not idle)`);
  ok(g.engineBus.value > 0.45, 'latest: hot bus level kept at ready');
  audio.dispose();
});

/* ---------- 6. no queued/late transients: dropped cues never fire later ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  const { ctx, nodes } = makeFakeAudio();
  const loader = makeManualLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  audio.unlock();
  audio.update({ speed: 6, active: true });
  ok(audio.cue('ko') === false, 'late: cue dropped while its sample is unavailable');
  ok(audio.cue('pulse') === false, 'late: second cue dropped too (no queue)');
  loader.releaseAll();
  ok((await audio.ready()) === true, 'late: pack resolves');
  await tick();
  ok(cueVoicesOf(nodes).length === 0, 'late: nothing fired out of context after load');
  ok(audio.cue('ko') === true, 'late: next real event plays once available');
  ok(cueVoicesOf(nodes).length === 1, 'late: exactly the new event scheduled');
  audio.dispose();
});

/* ---------- 7. mute / inactive / hidden / KO silence; watchers keep cues ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  const doc = globalThis.document;
  const { ctx, nodes } = makeFakeAudio();
  const loader = makeLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  audio.unlock();
  await audio.ready();
  audio.update({ speed: 10, throttle: 1, drifting: true, active: true, engineActive: true });
  const g = graphGains(nodes);
  ok(g.engineBus.value > 0.2 && g.driftG.value > 0.1, 'silence: engine+drift hot before mute');

  audio.cue('ko');
  const koVoice = cueVoicesOf(nodes).at(-1);
  ok(koVoice.stops.length === 1, 'silence: KO in flight (scheduled end only)');

  audio.setMuted(true);
  ok(audio.isMuted() === true, 'silence: mute latches');
  ok(g.engineBus.value < 0.01 && g.driftG.value < 0.01 && g.revG.value < 0.01,
    'silence: mute kills continuous beds immediately');
  ok(koVoice.stops.length === 2, 'silence: mute kills the active cue voice');
  ok(audio.cue('pulse') === false, 'silence: cue refused while muted');
  audio.setMuted(false);
  ok(audio.cue('pulse') === true, 'silence: unmute restores cues');

  // Non-drive phase: root passes active=false.
  audio.update({ speed: 10, throttle: 1, active: false });
  ok(g.engineBus.value < 0.01, 'silence: inactive update silences beds');
  ok(audio.cue('pickup') === false, 'silence: cue refused while inactive');
  audio.update({ speed: 10, throttle: 1, active: true });
  ok(g.engineBus.value > 0.2, 'silence: next drive frame restores beds');
  ok(audio.cue('pickup') === true, 'silence: active restores cues');

  // KO/respawn: engineActive=false quiets beds but nearby watcher cues play.
  audio.update({ speed: 10, throttle: 1, active: true, engineActive: false });
  ok(g.engineBus.value < 0.01 && g.driftG.value < 0.01, 'silence: KO quiets continuous beds');
  ok(audio.cue('mine') === true, 'silence: watcher cue allowed while engine off');
  audio.update({ speed: 10, throttle: 1, active: true, engineActive: true });
  ok(g.engineBus.value > 0.2, 'silence: respawn frame restores beds');

  // Hidden tab: the visibility listener fires even though rAF is stalled.
  audio.cue('scatter');
  const flying = cueVoicesOf(nodes).at(-1);
  doc.hidden = true;
  doc.dispatch('visibilitychange', {});
  ok(g.engineBus.value < 0.01 && g.driftG.value < 0.01, 'silence: hidden kills continuous beds');
  ok(flying.stops.length === 2, 'silence: hidden kills the active cue voice');
  ok(audio.cue('shield') === false, 'silence: cue refused while hidden');
  doc.hidden = false;
  audio.update({ speed: 10, active: true });
  ok(g.engineBus.value > 0.2 && audio.cue('shield') === true, 'silence: visible frame restores audio');
  audio.dispose();
});

/* ---------- 8. muted/hidden/disposed loads cannot start or unmute ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  const doc = globalThis.document;
  // Muted before decode: beds decode but never start; unmute needs a frame.
  {
    const { ctx, nodes } = makeFakeAudio();
    const loader = makeManualLoader();
    const audio = createKartAudio({ createContext: () => ctx, loader });
    audio.unlock();
    audio.setMuted(true);
    loader.releaseAll();
    ok((await audio.ready()) === true, 'defer: muted pack still decodes');
    await tick();
    ok(loopSourcesOf(nodes).length === 0, 'defer: muted decode starts zero beds');
    audio.setMuted(false);
    audio.update({ speed: 9, active: true });
    ok(loopSourcesOf(nodes).length === 4, 'defer: next audible frame starts the beds');
    audio.dispose();
  }
  // Hidden before decode: same deferral.
  {
    const { ctx, nodes } = makeFakeAudio();
    const loader = makeManualLoader();
    const audio = createKartAudio({ createContext: () => ctx, loader });
    audio.unlock();
    doc.hidden = true;
    loader.releaseAll();
    ok((await audio.ready()) === true, 'defer: hidden pack still decodes');
    await tick();
    ok(loopSourcesOf(nodes).length === 0, 'defer: hidden decode starts zero beds');
    doc.hidden = false;
    audio.update({ speed: 9, active: true });
    ok(loopSourcesOf(nodes).length === 4, 'defer: visible frame starts the beds');
    audio.dispose();
  }
});

/* ---------- 9. rejected resume stays recoverable ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  const { ctx, stats } = makeFakeAudio({ resume: 'reject' });
  const loader = makeLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  ok(audio.unlock() === true, 'resume: unlock survives rejection (graph exists)');
  ok(ctx.state === 'suspended' && stats.resumes === 1, 'resume: rejection caught, still suspended');
  ctx.setResumeMode('ok');
  ok(audio.unlock() === true, 'resume: retry unlock works');
  ok(ctx.state === 'running' && stats.resumes === 2, 'resume: retry flips to running');

  // Real suspended contexts freeze currentTime. Only wall time advances.
  const NativeDate = globalThis.Date;
  let wall = NativeDate.now();
  class WallClock extends NativeDate { static now() { return wall; } }
  await withGlobals({ Date: WallClock }, async () => {
    ctx.state = 'suspended';
    ctx.setResumeMode('reject');
    wall += 600;
    const resBefore = stats.resumes, frozenTime = ctx.currentTime;
    audio.update({ speed: 8, active: true });
    ok(stats.resumes === resBefore + 1, 'resume: wall time retries a frozen audio clock');
    audio.update({ speed: 8, active: true });
    ok(stats.resumes === resBefore + 1, 'resume: rejection does not flood retry within window');
    wall += 501;
    ctx.setResumeMode('ok');
    audio.update({ speed: 8, active: true });
    ok(stats.resumes === resBefore + 2 && ctx.state === 'running', 'resume: later frame recovers without another gesture');
    ok(ctx.currentTime === frozenTime, 'resume: test never advances suspended audio clock');
  });
  await audio.ready();
  audio.dispose();
});

/* ---------- 10. bounded voices + onended cleanup ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  const { ctx, nodes, stats } = makeFakeAudio();
  const loader = makeLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  audio.unlock();
  await audio.ready();
  audio.update({ speed: 8, active: true });

  for (let i = 0; i < 20; i++) audio.cue('scatter'); // 1 voice each
  const voices = cueVoicesOf(nodes);
  ok(voices.length === 20, `voices: 20 transient voices created (got ${voices.length})`);
  const stolen = voices.filter((v) => v.stops.length === 2).length;
  ok(voices.length - stolen === 16, `voices: live bounded to 16 (${stolen} oldest stolen)`);
  ok(stats.disconnects > 0, 'voices: stolen voices disconnected');
  const stolenVoice = voices.find((v) => v.stops.length === 2);
  ok(stolenVoice.disconnects === 1, 'voices: stolen source disconnects exactly once');
  const stolenDisconnects = stats.disconnects;
  stolenVoice.onended(); stolenVoice.onended();
  ok(stats.disconnects === stolenDisconnects, 'voices: ended after steal cannot repeat cleanup');

  // Natural end: onended disconnects every node of the voice exactly once.
  const live = voices.find((v) => v.stops.length === 1);
  const discBefore = stats.disconnects;
  live.onended();
  live.onended();
  ok(stats.disconnects > discBefore, 'voices: onended disconnects nodes');
  audio.cue('pulse'); // still usable after cleanup
  audio.dispose();
});

/* ---------- 11. failure is quiet; no fetch storm; retries bounded ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  // Total outage: unlock holds, updates stay silent, cues drop, no storm.
  const { ctx, nodes, stats } = makeFakeAudio();
  const loader = makeLoader();
  loader.setImpl(() => Promise.reject(new Error('offline')));
  const audio = createKartAudio({ createContext: () => ctx, loader });
  ok(audio.unlock() === true, 'fail: unlock survives outage (graph exists)');
  ok((await audio.ready()) === false, 'fail: ready reports the outage');
  ok(audio.status().failed.length === FILE_COUNT, 'fail: every sample marked failed');
  ok(audio.update({ speed: 10, active: true }) === true, 'fail: update runs silent');
  ok(loopSourcesOf(nodes).length === 0 && stats.starts === stats.osc + noiseLoopsOf(nodes).length,
    'fail: no sample beds start; only the synthesized engine voice (oscillators + noise texture) runs');
  ok(stats.osc === 3, 'fail: an outage adds no oscillators beyond the engine voice');
  ok(audio.cue('ko') === false, 'fail: cue drops quietly');
  const callsAfterFail = loader.calls.length;
  for (let i = 0; i < 60; i++) {
    audio.update({ speed: 10, active: true });
    audio.cue('pulse');
  }
  ok(loader.calls.length === callsAfterFail, 'fail: 60 frames + cues refetch nothing (cooldown-gated)');
  audio.dispose();
});

await withGlobals({ document: makeEmitter() }, async () => {
  // Retry budget: failures retry on real events only, at most 3 passes.
  const realDate = globalThis.Date;
  let nowMs = 1_000_000;
  class FakeDate extends realDate {
    static now() { return nowMs; }
  }
  globalThis.Date = FakeDate;
  try {
    const { ctx } = makeFakeAudio();
    const loader = makeLoader();
    loader.setImpl(() => Promise.reject(new Error('offline')));
    const audio = createKartAudio({ createContext: () => ctx, loader });
    audio.unlock(); // pass 1
    await audio.ready();
    ok(loader.calls.length === FILE_COUNT, 'retry: first pass requests each sample once');
    audio.cue('pulse'); // same ms: cooldown blocks the retry
    await tick();
    ok(loader.calls.length === FILE_COUNT, 'retry: immediate event does not refetch (cooldown)');
    nowMs += 3000;
    audio.cue('pulse'); // pass 2
    await audio.ready();
    ok(loader.calls.length === FILE_COUNT * 2, 'retry: next real event retries after cooldown');
    // Recovery mid-outage: a fixed loader heals on the next event.
    loader.setImpl(() => Promise.resolve(new Uint8Array([5]).buffer));
    nowMs += 3000;
    audio.cue('pulse'); // pass 3
    ok((await audio.ready()) === true, 'retry: healed loader completes the pack');
    ok(audio.cue('pulse') === true, 'retry: recovered cue schedules');
    ok(loader.calls.length === FILE_COUNT * 3, 'retry: exactly 3 bounded passes total');
    audio.dispose();
  } finally {
    globalThis.Date = realDate;
  }
});

await withGlobals({ document: makeEmitter() }, async () => {
  // Partial pack: one failed file blocks only its own cue.
  const { ctx } = makeFakeAudio();
  const loader = makeManualLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  audio.unlock();
  loader.releaseAll(['ko.wav']);
  await tick(20);
  const st = audio.status();
  ok(st.ready === false && st.failed.length === 1, 'partial: only ko failed');
  ok(audio.cue('ko') === false, 'partial: failed cue drops');
  for (const name of CUE_NAMES.filter((n) => n !== 'ko')) {
    ok(audio.cue(name) === true, `partial: ${name} still plays`);
  }
  audio.dispose();
});

/* ---------- 12. Safari callback decode backend ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  const { ctx, nodes, stats } = makeFakeAudio({ decode: 'callback' });
  const loader = makeLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  audio.unlock();
  ok((await audio.ready()) === true, 'safari: callback decode completes the pack');
  ok(stats.decodes === FILE_COUNT, 'safari: each ArrayBuffer decoded exactly once');
  ok(loopSourcesOf(nodes).length === 4, 'safari: beds start on callback buffers');
  for (const name of CUE_NAMES) ok(audio.cue(name) === true, `safari: ${name} schedules`);
  audio.dispose();
});

/* ---------- 13. disposal: abort, inertness, listeners, backend ---------- */

await withGlobals({ document: makeEmitter(), window: makeEmitter() }, async () => {
  const doc = globalThis.document;
  const win = globalThis.window;
  const { ctx, nodes, stats } = makeFakeAudio();
  const loader = makeLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader, autoUnlock: true });
  ok(doc.total() === 1 && win.total() === 2, 'dispose: visibility + gesture listeners attached');
  audio.unlock();
  await audio.ready();
  audio.update({ speed: 8, drifting: true, active: true });
  const loopsBefore = loopSourcesOf(nodes).length;
  ok(loopsBefore === 4, 'dispose: 4 beds running pre-dispose');
  audio.cue('ko'); // 1 more transient voice in flight

  audio.dispose();
  ok(audio.disposed() === true, 'dispose: flag set');
  ok(doc.total() === 0 && win.total() === 0, 'dispose: every listener removed');
  ok(stats.closes === 1, 'dispose: backend closed once');
  const stoppedNow = bufSourcesOf(nodes).filter((v) => v.stops.length >= 1).length;
  ok(stoppedNow === loopsBefore + 1 + noiseLoopsOf(nodes).length, 'dispose: beds, the engine noise loop and cue sources stopped');
  ok(nodes.every((n) => n.disconnects >= 1), 'dispose: every node disconnected');
  audio.dispose();
  ok(stats.closes === 1, 'dispose: idempotent');
  ok(audio.unlock() === false && audio.update({ speed: 8 }) === false &&
    audio.cue('ko') === false, 'dispose: handle inert afterwards');
  ok(audio.available() === false, 'dispose: unavailable afterwards');
  ok((await audio.ready()) === false, 'dispose: ready stays false');
});

await withGlobals({ document: makeEmitter() }, async () => {
  // Unresolved loads at dispose: aborted and inert, never resurrected.
  const { ctx, nodes, stats } = makeFakeAudio();
  const loader = makeManualLoader();
  const audio = createKartAudio({ createContext: () => ctx, loader });
  audio.unlock();
  ok(loader.calls.length === FILE_COUNT, 'abort: loads in flight pre-dispose');
  let readiness = 'pending';
  const waitForReady = audio.ready().then(value => { readiness = value; });
  audio.dispose();
  await tick();
  ok(readiness === false, 'abort: already-waiting readiness settles false even when loader ignores abort');
  await waitForReady;
  ok(loader.calls.every((c) => !c.signal || c.signal.aborted === true),
    'abort: every pending request aborted');
  loader.releaseAll(); // late arrivals must be inert
  await tick(20);
  ok((await audio.ready()) === false, 'abort: ready stays false after dispose');
  ok(loopSourcesOf(nodes).length === 0, 'abort: late decodes start zero beds');
  ok(cueVoicesOf(nodes).length === 0, 'abort: late decodes schedule zero cues');
  ok(stats.starts === stats.osc + noiseLoopsOf(nodes).length && bufSourcesOf(nodes).every((n) => n.starts.length === 0 || noiseLoopsOf(nodes).includes(n)), 'abort: no sample source ever started (only the engine voice and its noise texture)');
  ok(audio.cue('ko') === false, 'abort: cue stays inert');
});

/* ---------- 14. degraded backends + preferences ---------- */

await withGlobals({ document: makeEmitter() }, async () => {
  // No AudioContext at all: honest no-op, never throws.
  const dead = createKartAudio({ createContext: () => null, loader: makeLoader() });
  ok(dead.unlock() === false && dead.update({ speed: 5 }) === false &&
    dead.cue('ko') === false, 'degraded: null backend safe');
  ok(dead.available() === false, 'degraded: unavailable without backend');
  dead.dispose();

  // No buffer sources / no compressor: safe silence, never throws.
  const thin = makeFakeAudio({ noBufSrc: true, noComp: true });
  const audio = createKartAudio({ createContext: () => thin.ctx, loader: makeLoader() });
  ok(audio.unlock() === true, 'degraded: unlock without buffers/compressor');
  ok((await audio.ready()) === true, 'degraded: samples still decode');
  ok(audio.update({ speed: 9, drifting: true, active: true }) === true, 'degraded: update runs silent');
  ok(audio.cue('ko') === false, 'degraded: cue refuses without buffer sources');
  ok(thin.stats.osc <= 3, 'degraded: no oscillators beyond the engine voice');
  audio.dispose();

  // Sound preference from the root (api.context().sound / pb_sound).
  const mk = async (opts) => {
    const fake = makeFakeAudio();
    const a = createKartAudio({ ...opts, createContext: () => fake.ctx, loader: makeLoader() });
    a.unlock();
    await a.ready();
    return a;
  };
  const muted = await mk({ muted: true });
  ok(muted.isMuted() === true && muted.cue('ko') === false, 'prefs: muted opt-in silences');
  muted.dispose();
  const off = await mk({ sound: false });
  ok(off.isMuted() === true && off.cue('ko') === false, 'prefs: sound=false maps to muted');
  off.dispose();
  const on = await mk({ sound: true });
  ok(on.isMuted() === false && on.cue('ko') === true, 'prefs: sound=true sounds');
  on.dispose();
});

console.log(`KART_AUDIO_PASS: ${passed} assertions (sampled engine/beds/cues/mute/hidden/KO/retry/safari/dispose)`);
