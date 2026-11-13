'use strict';
/* Server half of the real-time layer (browser half: public/js/toolkit/realtime).
 *
 * A game opts in with def.realtime(state) returning a spec, or null to keep
 * the JSON transport for that state:
 *   {
 *     streams: [{ path: 'karts', key: 'pid', fields: [...] }],  // codec schema
 *     publicView(state, ctx)  -> view shared by every recipient (built once)
 *     privateView(state, pid, ctx) -> small per-recipient fields
 *   }
 * A recipient's focus for interest management is its own entity (key ===
 * pid) in the first stream; recipients without one get the no-focus rate.
 * and optionally def.tickRate = { target: 33, max: 66 } for the adaptive
 * tick governor below. Sockets opt in with the 'rt1' capability; everyone
 * else keeps the JSON 'state' messages unchanged.
 *
 * Per tick the channel builds the public view once, encodes every streamed
 * entity's binary record once, and diffs the stripped public view once
 * against the previous frame. Each recipient then gets: that shared patch
 * (or a catch-up delta from its last send), its private fields, and the entity
 * records its interest tiers make due this tick. */

const codec = require('../public/js/toolkit/realtime/codec.mjs');
const interest = require('../public/js/toolkit/realtime/interest.mjs');

/* Reuse the negotiated rt1 JSON delta for games without entity streams.
 * Only explicitly shared fields from the spectator projection enter the
 * shared history. All other fields come from each recipient's own view.
 * Never project raw game state here: it may contain answers or private input.
 */
function createJsonRealtime(view, sharedKeys) {
  const shared = new Set(sharedKeys);
  return {
    streams: [],
    publicView(state, ctx) {
      const projected = view(state, null, ctx), out = {};
      for (const key of shared) if (Object.hasOwn(projected, key)) out[key] = projected[key];
      return out;
    },
    privateView(state, pid, ctx) {
      const projected = view(state, pid, ctx), out = {};
      for (const key of Object.keys(projected)) if (!shared.has(key)) out[key] = projected[key];
      return out;
    },
  };
}

function createRealtimeChannel(spec) {
  const streams = spec.streams.map(codec.compileSchema);
  const schemaJSON = JSON.stringify(spec.streams);
  // Patches for the current tick, shared by peers on the same public baseline.
  const patchCache = new Map();
  const sockets = new WeakMap();
  let seq = 0, current = null, tick = 0;

  /* Builds this tick's shared parts. envelope: room fields every recipient shares. */
  function prepare(state, ctx, envelope) {
    // Snapshot through JSON: views may alias live mutable game arrays, and
    // history must hold exactly what the JSON transport would have sent.
    const view = JSON.parse(JSON.stringify({ ...envelope, ...spec.publicView(state, ctx) }));
    const built = streams.map(schema => {
      const list = view[schema.path];
      if (!Array.isArray(list)) return { schema, records: [], keys: [], points: [] };
      const records = [], keys = [], points = [], stripped = [];
      for (const entity of list) {
        if (entity && codec.streamable(schema, entity)) {
          records.push(codec.encodeRecord(schema, entity));
          stripped.push({ ...codec.stripStreamed(schema, entity), $rt: 1 });
        } else { records.push(null); stripped.push(entity); }
        keys.push(entity?.[schema.key]);
        points.push({ x: Number(entity?.x) || 0, z: Number(entity?.z) || 0 });
      }
      view[schema.path] = stripped;
      return { schema, records, keys, points };
    });
    seq = (seq + 1) >>> 0; tick++;
    const previous = current?.view;
    patchCache.clear();
    const shared = previous ? codec.diff(previous, view) : undefined;
    if (previous) patchCache.set(previous, JSON.stringify(shared ?? {}));
    // Entities whose JSON half changed this tick ship their record too, so
    // a respawn or life change never pairs new fields with an old pose.
    const changed = built.map(b => {
      const patch = shared?.o?.[b.schema.path];
      // Inserting the first entity replaces an empty array. Every streamed
      // entity then needs its first pose, independent of its interest tier.
      if (patch && Object.hasOwn(patch, '$')) return new Set(b.keys.map(String));
      return new Set(Object.keys(patch?.u || {}));
    });
    // Positions come from the unstripped entities (x/z may be streamed fields).
    const focus = new Map();
    for (const b of built) b.keys.forEach((key, i) => { if (!focus.has(key)) focus.set(key, b.points[i]); });
    current = { view, built, changed, focus, simAt: Number.isFinite(view.simAt) ? view.simAt : Date.now(), keyText: null };
    return current;
  }

  function patchText(base) {
    if (!patchCache.has(base)) patchCache.set(base, JSON.stringify(codec.diff(base, current.view) ?? {}));
    return patchCache.get(base);
  }

  /* One recipient's binary frame for the prepared tick. */
  function frameFor(socket, pid, privateFields) {
    const previous = sockets.get(socket);
    const keyframe = !previous || previous.view.instanceId !== current.view.instanceId;
    // A stalled link still owns its last sent public snapshot. Send only what
    // changed since then, plus current poses (including normally distant karts).
    const catchup = previous && ((seq - previous.seq) >>> 0) > 1;
    let jsonText;
    if (keyframe) {
      current.keyText ??= JSON.stringify(current.view);
      jsonText = '{"p":' + current.keyText + ',"v":' + JSON.stringify(privateFields) + ',"s":' + schemaJSON + '}';
    } else jsonText = '{"p":' + patchText(previous.view) + ',"v":' + JSON.stringify(privateFields) + '}';
    const focus = pid ? current.focus.get(pid) || null : null;
    const out = current.built.map((b, index) => {
      const periods = interest.interestPeriods(focus, b.points, spec.tiers);
      const records = [];
      b.records.forEach((bytes, i) => {
        if (!bytes) return;
        const key = String(b.keys[i]);
        if (keyframe || catchup || current.changed[index].has(key) || interest.due(tick, i, periods[i])) {
          records.push({ entity: i, bytes });
        }
      });
      return { index, records };
    }).filter(x => x.records.length);
    const base = keyframe ? 0 : previous.seq;
    const frame = codec.encodeFrame({ seq, base, simAt: current.simAt, keyframe, jsonText, streams: out });
    // One reference per socket; all recipients of this tick share the public view.
    sockets.set(socket, { seq, view: current.view });
    return frame;
  }

  return {
    prepare, frameFor,
    /* The socket missed or could not apply a frame: next one is a keyframe. */
    resync(socket) { sockets.delete(socket); },
    get seq() { return seq; },
  };
}

