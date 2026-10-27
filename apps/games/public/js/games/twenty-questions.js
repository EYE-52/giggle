/* Twenty Questions view: guessers ask + guess, answerer taps yes/no/sometimes.
 *
 * Question-desk layout with a scoped stylesheet (public/css/twenty-questions.css,
 * injected here so no shared stylesheet is touched).
 *
 * Contracts preserved: {question}, {guess}, {answer, qi}, {next:true}.
 * Private word: S.wordShown renders only for the answerer; reveal shows S.word
 * to everyone. Spectators follow the question desk with client-disabled controls.
 * Focus: inputs and the spotlight buttons are built once per phase and only
 * patched afterwards, so typing/answers survive snapshot repaints. History is
 * newest first with stable filters in the page flow. No clock here —
 * the shell owns the shared timer.
 */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { roundLabel, paintFinal, syncHudTimer, stopHudTimer } from '../kit.js';

let feedback = null;

const CSS_ID = 'tq-css';
const CSS_HREF = '/css/twenty-questions.css';

let phaseKey = '';
let R = null; // live refs for the mounted phase skeleton
let spotQi = -1; // qi the spotlight Yes/No/Sometimes buttons answer
let histFilter = 'all';
let liveS = null, liveApi = null, liveEl = null;

function sendAction(el, key, phase, action) {
  if (!liveS || liveEl !== el || phaseKey !== key || liveS.phase !== phase || liveS.preparing || liveS.spectator || !(liveS.players || []).some(p => p.id === liveS.me) ||
      (phase === 'play' && liveS.endsAt > 0 && typeof liveApi.now === 'function' && liveApi.now() >= liveS.endsAt)) return false;
  return liveApi.send(action);
}

// Original ink-and-sticker art, reused in answers, filters and history.
export function answerIcon(answer) {
  const hand = '<path d="M12 14l5-9c.8-1.5 3-1 3 .7V12h6c2 0 2.8 1.5 2.3 3.2l-2.7 10c-.3 1.2-1.2 2-2.5 2H12Z"/>';
  const cuff = '<rect x="3" y="13" width="9" height="15" rx="3"/><circle cx="7.5" cy="23.5" r=".8" fill="var(--edge)" stroke="none"/>';
  const art = answer === 'yes'
    ? `<g fill="var(--sun)">${hand}</g><g fill="var(--teal)">${cuff}</g>`
    : answer === 'no'
      ? `<g transform="translate(0 32) scale(1 -1)"><g fill="var(--melon)">${hand}</g><g fill="var(--accent-soft)">${cuff}</g></g>`
      : '<path d="M10 30v-8q6-4 12 0v8" fill="var(--teal)"/>' +
        '<path d="m11 23-5-3-2-5m17 8 5-3 2-5" fill="none"/>' +
        '<g fill="var(--sun)"><circle cx="16" cy="10" r="6"/><ellipse cx="3.5" cy="14.5" rx="3" ry="1.8"/><ellipse cx="28.5" cy="14.5" rx="3" ry="1.8"/></g>' +
        '<path d="M11 6q4-6 10 0M14 13q2-1 4 0" fill="none"/>' +
        '<g fill="var(--edge)" stroke="none"><circle cx="14" cy="9.5" r=".8"/><circle cx="18" cy="9.5" r=".8"/></g>';
  return `<svg class="tq-icon" viewBox="0 0 32 32" width="26" height="26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" stroke="var(--edge)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${art}</svg>`;
}

function ensureCss() {
  ensureStylesheet(CSS_ID, CSS_HREF);
}

function removeCss() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  for (const id of [CSS_ID]) {
    const l = document.getElementById(id);
    if (l) l.remove();
  }
}

function pending(S) {
  return (S.questions || []).map((q, i) => ({ q, i })).filter(({ q }) => !q.answer);
}

function answeredRows(S) {
  return (S.questions || []).map((q, i) => ({ q, i })).filter(({ q }) => q.answer);
}

