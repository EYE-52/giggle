'use strict';
/* Game Kit shared validation: manifests, room settings, custom packs.
 * Single source of truth for bounds so room.js, registry.js and
 * scripts/check-game.js cannot drift. No dependencies, no I/O. */

const LIMITS = {
  ROOM_CAP: 24, // max seats (connected + disconnected) per room
  ROOM_GRACE_MS: 120000, // keep an emptied room briefly so a refresh can resume
  MAX_SETTINGS_KEYS: 16,
  MAX_PACK_KEYS: 4,
  MAX_PACK_ITEMS: 200,
  MAX_ITEM_LEN: 140,
  MAX_PACK_BYTES: 65536, // per pack key, UTF-8 bytes
  MAX_ID_LEN: 40,
};

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isValidId(id) {
  return typeof id === 'string' && id.length >= 2 && id.length <= LIMITS.MAX_ID_LEN && ID_RE.test(id);
}

function isInt(n) {
  return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n);
}

/* Player range always comes from the definition. Manifest wins when valid,
 * legacy minPlayers/maxPlayers are the fallback for existing games. */
function manifestPlayers(def) {
  const m = (def && def.manifest && def.manifest.players) || {};
  let min = isInt(m.min) ? m.min : def.minPlayers;
  let max = isInt(m.max) ? m.max : def.maxPlayers;
  if (!isInt(min) || min < 1) min = 2;
  if (!isInt(max) || max < min) max = Math.max(min, 2);
  min = Math.min(min, LIMITS.ROOM_CAP);
  max = Math.min(max, LIMITS.ROOM_CAP);
  if (max < min) max = min;
  return { min, max };
}

/* Active-seat cap from the manifest, or null when the whole roster plays.
 * Ordinary all-player party games have no seats key and keep exact legacy
 * behavior (every roster seat is active). */
function manifestSeats(def) {
  const s = def && def.manifest && def.manifest.seats;
  if (s === undefined) return null;
  if (!isInt(s) || s < 1 || s > LIMITS.ROOM_CAP) return null;
  return s;
}

/* The active roster: the first `seats` roster ids in stable roster order,
 * or the whole roster when the game has no seat cap. */
function activeIds(roster, def) {
  const seats = manifestSeats(def);
  if (seats === null) return (roster || []).slice();
  return (roster || []).slice(0, seats);
}

/* Validate an optional manifest. Returns {ok:true} or {ok:false,error}. */
/* The rules standard's shared settings: same key → same label and values.
 * Returns an error string, or '' when the setting is fine. */
const SHARED_ENUMS = {
  pace: { label: 'Pace', options: ['Relaxed', 'Normal', 'Quick'] },
  moveTimer: { label: 'Move timer', options: ['Off', '30 seconds', '60 seconds'] },
};
function sharedSettingError(s) {
  if (s.key === 'rounds') {
    if (s.type !== 'int' || s.label !== 'Rounds' || s.min < 1) return 'Setting rounds: use roundsSetting() (label "Rounds", int, min 1).';
    return '';
  }
  const want = Object.prototype.hasOwnProperty.call(SHARED_ENUMS, s.key) ? SHARED_ENUMS[s.key] : null;
  if (!want) return '';
  if (s.type !== 'enum' || s.label !== want.label || !Array.isArray(s.options) ||
      s.options.length !== want.options.length || s.options.some((o, i) => o !== want.options[i])) {
    return `Setting ${s.key}: use the shared helper from games/_sdk.js (label "${want.label}", options ${want.options.join(' / ')}).`;
  }
  return '';
}

