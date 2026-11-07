/* Browser side of the real-time layer. Three independent pieces:
 *   decodeFrame()              binary frames -> the same 'state' messages
 *                              the JSON transport delivers
 *   createInterpolationBuffer() server-timed samples with an adaptive delay
 *   createInputHistory()        sequenced inputs for prediction replay
 * None of them touch the DOM, sockets or a renderer. */
import { compileSchema, decodeFrameBytes, mergeStreamed, patch } from './codec.mjs';

export { CAPABILITY } from './codec.mjs';

/* Frame decoder. apply(bytes) returns a full state message, or null when a
 * delta arrives without its base (the server then sends a keyframe).
 * Streamed entities missing from a frame keep their last record and carry
 * rtAge (ms since that record's pose) so renderers can treat them as stale.
 * eventDeltas mirrors the JSON 'delta-v1' contract: events lists only ids
 * this decoder has not emitted since the last keyframe. */
export function decodeFrame({ eventDeltas = false } = {}) {
  let seq = null, pub = null, schemas = [], records = [], seenEvents = new Set(), instance = null;
  function apply(buffer) {
    let frame;
    let seen = null;
    try { frame = decodeFrameBytes(buffer, (json, index) => {
      if (json.s && seen !== json) { seen = json; schemas = json.s.map(compileSchema); }
      return schemas[index];
    }); } catch { return null; }
    if (!frame.keyframe && (pub === null || frame.base !== seq)) return null;
    if (frame.json.s && seen !== frame.json) schemas = frame.json.s.map(compileSchema);
    seq = frame.seq;
    pub = frame.keyframe ? frame.json.p : patch(pub, frame.json.p);
    if (frame.keyframe) records = schemas.map(() => new Map());
    const state = { ...pub, ...(frame.json.v || {}) };
    if (state.instanceId !== instance) { instance = state.instanceId; seenEvents = new Set(); records = schemas.map(() => new Map()); }
    for (const s of frame.streams) {
      const schema = schemas[s.index], list = read(state, schema.path) || [];
      for (const r of s.records) {
        const entity = list[r.entity];
        if (entity) records[s.index].set(entity[schema.key], { fields: r.fields, at: frame.simAt });
      }
    }
    schemas.forEach((schema, i) => {
      const list = read(state, schema.path);
      if (!Array.isArray(list)) return;
      const merged = list.map(entity => {
        if (!entity?.$rt) return entity;
        const rec = records[i].get(entity[schema.key]), { $rt, ...rest } = entity;
        return rec ? { ...mergeStreamed(rest, rec.fields), rtAge: Math.max(0, frame.simAt - rec.at) } : rest;
      });
      writeTop(state, schema.path, merged);
    });
    if (eventDeltas && Array.isArray(state.events)) {
      const fresh = state.events.filter(e => !seenEvents.has(e.id));
      seenEvents = new Set(state.events.map(e => e.id));
      state.events = fresh;
    }
    state.t = 'state';
    return state;
  }
  return { apply, reset() { seq = null; pub = null; records = []; seenEvents = new Set(); instance = null; } };
}
const read = (obj, path) => path.split('.').reduce((v, k) => v?.[k], obj);
function writeTop(state, path, value) {
  const parts = path.split('.'); let o = state;
  for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = { ...o[parts[i]] }; o = o[parts[i]]; }
  o[parts.at(-1)] = value;
}

/* Adaptive interpolation buffer keyed by SERVER time.
 * Render time = serverNow - delay. The delay covers one send interval plus
 * the measured spread of sample age on arrival (network + scheduling
 * jitter), so it shrinks on good links and grows on bad ones instead of a
 * fixed guess. Per entity, a slower interest period adds its own spacing.
 * Delay changes are slewed (at most 6% of elapsed time) so playback never
 * jumps backwards or races. */
