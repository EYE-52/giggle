/* Lyric Fill view: the line with its blank, one answer field, then the true
 * line with everyone's answers, and final scores. Built on the game kit.
 * Contracts: {text}, {next: true} (host, reveal). */
import { esc, countdown, ensureStylesheet } from '../util.js';
import { hudHtml, roundLabel, progressText, waitingHtml, resultsHtml } from '../kit.js';

const CSS = [['word-games-css', '/css/compact-answer-games.css'], ['lyric-fill-world-css', '/css/lyric-fill-world.css']];
let lastKey = '', currentEl = null, current = null, clock = null;

function ensureCss() { for (const [id, href] of CSS) ensureStylesheet(id, href); }

function sendAction(el, origin, phase, action) {
  const live = current;
  if (!live || live.el !== el || live.S.instanceId !== origin.instanceId || live.S.round !== origin.round ||
      live.S.me !== origin.me || live.S.phase !== phase || watching(live.S) || live.S.preparing ||
      (live.S.endsAt > 0 && typeof live.api.now === 'function' && live.api.now() >= live.S.endsAt)) return false;
  if (phase === 'fill' && live.S.mine) return false;
  if (action.next && live.S.me !== live.S.hostId) return false;
  return live.api.send(action);
}

function watching(S) {
  if (S.spectator) return true;
  return !(S.players || []).some((p) => p.id === S.me);
}

function paintClock(el, S, api) {
  const slot = el.querySelector?.('.gk-hud-timer');
  if (!slot) return;
  const left = S.endsAt > 0 && !S.preparing && S.phase === 'fill' ? countdown(S.endsAt, api?.now) : null;
  const text = left === null ? '' : `${left}s`;
  if (slot.textContent !== text) slot.textContent = text;
  slot.classList?.toggle('is-urgent', left !== null && left <= 5);
}
function runClock(el, S, api) {
  if (clock !== null) clearInterval(clock);
  clock = null;
  paintClock(el, S, api);
  if (S.endsAt > 0 && S.phase === 'fill' && typeof setInterval === 'function') {
    clock = setInterval(() => paintClock(el, S, api), 250);
    clock?.unref?.();
  }
}

const VERDICT = { exact: ['Exact', 'is-good'], close: ['Close', 'is-accent'], miss: ['Miss', 'is-bad'] };

function lineHtml(line, answer) {
  const blank = answer === undefined
    ? '<span class="lf-blank" aria-label="missing words">____</span>'
    : `<b class="lf-answer">${esc(answer)}</b>`;
  const words = [line.before ? esc(line.before) : '', blank, line.after ? esc(line.after) : ''].filter(Boolean).join(' ');
  return `<h2 class="gk-prompt lf-line">“${words}”</h2>`
    + `<p class="gk-sub wg-prompt-sub">${esc(line.song)} — ${esc(line.artist)}</p>`;
}

function myVerdict(S) {
  if (watching(S) || !S.last) return 'You are watching.';
  const v = (S.last.verdicts || {})[S.me];
  if (!v) return 'You did not answer this line.';
  const word = (VERDICT[v.verdict] || [v.verdict])[0];
  return `Your answer “${v.text}”: ${word}${v.pts ? ` · +${v.pts} points` : ''}`;
}

