'use strict';
/* PartyBox server: static files + WebSocket rooms. One port, no login.
 * Run: npm start (PORT/HOST env override; binds 0.0.0.0 for LAN/Tailnet).
 *
 * Giggle embed bridge (optional, default-off): when GAME_BRIDGE_SECRET and
 * GIGGLE_ALLOWED_ORIGINS are configured, squad members join private rooms
 * via short-lived tickets (giggleJoin/giggleRenew). Standalone anonymous
 * play always works, with or without the bridge. */

const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');
const { Rooms, validJoinName, SEAT_REMOVED_CODE, SEAT_REMOVED_REASON } = require('./room');
const {
  BRIDGE_VERSION,
  allowHttpOrigins,
  bridgeEnabled,
  consumeTicket,
  isValidBridgeNonce,
  parseAllowedOrigins,
} = require('./bridge');
const registry = require('../games/registry');
const { createReportApi } = require('./reports');
const releaseVersion = require('../package.json').version;
const release = require('../scripts/release-identity').read();

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const LOCALES = path.join(ROOT, 'locales');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

/* Standalone room QR: a bounded SVG for one 4-letter room code, generated
 * locally with the pinned qrcode package (no external service). Encodes
 * only the room share URL — no tickets, credentials, or query echo. */
const QR_CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/; // room code alphabet (no I/L/O/0/1)
const qrCache = new Map(); // "origin|CODE" -> svg (bounded, FIFO)
const QR_CACHE_MAX = 500;

/* Validated PUBLIC_GAME_URL: the exact standalone frontend origin
 * (split-host deployment: https://play.gigglemeet.com on Vercel). Absolute
 * http(s), no credentials/query/hash, canonical origin form — '' when unset
 * or malformed. Drives QR share links AND the standalone WS origin gate
 * (exact match only — never a wildcard or substring). */
function publicGameOrigin() {
  const raw = String(process.env.PUBLIC_GAME_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if ((u.protocol === 'https:' || u.protocol === 'http:') &&
        !u.username && !u.password && !u.search && !u.hash && u.origin === raw) {
      return u.origin;
    }
  } catch { /* malformed: not trusted */ }
  return '';
}

/* Validated PUBLIC_WEBSOCKET_URL: the exact ws(s) endpoint the split-host
 * frontend dials directly (deployment: wss://giggle-play-production.up.
 * railway.app — one Node process, in-memory rooms; never proxied through
 * Vercel). Origin form only (no path/query/hash/credentials); ws: is
 * accepted only where http origins are honored (development). '' when
 * unset or malformed — the client then keeps its legacy same-host socket
 * (local preview, no env changes). Public, non-secret. */
function publicWebsocketUrl() {
  const raw = String(process.env.PUBLIC_WEBSOCKET_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const schemeOk = u.protocol === 'wss:' || (u.protocol === 'ws:' && allowHttpOrigins());
    if (!schemeOk) return '';
    if (u.username || u.password || u.search || u.hash) return '';
    if (u.pathname !== '/' && u.pathname !== '') return '';
    return u.origin;
  } catch { /* malformed: no override */ }
  return '';
}

function qrShareOrigin(req) {
  // Validated PUBLIC_GAME_URL wins (absolute http(s), no creds/query);
  // otherwise the request's own Host, strictly shaped.
  const configured = publicGameOrigin();
  if (configured) return configured;
  const host = String(req.headers.host || '').trim();
  if (!host || host.length > 253) return null;
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) return null;
  const fwd = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const https = (req.socket && req.socket.encrypted) || fwd === 'https';
  return (https ? 'https://' : 'http://') + host.toLowerCase();
}

async function qrSvg(code, origin) {
  const key = origin + '|' + code;
  const hit = qrCache.get(key);
  if (hit) return hit;
  let QR;
  try {
    QR = require('qrcode');
  } catch {
    return null; // dependency unavailable: caller answers 503, client hides
  }
  const svg = await QR.toString(origin + '/r/' + code, { type: 'svg', margin: 1, width: 132 });
  if (typeof svg !== 'string' || !svg.startsWith('<svg') || svg.length > 65536) return null;
  if (qrCache.size >= QR_CACHE_MAX) qrCache.delete(qrCache.keys().next().value);
  qrCache.set(key, svg);
  return svg;
}

