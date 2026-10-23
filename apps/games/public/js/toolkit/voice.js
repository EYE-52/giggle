/* Voice capability over the parent's existing call (Media Toolkit).
 *
 * The game NEVER captures audio itself: no getUserMedia, no
 * RTCPeerConnection, no MediaStream anywhere in this module. Voice rides the
 * parent Giggle page's existing Agora call. This client only:
 * - asks the parent to show its mic-enable prompt (request()),
 * - receives the parent's ACTUAL capture/mute status (voice-state),
 * - reports unavailable + an honest hint when standalone.
 *
 * Protocol v1 (same frame channel as the auth bridge):
 *   child -> parent: { v: 1, t: 'voice-request', id }   (bounded nonce id)
 *   parent -> child: { v: 1, t: 'voice-state', mic, enabled, for? }
 *     mic: 'active' | 'off' | 'denied' | 'unavailable' (parent's truth)
 *     enabled: parent-side capability switch for this game
 *     for: echoes the request id for a direct answer; omitted on pushes
 *
 * Incoming state is applied ONLY when every gate passes: exact configured
 * origin, exact current parent window source, v1 schema, a verified authed
 * handshake (setAuthed(true) after the game server accepts a ticket), and
 * the local enabled switch. Forged (wrong origin/source), pre-handshake,
 * locally-disabled, and stale (for !== latest request id) messages are
 * rejected. request() never captures — the parent only shows a prompt with
 * a real Enable microphone button, and the player must click THAT parent
 * button (existing device toggle, real user gesture) to enable the mic.
 * An already-enabled mic answers with an active status instead of a prompt.
 *
 * No raw audio, secrets, or tickets in this library, its events, storage,
 * or logs. No imports, no globals at module scope.
 */

export const VOICE_VERSION = 1;
export const VOICE_MIC_STATES = ['active', 'off', 'denied', 'unavailable'];
export const MAX_VOICE_ID_CHARS = 128;

export const STANDALONE_VOICE_HINT = 'Voice chat needs a Giggle call — open this game from Play together.';

export function isValidVoiceMic(m) {
  return typeof m === 'string' && VOICE_MIC_STATES.includes(m);
}

export function isValidVoiceId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= MAX_VOICE_ID_CHARS;
}

/* Shape/version validation for ONE parent->child voice message body. */
export function validVoiceParentMessage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.v !== VOICE_VERSION) return false;
  if (data.t !== 'voice-state') return false;
  if (!isValidVoiceMic(data.mic)) return false;
  if (typeof data.enabled !== 'boolean') return false;
  if (data.for !== undefined && !isValidVoiceId(data.for)) return false;
  return true;
}

export function voiceChildMessage(type, fields) {
  return { v: VOICE_VERSION, t: type, ...(fields || {}) };
}

