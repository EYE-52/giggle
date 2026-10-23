/* Game Night shell: connection, home/lobby/game screens, game view host. */
import { esc, store, artGradient, artInitial } from './util.js';
import { finalHtml } from './kit.js';
import { ZOOM_KEY, ZOOM_STEPS, currentZoom, stepZoom, percent, zoomable, zoomControlHtml } from './zoom.js';
import { sound, avatarColor, confetti, staggerIn } from './fx.js';
import { show as showView, reset as resetView } from './game-host.js';
import {
  openCustomizer, closeCustomizer, isCustomizerOpen, customizerGame,
  refreshCustomizer, customizerError, customizerResult,
} from './customize.js';
import { openHowto, closeHowto, refreshHowto, isHowtoOpen } from './howto.js';
import { decideCustomizeIntent, setPendingCustomize, takePendingCustomize } from './pending-customize.js';
import {
  parseEmbedParams, createChildBridge, validThemeId, isTrustedParentOrigin, isValidNonce,
  presentationForGame,
  cameraSceneForState,
} from './embed.js';
import { wsTargetFromConfig } from './netconfig.js';
import { createServerClock } from './server-clock.js';
import { createGameScreen } from './toolkit/game-screen.mjs';
import { readInputCapabilities } from './toolkit/input-capabilities.mjs';
import { createResultPresentation } from './toolkit/result-presentation.mjs';
import { createGameCuePlayer } from './toolkit/game-cues.mjs';
import { openIssueReport, isReportOpen } from './report-issue.js';
import { createRunLog } from './toolkit/run-log.mjs';
import { kartSetupSummary } from './kart-setup.js';
import {
  parseGameEntry, validateGameEntry, shouldHandleGameEntry,
  stripGameEntryParams, decideGameEntryCreate, decideGameEntryShow,
  detailsHref, setPendingGameEntry, takePendingGameEntry,
} from './game-entry.js';
import {
  createCanvasView, createInput, createMobileStick, createSoundBank,
  createVoiceClient, createThreeView, createSessionToolkit,
  STANDALONE_VOICE_HINT,
} from './toolkit/index.js';

/* Application close code when this seat was taken over in another window
 * (mirrors server/room.js SEAT_REPLACED_CODE). Never auto-reconnect on it. */
const SEAT_REPLACED_CODE = 4001;

/* Giggle embed mode (?embed=1&parentOrigin=…): the lobby frames this shell
 * and passes single-use tickets over postMessage v1. Embedded mode ignores
 * stored standalone room/name autojoin, hides promotional chrome, and keeps
 * tickets in memory only. */
const EMBED = parseEmbedParams(location.search);
const runLog = createRunLog();
window.addEventListener('error', event => runLog.event(event.target === window ? 'runtime-error' : 'resource-error'), true);
window.addEventListener('unhandledrejection', () => runLog.event('promise-error'));
window.addEventListener('pagehide', () => runLog.save());
document.addEventListener('visibilitychange', () => { runLog.visibility(); if (document.hidden) runLog.save(); });

/* Embed marker for CSS/child views: compact embedded rules key off
 * body.is-embed, so standalone home/lobby/game selectors never match and
 * standalone screens stay exactly as they are. */
if (EMBED.enabled) document.body.classList.add('is-embed');
// Test-table seats can preview the inside-Giggle look (see /test/).
else if (/[?&]seat=[1-8](&|$)/.test(location.search) && /[?&]look=giggle(&|$)/.test(location.search)) document.body.classList.add('is-embed');

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
function paintInputPreference() {
  document.body.classList.toggle('touch-preferred', readInputCapabilities().preferred.touch);
  if (gameScreen) paintGameScreen(gameScreen.state());
}
document.body.classList.toggle('touch-preferred', readInputCapabilities().preferred.touch);
for (const query of ['(pointer: coarse)', '(pointer: fine)', '(hover: hover)']) {
  window.matchMedia?.(query).addEventListener?.('change', paintInputPreference);
}
const resultPresentation = createResultPresentation((snapshot) => {
  const resultScores = snapshot?.scores;
  const noPositiveWinner = ['pose-party', 'show-and-go', 'doodle-guess', 'never-ever', 'most-likely', 'charades', 'memory-tray', 'typing-race'].includes(snapshot?.game) &&
    !Object.values(resultScores && typeof resultScores === 'object' ? resultScores : {}).some(score => Number(score) > 0);
  if (!noPositiveWinner) {
    sound.win();
    confetti();
  }
  announce('Game finished. Results are ready.');
});

// Polite live region for screen-reader announcements.
const liveEl = document.createElement('div');
liveEl.id = 'live';
liveEl.className = 'sr-only';
liveEl.setAttribute('aria-live', 'polite');
document.body.appendChild(liveEl);

let ws = null;
let retryMs = 500;
let retryTimer = 0;
let connLost = false;
let preparationFocus = null;
document.addEventListener('pointerdown', () => { preparationFocus = null; }, true);

/* Monotonic server clock: requested on socket open + every 15 s, anchored
 * by the bounded echo, with snapshot serverNow as the pre-calibration
 * fallback. api.now() exposes it to views for endsAt/clockStamp/cooldown
 * display — all judging stays server-side. */
const serverClock = createServerClock();
let clockTimer = 0;

function requestClock() {
  if (ws && ws.readyState === 1) {
    try { send(serverClock.request()); } catch { /* the next tick retries */ }
  }
}
/* Explicit single-active-seat policy: when the server closes us with
 * SEAT_REPLACED_CODE, this screen stops reconnecting and offers a
 * deliberate "Rejoin here" instead of fighting the new seat forever. */
let seatTaken = false;
let seatRemoved = false;
let you = null;
let myName = EMBED.enabled ? '' : (store.get('pb_name') || '');
let roomCode = EMBED.enabled ? ''
  : ((location.pathname.match(/^\/r\/(\w{4})/) || [])[1] || store.get('pb_room') || '');

/* Detail-page entry (?game=&name=[&wantsetup=1] from /games/id/): parsed
 * once at boot. A handled query overrides the remembered pb_room autojoin;
 * a valid one creates exactly one room when the socket + catalog are ready
 * (see consumeBootEntry), never auto-starts. Embed and /r/ flows ignore it. */
const BOOT_ENTRY_RAW = parseGameEntry(location.search);
const BOOT_ENTRY = shouldHandleGameEntry({
  parsed: BOOT_ENTRY_RAW, pathname: location.pathname, embedEnabled: EMBED.enabled,
}) ? BOOT_ENTRY_RAW : null;
let bootEntryConsumed = false;

/* Identity persistence is standalone-only: embedded seats resume via fresh
 * parent tickets, never via stored room/name/token. */
function persist(key, value) {
  if (!EMBED.enabled) store.set(key, value);
}

/* Embed auth state: the ticket lives in this variable only — never in the
 * URL, storage, or logs — and is dropped right after its single use. The
 * parent's per-authorization nonce rides alongside so the server can echo
 * it back and the child can correlate its `authed` ack. */
let embedTicket = null;
let embedTicketNonce = null;
let embedAuthed = false;
let embedAuthPending = false;
let embedFailures = 0;

function embedSendJoin(ticket, n) {
  if (seatRemoved) return;
  send({ t: embedAuthed ? 'giggleRenew' : 'giggleJoin', ticket, n });
}

/* Ask the parent for a fresh ticket (single-use: the previous one is spent
 * or expired). Backs off after repeated failures instead of looping. */
function requestEmbedAuth() {
  if (seatRemoved || !EMBED.enabled || embedAuthPending || !embedBridge || !embedTrusted) return;
  if (embedFailures >= 3) {
    toast('Squad games are unavailable right now.');
    return;
  }
  embedAuthPending = true;
  embedBridge.authNeeded();
}

function deliverEmbedAuth(ticket, n) {
  embedAuthPending = false;
  if (seatRemoved || !embedTrusted) return;
  if (!isValidNonce(n)) {
    // Uncorrelated authorization (should not happen — the bridge validates
    // first): ask for a fresh one instead of joining blind.
    requestEmbedAuth();
    return;
  }
  if (ws && ws.readyState === 1) {
    embedTicket = null;
    embedTicketNonce = null;
    embedSendJoin(ticket, n);
  } else {
    // Socket is down: hold the fresh ticket + nonce until the socket opens.
    embedTicket = ticket;
    embedTicketNonce = n;
  }
}

const embedBridge = EMBED.enabled ? createChildBridge({
  expectedOrigin: EMBED.parentOrigin,
  postFn: (envelope, targetOrigin) => {
    // Exact parent origin — never '*'.
    window.parent.postMessage(envelope, targetOrigin);
  },
  onAuth: deliverEmbedAuth,
  onContext: (ctx) => {
    if (ctx.theme !== undefined && validThemeId(ctx.theme)) setTheme(ctx.theme);
  },
}) : null;

/* Embed trust: the parentOrigin query value is only a CLAIM. Nothing is
 * sent to (or accepted from) the parent until the server's public
 * /config.json confirms the origin is exactly configured — and http
 * origins only where the server allows them (development). Configured
 * Tailnet previews (http://divyanshs-mac-mini:4012) work; unconfigured
 * origins and http-in-production stay untrusted with an honest message. */
let embedTrusted = false;
let embedTrustResolved = false;
let embedRejected = false;

// Call status belongs to the page; game views may subscribe while mounted.
// Canvas/input/audio factories remain optional and owned by each view.
let voiceClient = createVoiceClient({ expectedOrigin: '' });
const voiceObservers = new Set();
function activateVoiceBridge() {
  voiceClient.dispose();
  voiceClient = createVoiceClient({
    expectedOrigin: EMBED.parentOrigin,
    postFn: (message, origin) => {
      if (embedTrusted) window.parent.postMessage(message, origin);
    },
  });
  voiceClient.subscribe((status) => {
    paintVoice();
    for (const listener of voiceObservers) listener(status);
  });
}

/* Public config, fetched once and shared: the socket target (split-host
 * websocketUrl vs legacy same-host) and the embed-trust decision read the
 * same cached object, so startup issues exactly one /config.json fetch.
 * Only a successful fetch caches; failures return null and the callers
 * retry (connect() with backoff, embed trust on the next socket open). */
let publicConfig = null;
let configFlight = null;

function loadPublicConfig() {
  if (publicConfig) return Promise.resolve(publicConfig);
  if (!configFlight) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    configFlight = fetch('/config.json', { cache: 'no-store', signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error('config ' + res.status);
        return res.json();
      })
      .then((cfg) => {
        if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('config shape');
        publicConfig = cfg;
        configFlight = null;
        return cfg;
      })
      .catch(() => {
        configFlight = null;
        return null;
      })
      .finally(() => clearTimeout(timeout));
  }
  return configFlight;
}

async function resolveEmbedTrust() {
  if (!EMBED.enabled || embedTrustResolved) return;
  const cfg = await loadPublicConfig();
  if (!cfg) return; // offline: stay silent; the socket open retries below.
  embedTrustResolved = true;
  if (cfg && isTrustedParentOrigin(EMBED.parentOrigin, cfg.giggleAllowedOrigins, cfg.allowHttp)) {
    embedTrusted = true;
    activateVoiceBridge();
    if (!seatRemoved && ws && ws.readyState === 1 && !embedAuthed && !embedTicket) embedBridge.ready();
    render();
  } else {
    embedRejected = true;
    render();
  }
}

if (embedBridge) {
  window.addEventListener('message', (ev) => {
    // Exact origin + exact source (our framing parent) enforced inside;
    // nothing is accepted before the origin itself is trusted.
    if (embedTrusted) {
      embedBridge.handleEvent(ev, window.parent);
      voiceClient.handleEvent(ev, window.parent);
    }
  });
  resolveEmbedTrust();
}

/* Minimal presence summary for the parent frame (game + count, no chat).
 * While a game runs, "playing" counts ACTIVE participants (seat-capped
 * games report their players, not the room size); watchers ride along
 * separately so the parent can name both honestly. The presentation hint
 * derives from the public catalog entry for the running game (or balanced
 * in the lobby / when the catalog hasn't loaded yet) — never per-game ids
 * in this shell. */
function reportEmbedState() {
  if (!EMBED.enabled || !embedBridge || !room) return;
  // Counts are typed protocol fields: finite nonnegative integers within
  // the room cap (the parent validates the same bounds and drops the
  // snapshot's counts otherwise).
  const clampCount = (n) => Math.max(0, Math.min(24, n | 0));
  const meta = room.game ? games.find((g) => g.id === room.game) : null;
  const presentation = presentationForGame(meta || null);
  const camera = cameraSceneForState(lastState?.game === room.game && lastState?.instanceId === room.instanceId ? lastState : null, room.players);
  lastEmbedCameraKey = JSON.stringify(camera);
  if (room.game && Array.isArray(room.participants)) {
    const n = clampCount(room.participants.filter((p) => p.connected).length);
    const w = clampCount(Array.isArray(room.spectators) ? room.spectators.length : 0);
    embedBridge.state({ game: room.game || null, players: n, watchers: w, presentation, camera });
    return;
  }
  const n = clampCount(room.players.filter((p) => p.connected).length);
  embedBridge.state({ game: room.game || null, players: n, presentation, camera });
}
let lastEmbedCameraKey = 'null';
let room = null;       // last 'room' snapshot
let games = [];        // registry list
let catalogLoaded = false;
let gameId = null;
let instanceId = null; // server-issued game instance; change => full reset
let lastState = null;
/* Inside Giggle a player who pressed Leave sees the call's game picker
 * while the others finish; "Watch" sets this to that match's instance. */
let watchInstance = null;
/* Inline confirmations in the Room drawer: 'end' | 'leave' | null. */
let menuConfirm = null;
let pendingRoomAction = null;
let roomActionTimeout = 0;
let timerRaf = 0;
let catFilter = 'all';
let query = '';
let queryFocus = false;
let browseAll = false;
/* Shared catalog browsing (home + room stay coherent): search text,
 * category, customizable-only, and sort are one state; the group control
 * differs — home picks a desired size (range overlap), rooms use the live
 * connected count (Fits our N). */
let sortMode = 'shelf'; // shelf | name | fewest | fits(room only)
let customOnly = false;
let fitsOnly = false;
let homeGroup = 'any'; // any | 2 | 3-4 | 5-8 | 9+
/* Lobby paint memory: one-shot motion (strip pop, confetti, stagger,
 * join spotlight) keys off the room code, so WebSocket repaints of the
 * same room never replay it. */
let lastLobbyKey = '';
let prevLobbyIds = new Set();

/* Deterministic art fallback: swap a missing game image for a gradient +
 * initial tile. Global so inline onerror handlers can reach it. */
function artFail(img) {
  const id = img.getAttribute('data-art-id') || '?';
  const name = img.getAttribute('data-art-name') || '?';
  const d = document.createElement('div');
  d.className = img.className + ' art-fallback';
  d.style.background = artGradient(id);
  d.textContent = artInitial(name);
  d.setAttribute('aria-hidden', 'true');
  img.replaceWith(d);
}
window.__artFail = artFail;

function artImg(g, cls) {
  const src = (g.art && /^img\/games\/[a-z0-9-]+\.(svg|png|webp)$/.test(g.art)) ? '/' + g.art : `/img/games/${g.id}.png`;
  return `<img class="${cls}" src="${src}" alt="" loading="lazy" decoding="async" width="640" height="271" ` +
    `data-art-id="${esc(g.id)}" data-art-name="${esc(g.name)}" onerror="__artFail(this)">`;
}