function validateManifest(def) {
  if (!def || typeof def !== 'object') return { ok: false, error: 'Game definition must export an object.' };
  if (!isValidId(def.id)) return { ok: false, error: `Bad game id ${JSON.stringify(def.id)}.` };
  const m = def.manifest;
  if (m === undefined) return { ok: true };
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, error: 'manifest must be an object.' };
  if (m.name !== undefined && typeof m.name !== 'string') return { ok: false, error: 'manifest.name must be a string.' };
  if (m.tagline !== undefined && typeof m.tagline !== 'string') return { ok: false, error: 'manifest.tagline must be a string.' };
  if (m.howto !== undefined && typeof m.howto !== 'string') return { ok: false, error: 'manifest.howto must be a string.' };
  if (m.cat !== undefined && typeof m.cat !== 'string') return { ok: false, error: 'manifest.cat must be a string.' };
  if (m.renderer !== undefined && (typeof m.renderer !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(m.renderer))) {
    return { ok: false, error: 'manifest.renderer must be a short technology label (e.g. dom, canvas, 3d, webgpu, wasm).' };
  }
  // Rendering technology and platform chrome are separate choices. An
  // immersive view owns its HUD/style; room controls remain reachable.
  if (m.layout !== undefined && !['standard', 'immersive'].includes(m.layout)) {
    return { ok: false, error: 'manifest.layout must be standard or immersive.' };
  }
  if (m.homepage !== undefined && typeof m.homepage !== 'boolean') {
    return { ok: false, error: 'manifest.homepage must be a boolean.' };
  }
  if (m.runtime !== undefined) {
    const r = m.runtime;
    if (!r || !['module', 'frame'].includes(r.type)) {
      return { ok: false, error: 'manifest.runtime.type must be module or frame.' };
    }
    if (r.type === 'frame' && (typeof r.entry !== 'string' || r.entry.length > 160 || !r.entry.endsWith('.html') ||
        !r.entry.split('/').every(p => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(p) && p !== '.' && p !== '..'))) {
      return { ok: false, error: 'manifest.runtime needs type: frame and a safe relative HTML entry under the game browser directory.' };
    }
    if (r.type === 'module' && r.entry !== undefined) {
      return { ok: false, error: 'Module games use the registered view; runtime.entry is only for frames.' };
    }
    if (r.waitForResult !== undefined && typeof r.waitForResult !== 'boolean') {
      return { ok: false, error: 'manifest.runtime.waitForResult must be a boolean.' };
    }
  }
  /* Active-seat cap (chess-style): only the first `seats` roster seats play;
   * other connected members are watchers (watch-only, like late joiners).
   * Lets a 4-person party play chess (2 active) without implying 24 players. */
  if (m.seats !== undefined) {
    if (!isInt(m.seats) || m.seats < 1 || m.seats > LIMITS.ROOM_CAP) {
      return { ok: false, error: `manifest.seats must be an integer 1..${LIMITS.ROOM_CAP}.` };
    }
    const pmax = (m.players && isInt(m.players.max)) ? m.players.max : null;
    if (pmax !== null && m.seats > pmax) {
      return { ok: false, error: 'manifest.seats cannot exceed manifest.players.max.' };
    }
  }
  /* Communication hint for the catalog: which games shine on a call. A hint
   * only — never a requirement, and only set it when genuinely true. */
  if (m.communication !== undefined && !['any', 'voice', 'video'].includes(m.communication)) {
    return { ok: false, error: 'manifest.communication must be any, voice or video.' };
  }
  /* Self-authored thumbnail: a safe local path under img/games/ only.
   * No URLs, no parent traversal, svg/png only. */
  if (m.art !== undefined) {
    if (typeof m.art !== 'string' || !/^img\/games\/[a-z0-9-]+\.(svg|png)$/.test(m.art)) {
      return { ok: false, error: 'manifest.art must be a safe local path like img/games/<id>.svg.' };
    }
  }
  if (m.players !== undefined) {
    if (!m.players || typeof m.players !== 'object') return { ok: false, error: 'manifest.players must be {min,max}.' };
    if (!isInt(m.players.min) || !isInt(m.players.max)) return { ok: false, error: 'manifest.players min/max must be integers.' };
    if (m.players.min < 1 || m.players.max < m.players.min || m.players.max > LIMITS.ROOM_CAP) {
      return { ok: false, error: `manifest.players out of range 1..${LIMITS.ROOM_CAP}.` };
    }
  }
  if (m.settings !== undefined) {
    if (!Array.isArray(m.settings)) return { ok: false, error: 'manifest.settings must be an array.' };
    if (m.settings.length > LIMITS.MAX_SETTINGS_KEYS) return { ok: false, error: 'manifest.settings has too many entries.' };
    const seen = new Set();
    for (const s of m.settings) {
      if (!s || typeof s !== 'object') return { ok: false, error: 'manifest.settings entries must be objects.' };
      if (typeof s.key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(s.key)) {
        return { ok: false, error: `Bad setting key ${JSON.stringify(s.key)}.` };
      }
      if (seen.has(s.key)) return { ok: false, error: `Duplicate setting key ${s.key}.` };
      seen.add(s.key);
      if (!['int', 'enum', 'bool'].includes(s.type)) return { ok: false, error: `Setting ${s.key}: bad type.` };
      if (s.type === 'int') {
        if (!isInt(s.min) || !isInt(s.max) || s.max < s.min) return { ok: false, error: `Setting ${s.key}: bad int range.` };
        if (!(isInt(s.def) || s.def === null)) return { ok: false, error: `Setting ${s.key}: def must be an int or null (auto).` };
        if (isInt(s.def) && (s.def < s.min || s.def > s.max)) return { ok: false, error: `Setting ${s.key}: def outside range.` };
      } else if (s.type === 'enum') {
        if (!Array.isArray(s.options) || !s.options.length || s.options.length > 24) {
          return { ok: false, error: `Setting ${s.key}: options must be 1..24 strings.` };
        }
        for (const o of s.options) {
          if (typeof o !== 'string' || !o || o.length > 40) return { ok: false, error: `Setting ${s.key}: bad enum option.` };
        }
        if (!s.options.includes(s.def)) return { ok: false, error: `Setting ${s.key}: def must be one of options.` };
      } else {
        if (typeof s.def !== 'boolean') return { ok: false, error: `Setting ${s.key}: bool def must be true/false.` };
      }
      // Shared settings keep one shape and label in every game
      // (games/_sdk.js roundsSetting / paceSetting / moveTimerSetting).
      const shared = sharedSettingError(s);
      if (shared) return { ok: false, error: shared };
    }
  }
  if (m.packs !== undefined) {
    if (!m.packs || typeof m.packs !== 'object' || Array.isArray(m.packs)) {
      return { ok: false, error: 'manifest.packs must be an object keyed by pack name.' };
    }
    const keys = Object.keys(m.packs);
    if (keys.length > LIMITS.MAX_PACK_KEYS) return { ok: false, error: 'manifest.packs has too many keys.' };
    for (const k of keys) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k)) return { ok: false, error: `Bad pack key ${JSON.stringify(k)}.` };
      const p = m.packs[k];
      if (!p || typeof p !== 'object') return { ok: false, error: `Pack ${k}: must be an object.` };
      if (p.type !== 'string[]') return { ok: false, error: `Pack ${k}: only type "string[]" is supported.` };
      const minItems = p.minItems === undefined ? 1 : p.minItems;
      const maxItems = p.maxItems === undefined ? LIMITS.MAX_PACK_ITEMS : p.maxItems;
      const maxLen = p.maxLen === undefined ? LIMITS.MAX_ITEM_LEN : p.maxLen;
      const maxBytes = p.maxBytes === undefined ? LIMITS.MAX_PACK_BYTES : p.maxBytes;
      if (!isInt(minItems) || !isInt(maxItems) || minItems < 1 || maxItems < minItems || maxItems > LIMITS.MAX_PACK_ITEMS) {
        return { ok: false, error: `Pack ${k}: bad minItems/maxItems.` };
      }
      if (!isInt(maxLen) || maxLen < 1 || maxLen > LIMITS.MAX_ITEM_LEN) return { ok: false, error: `Pack ${k}: bad maxLen.` };
      if (!isInt(maxBytes) || maxBytes < 256 || maxBytes > LIMITS.MAX_PACK_BYTES) {
        return { ok: false, error: `Pack ${k}: bad maxBytes.` };
      }
    }
  }
  return { ok: true };
}

