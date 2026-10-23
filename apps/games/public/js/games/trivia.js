/* Trivia view: the game kit's HUD, question, four answer cards, a status
 * line and an action slot that keep their places through every phase.
 * Contracts: {pick: 0-3}, {next: true} (host, reveal). */
import { esc, nameOf, countdown, ensureStylesheet } from '../util.js';
import { hudHtml, roundLabel, progressText, choicesHtml, waitingHtml, resultsHtml } from '../kit.js';

const CSS = [['word-games-css', '/css/compact-answer-games.css']];
const LETTERS = 'ABCD';

let feedback = null;
let visualKey = '', liveApi = null, liveEl = null, liveState = null, liveActionKey = '';
let clock = null;

function ensureCss() { for (const [id, href] of CSS) ensureStylesheet(id, href); }

function isWatch(S) {
  if (S && S.spectator) return true;
  const ids = (S.players || []).map((p) => p.id);
  return !!S.me && ids.length > 0 && !ids.includes(S.me);
}

/* The kit's HUD timer slot counts down to the server deadline. */
function paintClock(el, S, api) {
  const slot = el.querySelector?.('.gk-hud-timer');
  if (!slot) return;
  const left = S.endsAt > 0 && !S.preparing && S.phase === 'answer' ? countdown(S.endsAt, api?.now) : null;
  const text = left === null ? '' : `${left}s`;
  if (slot.textContent !== text) slot.textContent = text;
  slot.classList?.toggle('is-urgent', left !== null && left <= 5);
}
function runClock(el, S, api) {
  if (clock !== null) clearInterval(clock);
  clock = null;
  paintClock(el, S, api);
  if (S.endsAt > 0 && S.phase === 'answer' && typeof setInterval === 'function') {
    clock = setInterval(() => paintClock(el, S, api), 250);
    clock?.unref?.();
  }
}

function hud(S, phase, progress) {
  return hudHtml({ round: roundLabel(S.round, S.rounds, 'Question'), phase, progress, timer: '' });
}

