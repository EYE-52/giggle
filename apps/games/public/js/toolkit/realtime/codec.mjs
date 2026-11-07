/* Real-time wire codec shared by the server channel and the browser decoder.
 * No DOM, sockets or game knowledge: games describe their moving entities
 * with stream schemas and everything else travels as a structural JSON
 * delta against the previous frame the same socket received.
 *
 * Frame (little endian):
 *   u8 'R' (0x52), u8 version, u8 flags (1 = keyframe), u8 reserved
 *   u32 frame seq, u32 base seq (the frame a delta applies to),
 *   f64 server time of the simulated pose (simAt),
 *   u32 JSON byte length, JSON {p: public patch | public, v: private, s?: schemas}
 *   u8 stream count, then per stream: u8 stream index, u16 records,
 *   and per record u16 entity index + the schema's packed fields. */

export const FRAME_MAGIC = 0x52;
export const FRAME_VERSION = 1;
export const CAPABILITY = 'rt1';

/* ---------- structural JSON delta ----------
 * A patch node is one of:
 *   {$: value}                      replace with value
 *   {o: {key: node}, d: [keys]}     object: changed keys, deleted keys
 *   {k: field, i: [ids], u: {id: node}}  keyed array: new order + changed items
 *   {k: field, x: [ids], a: [ids], u}     keyed array: drop x, append a (queues,
 *                                          stable rosters: no full order resend)
 * Unchanged values produce no node (diff returns undefined). */
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const keyOf = arr => {
  if (!arr.length || !arr.every(isObj)) return null;
  for (const k of ['id', 'pid']) {
    const ids = arr.map(x => x[k]);
    if (ids.every(id => typeof id === 'string' || typeof id === 'number') && new Set(ids).size === ids.length) return k;
  }
  return null;
};

function same(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false; return true; }
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.hasOwn(b, k) || !same(a[k], b[k])) return false;
  return true;
}

export function diff(prev, next) {
  if (prev === next) return undefined;
  if (isObj(prev) && isObj(next)) {
    let o = null, d = null;
    for (const k of Object.keys(next)) {
      if (next[k] === undefined) continue;
      if (!Object.hasOwn(prev, k) || prev[k] === undefined) { (o ||= {})[k] = { $: next[k] }; continue; }
      const node = diff(prev[k], next[k]);
      if (node !== undefined) (o ||= {})[k] = node;
    }
    for (const k of Object.keys(prev)) if (prev[k] !== undefined && (!Object.hasOwn(next, k) || next[k] === undefined)) (d ||= []).push(k);
    if (!o && !d) return undefined;
    const node = {}; if (o) node.o = o; if (d) node.d = d;
    return node;
  }
  if (Array.isArray(prev) && Array.isArray(next)) {
    const key = keyOf(next);
    if (key && keyOf(prev) === key) {
      const before = new Map(prev.map(x => [x[key], x]));
      let u = null;
      for (const item of next) {
        const old = before.get(item[key]);
        const node = old === undefined ? { $: item } : diff(old, item);
        if (node !== undefined) (u ||= {})[item[key]] = node;
      }
      const ids = next.map(x => x[key]), present = new Set(ids);
      const x = prev.map(p => p[key]).filter(id => !present.has(id));
      const kept = prev.map(p => p[key]).filter(id => present.has(id)), a = ids.slice(kept.length);
      const tail = kept.every((id, i) => ids[i] === id) && a.every(id => !before.has(id));
      if (!u && !x.length && !a.length && tail) return undefined;
      const node = { k: key };
      if (tail) { if (x.length) node.x = x; if (a.length) node.a = a; } else node.i = ids;
      if (u) node.u = u;
      return node;
    }
    return same(prev, next) ? undefined : { $: next };
  }
  return same(prev, next) ? undefined : { $: next };
}

/* Applies a patch without mutating prev: changed paths get new objects,
 * unchanged subtrees keep their identity (cheap for 30 Hz renderers). */
export function patch(prev, node) {
  if (node === undefined) return prev;
  if (Object.hasOwn(node, '$')) return node.$;
  if (node.k !== undefined) {
    const list = Array.isArray(prev) ? prev : [];
    const before = new Map(list.map(x => [x?.[node.k], x]));
    let order = node.i;
    if (!order) { const drop = new Set(node.x || []); order = list.map(x => x?.[node.k]).filter(id => !drop.has(id)).concat(node.a || []); }
    return order.map(id => {
      const change = node.u && Object.hasOwn(node.u, id) ? node.u[id] : undefined;
      return patch(before.get(id), change);
    });
  }
  const out = isObj(prev) ? { ...prev } : {};
  if (node.o) for (const k of Object.keys(node.o)) out[k] = patch(out[k], node.o[k]);
  if (node.d) for (const k of node.d) delete out[k];
  return out;
}