export function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.hidden = true; }, 2600);
}

export function announce(msg) {
  liveEl.textContent = '';
  requestAnimationFrame(() => { liveEl.textContent = msg; });
}

function tokenKey(code) {
  return 'pb_token_' + code;
}

/* Config-first connect: no socket opens until /config.json resolves. A
 * validated websocketUrl is dialed directly (split-host: the single Railway
 * origin — never proxied through Vercel); an EMPTY setting keeps the legacy
 * same-host socket (local preview, no env changes). A FAILED fetch opens
 * nothing and retries with backoff, so seats/tickets never go to an
 * unvalidated origin. The resolved config is cached for the session, so
 * reconnects reuse it; the pending guard keeps concurrent callers (boot,
 * Retry now, timers) to one in-flight resolution, and the openSocket
 * readyState 0/1 guard keeps them to one socket. */
let connectPending = false;
let socketStartTimer = 0;

function renderBootFailure() {
  if (!EMBED.enabled && document.getElementById('shelfGames')) { paintHomeCatalog(); return; }
  app.innerHTML = '<section class="boot-view" role="alert"><h1>Can’t reach the games yet</h1><p>Check your connection, then try again.</p><button type="button" class="btn" id="bBootRetry">Retry</button></section>';
  app.querySelector('#bBootRetry').onclick = () => connect();
}

function connect() {
  if (seatRemoved) return;
  clearTimeout(retryTimer);
  if (publicConfig) {
    openSocket();
    return;
  }
  if (connectPending) return;
  connectPending = true;
  loadPublicConfig().then((cfg) => {
    connectPending = false;
    if (!cfg) {
      connLost = true;
      if (!games.length && !room) renderBootFailure();
      paintConn();
      retryTimer = setTimeout(connect, Math.min(retryMs *= 2, 5000));
      return;
    }
    openSocket();
  });
}

function openSocket() {
  if (seatRemoved) return;
  // Duplicate cached-config connects (Retry now, timers) must not open
  // parallel sockets while the previous WS is CONNECTING/OPEN; CLOSED
  // seats still reconnect (readyState 2/3 fall through).
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  clearTimeout(retryTimer);
  const target = wsTargetFromConfig(publicConfig, { allowWs: location.protocol !== 'https:' });
  if (target) {
    ws = new WebSocket(target);
  } else {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host);
  }
  const openingSocket = ws;
  openingSocket.hasGameState = false;
  clearTimeout(socketStartTimer);
  socketStartTimer = setTimeout(() => {
    if (ws !== openingSocket || openingSocket.readyState !== 0) return;
    if (!games.length && !room) renderBootFailure();
    openingSocket.close();
  }, 8000);
  ws.onopen = () => {
    if (ws !== openingSocket) return;
    clearTimeout(socketStartTimer);
    retryMs = 500;
    connLost = false;
    seatTaken = false;
    serverClock.reset();
    requestClock();
    clearInterval(clockTimer);
    clockTimer = setInterval(requestClock, 15000);
    send({ t: 'games' });
    if (EMBED.enabled) {
      // Embedded seats never autojoin from storage: ask the parent for a
      // fresh ticket (or spend one that arrived while offline) — but only
      // once the parent origin itself is trusted via /config.json.
      if (!embedTrustResolved) resolveEmbedTrust();
      if (embedTicket && embedTrusted) {
        const ticket = embedTicket;
        const heldNonce = embedTicketNonce;
        embedTicket = null;
        embedTicketNonce = null;
        if (isValidNonce(heldNonce)) embedSendJoin(ticket, heldNonce);
        else requestEmbedAuth();
      } else if (embedBridge && embedTrusted) {
        embedBridge.ready();
      }
      render();
    } else if (BOOT_ENTRY && !bootEntryConsumed) {
      render();
      consumeBootEntry();
    } else if (myName && roomCode) {
      // Auto-rejoin the last room (seat token resumes our exact seat).
      send({ t: 'join', name: myName, code: roomCode, seatToken: store.get(tokenKey(roomCode)) || undefined });
    } else render();
    paintConn();
  };
  ws.onmessage = (ev) => {
    if (ws !== openingSocket) return;
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    onMsg(msg);
  };
  ws.onclose = (ev) => {
    if (ws !== openingSocket) return;
    runLog.event('socket-close');
    runLog.pause();
    sound.stop();
    openingSocket.hasGameState = false;
    // Rejoining the same seat must never resume keys/sticks held before
    // the connection broke. Every game already uses this stop signal.
    document.dispatchEvent(new Event('game-screenchange'));
    clearTimeout(socketStartTimer);
    clearRoomAction();
    clearKickRequest();
    lastKickRequestId = null;
    kickConfirmation = null;
    clearTimeout(retryTimer);
    clearInterval(clockTimer);
    clockTimer = 0;
    serverClock.reset();
    embedAuthed = false;
    voiceClient.setAuthed(false);
    paintVoice();
    if (ev?.code === 4003) {
      runLog.finish();
      seatRemoved = true;
      seatTaken = false;
      connLost = false;
      embedTicket = null;
      embedTicketNonce = null;
      embedAuthPending = false;
      closeCustomizer({ returnFocus: false });
      closeHowto({ returnFocus: false });
      resetView();
      resultPresentation.reset();
      if (!EMBED.enabled) {
        store.remove(tokenKey(roomCode)); store.remove('pb_room');
      }
      room = null; roomCode = ''; gameId = null; lastState = null; focusGame = null; instanceId = null; you = null;
      bootEntryConsumed = true;
      history.replaceState(null, '', '/' + location.search);
      announce('The host removed you from this room.');
      reportEmbedState();
      render();
      return;
    }
    if (ev && ev.code === SEAT_REPLACED_CODE) {
      // Deliberate takeover in another window/tab: stop here. No automatic
      // reconnect (that would fight the new seat forever) — the banner
      // offers a deliberate "Rejoin here".
      seatTaken = true;
      connLost = false;
      announce('Playing in another window. Use Rejoin here to take it back.');
      render();
      return;
    }
    seatTaken = false;
    connLost = true;
    if (!games.length && !room) renderBootFailure();
    paintConn();
    retryTimer = setTimeout(connect, Math.min(retryMs *= 2, 5000));
  };
}

function paintConn() {
  const bar = document.getElementById('connbar');
  if (bar) bar.hidden = !(connLost || seatTaken);
}

function send(o) {
  // Only clients whose host preserves events across coalesced renders opt
  // in. Cached older clients keep receiving complete combat history.
  if (['create', 'join', 'giggleJoin', 'giggleRenew'].includes(o.t)) o = { ...o, kartEvents: 'delta-v1' };
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
}

function clearRoomAction() {
  clearTimeout(roomActionTimeout);
  roomActionTimeout = 0;
  pendingRoomAction = null;
  renderHostStates();
}

function requestRoomAction(kind) {
  if (!isHost() || pendingRoomAction) return;
  if (!ws || ws.readyState !== 1) return toast('Reconnect before changing the match.');
  const request = { kind, instance: instanceId };
  pendingRoomAction = request;
  sound.stop();
  resultPresentation.reset();
  document.dispatchEvent(new Event('game-screenchange'));
  renderHostStates();
  send(kind === 'rematch' ? { t: 'start', game: gameId, ready: true } : kind === 'end' ? { t: 'end' } : { t: 'lobby' });
  roomActionTimeout = setTimeout(() => {
    if (pendingRoomAction !== request) return;
    clearRoomAction();
    toast('No response yet. Try again.');
  }, 6000);
}

const playGameCue = createGameCuePlayer((name, options) => sound.cue(name, options),
  () => lastState, () => ({ game: gameId, connected: ws?.readyState === 1 && ws.hasGameState === true,
    hidden: document.hidden, pending: !!pendingRoomAction }));
const api = {
  diagnostics: runLog,
  now: () => lastState?.preparing ? lastState.gameNow : serverClock.now() - (lastState?.clockOffset || 0),
  ready: ({ instanceId: id, window }) => {
    if (!lastState?.preparing || lastState.instanceId !== id || lastState.w !== window || ws?.readyState !== 1) return false;
    send({ t: 'game-ready', i: id, w: window });
    return true;
  },
  loadError: paintGameLoadError,
  context: () => ({ isHost: isHost(), connected: ws?.readyState === 1 && ws.hasGameState === true, preparing: !!lastState?.preparing, roomActionPending: !!pendingRoomAction, theme: theme(), sound: sound.enabled, voice: voiceClient.getStatus(), settings: { ...(room?.config?.[gameId]?.settings || {}) } }),
  // Game-owned results menus configure the next match through the same
  // validated room route as Customize. A partial choice preserves the
  // host's other settings; true means queued, not a server acknowledgement.
  configure: (settings) => {
    if (!isHost() || !gameId || !matchOver() || !settings || typeof settings !== 'object' || Array.isArray(settings) || ws?.readyState !== 1) return false;
    send({ t: 'configure', game: gameId, settings: { ...(room?.config?.[gameId]?.settings || {}), ...settings } });
    return true;
  },
  rematch: () => { if (matchOver()) requestRoomAction('rematch'); },
  // "End game" (host): final scores now; the game's onEnd decides them.
  endGame: () => { if (!matchOver()) requestRoomAction('end'); },
  // "Leave" (anyone): see leaveMatch().
  leave: () => leaveMatch(),
  resultsReady: (id) => !pendingRoomAction && lastState?.phase === 'done' && lastState.instanceId === id && resultPresentation.ready(id),
  toast,
  cue: playGameCue,
  audioUnlock: () => { if (window.navigator?.userActivation?.isActive) sound.unlock(); },
  toolkit: { createCanvasView, createInput, createMobileStick, createSoundBank, createThreeView, createSessionToolkit },
  voice: {
    request: () => voiceClient.request(),
    getStatus: () => voiceClient.getStatus(),
    subscribe: (fn) => {
      if (typeof fn !== 'function') return () => {};
      voiceObservers.add(fn);
      return () => voiceObservers.delete(fn);
    },
  },
  // Transport acceptance is not a sound event. Games cue confirmed actions
  // when their visible movement/impact occurs; rejected input stays quiet.
  send: (a) => {
    if (lastState?.preparing || pendingRoomAction || ws?.readyState !== 1) return false;
    send({ t: 'action', a, i: instanceId, w: lastState ? lastState.w : undefined });
    return true;
  },
  // Never pre-clear: the view disposes only when the server accepts the
  // change (room snapshot with no game), so a rejected request leaves the
  // current game visible.
  lobby: () => { requestRoomAction('lobby'); },
  name: (pid) => {
    const p = (lastState && lastState.players || []).find((p) => p.id === pid);
    return p ? p.name : '???';
  },
  focus: (sel) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    const menu = document.getElementById('roomMenu');
    if (menu?.open && !menu.contains(el)) return;
    if (el && el.focus) {
      try { el.focus({ preventScroll: true }); } catch { el.focus(); }
    }
  },
  announce: (msg) => announce(msg),
};

/* The match is over: the game reached 'done', or the host (or the room,
 * when too few players remain) ended it. Rematch / Change game apply. */
function matchOver(S = lastState) {
  return !!S && (S.phase === 'done' || S.matchEnded === true);
}

/* Ended on a game without its own final screen: the shell shows one. */
function shellFinal(S = lastState) {
  return !!S && S.matchEnded === true && S.phase !== 'done';
}

function isHost() {
  if (!room) return false;
  if (!room.hostId) return true; // no host seated: anyone may act
  return room.hostId === you;
}

function onMsg(msg) {
  switch (msg.t) {
    case 'clock':
      serverClock.accept(msg);
      break;
    case 'hello':
      you = msg.you;
      myName = msg.name;
      persist('pb_name', myName);
      if (msg.seatToken && msg.code) persist(tokenKey(msg.code), msg.seatToken);
      if (msg.giggle) {
        embedAuthed = true;
        if (embedTrusted) voiceClient.setAuthed(true);
        paintVoice();
        embedFailures = 0;
        // Verified authorization acknowledgment: the server accepted this
        // frame's ticket on its socket. Posted from here only — never on
        // ticket receipt — echoing the server's echo of the parent's nonce
        // so the parent can correlate it to its LATEST pending id. Without
        // a validated echo there is no ack: an older delayed ack can never
        // promote the parent.
        if (EMBED.enabled && embedBridge && embedTrusted && isValidNonce(msg.n)) embedBridge.authed(msg.n);
      }
      break;
    case 'games':
      games = msg.games;
      catalogLoaded = true;
      consumeBootEntry();
      if (!room) render();
      else if (!room.game) render();
      // The catalog arrived late while a game runs: re-derive the hint.
      else reportEmbedState();
      break;
    case 'room': {
      room = msg.room;
      if (pendingRoomAction && !isHost()) clearRoomAction();
      roomCode = room.code;
      persist('pb_room', roomCode);
      // The embed query must survive internal navigation.
      history.replaceState(null, '', '/r/' + roomCode + location.search);
      if (!room.game) {
        runLog.finish();
        sound.stop();
        clearRoomAction();
        resultPresentation.reset();
        gameId = null; lastState = null; focusGame = null; instanceId = null;
        resetView();
        render();
        consumePendingCustomize();
        consumeGameEntry();
      } else if (lastState?.youLeft && watchInstance !== lastState.instanceId) {
        render();
      } else {
        renderHostStates();
        if (gameById(gameId)?.runtime || matchOver()) paintGameBody();
      }
      if (isCustomizerOpen()) refreshCustomizer(room.config, isHost());
      // Roster ticks never move or close the howto panel; its CTA/counts
      // just re-derive from the fresh snapshot.
      if (isHowtoOpen()) refreshHowto();
      reportEmbedState();
      break;
    }
    case 'state': {
      const audioBaseline = !ws?.hasGameState;
      runLog.snapshot({ ...msg, audioBaseline });
      if (ws) ws.hasGameState = true;
      if (pendingRoomAction && msg.instanceId !== pendingRoomAction.instance) clearRoomAction();
      else if (pendingRoomAction?.kind === 'end' && matchOver(msg)) clearRoomAction();
      const prev = lastState;
      rememberPreparationFocus(msg, prev);
      lastState = { ...msg, me: you, audioBaseline };
      if (msg.preparing && (!prev?.preparing || prev.w !== msg.w)) document.dispatchEvent(new Event('game-screenchange'));
      serverClock.observe(msg.serverNow);
      fanfare(prev, lastState);
      if (room) room.game = msg.game;
      // A new instanceId means rematch/restart: EVERY client disposes and
      // remounts, even when the game id is unchanged.
      if (msg.game !== gameId || (msg.instanceId && msg.instanceId !== instanceId)) {
        sound.stop();
        gameId = msg.game;
        instanceId = msg.instanceId || null;
        announce(`${gameById(msg.game)?.name || 'Game'}.`);
        focusGame = null;
        closeCustomizer({ returnFocus: false });
        closeHowto({ returnFocus: false });
        resetView();
        render();
        // Game (or rematch instance) changed: the hint may too. Per-tick
        // states below never re-report, so the parent sees one update per
        // game change — and dedups identical hints itself.
        reportEmbedState();
      } else if (msg.youLeft) {
        // Left this match (inside Giggle): the frame shows the call's game
        // picker until the next game starts.
        if (lastScreen !== 'lobby' && watchInstance !== msg.instanceId) { sound.stop(); resetView(); render(); }
        else if (watchInstance === msg.instanceId) paintGameBody();
      } else {
        paintGameBody();
      }
      renderHostStates();
      paintGamePreparation();
      if (JSON.stringify(cameraSceneForState(lastState, room?.players)) !== lastEmbedCameraKey) reportEmbedState();
      renderScores();
      break;
    }
    case 'kicked':
      roomKickResult(msg);
      break;
    case 'left':
      announce(msg.removed ? 'You left the room.' : 'You left the game.');
      break;
    case 'configured':
      customizerResult(msg);
      break;
    case 'error':
      if (msg.code === 'KICK_REJECTED' && !roomKickResult({ error: msg.msg, requestId: msg.requestId })) break;
      if (msg.requestId) customizerResult(msg);
      clearRoomAction();
      toast(msg.msg);
      if (!room) takePendingCustomize(); // failed create: drop the deferred tap
      if (!room) takePendingGameEntry();
      if (!msg.requestId && isCustomizerOpen() && /host|setting|pack|unknown|must be|needs|allows|too long|exceeds|items?/i.test(msg.msg)) {
        customizerError(customizerGame(), msg.msg);
      }
      // Embed re-authorization: an expired lease/ticket — or a momentarily
      // full replay cache — just needs a fresh ticket from the parent.
      // Anything else is shown, not retried.
      if (EMBED.enabled && (msg.code === 'LEASE_EXPIRED' || msg.code === 'TICKET_EXPIRED' || msg.code === 'TICKET_CAPACITY')) {
        embedAuthed = false;
        voiceClient.setAuthed(false);
        paintVoice();
        embedFailures += 1;
        requestEmbedAuth();
      }
      break;
  }
}

