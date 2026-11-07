/* Pocket Karts audio: synthesized kart engine over a recorded bed, plus
 * sampled arcade cues with synthesized weapon pops (WebAudio).
 *
 * Local pack under ../../assets/karts/audio/ as WAV PCM16 mono 44100 Hz:
 * separate petrol idle/load, drift and quiet reverse beds,17 one-shot samples
 * and 20 cue names (several weapons and hit cues reuse shipped samples).
 * Honest description: engine/drift/pulse/scatter/grenade are edited
 * real-world recordings (6.5HP petrol kart idle/load, tire squeal, firearms);
 * rocket and the Kenney UI/power/impact cues are pre-produced sound effects.
 * Provenance: manifest.json + LICENSE-*.txt + CREDITS.txt.
 *
 * Mount (root owns gestures + lifecycle):
 *   const audio = createKartAudio({ muted: !api.context().sound });
 *   - call audio.unlock() inside real key/pointer handlers (gesture).
 *   - call audio.update({ speed, throttle, drifting, boost, active,
 *     engineActive }) every render frame from the local pose; active=false
 *     outside the live arena (phase !== 'drive', hidden/disposed view);
 *     engineActive=false silences continuous beds for watchers or KO/respawn
 *     while nearby authoritative cue() events still play.
 *   - call audio.cue(name,{strength,gain,pan}) for authoritative nearby events;
 *     gain defaults to1 (clamped0..1), pan to0 (clamped-1..1), strength to1.
 *   - call audio.setMuted(!api.context().sound) when the sound toggle flips.
 *   - call audio.dispose() when the view disposes.
 *
 * Lifecycle guarantees:
 * - Lazy: zero AudioContext/nodes/requests before unlock(). Loading starts
 *   on unlock() (gesture) or an explicit prep(); decode readiness is async.
 * - A rejected resume() never latches; update()/cue() retry throttled.
 * - setMuted(true), update({active:false}), or a hidden tab immediately
 *   silences the continuous beds AND in-flight cue voices;
 *   engineActive=false silences the beds while nearby cues remain available.
 *   cue() refuses while muted/inactive/hidden. Loop sources that decode
 *   while muted/hidden/inactive/disposed never start and never unmute;
 *   the next audible frame starts them with the latest latched drive frame.
 * - cue() while a buffer is unavailable drops (returns false) and queues
 *   nothing; a later real event may retry. No stale transient fires late.
 * - update() only moves ramps on the persistent graph — never allocates
 *   nodes per frame and never fetches per frame (loads are bounded: one
 *   attempt per file plus bounded gesture/event retries, cooldown-gated).
 * - The engine voice (three oscillators) is synthesized and needs no files;
 *   failed sample loads add no other sound (no fallback buzz); partial
 *   packs keep every decoded cue playable.
 * - Transient voices are bounded (oldest stolen past the cap), disconnected
 *   onended, and killed on silence/dispose. decodeAudioData works with both
 *   promise and Safari callback backends.
 * - dispose() aborts pending loads, removes listeners, stops every source,
 *   closes the context, and leaves the handle inert. Volume-safe: modest
 *   master + gentle limiter-style compressor when the backend provides one.
 *
 * No imports, no globals at module scope. Never throws for audio failures:
 * a missing backend just makes unlock()/cue()/update() return false.
 */

/* Cue names the frame may feed (authoritative, deduped, nearby only). */
/* Arena feature cues: [fromHz, toHz, seconds, level, wave, delay] sweeps. */
export const ARENA_CUES = Object.freeze({
  launch: [[150, 38, .42, .3, 'sine', 0], [80, 42, .22, .12, 'square', 0], [1100, 180, .95, .07, 'triangle', .05]],
  land: [[130, 44, .26, .26, 'sine', 0], [320, 90, .12, .09, 'triangle', 0]],
  warp: [[260, 1400, .34, .13, 'sine', 0], [520, 2100, .28, .06, 'triangle', .05], [1500, 700, .24, .06, 'sine', .3]],
  fell: [[1300, 160, .5, .11, 'triangle', 0], [520, 90, .45, .18, 'sine', .02], [90, 48, .22, .07, 'square', .05]],
});

export const CUE_NAMES = ['pulse', 'scatter', 'mine', 'shield', 'pickup', 'ko', 'respawn', 'boost', 'rocket', 'seeker', 'proximity', 'nuke', 'rocketBlast', 'bombBlast', 'nukeBlast', 'collision', 'landing', 'hurt', 'hitConfirm', 'block'];

/* Shipped cue file per name (WAV PCM16 mono 44100, under ASSET_BASE). */
export const ASSET_MAP = {
  pulse: 'pulse.wav',
  scatter: 'scatter.wav',
  mine: 'mine.wav',
  shield: 'shield.wav',
  pickup: 'pickup.wav',
  ko: 'ko.wav',
  respawn: 'respawn.wav',
  boost: 'boost.wav',
  rocket: 'rocket.wav',
  // Guided missiles share the launch recording; the proximity charge and
  // the Nuke share the restrained canister throw. Detonations have their
  // own cue files.
  seeker: 'rocket.wav',
  proximity: 'grenade.wav',
  nuke: 'grenade.wav',
  rocketBlast: 'rocketBlast.wav',
  bombBlast: 'bombBlast.wav',
  nukeBlast: 'grenadeBlast.wav',
  collision: 'collision.wav',
  landing: 'landing.wav',
  // Taking a hit is a metal impact; landing one is a short bell; a Shield
  // soaking a hit replays the force-field cue.
  hurt: 'collision.wav',
  hitConfirm: 'pickup.wav',
  block: 'shield.wav',
};

/* Continuous-bed loop files (same folder). */
export const LOOP_MAP = {
  engine: 'engine.wav',
  drift: 'drift.wav',
  reverse: 'reverse.wav',
  engineLoad: 'engine-load.wav',
};
export const COLLISION_VARIANTS={soft:'collision-soft.wav',metal:'collision.wav'};

