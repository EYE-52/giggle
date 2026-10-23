/* Punchline (funny-answer) view: secret answers, anonymous vote, reveal.
 * Built on the game kit (public/css/game-ui.css, public/js/kit.js). */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { roundLabel, progressText, hudHtml, waitingHtml, finalHtml, syncHudTimer, stopHudTimer } from '../kit.js';

let liveTimerEl = null;

const CSS = '/css/funny-answer.css';

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
  const progress = S.phase === 'answer' ? progressText((S.submitted || []).length, n, 'answered')
    : S.phase === 'vote' ? progressText((S.voted || []).length, n, 'voted') : '';
  const phase = { answer: 'Answer', vote: 'Vote', reveal: 'Reveal', done: 'Game over' }[S.phase] || 'Answer';
  return hudHtml({ round: roundLabel(Math.min(S.round || 1, S.rounds || S.round || 1), S.rounds), phase: phase + (isWatching(S) ? ' · Watching' : ''), progress })
    .replace('<div class="gk-hud"', `<div class="gk-hud" data-phase="${esc(S.phase)}"`);
}

function scene(S, label, inner) {
  return `<section class="gk-col gk-stack fa-scene" data-scene="funny-answer" data-phase="${esc(S.phase)}" aria-label="${esc(label)}">${hud(S)}${inner}</section>`;
}