/* Results and accessibility announcements share lifecycle; audio remains
 * owned by meaningful gameplay events rather than arbitrary phase names. */
function fanfare(prev, S) {
  resultPresentation.observe(prev, S, gameById(S.game)?.runtime?.waitForResult === true || S.waitForResult === true);
  if (!prev || prev.game !== S.game) return;
  const ph = S.phase || '';
  const was = prev.phase || '';
  if (ph === was && (S.round || 0) === (prev.round || 0)) return;
  // Your-turn nudge: common spotlight fields across games.
  for (const k of ['drawer', 'actor', 'active', 'turn', 'chooser', 'reader', 'target']) {
    if (S[k] && S[k] === you && prev[k] !== you) {
      announce('Your turn.');
      break;
    }
  }
}

/* ---------------- screens ---------------- */

/* Code-native brand mark: sunshine smiley sticker with a raspberry grin.
 * Flat, no gradients — the same motif anchors the nav on every screen. */
const BRANDMARK = `<svg class="brandmark" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">` +
  `<rect x="2.5" y="2.5" width="25" height="25" rx="9" fill="#FFB020" stroke="#2B1220" stroke-width="2.5"/>` +
  `<circle cx="11.5" cy="13" r="2.3" fill="#2B1220"/>` +
  `<circle cx="18.5" cy="13" r="2.3" fill="#2B1220"/>` +
  `<path d="M10.5 18.5 Q15 23 19.5 18.5" fill="none" stroke="#DE1E6A" stroke-width="2.6" stroke-linecap="round"/></svg>`;

/* Original code-native doodles for the hero poster wall (decorative). */
const DOODLE_STAR = (cls, size, fill) => `<svg class="doodle ${cls}" width="${size}" height="${size}" viewBox="0 0 44 44" aria-hidden="true">` +
  `<path d="M22 3 l4.6 10.8 11.6 1.3 -8.6 7.9 2.4 11.4 -10 -5.9 -10 5.9 2.4 -11.4 -8.6 -7.9 11.6 -1.3 z" fill="${fill}" stroke="#2B1220" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
const DOODLE_SQUIG = `<svg class="doodle squig" width="92" height="22" viewBox="0 0 92 22" aria-hidden="true">` +
  `<path d="M4 14 Q 15 4 26 12 T 48 12 T 70 12 T 88 9" fill="none" stroke="#DE1E6A" stroke-width="4" stroke-linecap="round"/></svg>`;

/* Code-native header/sound icons: stroke SVGs in currentColor, sized by
 * CSS. Sun = Day, moon = Night; speaker + waves = sound on, speaker +
 * slash = muted. Decorative (aria-hidden) — the button's visible label
 * and aria-label carry the meaning. */
const ICON_SUN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`;
const ICON_MOON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
const ICON_SND_ON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
const ICON_SND_OFF = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;

function themeIcon(id) {
  return id === 'night' ? ICON_MOON : ICON_SUN;
}

function soundIcon(on) {
  return on ? ICON_SND_ON : ICON_SND_OFF;
}

/* Toggle repaints that preserve the icon: header buttons (hbtn) redraw
 * icon + label, the embedded gamehead iconbtn redraws its icon, and the
 * room-drawer plain controls keep text only. */
function paintThemeButton(btn, id) {
  const label = themeName(id);
  if (btn.classList.contains('hbtn') || btn.classList.contains('room-setting')) btn.innerHTML = `${themeIcon(id)}<span class="hlabel">${label}</span>`;
  else btn.textContent = label;
}

function paintSoundButton(btn, on) {
  btn.dataset.state = on ? 'on' : 'off';
  if (btn.classList.contains('iconbtn')) btn.innerHTML = soundIcon(on);
  else if (btn.classList.contains('hbtn') || btn.classList.contains('room-setting')) btn.innerHTML = `${soundIcon(on)}<span class="hlabel">${on ? 'Sound on' : 'Muted'}</span>`;
  else btn.textContent = on ? 'Sound on' : 'Muted';
  btn.setAttribute('aria-label', on ? 'Mute sound' : 'Unmute sound');
}

/* Connection banner alone: embedded PLAYING screens skip the redundant
 * nested topbar (the parent already shows brand/close, and theme follows
 * the parent via context) but keep this honest reconnect state. */
function connbarHtml() {
  const connInner = seatTaken
    ? `<span>Playing in another window.</span>
    <button class="btn ghost" id="bRetry" style="padding:4px 14px">Rejoin here</button>`
    : `<span>Connection lost — retrying…</span>
    <button class="btn ghost" id="bRetry" style="padding:4px 14px">Retry now</button>`;
  return `<div class="connbar" id="connbar" ${(connLost || seatTaken) ? '' : 'hidden'}>
    ${connInner}
  </div>`;
}

function topbar() {
  // Embedded: the brand is a static label (leaving would drop the squad
  // game) and the internal room code is hidden — Giggle owns inviting.
  const brand = EMBED.enabled
    ? `<span class="brand">${BRANDMARK}<span>Game Night<span class="dot">.</span></span></span>`
    : `<a class="brand" href="/" data-nav>${BRANDMARK}<span>Game Night<span class="dot">.</span></span><small>by Giggle</small></a>`;
  return `<div class="topbar">
    ${brand}
    <div class="row">
      ${room && !EMBED.enabled ? `<div class="roomchip" title="Share this code">${esc(room.code)}</div>` : ''}
      ${reportButton()}
      ${document.body.classList.contains('is-embed') ? '' : `<button class="btn ghost hbtn" id="bTheme" title="Switch theme" aria-label="Switch theme, current ${themeName(theme())}">${themeIcon(theme())}<span class="hlabel">${themeName(theme())}</span></button>`}
      <button class="btn ghost hbtn" id="bSound" title="Sound on/off" aria-label="${sound.enabled ? 'Mute sound' : 'Unmute sound'}" data-state="${sound.enabled ? 'on' : 'off'}">${soundIcon(sound.enabled)}<span class="hlabel">${sound.enabled ? 'Sound on' : 'Muted'}</span></button>
    </div>
  </div>
  ${connbarHtml()}`;
}

function reportButton(extraClass = '') {
  return `<button type="button" class="report-icon ${extraClass}" data-report aria-label="Report an issue" title="Report an issue"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3l4 3v-3h9a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z"/><path d="M12 8v4m0 3h.01"/></svg></button>`;
}

function meetFooter() {
  // Embedded (or the test table's Inside Giggle look): the parent IS the
  // call — hide the promotional footer.
  if (EMBED.enabled || document.body.classList.contains('is-embed')) return '';
  return `<div class="sitefoot">Games need no account. Play here, hang out on
    <a href="https://www.gigglemeet.com" target="_blank" rel="noopener">Giggle Meet</a>.</div>`;
}