/* Editor starting points: manifest defs. Games must NOT treat these as
 * active configuration — ctx.settings() returns only host-set values so
 * legacy dynamic defaults (e.g. rounds from player count) survive. */
function defaultSettings(def) {
  const out = {};
  const list = (def && def.manifest && def.manifest.settings) || [];
  for (const s of list) out[s.key] = s.def;
  return out;
}

/* Validate a host settings object. Unknown keys are rejected; invalid
 * values fail the whole object with no partial mutation (caller keeps
 * the previous config). Returns {ok:true,settings} or {ok:false,error}. */
function validateSettings(def, input) {
  const schema = (def && def.manifest && def.manifest.settings) || [];
  if (input === undefined) return { ok: true, settings: {} };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Settings must be an object.' };
  }
  const byKey = Object.create(null);
  for (const s of schema) byKey[s.key] = s;
  const out = {};
  for (const k of Object.keys(input)) {
    // Own-property lookup: user keys like "constructor"/"toString" must
    // never match Object.prototype members (parsed JSON keeps them own).
    const s = Object.prototype.hasOwnProperty.call(byKey, k) ? byKey[k] : undefined;
    if (!s) return { ok: false, error: `Unknown setting "${k}".` };
    const v = input[k];
    if (s.type === 'int') {
      if (v === null && s.def === null) {
        out[k] = null; // explicit auto
        continue;
      }
      if (!isInt(v)) return { ok: false, error: `Setting "${k}" must be an integer.` };
      if (v < s.min || v > s.max) return { ok: false, error: `Setting "${k}" must be ${s.min}..${s.max}.` };
      out[k] = v;
    } else if (s.type === 'enum') {
      if (typeof v !== 'string' || !s.options.includes(v)) {
        return { ok: false, error: `Setting "${k}" must be one of: ${s.options.join(', ')}.` };
      }
      out[k] = v;
    } else {
      if (typeof v !== 'boolean') return { ok: false, error: `Setting "${k}" must be true or false.` };
      out[k] = v;
    }
  }
  return { ok: true, settings: out };
}

