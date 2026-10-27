/* Warm Words view: the closest word so far with a flat meaning meter, one
 * guess field, optional room hints and the shared guess feed. Built on the
 * game kit. Contracts: {guess}, {hint:true}, {next:true} (host, reveal). */
import { esc, nameOf, countdown, ensureStylesheet } from '../util.js';
import { hudHtml, roundLabel, waitingHtml, resultsHtml } from '../kit.js';

let key = '', timer = null, current = null, currentApi = null, currentEl = null;
let order = 'closest';

const CSS = [['word-games-css', '/css/compact-answer-games.css'], ['warm-words-world-css', '/css/warm-words-world.css']];
function ensureCss() { for (const [id, href] of CSS) ensureStylesheet(id, href); }
function removeCss() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  document.getElementById('warm-words-world-css')?.remove();
}

function temperature(entry) {
  if (!entry) return { label: 'Follow the meaning', cls: '' };
  if (entry.rank === 1) return { label: 'Found it!', cls: 'is-good' };
  if (entry.rank <= 10) return { label: 'Very close', cls: 'is-good' };
  if (entry.rank <= 50) return { label: 'Getting warm', cls: 'is-accent' };
  if (entry.rank <= 200) return { label: 'A promising direction', cls: '' };
  return { label: 'Try a different direction', cls: 'is-bad' };
}

function paintClock() {
  const slot = currentEl && currentEl.querySelector?.('.gk-hud-timer');
  if (!slot || !current) return;
  const left = current.endsAt > 0 && !current.preparing && current.phase !== 'done' ? countdown(current.endsAt, currentApi?.now) : null;
  const text = left === null ? '' : `${left}s`;
  if (slot.textContent !== text) slot.textContent = text;
  slot.classList?.toggle('is-urgent', left !== null && left <= 10 && current.phase === 'guess');
}

function feed(S) {
  const entries = [...(S.history || [])];
  if (order === 'closest') entries.sort((a, b) => a.rank - b.rank);
  else entries.reverse();
  return entries.map((entry) => {
    const heat = temperature(entry);
    return `<div class="ww-row${entry.pid === S.me && !entry.hint ? ' is-you' : ''}"><div class="ww-who"><div class="ww-word">${esc(entry.word)}</div><div class="ww-player">${entry.hint ? 'Room hint' : esc(nameOf(S, entry.pid))}</div></div>`
      + `<div class="ww-rank"><span class="wg-tag ${heat.cls}">#${entry.rank}</span></div><div class="ww-reading">${entry.similarity.toFixed(2)}%</div></div>`;
  }).join('') || `<p class="wg-feed-empty">${esc(S.strings?.empty_feed || 'Start anywhere. Animals, food, places, things…')}</p>`;
}

