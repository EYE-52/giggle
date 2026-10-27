import { GAME_PROTOCOL, envelope, isGameMessage } from './game-protocol.mjs';

/* Optional room client for ANY browser engine in a game-owned document.
 * No DOM/CSS, sockets, storage, identity credentials or media capture.
 * Connect Phaser/React/Unity/Godot/WebGL/WASM/etc to subscribe/send; the
 * parent maintains the existing room/seat/auth and validates every intent. */
export function createGameClient({ window: win = globalThis.window } = {}) {
  const session = typeof win.name === 'string' && win.name.startsWith('giggle-game:')
    ? win.name.slice(12) : new URLSearchParams(win.location.hash.slice(1)).get('giggleSession');
  const origin = win.location.origin;
  const parent = win.parent;
  const listeners = new Set();
  const voiceListeners = new Set();
  let state = null, context = {}, anchor = null, disposed = false;
  const monotonic = () => win.performance.now();
  const post = (type, fields) => {
    if (!disposed && parent !== win && session) parent.postMessage(envelope(session, type, fields), origin);
  };
  function handle(event) {
    if (disposed || !session || !isGameMessage(event, parent, origin, session)) return;
    if (event.data.type === 'hello') { post('ready'); return; }
    if (event.data.type !== 'snapshot') return;
    const d = event.data;
    if (!d.state || typeof d.state !== 'object' || !Number.isFinite(d.serverNow)) return;
    state = d.state; context = d.context || {};
    anchor = { server: d.serverNow, local: monotonic() };
    for (const fn of listeners) { try { fn(state, context); } catch (error) { diagnostic('runtime-error'); console.error('Game snapshot subscriber failed', error); } }
    for (const fn of voiceListeners) { try { fn(context.voice || {}); } catch (error) { console.error('Game voice subscriber failed', error); } }
  }
  win.addEventListener('message', handle);
  const unlockAudio = event => {
    if (event.isTrusted && state && context.sound !== false) post('audio-unlock');
  };
  win.addEventListener('pointerdown', unlockAudio);
  win.addEventListener('keydown', unlockAudio);
  const diagnostic = kind => state && post('diagnostic', { kind, instanceId: state.instanceId, window: state.w });
  const runtimeError = event => diagnostic(event.target === win ? 'runtime-error' : 'resource-error');
  const promiseError = () => diagnostic('promise-error');
  win.addEventListener('error', runtimeError, true);
  win.addEventListener('unhandledrejection', promiseError);
  post('ready');
  return {
    subscribe(fn) {
      if (typeof fn !== 'function' || disposed) return () => {};
      listeners.add(fn);
      if (state) fn(state, context);
      return () => listeners.delete(fn);
    },
    now: () => anchor ? anchor.server + (state?.preparing ? 0 : monotonic() - anchor.local) : Date.now(),
    // Call after essential assets, controls and the first rendered scene.
    // Transport-ready only establishes messaging; it never starts a round.
    ready(snapshot = state) {
      if (snapshot && snapshot.instanceId === state?.instanceId && snapshot.w === state?.w) {
        post('phase-ready', { instanceId: snapshot.instanceId, window: snapshot.w });
      }
    },
    send(action, options) {
      if (state && !state.spectator && !state.preparing) post('action', {
        action, silent: options?.silent === true, instanceId: state.instanceId, window: state.w,
      });
    },
    rematch: () => context.isHost && post('rematch', { instanceId: state?.instanceId }),
    lobby: () => context.isHost && post('lobby', { instanceId: state?.instanceId }),
    resultsReady: () => state?.phase === 'done' && post('results-ready', { instanceId: state.instanceId }),
    cue(name, options = {}) {
      if (!state || state.preparing || state.audioBaseline || context.sound === false ||
          typeof name !== 'string' || typeof options.id !== 'string') return false;
      post('cue', { name, id: options.id, gain: options.gain, rate: options.rate,
        instanceId: state.instanceId, window: state.w });
      return !disposed;
    },
    toast: text => typeof text === 'string' && post('toast', { text: text.slice(0, 200) }),
    announce: text => typeof text === 'string' && post('announce', { text: text.slice(0, 200) }),
    name: pid => state?.players?.find(p => p.id === pid)?.name || '???',
    focus: el => el?.focus?.({ preventScroll: true }),
    diagnostics: { event: diagnostic },
    voice: {
      getStatus: () => context.voice || {},
      subscribe(fn) {
        if (typeof fn !== 'function' || disposed) return () => {};
        voiceListeners.add(fn); fn(context.voice || {});
        return () => voiceListeners.delete(fn);
      },
      request: () => post('voice'),
    },
    dispose() {
      if (disposed) return;
      disposed = true; win.removeEventListener('message', handle);
      win.removeEventListener('pointerdown', unlockAudio);
      win.removeEventListener('keydown', unlockAudio);
      win.removeEventListener('error', runtimeError, true);
      win.removeEventListener('unhandledrejection', promiseError);
      listeners.clear(); voiceListeners.clear();
    },
  };
}