function bridgeSecret() {
  return process.env.GAME_BRIDGE_SECRET || '';
}

function giggleOrigins() {
  return parseAllowedOrigins(process.env.GIGGLE_ALLOWED_ORIGINS);
}

/* Additional exact standalone WS frontend origins (split-host DNS window:
 * the stable own production Vercel alias). Parsed with the same secure
 * parseAllowedOrigins as Giggle trust, but used ONLY by wsOriginAllowed
 * alongside PUBLIC_GAME_URL — never iframe parent trust, never exposed
 * in /config.json giggleAllowedOrigins. Deployment holds exactly one:
 * https://giggle-play.vercel.app — never a wildcard or ephemeral preview. */
function standaloneOrigins() {
  return parseAllowedOrigins(process.env.STANDALONE_ALLOWED_ORIGINS);
}

/* Parent authorization lease: bound to the validated ticket's own expiry
 * (claims.exp). Fresh 90s tickets renewed ~every 60s give a 30s margin; a
 * ticket consumed near its expiry buys NO extra time. GIGGLE_LEASE_MS is a
 * test-only override that can only SHORTEN the lease (min with expiry) so
 * the suite proves expiry without waiting — it can never extend
 * authorization past the claimed expiry. */
function leaseExpiresAt(claimsExpSec, nowMs) {
  const expiry = claimsExpSec * 1000;
  const v = Number(process.env.GIGGLE_LEASE_MS);
  if (Number.isFinite(v) && v > 0) return Math.min(expiry, nowMs + v);
  return expiry;
}

function loadContent() {
  const content = {};
  const dir = path.join(LOCALES, 'en');
  if (!fs.existsSync(dir)) return content;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      content[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      console.error('bad locale file', f, e.message);
    }
  }
  return content;
}

const content = loadContent();

/* Lease tracking: socket -> { squadId, sub, expiresAt }. Anonymous sockets
 * have no entry and are unaffected. */
const wsLease = new WeakMap();
const giggleSockets = new Set();

function leaseOk(ws) {
  const lease = wsLease.get(ws);
  return !lease || lease.expiresAt > Date.now();
}

const rooms = new Rooms(content, { roomOpts: { canSend: (ws) => leaseOk(ws) } });

/* Parse the request path safely: a malformed percent-encoding must yield a
 * 400, never an uncaught throw that crashes the process. */
function requestPath(reqUrl) {
  let raw;
  try {
    raw = decodeURIComponent(String(reqUrl || '/').split('?')[0]);
  } catch {
    return { bad: true };
  }
  if (raw === '/') raw = '/index.html';
  // Client-side routes (/r/CODE) all serve the shell.
  if (raw.startsWith('/r/')) raw = '/index.html';
  return { path: raw };
}

/* True only when the normalized file is strictly inside PUBLIC. A raw
 * startsWith check would accept a public-SIBLING prefix (e.g. PUBLIC +
 * "-evil"), so compare the resolved relative path instead. */