function avatar(pid, name) {
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="avatar" style="background:${avatarColor(pid)}">${esc(initial)}</span>`;
}

/* `spot` (a Set of player ids) rings exactly the chips that connected
 * since the last snapshot — one brief spotlight, never a full repaint. */
function playerChips(list, totals, spot) {
  return `<div class="players">` + list.map((p) =>
    `<div class="player ${p.connected === false ? 'off' : ''}${spot && spot.has(p.id) ? ' just-joined' : ''}">
      ${avatar(p.id, p.name)}${esc(p.name)}
      ${room && p.id === room.hostId ? '<span class="hosttag">host</span>' : ''}
      <span class="pts">${totals && totals[p.id] ? totals[p.id] : 0} pts</span>
    </div>`).join('') + `</div>`;
}

/* Embedded squad chips: names + host tag only (no avatars/points rail —
 * the Giggle parent already shows friends and video beside this frame). */
function embedPlayerChips(list, spot) {
  return `<div class="players embedplayers">` + list.map((p) =>
    `<div class="player ${p.connected === false ? 'off' : ''}${spot && spot.has(p.id) ? ' just-joined' : ''}">${esc(p.name)}${room && p.id === room.hostId ? '<span class="hosttag">host</span>' : ''}</div>`).join('') + `</div>`;
}

/* Two coherent looks: Day (default, pale blush + raspberry) and Night
 * (near-black + pink/yellow, never purple). The four pre-D7 ids migrate
 * here (and in the index.html bootstrap) so an old stored
 * Midnight/Arcade/Lounge value never resurrects a rejected UI. Parent
 * embed context ids map the same way. */
const THEMES = [['day', 'Day'], ['night', 'Night']];
const LEGACY_THEMES = { dark: 'night', light: 'day', arcade: 'night', lounge: 'day' };

function theme() {
  const t = document.documentElement.dataset.theme;
  if (THEMES.some(([id]) => id === t)) return t;
  if (t && LEGACY_THEMES[t]) return LEGACY_THEMES[t];
  return 'day';
}

function themeName(id) {
  const norm = LEGACY_THEMES[id] || id;
  const f = THEMES.find(([tid]) => tid === norm);
  return f ? f[1] : 'Day';
}

function playedIds() {
  try { return JSON.parse(localStorage.getItem('pb_played') || '[]'); }
  catch { return []; }
}

function markPlayed(id) {
  const list = playedIds();
  if (!list.includes(id)) {
    list.push(id);
    try { localStorage.setItem('pb_played', JSON.stringify(list)); } catch {}
  }
}

function setTheme(next) {
  const id = LEGACY_THEMES[next] || next;
  if (id !== 'day' && id !== 'night') return;
  if (id === 'day') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = id;
  store.set('pb_theme', id);
  const t = document.getElementById('bTheme');
  if (t) {
    paintThemeButton(t, id);
    t.setAttribute('aria-label', 'Switch theme, current ' + themeName(id));
  }
  if (room?.game && lastState && gameById(gameId)?.runtime) paintGameBody();
}

function wireTopbar() {
  const b = document.getElementById('bSound');
  if (b) b.onclick = () => {
    const on = sound.toggle();
    paintSoundButton(b, on);
    if (room?.game && lastState && gameById(gameId)?.runtime) paintGameBody();
  };
  const t = document.getElementById('bTheme');
  if (t) t.onclick = () => {
    const ids = THEMES.map(([id]) => id);
    const next = ids[(ids.indexOf(theme()) + 1) % ids.length];
    setTheme(next);
  };
  const r = document.getElementById('bRetry');
  if (r) r.onclick = () => {
    // "Rejoin here" after a takeover, or "Retry now" after a drop: a fresh
    // deliberate connect (which re-takes the seat with a new ticket).
    retryMs = 500;
    seatTaken = false;
    connect();
  };
}

let lastScreen = '';
let gameScreen = null;

function render() {
  if (!room) { clearKickRequest(); lastKickRequestId = null; kickConfirmation = null; }
  if (seatRemoved) {
    if (gameScreen) { gameScreen.dispose(); gameScreen = null; }
    app.dataset.layout = 'standard';
    document.body.classList.remove('game-playing', 'game-immersive');
    app.innerHTML = `<section class="room-removed" role="status"><h1>Removed from room</h1><p>The host removed you from this game room.</p>${EMBED.enabled ? '<p>Your call continues. Close Games to return to it.</p>' : '<button type="button" class="btn" id="bRemovedHome">Browse games</button>'}</section>`;
    const home = document.getElementById('bRemovedHome');
    if (home) home.onclick = () => { seatRemoved = false; render(); connect(); };
    return;
  }
  const screen = !room ? 'home' : (!room.game || leftToLobby() ? 'lobby' : 'game');
  if (screen !== 'game' && gameScreen) { gameScreen.dispose(); gameScreen = null; }
  const immersive = screen === 'game' && !!lastState && gameById(gameId)?.layout === 'immersive';
  app.dataset.layout = immersive ? 'immersive' : 'standard';
  document.body.classList.toggle('game-playing', screen === 'game');
  document.body.classList.toggle('game-immersive', immersive);
  // Screen-change fade only: roster/config snapshots repaint the same
  // screen constantly, and must never flash the whole view or forms.
  if (screen !== lastScreen) {
    app.classList.remove('fade');
    void app.offsetWidth;
    app.classList.add('fade');
  }
  cancelAnimationFrame(timerRaf);
  // Screen transitions drop a stale howto panel (same-room roster ticks
  // keep it — refreshHowto re-derives its CTA instead).
  if (screen !== lastScreen) closeHowto({ returnFocus: false });
  if (!room) renderHome();
  else if (!room.game || leftToLobby()) renderLobby();
  else renderGame();
  wireTopbar();
  // Screen transitions start at the top (joins mid-scroll must not yank).
  if (screen !== lastScreen) {
    lastScreen = screen;
    try { window.scrollTo(0, 0); } catch { /* no window (tests) */ }
  }
}

/* Pressed Leave in this match (inside Giggle) and not watching it. */
function leftToLobby() {
  return !!(room?.game && lastState?.youLeft && lastState.instanceId === instanceId && watchInstance !== instanceId);
}

/* "Leave": standalone leaves the room (home page); inside Giggle the
 * frame returns to the call's game picker and never leaves the call. */
function leaveMatch() {
  const menu = document.getElementById('roomMenu');
  if (menu) menu.open = false;
  menuConfirm = null;
  // The test table's "Inside Giggle" look (body.is-embed) previews the
  // Giggle behaviour too: the seat stays in the room.
  if (!EMBED.enabled && !document.body.classList.contains('is-embed')) { leaveRoom(); return; }
  if (!room?.game || lastState?.youLeft) {
    watchInstance = null;
    render();
    return;
  }
  if (ws?.readyState !== 1) return toast('Reconnect before leaving.');
  watchInstance = null;
  send({ t: 'leave', stay: true });
}

/* Standalone: give up the seat and go back to the home page. */
function leaveRoom() {
  sound.stop();
  clearRoomAction();
  closeCustomizer({ returnFocus: false });
  closeHowto({ returnFocus: false });
  resetView();
  resultPresentation.reset();
  // An explicit exit must detach the old room. Otherwise the next live
  // snapshot immediately pulls this screen back into its game.
  const reconnect = !!room && !EMBED.enabled;
  if (reconnect) {
    if (ws?.readyState === 1) send({ t: 'leave' });
    const oldSocket = ws;
    ws = null;
    if (oldSocket) {
      oldSocket.onopen = oldSocket.onmessage = oldSocket.onclose = oldSocket.onerror = null;
      oldSocket.close();
    }
    clearTimeout(retryTimer);
    clearInterval(clockTimer);
    clockTimer = 0;
    serverClock.reset();
    if (roomCode) store.remove(tokenKey(roomCode));
    roomCode = '';
    persist('pb_room', '');
    you = null;
    connLost = false;
    seatTaken = false;
  }
  room = null; gameId = null; lastState = null; focusGame = null; instanceId = null; watchInstance = null;
  history.replaceState(null, '', '/' + location.search);
  render();
  if (reconnect) { announce('You left the room.'); connect(); }
}

function heroGames() {
  const want = ['draw-phone', 'doodle-guess', 'charades'];
  const found = want.map((id) => games.find((g) => g.id === id)).filter(Boolean);
  for (const g of games) {
    if (found.length >= 3) break;
    if (!found.includes(g)) found.push(g);
  }
  return found.slice(0, 3);
}

function renderEmbedWaiting() {
  // Embedded pre-join: no marketing, no name/room form — the parent is
  // minting our ticket. The game UI below is untouched. An untrusted
  // parent origin gets an honest message instead of a join loop.
  if (embedRejected) {
    app.innerHTML = topbar() + `
      <div class="card center">
        <h2>Squad games aren&rsquo;t available here</h2>
        <p class="muted">This page isn&rsquo;t an allowed game host. Open games from your squad&rsquo;s lobby.</p>
      </div>`;
    return;
  }
  app.innerHTML = topbar() + `
    <div class="card center">
      <h2>Joining your squad&rsquo;s game…</h2>
      <p class="muted">Hang tight while we connect you.</p>
    </div>`;
}

/* Tonight's picks: a fixed mix (drawing, party, board, 3D) so first-time
 * visitors see the range before making a room. Registry gaps fill from the
 * catalog so the section never renders short. */
function pickGames() {
  const want = ['doodle-guess', 'charades', 'chess', 'pocket-karts'];
  const found = want.map((id) => games.find((g) => g.id === id)).filter(Boolean);
  for (const g of games) {
    if (found.length >= 4) break;
    if (!found.includes(g)) found.push(g);
  }
  return found.slice(0, 4);
}

function pickHtml(g) {
  // Single-action card: the whole card is one button opening the shared
  // setup dialog (rules + Customize + Create room). No shelf links — setup
  // belongs inside. Fixed geometry: the dialog never stretches these cards.
  return `
    <button type="button" class="pick card-open" data-how="${g.id}" aria-haspopup="dialog">
      ${artImg(g, 'gart')}
      <span class="t">${esc(g.name)}</span>
      <span class="d">${esc(g.tagline)}</span>
      <span class="p">${seatsLine(g)}</span>
      <span class="play-row"><span class="play-pill">Play</span></span>
    </button>`;
}

function catalogRowHtml(g) {
  // Single-action shelf row: art + text + one Play pill, all opening the
  // shared setup dialog. Exactly one button — no nested controls.
  return `
    <button type="button" class="catrow card-open" data-how="${g.id}" aria-haspopup="dialog">
      ${artImg(g, 'catart')}
      <span class="catrow-text"><span class="t">${esc(g.name)}</span><span class="d">${esc(g.tagline)}</span><span class="p">${seatsLine(g)}</span></span>
      <span class="play-pill">Play</span>
    </button>`;
}

function heroPosters() {
  const hg = heroGames();
  const poses = ['wide', 'tilt-l', 'tilt-r alt'];
  return hg.map((g, i) =>
    `<div class="poster ${poses[i] || ''}">${artImg(g, 'heroimg')}<span class="tag">${esc(g.name)}</span></div>`).join('') +
    DOODLE_STAR('star-tl', 46, '#FFB020') + DOODLE_STAR('star-br', 34, '#DE1E6A') + DOODLE_SQUIG;
}

/* Sort menu: honest shelf order first; rooms add the live-group sort. */
function sortOptions(inRoom) {
  const opts = [['shelf', 'Shelf order'], ['name', 'Name A–Z'], ['fewest', 'Fewest players']];
  if (inRoom) opts.push(['fits', 'Fits our group first']);
  return opts.map(([v, l]) => `<option value="${v}"${sortMode === v ? ' selected' : ''}>${l}</option>`).join('');
}

function catChipsHtml() {
  return liveCats().map(([id, label]) =>
    `<button class="chip ${catFilter === id ? 'sel' : ''}" data-cat="${id}">${label}</button>`).join('');
}

function renderHome() {
  if (EMBED.enabled) {
    renderEmbedWaiting();
    return;
  }
  const drafts = ['nm', 'jc'].map((id) => {
    const el = document.getElementById(id);
    return el && { id, value: el.value, focused: document.activeElement === el, start: el.selectionStart, end: el.selectionEnd };
  }).filter(Boolean);
  const total = catalogLoaded ? `${games.length} games` : 'Games for everyone';
  app.innerHTML = topbar() + `
    <div class="hero">
      <div class="hero-copy">
        <p class="hero-eyebrow">${total} · No accounts · No downloads</p>
        <h1>Bring your people. <span class="pop">Pick a game</span>.</h1>
        <p class="hero-sub">Make a room, share the code, and play ${catalogLoaded ? `${games.length} party games` : 'party games'}
          with friends on any device. Someone hosts, everyone plays.</p>
        <a class="shelf-link" href="#games">Find your next game</a>
      </div>
      <div class="hero-form ticket">
          <div class="ticket-head"><span class="ticket-title">Your ticket in</span><span class="ticket-stub">Free entry</span></div>
          <label for="nm">What should we call you?</label>
          <input id="nm" type="text" maxlength="16" placeholder="e.g. Pippa" value="${esc(myName)}" autocomplete="off">
          <div class="hero-cta"><button class="btn big" id="bCreate">Start the party</button></div>
          <div class="ticket-or" aria-hidden="true"><span>or join friends</span></div>
          <div class="hero-joinrow">
            <input id="jc" type="text" maxlength="4" placeholder="CODE" value="${esc(roomCode)}" autocomplete="off" aria-label="Room code">
            <button class="btn sun" id="bJoin">Join in</button>
          </div>
      </div>
      <div class="hero-art" aria-hidden="true">${heroPosters()}</div>
    </div>
    <div class="band">
      <div class="sec-head"><h2>Tonight&rsquo;s picks</h2><span class="muted">Four favorites to start the night.</span></div>
      <div class="pick-grid">${pickGames().map(pickHtml).join('')}</div>
    </div>
    <div class="band" id="games">
      <div class="sec-head"><h2>The whole shelf</h2><span class="count-pill" id="shelfCount">${catalogLoaded ? total : 'Loading games…'}</span><span class="muted">Create a room to play any of them.</span></div>
      <div class="catbar">
        <input id="hq" type="text" placeholder="Search games…" value="${esc(query)}" autocomplete="off" aria-label="Search games">
        <select id="grpSel" aria-label="Filter by group size — games whose player range overlaps your group" title="Games whose player range overlaps your group">
          ${HOME_GROUPS.map(([v, l]) => `<option value="${v}"${homeGroup === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <select id="hsortSel" aria-label="Sort games">${sortOptions(false)}</select>
        <button class="chip ${customOnly ? 'sel' : ''}" id="hcustTog" aria-pressed="${customOnly}">Customizable</button>
      </div>
      <div class="catchips" role="group" aria-label="Game categories">${catChipsHtml()}</div>
      <div class="catalog-list" id="shelfGames"></div>
      <div class="browse-wrap" id="browseWrap" ${homeFiltered() ? 'hidden' : ''}><button class="btn ghost" id="bBrowse" aria-expanded="${browseAll}">${browseAll ? 'Show fewer' : `Browse all ${total}`}</button></div>
      <p class="giggle-strip">Games need no account. Play here, hang out on
        <a href="https://www.gigglemeet.com" target="_blank" rel="noopener">Giggle Meet</a>
        with your friends.</p>
    </div>`;
  document.getElementById('bCreate').onclick = () => {
    const nm = document.getElementById('nm').value.trim();
    if (!nm) return toast('Pick a party name first');
    myName = nm;
    send({ t: 'create', name: nm });
  };
  const join = () => {
    const nm = document.getElementById('nm').value.trim();
    const code = document.getElementById('jc').value.trim().toUpperCase();
    if (!nm) return toast('Pick a party name first');
    if (code.length !== 4) return toast('Room codes are 4 letters');
    myName = nm;
    roomCode = code;
    send({ t: 'join', name: nm, code, seatToken: store.get(tokenKey(code)) || undefined });
  };
  document.getElementById('bJoin').onclick = join;
  document.getElementById('jc').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  document.getElementById('nm').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('bCreate').click();
  });
  const bBrowse = document.getElementById('bBrowse');
  if (bBrowse) bBrowse.onclick = () => {
    browseAll = !browseAll;
    render();
  };
  app.querySelectorAll('[data-cat]').forEach((c) => {
    c.onclick = () => {
      catFilter = c.dataset.cat;
      app.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('sel', x === c));
      paintHomeCatalog();
    };
  });
  const hq = document.getElementById('hq');
  hq.addEventListener('input', () => {
    query = hq.value;
    paintHomeCatalog();
  });
  hq.addEventListener('focus', () => { queryFocus = true; });
  hq.addEventListener('blur', () => { queryFocus = false; });
  if (queryFocus) {
    hq.focus();
    hq.setSelectionRange(hq.value.length, hq.value.length);
  }
  document.getElementById('grpSel').onchange = (e) => {
    homeGroup = e.target.value;
    paintHomeCatalog();
  };
  document.getElementById('hsortSel').onchange = (e) => {
    sortMode = e.target.value;
    paintHomeCatalog();
  };
  document.getElementById('hcustTog').onclick = (e) => {
    customOnly = !customOnly;
    e.currentTarget.classList.toggle('sel', customOnly);
    e.currentTarget.setAttribute('aria-pressed', String(customOnly));
    paintHomeCatalog();
  };
  for (const draft of drafts) {
    const el = document.getElementById(draft.id);
    el.value = draft.value;
    if (draft.focused) { el.focus({ preventScroll: true }); el.setSelectionRange(draft.start, draft.end); }
  }
  paintHomeCatalog();
  wireGameCards(app);
  // Home paints are rare (boot, catalog arrival, browse toggle) — a gentle
  // entrance each time stays delightful without ever firing on repaints.
  staggerIn(app.querySelector('.pick-grid'), '.pick');
  staggerIn(app.querySelector('.catalog-list'), '.catrow');
}

/* Shared invite-link copy for the rail button, the Invite-N-more actions,
 * and the single-player hint. Standalone only — embedded rooms never render
 * these controls. */
function copyInvite() {
  (async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      toast('Invite link copied');
    } catch { toast('Copy the URL from the address bar'); }
  })();
}

const CAT_LABELS = {
  vote: 'Vote', bluff: 'Bluff', word: 'Word', speed: 'Speed',
  draw: 'Draw', social: 'Social', board: 'Board', '3d': '3D',
};

function catLabel(c) {
  return CAT_LABELS[c] || (c ? c[0].toUpperCase() + c.slice(1) : '');
}

/* Category chips derive from the live catalog so board/3d/new manifest
 * games slot in without shell edits. */
function liveCats() {
  const order = ['vote', 'bluff', 'word', 'speed', 'draw', 'social'];
  const seen = new Set(games.map((g) => g.cat));
  const cats = [['all', 'All']];
  if (games.some(g => g.communication === 'video')) cats.push(['camera', 'Camera']);
  for (const c of order) if (seen.has(c)) cats.push([c, catLabel(c)]);
  for (const c of [...seen].sort()) {
    if (!order.includes(c)) cats.push([c, catLabel(c)]);
  }
  return cats;
}

/* Shared catalog matching: search covers name + tagline + category label
 * (real metadata only — no invented tags/stats), case-insensitive. */
function matchesQuery(g, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  return (g.name + ' ' + g.tagline + ' ' + catLabel(g.cat) + (g.communication === 'video' ? ' camera video' : '')).toLowerCase().includes(needle);
}

/* Group fit against a live headcount: min/max is the server's start gate.
 * fitKind splits the honest cases — everyone plays vs. players +
 * watchers (seat-capped games where the room overflows the seats). */
function fitsCount(g, n) {
  const { min, max } = countFor(g);
  return n >= min && n <= max;
}

function fitKind(g, n) {
  if (!fitsCount(g, n)) return 2;
  if (Number.isInteger(g.seats) && g.seats >= 1 && n > g.seats) return 1;
  return 0;
}

/* Home has no room, so the desired size is explicit: a game matches when
 * its player range OVERLAPS the picked range (intersection semantics). */
const HOME_GROUPS = [
  ['any', 'Any size'], ['2', '2 players'], ['3-4', '3–4 players'],
  ['5-8', '5–8 players'], ['9+', '9+ players'],
];

function homeGroupRange() {
  if (homeGroup === '2') return [2, 2];
  if (homeGroup === '3-4') return [3, 4];
  if (homeGroup === '5-8') return [5, 8];
  if (homeGroup === '9+') return [9, 99];
  return null;
}

function matchesHomeGroup(g) {
  const r = homeGroupRange();
  if (!r) return true;
  const { min, max } = countFor(g);
  return min <= r[1] && max >= r[0];
}

/* Honest sorts over real metadata. Shelf order is the live catalog order
 * (the default); every sort is stable on ties via catalog position. */
function sortCatalog(list, mode, n) {
  if (mode !== 'name' && mode !== 'fewest' && mode !== 'fits') return list;
  const pos = new Map(games.map((g, i) => [g.id, i]));
  const at = (g) => (pos.has(g.id) ? pos.get(g.id) : 9999);
  const key = mode === 'name'
    ? (g) => g.name.toLowerCase()
    : mode === 'fewest' ? (g) => countFor(g).min
    : (g) => fitKind(g, n);
  return [...list].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return at(a) - at(b);
  });
}

function connectedCount() {
  return room ? room.players.filter((p) => p.connected).length : 0;
}

/* Honest communication hints derived from catalog metadata only. */
function vibeFor(g) {
  const base = {
    vote: 'Everyone votes', bluff: 'Bluff, then vote', word: 'Wordplay',
    speed: 'Fast rounds', draw: 'Draw live', social: 'Talk it out',
    board: 'Board game', '3d': '3D arena',
  }[g.cat] || 'Party game';
  const bits = [base];
  if (g.communication === 'video') bits.push('Great on video');
  else if (g.communication === 'voice') bits.push('Voice recommended');
  return bits.join(' · ');
}

/* Seat-capped games (chess): the catalog names the active seats, never the
 * room size — "2 play · watchers welcome" instead of "2–24 players". */
function seatsLine(g) {
  if (Number.isInteger(g.seats) && g.seats >= 1) {
    const min = countFor(g).min;
    const active = min < g.seats ? `${min}–${g.seats}` : `${g.seats}`;
    return `${active} play · watchers welcome`;
  }
  return `${esc(g.players)} players`;
}

function countFor(g) {
  if (Number.isInteger(g.minPlayers) && Number.isInteger(g.maxPlayers)) {
    return { min: g.minPlayers, max: g.maxPlayers };
  }
  const m = /(\d+)\D+(\d+)/.exec(g.players || '');
  return m ? { min: Number(m[1]), max: Number(m[2]) } : { min: 2, max: 20 };
}