export function createInterpolationBuffer({ minDelay = 35, maxDelay = 250, capacity = 12, extrapolate = 120 } = {}) {
  const tracks = new Map();
  let interval = 50, ageMean = 60, ageDev = 15, target = 110, delay = 110, lastNow = null, lastSim = null;
  function observe(simAt, serverNow) {
    if (lastSim !== null && simAt > lastSim) interval += (Math.min(250, simAt - lastSim) - interval) * 0.1;
    lastSim = Math.max(lastSim ?? simAt, simAt);
    const age = Math.max(0, serverNow - simAt);
    ageMean += (age - ageMean) * 0.08; ageDev += (Math.abs(age - ageMean) - ageDev) * 0.08;
    target = Math.max(minDelay, Math.min(maxDelay, interval + ageMean + 2.5 * ageDev));
  }
  function push(id, simAt, sample, { life = 0 } = {}) {
    let t = tracks.get(id);
    if (!t || t.life !== life) { t = { life, list: [], spacing: interval }; tracks.set(id, t); }
    const last = t.list.at(-1);
    if (last && simAt <= last.at) { if (simAt === last.at) last.sample = sample; return; }
    if (last) t.spacing += (Math.min(500, simAt - last.at) - t.spacing) * 0.2;
    t.list.push({ at: simAt, sample });
    while (t.list.length > capacity) t.list.shift();
  }
  /* Slewed shared delay; call once per rendered frame. */
  function advance(serverNow) {
    if (lastNow === null) delay = target;
    else { const step = Math.max(1, (serverNow - lastNow) * 0.06); delay += Math.max(-step, Math.min(step, target - delay)); }
    lastNow = serverNow;
    return delay;
  }
  /* Two bracketing samples and the blend factor; mix() is the caller's. */
  function sample(id, serverNow, mix) {
    const t = tracks.get(id); if (!t?.list.length) return null;
    const extra = Math.max(0, t.spacing - interval * 1.25);
    const time = serverNow - delay - extra, list = t.list;
    if (time <= list[0].at) return list[0].sample;
    for (let i = list.length - 1; i > 0; i--) {
      if (list[i - 1].at <= time) {
        const a = list[i - 1], b = list[i];
        if (time >= b.at) break;
        return mix(a.sample, b.sample, (time - a.at) / (b.at - a.at), 0);
      }
    }
    const a = list.length > 1 ? list.at(-2) : null, b = list.at(-1);
    // Past the newest sample: extrapolate briefly along the last segment.
    const ahead = Math.min(extrapolate, time - b.at) / 1000;
    return a ? mix(a.sample, b.sample, 1, ahead) : b.sample;
  }
  return {
    observe, push, advance, sample,
    remove: id => tracks.delete(id),
    clear() { tracks.clear(); lastNow = null; lastSim = null; },
    stats: () => ({ delay, target, interval, ageMean, ageDev }),
  };
}

/* Input history for prediction and reconciliation. Record every input the
 * client simulated with its sequence number; when an authoritative state
 * acknowledges seq N, replay the inputs after N on top of it. */
export function createInputHistory({ capacity = 64, maxAgeMs = 1000 } = {}) {
  let list = [];
  return {
    record(seq, input, dtMs, at) { list.push({ seq, input, dt: dtMs, at }); if (list.length > capacity) list.shift(); },
    /* Inputs not yet reflected by the authoritative state. */
    after(ackSeq, now) { list = list.filter(x => x.seq > ackSeq && (now === undefined || now - x.at <= maxAgeMs)); return list.slice(); },
    clear() { list = []; },
    get size() { return list.length; },
  };
}

/* Generic reconcile helper: authoritative state + unacknowledged inputs.
 * step(state, input, dtSeconds) must be the same deterministic step the
 * server runs. Returns the predicted state and the visual error to blend. */
export function reconcile({ authoritative, ackSeq, history, step, now, clone = structuredClone }) {
  let state = clone(authoritative);
  for (const x of history.after(ackSeq, now)) state = step(state, x.input, x.dt / 1000) || state;
  return state;
}