function insidePublic(file) {
  const rel = path.relative(PUBLIC, file);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

function frameAncestorsPolicy() {
  // Standalone stays playable (self); the Giggle parent may frame the shell
  // only from its configured exact origins.
  return ['frame-ancestors', "'self'", ...giggleOrigins()].join(' ');
}

const reportApi = createReportApi({
  file: process.env.GAME_REPORT_DB || (process.env.NODE_ENV !== 'production' ? path.join(ROOT, '.data', 'reports.sqlite') : ''),
  token: process.env.GAME_REPORT_ADMIN_TOKEN,
  gameIds: new Set(registry.list().map(game => game.id)),
  catalog: registry.list().map(({ id, name }) => ({ id, name })),
  version: releaseVersion,
  trustRailwayProxy: process.env.GAME_REPORT_TRUST_RAILWAY === '1' && !!process.env.RAILWAY_ENVIRONMENT_ID,
  originAllowed: (origin, req) => {
    if (origin === publicGameOrigin() || standaloneOrigins().includes(origin) || giggleOrigins().includes(origin)) return true;
    const scheme = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:';
    return origin === scheme + '//' + req.headers.host;
  },
});

const server = http.createServer(async (req, res) => {
  const setFraming = () => {
    res.setHeader('Content-Security-Policy', frameAncestorsPolicy());
  };
  const reqPath = String(req.url || '').split('?')[0];
  if (reqPath === '/api/reports' || reqPath.startsWith('/api/reports/')) {
    setFraming();
    await reportApi.handle(req, res);
    return;
  }
  if (req.method === 'GET' && reqPath === '/qr.svg') {
    setFraming();
    // Only the code param is honored; every other query key is ignored
    // (never echoed into the image).
    let code = '';
    try {
      code = new URL(req.url, 'http://x').searchParams.get('code') || '';
    } catch { /* bad */ }
    if (!QR_CODE_RE.test(code)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad code');
      return;
    }
    const origin = qrShareOrigin(req);
    if (!origin) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('bad host');
      return;
    }
    qrSvg(code, origin).then((svg) => {
      if (!svg) {
        res.writeHead(503, { 'Content-Type': 'text/plain' });
        res.end('qr unavailable');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Content-Security-Policy': frameAncestorsPolicy(),
      });
      res.end(svg);
    }).catch(() => {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('qr unavailable');
    });
    return;
  }
  if (req.method === 'GET' && reqPath === '/config.json') {
    setFraming();
    // Public embed facts only: bridge version, allowed origins, and whether
    // HTTP origins are honored in this environment. Never any secret or
    // ticket material. The framed child fetches this to decide trust.
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      ok: true,
      bridgeVersion: BRIDGE_VERSION,
      giggleEnabled: bridgeEnabled(bridgeSecret()),
      giggleAllowedOrigins: giggleOrigins(),
      allowHttp: allowHttpOrigins(),
      // Validated PUBLIC_WEBSOCKET_URL ('' = legacy same-host). The client
      // dials this origin directly; never any secret or ticket material.
      websocketUrl: publicWebsocketUrl(),
      version: releaseVersion,
      release,
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID || null,
      reportingEnabled: reportApi.enabled,
      reportingUrl: publicWebsocketUrl() ? publicWebsocketUrl().replace(/^ws/, 'http') + '/api/reports' : '/api/reports',
    }));
    return;
  }
  const parsed = requestPath(req.url);
  if (parsed.bad) {
    setFraming();
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('bad request');
    return;
  }
  /* Game detail pages: /games/<id>/ (and /games/<id>) resolve to the
   * generated static index. Traversal-safe: single-segment allow-listed
   * ids only — anything else under /games/ falls through to the normal
   * file gate (real files serve, directories and unknown slugs 404). */
  let servePath = path.posix.normalize(parsed.path);
  if (process.env.NODE_ENV === 'production' && /^\/(test|fixtures)(\/|$)/.test(servePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  if (servePath.startsWith('/games/')) {
    const rest = servePath.slice(7).replace(/\/+$/, '');
    if (!rest.includes('/')) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rest) || rest.length < 2 || rest.length > 40) {
        setFraming();
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('not found');
        return;
      }
      servePath = `/games/${rest}/index.html`;
    }
  }
  let file = path.normalize(path.join(PUBLIC, servePath));
  if (insidePublic(file) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!insidePublic(file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    setFraming();
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  setFraming();
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

/* WS origin gate: standalone play (no Origin, or same-host Origin over LAN /
 * Tailnet / localhost) always works; split-host standalone is allowed only
 * from exactly the validated PUBLIC_GAME_URL origin plus the exact
 * STANDALONE_ALLOWED_ORIGINS list (stable own alias while DNS awaits —
 * never a wildcard or ephemeral preview); other cross-origin sockets are
 * allowed only from the configured Giggle origins. */
function wsOriginAllowed(info) {
  const origin = info.origin;
  if (!origin) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = String(info.req.headers.host || '').split(':')[0].toLowerCase();
  if (url.hostname.toLowerCase() === host) return true;
  // Split-host standalone frontend: exactly the validated PUBLIC_GAME_URL
  // origin — never a preview-domain wildcard, substring, or scheme variant.
  const playOrigin = publicGameOrigin();
  if (playOrigin && origin === playOrigin) return true;
  if (standaloneOrigins().includes(url.origin)) return true;
  return giggleOrigins().includes(url.origin);
}

const wss = new WebSocket.Server({
  server,
  // Canonical custom packs fit below 1 MiB even at all four schema limits
  // with JSON escaping. Bound complete messages before parsing any JSON.
  maxPayload: 1024 * 1024,
  verifyClient: (info, done) => {
    if (wsOriginAllowed(info)) done(true);
    else done(false, 403, 'Forbidden');
  },
});
let wsRoom = new WeakMap(); // socket -> Room

/* Detach a socket from its current room (marks its seat away, starts the
 * empty-room prune timer) and clear any Giggle lease. Called BEFORE the
 * socket attaches elsewhere, and only after the new target validated. */
function detach(ws) {
  const room = wsRoom.get(ws);
  if (room) {
    room.disconnect(ws);
    rooms.prune(room);
  }
  wsRoom.delete(ws);
  wsLease.delete(ws);
  giggleSockets.delete(ws);
}

function sendError(ws, msg, code) {
  if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'error', msg, code }));
}

