'use strict';
/* Giggle embed bridge (PartyBox side): verify short-lived HS256 tickets
 * minted by the Giggle backend for squad members.
 *
 * Design (see ARCHITECTURE.md "Giggle embed bridge"):
 * - Giggle server signs {iss, aud, sub, squadId, displayName, jti, iat, exp}
 *   with GAME_BRIDGE_SECRET (HS256, 90s TTL). PartyBox verifies with native
 *   Node crypto — no extra dependency.
 * - Tickets are single-use: each jti is consumed once (bounded replay cache).
 * - A verified squadId maps to a private in-memory room; a verified sub maps
 *   to a stable player seat. Display names never grant seats.
 * - Tickets travel only in WebSocket messages and parent->child postMessage.
 *   They never appear in URLs, localStorage, logs, or /config.json.
 */

const crypto = require('crypto');

const BRIDGE_ISSUER = 'giggle-meet';
const BRIDGE_AUDIENCE = 'game-night';
const BRIDGE_VERSION = 'giggle-v1';
const TICKET_ALG = 'HS256';
const TICKET_TTL_SECONDS = 90;
const MAX_TOKEN_BYTES = 4096;
const MAX_FIELD_CHARS = 128;
const MAX_NAME_CHARS = 64;
const MAX_TEAM_NAME_CHARS = 32;
/* Per-authorization nonce bound (nonsecret): the parent mints a fresh id
 * per auth send; the child carries it in giggleJoin/giggleRenew and the
 * server echoes it in `hello` ONLY after that request's ticket verifies.
 * Mirrors embed.js / the Giggle parent's 128-char bound. */
const MAX_NONCE_CHARS = 128;
const MAX_REPLAY_ENTRIES = 5000;
// Small clock-skew tolerance for iat only; expiry is strict.
const IAT_SKEW_SECONDS = 30;

/* jti -> expMs. Single-use enforcement: a jti that was already consumed is
 * a replay. FAIL CLOSED at capacity: every unexpired consumed jti is kept
 * until its expiry, and new tickets are rejected while the cache is full
 * (entries expire within ~90s, so the window is brief). Evicting unexpired
 * entries would make old tickets reusable — never do that. */
const replayCache = new Map();

function pruneReplay(nowMs) {
  for (const [jti, expMs] of replayCache) {
    if (expMs <= nowMs) replayCache.delete(jti);
  }
}

/* Consume one jti. Returns 'ok' when fresh (and records it), 'replayed'
 * when already consumed, or 'full' when the cache holds MAX unexpired
 * entries (fail closed — the caller rejects the ticket temporarily). The
 * size never exceeds MAX_REPLAY_ENTRIES. */
function consumeJti(jti, expMs, nowMs) {
  pruneReplay(nowMs);
  if (replayCache.has(jti)) return 'replayed';
  if (replayCache.size >= MAX_REPLAY_ENTRIES) return 'full';
  replayCache.set(jti, expMs);
  return 'ok';
}