/* Adaptive tick rate. Each realtime room starts at its target interval and
 * steps to a slower level when its own tick (simulation + broadcast) uses
 * more than half the interval, or when the whole process is busy more than
 * 55% of wall time; it steps back toward the target once both are calm.
 * Levels change at most once a second so clients see a steady cadence. */
function createTickGovernor({ levels = [33, 40, 50, 66], busyHigh = 0.55, busyLow = 0.3, now = () => Date.now() } = {}) {
  const rooms = new WeakMap();
  let windowStart = now(), busy = 0, load = 0;
  function rollWindow(t) {
    if (t - windowStart < 1000) return;
    load = busy / (t - windowStart); busy = 0; windowStart = t;
  }
  function entry(key, rate) {
    let e = rooms.get(key);
    if (!e) {
      const allowed = levels.filter(l => l >= (rate.target || levels[0]) && l <= (rate.max || levels.at(-1)));
      e = { allowed: allowed.length ? allowed : [rate.target || 50], level: 0, cost: 0, changedAt: now() };
      rooms.set(key, e);
    }
    return e;
  }
  return {
    interval(key, rate = {}) { return entry(key, rate).allowed[entry(key, rate).level]; },
    record(key, ms, rate = {}) {
      const t = now(), e = entry(key, rate);
      busy += ms; rollWindow(t);
      e.cost += (ms - e.cost) * 0.1;
      if (t - e.changedAt < 1000) return;
      const interval = e.allowed[e.level];
      if ((e.cost > interval * 0.5 || load > busyHigh) && e.level < e.allowed.length - 1) { e.level++; e.changedAt = t; }
      else if (e.cost < interval * 0.25 && load < busyLow && e.level > 0) { e.level--; e.changedAt = t; }
    },
    stats(key) { const e = key && rooms.get(key); return { load, ...(e ? { interval: e.allowed[e.level], cost: e.cost } : {}) }; },
  };
}

// Opt-in room timing; callers keep this off the public state/socket path.
function createTickTiming() {
  const ticks=[];
  return {
    record(ms,at,late=false){ticks.push({ms,at,late});while(ticks.length&&ticks[0].at<at-10000)ticks.shift();},
    stats(at=Date.now()){
      while(ticks.length&&ticks[0].at<at-10000)ticks.shift();
      const costs=ticks.map(t=>t.ms).sort((a,b)=>a-b),pct=p=>costs[Math.max(0,Math.ceil(costs.length*p)-1)]||0;
      return {ticks:costs.length,p50:pct(.5),p99:pct(.99),max:costs.at(-1)||0,lateTicks:ticks.filter(t=>t.late).length};
    },
  };
}

const governor = createTickGovernor();

module.exports = { createJsonRealtime, createRealtimeChannel, createTickGovernor, createTickTiming, governor, CAPABILITY: codec.CAPABILITY };