const LEASE_EXPIRED_MSG = 'Session expired — reconnecting…';

function closeForExpiredLease(ws) {
  sendError(ws, LEASE_EXPIRED_MSG, 'LEASE_EXPIRED');
  try { ws.close(); } catch { /* best effort */ }
}

wss.on('connection', (ws) => {
  // ws closes invalid frames with their protocol code. Observe its error
  // so one bad peer cannot crash the authority; never log message contents.
  ws.on('error', (error) => {
    const code = typeof error.code === 'string' && /^WS_ERR_[A-Z0-9_]{1,48}$/.test(error.code)
      ? error.code : 'SOCKET_ERROR';
    console.warn('WebSocket receive error:', code);
  });
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    try {
      handle(ws, msg);
    } catch (e) {
      console.error('handle error', e);
      ws.send(JSON.stringify({ t: 'error', msg: 'Something broke. Try again.' }));
    }
  });
  ws.on('close', () => {
    detach(ws);
  });
});

/* Expired leases stop receiving room data at once (canSend gate) and are
 * disconnected here within seconds, until freshly authorized. The lease
 * ends at the ticket's own expiry; the parent renews ~every 60s, so
 * Giggle-side removal/age/account/block changes take effect within ~90s. */
setInterval(() => {
  for (const ws of giggleSockets) {
    if (!leaseOk(ws)) {
      if (ws.readyState === 1) closeForExpiredLease(ws);
      else detach(ws);
    }
  }
}, 5000);

const TICKET_FAILURE_MSG = 'Could not join the squad game. Try again.';