function eligibleGames(n) {
  const played = playedIds();
  return games
    .filter((g) => {
      const { min, max } = countFor(g);
      return n >= min && n <= max;
    })
    .sort((a, b) => (played.includes(a.id) - played.includes(b.id)) || (a.name < b.name ? -1 : 1));
}

function configNoteText(g) {
  const c = room && room.config && room.config[g.id];
  if (!c) return '';
  if (g.id === 'pocket-karts') return kartSetupSummary(g, c.settings || {});
  const labels = {};
  for (const s of (g.schema && g.schema.settings) || []) labels[s.key] = s.label || s.key;
  for (const p of (g.schema && g.schema.packs) || []) labels[p.key] = p.label || p.key;
  const bits = [];
  for (const [k, v] of Object.entries(c.settings || {})) {
    if (v === null || v === undefined) continue;
    if (k === 'rounds') bits.push(`${v} ${v === 1 ? 'round' : 'rounds'}`);
    else if (k === 'roundSeconds') bits.push(`${v % 60 === 0 ? v / 60 + ' min' : v + ' sec'}/round`);
    else if (k === 'maxQuestions') bits.push(`${v} questions`);
    else if (k === 'hints') bits.push(`Hints ${v ? 'on' : 'off'}`);
    else bits.push(`${(labels[k] || k).replace(/\s*\([^)]*\)/g, '')}: ${typeof v === 'boolean' ? (v ? 'on' : 'off') : v}`);
  }
  for (const [k, n] of Object.entries(c.packs || {})) bits.push(`${n} ${labels[k] || k}`);
  return bits.length ? `Custom: ${bits.join(' · ')}` : '';
}

function cardHtml(g) {
  const played = playedIds();
  const { min, max } = countFor(g);
  const seated = Number.isInteger(g.seats) && g.seats >= 1;
  const seatText = seated ? seatsLine(g) : `${min}–${max} players`;
  // Single-action card for every seat: the whole card opens the shared
  // setup dialog, so guests and short groups can always read the rules.
  // Host/min-player/room gating lives inside the dialog, never here — no
  // disabled cards to guess about, no shelf setup badges.
  return `
    <button type="button" class="gamepick card-open" data-how="${g.id}" aria-haspopup="dialog">
      ${played.includes(g.id) ? '<span class="played">✓ Played</span>' : ''}
      ${artImg(g, 'gart')}
      <span class="t">${esc(g.name)}</span>
      <span class="d">${esc(g.tagline)}</span>
      <span class="p">${seatText}</span>
      <span class="play-row"><span class="play-pill">Play</span></span>
    </button>`;
}

/* Room catalog: the whole live list filtered by category, search,
 * Fits-our-N, and customizable — then sorted. Search always covers ALL
 * games, never just the visible page. */
function filteredGames() {
  const n = connectedCount();
  const list = games.filter((g) =>
    (catFilter === 'all' || (catFilter === 'camera' ? g.communication === 'video' : g.cat === catFilter)) &&
    matchesQuery(g, query) &&
    (!customOnly || g.customizable) &&
    (!fitsOnly || fitsCount(g, n)));
  return sortCatalog(list, sortMode, n);
}

function lobbyFiltered() {
  return query.trim() !== '' || catFilter !== 'all' || customOnly || fitsOnly;
}

function clearLobbyFilters() {
  query = '';
  catFilter = 'all';
  customOnly = false;
  fitsOnly = false;
}

/* Sync the toolbar controls to state (after Clear-all) without touching
 * focus — only results/count repaint on typing. */