export default {
  styles: ['/css/compact-answer-games.css'],
  ownsTimer: true,
  dispose() {
    if (clock !== null) clearInterval(clock);
    clock = null; feedback = null; visualKey = ''; liveApi = null; liveEl = null; liveState = null; liveActionKey = '';
  },
  render(el, S, api) {
    ensureCss();
    const feedbackKey = `${S.instanceId || ''}:${S.me}:${S.round}`;
    if (S.instanceId && !S.audioBaseline && !S.preparing && !S.spectator && feedback?.key === feedbackKey && feedback?.phase === 'answer' && S.phase === 'reveal' && S.last?.results?.[S.me]?.ok) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:trivia-correct:${S.me}`, gain: 0.8 });
    }
    feedback = { key: feedbackKey, phase: S.phase };

    liveApi = api;
    liveEl = el;
    liveState = S;
    // Any change of window, role or own entry retires the previous handlers.
    const actionKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.index, S.endsAt, S.target, S.subject, S.victim, S.turn, S.hostId, !!S.spectator, !!S.current?.mine, S.myEntry, S.myOption, S.myLines, S.myVote, S.myPick]);
    liveActionKey = actionKey;
    const canAct = () => liveEl === el && liveActionKey === actionKey && liveState && !liveState.preparing && !liveState.spectator && (liveState.players || []).some((p) => p.id === liveState.me);
    const sendAction = (action) => (canAct() ? liveApi?.send(action) : false);
    const watch = isWatch(S);
    const total = (S.players || []).filter((p) => !p.left).length;
    runClock(el, S, api);

    // Same answer window: patch the counts, keep the cards (and focus).
    if (S.phase === 'answer') {
      const live = el.querySelector?.('.wg[data-phase="answer"]');
      const key = JSON.stringify([S.instanceId, S.me, S.round, S.myPick, watch, !!S.preparing]);
      if (live && visualKey === key) {
        const progress = el.querySelector('.gk-hud-progress');
        if (progress) progress.textContent = progressText((S.answered || []).length, total);
        const wait = el.querySelector('#tWait');
        if (wait) wait.outerHTML = waitLine(S, watch, total);
        return;
      }
      visualKey = key;
    } else {
      const key = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.last, S.scores, S.players, S.hostId, watch, !!S.preparing]);
      if (visualKey === key && el.querySelector?.('.wg')) return;
      visualKey = key;
    }

    if (S.phase === 'done') {
      el.innerHTML = `<section class="gk-final wg wg-final gk-col gk-stack" data-game="trivia" data-phase="done" aria-label="Trivia final scores">`
        + resultsHtml({ title: 'Final scores', scores: S.scores || {}, players: S.players || [], you: S.me })
        + (watch ? '<p class="gk-final-note">You watched this game.</p>' : '')
        + `</section>`;
      runClock(el, S, api);
      return;
    }

    if (S.phase === 'reveal' && S.last) {
      const results = S.last.results || {};
      const good = Object.keys(results).filter((pid) => results[pid].ok);
      const mine = results[S.me];
      const options = (S.question?.options || []).map((label, i) => ({
        value: i, label,
        correct: i === S.last.correct,
        wrong: !!mine && !mine.ok && mine.pick === i,
        dim: i !== S.last.correct && !(mine && mine.pick === i),
      }));
      const myLine = watch ? 'You are watching.'
        : !mine ? 'You did not answer in time.'
          : mine.ok ? `Correct! +${mine.pts} points${mine.streak > 1 ? ` · ${mine.streak} in a row` : ''}`
            : `Not this time: the answer is ${LETTERS[S.last.correct]}.`;
      const isHost = !watch && S.me === S.hostId;
      el.innerHTML = `<section class="wg gk-col gk-stack" data-game="trivia" data-phase="reveal" aria-label="Trivia answer">`
        + hud(S, 'Answer', `${good.length} of ${total} correct`)
        + `<h2 class="gk-prompt">${esc(S.question?.q || '')}</h2>`
        + choicesHtml(options, { cols: 2, phoneCols: 1, disabled: true, name: 'Answers' })
        + `<p class="wg-status${mine?.ok ? ' is-good' : ''}" role="status">${esc(myLine)}</p>`
        + `<div class="wg-slot">${isHost ? '<button class="gk-btn gk-primary" id="tNext" type="button">Next</button>' : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next question soon')}</div>`
        + `<p class="gk-meta">Correct: ${good.map((pid) => esc(nameOf(S, pid))).join(', ') || 'nobody this round'}</p>`
        + `</section>`;
      const nx = el.querySelector('#tNext');
      if (nx) { nx.disabled = !!S.preparing; nx.onclick = () => sendAction({ next: true }); }
      return;
    }

    /* Numeric 0 is a real pick: only null/undefined means unpicked. */
    const picked = S.myPick;
    const locked = picked !== null && picked !== undefined;
    const options = (S.question?.options || []).map((label, i) => ({ value: i, label, selected: picked === i }));
    el.innerHTML = `<section class="wg gk-col gk-stack" data-game="trivia" data-phase="answer" aria-label="Trivia question">`
      + hud(S, watch ? 'Watching' : locked ? 'Locked in' : 'Choose an answer', progressText((S.answered || []).length, total))
      + `<h2 class="gk-prompt">${esc(S.question?.q || '')}</h2>`
      // data-p: the answer index the click handler (and older QA tools) read.
      + choicesHtml(options, { cols: 2, phoneCols: 1, locked, disabled: watch || !!S.preparing, name: 'Answers' })
        .replace(/data-choice=/g, 'data-p=')
      + `<p class="wg-status" role="status">${!watch && locked ? `Locked in: ${LETTERS[picked]} — ${esc(S.question.options[picked])}` : ''}</p>`
      + `<div class="wg-slot">${waitLine(S, watch, total)}</div>`
      + `<details class="wg-more"><summary>Scoring</summary><p>A correct answer earns 100 points, faster answers up to 50 more, and a streak of correct answers up to 50 more.</p></details>`
      + `</section>`;
    runClock(el, S, api);
    if (!watch && !locked) {
      el.querySelectorAll('[data-p]').forEach((b) => {
        b.onclick = () => sendAction({ pick: Number(b.dataset.p) });
      });
    }
  },
};

function waitLine(S, watch, total) {
  const answered = (S.answered || []).length;
  const waiting = Math.max(0, total - answered);
  const locked = S.myPick !== null && S.myPick !== undefined;
  const text = watch ? `${answered} of ${total} answered` : !locked ? 'Pick one answer' : waiting ? `Waiting for ${waiting} ${waiting === 1 ? 'player' : 'players'}` : 'Everyone is in';
  return `<p class="gk-wait${!waiting ? ' is-done' : ''}" id="tWait" role="status">${esc(text)}</p>`;
}