function handleGiggleJoin(ws, msg) {
  if (!bridgeEnabled(bridgeSecret())) {
    sendError(ws, 'Squad games are unavailable right now.', 'GIGGLE_DISABLED');
    return;
  }
  if (typeof msg.ticket !== 'string' || !msg.ticket) {
    sendError(ws, TICKET_FAILURE_MSG, 'TICKET_INVALID');
    return;
  }
  // Single-use ticket: verify signature/issuer/audience/window, then consume.
  // NEVER log the ticket.
  const verdict = consumeTicket(msg.ticket, { secret: bridgeSecret() });
  if (verdict.error) {
    const code = verdict.error === 'expired' ? 'TICKET_EXPIRED'
      : verdict.error === 'replayed' ? 'TICKET_REPLAYED'
      : verdict.error === 'capacity' ? 'TICKET_CAPACITY'
      : 'TICKET_INVALID';
    sendError(ws, TICKET_FAILURE_MSG, code);
    return;
  }
  const { sub, squadId, displayName, exp, team, teamName } = verdict.claims;
  const room = rooms.getOrCreateGiggle(squadId);
  // Preflight BEFORE touching the current attachment: joining a full room
  // must leave the socket's current room/host intact.
  const pre = room.preflightGiggle(sub);
  if (pre.error) {
    sendError(ws, pre.error, pre.code || 'ROOM_FULL');
    // An away seat cannot receive the original kick close. Its attempted
    // resume must retire the client too; preserve any valid other room.
    if (pre.code === 'REMOVED_FROM_ROOM' && !wsRoom.has(ws)) ws.close(SEAT_REMOVED_CODE, SEAT_REMOVED_REASON);
    rooms.prune(room);
    return;
  }
  const current = wsRoom.get(ws);
  if (current !== room) {
    // Target validated (fresh verified ticket): detach from any previous
    // room BEFORE attaching, so a moved socket never lingers in two rooms.
    detach(ws);
  } else {
    // Same room, same socket, NEW verified sub: detach the old seat BEFORE
    // attaching, or one socket would own two seats (double recipients and
    // actions). Same sub renews resume exactly below; the lease is replaced
    // after attach.
    const existing = room.bySocket(ws);
    if (existing && existing.giggleSub !== sub) room.disconnect(ws);
  }
  ws.kartEventDeltas = msg.kartEvents === 'delta-v1';
  const r = room.addGigglePlayer(sub, displayName, ws, { team, teamName });
  if (r.error) {
    sendError(ws, r.error, r.code || 'ROOM_FULL');
    return;
  }
  wsRoom.set(ws, room);
  // The lease ends at the ticket's own expiry — never past claims.exp.
  wsLease.set(ws, { squadId, sub, expiresAt: leaseExpiresAt(exp, Date.now()) });
  giggleSockets.add(ws);
  // No seatToken: Giggle seats resume only via fresh tickets, so an expired
  // identity can never fall back to a legacy resume token and bypass the
  // bridge. First present player hosts (standard longest-seated election);
  // the game host is separate from Giggle moderation/leader permissions.
  // Freshness correlation: echo the request's nonce ONLY here, after its
  // ticket verified and the seat attached — never on any error path, never
  // for an invalid id. The child echoes this in `authed`.
  const echo = isValidBridgeNonce(msg.n) ? { n: msg.n } : {};
  ws.send(JSON.stringify({
    t: 'hello', you: r.player.id, name: r.player.name, code: room.code, giggle: true, ...echo,
  }));
  room.broadcastLobby();
  if (room.game) room.broadcastState();
}

/* Private actions need an unexpired lease on Giggle sockets. Anonymous
 * sockets (no lease entry) are unaffected. */
function leaseAllows(ws) {
  if (leaseOk(ws)) return true;
  closeForExpiredLease(ws);
  return false;
}

