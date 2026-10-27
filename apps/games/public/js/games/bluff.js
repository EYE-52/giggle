/* Bluff view: a fact with a blank, secret fake answers, then everyone
 * picks the truth from the mix. Built on the game kit
 * (public/css/game-ui.css, public/js/kit.js). */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { roundLabel, progressText, hudHtml, waitingHtml, finalHtml, syncHudTimer, stopHudTimer } from '../kit.js';

let liveTimerEl = null;

const CSS = '/css/bluff.css';

let feedback = null;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
let screenKey = '', liveApi = null, liveEl = null, liveState = null, liveActionKey = '';

/* Flat vote-share bar for reveal cards (share of all votes, 0–100%). */
function shareBar(n, total) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return `<span class="pb-share" role="img" aria-label="${n} of ${total} votes"><span style="width:${pct}%"></span></span>`;
}

function isWatching(S) {
  if (S.spectator === true) return true;
  const ps = S.players || [];
  return S.me != null && ps.length > 0 && !ps.some((p) => p.id === S.me);
}

function activeCount(S) {
  return (S.players || []).filter((p) => !p.left).length;
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function hud(S) {
  const n = activeCount(S);
  const progress = S.phase === 'bluff' ? progressText((S.submitted || []).length, n, 'bluffed')
    : S.phase === 'pick' ? progressText((S.picked || []).length, n, 'picked') : '';
  const phase = { bluff: 'Write a bluff', pick: 'Find the truth', reveal: 'Reveal', done: 'Game over' }[S.phase] || 'Write a bluff';
  return hudHtml({ round: roundLabel(Math.min(S.round || 1, S.rounds || S.round || 1), S.rounds), phase: phase + (isWatching(S) ? ' · Watching' : ''), progress })
    .replace('<div class="gk-hud"', `<div class="gk-hud" data-phase="${esc(S.phase)}"`);
}

function scene(S, label, inner) {
  return `<section class="gk-col gk-stack bl-scene" data-scene="bluff" data-phase="${esc(S.phase)}" aria-label="${esc(label)}">${hud(S)}${inner}</section>`;
}

function waitLine(S) {
  const n = activeCount(S);
  const done = S.phase === 'bluff' ? (S.submitted || []).length : (S.picked || []).length;
  const left = Math.max(0, n - done);
  return waitingHtml(left, { done: !left });
}

/* Kit input row (48px field + same-height button) with our own ids. */
function inputRow({ id, label, placeholder, max, btnId, button }) {
  return `<form class="gk-input-row" data-gk-input autocomplete="off">`
    + `<input class="gk-input" id="${id}" type="text" aria-label="${esc(label)}" placeholder="${esc(placeholder)}" maxlength="${max}" autocomplete="off" enterkeyhint="send">`
    + `<button class="gk-btn gk-primary" type="submit" id="${btnId}">${esc(button)}</button></form>`;
}

function revealHtml(S, watch) {
  const L = S.last;
  const pts = L.points || {};
  const canNext = !watch && S.me === S.hostId;
  const myPick = watch ? null : L.picks?.[S.me];
  const votersFor = (oid) => Object.keys(L.picks || {}).filter((pid) => L.picks[pid] === oid);
  const total = L.options.reduce((n, o) => n + o.n, 0);
  const cards = L.options.map((o, i) => {
    const isTruth = o.oid === L.truthOid;
    const voters = votersFor(o.oid).map((pid) => nameOf(S, pid));
    const meta = isTruth
      ? `The truth · ${voters.length ? `found by ${esc(joinNames(voters))}` : 'nobody found it'}`
      : `Bluff by ${esc(nameOf(S, o.pid))}${o.pid === S.me && !watch ? ' (you)' : ''} · ${voters.length ? `fooled ${esc(joinNames(voters))}` : 'fooled nobody'}${pts[o.pid] && o.n ? ` · +${Math.min(100, o.n * 50)}` : ''}`;
    const cls = ['gk-choice', isTruth && 'is-correct', !isTruth && myPick === o.oid && 'is-wrong'].filter(Boolean).join(' ');
    return `<li class="${cls}"><span class="gk-mark" aria-hidden="true">${LETTERS[i] || ''}</span>`
      + `<div class="gk-choice-text"><div>${esc(o.text)}</div><div class="gk-meta">${meta}</div>${shareBar(o.n, total)}</div></li>`;
  }).join('');
  const sub = watch || myPick == null ? `The truth: ${L.truth}`
    : myPick === L.truthOid ? `You found the truth: ${L.truth} (+100)` : `You were fooled. The truth: ${L.truth}`;
  return scene(S, 'Bluff reveal', `<h2 class="gk-prompt">${esc(L.prompt)}</h2>`
    + `<p class="gk-sub bl-winner">${esc(sub)}</p>`
    + `<div class="gk-actions is-center bl-foot">`
    + (canNext ? `<button type="button" class="gk-btn gk-primary" id="bNext">Next</button>`
      : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next round starts soon', { done: true }))
    + `</div>`
    + `<ol class="gk-choices bl-list" style="--gk-cols:1;--gk-cols-phone:1">${cards}</ol>`);
}

function pickHtml(S, watch) {
  const voted = S.myPick !== null && S.myPick !== undefined;
  const own = watch ? null : S.myOption;
  const cards = (S.options || []).map((o, i) => {
    const mine = o.oid === own;
    const picked = S.myPick === o.oid;
    const off = watch || voted || mine;
    return `<button type="button" class="gk-choice${picked ? ' is-selected' : ''}${mine ? ' is-dim' : ''}" data-v="${esc(o.oid)}" aria-pressed="${picked}"${off ? ' disabled' : ''}${mine ? ' title="Your own bluff — pick the truth"' : ''}>`
      + `<span class="gk-mark" aria-hidden="true">${LETTERS[i] || ''}</span><span class="gk-choice-text">${esc(o.text)}${mine ? ' <small class="gk-meta">(your bluff)</small>' : ''}</span></button>`;
  }).join('');
  const sub = watch ? 'You are watching. The players are hunting for the truth.'
    : voted ? 'Locked in. Wait for the reveal.'
      : 'One of these is true. Pick it.';
  return scene(S, 'Find the truth', `<h2 class="gk-prompt">${esc(S.fact?.prompt || '')}</h2>`
    + `<p class="gk-sub">${esc(sub)}</p>`
    + `<div class="gk-choices${voted ? ' is-locked' : ''}" role="group" aria-label="Answer options" style="--gk-cols:2;--gk-cols-phone:1">${cards}</div>`
    + `<div class="bl-foot" data-live="wait">${voted || watch ? waitLine(S) : ''}</div>`);
}

function bluffHtml(S, watch) {
  let body;
  if (watch) {
    body = `<p class="gk-sub">You are watching. Everyone is writing a fake answer.</p>`
      + `<div class="bl-foot" data-live="wait">${waitLine(S)}</div>`;
  } else if (S.myFake) {
    body = `<div class="gk-card bl-mine"><span class="gk-meta">Your bluff is locked in</span><p>${esc(S.myFake)}</p></div>`
      + `<div class="bl-foot" data-live="wait">${waitLine(S)}</div>`;
  } else {
    body = `<p class="gk-sub">Fill the blank with a fake answer that sounds true. Fool the others.</p>`
      + inputRow({ id: 'bFake', label: 'Your fake answer', placeholder: 'Your fake answer…', max: 120, btnId: 'bSend', button: 'Lock in' })
      + `<div class="bl-foot" data-live="wait"></div>`;
  }
  return scene(S, 'Write a bluff', `<h2 class="gk-prompt">${esc(S.fact?.prompt || '')}</h2>${body}`);
}

export default {
  styles: [CSS],
  ownsTimer: true,
  dispose() { stopHudTimer(liveTimerEl); liveTimerEl = null; feedback = null; screenKey = ''; liveApi = null; liveEl = null; liveState = null; liveActionKey = ''; },
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};

function paint(el, S, api) {
    ensureStylesheet('bluff-css', CSS);
    const feedbackKey = `${S.instanceId || ''}:${S.me}:${S.round}`;
    if (S.instanceId && !S.audioBaseline && !S.preparing && !S.spectator && feedback?.key === feedbackKey && feedback?.phase === 'pick' && S.phase === 'reveal' && S.last?.picks?.[S.me] && S.last.picks[S.me] === S.last.truthOid) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:truth-found:${S.me}`, gain: 0.8 });
    }
    feedback = { key: feedbackKey, phase: S.phase };
    liveApi = api;
    liveEl = el;
    liveState = S;
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.endsAt, S.hostId, !!S.spectator, S.myOption, S.myPick]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !isWatching(liveState);
    const sendAction = (action) => (canAct() ? liveApi?.send(action) : false);
    const watch = isWatching(S);

    const key = S.phase === 'done'
      ? JSON.stringify(['done', S.instanceId, S.me, S.scores, S.players])
      : S.phase === 'reveal'
        ? JSON.stringify(['reveal', S.instanceId, S.me, watch, S.round, S.hostId, S.last])
        : JSON.stringify([S.phase, S.instanceId, S.me, watch, S.round, S.endsAt, S.fact?.prompt, S.myFake ? 1 : 0, S.myPick, S.myOption, S.phase === 'pick' ? S.options : null]);
    if (key === screenKey && el.querySelector?.('[data-scene="bluff"]')) {
      const h = el.querySelector('.gk-hud');
      if (h) h.outerHTML = hud(S);
      const w = el.querySelector('[data-live="wait"]');
      if (w && w.children.length) w.innerHTML = waitLine(S);
      return;
    }
    screenKey = key;

    if (S.phase === 'done') {
      el.innerHTML = finalHtml({ scene: 'bluff', scores: S.scores || {}, players: S.players || [], you: watch ? null : S.me, watching: watch });
      return;
    }
    if (S.phase === 'reveal' && S.last) {
      el.innerHTML = revealHtml(S, watch);
      const nx = el.querySelector?.('#bNext');
      if (nx) nx.onclick = () => sendAction({ next: true });
      return;
    }
    if (S.phase === 'pick') {
      el.innerHTML = pickHtml(S, watch);
      el.querySelectorAll('[data-v]').forEach((b) => {
        b.onclick = () => { if (!b.disabled) sendAction({ pick: b.dataset.v }); };
      });
      return;
    }
    el.innerHTML = bluffHtml(S, watch);
    const inp = el.querySelector('#bFake');
    const send = () => {
      if (!canAct()) return;
      const v = inp ? inp.value.trim() : '';
      if (v) sendAction({ fake: v });
    };
    const form = el.querySelector('[data-gk-input]');
    if (form) form.onsubmit = (e) => { e?.preventDefault?.(); send(); };
    const btn = el.querySelector('#bSend');
    if (btn) btn.onclick = (e) => { e?.preventDefault?.(); send(); };
    if (inp) inp.onkeydown = (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault?.();
      send();
    };
}