/* Validate a custom content pack. Same all-or-nothing rule: the returned
 * pack is fully cleaned (trimmed, empties dropped) or an error is
 * returned and the caller must keep the previous pack. */
function validatePack(def, input) {
  const schema = (def && def.manifest && def.manifest.packs) || {};
  if (input === undefined) return { ok: true, pack: {} };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Pack must be an object.' };
  }
  const out = {};
  for (const k of Object.keys(input)) {
    // Own-property lookup so "constructor"/"__proto__" never match heritage.
    const rule = Object.prototype.hasOwnProperty.call(schema, k) ? schema[k] : undefined;
    if (!rule) return { ok: false, error: `Unknown pack "${k}".` };
    const raw = input[k];
    if (!Array.isArray(raw)) return { ok: false, error: `Pack "${k}" must be an array of strings.` };
    const minItems = rule.minItems === undefined ? 1 : rule.minItems;
    const maxItems = rule.maxItems === undefined ? LIMITS.MAX_PACK_ITEMS : rule.maxItems;
    const maxLen = rule.maxLen === undefined ? LIMITS.MAX_ITEM_LEN : rule.maxLen;
    const maxBytes = rule.maxBytes === undefined ? LIMITS.MAX_PACK_BYTES : rule.maxBytes;
    const cleaned = [];
    for (const item of raw) {
      if (typeof item !== 'string') return { ok: false, error: `Pack "${k}" must contain only strings.` };
      const t = item.trim().replace(/\s+/g, ' ');
      if (t) cleaned.push(t);
    }
    if (cleaned.length < minItems) return { ok: false, error: `Pack "${k}" needs at least ${minItems} items.` };
    if (cleaned.length > maxItems) return { ok: false, error: `Pack "${k}" allows at most ${maxItems} items.` };
    let bytes = 0;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i].length > maxLen) return { ok: false, error: `Pack "${k}" item ${i + 1} is too long (max ${maxLen}).` };
      bytes += Buffer.byteLength(cleaned[i], 'utf8');
      if (bytes > maxBytes) return { ok: false, error: `Pack "${k}" exceeds ${maxBytes} bytes.` };
    }
    out[k] = cleaned;
  }
  return { ok: true, pack: out };
}

/* Public metadata: item counts only. Pack CONTENTS must never leave the
 * server except through a game's own per-player view(). */
function packCounts(pack) {
  const out = {};
  for (const k of Object.keys(pack || {})) out[k] = (pack[k] || []).length;
  return out;
}

/* Sanitized schema for the games list / lobby editor. No contents. */
function clientSchema(def) {
  const m = (def && def.manifest) || {};
  return {
    settings: (m.settings || []).map((s) => ({
      key: s.key, label: s.label || s.key, type: s.type,
      min: s.min, max: s.max, options: s.options, def: s.def,
      autoLabel: s.autoLabel,
    })),
    packs: Object.keys(m.packs || {}).map((k) => ({
      key: k, label: (m.packs[k] || {}).label || k,
      minItems: m.packs[k].minItems, maxItems: m.packs[k].maxItems,
      maxLen: m.packs[k].maxLen,
    })),
  };
}

module.exports = {
  LIMITS, isValidId, manifestPlayers, manifestSeats, activeIds, validateManifest,
  defaultSettings, validateSettings, validatePack, packCounts, clientSchema,
};
