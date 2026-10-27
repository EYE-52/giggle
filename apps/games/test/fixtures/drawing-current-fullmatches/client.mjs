import { show, reset } from '/js/game-host.js';
import { createServerClock } from '/js/server-clock.js';
import { createResultPresentation } from '/js/toolkit/result-presentation.mjs';
import { openIssueReport } from '/js/report-issue.js';

const params = new URLSearchParams(location.search), game = params.get('game'), role = params.get('role'), session = params.get('session');
const el = document.querySelector('#gbody'), sent = [], receipts = [], cues = [], presentations = [], errors = [], readyAcks = [], paints = [], cueIds = new Set();
const clock = createServerClock(), resultPresentation = createResultPresentation(S => presentations.push(S.instanceId));
let socket, S = null, rendered = null, active = true, host = null, sequence = 0, stateCount = 0, screenChanges = 0;
document.addEventListener('game-screenchange', () => screenChanges++);
function fail(message) { errors.push(String(message)); const node = document.querySelector('#fixture-error'); node.hidden = false; node.textContent = message; }
function raw(a, meta = {}) { if (!active || socket?.readyState !== 1 || !S) throw Error('Client unavailable'); const qaId = ++sequence; socket.send(JSON.stringify({ t: 'action', a, i: S.instanceId, w: S.w, qaId, ...meta })); return qaId; }
const api = {
  context: () => ({ isHost: host === S?.me }),
  send(a) { const qaId = raw(a); sent.push({ qaId, action: a }); return true; },
  now: () => S?.preparing ? S.gameNow : clock.now() - (S?.clockOffset || 0),
  focus: n => n?.focus({ preventScroll: true }), announce() {}, toast() {},
  ready({ instanceId, window }) { if (!active || socket?.readyState !== 1 || !S?.preparing || S.instanceId !== instanceId || S.w !== window || S.spectator) return false; readyAcks.push({ instanceId, window }); socket.send(JSON.stringify({ t: 'game-ready', i: instanceId, w: window })); return true; },
  cue(name, options) { const id = options?.id, key = name + ':' + id; if (!active || !id?.startsWith(S?.instanceId + ':') || cueIds.has(key)) return false; cueIds.add(key); if (S.preparing || S.audioBaseline || document.visibilityState === 'hidden') return false; cues.push({ name, ...options }); return true; },
  resultsReady: id => resultPresentation.ready(id),
  rematch: () => socket.send(JSON.stringify({ t: 'rematch' })),
  loadError: e => fail(e.error),
};
async function paint(snapshot) {
  const view = await show(el, game, snapshot, api);
  if (!view || !active || S !== snapshot) return;
  rendered = snapshot;
  paints.push({ instanceId: snapshot.instanceId, window: snapshot.w, phase: snapshot.phase, round: snapshot.round, preparing: snapshot.preparing });
  const footer = document.querySelector('#fixture-rematch'); footer.hidden = snapshot.phase !== 'done'; footer.querySelector('button').disabled = host !== snapshot.me;
  const timer = document.querySelector('#ttime'); timer.hidden = game === 'doodle-guess' || snapshot.preparing || !snapshot.endsAt || ['done', 'reveal'].includes(snapshot.phase); document.querySelector('#tbar').hidden = timer.hidden;
}
function connect() {
  active = true; clock.reset(); let baseline = true;
  return new Promise((resolve, reject) => {
    const peer = socket = new WebSocket('ws://' + location.host + '/socket'); peer.onopen = () => peer.send(JSON.stringify({ t: 'join', session, role })); peer.onerror = reject;
    peer.onmessage = async e => {
      if (!active || peer !== socket) return;
      try {
        const m = JSON.parse(e.data);
        if (m.t === 'room') { host = m.room.hostId; if (S) await paint(S); }
        if (m.t === 'state') {
          const previous = S; clock.observe(m.serverNow); const snapshot = S = { ...m, me: m.you, audioBaseline: baseline }; baseline = false; stateCount++;
          // Same shipping shell result controller and non-deferred drawing contract.
          resultPresentation.observe(previous, snapshot, snapshot.waitForResult === true);
          await paint(snapshot); if (active && peer === socket && rendered === snapshot && !snapshot.preparing) resolve();
        }
        if (m.t === 'qa-ack') receipts.push(m);
        if (m.t === 'qa-error' || m.t === 'error') fail(m.message || m.msg);
      } catch (e) { fail(e.stack || e.message); reject(e); }
    };
  });
}
const timer = setInterval(() => { const n = document.querySelector('#ttime'); if (S && !n.hidden) n.textContent = Math.max(0, Math.ceil((S.endsAt - api.now()) / 1000)) + 's left'; }, 250);
window.qa = {
  el, api, sent, receipts, cues, presentations, errors, readyAcks, paints,
  get state() { return S; }, get rendered() { return rendered; }, get stateCount() { return stateCount; }, get screenChanges() { return screenChanges; },
  raw,
  async reconnect() { active = false; rendered = null; reset(); const retired = socket; const closed = retired.readyState === 3 ? Promise.resolve() : new Promise(r => retired.addEventListener('close', r, { once: true })); retired.close(); await closed; await connect(); },
  dispose() { active = false; rendered = null; reset(); clearInterval(timer); socket?.close(); },
};
const menu = document.querySelector('#roomMenu'); menu.ontoggle = () => { if (menu.open) document.querySelector('#bRoomResume').focus({ preventScroll: true }); };
document.querySelector('#bRoomResume').onclick = () => { menu.open = false; menu.querySelector('summary').focus({ preventScroll: true }); };
document.querySelector('#bRematch').onclick = () => { if (api.context().isHost && S.phase === 'done') api.rematch(); };
document.addEventListener('click', e => { const opener = e.target.closest('[data-report]'); if (!opener) return; menu.open = false; openIssueReport({ games: [{ id: game, name: game === 'doodle-guess' ? 'Doodle Guess' : 'Draw Phone' }], game, phase: S?.phase || '', theme: 'day', embedded: false }, opener); });
window.addEventListener('pagehide', () => window.qa.dispose(), { once: true });
await connect();