function handle(ws, msg) {
  if (ws.readyState !== 1) return;
  switch (msg.t) {
    case 'giggleJoin':
    case 'giggleRenew': {
      handleGiggleJoin(ws, msg);
      break;
    }
    case 'create': {
      // Validate the name BEFORE creating a room or detaching: a malformed
      // name object must neither leak a room nor disturb the current one.
      if (!validJoinName(msg.name)) {
        ws.send(JSON.stringify({ t: 'error', msg: 'Pick a name first.' }));
        return;
      }
      const room = rooms.create();
      // Fresh rooms cannot fail validation; detach first so a moved socket
      // leaves its old room (host migrates, old room prunes when empty).
      detach(ws);
      ws.kartEventDeltas = msg.kartEvents === 'delta-v1';
      const r = room.addPlayer(msg.name, ws, msg.seatToken);
      if (r.error) {
        ws.send(JSON.stringify({ t: 'error', msg: r.error }));
        rooms.prune(room);
        return;
      }
      wsRoom.set(ws, room);
      ws.send(JSON.stringify({
        t: 'hello', you: r.player.id, name: r.player.name,
        seatToken: r.player.token, code: room.code,
      }));
      room.broadcastLobby();
      break;
    }
    case 'join': {
      // Validate the target FIRST: a failed join must not disturb the
      // socket's current room. Giggle rooms reject anonymous joins outright.
      // The code must be a plain string (a hostile object would make the
      // lookup's String() throw).
      if (typeof msg.code !== 'string' || !msg.code) {
        ws.send(JSON.stringify({ t: 'error', msg: 'Room not found. Check the code.' }));
        return;
      }
      const room = rooms.get(msg.code);
      if (!room || room.giggle) {
        ws.send(JSON.stringify({ t: 'error', msg: 'Room not found. Check the code.' }));
        return;
      }
      if (!validJoinName(msg.name)) {
        ws.send(JSON.stringify({ t: 'error', msg: 'Pick a name first.' }));
        return;
      }
      ws.kartEventDeltas = msg.kartEvents === 'delta-v1';
      // Same-room rejoin without a token is idempotent: reuse the attached
      // seat instead of minting a duplicate.
      if (wsRoom.get(ws) === room && !msg.seatToken) {
        const existing = room.bySocket(ws);
        if (existing && existing.connected) {
          ws.send(JSON.stringify({
            t: 'hello', you: existing.id, name: existing.name,
            seatToken: existing.token, code: room.code,
          }));
          room.broadcastLobby();
          if (room.game) room.broadcastState();
          return;
        }
      }
      // Capacity/resume preflight BEFORE detaching: a full target room (or
      // a same-room invalid token with no space) leaves the current
      // room/host/seat exactly as it was.
      const pre = room.preflightAdd(msg.seatToken);
      if (pre.error) {
        sendError(ws, pre.error, pre.code);
        if (pre.code === 'REMOVED_FROM_ROOM' && !wsRoom.has(ws)) ws.close(SEAT_REMOVED_CODE, SEAT_REMOVED_REASON);
        return;
      }
      detach(ws);
      const r = room.addPlayer(msg.name, ws, msg.seatToken);
      if (r.error) {
        ws.send(JSON.stringify({ t: 'error', msg: r.error }));
        return;
      }
      wsRoom.set(ws, room);
      ws.send(JSON.stringify({
        t: 'hello', you: r.player.id, name: r.player.name,
        seatToken: r.player.token, code: room.code,
      }));
      room.broadcastLobby();
      if (room.game) room.broadcastState();
      break;
    }
    case 'configure': {
      if (!leaseAllows(ws)) return;
      const requestId = msg.requestId;
      if (requestId !== undefined && (typeof requestId !== 'string' || !/^[\w-]{1,80}$/.test(requestId))) {
        ws.send(JSON.stringify({ t: 'error', msg: 'Invalid settings request.' }));
        return;
      }
      const room = wsRoom.get(ws);
      const me = room && room.bySocket(ws);
      const def = room && registry.get(msg.game);
      if (!room || !me || !def) return;
      const replyError = message => ws.send(JSON.stringify({ t: 'error', msg: message, game: def.id, ...(requestId ? { requestId } : {}) }));
      if (!room.canControl(me.id)) {
        replyError('Only the host can change settings.');
        return;
      }
      let r;
      if (msg.reset) r = room.resetConfig(def.id);
      else r = room.configure(def.id, def, msg.settings, msg.pack);
      if (r.error) replyError(r.error);
      else {
        room.broadcastLobby();
        // Private, correlated completion: an unrelated roster broadcast or
        // equal-size word list cannot confirm a settings request.
        if (requestId) ws.send(JSON.stringify({ t: 'configured', game: def.id, requestId }));
      }
      break;
    }
    case 'start': {
      if (!leaseAllows(ws)) return;
      const room = wsRoom.get(ws);
      const me = room && room.bySocket(ws);
      const def = room && registry.get(msg.game);
      if (!room || !me || !def) return;
      const r = room.startGame(def, { settings: msg.settings, pack: msg.pack, ready: msg.ready === true }, me.id);
      if (r.error) ws.send(JSON.stringify({ t: 'error', msg: r.error }));
      break;
    }
    case 'action': {
      if (!leaseAllows(ws)) return;
      const room = wsRoom.get(ws);
      if (room) room.onAction(ws, msg.a, { i: msg.i, w: msg.w });
      break;
    }
    case 'game-ready': {
      if (!leaseAllows(ws)) return;
      const room = wsRoom.get(ws);
      if (room) room.onReady(ws, { i: msg.i, w: msg.w });
      break;
    }
    case 'lobby': {
      if (!leaseAllows(ws)) return;
      const room = wsRoom.get(ws);
      const me = room && room.bySocket(ws);
      if (!room || !me) return;
      const r = room.endGameToLobby(me.id);
      if (r.error) ws.send(JSON.stringify({ t: 'error', msg: r.error }));
      break;
    }
    case 'end': {
      // Host "End game": final scores now, then Rematch / Change game.
      if (!leaseAllows(ws)) return;
      const room = wsRoom.get(ws);
      const me = room && room.bySocket(ws);
      if (!room || !me) return;
      const r = room.endGame(me.id);
      if (r.error) ws.send(JSON.stringify({ t: 'error', msg: r.error }));
      break;
    }
    case 'leave': {
      // "Leave" (anyone). Standalone: the seat is given up and the socket
      // detaches (the client then goes home). Giggle: the seat leaves the
      // running match but stays in the call's room (back to the picker).
      const room = wsRoom.get(ws);
      if (!room) return;
      const r = room.leave(ws, { stay: msg.stay === true });
      if (r.error) return;
      if (r.removed) {
        wsRoom.delete(ws);
        wsLease.delete(ws);
        giggleSockets.delete(ws);
        rooms.prune(room);
      }
      ws.send(JSON.stringify({ t: 'left', removed: !!r.removed }));
      break;
    }
    case 'kick': {
      if (!leaseAllows(ws)) return;
      const room = wsRoom.get(ws);
      if (!room) return;
      const requestId = typeof msg.requestId === 'string' && /^[\w-]{1,80}$/.test(msg.requestId) ? msg.requestId : undefined;
      const r = room.kickPlayer(ws, msg.pid, { i: msg.i });
      if (r.error) ws.send(JSON.stringify({ t: 'error', msg: r.error, code: 'KICK_REJECTED', requestId }));
      else {
        if (r.socket) { wsRoom.delete(r.socket); wsLease.delete(r.socket); giggleSockets.delete(r.socket); }
        ws.send(JSON.stringify({ t: 'kicked', pid: r.pid, ended: r.ended, requestId }));
      }
      break;
    }
    case 'games': {
      ws.send(JSON.stringify({ t: 'games', games: registry.list() }));
      break;
    }
    case 'clock': {
      // Bounded string id in, same id + server time out. No room access,
      // no lease gate — just the time, so uncalibrated clients (and
      // pre-join sockets) can anchor. Anything else gets no answer.
      if (typeof msg.id === 'string' && msg.id.length >= 1 && msg.id.length <= 128) {
        if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'clock', id: msg.id, serverNow: Date.now() }));
      }
      break;
    }
  }
}

const PORT = Number(process.env.PORT || 8123);
const HOST = process.env.HOST || '0.0.0.0';

async function startServer() {
  // Registry discovery and legacy create remain synchronous. Network starts
  // wait for the pinned WASM/config/maps; failed init disables only new maps.
  try { await registry.get('pocket-karts').initialize(); }
  catch (e) { console.error('Elevated arenas unavailable:', e.message); }
  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.rooms.values()) room.onTick(now);
  }, 25);
  server.listen(PORT, HOST, () => {
    console.log(`PartyBox on http://${HOST}:${PORT} (${registry.list().length} games)`);
  });
}
startServer();