function syncLobbyControls() {
  const inp = document.getElementById('q');
  if (inp && inp.value !== query) inp.value = query;
  document.querySelectorAll('[data-cat]').forEach((x) =>
    x.classList.toggle('sel', x.dataset.cat === catFilter));
  const sel = document.getElementById('sortSel');
  if (sel) sel.value = sortMode;
  for (const [id, on] of [['fitsTog', fitsOnly], ['custTog', customOnly]]) {
    const b = document.getElementById(id);
    if (b) {
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
}

/* Repaint only the catalog (search/filter/sort) so typing never loses
 * focus — the hero/name/code inputs and toolbar are never rebuilt here. */
function paintCatalog() {
  const box = document.getElementById('ggames');
  if (!box) return;
  const list = filteredGames();
  const count = document.getElementById('catCount');
  if (count) {
    count.textContent = list.length === games.length && !lobbyFiltered()
      ? `${games.length} games`
      : `${list.length} of ${games.length} games`;
  }
  box.innerHTML = list.length ? list.map(cardHtml).join('')
    : `<div class="empty-note">No games match${query.trim() ? ` “${esc(query.trim())}”` : ' these filters'}.
        <div class="row mt" style="justify-content:center">
          <button class="btn ghost" id="bClearQ">Clear search &amp; filters</button>
        </div></div>`;
  const clr = document.getElementById('bClearQ');
  if (clr) clr.onclick = () => {

    clearLobbyFilters();
    syncLobbyControls();
    paintCatalog();
  };
  wireGameCards(box);
}

/* Home shelf: same shared search/category/customizable state, plus the
 * explicit desired group size (range overlap). Any active search, filter,
 * or non-default sort shows ALL matches; the browse toggle only pages
 * the untouched shelf. */
function homeFiltered() {
  return query.trim() !== '' || catFilter !== 'all' || customOnly ||
    homeGroup !== 'any' || sortMode !== 'shelf';
}

function homeGames() {
  const list = games.filter((g) =>
    (catFilter === 'all' || (catFilter === 'camera' ? g.communication === 'video' : g.cat === catFilter)) &&
    matchesQuery(g, query) &&
    (!customOnly || g.customizable) &&
    matchesHomeGroup(g));
  const sorted = sortCatalog(list, sortMode === 'fits' ? 'shelf' : sortMode, 0);
  return homeFiltered() ? sorted : (browseAll ? sorted : sorted.slice(0, 8));
}

function clearHomeFilters() {
  query = '';
  catFilter = 'all';
  customOnly = false;
  homeGroup = 'any';
  sortMode = 'shelf';
}

function syncHomeControls() {
  const inp = document.getElementById('hq');
  if (inp && inp.value !== query) inp.value = query;
  document.querySelectorAll('[data-cat]').forEach((x) =>
    x.classList.toggle('sel', x.dataset.cat === catFilter));
  const grp = document.getElementById('grpSel');
  if (grp) grp.value = homeGroup;
  const sel = document.getElementById('hsortSel');
  if (sel) sel.value = sortMode;
  const b = document.getElementById('hcustTog');
  if (b) {
    b.classList.toggle('sel', customOnly);
    b.setAttribute('aria-pressed', String(customOnly));
  }
}

/* Results + count + browse-row only: typing never rebuilds the toolbar,
 * the hero ticket, or the picks above. */
function paintHomeCatalog() {
  const box = document.getElementById('shelfGames');
  if (!box) return;
  if (!catalogLoaded) {
    const failed = connLost;
    document.getElementById('shelfCount').textContent = failed ? 'Games unavailable' : 'Loading games…';
    box.setAttribute('aria-busy', String(!failed));
    box.innerHTML = `<div class="empty-note" role="${failed ? 'alert' : 'status'}">${failed ? 'Can’t reach the games yet. Check your connection; we’ll retry automatically.' : 'Loading the game shelf…'}</div>`;
    const wrap = document.getElementById('browseWrap');
    if (wrap) wrap.hidden = true;
    return;
  }
  box.setAttribute('aria-busy', 'false');
  const list = homeGames();
  const count = document.getElementById('shelfCount');
  if (count) {
    count.textContent = !homeFiltered() && !browseAll && list.length < games.length
      ? `Showing ${list.length} of ${games.length} games`
      : `${list.length} of ${games.length} games`;
  }
  box.innerHTML = list.length ? list.map(catalogRowHtml).join('')
    : `<div class="empty-note">No games match${query.trim() ? ` “${esc(query.trim())}”` : ' these filters'}.
        <div class="row mt" style="justify-content:center">
          <button class="btn ghost" id="bClearHQ">Clear search &amp; filters</button>
        </div></div>`;
  const clr = document.getElementById('bClearHQ');
  if (clr) clr.onclick = () => {

    clearHomeFilters();
    syncHomeControls();
    paintHomeCatalog();
  };
  const wrap = document.getElementById('browseWrap');
  if (wrap) wrap.hidden = homeFiltered();
  wireGameCards(box);
}

function featuredHtml() {
  const n = room.players.filter((p) => p.connected).length;
  const elig = eligibleGames(n).slice(0, 3);
  // A group of friends gets three honest art-led picks across the full
  // width; a solo guest gets one small inline hint, never a giant card.
  if (n >= 2 && elig.length) {
    // Single-action recommendations: one button per pick, opening the
    // shared setup dialog like every other card. Gating lives inside.
    return `<div class="feat-strip">` + elig.map((g) => `
      <button type="button" class="gamepick gstart feat card-open" data-how="${g.id}" aria-haspopup="dialog">
        ${artImg(g, 'featart')}
        <span class="ftext"><span class="t">${esc(g.name)}</span>
        <span class="d">${esc(g.tagline)}</span>
        <span class="p">Fits ${n} players</span></span>
        <span class="play-pill">Play</span>
      </button>`).join('') + `</div>`;
  }
  const next = games.map((g) => ({ g, ...countFor(g) }))
    .filter((x) => x.min > n)
    .sort((a, b) => a.min - b.min)[0];
  const line = next
    ? `Invite ${next.min - n} more friend${next.min - n === 1 ? '' : 's'} to unlock ${esc(next.g.name)}`
    : 'Everyone fits everywhere — browse the full catalog below.';
  const btn = EMBED.enabled ? '' : `<button class="btn" data-invite>Copy invite link</button>`;
  return `<div class="invite-hint"><span>${line}</span>${btn}</div>`;
}

function renderLobby() {
  const chips = catChipsHtml();
  const n = room.players.filter((p) => p.connected).length;
  const hostSeat = room.players.find((p) => p.id === room.hostId);
  const hostName = hostSeat ? hostSeat.name : '…';
  // One-shot motion bookkeeping: a fresh room code arms the strip pop +
  // stagger; a same-room repaint only diffs the roster for join rings.
  const newRoom = room.code !== lastLobbyKey;
  const ids = new Set(room.players.filter((p) => p.connected).map((p) => p.id));
  let spot = null;
  if (!newRoom) {
    spot = new Set([...ids].filter((id) => !prevLobbyIds.has(id)));
    if (spot.size) {
      const names = room.players.filter((p) => spot.has(p.id)).map((p) => p.name);
      announce(`${names.join(', ')} joined the room.`);
    }
  }
  prevLobbyIds = ids;
  lastLobbyKey = room.code;
  // The celebration fires exactly once: the paint that arrives from the
  // home screen (manual create/join). Reload autojoin lands here with no
  // previous screen and stays quiet.
  const celebrate = newRoom && lastScreen === 'home';
  // Standalone share: copy button + native share + QR in a disclosure
  // popover (the SVG is generated locally by /qr.svg — no third party).
  // Embedded rooms are private to the squad: compact context only, no
  // shareable code/link/QR.
  const qrAlt = `QR code linking to this room (code ${room.code})`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const wait = isHost() || room.game ? '' : '<span class="waitpill">Waiting for the host to pick a game…</span>';
  const status = isHost()
    ? (n <= 1 ? 'You\u2019re hosting — invite friends to start the party' : `You\u2019re hosting · ${n} in the room`)
    : `${hostName} is hosting · ${n} in the room`;
  const stripInner = EMBED.enabled ? `
      <div class="ps-invite embedctx"><span class="roomcode roomcode-private">Squad night</span><span class="ps-status">Host ${esc(hostName)} · ${n} playing</span></div>
      <div class="ps-party">${embedPlayerChips(room.players, spot)}${wait}</div>` : `
      <div class="ps-invite">
        <div class="ps-codeblock">
          <div class="roommeta">Room code</div>
          <div class="roomcode">${esc(room.code)}</div>
        </div>
        <div class="ps-actions">
          <button class="btn sun bCopy">Copy invite link</button>
          ${canShare ? '<button class="btn ghost bShare">Share</button>' : ''}
          <details class="sharefold qrpop">
            <summary>QR code</summary>
            <div class="qrpop-card"><img src="/qr.svg?code=${esc(room.code)}" alt="${esc(qrAlt)}" width="168" height="168" loading="lazy" onerror="this.closest('details').remove()"></div>
          </details>
          <button type="button" class="btn ghost" id="bLobbyLeave" data-nav>Leave</button>
        </div>
      </div>
      <div class="ps-party">
        <div class="ps-status">${esc(status)}</div>
        ${playerChips(room.players, room.totals, spot)}
        ${wait}
      </div>`;
  const running = room.game ? `<section class="lobby-running" role="status">
        <p><b>${esc(gameName(room.game))} ${matchOver() ? 'has ended' : 'is being played'}.</b> <span>You left this game; you play the next one.</span></p>
        <button type="button" class="btn ghost" id="bWatch">Watch</button>
      </section>` : '';
  app.innerHTML = topbar() + `
    <div class="lobby">
      ${running}
      <section class="partystrip${celebrate ? ' pop' : ''}" aria-label="Room invitation">${stripInner}${isHost() ? '<details class="room-manage"><summary>Manage players</summary><div id="roomMembers" class="room-members"></div></details>' : ''}</section>
      <section aria-label="Recommended for your group">
        <div class="rec-head"><h2>For your group of ${n}</h2></div>
        <div id="feat">${featuredHtml()}</div>
      </section>
      <section aria-label="All games">
        <div class="sec-head"><h2>All games</h2><span class="count-pill" id="catCount">${games.length} games</span></div>
        <div class="catbar">
          <input id="q" type="text" placeholder="Search games…" value="${esc(query)}" autocomplete="off" aria-label="Search games">
          <select id="sortSel" aria-label="Sort games">${sortOptions(true)}</select>
          <button class="chip ${fitsOnly ? 'sel' : ''}" id="fitsTog" aria-pressed="${fitsOnly}" title="Only games your group can start right now">Fits our ${n}</button>
          <button class="chip ${customOnly ? 'sel' : ''}" id="custTog" aria-pressed="${customOnly}">Customizable</button>
        </div>
        <div class="catchips" role="group" aria-label="Game categories">${chips}</div>
        <div class="grid-games" id="ggames"></div>
      </section>
    </div>
    ${meetFooter()}`;
  if (celebrate && !EMBED.enabled) confetti();
  const watch = document.getElementById('bWatch');
  if (watch) watch.onclick = () => { watchInstance = instanceId; render(); };
  renderRoomMembers();
  app.querySelectorAll('.bCopy').forEach((b) => { b.onclick = copyInvite; });
  app.querySelectorAll('.bShare').forEach((b) => {
    b.onclick = async () => {

      try {
        await navigator.share({ title: 'Game Night', text: `Join my game night — room ${room.code}`, url: location.href });
      } catch { /* dismissed — the copy button is right beside it */ }
    };
  });
  app.querySelectorAll('[data-cat]').forEach((c) => {
    c.onclick = () => {
      catFilter = c.dataset.cat;
      app.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('sel', x === c));
      paintCatalog();
    };
  });
  document.getElementById('sortSel').onchange = (e) => {
    sortMode = e.target.value;
    paintCatalog();
  };
  document.getElementById('fitsTog').onclick = (e) => {
    fitsOnly = !fitsOnly;
    e.currentTarget.classList.toggle('sel', fitsOnly);
    e.currentTarget.setAttribute('aria-pressed', String(fitsOnly));
    paintCatalog();
  };
  document.getElementById('custTog').onclick = (e) => {
    customOnly = !customOnly;
    e.currentTarget.classList.toggle('sel', customOnly);
    e.currentTarget.setAttribute('aria-pressed', String(customOnly));
    paintCatalog();
  };
  const q = document.getElementById('q');
  q.addEventListener('input', () => {
    query = q.value;
    paintCatalog();
  });
  q.addEventListener('focus', () => { queryFocus = true; });
  q.addEventListener('blur', () => { queryFocus = false; });
  if (queryFocus) {
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }
  paintCatalog();
  const feat = document.getElementById('feat');
  if (feat) wireGameCards(feat);
  // Fresh-room entrance only: roster repaints and search typing reuse
  // these containers, and must never replay the stagger.
  if (newRoom) {
    staggerIn(document.getElementById('ggames'), '.gamepick');
    staggerIn(feat, '.gamepick, .invite-hint');
  }
}

function gameById(id) {
  return games.find((g) => g.id === id);
}

function consumeBootEntry() {
  if (!BOOT_ENTRY || bootEntryConsumed || !games.length) return;
  const validated = validateGameEntry(BOOT_ENTRY, games);
  if (!validated.ok) {
    bootEntryConsumed = true;
    history.replaceState(null, '', location.pathname + stripGameEntryParams(location.search));
    roomCode = '';
    toast(validated.reason === 'bad-name' ? 'Choose a party name of 1–16 characters.' : 'That game is unavailable. Pick one from the shelf.');
    return;
  }
  const decision = decideGameEntryCreate({
    validated, wsReady: !!ws && ws.readyState === 1,
    catalogReady: true, inRoom: !!room, consumed: bootEntryConsumed,
  });
  if (decision.action !== 'create') return;
  bootEntryConsumed = true;
  myName = decision.name;
  roomCode = '';
  history.replaceState(null, '', location.pathname + stripGameEntryParams(location.search));
  setPendingGameEntry(decision);
  send({ t: 'create', name: myName });
}

function consumeGameEntry() {
  if (!room || room.game || !games.length) return;
  const pending = takePendingGameEntry();
  const decision = decideGameEntryShow({ pending, inLobby: true, catalog: games });
  if (decision.action !== 'show') return;
  const g = gameById(decision.gameId);
  query = g.name;
  catFilter = 'all';
  fitsOnly = false;
  customOnly = false;
  render();
  const opener = document.querySelector(`[data-how="${g.id}"]`);
  if (decision.open === 'customizer') openCustomizerFor(g.id, opener);
  else openHowtoDialog(g.id, opener);
}

function paintVoice() {
  const button = document.getElementById('bVoice');
  if (!button) return;
  const status = voiceClient.getStatus();
  const labels = { active: '🎙️ Mic on', off: '🎙️ Talk together', denied: '🎙️ Mic blocked', unavailable: '🎙️ Mic unavailable' };
  const label = !embedAuthed ? '🎙️ Connecting…' : (labels[status.mic] || '🎙️ Talk together');
  button.innerHTML = '🎙️ <span class="voice-label">' + esc(label.replace(/^🎙️ /, '')) + '</span>';
  button.disabled = !embedTrusted || !embedAuthed;
  button.title = status.hint || 'Use the microphone in your Giggle call';
  button.setAttribute('aria-label', label);
  button.onclick = () => {
    const result = voiceClient.request();
    if (!result.ok) toast(status.hint || STANDALONE_VOICE_HINT);
  };
}

function gameDetails(g) {
  const href = detailsHref(g.id);
  return !EMBED.enabled && href ? `<a class="howto-btn details-link" href="${href}" aria-label="About ${esc(g.name)}">Details ↗</a>` : '';
}

function wireGameCards(root) {
  // Single-action cards: the whole card opens the shared setup dialog
  // (rules + Customize + contextual Play/Create). No direct start from
  // the shelf — host/min-player/room gating lives inside the dialog.
  root.querySelectorAll('[data-how]').forEach((b) => {
    b.onclick = () => {

      openHowtoDialog(b.dataset.how, b);
    };
  });
  // Invite actions (single-player hint): standalone only — embedded rooms
  // never render these controls.
  root.querySelectorAll('[data-invite]').forEach((b) => {
    b.onclick = () => copyInvite();
  });
}

/* Customize from the setup dialog: in a room the customizer opens at
 * once; on home the tap names the game, then the ticket name creates the
 * room and the first room snapshot opens that game's dialog. Never starts. */
function customizeTap(gameId, opener) {
  const g = gameById(gameId);
  const nmEl = document.getElementById('nm');
  const decision = decideCustomizeIntent({
    inRoom: !!room,
    name: nmEl ? nmEl.value : myName,
    gameId,
    customizable: !!(g && g.customizable),
  });
  if (decision.action === 'open') {
    openCustomizerFor(decision.gameId, opener);
  } else if (decision.action === 'name-needed') {
    toast('Pick a party name first — then tune the setup');
    try { window.scrollTo(0, 0); } catch { /* no window (tests) */ }
    if (nmEl) api.focus(nmEl);
  } else if (decision.action === 'create') {
    myName = decision.name;
    setPendingCustomize(decision.gameId);
    send({ t: 'create', name: decision.name });
  }
}

/* First room snapshot after a home Customize tap opens the chosen game's
 * dialog for the fresh host. Runs after the lobby paints, so focus can
 * return to the live card button. */
function consumePendingCustomize() {
  const pending = takePendingCustomize();
  if (!pending || !room || room.game || !isHost()) return;
  const g = gameById(pending);
  if (!g || !g.customizable) return;
  openCustomizerFor(pending, document.querySelector(`[data-how="${pending}"]`));
}

/* One customizer entry for cards AND the howto dialog's Customize action —
 * the panels never stack (each open closes the other). */
function openCustomizerFor(gameId, opener) {
  const g = gameById(gameId);
  if (!g || !room) return;
  closeHowto({ returnFocus: false });
  openCustomizer({
    game: g,
    config: room.config,
    host: isHost(),
    initialField: g.schema?.settings?.some((s) => s.key === 'map') ? 'map' : undefined,
    opener,
    toast,
    onSave: (gid, settings, pack, requestId) => {
      if (!ws || ws.readyState !== 1) return false;
      send({ t: 'configure', game: gid, settings, pack, requestId });
      return true;
    },
    onReset: (gid, requestId) => {
      if (!ws || ws.readyState !== 1) return false;
      send({ t: 'configure', game: gid, reset: true, requestId });
      return true;
    },
    onClearPack: (gid, key) => {
      send({ t: 'configure', game: gid, pack: { [key]: null } });
    },
  });
}

/* Setup dialog footer: one honest context CTA. Home creates a real
 * room for this game (re-shown in the lobby, never auto-started); a host
 * gets Play only when the live count passes the same min/max gate the
 * server enforces; a short host gets the exact friends-needed count plus
 * invite/customize; guests get the truth in words, never a
 * working-looking button. Rebuilt on every roster tick. */
function howtoFooter(game) {
  const settingsLabel = game.schema?.settings?.some((s) => s.key === 'map') ? 'Maps & settings' : 'Customize';
  // Details lives INSIDE the dialog (never on the shelf); embed renders
  // nothing so no link leaks out of the squad frame.
  const details = gameDetails(game);
  if (!room) {
    const custom = game.customizable
      ? `<button class="btn ghost" id="howtoCustom">${settingsLabel}</button>` : '';
    const name = document.getElementById('nm')?.value || myName;
    return {
      html: `<label class="howto-name" for="howtoName">Your party name
        <input type="text" id="howtoName" maxlength="16" autocomplete="nickname" enterkeyhint="go" placeholder="e.g. Pippa" required value="${esc(name)}"></label>
        <button class="btn big" id="howtoGo">Create room</button>${custom}${details}
        <p class="howto-note">Share the room link with friends, then press Play.</p>`,
      wire(foot) {
        const create = (wantSetup) => {
          const input = foot.querySelector('#howtoName');
          const name = input.value.trim();
          if (!name) {
            toast('Pick a party name first');
            api.focus(input);
            return;
          }

          myName = name.slice(0, 16);
          setPendingGameEntry({ gameId: game.id, name: myName, wantSetup });
          closeHowto({ returnFocus: false });
          send({ t: 'create', name: myName });
        };
        foot.querySelector('#howtoGo').onclick = () => create(false);
        foot.querySelector('#howtoName').onkeydown = (e) => {
          if (e.key === 'Enter') { e.preventDefault(); create(false); }
        };
        const c = foot.querySelector('#howtoCustom');
        if (c) c.onclick = () => create(true);
      },
    };
  }
  const { min, max } = countFor(game);
  const n = room.players.filter((p) => p.connected).length;
  const fits = n >= min && n <= max;
  const host = isHost();
  if (room.game) {
    // A match is still running (this player left it): no second start.
    const custom = game.customizable ? `<button class="btn ghost" id="howtoCustom">${settingsLabel}</button>` : '';
    return {
      html: `${custom}${details}<p class="howto-note">${esc(gameName(room.game))} is being played. Pick the next game when it ends.</p>`,
      wire(foot) {
        const c = foot.querySelector('#howtoCustom');
        if (c) c.onclick = () => openCustomizerFor(game.id, document.querySelector(`[data-how="${game.id}"]`));
      },
    };
  }
  const seated = Number.isInteger(game.seats) && game.seats >= 1;
  // Shortage honesty: name exactly how many more friends it takes — never
  // a working-looking Play when the group can't start.
  const shortBy = min - n;
  const fitLine = !fits
    ? (n < min
      ? `Invite ${shortBy} more friend${shortBy === 1 ? '' : 's'} to play ${game.name}`
      : `${game.name} needs ${min}–${max} players (you have ${n})`)
    : (seated && n > game.seats) ? `${n} here — ${game.seats} play, the rest watch`
    : `Fits your group of ${n}`;
  const custom = game.customizable
    ? `<button class="btn ghost" id="howtoCustom">${settingsLabel}</button>` : '';
  if (host && fits) {
    return {
      html: `<button class="btn big" id="howtoGo">Play</button>${custom}${details}
        <p class="howto-note">${esc(fitLine)}</p>`,
      wire(foot) {
        foot.querySelector('#howtoGo').onclick = () => {
          markPlayed(game.id);
          send({ t: 'start', game: game.id, ready: true });
          closeHowto({ returnFocus: false });
        };
        const c = foot.querySelector('#howtoCustom');
        if (c) c.onclick = () => {

          openCustomizerFor(game.id, document.querySelector(`[data-how="${game.id}"]`));
        };
      },
    };
  }
  if (host) {
    const invite = EMBED.enabled ? '' : `<button class="btn sun" id="howtoInvite">Copy invite link</button>`;
    return {
      html: `<button class="btn big" id="howtoGo" disabled title="${esc(fitLine)}">Play</button>${invite}${custom}${details}
        <p class="howto-note">${esc(fitLine)}</p>`,
      wire(foot) {
        const v = foot.querySelector('#howtoInvite');
        if (v) v.onclick = () => copyInvite();
        const c = foot.querySelector('#howtoCustom');
        if (c) c.onclick = () => {

          openCustomizerFor(game.id, document.querySelector(`[data-how="${game.id}"]`));
        };
      },
    };
  }
  return {
    html: `${custom}${details}<p class="howto-note">Only the host can start games. ${esc(fitLine)}</p>`,
    wire(foot) {
      const c = foot.querySelector('#howtoCustom');
      if (c) c.onclick = () => {

        openCustomizerFor(game.id, document.querySelector(`[data-how="${game.id}"]`));
      };
    },
  };
}

/* The Play tab's line: settings guidance, or why Play is not offered. */
function howtoIntro(g) {
  if (room?.game) return `${gameName(room.game)} is being played. The next game starts when it ends.`;
  if (!g.customizable) return '';
  if (!room) return 'Create a room and invite your friends. Choose your settings before playing.';
  return isHost() ? 'Choose your settings, then play together.' : 'The host will start the game for everyone.';
}

function openHowtoDialog(gameId, opener) {
  const g = gameById(gameId);
  if (!g) return;
  openHowto({
    game: g,
    opener,
    meta: { seats: seatsLine(g), vibe: vibeFor(g), custom: configNoteText(g), intro: howtoIntro(g) },
    buildFooter: (game) => howtoFooter(game),
  });
}

/* Mid-game room snapshots (joins, host migration): patch the Change-game
 * button states without rebuilding the running view. */
function renderHostStates() {
  for (const id of ['bLobby', 'bRematch', 'bChange', 'bEndConfirm']) {
    const b = document.getElementById(id);
    if (b) {
      b.disabled = !isHost() || !!pendingRoomAction;
      b.title = isHost() ? '' : 'Only the host can do this';
      if (id === 'bLobby') {
        b.hidden = !isHost();
        b.textContent = pendingRoomAction?.kind === 'lobby' ? 'Changing…' : pendingRoomAction?.kind === 'end' ? 'Ending…' : matchOver() ? 'Change game' : 'End game';
      }
      if (id === 'bRematch') { b.hidden = !isHost(); b.textContent = pendingRoomAction?.kind === 'rematch' ? 'Starting…' : 'Rematch'; }
      if (id === 'bChange') { b.hidden = !isHost(); b.textContent = pendingRoomAction?.kind === 'lobby' ? 'Changing…' : 'Change game'; }
    }
  }
  // A finished match needs no End game confirmation any more.
  if (menuConfirm === 'end' && (matchOver() || !isHost())) { menuConfirm = null; paintMenuConfirm(); }
  const requestStatus = document.getElementById('roomRequestStatus');
  if (requestStatus) {
    requestStatus.hidden = !pendingRoomAction;
    requestStatus.textContent = pendingRoomAction?.kind === 'rematch' ? 'Starting rematch…' : pendingRoomAction?.kind === 'end' ? 'Ending the game…' : 'Going back to the game list…';
  }
  const context = document.getElementById('gContext');
  if (context && lastState) {
    const host = room && room.players.find((p) => p.id === room.hostId);
    const count = lastState.players?.length || 0;
    const watchers = lastState.spectators?.length || 0;
    const where = !EMBED.enabled ? `Room ${room?.code || ''}` : (lastState.spectator ? 'Watching' : 'Squad game');
    context.textContent = `${where} · ${count} playing${watchers ? ` · ${watchers} watching` : ''} · Host ${host?.name || '—'}`;
  }
  const role = document.getElementById('playRole');
  if (role && lastState) role.hidden = !lastState.spectator;
  const note = document.getElementById('hostWait');
  if (note) {
    note.hidden = isHost();
    const host = room && room.players.find((p) => p.id === room.hostId);
    note.textContent = `Waiting for ${host ? host.name : 'the host'} to start a rematch or pick another game`;
  }
}

let focusGame = null;
let kickConfirmation = null, pendingKick = null, kickTimer = 0, kickSequence = 0, lastKickRequestId = null;

function clearKickRequest() {
  clearTimeout(kickTimer);
  kickTimer = 0;
  pendingKick = null;
}

function kickEndsMatch(pid) {
  if (!room?.game || !room.participants?.some(p => p.id === pid)) return false;
  return room.game !== 'pocket-karts' || room.participants.filter(p => p.connected && p.id !== pid).length < 2;
}

function roomKickResult(result) {
  if (!lastKickRequestId || result.requestId !== lastKickRequestId) return false;
  lastKickRequestId = null;
  clearKickRequest();
  if (!result.error) { kickConfirmation = null; toast('Player removed.'); }
  renderRoomMembers();
  return true;
}

function renderRoomMembers() {
  const el = document.getElementById('roomMembers');
  if (!el) return;
  const current = room?.instanceId || null;
  const members = room?.players || [];
  if (kickConfirmation && (kickConfirmation.i !== current || !members.some(p => p.id === kickConfirmation.pid))) kickConfirmation = null;
  if (pendingKick && (pendingKick.i !== current || !members.some(p => p.id === pendingKick.pid))) clearKickRequest();
  const disabled = !!pendingKick || ws?.readyState !== 1;
  const html = !isHost() ? '' : '<h3>Players in this room</h3>' + members.map(p => {
    const watching = room.game && !room.participants?.some(a => a.id === p.id);
    const confirm = kickConfirmation?.pid === p.id;
    return `<div class="room-member"><div class="room-member-row"><span>${esc(p.name)}<small>${p.id === you ? 'Host · you' : !p.connected ? 'Away' : watching ? 'Watching' : room.game ? 'Playing' : 'In the room'}</small></span>${p.id === you ? '' : `<button type="button" class="room-remove" data-kick="${p.id}" ${disabled ? 'disabled' : ''} aria-label="Remove ${esc(p.name)}">Remove</button>`}</div>${confirm ? `<div class="room-kick-confirm" role="group" aria-label="Confirm removal"><p>Remove ${esc(p.name)} from this room?${kickEndsMatch(p.id) ? (lastState?.instanceId === current && lastState.phase === 'done' ? ' The room will return to the lobby.' : ' Current match will end.') : ''}</p><div><button type="button" data-kick-confirm="${p.id}" ${disabled ? 'disabled' : ''}>${pendingKick ? 'Removing…' : 'Remove player'}</button><button type="button" data-kick-cancel ${pendingKick ? 'disabled' : ''}>Cancel</button></div></div>` : ''}</div>`;
  }).join('');
  if (el._membersHtml === html) return;
  const focused = el.contains(document.activeElement) ? document.activeElement : null;
  const focusKey = focused?.hasAttribute('data-kick-confirm') ? '[data-kick-confirm]' : focused?.hasAttribute('data-kick-cancel') ? '[data-kick-cancel]' : focused?.dataset.kick ? '[data-kick="'+focused.dataset.kick+'"]' : null;
  el.innerHTML = html;
  el._membersHtml = html;
  el.querySelectorAll('[data-kick]').forEach(button => { button.onclick = () => {
    if (!isHost() || pendingKick) return;
    kickConfirmation = { pid: button.dataset.kick, i: room?.instanceId || null };
    renderRoomMembers();
    el.querySelector('[data-kick-confirm]')?.focus({ preventScroll: true });
  }; });
  el.querySelector('[data-kick-cancel]')?.addEventListener('click', () => { const pid=kickConfirmation?.pid; kickConfirmation=null;renderRoomMembers();el.querySelector('[data-kick="'+pid+'"]')?.focus({preventScroll:true}); });
  el.querySelector('[data-kick-confirm]')?.addEventListener('click', () => {
    if (!isHost() || pendingKick || ws?.readyState !== 1 || !kickConfirmation || kickConfirmation.i !== (room?.instanceId || null)) return;
    pendingKick = { ...kickConfirmation };
    lastKickRequestId = 'kick-' + (++kickSequence);
    send({ t: 'kick', pid: pendingKick.pid, i: pendingKick.i, requestId: lastKickRequestId });
    kickTimer = setTimeout(() => { clearKickRequest(); renderRoomMembers(); toast('No response yet. Try again.'); }, 6000);
    renderRoomMembers();
  });
  if (focusKey) el.querySelector(focusKey)?.focus({ preventScroll: true });
}

/* The room is a utility drawer, not a second game HUD. Keep its roster,
 * cumulative awards and host controls out of the game's live objective. */
function gameRoomMenu(g, context, floating = false) {
  return `<details class="room-menu${floating ? ' room-menu-floating' : ''}" id="roomMenu">
    <summary aria-label="Room controls"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16"/></svg><span>${EMBED.enabled ? 'Squad' : 'Room'}</span></summary>
    <button type="button" class="room-menu-scrim" id="bRoomScrim" tabindex="-1" aria-label="Close room menu"></button>
    <div class="room-menu-panel" role="dialog" aria-modal="true" aria-labelledby="roomMenuTitle">
      <div class="room-menu-head"><span class="room-menu-kicker">${EMBED.enabled ? 'YOUR SQUAD' : `ROOM ${esc(room?.code || '')}`}</span><button type="button" class="room-close" id="bRoomClose" aria-label="Close room menu">×</button></div>
      <h2 id="roomMenuTitle">${esc(gameName(gameId))}</h2>
      <p id="gContext">${context}</p>
      ${lastState.spectator ? `<p class="room-watch" role="status">${esc(spectatorBanner(seatCap(g)))}</p>` : ''}
      <button type="button" class="room-resume" id="bRoomResume">${lastState.spectator ? 'Back to watching' : 'Back to game'}<span aria-hidden="true">▶</span></button>
      <div class="room-menu-actions">
        <button type="button" class="room-setting" id="bSound" aria-label="${sound.enabled ? 'Mute sound' : 'Unmute sound'}">${soundIcon(sound.enabled)}<span class="hlabel">${sound.enabled ? 'Sound on' : 'Muted'}</span></button>
        <button type="button" class="room-setting" id="bTheme" aria-label="Switch theme, current ${themeName(theme())}">${themeIcon(theme())}<span class="hlabel">${themeName(theme())}</span></button>
        <button type="button" class="room-setting" id="bGameScreen">Full screen</button>
        ${!EMBED.enabled ? '<button type="button" class="room-setting" id="bGameInvite">Invite friends</button>' : ''}
        ${EMBED.enabled && embedTrusted ? '<button type="button" class="room-setting" id="bVoice">🎙️ Talk together</button>' : ''}
        <button type="button" class="room-setting" data-report>Report an issue</button>
      </div>
      <div class="room-menu-exit">
        <button type="button" id="bLobby" ${isHost() ? '' : 'hidden disabled'}>${matchOver() ? 'Change game' : 'End game'}</button>
        <button type="button" id="bLeave">Leave</button>
      </div>
      <div id="roomConfirm" class="room-confirm" role="group" aria-labelledby="roomConfirmText" hidden></div>
      <p id="roomRequestStatus" role="status" hidden></p>
      <div id="scores" class="scoreboard"></div>
      <div id="roomMembers" class="room-members"></div>
      ${!EMBED.enabled ? '<a class="room-meet" href="https://gigglemeet.com" target="_blank" rel="noopener">Hang out on Giggle Meet ↗</a>' : ''}
    </div>
  </details>${reportButton('game-report-icon')}`;
}

/* Inline confirmations for the two match-ending choices in the drawer. */
function paintMenuConfirm() {
  const box = document.getElementById('roomConfirm');
  if (!box) return;
  const callLook = EMBED.enabled || document.body.classList.contains('is-embed');
  if (menuConfirm === 'end') {
    box.innerHTML = `<p id="roomConfirmText">End the game for everyone? Points so far are kept and everyone sees the final scores.</p>
      <div><button type="button" class="is-primary" id="bEndConfirm">End game</button><button type="button" id="bConfirmCancel">Keep playing</button></div>`;
  } else if (menuConfirm === 'leave') {
    box.innerHTML = `<p id="roomConfirmText">${callLook
      ? 'Leave this game? You go back to the game list and play the next game. Your call continues.'
      : 'Leave this game? Your seat is given up and the others play on.'}</p>
      <div><button type="button" class="is-primary" id="bLeaveConfirm">Leave</button><button type="button" id="bConfirmCancel">Stay</button></div>`;
  } else {
    box.innerHTML = '';
  }
  box.hidden = !menuConfirm;
  const end = box.querySelector('#bEndConfirm');
  if (end) end.onclick = () => {
    menuConfirm = null;
    paintMenuConfirm();
    const menu = document.getElementById('roomMenu');
    if (menu) menu.open = false;
    api.endGame();
  };
  const leave = box.querySelector('#bLeaveConfirm');
  if (leave) leave.onclick = () => leaveMatch();
  const cancel = box.querySelector('#bConfirmCancel');
  if (cancel) cancel.onclick = () => {
    const back = menuConfirm === 'end' ? 'bLobby' : 'bLeave';
    menuConfirm = null;
    paintMenuConfirm();
    document.getElementById(back)?.focus({ preventScroll: true });
  };
  box.querySelector('.is-primary')?.focus({ preventScroll: true });
  renderHostStates();
}

/* Playing in the running match right now (not watching, not left). */
function playingNow() {
  return !!lastState && !lastState.spectator && !lastState.youLeft && !matchOver();
}

function wireGameRoom() {
  if (!gameScreen) gameScreen = createGameScreen({
    beforeChange: () => document.dispatchEvent(new Event('game-screenchange')),
    notify: toast,
    paint: paintGameScreen,
    shouldRotate: () => readInputCapabilities().preferred.touch,
  });
  const menu = document.getElementById('roomMenu');
  for (const id of ['bRoomClose', 'bRoomResume', 'bRoomScrim']) {
    const b = document.getElementById(id);
    if (b) b.onclick = () => { menu.open = false; menu.querySelector('summary')?.focus({ preventScroll: true }); };
  }
  if (menu) menu.addEventListener('toggle', () => {
    if (menu.open) menu.querySelector('#bRoomResume')?.focus({ preventScroll: true });
    else if (menuConfirm) { menuConfirm = null; paintMenuConfirm(); }
  });
  const screenButton = document.getElementById('bGameScreen');
  if (screenButton) screenButton.onclick = () => {
    if (menu) menu.open = false;
    void gameScreen.toggle();
  };
  paintGameScreen(gameScreen.state());
  const invite = document.getElementById('bGameInvite');
  if (invite) invite.onclick = () => copyInvite();
  const lobby = document.getElementById('bLobby');
  if (lobby) lobby.onclick = () => {
    if (!isHost()) return toast('Only the host can change games.');
    if (matchOver()) { api.lobby(); return; }
    menuConfirm = menuConfirm === 'end' ? null : 'end';
    paintMenuConfirm();
  };
  const leave = document.getElementById('bLeave');
  if (leave) leave.onclick = () => {
    if (!playingNow()) { leaveMatch(); return; }
    menuConfirm = menuConfirm === 'leave' ? null : 'leave';
    paintMenuConfirm();
  };
  menuConfirm = null;
  renderHostStates();
  applyGameZoom();
  // Game stylesheets load after mount and may take over the toolbar.
  const title = document.querySelector('.play-toolbar .play-title');
  if (title && typeof ResizeObserver === 'function') new ResizeObserver(() => applyGameZoom()).observe(title);
}

/* ---- game size ("− 100% +") ---- */
function gameZoom() {
  return currentZoom(store, window.innerWidth, window.innerHeight);
}

/* Zoom only the playfield (#gbody); the toolbar and Room stay put. */
function applyGameZoom() {
  const el = document.getElementById('gbody');
  if (!el) return;
  // A game that hides the play toolbar's title (the drawing desks) owns the
  // whole viewport with fixed panels and its own canvas zoom: keep 100%.
  const title = document.querySelector('.play-toolbar .play-title');
  const ownsScreen = !!title && getComputedStyle(title).display === 'none';
  const v = zoomable(gameById(gameId)) && !ownsScreen ? gameZoom() : 1;
  el.style.zoom = v === 1 ? '' : String(v);
  for (const box of document.querySelectorAll('.game-zoom')) {
    box.hidden = ownsScreen;
    const [smaller, value, bigger] = box.querySelectorAll('button');
    smaller.disabled = v === ZOOM_STEPS[0];
    bigger.disabled = v === ZOOM_STEPS.at(-1);
    value.textContent = percent(v);
    value.setAttribute('aria-label', `Game size ${percent(v)}. Reset to 100%`);
  }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest?.('.game-zoom [data-zoom]');
  if (!b || b.disabled) return;
  const dir = Number(b.dataset.zoom);
  const next = dir === 0 ? 1 : stepZoom(gameZoom(), dir);
  store.set(ZOOM_KEY, String(next));
  applyGameZoom();
  announce(`Game size ${percent(next)}`);
});
// Without a saved choice the default follows the frame size.
window.addEventListener('resize', () => { if (!store.get(ZOOM_KEY)) applyGameZoom(); });