function pill(a) {
  if (!a) return '<span class="tq-pill is-wait" aria-label="waiting for answer">…</span>';
  const cls = a === 'yes' ? 'is-yes' : a === 'no' ? 'is-no' : 'is-some';
  return `<span class="tq-pill ${cls}">${answerIcon(a)} ${esc(a)}</span>`;
}

function histHtml(S, includePending = false) {
  const rows = (includePending ? (S.questions || []).map((q, i) => ({ q, i })) : answeredRows(S))
    .filter(({ q }) => histFilter === 'all' || q.answer === histFilter).reverse();
  if (!rows.length) return `<div class="tq-empty">${histFilter === 'all' ? 'No answers yet.' : 'No ' + histFilter + ' answers yet.'}</div>`;
  return rows.map(({ q, i }) =>
    `<div class="tq-row" role="listitem"><div class="tq-row-meta"><span class="tq-num">Q${i + 1}</span>` +
    `<b>${esc(nameOf(S, q.pid))}</b>${pill(q.answer)}</div><div class="tq-q">${esc(q.text)}</div></div>`).join('');
}

function historyFilters() {
  return `<div class="tq-filters" aria-label="Filter question history">${[
    ['all', 'All'], ['yes', 'Yes'], ['no', 'No'], ['sometimes', 'Sometimes'],
  ].map(([key, label]) => `<button type="button" class="tq-filter" data-filter="${key}" aria-label="${label} answers" aria-pressed="${key === histFilter}" data-watchok>${key === 'all' ? '<svg class="tq-icon tq-list-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' : answerIcon(key)}<span class="tq-filter-label">${label}</span> <span class="tq-filter-count">0</span></button>`).join('')}</div>`;
}

function paintHistory(includePending = false) {
  if (!R.hist || !liveS) return;
  R.hist.innerHTML = histHtml(liveS, includePending);
  if (R.filters) R.filters.querySelectorAll('[data-filter]').forEach((b) => {
    const key = b.dataset.filter;
    const count = (liveS.questions || []).filter(q => key === 'all' ? includePending || q.answer : q.answer === key).length;
    const label = key === 'all' ? 'All' : key.charAt(0).toUpperCase() + key.slice(1);
    b.setAttribute('aria-pressed', String(key === histFilter));
    b.setAttribute('aria-label', `${label} answers: ${count}`);
    const countEl = b.querySelector('.tq-filter-count');
    if (countEl) countEl.textContent = String(count);
  });
}

function wireFilters(includePending = false) {
  if (!R.filters) return;
  R.filters.onclick = (e) => {
    const b = e.target.closest && e.target.closest('[data-filter]');
    if (!b) return;
    const changed = histFilter !== b.dataset.filter;
    histFilter = b.dataset.filter;
    paintHistory(includePending);
    if (changed && R.hist) R.hist.scrollTop = 0;
  };
}

function wrongHtml(S) {
  const wrong = S.wrong || [];
  if (!wrong.length) return '';
  return `Misses: ${wrong.map((w) => w.text).join(' · ')}`;
}

/* ---------------- play phase ---------------- */