/* ---------- binary entity streams ----------
 * schema: { path: 'karts', key: 'pid', fields: [[path, type, scale?], ...] }
 * types: f32, f64, i8, u8, i16, u16, u32 (scaled ints round(v / scale)),
 *        quat (4 x i16 unit quaternion), angle (u16, wraps mod 2 pi),
 *        bits (paths = array of booleans),
 *        list ({count, fields}) for fixed arrays such as wheels. */
const SIZE = { f32: 4, f64: 8, i8: 1, u8: 1, i16: 2, u16: 2, u32: 4, quat: 8, angle: 2, bits: 1 };
const TAU = Math.PI * 2;
const RANGE = { i8: [-128, 127], u8: [0, 255], i16: [-32768, 32767], u16: [0, 65535], u32: [0, 4294967295] };
const split = p => typeof p === 'string' ? p.split('.') : p;
const read = (obj, parts) => { let v = obj; for (const p of parts) { if (v == null) return undefined; v = v[p]; } return v; };
function write(obj, parts, value) {
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { const p = parts[i]; o = (o[p] = isObj(o[p]) || Array.isArray(o[p]) ? o[p] : (/^\d+$/.test(parts[i + 1]) ? [] : {})); }
  o[parts.at(-1)] = value;
}

export function compileSchema(schema) {
  const fields = schema.fields.map(([path, type, scale = 1]) => {
    if (type === 'list') return { type, parts: split(path), count: scale.count, sub: compileSchema({ fields: scale.fields }).fields };
    if (type === 'bits') return { type, paths: path.map(split) };
    if (!SIZE[type]) throw TypeError('unknown field type ' + type);
    return { type, parts: split(path), scale };
  });
  const size = fields.reduce((n, f) => n + (f.type === 'list' ? f.count * f.sub.reduce((m, s) => m + SIZE[s.type], 0) : SIZE[f.type]), 0);
  const roots = [...new Set(fields.map(f => (f.parts || f.paths[0])[0]))];
  return { ...schema, fields, size, roots };
}

function fieldsValid(fields, entity) {
  for (const f of fields) {
    if (f.type === 'list') {
      const list = read(entity, f.parts);
      if (!Array.isArray(list) || list.length !== f.count || !list.every(item => fieldsValid(f.sub, item))) return false;
    } else if (f.type === 'bits') { if (!f.paths.every(p => typeof read(entity, p) === 'boolean')) return false; }
    else if (f.type === 'quat') { const q = read(entity, f.parts); if (!q || ![q.x, q.y, q.z, q.w].every(Number.isFinite)) return false; }
    else if (!Number.isFinite(read(entity, f.parts))) return false;
  }
  return true;
}
export const streamable = (compiled, entity) => fieldsValid(compiled.fields, entity);

function put(view, at, f, v) {
  switch (f.type) {
    case 'f32': view.setFloat32(at, v, true); return;
    case 'f64': view.setFloat64(at, v, true); return;
    case 'angle': { const turn = v / TAU - Math.floor(v / TAU); view.setUint16(at, Math.round(turn * 65536) & 65535, true); return; }
    case 'quat': {
      const n = Math.hypot(v.x, v.y, v.z, v.w) || 1, s = v.w < 0 ? -1 : 1; // q and -q are one rotation
      for (const [i, c] of [v.x, v.y, v.z, v.w].entries()) view.setInt16(at + i * 2, Math.round(s * c / n * 32767), true);
      return;
    }
    default: {
      const [lo, hi] = RANGE[f.type], q = Math.max(lo, Math.min(hi, Math.round(v / f.scale)));
      if (f.type === 'i8') view.setInt8(at, q); else if (f.type === 'u8') view.setUint8(at, q);
      else if (f.type === 'i16') view.setInt16(at, q, true); else if (f.type === 'u16') view.setUint16(at, q, true);
      else view.setUint32(at, q, true);
    }
  }
}
function get(view, at, f) {
  switch (f.type) {
    case 'f32': return view.getFloat32(at, true);
    case 'f64': return view.getFloat64(at, true);
    case 'angle': return view.getUint16(at, true) / 65536 * TAU;
    case 'quat': {
      const q = { x: view.getInt16(at, true) / 32767, y: view.getInt16(at + 2, true) / 32767, z: view.getInt16(at + 4, true) / 32767, w: view.getInt16(at + 6, true) / 32767 };
      const n = Math.hypot(q.x, q.y, q.z, q.w) || 1; return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
    }
    case 'i8': return view.getInt8(at) * f.scale;
    case 'u8': return view.getUint8(at) * f.scale;
    case 'i16': return view.getInt16(at, true) * f.scale;
    case 'u16': return view.getUint16(at, true) * f.scale;
    default: return view.getUint32(at, true) * f.scale;
  }
}