function paintGameScreen({ busy, fullscreen }) {
  const button = document.getElementById('bGameScreen');
  if (button) { button.textContent = fullscreen ? 'Exit full screen' : readInputCapabilities().preferred.touch ? 'Play landscape' : 'Full screen'; button.disabled = busy; }
}

function renderGame() {
  if (!lastState) {
    // Same frame as the game screen, so the first snapshot does not jump.
    const g = gameById(room?.game);
    app.innerHTML = connbarHtml() + `
      <header class="play-toolbar"><div class="play-title">${g ? artImg(g, 'gthumb') : ''}<div><h1>${esc(gameName(room?.game))}</h1></div></div></header>
      <main class="game-stage" aria-busy="true"><p class="gk-wait" role="status">Loading the game…</p></main>`;
    return;
  }
  const g = gameById(gameId);
  // players[] is the ACTIVE roster (seat-capped games: players, not room
  // size); watchers are named separately, never folded into the count.
  const n = lastState.players ? lastState.players.length : 0;
  const w = lastState.spectators ? lastState.spectators.length : 0;
  const hostName = room && room.players.find((p) => p.id === room.hostId);
  // Embedded rooms have no shareable code: describe the squad and watcher
  // role without exposing an internal room id, even inside the drawer.
  const where = !EMBED.enabled ? `Room ${esc(room ? room.code : '')}`
    : (lastState.spectator ? 'Watching' : 'Squad game');
  const context = `${where} · ${n} playing${w ? ` · ${w} watching` : ''} · Host ${esc(hostName?.name || '—')}`;
  if (g?.layout === 'immersive') {
    // The game owns the viewport. The platform provides a quiet, optional
    // room drawer instead of imposing its title card/HUD on every game.
    app.innerHTML = connbarHtml() + gameRoomMenu(g, context, true) + `
      <main id="gbody" data-layout="immersive" aria-label="${esc(gameName(gameId))}"></main>
      <div class="timerbar" id="tbar" hidden><div></div></div><div id="ttime" hidden></div>`;
    wireGameRoom();
    paintGamePreparation();
    mountGameBody();
    paintVoice();
    renderScores();
    return;
  }
  /* Embedded watchers have a short role tag at the top. Put the longer
   * reason and Why disclosure after the playfield, protecting the board. */
  const spec = !lastState.spectator ? '' : (EMBED.enabled
    ? `<div class="specbanner spec-compact spec-after" role="status"><span>${esc(spectatorEmbedNote(seatCap(g)))}</span><details class="specwhy"><summary>Why?</summary><p>${esc(spectatorBanner(seatCap(g)))}</p></details></div>`
    : `<div class="specbanner" role="status">${spectatorBanner(seatCap(g))}</div>`);
  const specBefore = !EMBED.enabled ? spec : '';
  const specAfter = EMBED.enabled ? spec : '';
  app.innerHTML = connbarHtml() + `
    <header class="play-toolbar">
      <div class="play-title">${g ? artImg(g, 'gthumb') : ''}<div><h1>${esc(gameName(gameId))}</h1><span class="play-status" id="playRole" ${lastState.spectator ? '' : 'hidden'}>Watching</span></div></div>
      ${zoomable(g) ? zoomControlHtml(gameZoom()) : ''}
      ${gameRoomMenu(g, context)}
    </header>
    <main class="game-stage" aria-label="${esc(gameName(gameId))}">
      ${specBefore}
      <div class="game-clock is-idle">
        <div class="timerbar" id="tbar" hidden><div style="width:100%"></div></div>
        <div class="timertext" id="ttime" aria-label="Round time" hidden></div>
      </div>
      <div id="gbody" data-layout="standard"></div>
      ${specAfter}
    </main>`;
  wireGameRoom();
  paintGamePreparation();
  mountGameBody();
  paintVoice();
  renderScores();
}