function buildPlay(el, S, api, isAns) {
  const key = phaseKey;
  const spotCtl = isAns
    ? `<div class="tq-answers">
        <button class="gk-btn tq-ans" id="tqYes" type="button" aria-label="Answer yes">${answerIcon('yes')} Yes</button>
        <button class="gk-btn tq-ans" id="tqNo" type="button" aria-label="Answer no">${answerIcon('no')} No</button>
        <button class="gk-btn tq-ans" id="tqSome" type="button" aria-label="Answer sometimes">${answerIcon('sometimes')} Sometimes</button>
      </div>`
    : '<p class="gk-wait tq-wait" id="tqSpotWait" role="status"></p>';
  const ask = isAns ? '' : `
      <div class="tq-askrow">
        <input id="tQ" class="gk-input" type="text" placeholder="Ask a yes/no question…" maxlength="140"
          autocomplete="off" autocapitalize="sentences" autocorrect="off" spellcheck="false" enterkeyhint="send" inputmode="text" aria-label="Ask a yes or no question">
        <button class="gk-btn gk-primary" id="tQSend" type="button">Ask</button>
      </div>
      <div class="tq-askrow">
        <input id="tG" class="gk-input" type="text" placeholder="Guess the word…" maxlength="40"
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" inputmode="text" aria-label="Guess the secret word">
        <button class="gk-btn" id="tGSend" type="button">Guess</button>
      </div>
      <p class="tq-askstate" id="tqAskState" role="status"></p>`;
  el.innerHTML = `
    <div class="tq" data-role="${isAns ? 'answerer' : 'guesser'}">
      ${tqHud(S, 'play', isAns ? 'Answer' : 'Ask', 'tqBadge')}
      <div class="tq-top">
        <div class="tq-role">
          <h3 class="gk-prompt tq-roleline" id="tqRole"></h3>
          <div class="gk-sub tq-wordline" id="tqWord"></div>
        </div>
        <div class="tq-budget" aria-hidden="true"><i id="tqBudgetFill"></i></div>
      </div>
      <div class="tq-cols">
        <section class="tq-desk" aria-label="Question desk">
          <div class="tq-spot">
            <div class="tq-qmeta" id="tqSpotMeta"></div>
            <div class="tq-qtext" id="tqSpotQ"></div>
            ${spotCtl}
          </div>
          ${ask}
          ${S.hints ? isAns
            ? '<div class="tq-hints"><p class="tq-hint-note" id="tqHintNote"></p></div>'
            : `<details class="tq-hints"><summary><span>Letter hints</span><span class="tq-hint-mask" id="tqHintMask" aria-label="Shared word hint"></span></summary>
              <p class="tq-hint-note" id="tqHintNote"></p><button class="gk-btn gk-quiet" id="tqHint" type="button">Reveal a letter</button></details>` : ''}
          <div id="tqQWrap">
            <div class="tq-sec">Up next</div>
            <div class="tq-queue" id="tqQueue" role="list"
              aria-label="Questions waiting for an answer"></div>
          </div>
        </section>
        <section class="tq-arch" aria-label="Answered questions">
          <div class="tq-sec">Answered</div>
          ${historyFilters()}
          <div class="tq-hist" id="tqHist" role="list"
            aria-label="Answered questions, newest first"></div>
          <div class="tq-wrong" id="tqWrong"></div>
        </section>
      </div>
    </div>`;
  R = {
    role: el.querySelector('#tqRole'),
    word: el.querySelector('#tqWord'),
    badge: el.querySelector('#tqBadge'),
    budget: el.querySelector('#tqBudgetFill'),
    spot: el.querySelector('.tq-spot'),
    spotMeta: el.querySelector('#tqSpotMeta'),
    spotQ: el.querySelector('#tqSpotQ'),
    spotWait: el.querySelector('#tqSpotWait'),
    qwrap: el.querySelector('#tqQWrap'),
    queue: el.querySelector('#tqQueue'),
    hist: el.querySelector('#tqHist'),
    wrong: el.querySelector('#tqWrong'),
    filters: el.querySelector('.tq-filters'),
    hintMask: el.querySelector('#tqHintMask'),
    hintNote: el.querySelector('#tqHintNote'),
    hintBtn: el.querySelector('#tqHint'),
    askState: el.querySelector('#tqAskState'),
  };
  wireFilters();
  if (R.hintBtn) R.hintBtn.onclick = () => { if (liveS?.hintAvailable) sendAction(el, key, 'play', { hint: true }); };

  // Wired once per skeleton; update() never replaces these nodes.
  const wire = (inpSel, btnSel, fn) => {
    const btn = el.querySelector(btnSel);
    if (btn) btn.onclick = fn;
    const inp = el.querySelector(inpSel);
    if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) fn(); };
  };
  wire('#tQ', '#tQSend', () => {
    const inp = el.querySelector('#tQ');
    if (inp && !inp.disabled && inp.value.trim()) {
      if (liveS?.answerer === liveS?.me || pending(liveS).some(({ q }) => q.pid === liveS.me) || (liveS.questions || []).length >= (liveS.maxQ || 20) || sendAction(el, key, 'play', { question: inp.value.trim() }) === false) return;
      inp.value = '';
    }
  });
  wire('#tG', '#tGSend', () => {
    const inp = el.querySelector('#tG');
    if (inp && !inp.disabled && inp.value.trim()) {
      if (liveS?.answerer === liveS?.me || sendAction(el, key, 'play', { guess: inp.value.trim() }) === false) return;
      inp.value = '';
    }
  });
  const yes = el.querySelector('#tqYes');
  const no = el.querySelector('#tqNo');
  const some = el.querySelector('#tqSome');
  if (yes) yes.onclick = () => { if (spotQi >= 0 && liveS?.answerer === liveS?.me) sendAction(el, key, 'play', { answer: 'yes', qi: spotQi }); };
  if (no) no.onclick = () => { if (spotQi >= 0 && liveS?.answerer === liveS?.me) sendAction(el, key, 'play', { answer: 'no', qi: spotQi }); };
  if (some) some.onclick = () => { if (spotQi >= 0 && liveS?.answerer === liveS?.me) sendAction(el, key, 'play', { answer: 'sometimes', qi: spotQi }); };
  // One delegated listener for the whole pending queue (stable button ids keep
  // keyboard focus across repaints via the host's focus restore).
  if (R.queue) {
    R.queue.onclick = (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-qi]') : null;
      if (b && !b.disabled && liveS?.answerer === liveS?.me) sendAction(el, key, 'play', { answer: b.dataset.a, qi: Number(b.dataset.qi) });
    };
  }
}