function b64urlDecode(segment) {
  // Strict base64url: reject padding/hostile chars before decoding.
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error('bad-encoding');
  const padded = segment + '='.repeat((4 - (segment.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isNonEmptyString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

/* Optional signed encounter metadata. Legacy squad tickets omit both fields;
 * a present side must be the canonical issuer's opaque A/B key. */
function teamMetadata(claims = {}) {
  if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return { error: 'bad-fields' };
  const { team, teamName } = claims;
  if (team === undefined) return teamName === undefined ? {} : { error: 'bad-fields' };
  if (team !== 'A' && team !== 'B') return { error: 'bad-fields' };
  if (teamName !== undefined && (typeof teamName !== 'string' || teamName.length > MAX_TEAM_NAME_CHARS)) {
    return { error: 'bad-fields' };
  }
  return { team, teamName: teamName || 'Squad' };
}

/* Validate the WS request's correlation id. Optional for raw-socket
 * compatibility (fixtures joining with ticket-only still verify), but only
 * a validated id is ever echoed — and only in the success `hello`. */
function isValidBridgeNonce(n) {
  return typeof n === 'string' && n.length > 0 && n.length <= MAX_NONCE_CHARS;
}

/* Verify a Giggle game ticket. Returns { claims } on success or { error }
 * with a stable machine code (callers map these to user-safe messages).
 * opts: { secret, nowMs? }. Does NOT consume the jti — use consumeTicket
 * for single-use joins. */
function verifyTicket(token, opts = {}) {
  const secret = opts.secret || '';
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  if (typeof secret !== 'string' || secret.length < 32) return { error: 'bridge-disabled' };
  if (typeof token !== 'string' || token.length === 0 || Buffer.byteLength(token, 'utf8') > MAX_TOKEN_BYTES) {
    return { error: 'bad-shape' };
  }
  const parts = token.split('.');
  if (parts.length !== 3) return { error: 'bad-shape' };
  let header;
  let payload;
  try {
    header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
    payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  } catch {
    return { error: 'bad-shape' };
  }
  if (!header || typeof header !== 'object') return { error: 'bad-shape' };
  // Exact algorithm: only HS256 is accepted (rejects "none" and RSA confusion).
  if (header.alg !== TICKET_ALG) return { error: 'bad-alg' };
  if (header.typ !== undefined && header.typ !== 'JWT') return { error: 'bad-shape' };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { error: 'bad-shape' };

  const { iss, aud, sub, squadId, displayName, jti, iat, exp } = payload;
  if (iss !== BRIDGE_ISSUER) return { error: 'bad-issuer' };
  if (aud !== BRIDGE_AUDIENCE) return { error: 'bad-audience' };
  if (!isNonEmptyString(sub, MAX_FIELD_CHARS)) return { error: 'bad-fields' };
  if (!isNonEmptyString(squadId, MAX_FIELD_CHARS)) return { error: 'bad-fields' };
  if (!isNonEmptyString(jti, MAX_FIELD_CHARS)) return { error: 'bad-fields' };
  if (typeof displayName !== 'string' || displayName.length > MAX_NAME_CHARS) return { error: 'bad-fields' };
  const team = teamMetadata(payload);
  if (team.error) return team;
  if (!Number.isInteger(iat) || !Number.isInteger(exp)) return { error: 'bad-window' };

  // Time window: EXACTLY the 90s contract. exp must be in the future; iat
  // must not be far in the future; the window itself must be <= 90s
  // (rejects forged long TTLs — a 120s ticket is invalid even if signed).
  const nowSec = Math.floor(nowMs / 1000);
  if (exp <= nowSec) return { error: 'expired' };
  if (iat > nowSec + IAT_SKEW_SECONDS) return { error: 'bad-window' };
  if (exp - iat <= 0 || exp - iat > TICKET_TTL_SECONDS) return { error: 'bad-window' };

  const signingInput = `${parts[0]}.${parts[1]}`;
  let signature;
  try {
    signature = b64urlDecode(parts[2]);
  } catch {
    return { error: 'bad-shape' };
  }
  const expected = crypto.createHmac('sha256', secret).update(signingInput).digest();
  if (signature.length !== expected.length) return { error: 'bad-signature' };
  if (!crypto.timingSafeEqual(signature, expected)) return { error: 'bad-signature' };

  return {
    claims: {
      sub, squadId, displayName: displayName || 'Player',
      jti, iat, exp,
      ...team,
    },
  };
}

/* Verify + consume single-use. A ticket that verifies but was already used
 * is rejected as a replay; while the cache is full it is rejected as
 * capacity (fail closed — retry with a fresh ticket once entries expire). */
function consumeTicket(token, opts = {}) {
  const verified = verifyTicket(token, opts);
  if (verified.error) return verified;
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const taken = consumeJti(verified.claims.jti, verified.claims.exp * 1000, nowMs);
  if (taken === 'replayed') return { error: 'replayed' };
  if (taken === 'full') return { error: 'capacity' };
  return verified;
}

function bridgeEnabled(secret) {
  return typeof secret === 'string' && secret.length >= 32;
}

/* Exact allowed parent origins for the Giggle embed, from the
 * comma-separated GIGGLE_ALLOWED_ORIGINS env value. HTTP origins (LAN /
 * Tailnet previews such as http://divyanshs-mac-mini:4012) are accepted
 * only when allowHttp is true — the default follows NODE_ENV (HTTPS only
 * in production). Pass { allowHttp } explicitly in tests. */
function parseAllowedOrigins(raw, opts = {}) {
  const allowHttp = opts.allowHttp !== undefined
    ? !!opts.allowHttp
    : process.env.NODE_ENV !== 'production';
  const out = [];
  for (const piece of String(raw || '').split(',')) {
    const origin = piece.trim().replace(/\/+$/, '');
    if (!origin) continue;
    let url;
    try {
      url = new URL(origin);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (url.protocol === 'http:' && !allowHttp) continue;
    if (url.username || url.password) continue;
    if (url.origin !== origin) continue;
    if (!out.includes(url.origin)) out.push(url.origin);
  }
  return out;
}

/* Non-secret embed facts for the public /config.json: the exact trusted
 * origins plus whether HTTP origins are honored in this environment. */
function allowHttpOrigins(env = process.env) {
  return env.NODE_ENV !== 'production';
}

/* Test-only ticket minter (same HS256 construction the Giggle server uses).
 * Never exposed over HTTP/WS. */
function mintTicket(claims, secret) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: claims.alg || TICKET_ALG, typ: 'JWT' };
  const payload = {
    iss: claims.iss !== undefined ? claims.iss : BRIDGE_ISSUER,
    aud: claims.aud !== undefined ? claims.aud : BRIDGE_AUDIENCE,
    sub: claims.sub || 'user-1',
    squadId: claims.squadId || 'squad-1',
    displayName: claims.displayName !== undefined ? claims.displayName : 'Testy',
    jti: claims.jti || crypto.randomBytes(16).toString('hex'),
    iat: claims.iat !== undefined ? claims.iat : nowSec,
    exp: claims.exp !== undefined ? claims.exp : nowSec + TICKET_TTL_SECONDS,
  };
  const input = `${b64urlEncode(JSON.stringify(header))}.${b64urlEncode(JSON.stringify(payload))}`;
  const sig = b64urlEncode(crypto.createHmac('sha256', secret).update(input).digest());
  return `${input}.${sig}`;
}

function resetBridgeForTests() {
  replayCache.clear();
}

function replayCacheSizeForTests() {
  return replayCache.size;
}

module.exports = {
  BRIDGE_ISSUER,
  BRIDGE_AUDIENCE,
  BRIDGE_VERSION,
  TICKET_ALG,
  TICKET_TTL_SECONDS,
  MAX_NONCE_CHARS,
  MAX_REPLAY_ENTRIES,
  teamMetadata,
  isValidBridgeNonce,
  verifyTicket,
  consumeTicket,
  consumeJti,
  bridgeEnabled,
  parseAllowedOrigins,
  allowHttpOrigins,
  mintTicket,
  resetBridgeForTests,
  replayCacheSizeForTests,
};