/* Seat-cap watchers can be over capacity or late joiners. The cap alone
 * does not tell us why this player watches or promise a future seat.
 * Ordinary all-player games seat current joiners at the next game. */
/* Active-player cap for the running game: the live room snapshot first
 * (server-authored per instance), the registry manifest as fallback.
 * Zero/NaN means the whole roster plays (ordinary all-player game). */
function seatCap(g) {
  if (room && Number.isInteger(room.seats) && room.seats >= 1) return room.seats;
  if (g && Number.isInteger(g.seats) && g.seats >= 1) return g.seats;
  return 0;
}

function spectatorBanner(seats) {
  if (lastState?.youLeft) return 'You left this match. You play the next game.';
  if (seats) {
    return `You’re watching this match. Up to ${seats} players take seats when a match starts.`;
  }
  return 'You joined mid-game — you are spectating. You join the next game automatically.';
}

/* One-line watcher reason for compact embedded play, shown below the
 * board. The title's role tag already says Watching, so this names only the
 * reason (no repeated status for screen readers); the full explanation
 * stays one tap away in the Why? disclosure. */
function spectatorEmbedNote(seats) {
  if (lastState?.youLeft) return 'You left this match';
  if (seats) return `Watching this match · up to ${seats} players`;
  return 'You joined mid-game';
}

/* Spectators watch: strip actionable controls from the game body after
 * every paint (views re-render on each snapshot). Server also ignores
 * spectator actions, so this is defence in depth, not the gate. */
function applySpectator(el) {
  if (!el || !lastState || !lastState.spectator) return;
  // Shell-owned rematch footer stays governed by host state, not spectator.
  // Views may mark purely local controls (board flip, camera) data-watchok
  // so watchers keep them; anything that sends actions stays disabled.
  el.querySelectorAll('input, select, textarea, button').forEach((c) => {
    if (!c.closest('#rematch') && !c.hasAttribute('data-watchok')) c.disabled = true;
  });
}

function paintGamePreparation() {
  const el = document.getElementById('gbody');
  if (!el || !lastState) return;
  const preparing = !!lastState.preparing;
  // Framed games own their input locks. Keep local Help and animation
  // controls usable; api.send and the Room still reject early gameplay.
  el.inert = preparing && gameById(gameId)?.runtime?.type !== 'frame';
  el.setAttribute('aria-busy', String(preparing));
  let status = document.getElementById('gamePreparation');
  if (!status && preparing) {
    status = document.createElement('div');
    status.id = 'gamePreparation';
    status.className = 'game-preparation';
    status.setAttribute('role', 'status');
    status.innerHTML = '<span class="preparation-dot" aria-hidden="true"></span><span>Getting everyone ready…</span>';
    app.appendChild(status);
  }
  if (status) status.hidden = !preparing;
}

function rememberPreparationFocus(next, prev) {
  if (preparationFocus && (preparationFocus.instance !== next.instanceId || preparationFocus.window !== next.w)) preparationFocus = null;
  if (!next.preparing || (prev?.preparing && prev.w === next.w)) return;
  const el = document.getElementById('gbody');
  const focused = document.activeElement;
  if (prev?.instanceId === next.instanceId && el?.contains(focused) && focused !== el && !focused.disabled) {
    preparationFocus = { element: focused, body: el, instance: next.instanceId, window: next.w };
  }
}

function restorePreparationFocus(el) {
  const saved = preparationFocus;
  if (!saved || lastState?.preparing) return;
  preparationFocus = null;
  if (saved.instance !== lastState?.instanceId || saved.window !== lastState?.w || saved.body !== el ||
      !saved.element.isConnected || !el.contains(saved.element) || saved.element.disabled || el.inert ||
      document.querySelector('dialog[open]') || (document.activeElement !== document.body && document.activeElement !== el)) return;
  api.focus(saved.element);
}

function paintGameLoadError({ gameId: failedGame, instanceId: failedInstance, window: failedWindow } = {}) {
  runLog.event('load-error');
  const el = document.getElementById('gbody');
  if (!el || failedGame !== gameId || failedInstance !== instanceId || (failedWindow !== undefined && failedWindow !== lastState?.w)) return;
  el.inert = false;
  el.setAttribute('aria-busy', 'false');
  const status = document.getElementById('gamePreparation');
  if (status) status.hidden = true;
  el.innerHTML = '<section class="game-load-error" role="alert"><h2>This game couldn’t load</h2><p>Try again, or use Room to return to the lobby.</p><button type="button" class="btn" id="retryGameView">Retry</button></section>';
  el.querySelector('#retryGameView').onclick = () => {
    resetView();
    paintGamePreparation();
    mountGameBody();
  };
}

function mountGameBody() {
  const el = document.getElementById('gbody');
  if (!el || !lastState) return;
  if (lastState.matchEnded && lastState.phase !== 'done') return paintShellFinal(el);
  const mountingGame = gameId, mountingInstance = instanceId;
  showView(el, gameId, lastState, api, gameById(gameId)).then((view) => {
    if (document.getElementById('gbody') !== el || gameId !== mountingGame || instanceId !== mountingInstance) return;
    if (!view) {
      // Null can mean this paint was superseded. The host reports genuine
      // failures through api.loadError with the failed instance/window.
      return;
    }
    if (!view.ownsInputs) applySpectator(el);
    if (!view.ownsRematch) ensureRematchFooter(el);
    startTimer(lastState.endsAt, view.ownsTimer === true);
    focusPreparedGame(el);
  });
}

function paintGameBody() {
  const el = document.getElementById('gbody');
  if (!el || !lastState) return;
  if (lastState.matchEnded && lastState.phase !== 'done') return paintShellFinal(el);
  const paintingGame = gameId, paintingInstance = instanceId;
  showView(el, gameId, lastState, api, gameById(gameId)).then((view) => {
    if (document.getElementById('gbody') !== el || gameId !== paintingGame || instanceId !== paintingInstance) return;
    if (!view) return;
    if (!view.ownsInputs) applySpectator(el);
    if (!view.ownsRematch) ensureRematchFooter(el);
    startTimer(lastState.endsAt, view.ownsTimer === true);
    focusPreparedGame(el);
    restorePreparationFocus(el);
  });
}

function focusPreparedGame(el) {
  // An imported view may settle while the Room still holds its preparation
  // barrier. Wait for release before consuming the initial keyboard focus.
  if (focusGame === gameId || lastState?.preparing) return;
  focusGame = gameId;
  const menuOpen = document.getElementById('roomMenu')?.open;
  // The first visible control: hidden phase parts (kept in the DOM so
  // nothing jumps) must never take the initial focus.
  const visible = (n) => !(typeof n.closest === 'function' && n.closest('[hidden]')) &&
    (typeof n.getClientRects !== 'function' || n.getClientRects().length > 0);
  const pick = (sel) => (typeof el.querySelectorAll === 'function' ? [...el.querySelectorAll(sel)].find(visible) : el.querySelector(sel));
  const first = pick('[data-game-focus]:not(:disabled)') ||
    pick('input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)');
  if (first && !menuOpen && !readInputCapabilities().preferred.touch) api.focus(first);
  // Once per instance (focusGame resets on a new instanceId). Both callers
  // already guard their live element, game and instance after async paint.
  document.querySelectorAll('.confetti').forEach((n) => n.remove());
  if (!menuOpen) { try { window.scrollTo(0, 0); } catch { /* no window (tests) */ } }
}

/* Generic Final scores for a match the host ended when the game has no
 * onEnd hook of its own: the game's match scoreboard when it publishes one
 * (scores keyed by player id), else the points awarded in this match. */
function paintShellFinal(el) {
  const players = lastState.players || [];
  const ids = new Set(players.map((p) => p.id));
  const own = lastState.scores && typeof lastState.scores === 'object' && !Array.isArray(lastState.scores) &&
    Object.keys(lastState.scores).length && Object.entries(lastState.scores).every(([k, v]) => ids.has(k) && Number.isFinite(Number(v)))
    ? lastState.scores : null;
  const key = JSON.stringify([lastState.instanceId, own || lastState.matchPoints || {}, players, you]);
  startTimer(0, true);
  if (el.dataset.shellFinal === key && el.querySelector('.gk-final')) { ensureRematchFooter(el); return; }
  resetView();
  el.dataset.shellFinal = key;
  el.inert = false;
  el.innerHTML = finalHtml({ scores: own || lastState.matchPoints || {}, players, you });
  ensureRematchFooter(el);
  announce('The game ended. Final scores are ready.');
}

function ensureRematchFooter(el) {
  // Shell-owned end-of-game footer: every game gets rematch for free.
  if (matchOver() && gameId && !document.getElementById('rematch')) {
    const foot = document.createElement('div');
    foot.id = 'rematch';
    foot.className = 'row mt';
    // Guests see only the calm waiting line; the host sees the two choices.
    foot.innerHTML = `<button class="btn" id="bRematch" ${isHost() ? '' : 'hidden disabled'}>Rematch</button>
      <button class="btn ghost" id="bChange" ${isHost() ? '' : 'hidden disabled'}>Change game</button>
      <p class="muted gk-wait" id="hostWait" role="status" ${isHost() ? 'hidden' : ''}></p>`;
    el.appendChild(foot);
    document.getElementById('bRematch').onclick = () => {
      if (!isHost()) return toast('Only the host can start games.');
      // No pre-clear: the new instanceId disposes every client on arrival,
      // and a rejected restart leaves this done screen visible.
      api.rematch();
    };
    document.getElementById('bChange').onclick = () => {
      if (!isHost()) return toast('Only the host can change games.');
      api.lobby();
    };
    renderHostStates();
  }
}

function renderScores() {
  const el = document.getElementById('scores');
  if (!el || !lastState) return;
  const sorted = [...(lastState.players || [])].sort(
    (a, b) => (lastState.totals[b.id] || 0) - (lastState.totals[a.id] || 0));
  const top = sorted.length ? (lastState.totals[sorted[0].id] || 0) : 0;
  el.setAttribute('aria-label', 'Game night totals');
  el.innerHTML = '<span class="scorelabel">Night totals</span>' + sorted.map((p) => {
    const pts = lastState.totals[p.id] || 0;
    return `<span class="score ${pts === top && top > 0 ? 'leader' : ''}">${avatar(p.id, p.name)}${esc(p.name)} <b>${pts}</b></span>`;
  }).join('') + ((lastState.spectators && lastState.spectators.length)
    ? `<span class="watching-chip">Watching: ${lastState.spectators.map((s) => esc(s.name)).join(', ')}</span>` : '');
  renderRoomMembers();
}

function gameName(id) {
  const g = games.find((g) => g.id === id);
  return g ? g.name : id;
}

function startTimer(endsAt, ownsTimer = false) {
  cancelAnimationFrame(timerRaf);
  const bar = document.querySelector('#tbar');
  const text = document.querySelector('#ttime');
  if (!bar) return;
  // The clock row keeps its height while idle so nothing below it jumps;
  // games that draw their own timer (ownsTimer) give the row up entirely.
  const clock = bar.closest?.('.game-clock');
  clock?.classList?.toggle('is-owned', !!ownsTimer);
  if (ownsTimer || lastState?.preparing || lastState?.matchEnded || !endsAt || /^(done|reveal|result|results|score|scores)$/.test(lastState?.phase || '')) {
    bar.hidden = true;
    if (text) text.hidden = true;
    clock?.classList?.add('is-idle');
    return;
  }
  clock?.classList?.remove('is-idle');
  bar.hidden = false;
  if (text) text.hidden = false;
  const fill = bar.firstElementChild;
  // Freeze the window on first sight so the bar drains smoothly.
  if (startTimer.forEnds !== endsAt) {
    startTimer.forEnds = endsAt;
    startTimer.total = Math.max(1, endsAt - (lastState.phaseStartedAt || api.now()));
  }
  const total = startTimer.total;
  function frame() {
    const left = endsAt - api.now();
    if (left <= 0) {
      fill.style.width = '0%';
      if (text) text.textContent = 'Time’s up';
      return;
    }
    fill.style.width = Math.max(0, Math.min(100, (left / (total || left)) * 100)) + '%';
    const secs = Math.ceil(left / 1000);
    if (text) text.textContent = secs + 's left';
    bar.classList.toggle('urgent', secs <= 5);
    timerRaf = requestAnimationFrame(frame);
  }
  frame();
}

document.addEventListener('click', (e) => {
  const report = e.target.closest('[data-report]');
  if (report) {
    const menu = document.getElementById('roomMenu');
    if (menu) menu.open = false;
    closeCustomizer({ returnFocus: false });
    closeHowto({ returnFocus: false });
    const reportGame = room?.game && gameId ? gameId : 'platform';
    runLog.save();
    openIssueReport({ games, url: publicConfig?.reportingUrl || '/api/reports', game: reportGame, phase: room?.game ? lastState?.phase || '' : room ? 'lobby' : 'home', theme: theme(), embedded: EMBED.enabled, runLog: runLog.latest(reportGame) }, report);
    return;
  }
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    e.preventDefault();
    leaveRoom();
  }
});

// A native disclosure keeps the room controls keyboard accessible without
// intercepting game actions. Boot-time handlers never accumulate per match.
document.addEventListener('pointerdown', (e) => {
  const menu = document.getElementById('roomMenu');
  if (menu?.open && !menu.contains(e.target)) menu.open = false;
});
document.addEventListener('keydown', (e) => {
  const menu = document.getElementById('roomMenu');
  if (e.key === 'Tab' && menu?.open && !isCustomizerOpen() && !isHowtoOpen() && !isReportOpen()) {
    const focusable = [...menu.querySelectorAll('.room-menu-panel button, .room-menu-panel a[href]')]
      .filter((node) => !node.disabled && node.getClientRects().length > 0);
    const first = focusable[0], last = focusable.at(-1);
    if (first && (e.shiftKey ? document.activeElement === first : document.activeElement === last)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus({ preventScroll: true });
    }
  }
  if (e.key === 'Escape' && menu?.open && !isCustomizerOpen() && !isHowtoOpen() && !isReportOpen()) {
    e.preventDefault();
    menu.open = false;
    menu.querySelector('summary')?.focus({ preventScroll: true });
  }
});

// Unlock silently during real play. Browsing the catalogue does not create
// an audio context or request samples. Sound never queues behind decoding.
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, () => {
  if (gameId && lastState && !document.hidden) sound.unlock();
});
document.addEventListener('visibilitychange', () => { if (document.hidden) sound.stop(); });

// Pause ambient loops while the page is hidden (single boot-time
// listener — nothing per-render, nothing to dispose).
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('page-hidden', document.hidden);
});

// Normalize a pre-D7 stored theme id once: the bootstrap already painted
// the matching look; this rewrites storage so no legacy id lingers.
try {
  const stored = store.get('pb_theme');
  if (stored && LEGACY_THEMES[stored]) store.set('pb_theme', LEGACY_THEMES[stored]);
} catch { /* private mode */ }

connect();
