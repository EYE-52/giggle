import { frameEntry, envelope, isGameMessage, currentAction } from './game-protocol.mjs';

/* A trusted, locally shipped game gets a separate document for complete
 * style/runtime independence. This is not a sandbox for untrusted uploads.
 * No bridge ticket, seat token or room transport crosses the boundary. */
export function createGameFrame(gameId, runtime) {
  const entry = frameEntry(gameId, runtime);
  if (!entry) throw new Error('Invalid browser game entry');
  let frame, state, api, ready = false, session, onMessage, stopVoice, rendered, waiting;
  const publish = () => {
    if (ready && frame?.contentWindow && state) frame.contentWindow.postMessage(envelope(session, 'snapshot', {
      state, serverNow: api.now(), context: api.context?.() || {},
    }), location.origin);
  };
  return {
    ownsTimer: true, ownsRematch: true, ownsInputs: true,
    mount(el, platform) {
      api = platform; session = crypto.randomUUID();
      frame = document.createElement('iframe');
      frame.className = 'game-document'; frame.title = `${gameId} game`;
      frame.name = `giggle-game:${session}`;
      // Installed game code is already trusted like module views. An iframe
      // isolates styles, not privileges; a sandbox would arbitrarily block
      // engine forms, dialogs, navigation, workers and downloads.
      frame.setAttribute('allow', 'fullscreen; autoplay; gamepad');
      frame.allowFullscreen = true;
      // Keep the game's URL/hash free for its own router. The frame name
      // carries only a non-secret mount correlation id, never a credential.
      frame.src = entry;
      onMessage = event => {
        if (!isGameMessage(event, frame?.contentWindow, location.origin, session)) return;
        const d = event.data;
        if (d.type === 'ready') { ready = true; publish(); return; }
        if (!ready || !state) return;
        if (d.type === 'diagnostic' && d.instanceId === state.instanceId && d.window === state.w) {
          api.diagnostics?.event(d.kind); return;
        }
        if (d.type === 'audio-unlock') { api.audioUnlock?.(); return; }
        if (d.type === 'cue' && d.instanceId === state.instanceId && d.window === state.w &&
            typeof d.name === 'string' && typeof d.id === 'string') {
          api.cue?.(d.name, { id: d.id, gain: d.gain, rate: d.rate });
          return;
        }
        if (d.type === 'phase-ready' && d.instanceId === state.instanceId && d.window === state.w) {
          rendered = { instanceId: d.instanceId, window: d.window };
          if (waiting?.instanceId === d.instanceId && waiting.window === d.window) {
            waiting.resolve(); waiting = null;
          }
          return;
        }
        if (d.type === 'results-ready' && runtime.waitForResult === true && state.phase === 'done' && d.instanceId === state.instanceId) {
          api.resultsReady?.(d.instanceId);
          return;
        }
        if (d.type === 'action' && currentAction(d, state)) {
          // Match module views' JSON transport contract, including scalar,
          // array and done-phase intents. The server game decides legality.
          try {
            const json = JSON.stringify(d.action);
            if (json === undefined) return;
            api.send(JSON.parse(json), { silent: d.silent === true });
          } catch { api.toast?.('That move couldn’t be sent. Try again.'); }
        }
        if ((d.type === 'lobby' || d.type === 'rematch') && d.instanceId === state.instanceId && api.context?.().isHost) {
          if (d.type === 'lobby') api.lobby(); else if (state.phase === 'done') api.rematch();
        }
        if ((d.type === 'toast' || d.type === 'announce') && typeof d.text === 'string') api[d.type]?.(d.text.slice(0, 200));
        if (d.type === 'voice') {
          const result = api.voice?.request();
          if (result?.ok === false) api.toast?.(api.voice.getStatus()?.hint || 'Open this game from your Giggle call to talk together.');
        }
      };
      window.addEventListener('message', onMessage);
      stopVoice = api.voice?.subscribe(publish);
      frame.addEventListener('load', () => { ready = false; });
      // Repeat the handshake after navigation/reload; a child may post its
      // first ready before load fires. No retry timer or extra socket.
      frame.addEventListener('load', () => {
        frame.contentWindow?.postMessage(envelope(session, 'hello'), location.origin);
      });
      el.replaceChildren(frame);
    },
    update(el, snapshot, platform) { state = snapshot; api = platform; publish(); },
    ready(el, snapshot, platform) {
      // Old frame documents remain usable for legacy, ungated sessions.
      if (!snapshot.preparing || (rendered?.instanceId === snapshot.instanceId && rendered.window === snapshot.w)) return;
      return new Promise((resolve, reject) => {
        const signal = platform.signal;
        const failed = error => {
          signal?.removeEventListener('abort', retired);
          if (waiting?.reject === failed) waiting = null;
          reject(error);
        };
        const retired = () => failed(new Error('Frame phase retired'));
        signal?.addEventListener('abort', retired, { once: true });
        waiting = { instanceId: snapshot.instanceId, window: snapshot.w,
          resolve: () => { signal?.removeEventListener('abort', retired); resolve(); }, reject: failed };
        if (signal?.aborted) retired();
      });
    },
    dispose() {
      waiting?.reject(new Error('Game document retired')); waiting = null; rendered = null;
      window.removeEventListener('message', onMessage); stopVoice?.();
      frame?.remove(); frame = null; state = null; api = null; ready = false;
    },
  };
}
