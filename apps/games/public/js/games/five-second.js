/* Five Second Rule view: the performer names 3 in 5 seconds, then the room
 * votes pass or fail. Built on the game kit (public/css/game-ui.css,
 * public/js/kit.js). */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { roundLabel, progressText, hudHtml, waitingHtml, finalHtml, syncHudTimer, stopHudTimer } from '../kit.js';

let liveTimerEl = null;

const CSS = '/css/five-second.css';

let screenKey = '', current = null;

function isWatching(S) {
  if (S.spectator === true) return true;
  const ps = S.players || [];
  return S.me != null && ps.length > 0 && !ps.some((p) => p.id === S.me);
}

function activeCount(S) {
  return (S.players || []).filter((p) => !p.left).length;
}

/* Sends only from the screen that drew the control, while its window is
 * open and the viewer holds the right role. */
function sendAction(el, origin, phase, action) {
  const live = current;
  if (!live || live.el !== el || live.S.instanceId !== origin.instanceId || live.S.round !== origin.round ||
      live.S.me !== origin.me || live.S.phase !== phase || isWatching(live.S) || live.S.preparing ||
      (live.S.endsAt > 0 && phase !== 'reveal' && typeof live.api.now === 'function' && live.api.now() >= live.S.endsAt)) return false;
  if (action.answers && (live.S.me !== live.S.performer || live.S.myAnswers)) return false;
  if (action.next && live.S.me !== live.S.performer && live.S.me !== live.S.hostId) return false;
  if (action.vote && (live.S.me === live.S.performer || live.S.myVote)) return false;
  return live.api.send(action);
}

function hud(S) {
  const progress = S.phase === 'vote' ? progressText((S.voted || []).length, Math.max(0, activeCount(S) - 1), 'voted') : '';
  const phase = { answer: 'Name three', vote: 'Judge', reveal: 'Verdict', done: 'Game over' }[S.phase] || '';
  return hudHtml({ round: roundLabel(Math.min(S.round || 1, S.rounds || S.round || 1), S.rounds), phase: phase + (isWatching(S) ? ' · Watching' : ''), progress })
    .replace('<div class="gk-hud"', `<div class="gk-hud" data-phase="${esc(S.phase)}"`);
}

function scene(S, label, inner) {
  return `<section class="gk-col gk-stack fs-scene" data-scene="five-second" data-phase="${esc(S.phase)}" aria-label="${esc(label)}">${hud(S)}${inner}</section>`;
}

function waitLine(S) {
  const left = Math.max(0, activeCount(S) - 1 - (S.voted || []).length);
  return waitingHtml(left, { done: !left });
}

function answersHtml(S) {
  if (S.answers && S.answers.length) {
    return `<ol class="fs-answers" aria-label="Answers">` + S.answers.map((a, i) =>
      `<li><span class="gk-mark" aria-hidden="true">${i + 1}</span><span>${esc(a)}</span></li>`).join('') + `</ol>`;
  }
  return `<p class="gk-card fs-none">No answer was sent in time.</p>`;
}

/* While the room prepares (or after a vote) controls pause in place, so a
 * draft and its selection survive. */
function lockControls(el, S) {
  for (const control of el.querySelectorAll?.('#fAns,#fSend,#fNext,[data-v]') || []) {
    control.disabled = !!(S.preparing || (S.phase === 'vote' && S.myVote));
  }
}

export default {
  styles: [CSS],
  ownsTimer: true,
  dispose() { stopHudTimer(liveTimerEl); liveTimerEl = null; screenKey = ''; current = null; },
  render(el, S, api) {
    paint(el, S, api);
    liveTimerEl = el;
    syncHudTimer(el, S, api);
  },
};