export default {
  styles: ['/css/compact-answer-games.css', '/css/lyric-fill-world.css'],
  ownsTimer: true,
  dispose() {
    if (clock !== null) clearInterval(clock);
    clock = null; lastKey = ''; currentEl = null; current = null;
    if (typeof document !== 'undefined') document.getElementById?.('lyric-fill-world-css')?.remove();
  },
  render(el, S, api) {
    ensureCss();
    const prior = current;
    current = { el, S, api };
    if (!S.audioBaseline && prior?.el === el && prior.S.instanceId === S.instanceId && prior.S.round === S.round &&
        prior.S.phase === 'fill' && S.phase === 'reveal' && S.last?.verdicts?.[S.me]?.pts > 0) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:lyric-grade`, gain: 0.8 });
    }
    if (el !== currentEl) { lastKey = ''; currentEl = el; }
    runClock(el, S, api);
    const isWatch = watching(S);
    const total = (S.players || []).filter((p) => !p.left).length;
    if (S.phase === 'done' || S.phase === 'reveal') {
      const resultKey = JSON.stringify([S.instanceId, S.me, S.phase, S.round, S.last, S.scores, S.players, S.hostId, isWatch]);
      if (lastKey === resultKey) { const next = el.querySelector('#lNext'); if (next) next.disabled = !!S.preparing; return; }
      lastKey = resultKey;
    }
    if (S.phase === 'done') {
      el.innerHTML = `<section class="gk-final wg wg-final lf gk-col gk-stack" data-game="lyric-fill" data-phase="done" aria-label="Lyric Fill final scores">`
        + resultsHtml({ title: 'Final scores', scores: S.scores || {}, players: S.players || [], you: S.me })
        + (isWatch ? '<p class="gk-final-note">You watched this game.</p>' : '')
        + `</section>`;
      return;
    }
    if (S.phase === 'reveal' && S.last) {
      const L = S.last;
      const verdicts = L.verdicts || {};
      const good = Object.values(verdicts).filter((v) => v.pts > 0).length;
      const rows = (S.players || []).map((p) => {
        const v = verdicts[p.id];
        const you = p.id === S.me ? ' <small>(you)</small>' : '';
        if (!v) return `<li class="wg-row${p.id === S.me ? ' is-you' : ''}"><span class="wg-who">${esc(p.name)}${you}</span><span class="wg-ans is-empty">No answer</span><span class="wg-pts is-zero">+0</span></li>`;
        const [word, cls] = VERDICT[v.verdict] || [v.verdict, ''];
        return `<li class="wg-row${p.id === S.me ? ' is-you' : ''}"><span class="wg-who">${esc(p.name)}${you}</span>`
          + `<span class="wg-ans">${esc(v.text)} <span class="wg-tag ${cls}">${esc(word)}</span></span>`
          + `<span class="wg-pts${v.pts ? '' : ' is-zero'}">+${v.pts}</span></li>`;
      }).join('');
      const isHost = S.me === S.hostId && !isWatch;
      el.innerHTML = `<section class="wg lf gk-col gk-stack" data-game="lyric-fill" data-phase="reveal" aria-label="Lyric Fill answer">`
        + hudHtml({ round: roundLabel(S.round, S.rounds), phase: 'The true line', progress: `${good} of ${total} scored`, timer: '' })
        + lineHtml(L.line, L.line.answer)
        + `<p class="wg-status" role="status">${esc(myVerdict(S))}</p>`
        + `<div class="wg-slot">${isHost ? '<button class="gk-btn gk-primary" id="lNext" type="button">Next</button>' : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next line soon')}</div>`
        + `<ol class="wg-rows" aria-label="Everyone's answers">${rows}</ol>`
        + `</section>`;
      const nx = el.querySelector('#lNext');
      if (nx) { nx.disabled = !!S.preparing; nx.onclick = () => sendAction(el, S, 'reveal', { next: true }); }
      return;
    }
    // Fill phase: keyed so drafts survive other players' answers; the live
    // count is patched on key matches (never stale).
    const key = 'fill:' + S.round + ':' + S.endsAt + ':' + (S.mine ? '1' : '0') + ':' + (isWatch ? 'w' : 'p');
    const scopedKey = `${S.instanceId || ''}:${S.me}:${key}`;
    const filled = (S.filled || []).length;
    if (scopedKey === lastKey) {
      const c = el.querySelector('.gk-hud-progress');
      if (c) c.textContent = progressText(filled, total);
      const wait = el.querySelector('#lfWait');
      if (wait) wait.textContent = waitText(S, isWatch, filled, total);
      for (const control of el.querySelectorAll?.('input,button') || []) control.disabled = !!S.preparing;
      return;
    }
    lastKey = scopedKey;
    const field = isWatch || S.mine ? ''
      : `<form class="gk-input-row" id="lfForm" autocomplete="off">`
        + `<input class="gk-input" type="text" id="lfText" maxlength="60" aria-label="Missing words" placeholder="Fill the blank…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send">`
        + `<button class="gk-btn gk-primary" id="lfGo" type="submit">Lock in</button></form>`;
    const status = isWatch ? 'You are watching — the table is filling the blank.'
      : S.mine ? `Locked in: “${S.mine}”` : '';
    el.innerHTML = `<section class="wg lf gk-col gk-stack" data-game="lyric-fill" data-phase="fill" data-state="${isWatch ? 'watch' : S.mine ? 'locked' : 'open'}" aria-label="Fill the lyric">`
      + hudHtml({ round: roundLabel(S.round, S.rounds), phase: isWatch ? 'Watching' : S.mine ? 'Locked in' : 'Fill the blank', progress: progressText(filled, total), timer: '' })
      + lineHtml(S.line || { before: '', after: '', song: '', artist: '' })
      + (field || `<div class="lf-locked gk-card" role="status">${esc(status)}</div>`)
      + `<p class="wg-status" role="status">${field ? 'Exact: 100 points · Close: 50' : ''}</p>`
      + `<div class="wg-slot"><p class="gk-wait" id="lfWait" role="status">${esc(waitText(S, isWatch, filled, total))}</p></div>`
      + `</section>`;
    runClock(el, S, api);
    const form = el.querySelector('#lfForm');
    const go = el.querySelector('#lfGo');
    const inp = el.querySelector('#lfText');
    const send = () => {
      const v = inp ? inp.value : '';
      if (inp && !inp.disabled && v && v.trim()) sendAction(el, S, 'fill', { text: v });
    };
    if (form) form.onsubmit = (e) => { e?.preventDefault?.(); send(); };
    if (go) go.onclick = (e) => { e?.preventDefault?.(); send(); };
    if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.repeat && !e.isComposing && e.keyCode !== 229) { e.preventDefault?.(); send(); } };
    for (const control of el.querySelectorAll?.('input,button') || []) control.disabled = !!S.preparing;
  },
};

function waitText(S, isWatch, filled, total) {
  if (isWatch) return `${filled} of ${total} answered`;
  if (!S.mine) return 'Type the missing words';
  const waiting = Math.max(0, total - filled);
  return waiting ? `Waiting for ${waiting} ${waiting === 1 ? 'player' : 'players'}` : 'Everyone is in';
}