function updatePlay(el, S, api, isAns) {
  if (R.role) R.role.textContent = S.spectator ? `Watching · ${nameOf(S, S.answerer)} holds a secret word` : isAns ? 'You are the answerer' : `${nameOf(S, S.answerer)} holds a secret word`;
  if (R.word) {
    R.word.innerHTML = isAns
      ? `Your word: <b>${esc(S.wordShown || '')}</b>`
      : S.spectator ? 'Follow the questions as the room uncovers the word.' : 'Ask yes/no questions, or guess the word outright.';
  }
  if (R.badge) R.badge.textContent = `${S.answered || 0} of ${S.maxQ || 20} answered`;
  if (R.budget) R.budget.style.width = `${Math.max(0, Math.min(100, ((S.answered || 0) / (S.maxQ || 20)) * 100))}%`;
  if (R.hintMask) R.hintMask.textContent = Array.from(S.masked || '').join(' ');
  if (R.hintNote) R.hintNote.textContent = `Hints ${S.hintsUsed || 0}/${S.hintCap || 2} · −${S.hintCost || 50} points each`;
  if (R.hintBtn) {
    R.hintBtn.disabled = !S.hintAvailable || !!S.spectator;
    R.hintBtn.textContent = S.hintAvailable ? `Reveal a letter · −${S.hintCost || 50} pts` : 'No more letter hints';
  }

  const pend = pending(S);
  const cur = pend[0];
  if (R.spot) R.spot.classList.toggle('is-idle', !cur);
  if (!isAns) {
    const ownPending = pend.some(({ q }) => q.pid === S.me);
    const full = (S.questions || []).length >= (S.maxQ || 20);
    for (const id of ['#tQ', '#tQSend']) {
      const b = el.querySelector(id);
      if (b) b.disabled = ownPending || full || !!S.spectator;
    }
    for (const id of ['#tG', '#tGSend']) {
      const b = el.querySelector(id);
      if (b) b.disabled = !!S.spectator;
    }
    if (R.askState) R.askState.textContent = full ? 'Question limit queued. You can still guess the word.' : ownPending ? 'Your question is waiting for an answer. You can still guess.' : '';
  }
  spotQi = cur ? cur.i : -1;
  if (R.spotMeta) {
    R.spotMeta.textContent = cur
      ? (isAns ? `Q${cur.i + 1} · ${nameOf(S, cur.q.pid)} asks` : `Q${cur.i + 1} · ${nameOf(S, cur.q.pid)} asked`)
      : 'All caught up';
  }
  if (R.spotQ) R.spotQ.textContent = cur ? cur.q.text : 'No questions waiting.';
  if (isAns) {
    // Disabled with no pending question, or for spectators (the host also
    // strips spectator controls after every paint — defence in depth).
    const lock = !cur || !!S.spectator;
    for (const id of ['#tqYes', '#tqNo', '#tqSome']) {
      const b = el.querySelector(id);
      if (b) b.disabled = lock;
    }
  } else if (R.spotWait) {
    R.spotWait.textContent = cur ? `Waiting on ${nameOf(S, S.answerer)}…` : (S.answered ? 'Ask another question.' : 'Ask the first question.');
  }

  const rest = pend.slice(1);
  if (R.qwrap) R.qwrap.hidden = rest.length === 0;
  if (R.queue) {
    R.queue.innerHTML = rest.map(({ q, i }) => {
      const left = `<div class="tq-row-meta"><span class="tq-num">Q${i + 1}</span>` +
        `<b>${esc(nameOf(S, q.pid))}</b>${isAns ? '' : pill(null)}</div>` +
        `<div class="tq-q">${esc(q.text)}</div>`;
      if (!isAns) return `<div class="tq-row" role="listitem">${left}</div>`;
      return `<div class="tq-row" role="listitem">${left}<span class="tq-qbtns">` +
        `<button class="gk-btn" id="tq-a-${i}-yes" type="button" data-qi="${i}" data-a="yes" aria-label="Answer question ${i + 1} yes">${answerIcon('yes')} Yes</button>` +
        `<button class="gk-btn" id="tq-a-${i}-no" type="button" data-qi="${i}" data-a="no" aria-label="Answer question ${i + 1} no">${answerIcon('no')} No</button>` +
        `<button class="gk-btn" id="tq-a-${i}-some" type="button" data-qi="${i}" data-a="sometimes" aria-label="Answer question ${i + 1} sometimes">${answerIcon('sometimes')} Sometimes</button>` +
        '</span></div>';
    }).join('');
  }

  paintHistory();
  if (R.wrong) R.wrong.textContent = wrongHtml(S);
}