function paint(el, S, api) {
    ensureStylesheet('five-second-css', CSS);
    const prior = current;
    current = { el, S, api };
    if (prior?.el !== el) screenKey = '';
    if (!S.audioBaseline && prior?.el === el && prior.S.instanceId === S.instanceId && prior.S.round === S.round &&
        prior.S.phase === 'vote' && S.phase === 'reveal' && S.last?.passed && S.performer === S.me) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:five-passed`, gain: 0.8 });
    }
    const watch = isWatching(S);
    const isStar = !watch && S.me === S.performer;
    const who = nameOf(S, S.performer);

    const key = S.phase === 'done'
      ? JSON.stringify(['done', S.instanceId, S.me, S.scores, S.players])
      : JSON.stringify([S.phase, S.instanceId, S.me, watch, S.round, S.performer, S.hostId, S.myVote || null, S.phase === 'reveal' ? S.last : null, S.phase === 'vote' ? S.answers : null]);
    if (key === screenKey && el.querySelector?.('[data-scene="five-second"]')) {
      const h = el.querySelector('.gk-hud');
      if (h) h.outerHTML = hud(S);
      const w = el.querySelector('[data-live="wait"]');
      if (w && w.children.length) w.innerHTML = waitLine(S);
      lockControls(el, S);
      return;
    }
    screenKey = key;

    if (S.phase === 'done') {
      el.innerHTML = finalHtml({ scene: 'five-second', scores: S.scores || {}, players: S.players || [], you: watch ? null : S.me, watching: watch });
      return;
    }

    if (S.phase === 'answer') {
      if (isStar) {
        el.innerHTML = scene(S, 'Name three things', `<h2 class="gk-prompt">Name 3: ${esc(S.category)}</h2>`
          + `<p class="gk-sub">Quick! Three answers, separated by commas.</p>`
          + `<form class="gk-input-row" data-gk-input autocomplete="off">`
          + `<input id="fAns" class="gk-input" aria-label="Three things in the category, separated by commas" type="text" placeholder="one, two, three" maxlength="120" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="send">`
          + `<button type="submit" class="gk-btn gk-primary" id="fSend">Send</button></form>`);
        const inp = el.querySelector('#fAns');
        const send = () => {
          if (inp && !inp.disabled && inp.value.trim()) sendAction(el, S, 'answer', { answers: inp.value.trim() });
        };
        const form = el.querySelector('[data-gk-input]');
        if (form) form.onsubmit = (e) => { e?.preventDefault?.(); send(); };
        el.querySelector('#fSend').onclick = (e) => { e?.preventDefault?.(); send(); };
        inp.onkeydown = (e) => {
          if (e.key !== 'Enter' || e.repeat || e.isComposing || e.keyCode === 229) return;
          e.preventDefault?.();
          send();
        };
        inp.focus();
      } else {
        el.innerHTML = scene(S, 'Performer naming three', `<h2 class="gk-prompt">${esc(who)} names 3: ${esc(S.category)}</h2>`
          + `<p class="gk-sub">${watch ? 'You are watching. ' : ''}Five seconds on the clock. Then you judge.</p>`
          + `<div class="fs-foot">${waitingHtml(`Waiting for ${who}`)}</div>`);
      }
    } else if (S.phase === 'vote') {
      const mine = S.myVote;
      let action = '';
      if (!watch && !isStar) {
        action = `<div class="gk-choices${mine ? ' is-locked' : ''}" role="group" aria-label="Judge the answers" style="--gk-cols:2;--gk-cols-phone:2">`
          + ['pass', 'fail'].map((v) => `<button type="button" class="gk-choice fs-verdict${mine === v ? ' is-selected' : ''}" data-v="${v}" aria-pressed="${mine === v}"${mine ? ' disabled' : ''}>`
            + `<span class="gk-mark" aria-hidden="true">${v === 'pass' ? '✓' : '✕'}</span><span class="gk-choice-text">${v === 'pass' ? 'Pass' : 'Fail'}</span></button>`).join('')
          + `</div>`;
      }
      const sub = watch ? `You are watching. The room is judging ${who}.`
        : isStar ? 'The room is judging your answers.'
          : mine ? `Locked in: ${mine === 'pass' ? 'Pass' : 'Fail'}`
            : `Did ${who} name three that fit?`;
      el.innerHTML = scene(S, 'Judge the answers', `<h2 class="gk-prompt">Name 3: ${esc(S.category)}</h2>`
        + `<p class="gk-sub">${esc(sub)}</p>`
        + answersHtml(S) + action
        + `<div class="fs-foot" data-live="wait">${mine || watch || isStar ? waitLine(S) : ''}</div>`);
      el.querySelectorAll('[data-v]').forEach((b) => {
        b.onclick = () => { if (!b.disabled) sendAction(el, S, 'vote', { vote: b.dataset.v }); };
      });
    } else if (S.phase === 'reveal' && S.last) {
      const votes = S.last.votes || {};
      const by = (v) => Object.keys(votes).filter((pid) => votes[pid] === v).map((pid) => nameOf(S, pid));
      const pass = by('pass'), fail = by('fail');
      const pts = (S.last.points || {})[S.performer];
      const canNext = !watch && (S.me === S.performer || S.me === S.hostId);
      el.innerHTML = scene(S, 'Round verdict', `<h2 class="gk-prompt">${S.last.passed ? `${esc(who)} passed` : `${esc(who)} failed`}</h2>`
        + `<p class="gk-sub fs-verdict-line">${S.last.passed ? `+${pts || 0} for ${esc(who)}` : 'No points this round'} · Name 3: ${esc(S.category)}</p>`
        + `<div class="gk-actions is-center fs-foot">`
        + (canNext ? `<button type="button" class="gk-btn gk-primary" id="fNext">Next</button>`
          : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next round starts soon', { done: true }))
        + `</div>`
        + answersHtml(S)
        + `<p class="gk-meta">Pass: ${pass.length ? esc(pass.join(', ')) : 'nobody'} · Fail: ${fail.length ? esc(fail.join(', ')) : 'nobody'}</p>`);
      const nx = el.querySelector('#fNext');
      if (nx) nx.onclick = () => sendAction(el, S, 'reveal', { next: true });
    }
    lockControls(el, S);
}