export function createVoiceId() {
  try {
    const cryptoObj = globalThis.crypto;
    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      const bytes = new Uint8Array(12);
      cryptoObj.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fall through */ }
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/* Mount: createVoiceClient({ expectedOrigin, postFn, authed?, enabled?,
 * window? }).
 * - expectedOrigin: exact configured parent origin ('' = standalone mode).
 * - postFn(envelope, exactOrigin): delivers to the parent; root wires it to
 *   window.parent.postMessage(envelope, exactOrigin).
 * - window: when provided, the client attaches its own message listener
 *   (handleEvent against the CURRENT parent window); otherwise root calls
 *   handleEvent(ev, window.parent) from the shell listener. dispose()
 *   removes the attached listener either way.
 */
export function createVoiceClient(opts) {
  opts = opts || {};
  const expectedOrigin = typeof opts.expectedOrigin === 'string' ? opts.expectedOrigin : '';
  const postFn = typeof opts.postFn === 'function' ? opts.postFn : null;
  const standalone = !expectedOrigin;

  let authed = opts.authed === true;
  let localEnabled = opts.enabled !== false;
  let disposed = false;
  let lastRequestId = null;
  let attached = null;

  const status = {
    mode: standalone ? 'standalone' : 'embedded',
    mic: 'unknown',
    enabled: false,
    updatedAt: 0,
  };
  const subs = new Set();

  const snapshot = () => ({ ...status });

  const notify = () => {
    const s = snapshot();
    for (const fn of [...subs]) {
      try { fn(s); } catch { /* subscriber bug: never break voice */ }
    }
  };

  const mark = (mic, enabled) => {
    status.mic = mic;
    status.enabled = enabled === true;
    try {
      status.updatedAt = Date.now();
    } catch {
      status.updatedAt = 0;
    }
    notify();
  };

  /* Verified-handshake gate: root sets true after the game server accepts a
   * ticket on the socket (same moment the shell posts `authed`), false on
   * socket close/leave. Pre-handshake voice traffic is always rejected. */
  const setAuthed = (v) => {
    authed = v === true;
    if (!authed) {
      lastRequestId = null;
      mark('unknown', false);
    }
  };

  /* Local capability switch. The manifest communication=voice hint guides
   * layout; it never forces permission — a game that needs no voice calls
   * setEnabled(false) and all voice traffic is rejected. */
  const setEnabled = (v) => {
    localEnabled = v !== false;
    if (!localEnabled) lastRequestId = null;
  };

  /* Ask the parent to prompt for the mic. Merely posts; the parent shows a
   * prompt with a real Enable microphone button and NOTHING is captured
   * until the player clicks that parent button. Standalone (or
   * pre-handshake/disabled) calls return { ok: false, reason } and post
   * nothing — getStatus().hint explains honestly. */
  const request = () => {
    if (disposed) return { ok: false, reason: 'disposed' };
    if (standalone || !postFn) return { ok: false, reason: 'standalone' };
    if (!authed) return { ok: false, reason: 'not-authed' };
    if (!localEnabled) return { ok: false, reason: 'disabled' };
    const id = createVoiceId();
    lastRequestId = id;
    try {
      postFn(voiceChildMessage('voice-request', { id }), expectedOrigin);
    } catch {
      return { ok: false, reason: 'post-failed' };
    }
    return { ok: true, id };
  };

  /* Strict inbound gate. parentWindow must be the CURRENT parent window
   * (window.parent at call time) — a captured/older source never matches a
   * re-framed parent. Returns true only when a state update was applied. */
  const handleEvent = (ev, parentWindow) => {
    if (disposed || standalone) return false;
    if (!ev || ev.origin !== expectedOrigin) return false;
    if (parentWindow == null || ev.source !== parentWindow) return false;
    if (!authed || !localEnabled) return false;
    if (!validVoiceParentMessage(ev.data)) return false;
    const msg = ev.data;
    if (msg.for !== undefined && msg.for !== lastRequestId) return false;
    // Parent disabled the capability for this game: surface unavailable, not
    // the last-known mic truth.
    if (msg.enabled !== true) {
      mark('unavailable', false);
      return true;
    }
    mark(msg.mic, true);
    return true;
  };

  const getStatus = () => {
    const s = snapshot();
    if (standalone) s.hint = STANDALONE_VOICE_HINT;
    else if (!authed) s.hint = 'Voice status arrives after the game connects.';
    else if (s.mic === 'denied') s.hint = 'Microphone is blocked — allow it in the browser to talk.';
    else if (s.mic === 'unavailable') s.hint = 'No usable microphone was found.';
    return s;
  };

  const subscribe = (fn) => {
    if (typeof fn !== 'function') return () => {};
    subs.add(fn);
    return () => { subs.delete(fn); };
  };

  let host = null;
  if (opts.window && typeof opts.window.addEventListener === 'function') {
    host = opts.window;
  }
  const onMessage = (ev) => {
    let parent = null;
    try {
      parent = host && host.parent ? host.parent : null;
    } catch {
      parent = null;
    }
    handleEvent(ev, parent);
  };
  if (host) {
    try {
      host.addEventListener('message', onMessage);
      attached = [host, onMessage];
    } catch {
      attached = null;
    }
  }

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    subs.clear();
    lastRequestId = null;
    if (attached) {
      try { attached[0].removeEventListener('message', attached[1]); } catch { /* noop */ }
      attached = null;
    }
  };

  return {
    request,
    handleEvent,
    getStatus,
    subscribe,
    setAuthed,
    setEnabled,
    isAuthed: () => authed,
    isEnabled: () => localEnabled,
    isStandalone: () => standalone,
    disposed: () => disposed,
    dispose,
    /* Call end: identical cleanup under the lifecycle name the shell uses. */
    end: dispose,
  };
}