/* ---------------- reveal phase ---------------- */

function revealMsg(S) {
  if (S.last && S.last.reason === 'guessed') {
    const n = S.last.answered;
    return `Word guessed! ${nameOf(S, S.last.winner)} got it after ${n} question${n === 1 ? '' : 's'}.`;
  }
  if (S.last && S.last.reason === 'left') {
    return `${nameOf(S, S.answerer)} left the game, so this round ends without points.`;
  }
  if (S.last && S.last.reason === 'questions') {
    return `Question limit reached (${S.maxQ || 20}) · ${nameOf(S, S.answerer)} gets the stumper bonus.`;
  }
  return `Time's up. Nobody got it · ${nameOf(S, S.answerer)} gets the stumper bonus.`;
}

function buildReveal(el, S, api, isAns) {
  const key = phaseKey;
  el.innerHTML = `
    <div class="tq" data-role="${isAns ? 'answerer' : 'guesser'}">
      ${tqHud(S, 'reveal', 'Results', 'tqRBadge')}
      <div class="tq-spot">
        <h3 class="gk-prompt tq-wordbig" id="tqRWord"></h3>
        <p class="gk-wait is-done tq-msg" id="tqRMsg" role="status"></p>
        <div class="gk-actions is-center tq-next">${(isAns || S.me === S.hostId) && !S.spectator ? '<button class="gk-btn gk-primary" id="tNext" type="button">Next</button>' : ''}</div>
      </div>
      <div class="tq-sec">How the questions landed</div>
      ${historyFilters()}
      <div class="tq-hist" id="tqRHist" role="list"
        aria-label="Questions from the finished round, newest first"></div>
    </div>`;
  R = {
    badge: el.querySelector('#tqRBadge'),
    word: el.querySelector('#tqRWord'),
    msg: el.querySelector('#tqRMsg'),
    hist: el.querySelector('#tqRHist'),
    filters: el.querySelector('.tq-filters'),
  };
  wireFilters(true);
  const nx = el.querySelector('#tNext');
  if (nx) nx.onclick = () => { if (liveS?.answerer === liveS?.me || liveS?.me === liveS?.hostId) sendAction(el, key, 'reveal', { next: true }); };
}