function paint(S) {
  const best = S.best;
  const heat = temperature(best);
  const bestBox = currentEl.querySelector('[data-ww-best]');
  const bestKey = JSON.stringify(best);
  if (bestBox && currentEl._wwBestKey !== bestKey) {
    const improving = !!currentEl._wwBestKey;
    currentEl._wwBestKey = bestKey;
    bestBox.innerHTML = `<div class="gk-meta">Closest word so far</div><div class="ww-best">${esc(best?.word || 'Start anywhere')}</div>`
      + `<div class="ww-meta">${best ? `<span class="wg-tag ${heat.cls}">Rank #${best.rank}</span><span>${best.similarity.toFixed(2)}% similar · ${esc(heat.label)}</span>` : '<span>Try a word and see how close its meaning is.</span>'}</div>`;
    if (improving && !S.audioBaseline && !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) bestBox.animate?.([{ opacity: 0.5 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
  }
  const mercury = currentEl.querySelector('[data-ww-mercury]');
  if (mercury) { mercury.style.transition = S.audioBaseline ? 'none' : ''; mercury.style.width = `${best ? Math.max(3, Math.min(100, best.similarity)) : 0}%`; }
  const error = currentEl.querySelector('[data-ww-error]');
  if (error) { error.textContent = S.myError?.message || ''; error.classList?.toggle('is-error', !!S.myError?.message); }
  const box = currentEl.querySelector('[data-ww-feed]');
  const feedKey = JSON.stringify([order, S.history, S.players]);
  if (box && currentEl._wwFeedKey !== feedKey) {
    currentEl._wwFeedKey = feedKey;
    const scrollTop = box.scrollTop;
    box.innerHTML = feed(S);
    box.scrollTop = scrollTop;
  }
  const hint = currentEl.querySelector('[data-ww-hint]');
  if (hint) {
    hint.disabled = S.spectator || S.preparing || S.hintsUsed >= 2;
    hint.textContent = S.hintsUsed >= 2 ? 'Hints used' : `Hint −${S.hintCost} · ${2 - S.hintsUsed} left`;
    hint.setAttribute('aria-label', S.hintsUsed >= 2 ? 'Both room hints have been used' : `Get a related word for ${S.hintCost} points from everyone's round prize. ${2 - S.hintsUsed} hint${S.hintsUsed === 1 ? '' : 's'} left.`);
  }
  const cost = currentEl.querySelector('[data-ww-hint-cost]');
  if (cost) cost.textContent = S.hintsUsed ? `Round prize −${S.hintsUsed * S.hintCost} points` : 'Costs the round prize';
  for (const control of currentEl.querySelectorAll?.('[data-ww-form] input,[data-ww-form] button') || []) control.disabled = !!(S.preparing || S.spectator);
  const progress = currentEl.querySelector('.gk-hud-progress');
  if (progress) progress.textContent = `${(S.history || []).length} guess${(S.history || []).length === 1 ? '' : 'es'}`;
  paintClock();
}

function clearClock() { if (timer !== null) clearInterval(timer); timer = null; }

export default {
  styles: ['/css/compact-answer-games.css', '/css/warm-words-world.css'],
  ownsTimer: true,
  dispose() { clearClock(); key = ''; if (currentEl) { delete currentEl._wwBestKey; delete currentEl._wwFeedKey; delete currentEl._wwResultKey; } current = null; currentApi = null; currentEl = null; order = 'closest'; removeCss(); },
  render(el, S, api) {
    ensureCss();
    const prior = current;
    if (!S.audioBaseline && currentEl === el && prior?.instanceId === S.instanceId && prior.round === S.round &&
        prior.phase === 'guess' && S.phase === 'reveal' && S.last?.winner) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:hidden-word-found`, gain: 0.8 });
    }
    current = S; currentApi = api;
    const nextKey = `${S.instanceId || ''}:${S.phase}:${S.round}:${S.me || ''}:${S.spectator ? 'w' : 'p'}`;
    const rebuild = key !== nextKey || currentEl !== el;
    currentEl = el;
    if (rebuild) { key = nextKey; clearClock(); delete el._wwBestKey; delete el._wwFeedKey; }
    if (S.phase === 'done' || S.phase === 'reveal') {
      const resultKey = JSON.stringify([S.scores, S.results, S.players, S.last, S.history, S.hostId, S.spectator, S.preparing]);
      if (!rebuild && el._wwResultKey === resultKey) { paintClock(); return; }
      el._wwResultKey = resultKey;
    }
    if (S.phase === 'done') {
      clearClock();
      const found = (S.results || []).filter((r) => r.winner).length;
      el.innerHTML = `<section class="gk-final wg wg-final ww gk-col gk-stack" data-game="warm-words" data-phase="done" aria-label="Warm Words final scores">`
        + resultsHtml({ title: 'Final scores', scores: S.scores || {}, players: S.players || [], you: S.me })
        + `<p class="gk-final-note wg-final-note">${found} of ${S.rounds} word${S.rounds === 1 ? '' : 's'} found. The words: ${(S.results || []).map((r) => esc(r.target)).join(' · ')}</p>`
        + `</section>`;
      return;
    }
    if (S.phase === 'reveal') {
      const result = S.last;
      const finalRound = S.round >= S.rounds;
      const isHost = S.me === S.hostId && !S.spectator;
      el.innerHTML = `<section class="wg ww gk-col gk-stack" data-game="warm-words" data-phase="reveal" aria-label="Warm Words answer">`
        + hudHtml({ round: roundLabel(S.round, S.rounds), phase: result?.winner ? 'Found' : 'Time is up', progress: `${(S.history || []).length} guesses`, timer: '' })
        + `<div class="ww-result wg-panel"><div class="gk-meta">The hidden word</div><div class="ww-best">${esc(result?.target)}</div></div>`
        + `<p class="wg-status${result?.winner ? ' is-good' : ''}" role="status">${result?.winner ? `${esc(nameOf(S, result.winner))} found it: +${result.points} points.` : finalRound ? 'Nobody found it. Final scores are next.' : 'Nobody found it. Keep those ideas for the next word!'}</p>`
        + `<div class="wg-slot">${isHost ? `<button class="gk-btn gk-primary" type="button" data-ww-next>Next</button>` : waitingHtml(finalRound ? 'Final scores are next' : 'Next word soon')}</div>`
        + `<div class="wg-feed ww-feed" tabindex="0" aria-label="Round guesses">${feed(S)}</div>`
        + `</section>`;
      const next = el.querySelector('[data-ww-next]');
      if (next) {
        next.disabled = !!S.preparing; next.onclick = () => {
          if (currentEl === el && el.querySelector('[data-ww-next]') === next && current?.phase === 'reveal' &&
              !current.preparing && !current.spectator && current.me === current.hostId) currentApi.send({ next: true });
        };
      }
      clearClock();
      paintClock();
      timer = setInterval(paintClock, 250);
      timer?.unref?.();
      return;
    }
    if (rebuild) {
      el.innerHTML = `<section class="wg ww gk-col gk-stack" data-game="warm-words" data-phase="guess" aria-label="Warm Words">`
        + hudHtml({ round: roundLabel(S.round, S.rounds), phase: S.spectator ? 'Watching' : 'Find the word', progress: '0 guesses', timer: '' })
        + `<div class="ww-stage wg-panel"><div data-ww-best></div><div class="ww-meter" aria-hidden="true"><div class="ww-fill" data-ww-mercury></div></div></div>`
        + `<form class="gk-input-row" data-ww-form autocomplete="off"><input class="gk-input ww-input" data-ww-input type="text" maxlength="24" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" inputmode="text" placeholder="${esc(S.strings?.guess_placeholder || 'Try a word…')}" aria-label="Your word guess" ${S.spectator ? 'disabled' : ''}><button class="gk-btn gk-primary" type="submit" ${S.spectator ? 'disabled' : ''}>Guess</button></form>`
        + `<p class="wg-status ww-error" data-ww-error role="status" aria-live="polite"></p>`
        + (S.hintsEnabled ? '<div class="gk-actions ww-hint"><button class="gk-btn" type="button" data-ww-hint></button><span class="gk-meta" data-ww-hint-cost></span></div>' : '')
        + `<div class="ww-feed-head"><h3>Shared guesses</h3><button class="gk-btn gk-quiet" data-ww-sort data-watchok type="button">${order === 'closest' ? 'Closest first' : 'Newest first'}</button></div>`
        + `<div class="wg-feed ww-feed" data-ww-feed tabindex="0" aria-label="Shared guesses"></div>`
        + `<details class="wg-more ww-rules"><summary>Rules</summary><p>${esc(S.strings?.vocabulary_note || 'One everyday English word. Share ideas on your call!')} Higher percentages mean closer meaning; rank #1 is the answer. Only the exact word wins: 100 points plus up to 100 for speed. ${S.vocabularySize.toLocaleString()} supported words.${S.hintsEnabled ? ` Two room hints cost ${S.hintCost} points each from the round prize.` : ''}</p>${S.contentNote ? `<p>${esc(S.contentNote)}</p>` : ''}</details>`
        + `</section>`;
      const input = el.querySelector('[data-ww-input]');
      const form = el.querySelector('[data-ww-form]');
      let composing = false;
      input.oncompositionstart = () => { composing = true; };
      input.oncompositionend = () => { composing = false; };
      form.onsubmit = (event) => {
        event.preventDefault();
        if (!current || currentEl !== el || el.querySelector('[data-ww-input]') !== input
          || current.phase !== 'guess' || current.spectator || current.preparing || input.disabled || composing
          || (current.endsAt > 0 && typeof currentApi.now === 'function' && currentApi.now() >= current.endsAt)) return;
        const guess = input.value.trim();
        if (guess && currentApi.send({ guess }) !== false) { input.value = ''; input.focus({ preventScroll: true }); }
      };
      const hint = el.querySelector('[data-ww-hint]');
      if (hint) hint.onclick = () => {
        if (currentEl === el && el.querySelector('[data-ww-hint]') === hint && current?.phase === 'guess' &&
            !current.preparing && !current.spectator && current.hintsEnabled && current.hintsUsed < 2 &&
            !(current.endsAt > 0 && typeof currentApi.now === 'function' && currentApi.now() >= current.endsAt)) currentApi.send({ hint: true });
      };
      const sort = el.querySelector('[data-ww-sort]');
      sort.onclick = (event) => {
        if (currentEl !== el || !current || current.phase !== 'guess' || el.querySelector('[data-ww-sort]') !== sort) return;
        order = order === 'closest' ? 'latest' : 'closest';
        event.currentTarget.textContent = order === 'closest' ? 'Closest first' : 'Newest first';
        paint(current);
      };
      timer = setInterval(paintClock, 250);
      timer?.unref?.();
    }
    paint(S);
  },
};