function encodeFields(fields, entity, view, at) {
  for (const f of fields) {
    if (f.type === 'list') { const list = read(entity, f.parts); for (const item of list) at = encodeFields(f.sub, item, view, at); continue; }
    if (f.type === 'bits') { let b = 0; f.paths.forEach((p, i) => { if (read(entity, p)) b |= 1 << i; }); view.setUint8(at, b); at += 1; continue; }
    put(view, at, f, read(entity, f.parts)); at += SIZE[f.type];
  }
  return at;
}
function decodeFields(fields, view, at, into) {
  for (const f of fields) {
    if (f.type === 'list') {
      const list = [];
      for (let i = 0; i < f.count; i++) { const item = {}; at = decodeFields(f.sub, view, at, item); list.push(item); }
      write(into, f.parts, list); continue;
    }
    if (f.type === 'bits') { const b = view.getUint8(at); f.paths.forEach((p, i) => write(into, p, (b & (1 << i)) !== 0)); at += 1; continue; }
    write(into, f.parts, get(view, at, f)); at += SIZE[f.type];
  }
  return at;
}

/* One entity's packed record (without its u16 index), encoded once per tick
 * and shared by every recipient that receives it. */
export function encodeRecord(compiled, entity) {
  const bytes = new Uint8Array(compiled.size);
  encodeFields(compiled.fields, entity, new DataView(bytes.buffer), 0);
  return bytes;
}

/* Entity JSON without the streamed paths. Objects emptied by stripping go. */
export function stripStreamed(compiled, entity) {
  const out = structuredCloneLite(entity);
  const drop = (obj, parts) => {
    if (!isObj(obj)) return;
    if (parts.length === 1) { delete obj[parts[0]]; return; }
    drop(obj[parts[0]], parts.slice(1));
    if (isObj(obj[parts[0]]) && !Object.keys(obj[parts[0]]).length) delete obj[parts[0]];
  };
  for (const f of compiled.fields) for (const parts of f.type === 'bits' ? f.paths : [f.parts]) drop(out, parts);
  return out;
}
function structuredCloneLite(v) {
  if (Array.isArray(v)) return v.map(structuredCloneLite);
  if (!isObj(v)) return v;
  const out = {}; for (const k of Object.keys(v)) out[k] = structuredCloneLite(v[k]); return out;
}

/* Deep merge of decoded stream fields into a stripped JSON entity. */
export function mergeStreamed(entity, fields) {
  const out = { ...entity };
  for (const k of Object.keys(fields)) out[k] = isObj(fields[k]) && isObj(out[k]) ? mergeStreamed(out[k], fields[k]) : fields[k];
  return out;
}

const HEADER = 24;
const encoder = typeof TextEncoder === 'function' ? new TextEncoder() : null;
const decoder = typeof TextDecoder === 'function' ? new TextDecoder() : null;

/* streams: [{index, records: [{entity: u16, bytes: Uint8Array}]}] */
export function encodeFrame({ seq, base = 0, simAt, keyframe, json, jsonText, streams = [] }) {
  const text = encoder.encode(jsonText ?? JSON.stringify(json));
  let size = HEADER + text.length + 1;
  for (const s of streams) { size += 3; for (const r of s.records) size += 2 + r.bytes.length; }
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  bytes[0] = FRAME_MAGIC; bytes[1] = FRAME_VERSION; bytes[2] = keyframe ? 1 : 0; bytes[3] = 0;
  view.setUint32(4, seq >>> 0, true); view.setUint32(8, base >>> 0, true);
  view.setFloat64(12, simAt, true); view.setUint32(20, text.length, true);
  bytes.set(text, HEADER);
  let at = HEADER + text.length; bytes[at++] = streams.length;
  for (const s of streams) {
    bytes[at++] = s.index; view.setUint16(at, s.records.length, true); at += 2;
    for (const r of s.records) { view.setUint16(at, r.entity, true); at += 2; bytes.set(r.bytes, at); at += r.bytes.length; }
  }
  return bytes;
}

export function decodeFrameBytes(buffer, compiledStreams) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[0] !== FRAME_MAGIC || bytes[1] !== FRAME_VERSION) throw TypeError('not a realtime frame');
  const keyframe = (bytes[2] & 1) === 1, seq = view.getUint32(4, true), base = view.getUint32(8, true);
  const simAt = view.getFloat64(12, true), length = view.getUint32(20, true);
  const json = JSON.parse(decoder.decode(bytes.subarray(HEADER, HEADER + length)));
  let at = HEADER + length; const count = bytes[at++], streams = [];
  for (let s = 0; s < count; s++) {
    const index = bytes[at++], n = view.getUint16(at, true); at += 2;
    const compiled = compiledStreams(json, index), records = [];
    if (!compiled) throw TypeError('unknown realtime stream ' + index);
    for (let r = 0; r < n; r++) { const entity = view.getUint16(at, true); at += 2; const fields = {}; at = decodeFields(compiled.fields, view, at, fields); records.push({ entity, fields }); }
    streams.push({ index, records });
  }
  return { keyframe, seq, base, simAt, json, streams };
}