/* Pack version, appended as a query for cache-busting local fetches. */
export const PACK_VERSION = 5;

/* Relative asset base from this module to the deployed audio folder. */
export const ASSET_BASE = '../../assets/karts/audio/';

/* World units/sec at full song; kart-pose top speeds sit near this. */
const MAX_SPEED = 26;
/* Concurrent transient voices; past this the oldest is stolen. */
const MAX_LIVE_VOICES = 16;
/* Seconds between opportunistic resume() retries from update()/cue(). */
const RESUME_RETRY_MS = 500;
/* Bounded load retries after rejection: passes + cooldown between them. */
const MAX_LOAD_PASSES = 3;
const LOAD_RETRY_COOLDOWN_MS = 2000;
/* Idle's combustion is ~11.5 Hz; the load recording is ~19 Hz.
 * Tune each recording to its own native RPM instead of pitching both alike. */
// Synth engine: firing frequency at idle and at full road speed (Hz).
export const ENGINE_IDLE_HZ = 62;
export const ENGINE_TOP_HZ = 238;
const ENG_RATE_IDLE = 0.9;
const ENG_RATE_TOP = 1.5;
const FLOOR = 0.0001;

/* Modest per-cue voice peaks (master 0.8 + compressor keep headroom). */
const CUE_GAIN = {
  pulse: 0.32, scatter: 0.3, mine: 0.34, shield: 0.3, pickup: 0.3,
  ko: 0.38, respawn: 0.3, boost: 0.34, rocket: 0.34, seeker: .34,
  proximity: .32, nuke: .32, rocketBlast: .30, bombBlast: .32, nukeBlast: .4,
  collision: 0.25, landing: .18, hurt: .36, hitConfirm: .26, block: .3,
};

// Weapon pop: [start Hz, end Hz, seconds] layered on each weapon cue.
export const WEAPON_POP = Object.freeze({
  pulse: [1500, 420, .045], scatter: [900, 160, .07], mine: [420, 90, .09], rocket: [520, 70, .12],
  seeker: [760, 200, .1], proximity: [380, 110, .09], nuke: [300, 40, .2],
});

const ALL_FILES = [...new Set([...Object.values(LOOP_MAP), ...CUE_NAMES.map((n) => ASSET_MAP[n]),...Object.values(COLLISION_VARIANTS)])];

function defaultFactory() {
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    return typeof AC === 'function' ? new AC() : null;
  } catch {
    return null;
  }
}

/* Default local asset loader: same-folder fetch only, abortable. */
function defaultLoader(url, signal) {
  try {
    const f = globalThis.fetch;
    if (typeof f !== 'function') return Promise.reject(new Error('no fetch'));
    const p = signal ? f(url, { signal }) : f(url);
    return Promise.resolve(p).then((res) => {
      if (!res || res.ok === false) throw new Error('asset HTTP ' + (res && res.status));
      return res.arrayBuffer();
    });
  } catch (e) {
    return Promise.reject(e instanceof Error ? e : new Error('load failed'));
  }
}

function resolveAssetURL(file) {
  const rel = ASSET_BASE + file + '?v=' + PACK_VERSION;
  try {
    const meta = import.meta.url;
    if (typeof meta === 'string' && meta) return new URL(rel, meta).toString();
  } catch { /* fall through to the relative path */ }
  return rel;
}

