/* Giggle embed adapter (child side, postMessage protocol v1).
 *
 * The Giggle lobby frames Game Night in an iframe. Auth and context cross
 * the frame boundary over postMessage; the game ticket itself travels only
 * here and in the Game Night WebSocket — never in URLs, storage, or logs.
 *
 * Child -> parent: ready {v}, auth-needed {v}, authed {v, n},
 *   state {v, game, players, watchers?, presentation?}
 * Parent -> child: auth {v, ticket, n}, context {v, theme?}
 *
 * `authed` is the verified authorization acknowledgment: the child posts it
 * only after the server accepts a ticket (Giggle hello on its socket),
 * echoing the server's echo of the parent's per-authorization nonce `n`.
 * The parent promotes loading to live only after an ack that echoes its
 * LATEST pending nonce — a posted ticket, a stale/older ack, or a stale
 * state snapshot is never enough. The nonce is nonsecret and bounded
 * (1..128 chars); tickets still never appear in acks, logs, URLs, or
 * storage.
 *
 * Security: BOTH sides enforce the exact configured origin and the exact
 * event.source (child: window.parent; parent: iframe.contentWindow).
 * No '*', no accepting messages from unrelated same-origin frames.
 *
 * Pure helpers are node-importable (no window access at module scope) so
 * the bridge test suite can exercise validation without a browser.
 */

export const EMBED_VERSION = 1;
export const EMBED_QUERY_KEY = 'embed';
export const PARENT_ORIGIN_QUERY_KEY = 'parentOrigin';

const CHILD_INCOMING = new Set(['auth', 'context']);
const MAX_TICKET_CHARS = 4096;
/* Per-authorization nonce bound: nonsecret, but a hostile value must not
 * grow the protocol. Mirrors the parent's MAX_NONCE_CHARS. */
const MAX_NONCE_CHARS = 128;
/* PartyBox theme ids the parent is allowed to request. Day/night are the
 * two current looks; the four pre-D7 ids stay accepted as aliases and map
 * to them in app.js (setTheme), so an older parent never breaks the child. */
const KNOWN_THEMES = new Set(['day', 'night', 'dark', 'light', 'arcade', 'lounge']);

/* Shape-check a claimed parent origin: absolute http(s) URL, exact origin
 * form, no credentials/query/hash. This says NOTHING about trust — any
 * well-formed http host (LAN/Tailnet previews included) passes the shape,
 * and trust is decided by isTrustedParentOrigin against the server's
 * configured origins (fetched from public /config.json). */
export function isValidParentOrigin(origin) {
  if (typeof origin !== 'string' || !origin) return false;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password) return false;
  if (url.origin !== origin) return false;
  return true;
}

/* Trust check: the parent origin must be EXACTLY one of the server's
 * configured GIGGLE_ALLOWED_ORIGINS, and http origins are honored only
 * when the server allows them (development; never production). Never
 * trust an arbitrary parentOrigin query value on shape alone. */
export function isTrustedParentOrigin(origin, allowedOrigins, allowHttp) {
  if (!isValidParentOrigin(origin)) return false;
  if (!Array.isArray(allowedOrigins) || !allowedOrigins.includes(origin)) return false;
  if (origin.startsWith('https://')) return true;
  return origin.startsWith('http://') && allowHttp === true;
}

/* Parse the shell's own query string. Embed mode needs BOTH embed=1 and a
 * well-formed parentOrigin; anything else is standalone mode. The app
 * confirms trust via isTrustedParentOrigin (against /config.json) before
 * it sends ready/auth messages. */
export function parseEmbedParams(search) {
  const params = new URLSearchParams(String(search || ''));
  if (params.get(EMBED_QUERY_KEY) !== '1') return { enabled: false, parentOrigin: '' };
  const parentOrigin = params.get(PARENT_ORIGIN_QUERY_KEY) || '';
  if (!isValidParentOrigin(parentOrigin)) return { enabled: false, parentOrigin: '' };
  return { enabled: true, parentOrigin };
}

/* Per-authorization nonce validation (nonsecret, bounded). The parent
 * mints a fresh id per auth send; the child carries it through the WS
 * join/renew and echoes the server's echo in `authed`. */
export function isValidNonce(n) {
  return typeof n === 'string' && n.length > 0 && n.length <= MAX_NONCE_CHARS;
}

