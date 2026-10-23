/* Pocket Karts audio: sample-based kart engine + arcade cues (WebAudio).
 *
 * Local pack under ../../assets/karts/audio/ as WAV PCM16 mono 44100 Hz:
 * separate petrol idle/load, drift and quiet reverse beds,17 one-shot samples
 * and19 cue names (seeker/bomb reuse existing launch/throw samples).
 * Honest description: engine/drift/pulse/scatter/rail/grenade are edited
 * real-world recordings (6.5HP petrol kart idle/load, tire squeal, firearms);
 * rocket/emp and the Kenney UI/power cues are pre-produced sound effects.
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
 * - Failed loads fall back to safe silence (never procedural buzz); partial
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
export const CUE_NAMES = ['pulse', 'scatter', 'mine', 'shield', 'pickup', 'ko', 'respawn', 'boost', 'rocket', 'rail', 'grenade', 'emp', 'grenadeBlast', 'collision', 'landing', 'rocketBlast', 'bombBlast', 'seeker', 'bomb'];

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
  rail: 'rail.wav',
  grenade: 'grenade.wav',
  emp: 'emp.wav',
  grenadeBlast: 'grenadeBlast.wav',
  collision: 'collision.wav',
  landing:'landing.wav',
  rocketBlast:'rocketBlast.wav',
  bombBlast:'bombBlast.wav',
  // Guided rockets share the launch recording; a timed bomb shares the
  // restrained canister throw. Their detonations have separate cue files.
  seeker:'rocket.wav',
  bomb:'grenade.wav',
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
const ENG_RATE_IDLE = 0.9;
const ENG_RATE_TOP = 1.5;
const FLOOR = 0.0001;

/* Modest per-cue voice peaks (master 0.8 + compressor keep headroom). */
const CUE_GAIN = {
  pulse: 0.32, scatter: 0.3, mine: 0.34, shield: 0.3, pickup: 0.3,
  ko: 0.38, respawn: 0.3, boost: 0.34, rocket: 0.34, rail: 0.32,
  grenade: 0.32, emp: 0.3,
  grenadeBlast: 0.36, collision: 0.25,
  landing:.18,rocketBlast:.30,bombBlast:.32,
  seeker:.34,bomb:.32,
};

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

    return {
      master, comp: head === master ? null : head, engineBus, cueBus,
      engFilter, engG, driftF, driftG, revG, loadFilter, loadG,
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
  };

  const applyDrive = (frame, t) => {
    const speed = num(frame.speed, 0);
    const throttle = num(frame.throttle, 0);
    const drifting = frame.drifting === true;
    const boost = frame.boost === true || num(frame.boost, 0) > 0;
    const n = clamp01(Math.abs(speed) / MAX_SPEED);
    const reversing = speed < -0.5;
    // Authority uses an opposing pedal as a brake until travel reverses
    // (kart-physics.js), with no engine force during that transition.
    const pedal = throttle * speed < -0.2 ? 0 : clamp01(Math.abs(throttle));
    const lift = boost && pedal > .05 ? 1 : 0;
    // Road speed carries the revs; accelerator demand adds load. Lifting
    // at the same speed must release the loaded recording immediately,
    // rather than letting max(speed,throttle) hold every parameter steady.
    const rpm = clamp01(n * .75 + pedal * .20 + lift * .05);
    // Full pedal uses one combustion voice. Residual idle at cruise beats
    // against the loaded recording, even when both rate targets are stable.
    const load = loops.engineLoad ? pedal : 0;
    const revTime = pedal > .05 ? .10 : .24;
    const loadTime = pedal > .05 ? .025 : .04;
    const rate = Math.min(ENG_RATE_TOP, ENG_RATE_IDLE + n * .40 + pedal * .14 + lift * .06 - (reversing ? .03 : 0));
    if (loops.engine?.playbackRate) ramp(loops.engine.playbackRate, Math.max(.87, rate), t, revTime);
    // Equal-power handoff preserves recorded combustion at both ends.
    // Fast load response makes a press audible before the chassis gains
    // speed; a slightly longer rev tail lets lift-off settle naturally.
    ramp(graph.engG.gain, .5 * Math.cos(load * Math.PI / 2), t, loadTime);
    ramp(graph.loadG.gain, .60 * Math.sin(load * Math.PI / 2), t, loadTime);
    // Slowing the higher-RPM recording preserves exhaust weight at takeoff;
    // full speed stays near its original pitch, avoiding a thin buzz.
    if (loops.engineLoad?.playbackRate) ramp(loops.engineLoad.playbackRate, Math.min(1.14, .62 + n * .40 + pedal * .04 + lift * .08 - (reversing ? .02 : 0)), t, revTime);
    ramp(graph.loadFilter.frequency, 1600 + n * 1800 + pedal * 700 + lift * 200, t, .06);
    ramp(graph.engFilter.frequency, 1200 + n * 1000 + pedal * 300 + lift * 100, t, .08);
    ramp(graph.engineBus.gain, .24 + rpm * .12 + pedal * .14 + lift * .035, t, pedal > .05 ? .04 : .08);
    // Drift/skid needs real slide speed; parked wiggle stays silent.
    const skid = drifting && n > 0.15 ? Math.min(1, 0.4 + 0.6 * n) : 0;
    ramp(graph.driftG.gain, skid > 0 ? 0.04 + skid * 0.12 : FLOOR, t, 0.08);
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
        track([src], [src, amp,...(panner?[panner]:[])], amp.gain);
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