/* Promise decodeAudioData with Safari callback-backend fallback. */
function decodeBuffer(c, bytes) {
  return new Promise((resolve, reject) => {
    if (!c || typeof c.decodeAudioData !== 'function') {
      reject(new Error('no decoder'));
      return;
    }
    let settled = false;
    const ok = (buf) => {
      if (settled) return;
      settled = true;
      if (buf) resolve(buf);
      else reject(new Error('decode empty'));
    };
    const fail = (e) => {
      if (settled) return;
      settled = true;
      reject(e instanceof Error ? e : new Error('decode failed'));
    };
    let out;
    try {
      // One call supports callback-only Safari and promise backends. Calling
      // twice can reuse a detached ArrayBuffer on legacy implementations.
      out = c.decodeAudioData(bytes, ok, fail);
    } catch (e) {
      fail(e);
      return;
    }
    if (out && typeof out.then === 'function') {
      try {
        out.then(ok, fail);
      } catch (e) {
        fail(e);
      }
      return;
    }
    if (out !== undefined) {
      ok(out); /* sync-decoding stub backend */
      return;
    }
    // Undefined return means the callback will settle the decode.
  });
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function num(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

/* Ramp helpers tolerate partial backends (old browsers, thin stubs). */
function ramp(param, value, t, tc) {
  try {
    if (!param) return;
    if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(value, t, tc);
    else param.value = value;
  } catch { /* keep the rest of the frame audible */ }
}

function at(param, value, t) {
  try {
    if (!param) return;
    if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, t);
    else param.value = value;
  } catch { /* noop */ }
}

function connect(from, to) {
  try {
    if (from && to && typeof from.connect === 'function') from.connect(to);
  } catch { /* noop */ }
}

function startSrc(src, t) {
  try {
    if (!src || typeof src.start !== 'function') return;
    if (t === undefined) src.start();
    else {
      try { src.start(t); } catch { src.start(); }
    }
  } catch { /* noop */ }
}

function stopSrc(src, t) {
  try {
    if (!src || typeof src.stop !== 'function') return;
    if (t === undefined) src.stop();
    else {
      try { src.stop(t); } catch { src.stop(); }
    }
  } catch { /* noop */ }
}

function disconnect(node) {
  try {
    if (node && typeof node.disconnect === 'function') node.disconnect();
  } catch { /* noop */ }
}

export function createKartAudio(opts) {
  opts = opts || {};
  const factory = typeof opts.createContext === 'function' ? opts.createContext : defaultFactory;
  const loader = typeof opts.loader === 'function' ? opts.loader : defaultLoader;

  let ctx = null;
  let graph = null; // persistent nodes; null until unlock() builds them
  let muted = opts.muted === true || opts.sound === false;
  let unlocked = false;
  let disposed = false;
  let active = true; // latched from update(); false = non-drive/hidden
  let engineActive = true; // latched from update(); false = KO/respawn
  let lastResumeAttemptMs = -Infinity;
  let lastFrame = { speed: 0, throttle: 0, drifting: false, boost: false };
  let boostWas = false, blipAt = -Infinity, nextBeepAt = 0;
  let shiftAt = -Infinity, shiftDir = 0; // last automatic gear change
  const live = new Set(); // transient cue voices (bounded, see MAX_LIVE_VOICES)
  const lastCollision={at:-Infinity};
  const tracked = []; // event listeners, removed on dispose
  const readyWaiters = new Set(); // readiness settles false on disposal too

  /* Sample store: file -> AudioBuffer once decoded; failures stay absent. */
  const buffers = new Map();
  /* file -> 'unstarted' | 'loading' | 'ready' | 'failed'. */
  const fileState = new Map(ALL_FILES.map((f) => [f, 'unstarted']));
  const inflight = new Map(); // file -> settle promise (abortable via ctrls)
  const ctrls = new Map(); // file -> AbortController, when available
  let loadPasses = 0;
  let lastPassStartMs = 0;
  let generation = 0; // async completions from older generations are inert
  const loops = { engine: null, drift: null, reverse: null, engineLoad:null }; // started loop sources

  const now = () => {
    try {
      return typeof ctx.currentTime === 'number' ? ctx.currentTime : 0;
    } catch {
      return 0;
    }
  };

  const docHidden = () => {
    try {
      const d = globalThis.document;
      return !!(d && d.hidden === true);
    } catch {
      return false;
    }
  };

  const audible = () => !disposed && !!ctx && !!graph && !muted && active && engineActive && !docHidden();

  /* ---------------- persistent graph (built once on unlock) ---------------- */
  /* Gain order: master, engineBus, cueBus, idleG, driftG, revG, loadG. */

  const buildGraph = (c) => {
    const master = c.createGain();
    master.gain.value = 0.8;
    let head = master;
    try {
      if (typeof c.createDynamicsCompressor === 'function') {
        const comp = c.createDynamicsCompressor();
        if (comp.threshold) comp.threshold.value = -18;
        if (comp.ratio) comp.ratio.value = 4;
        if (comp.attack) comp.attack.value = 0.004;
        if (comp.release) comp.release.value = 0.18;
        connect(master, comp);
        head = comp;
      }
    } catch { /* master-only path still sounds */ }
    connect(head, c.destination);

    const engineBus = c.createGain();
    engineBus.gain.value = FLOOR;
    connect(engineBus, master);

    const cueBus = c.createGain();
    cueBus.gain.value = 1;
    connect(cueBus, master);

    // Sampled engine: looped bed through a speed-driven lowpass. The loop
    // source is attached once its buffer decodes (see startPendingLoops).
    const engFilter = c.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 1200;
    if (engFilter.Q) engFilter.Q.value = 1;
    const engG = c.createGain();
    engG.gain.value = 0.5;
    connect(engFilter, engG);
    connect(engG, engineBus);

    // Drift/skid: looped noise-ish bed through a highpass; gain rides updates.
    const driftF = c.createBiquadFilter();
    driftF.type = 'highpass';
    driftF.frequency.value = 1800;
    const driftG = c.createGain();
    driftG.gain.value = FLOOR;
    connect(driftF, driftG);
    connect(driftG, master);

    // Reverse reminder: a very quiet tonal loop gated into two pulses/sec.
    const revG = c.createGain();
    revG.gain.value = FLOOR;
    connect(revG, engineBus);

    // A steady recorded load section, without the source's repeated rev/lift
    // cycle. Throttle controls the load; road speed controls its rev range.
    const loadFilter=c.createBiquadFilter();loadFilter.type='lowpass';loadFilter.frequency.value=3400;
    if(loadFilter.Q)loadFilter.Q.value=.45;
    const loadG=c.createGain();loadG.gain.value=FLOOR;
    connect(loadFilter,loadG);connect(loadG,engineBus);

    // Synthesized kart engine: a high, buzzy single-cylinder voice (saw +
    // detuned square an octave up + a quiet sub) through a resonant lowpass.
    // Pitch and brightness follow speed and throttle in applyDrive; the
    // recorded bed underneath keeps some real combustion texture.
    let synth = null;
    try {
      if (typeof c.createOscillator === 'function') {
        const synthF = c.createBiquadFilter();synthF.type = 'lowpass';synthF.frequency.value = 900;if (synthF.Q) synthF.Q.value = 4.5;
        const synthG = c.createGain();synthG.gain.value = FLOOR;
        connect(synthF, synthG);connect(synthG, engineBus);
        const voices = [['sawtooth', 1, .55], ['square', 2.012, .22], ['sawtooth', .5, .18]].map(([type, ratio, level]) => {
          const osc = c.createOscillator();osc.type = type;osc.frequency.value = ENGINE_IDLE_HZ * ratio;
          const g = c.createGain();g.gain.value = level;connect(osc, g);connect(g, synthF);
          try { osc.start(); } catch { /* inert backend */ }
          return { osc, g, ratio };
        });
        synth = { synthF, synthG, voices };
      }
    } catch { synth = null; }

    // Procedural texture from one generated noise loop (no files): exhaust
    // rasp gated at the firing rate by the engine saw, tyre roar and wind
    // that grow with road speed, and a crackle burst for gear shifts.
    let texture = null;
    try {
      if (synth && typeof c.createBuffer === 'function' && typeof c.createBufferSource === 'function') {
        const rate = c.sampleRate || 44100, buf = c.createBuffer(1, Math.round(rate * 1.5), rate), data = buf.getChannelData(0);
        let seed = 0x2f6b1d;
        for (let i = 0; i < data.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; data[i] = seed / 2147483648 - 1; }
        const noise = c.createBufferSource();noise.buffer = buf;noise.loop = true;
        const band = (type, hz, q) => { const f = c.createBiquadFilter();f.type = type;f.frequency.value = hz;if (f.Q) f.Q.value = q;connect(noise, f);return f; };
        const level = (from, to, v = FLOOR) => { const g = c.createGain();g.gain.value = v;connect(from, g);connect(g, to);return g; };
        const raspF = band('bandpass', 400, 1.4), raspAM = level(raspF, null, .5), raspG = level(raspAM, engineBus);
        // The saw swings -1..1, so the rasp opens once per combustion cycle.
        const raspMod = c.createGain();raspMod.gain.value = .5;connect(synth.voices[0].osc, raspMod);connect(raspMod, raspAM.gain);
        const roadF = band('lowpass', 220, .7), roadG = level(roadF, engineBus);
        const windF = band('highpass', 2400, .5), windG = level(windF, engineBus);
        const crackF = band('bandpass', 1500, .9), crackG = level(crackF, engineBus);
        startSrc(noise);
        texture = { noise, raspF, raspAM, raspMod, raspG, roadF, roadG, windF, windG, crackF, crackG };
      }
    } catch { texture = null; }

    return {
      master, comp: head === master ? null : head, engineBus, cueBus,
      engFilter, engG, driftF, driftG, revG, loadFilter, loadG, synth, texture,
    };
  };

  /* ---------------- transient voices (bounded, self-cleaning) ---------------- */

  const killVoice = (voice, t) => {
    if (voice.dead) return;
    live.delete(voice); // delete first: stub onended may fire synchronously
    try {
      if (voice.gain) {
        at(voice.gain, Math.max(FLOOR, 0.0001), t);
      }
    } catch { /* noop */ }
    for (const s of voice.sources) stopSrc(s, t === undefined ? undefined : t + 0.03);
    voice.cleanup();
  };

  const silenceCues = () => {
    lastCollision.at=-Infinity;
    if (live.size === 0) return;
    const t = ctx ? now() : 0;
    for (const voice of [...live]) killVoice(voice, t);
  };

  const stealIfFull = (need) => {
    while (live.size + need > MAX_LIVE_VOICES && live.size > 0) {
      const oldest = live.values().next().value;
      killVoice(oldest, ctx ? now() : 0);
    }
  };

  /* Register a voice; onended disconnects every node exactly once. */
  const track = (sources, nodes, gain) => {
    const voice = { sources, nodes, gain, dead: false };
    const cleanup = () => {
      if (voice.dead) return;
      voice.dead = true;
      live.delete(voice);
      for (const n of voice.nodes) disconnect(n);
    };
    voice.cleanup = cleanup;
    for (const s of sources) {
      try {
        const prev = s.onended;
        s.onended = () => {
          try {
            if (typeof prev === 'function') prev();
          } catch { /* noop */ }
          cleanup();
        };
      } catch { /* voice still bounded by steal/dispose */ }
    }
    live.add(voice);
    return voice;
  };

  /* ---------------- sample loading (bounded, gesture/event-gated) ---------------- */

  const allReady = () => ALL_FILES.every((f) => fileState.get(f) === 'ready');

  const startFiles = (files, gen) => {
    for (const file of files) {
      if (disposed || gen !== generation) return;
      fileState.set(file, 'loading');
      let signal = null;
      try {
        if (typeof AbortController === 'function') {
          const ctrl = new AbortController();
          ctrls.set(file, ctrl);
          signal = ctrl.signal;
        }
      } catch { /* loader runs unabortable; generation still guards */ }
      const url = resolveAssetURL(file);
      let p;
      try {
        p = Promise.resolve(loader(url, signal));
      } catch (e) {
        p = Promise.reject(e instanceof Error ? e : new Error('load failed'));
      }
      const done = p.then(
        (bytes) => decodeBuffer(ctx, bytes).then(
          (buf) => {
            if (gen !== generation || disposed) return;
            inflight.delete(file);
            ctrls.delete(file);
            if (buf) {
              buffers.set(file, buf);
              fileState.set(file, 'ready');
              onBufferReady(file);
            } else {
              fileState.set(file, 'failed');
            }
          },
          () => {
            if (gen !== generation || disposed) return;
            inflight.delete(file);
            ctrls.delete(file);
            fileState.set(file, 'failed'); // safe silence, never buzz
          },
        ),
        () => {
          if (gen !== generation || disposed) return;
          inflight.delete(file);
          ctrls.delete(file);
          fileState.set(file, 'failed');
        },
      );
      inflight.set(file, done);
    }
  };

  /* reason: 'gesture' (unlock/prep) always loads; 'frame' never refetches
   * settled files; 'event' (cue) retries failures within the pass budget. */
  const ensureLoad = (reason) => {
    if (disposed || !ctx) return;
    const gen = generation;
    /* Files never attempted start once (unstarted->loading flips
     * synchronously), so update()/cue() can call here every frame/event
     * without any fetch storm. */
    const fresh = ALL_FILES.filter((f) => fileState.get(f) === 'unstarted');
    if (fresh.length > 0) {
      lastPassStartMs = Date.now();
      loadPasses += 1;
      startFiles(fresh, gen);
      return;
    }
    if (reason === 'frame') return;
    const failed = ALL_FILES.filter((f) => fileState.get(f) === 'failed');
    if (failed.length === 0 || loadPasses >= MAX_LOAD_PASSES) return;
    if (Date.now() - lastPassStartMs < LOAD_RETRY_COOLDOWN_MS) return;
    for (const f of failed) fileState.set(f, 'unstarted');
    lastPassStartMs = Date.now();
    loadPasses += 1;
    startFiles(failed, gen);
  };

  const onBufferReady = (file) => {
    /* Cue buffers just wait for the next real event (never self-fire).
     * Loop beds start now only when audible; otherwise the next audible
     * frame starts them with the latest latched drive frame. */
    if (!Object.values(LOOP_MAP).includes(file)) return;
    if (!audible()) return;
    startPendingLoops();
    try {
      applyDrive(lastFrame, now());
    } catch { /* frames will drive levels */ }
  };

  const startPendingLoops = () => {
    if (!audible()) return;
    if (typeof ctx.createBufferSource !== 'function') return;
    const want = [
      ['engine', LOOP_MAP.engine, graph.engFilter],
      ['drift', LOOP_MAP.drift, graph.driftF],
      ['reverse', LOOP_MAP.reverse, graph.revG],
      ['engineLoad', LOOP_MAP.engineLoad, graph.loadFilter],
    ];
    for (const [kind, file, dest] of want) {
      if (loops[kind]) continue;
      const buf = buffers.get(file);
      if (!buf) continue;
      let src = null;
      try {
        src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        if (src.playbackRate) src.playbackRate.value = 1;
      } catch {
        src = null;
      }
      if (!src) continue;
      connect(src, dest);
      loops[kind] = src;
      startSrc(src);
    }
  };

  /* A synthesized pitch sweep (from -> to over len) into the cue bus. */
  const blipNodes = (from, to, len, level, type, t0) => {
    if (typeof ctx.createOscillator !== 'function') return null;
    const osc = ctx.createOscillator();osc.type = type;
    const amp = ctx.createGain();
    at(osc.frequency, from, t0);
    osc.frequency.exponentialRampToValueAtTime?.(Math.max(20, to), t0 + len);
    at(amp.gain, FLOOR, t0);
    amp.gain.linearRampToValueAtTime?.(Math.min(.3, Math.max(FLOOR, level)), t0 + .004);
    amp.gain.exponentialRampToValueAtTime?.(FLOOR, t0 + len);
    connect(osc, amp);connect(amp, graph.cueBus);
    startSrc(osc, t0);stopSrc(osc, t0 + len + .03);
    return { osc, amp };
  };
  /* One bounded synthesized transient voice of its own. */
  const synthBlip = (from, to, len, level, type, t0, pan = 0) => {
    if (typeof ctx.createOscillator !== 'function') return false;
    try {
      stealIfFull(1);
      const osc = ctx.createOscillator();osc.type = type;
      const amp = ctx.createGain();
      at(osc.frequency, from, t0);
      if (typeof osc.frequency.exponentialRampToValueAtTime === 'function') osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + len);
      at(amp.gain, FLOOR, t0);
      if (typeof amp.gain.linearRampToValueAtTime === 'function') {
        amp.gain.linearRampToValueAtTime(Math.min(.3, Math.max(FLOOR, level)), t0 + .004);
        amp.gain.exponentialRampToValueAtTime?.(FLOOR, t0 + len);
      }
      connect(osc, amp);
      let panner = null;
      if (pan && typeof ctx.createStereoPanner === 'function') try { panner = ctx.createStereoPanner(); at(panner.pan, pan, t0); } catch { panner = null; }
      if (panner) { connect(amp, panner); connect(panner, graph.cueBus); } else connect(amp, graph.cueBus);
      track([osc], [osc, amp, ...(panner ? [panner] : [])], amp.gain);
      startSrc(osc, t0);stopSrc(osc, t0 + len + .03);
      return true;
    } catch { return false; }
  };

  /* ---------------- continuous beds ---------------- */

  const silenceContinuous = () => {
    if (!ctx || !graph) return;
    const t = now();
    ramp(graph.engineBus.gain, FLOOR, t, 0.015);
    // Don't reopen a stale loaded recording on the next live/coasting frame.
    ramp(graph.loadG.gain, FLOOR, t, 0.015);
    ramp(graph.engG.gain, .5, t, 0.015);
    ramp(graph.driftG.gain, FLOOR, t, 0.015);
    ramp(graph.revG.gain, FLOOR, t, 0.015);
    if (graph.synth) ramp(graph.synth.synthG.gain, FLOOR, t, 0.015);
    if (graph.texture) for (const g of ['raspG', 'roadG', 'windG', 'crackG']) ramp(graph.texture[g].gain, FLOOR, t, 0.015);
  };

  const applyDrive = (frame, t) => {
    const speed = num(frame.speed, 0);
    const throttle = num(frame.throttle, 0);
    const drifting = frame.drifting === true;
    const boost = frame.boost === true || num(frame.boost, 0) > 0;
    const n = clamp01(Math.abs(speed) / MAX_SPEED);
    const reversing = speed < -0.5;
    // With the four-speed gearbox, revs climb and fall back each shift;
    // road speed still adds weight. Without it, revs follow speed.
    const geared = frame.rpm !== null && frame.gear !== null;
    const rev = geared ? clamp01(frame.rpm * .78 + n * .22) : n;
    if (geared && frame.shift) { shiftAt = t; shiftDir = frame.shift; }
    const sinceShift = t - shiftAt;
    // An upshift briefly cuts drive, like a clutch; the voice then lands
    // lower in the next gear. A downshift under load blips the revs.
    const cut = geared && shiftDir > 0 && sinceShift >= 0 && sinceShift < .085 ? .42 : 1;
    const slur = geared && sinceShift >= 0 && sinceShift < .16;
    // Authority uses an opposing pedal as a brake until travel reverses
    // (kart-physics.js), with no engine force during that transition.
    const pedal = throttle * speed < -0.2 ? 0 : clamp01(Math.abs(throttle));
    const lift = boost && pedal > .05 ? 1 : 0;
    // Road speed carries the revs; accelerator demand adds load. Lifting
    // at the same speed must release the loaded recording immediately,
    // rather than letting max(speed,throttle) hold every parameter steady.
    const rpm = clamp01(rev * .75 + pedal * .20 + lift * .05);
    // Full pedal uses one combustion voice. Residual idle at cruise beats
    // against the loaded recording, even when both rate targets are stable.
    const load = loops.engineLoad ? pedal : 0;
    const revTime = slur ? .03 : pedal > .05 ? .10 : .24;
    const loadTime = pedal > .05 ? .025 : .04;
    const rate = Math.min(ENG_RATE_TOP, ENG_RATE_IDLE + rev * .40 + pedal * .14 + lift * .06 - (reversing ? .03 : 0));
    if (loops.engine?.playbackRate) ramp(loops.engine.playbackRate, Math.max(.87, rate), t, revTime);
    // Equal-power handoff preserves recorded combustion at both ends.
    // Fast load response makes a press audible before the chassis gains
    // speed; a slightly longer rev tail lets lift-off settle naturally.
    ramp(graph.engG.gain, .5 * Math.cos(load * Math.PI / 2), t, loadTime);
    ramp(graph.loadG.gain, .60 * Math.sin(load * Math.PI / 2), t, loadTime);
    // Slowing the higher-RPM recording preserves exhaust weight at takeoff;
    // full speed stays near its original pitch, avoiding a thin buzz.
    if (loops.engineLoad?.playbackRate) ramp(loops.engineLoad.playbackRate, Math.min(1.14, .62 + rev * .40 + pedal * .04 + lift * .08 - (reversing ? .02 : 0)), t, revTime);
    ramp(graph.loadFilter.frequency, 1600 + n * 1800 + pedal * 700 + lift * 200, t, .06);
    ramp(graph.engFilter.frequency, 1200 + n * 1000 + pedal * 300 + lift * 100, t, .08);
    ramp(graph.engineBus.gain, (.24 + rpm * .12 + pedal * .14 + lift * .035) * (cut < 1 ? .7 : 1), t, cut < 1 ? .012 : pedal > .05 ? .04 : .08);
    // The recorded bed sits underneath; the synth voice carries the pitch.
    ramp(graph.engG.gain, .2 * Math.cos(load * Math.PI / 2), t, loadTime);
    ramp(graph.loadG.gain, .24 * Math.sin(load * Math.PI / 2), t, loadTime);
    if (graph.synth) {
      if (boost && !boostWas) blipAt = t; // rev blip on each new boost
      if (geared && frame.shift < 0 && pedal > .05) blipAt = t;
      boostWas = boost;
      const blip = 1 + .38 * Math.exp(-Math.max(0, t - blipAt) / .13);
      // A little extra pitch under load, as a kart engine climbs the band.
      // Higher gears pull with a deeper, heavier note at the same revs.
      const gearDrop = geared && frame.gear > 1 ? 1 - (frame.gear - 1) * .045 : 1;
      const hz = (ENGINE_IDLE_HZ + (ENGINE_TOP_HZ - ENGINE_IDLE_HZ) * Math.pow(rev, .8) * gearDrop + pedal * 22 + lift * 18) * blip;
      for (const v of graph.synth.voices) ramp(v.osc.frequency, hz * v.ratio, t, slur ? .025 : pedal > .05 ? .05 : .12);
      ramp(graph.synth.synthF.frequency, (700 + rev * 2400 + pedal * 1300 + (blip - 1) * 2000) * (cut < 1 ? .55 : 1), t, cut < 1 ? .015 : .06);
      ramp(graph.synth.synthG.gain, (.2 + pedal * .16 + rev * .08) * cut, t, cut < 1 ? .01 : pedal > .05 ? .03 : .09);
      const tx = graph.texture;
      if (tx) {
        ramp(tx.raspF.frequency, Math.min(5200, hz * 4.5 + pedal * 600), t, .05);
        ramp(tx.raspG.gain, (.05 + pedal * .16 + rev * .06) * cut, t, cut < 1 ? .01 : .05);
        ramp(tx.roadF.frequency, 160 + n * 620, t, .12);
        ramp(tx.roadG.gain, n > .02 ? .03 + n * .16 : FLOOR, t, .12);
        ramp(tx.windG.gain, n > .25 ? n * n * .085 : FLOOR, t, .2);
        // Exhaust crackle: a pop on the shift and a smaller echo after it.
        if (geared && frame.shift && (pedal > .05 || frame.shift > 0)) {
          const g = tx.crackG.gain, peak = frame.shift > 0 ? .34 : .2;
          try {
            g.cancelScheduledValues?.(t);
            at(g, FLOOR, t);
            g.linearRampToValueAtTime?.(peak, t + .006);
            g.exponentialRampToValueAtTime?.(peak * .12, t + .05);
            g.linearRampToValueAtTime?.(peak * .55, t + .075);
            g.exponentialRampToValueAtTime?.(FLOOR, t + .16);
          } catch { /* keep driving audible */ }
          ramp(tx.crackF.frequency, frame.shift > 0 ? 1300 + rev * 900 : 900, t, .01);
        }
      }
    }
    // Drift/skid needs real slide speed; parked wiggle stays silent.
    const skid = drifting && n > 0.15 ? Math.min(1, 0.4 + 0.6 * n) : 0;
    ramp(graph.driftG.gain, skid > 0 ? 0.07 + skid * 0.2 : FLOOR, t, 0.06);
    ramp(graph.driftF.frequency, 650 + n * 550, t, 0.12);
    if (loops.drift && loops.drift.playbackRate) {
      ramp(loops.drift.playbackRate, 0.97 + n * 0.08, t, 0.12);
    }
    // Reverse reminder: quiet two-pulse gate, no timers or per-frame nodes.
    const beep = reversing && n > 0.03 && (t * 2) % 1 < 0.35;
    ramp(graph.revG.gain, beep ? 0.018 : FLOOR, t, 0.03);
  };

  /* ---------------- backend helpers ---------------- */

  const tryResume = (force) => {
    if (!ctx || typeof ctx.resume !== 'function') return;
    let suspended = false;
    try {
      suspended = ctx.state === 'suspended';
    } catch {
      return;
    }
    if (!suspended) return;
    // AudioContext.currentTime stops while suspended; retries use wall time.
    const timeMs = Date.now();
    if (!force && timeMs - lastResumeAttemptMs < RESUME_RETRY_MS) return;
    lastResumeAttemptMs = timeMs;
    try {
      const r = ctx.resume();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch { /* retryable on the next unlock/update/cue */ }
  };

  const onHidden = () => {
    // rAF stops when hidden, so the frame loop cannot silence us: do it
    // here. The next update() after visible restores levels.
    if (docHidden() && !disposed) {
      silenceContinuous();
      silenceCues();
    }
  };

  try {
    const d = globalThis.document;
    if (d && typeof d.addEventListener === 'function') {
      d.addEventListener('visibilitychange', onHidden);
      tracked.push([d, 'visibilitychange', onHidden]);
    }
  } catch { /* root still gates via update({active}) */ }

  if (opts.autoUnlock === true) {
    let win = null;
    try {
      win = globalThis.window || globalThis;
    } catch {
      win = null;
    }
    if (win && typeof win.addEventListener === 'function') {
      const gesture = () => { api.unlock(); };
      try {
        win.addEventListener('pointerdown', gesture);
        tracked.push([win, 'pointerdown', gesture]);
        win.addEventListener('keydown', gesture);
        tracked.push([win, 'keydown', gesture]);
      } catch { /* explicit unlock() still works */ }
    }
  }

  /* ---------------- public frame interface ---------------- */

  const api = {
    /* Run inside a real user gesture. Builds/resumes the graph and starts
     * sample loading; safe to repeat. Returns true when the graph exists
     * (decode readiness is async; see ready()/status()). */
    unlock() {
      if (disposed) return false;
      unlocked = true;
      if (!ctx) {
        try {
          ctx = factory();
        } catch {
          ctx = null;
        }
        if (!ctx) return false;
      }
      if (!graph) {
        try {
          graph = buildGraph(ctx);
        } catch {
          graph = null;
          return false;
        }
      }
      tryResume(true);
      ensureLoad('gesture');
      // Warm the idle beds now so the first frame is already placed; loop
      // sources attach as each buffer decodes (latest frame wins).
      if (audible()) {
        try {
          startPendingLoops();
          applyDrive(lastFrame, now());
        } catch { /* frames will drive levels */ }
      }
      return true;
    },

    /* Explicit preload outside a gesture (optional; unlock() also loads). */
    prep() {
      if (disposed || !unlocked || !ctx) return false;
      ensureLoad('gesture');
      return true;
    },

    /* Resolves once in-flight loads settle: true when every sample decoded. */
    ready() {
      if (disposed) return Promise.resolve(false);
      const ps = [...inflight.values()];
      if (ps.length === 0) return Promise.resolve(!disposed && allReady());
      return new Promise((resolve) => {
        const finish = (value) => { readyWaiters.delete(finish); resolve(value); };
        readyWaiters.add(finish);
        Promise.allSettled(ps).then(() => finish(!disposed && allReady()));
      });
    },

    /* Introspection for tests/debug: load state per file. */
    status() {
      const loaded = [];
      const failed = [];
      const pending = [];
      for (const f of ALL_FILES) {
        const s = fileState.get(f);
        if (s === 'ready') loaded.push(f);
        else if (s === 'failed') failed.push(f);
        else pending.push(f);
      }
      return {
        unlocked, muted, active, engineActive,
        loading: inflight.size, loaded, failed, pending,
        ready: allReady(),
      };
    },

    setMuted(m) {
      muted = m === true;
      if (muted && !disposed) {
        silenceContinuous();
        silenceCues();
      }
    },

    /* Per-frame drive state from the render pose. Ramps only — no nodes,
     * no fetches. active=false (non-drive phase, hidden, spectator)
     * silences now; engineActive=false (KO/respawn) silences the beds while
     * cue() events for nearby watchers still play.
     * Returns true once the graph exists, false while locked/disposed. */
    update(frame) {
      if (disposed) return false;
      const f = frame && typeof frame === 'object' ? frame : {};
      if (f.active !== undefined) active = f.active !== false;
      if (f.engineActive !== undefined) engineActive = f.engineActive !== false;
      lastFrame = {
        speed: num(f.speed, 0),
        throttle: num(f.throttle, 0),
        drifting: f.drifting === true,
        boost: f.boost === true || num(f.boost, 0) > 0,
        // Optional gearbox state from kart-gearbox.mjs (views compute it).
        gear: Number.isInteger(f.gear) ? f.gear : null,
        rpm: Number.isFinite(f.rpm) ? clamp01(f.rpm) : null,
        shift: f.shift > 0 ? 1 : f.shift < 0 ? -1 : 0,
      };
      // Locked updates still retain watcher/KO gates and the latest pose.
      // Decoding after a gesture must not resurrect an idle driving engine.
      if (!unlocked || !ctx || !graph) return false;
      tryResume(false);
      ensureLoad('frame');
      if (muted || !active || docHidden()) {
        silenceContinuous();
        silenceCues();
        return true;
      }
      if (engineActive === false) silenceContinuous();
      else {
        startPendingLoops();
        applyDrive(lastFrame, now());
      }
      return true;
    },

    /* Short warning beep for incoming fire; `level` 0..1 raises pitch.
     * Rate limiting belongs to the caller; a floor of 80 ms stops stacking. */
    beep(level = .5) {
      if (disposed || muted || !unlocked || !ctx || !graph || !active || docHidden()) return false;
      const t0 = now();if (t0 < nextBeepAt) return false;nextBeepAt = t0 + .08;
      return synthBlip(880 + clamp01(level) * 700, 880 + clamp01(level) * 760, .075, .11, 'sine', t0);
    },

    /* Arena feature cues (cannon launch/landing, portal warp, fall splash),
     * synthesized from short sweeps through the shared synthBlip voice: no
     * samples, no extra oscillator sites. Unknown names return false. */
    arenaCue(name, options = {}) {
      if (disposed || muted || !unlocked || !ctx || !graph || !active || docHidden()) return false;
      const sweeps = ARENA_CUES[name];
      if (!sweeps) return false;
      const gain = clamp01(num(options?.gain, 1)), pan = Math.max(-1, Math.min(1, num(options?.pan, 0)));
      if (gain === 0) return false;
      const t0 = now();
      let any = false;
      for (const [from, to, len, level, type, delay] of sweeps) any = synthBlip(from, to, len, level * gain, type, t0 + delay, pan) || any;
      return any;
    },

    /* Schedule a named cue with optional strength, attenuation and stereo pan.
     * Returns true when scheduled, false when
     * locked, muted, inactive, hidden, disposed, unknown, backend-less, or
     * while the sample is unavailable (dropped, never queued late). */
    cue(name,options={}) {
      if (disposed || muted || !unlocked || !ctx || !graph) return false;
      if (!active || docHidden()) return false;
      if (typeof name !== 'string') return false;
      if (!CUE_NAMES.includes(name)) return false;
      const strength=clamp01(num(options?.strength,1));
      const gain=clamp01(num(options?.gain,1)),pan=Math.max(-1,Math.min(1,num(options?.pan,0)));
      if(gain===0)return false;
      const file = name==='collision'&&strength<.45?COLLISION_VARIANTS.soft:ASSET_MAP[name];
      if (!file) return false;
      tryResume(false);
      ensureLoad('event');
      const buf = buffers.get(file);
      if (!buf) return false;
      if (typeof ctx.createBufferSource !== 'function') return false;
      const t0 = now();
      // Repeated resting contacts are quieter than a sustained machine gun.
      if(name==='collision'&&t0-lastCollision.at<.11)return false;
      if(name==='collision')lastCollision.at=t0;
      try {
        stealIfFull(1);
        // Every weapon gets a crisp synthesized pop, owned by the same voice.
        const pop = WEAPON_POP[name] ? blipNodes(...WEAPON_POP[name], .13 * gain, 'square', t0) : null;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = false;
        const amp = ctx.createGain();
        const peak = (CUE_GAIN[name] || 0.3)*((name==='collision'||name==='landing')?.4+.6*strength:1);
        at(amp.gain,FLOOR,t0);
        const duration=Math.min(3,Math.max(.05,num(buf.duration,.5)));
        const level=Math.min(.4,Math.max(FLOOR,peak*gain));
        if(typeof amp.gain.linearRampToValueAtTime==='function'){
          amp.gain.linearRampToValueAtTime(level,t0+.004);
          amp.gain.linearRampToValueAtTime(level,t0+Math.max(.004,duration-.055));
          amp.gain.linearRampToValueAtTime(FLOOR,t0+duration);
        }else at(amp.gain,level,t0);
        connect(src, amp);
        let panner=null;
        if(typeof ctx.createStereoPanner==='function')try{panner=ctx.createStereoPanner();at(panner.pan,pan,t0);}catch{panner=null;}
        if(panner){connect(amp,panner);connect(panner,graph.cueBus);}else connect(amp,graph.cueBus);
        track(pop ? [src, pop.osc] : [src], [src, amp,...(panner?[panner]:[]),...(pop?[pop.osc,pop.amp]:[])], amp.gain);
        startSrc(src, t0);
        const dur = num(buf.duration, 0.5);
        stopSrc(src, t0 + Math.min(3, Math.max(0.05, dur)) + 0.05);
      } catch {
        return false;
      }
      return true;
    },

    cues() {
      return [...CUE_NAMES];
    },
    isMuted() {
      return muted;
    },
    isUnlocked() {
      return unlocked;
    },
    disposed() {
      return disposed;
    },
    available() {
      if (disposed) return false;
      if (ctx) return true;
      try {
        return typeof globalThis.AudioContext === 'function' ||
          typeof globalThis.webkitAudioContext === 'function';
      } catch {
        return false;
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const finish of [...readyWaiters]) finish(false);
      generation += 1; // async load completions turn inert
      for (const [, ctrl] of ctrls) {
        try {
          if (ctrl && typeof ctrl.abort === 'function') ctrl.abort();
        } catch { /* noop */ }
      }
      ctrls.clear();
      inflight.clear();
      buffers.clear();
      for (const [t, type, fn] of tracked) {
        try {
          t.removeEventListener(type, fn);
        } catch { /* noop */ }
      }
      tracked.length = 0;
      silenceCues();
      for (const k of Object.keys(loops)) {
        if (loops[k]) stopSrc(loops[k]);
        disconnect(loops[k]);
        loops[k] = null;
      }
      if (graph?.synth) for (const v of graph.synth.voices) { try { v.osc.stop(); } catch { /* noop */ } disconnect(v.osc); disconnect(v.g); }
      if (graph?.synth) { disconnect(graph.synth.synthF); disconnect(graph.synth.synthG); }
      if (graph?.texture) { stopSrc(graph.texture.noise); for (const n of Object.values(graph.texture)) disconnect(n); }
      if (graph) {
        const nodes = [graph.engFilter, graph.engG,graph.loadFilter,graph.loadG,
          graph.driftF, graph.driftG, graph.revG,
          graph.engineBus, graph.cueBus, graph.comp, graph.master];
        for (const n of nodes) disconnect(n);
        graph = null;
      }
      live.clear();
      if (ctx) {
        try {
          if (typeof ctx.close === 'function') {
            const r = ctx.close();
            if (r && typeof r.catch === 'function') r.catch(() => {});
          }
        } catch { /* noop */ }
        ctx = null;
      }
    },
  };

  return api;
}