function updateReveal(S) {
  if (R.badge) R.badge.textContent = `${S.answered || 0} of ${S.maxQ || 20} answered`;
  if (R.word) R.word.innerHTML = `The word was <b>${esc(S.word || S.wordShown || '')}</b>`;
  if (R.msg) R.msg.textContent = revealMsg(S);
  paintHistory(true);
}

/* ---------------- done phase ---------------- */

/* One HUD row for every phase: round, phase, progress badge, kit timer. */
function tqHud(S, phase, label, badgeId) {
  return `<div class="gk-hud" data-phase="${phase}"><span class="gk-hud-round">${roundLabel(Math.max(1, Math.min(S.round || 1, S.rounds || 1)), S.rounds || 1)}</span>`
    + `<span class="gk-hud-phase">${esc(label)}</span><span class="gk-hud-progress tq-badge" id="${badgeId}" role="status"></span>`
    + `<span class="gk-hud-timer" aria-hidden="true"></span></div>`;
}

/* ---------------- lifecycle ---------------- */

function update(el, S, api) {
  paint(el, S, api);
  syncHudTimer(el, S, api);
}
function paint(el, S, api) {
  ensureCss();
  liveS = S; liveApi = api; liveEl = el;
  const feedbackKey = `${S.instanceId || ''}:${S.me}:${S.round}`;
  if (S.instanceId && !S.audioBaseline && !S.preparing && !S.spectator && feedback?.key === feedbackKey && feedback?.phase === 'play' && S.phase === 'reveal' && S.last?.reason === 'guessed' && S.last?.winner === S.me) {
    api.cue?.('correct', { id: `${S.instanceId}:${S.round}:word-guessed:${S.me}`, gain:0.8 });
  }
  feedback = { key:feedbackKey, phase:S.phase, solved:!!S.mySolved };

  const isAns = S.me === S.answerer;
  const key = `${S.instanceId || ''}:${S.me || ''}:${S.phase}:${S.round}:${S.answerer || ''}:${isAns ? 'a' : 'g'}`;
  if (key !== phaseKey) {
    phaseKey = key;
    spotQi = -1;
    if (S.phase === 'play') histFilter = 'all';
    R = null;
    if (S.phase === 'play') buildPlay(el, S, api, isAns);
    else if (S.phase === 'reveal') buildReveal(el, S, api, isAns);
  }
  if (S.phase === 'play') updatePlay(el, S, api, isAns);
  else if (S.phase === 'reveal') updateReveal(S);
  else paintFinal(el, { scene: 'twenty-questions', scores: S.scores || {}, players: S.players || [], you: S.spectator ? null : S.me, watching: !!S.spectator, note: S.last ? `Last round: ${revealMsg(S)}` : '' });
}

export default {
  styles: ['/css/twenty-questions.css'],
  ownsTimer: true,
  mount() {
    feedback = null;
    ensureCss();
    phaseKey = '';
    R = null;
    spotQi = -1;
    histFilter = 'all';
    liveS = null; liveApi = null; liveEl = null;
  },
  update,
  // Legacy harness fallback (the host prefers update()).
  render(el, S, api) {
    update(el, S, api);
  },
  dispose() {
    stopHudTimer(liveEl);
    feedback = null;
    phaseKey = '';
    R = null;
    spotQi = -1;
    histFilter = 'all';
    liveS = null; liveApi = null; liveEl = null;
    removeCss();
  },
};