/* Shape/version validation for ONE parent->child message body. */
export function validParentMessage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.v !== EMBED_VERSION) return false;
  if (!CHILD_INCOMING.has(data.t)) return false;
  if (data.t === 'auth') {
    if (typeof data.ticket !== 'string' || data.ticket.length === 0 || data.ticket.length > MAX_TICKET_CHARS) return false;
    // Freshness correlation: auth without a validated nonce is ignored, so
    // no ack can ever be minted for an uncorrelated authorization.
    return isValidNonce(data.n);
  }
  // context: theme must be a known id when present; unknown keys ignored.
  if (data.theme !== undefined && !KNOWN_THEMES.has(data.theme)) return false;
  return true;
}

export function validThemeId(theme) {
  return KNOWN_THEMES.has(theme);
}

/* Contextual video hint for the parent, derived from public catalog metadata
 * only (communication/renderer/cat/realtime) — never hardcoded per-game ids.
 * video communication => social (large faces); board cat => board (calm
 * side-by-side); 3d renderer or realtime => immersive (compact filmstrip,
 * maximum game area); anything else/unknown => balanced. Pure and total:
 * null/unknown metadata falls back to balanced, never throws. */
export const PRESENTATIONS = ['social', 'board', 'immersive', 'balanced'];
export function isValidPresentation(p) {
  return typeof p === 'string' && PRESENTATIONS.includes(p);
}
export function presentationForGame(meta) {
  if (!meta || typeof meta !== 'object') return 'balanced';
  if (meta.communication === 'video') return 'social';
  if (meta.layout === 'immersive') return 'immersive';
  if (meta.cat === 'board') return 'board';
  if (meta.renderer === '3d' || meta.realtime === true) return 'immersive';
  return 'balanced';
}

/* Only verified Giggle seats can select an existing call participant.
 * These public scene captions never contain private answers or ballots. */
export function cameraSceneForState(state, players) {
  const scene = state && state.camera;
  if (!scene || typeof scene !== 'object' || Array.isArray(scene) ||
      typeof scene.caption !== 'string' || scene.caption.length > 120) return null;
  if (scene.mode === 'gallery' && scene.featured === null) return { mode: 'gallery', featured: null, caption: scene.caption };
  if (scene.mode !== 'spotlight' || typeof scene.featured !== 'string') return null;
  const seat = (Array.isArray(players) ? players : []).find(p => p.id === scene.featured);
  if (!seat || typeof seat.callUserId !== 'string' || !seat.callUserId || seat.callUserId.length > 128) return null;
  return { mode: 'spotlight', featured: seat.callUserId, caption: scene.caption };
}

/* Outgoing child->parent envelopes (always versioned). */
export function childMessage(type, fields) {
  return { v: EMBED_VERSION, t: type, ...(fields || {}) };
}

/* Create the child-side bridge. postFn delivers to the parent (wired to
 * parent.postMessage(envelope, exactOrigin) in the browser). handleEvent
 * enforces exact origin + exact source + shape before dispatching.
 * onAuth(ticket, n) / onContext(ctx) run only for fully validated messages. */
export function createChildBridge({ expectedOrigin, postFn, onAuth, onContext }) {
  function post(type, fields) {
    postFn(childMessage(type, fields), expectedOrigin);
  }
  function handleEvent(ev, parentWindow) {
    if (!ev || ev.origin !== expectedOrigin) return false;
    if (ev.source == null || ev.source !== parentWindow) return false;
    if (!validParentMessage(ev.data)) return false;
    if (ev.data.t === 'auth' && typeof onAuth === 'function') onAuth(ev.data.ticket, ev.data.n);
    if (ev.data.t === 'context' && typeof onContext === 'function') onContext(ev.data);
    return true;
  }
  return {
    ready: () => post('ready'),
    authNeeded: () => post('auth-needed'),
    /* Verified authorization ack: echoes the server's echo of the parent's
     * nonce. Refuses to post without a validated id — returns false and
     * sends nothing, so no bare/stale ack can promote the parent. */
    authed: (n) => {
      if (!isValidNonce(n)) return false;
      post('authed', { n });
      return true;
    },
    state: (fields) => post('state', fields),
    handleEvent,
  };
}