function waitLine(S) {
  const n = activeCount(S);
  const done = S.phase === 'answer' ? (S.submitted || []).length : (S.voted || []).length;
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
  const canNext = !watch && S.me === S.hostId;
  const foot = `<div class="gk-actions is-center fa-foot">`
    + (canNext ? `<button type="button" class="gk-btn gk-primary" id="fNext">Next</button>`
      : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next round starts soon', { done: true }))
    + `</div>`;
  if (L.skipped) {
    return scene(S, 'Round skipped', `<h2 class="gk-prompt">${esc(L.prompt)}</h2>`
      + `<p class="gk-sub">Nobody answered this round. No points.</p>${foot}`);
  }
  const pts = L.points || {};
  const winners = (L.winners || []).map((aid) => L.options.find((o) => o.aid === aid)).filter(Boolean);
  const names = [...new Set(winners.map((o) => nameOf(S, o.pid)))];
  const line = !winners.length ? 'No votes this round'
    : names.length > 1 ? `It's a tie: ${joinNames(names)}` : `Funniest: ${names[0]}`;
  const total = L.options.reduce((n, o) => n + o.n, 0);
  const cards = L.options.map((o, i) => {
    const win = (L.winners || []).includes(o.aid);
    const mine = !watch && o.pid === S.me;
    const meta = `${esc(nameOf(S, o.pid))}${mine ? ' (you)' : ''} · ${o.n} vote${o.n === 1 ? '' : 's'}${pts[o.pid] ? ` · +${pts[o.pid]}` : ''}`;
    return `<li class="gk-choice${win ? ' is-correct' : ''}"><span class="gk-mark" aria-hidden="true">${LETTERS[i] || ''}</span>`
      + `<div class="gk-choice-text"><div>${esc(o.text)}</div><div class="gk-meta">${meta}</div>${shareBar(o.n, total)}</div></li>`;
  }).join('');
  return scene(S, 'Winning answer', `<h2 class="gk-prompt">${esc(L.prompt)}</h2>`
    + `<p class="gk-sub fa-winner${names.length > 1 ? ' is-tie' : ''}">${esc(line)}</p>`
    + foot + `<ol class="gk-choices fa-list" style="--gk-cols:1;--gk-cols-phone:1">${cards}</ol>`);
}

function voteHtml(S, watch) {
  const voted = S.myVote !== null && S.myVote !== undefined;
  const own = watch ? null : S.myEntry;
  const cards = (S.options || []).map((o, i) => {
    const mine = o.aid === own;
    const picked = S.myVote === o.aid;
    const off = watch || voted || mine;
    return `<button type="button" class="gk-choice${picked ? ' is-selected' : ''}${mine ? ' is-dim' : ''}" data-v="${esc(o.aid)}" aria-pressed="${picked}"${off ? ' disabled' : ''}${mine ? ' title="Your own answer — vote for someone else"' : ''}>`
      + `<span class="gk-mark" aria-hidden="true">${LETTERS[i] || ''}</span><span class="gk-choice-text">${esc(o.text)}${mine ? ' <small class="gk-meta">(yours)</small>' : ''}</span></button>`;
  }).join('');
  const onlyMine = !watch && (S.options || []).every((o) => o.aid === own);
  const sub = watch ? 'You are watching. The players are voting.'
    : voted ? 'Locked in. Your vote is secret.'
      : onlyMine ? 'Yours is the only answer. The others are voting.'
        : 'Vote for the funniest answer. Not your own.';
  return scene(S, 'Vote the funniest', `<h2 class="gk-prompt">${esc(S.prompt)}</h2>`
    + `<p class="gk-sub">${esc(sub)}</p>`
    + `<div class="gk-choices${voted ? ' is-locked' : ''}" role="group" aria-label="Anonymous answers" style="--gk-cols:2;--gk-cols-phone:1">${cards}</div>`
    + `<div class="fa-foot" data-live="wait">${voted || watch || onlyMine ? waitLine(S) : ''}</div>`);
}

function answerHtml(S, watch) {
  let body;
  if (watch) {
    body = `<p class="gk-sub">You are watching. Everyone is writing a secret answer.</p>`
      + `<div class="fa-foot" data-live="wait">${waitLine(S)}</div>`;
  } else if (S.myAnswer) {
    body = `<div class="gk-card fa-mine"><span class="gk-meta">Locked in</span><p>${esc(S.myAnswer)}</p></div>`
      + `<div class="fa-foot" data-live="wait">${waitLine(S)}</div>`;
  } else {
    body = `<p class="gk-sub">Write the funniest answer you can. It stays secret until the vote.</p>`
      + inputRow({ id: 'fAns', label: 'Your funniest answer', placeholder: 'Your funniest answer…', max: 120, btnId: 'fSend', button: 'Lock in' })
      + `<div class="fa-foot" data-live="wait"></div>`;
  }
  return scene(S, 'Write your answer', `<h2 class="gk-prompt">${esc(S.prompt)}</h2>${body}`);
}

export default {
  styles: [CSS],
  ownsTimer: true,
  dispose() { stopHudTimer(liveTimerEl); liveTimerEl = null; screenKey = ''; liveApi = null; liveEl = null; liveState = null; liveActionKey = ''; },
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};

function paint(el, S, api) {
    ensureStylesheet('funny-answer-css', CSS);
    liveApi = api;
    liveEl = el;
    liveState = S;
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.endsAt, S.hostId, !!S.spectator, S.myEntry, S.myVote]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !isWatching(liveState);
    const sendAction = (action) => (canAct() ? liveApi?.send(action) : false);
    const watch = isWatching(S);

    const key = S.phase === 'done'
      ? JSON.stringify(['done', S.instanceId, S.me, S.scores, S.players])
      : S.phase === 'reveal'
        ? JSON.stringify(['reveal', S.instanceId, S.me, watch, S.round, S.hostId, S.last])
        : JSON.stringify([S.phase, S.instanceId, S.me, watch, S.round, S.endsAt, S.prompt, S.myAnswer ? 1 : 0, S.myVote, S.myEntry, S.phase === 'vote' ? S.options : null]);
    if (key === screenKey && el.querySelector?.('[data-scene="funny-answer"]')) {
      const h = el.querySelector('.gk-hud');
      if (h) h.outerHTML = hud(S);
      const w = el.querySelector('[data-live="wait"]');
      if (w && w.children.length) w.innerHTML = waitLine(S);
      return;
    }
    screenKey = key;

    if (S.phase === 'done') {
      el.innerHTML = finalHtml({ scene: 'funny-answer', scores: S.scores || {}, players: S.players || [], you: watch ? null : S.me, watching: watch });
      return;
    }
    if (S.phase === 'reveal' && S.last) {
      el.innerHTML = revealHtml(S, watch);
      const nx = el.querySelector?.('#fNext');
      if (nx) nx.onclick = () => sendAction({ next: true });
      return;
    }
    if (S.phase === 'vote') {
      el.innerHTML = voteHtml(S, watch);
      el.querySelectorAll('[data-v]').forEach((b) => {
        b.onclick = () => { if (!b.disabled) sendAction({ vote: b.dataset.v }); };
      });
      return;
    }
    el.innerHTML = answerHtml(S, watch);
    const inp = el.querySelector('#fAns');
    const send = () => {
      if (!canAct()) return;
      const v = inp ? inp.value.trim() : '';
      if (v) sendAction({ answer: v });
    };
    const form = el.querySelector('[data-gk-input]');
    if (form) form.onsubmit = (e) => { e?.preventDefault?.(); send(); };
    const btn = el.querySelector('#fSend');
    if (btn) btn.onclick = (e) => { e?.preventDefault?.(); send(); };
    if (inp) inp.onkeydown = (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault?.();
      send();
    };
}
