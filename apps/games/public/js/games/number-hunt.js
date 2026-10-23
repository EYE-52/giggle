/* Number Hunt view: the range still possible from public higher/lower
 * hints, your last reading, one number field and the public hint feed.
 * Built on the game kit. Contracts: {guess}, {next:true} (host, results). */
import { esc, nameOf, countdown, ensureStylesheet } from '../util.js';
import { hudHtml, roundLabel, waitingHtml, resultsHtml } from '../kit.js';

const CSS = [['word-games-css', '/css/compact-answer-games.css'], ['number-hunt-world-css', '/css/number-hunt-world.css']];
let current = null, clock = null;

function ensureCss() { for (const [id, href] of CSS) ensureStylesheet(id, href); }
function removeCss() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  document.getElementById('number-hunt-world-css')?.remove();
}

function paintClock(el, S, api) {
  const slot = el.querySelector?.('.gk-hud-timer');
  if (!slot) return;
  const left = S.endsAt > 0 && !S.preparing && S.phase !== 'done' ? countdown(S.endsAt, api?.now) : null;
  const text = left === null ? '' : `${left}s`;
  if (slot.textContent !== text) slot.textContent = text;
  slot.classList?.toggle('is-urgent', left !== null && left <= 5 && S.phase !== 'roundEnd');
}
function runClock(el, S, api) {
  if (clock !== null) clearInterval(clock);
  clock = null;
  paintClock(el, S, api);
  if (S.endsAt > 0 && S.phase !== 'done' && typeof setInterval === 'function') {
    clock = setInterval(() => paintClock(el, S, api), 250);
    clock?.unref?.();
  }
}

/* Possible range from public higher/lower hints: dir tells where to go. */
function bounds(history) {
  let lo = 1;
  let hi = 100;
  for (const h of history || []) {
    if (h.result === 'correct') { lo = h.guess; hi = h.guess; continue; }
    if (h.dir === 'higher') lo = Math.max(lo, h.guess + 1);
    else if (h.dir === 'lower') hi = Math.min(hi, h.guess - 1);
  }
  if (lo > hi) { const m = Math.round((lo + hi) / 2); lo = m; hi = m; }
  return { lo, hi };
}

function huntPhase(S) {
  if (S.spectator) return 'Watching';
  return S.phase === 'overtime' ? 'Overtime' : 'Hunt';
}
function foundCount(S) {
  const n = (S.finished || []).length;
  return `${n} found it`;
}

export default {
  styles: ['/css/compact-answer-games.css', '/css/number-hunt-world.css'],
  ownsTimer: true,
  dispose(el) {
    if (clock !== null) clearInterval(clock);
    clock = null; current = null;
    if (el) { delete el._key; delete el._feedKey; }
    removeCss();
  },
  render(el, S, api) {
    const prior = current;
    current = { el, S, api };
    const hit = (S.finished || S.last?.finished || []).some((f) => f.pid === S.me);
    if (!S.audioBaseline && prior?.el === el && prior.S.instanceId === S.instanceId && prior.S.round === S.round &&
        hit && !(prior.S.finished || prior.S.last?.finished || []).some((f) => f.pid === S.me)) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:number-found`, gain: 0.8 });
    }
    ensureCss();
    runClock(el, S, api);
    const t = S.strings || {};
    if (S.phase === 'done') {
      const resultKey = JSON.stringify(['done', S.instanceId, S.players, S.scores, S.me]);
      if (el._key === resultKey) return;
      el._key = resultKey;
      el.innerHTML = `<section class="gk-final wg wg-final nh gk-col gk-stack" data-game="number-hunt" data-phase="done" aria-label="Number Hunt final scores">`
        + resultsHtml({ title: 'Final scores', scores: S.scores || {}, players: S.players || [], you: S.me })
        + `</section>`;
      return;
    }
    if (S.phase === 'roundEnd' && S.last) {
      const resultKey = JSON.stringify(['end', S.instanceId, S.round, S.last, S.players, S.hostId, S.me, S.spectator]);
      if (el._key === resultKey) { const next = el.querySelector('#nNext'); if (next) next.disabled = !!S.preparing; return; }
      el._key = resultKey;
      const finished = S.last.finished || [];
      const rows = finished.map((f) =>
        `<li class="wg-row${f.pid === S.me ? ' is-you' : ''}"><span class="wg-who">${esc(nameOf(S, f.pid))}${f.pid === S.me ? ' <small>(you)</small>' : ''}</span>`
        + `<span class="wg-ans">${f.tries} ${esc(f.tries === 1 ? t.try || 'try' : t.tries || 'tries')}${f.rank === 1 ? ' <span class="wg-tag is-good">Fewest</span>' : ''}</span>`
        + `<span class="wg-pts">+${f.pts}</span></li>`).join('');
      const watch = S.spectator || !(S.players || []).some((p) => p.id === S.me);
      const isHost = S.me === S.hostId && !watch;
      const mine = finished.find((f) => f.pid === S.me);
      el.innerHTML = `<section class="wg nh gk-col gk-stack" data-game="number-hunt" data-phase="roundEnd" aria-label="Number Hunt results">`
        + hudHtml({ round: roundLabel(S.round, S.rounds), phase: 'Results', progress: `${finished.length} found it`, timer: '' })
        + `<h2 class="gk-prompt">${esc(t.secret_was || 'The number was')} <b>${S.last.secret}</b></h2>`
        + `<p class="wg-status${mine ? ' is-good' : ''}" role="status">${watch ? 'You are watching.' : mine ? `You found it in ${mine.tries} ${mine.tries === 1 ? 'try' : 'tries'}: +${mine.pts}` : 'You did not find it this round.'}</p>`
        + `<div class="wg-slot">${isHost ? '<button class="gk-btn gk-primary" id="nNext" type="button">Next</button>' : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : (t.next_round || 'Next number soon'))}</div>`
        + (rows ? `<ol class="wg-rows" aria-label="Who found it">${rows}</ol>` : `<p class="wg-feed-empty">${esc(t.no_winner || 'Nobody found it.')}</p>`)
        + `</section>`;
      const nx = el.querySelector('#nNext');
      if (nx) {
        nx.disabled = !!S.preparing;
        nx.onclick = () => {
          const live = current;
          if (live?.el === el && live.S.phase === 'roundEnd' && live.S.me === live.S.hostId && !live.S.preparing && !live.S.spectator) live.api.send({ next: true });
        };
      }
      return;
    }
    // Hunt/overtime: never rebuild while typing — patch the live regions.
    const key = `hunt:${S.instanceId || ''}:${S.me || ''}:${S.round}:${S.spectator ? 'w' : 'p'}`;
    const mine = (S.guesses && S.guesses[S.me]) || [];
    const found = (S.finished || []).some((f) => f.pid === S.me);
    if (el._key !== key) {
      el._key = key;
      delete el._feedKey;
      el.innerHTML = `<section class="wg nh gk-col gk-stack" data-game="number-hunt" data-phase="hunt" aria-label="Number Hunt">`
        + hudHtml({ round: roundLabel(S.round, S.rounds), phase: huntPhase(S), progress: foundCount(S), timer: '' })
        + `<h2 class="gk-prompt" id="nSub"></h2>`
        + `<div class="nh-range wg-panel" role="group" aria-label="Possible range">`
        + `<div class="nh-bounds"><span id="nLo">1</span><span class="nh-between" id="nBetween" role="status"></span><span id="nHi">100</span></div>`
        + `<div class="nh-track"><div class="nh-window" id="nWin"></div></div>`
        + `<p class="nh-reading"><span>Your last guess</span> <b id="nCurrent">?</b> <strong id="nDirection">Try a number</strong> <small id="nHeat"></small></p>`
        + `</div>`
        + `<form class="gk-input-row" id="nForm" autocomplete="off"><input class="gk-input" id="nGuess" aria-label="Your number guess, from 1 to 100" type="number" min="1" max="100" inputmode="numeric" enterkeyhint="go" autocomplete="off"`
        + ` placeholder="${esc(t.guess_placeholder || 'Your guess (1–100)')}" ${found || S.spectator ? 'disabled' : ''}>`
        + `<button class="gk-btn gk-primary" id="nSend" type="submit" ${found || S.spectator ? 'disabled' : ''}>${esc(t.guess_button || 'Guess')}</button></form>`
        + `<p class="wg-status" id="nMine" role="status"></p>`
        + `<h3 class="nh-feed-title">${esc(t.feed_title || 'Public hints')}</h3>`
        + `<div class="wg-feed" id="nFeed" role="log" aria-label="Public guess hints" tabindex="0"></div>`
        + `<details class="wg-more nh-players"><summary>Players and tries</summary><ul class="wg-chips" id="nTries"></ul></details>`
        + `</section>`;
      const inp = el.querySelector('#nGuess');
      const send = () => {
        const live = current;
        if (!live || live.el !== el || el.querySelector('#nGuess') !== inp || !inp || inp.disabled
          || live.S.spectator || live.S.preparing || !['hunt', 'overtime'].includes(live.S.phase)
          || (live.S.endsAt > 0 && typeof live.api.now === 'function' && live.api.now() >= live.S.endsAt)) return;
        const v = Number(inp.value);
        if (Number.isInteger(v) && v >= 1 && v <= 100) {
          if (live.api.send({ guess: v }) === false) return;
          inp.value = '';
          inp.focus();
        }
      };
      const form = el.querySelector('#nForm');
      if (form) form.onsubmit = (e) => { e?.preventDefault?.(); send(); };
      const btn = el.querySelector('#nSend');
      if (btn) btn.onclick = (e) => { e?.preventDefault?.(); send(); };
      if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.repeat && !e.isComposing && e.keyCode !== 229) { e.preventDefault?.(); send(); } };
      runClock(el, S, api);
    }
    const phase = el.querySelector('.gk-hud-phase');
    if (phase) phase.textContent = huntPhase(S);
    const progress = el.querySelector('.gk-hud-progress');
    if (progress) progress.textContent = foundCount(S);
    // Read only public history. Nothing here derives distance from a secret.
    const recent = [...(S.history || [])].reverse().find((h) => h.pid === S.me);
    const number = el.querySelector('#nCurrent'); if (number) number.textContent = recent ? String(recent.guess) : '?';
    const direction = el.querySelector('#nDirection'); if (direction) direction.textContent = recent?.result === 'correct' ? 'Found it!' : recent?.dir === 'higher' ? 'Go higher' : recent?.dir === 'lower' ? 'Go lower' : 'Try a number';
    const heat = el.querySelector('#nHeat'); if (heat) heat.textContent = recent ? ({ hotter: 'warmer than before', colder: 'colder than before', same: 'just as close as before', first: 'your first clue', correct: '' }[recent.result] || '') : '';
    const { lo, hi } = bounds(S.history);
    const loEl = el.querySelector('#nLo'); if (loEl) loEl.textContent = lo;
    const hiEl = el.querySelector('#nHi'); if (hiEl) hiEl.textContent = hi;
    const win = el.querySelector('#nWin');
    if (win) {
      win.style.transition = S.audioBaseline ? 'none' : '';
      win.style.left = `${(lo - 1)}%`;
      win.style.width = `${Math.max(1, hi - lo + 1)}%`;
    }
    const between = el.querySelector('#nBetween');
    if (between) {
      between.textContent = lo === hi
        ? (S.finished?.length || S.history?.some((h) => h.result === 'correct'))
          ? `Someone found it: ${lo}. ${S.phase === 'overtime' ? 'Seconds left to finish!' : ''}`
          : `Only ${lo} remains.`
        : `It hides between ${lo} and ${hi} (${hi - lo + 1} left)`;
    }
    const sub = el.querySelector('#nSub');
    if (sub) {
      sub.textContent = S.phase === 'overtime'
        ? 'Overtime: finish fast!'
        : 'Find the number from 1 to 100';
    }
    const lock = el.querySelector('#nGuess');
    if (lock) { lock.disabled = !!(found || S.spectator || S.preparing); if (found) lock.value = ''; }
    const sendBtn = el.querySelector('#nSend');
    if (sendBtn) sendBtn.disabled = !!(found || S.spectator || S.preparing);
    const mineEl = el.querySelector('#nMine');
    if (mineEl) {
      mineEl.textContent = S.spectator ? 'You are watching.' : found
        ? (t.found || 'Found it! Waiting for the round to end.')
        : mine.length ? `${t.your_tries || 'Your tries'} (${mine.length}): ${mine.join(', ')}` : 'Fewest tries wins the round.';
      mineEl.classList?.toggle('is-good', found);
    }
    const tries = el.querySelector('#nTries');
    if (tries) {
      tries.innerHTML = [...(S.players || [])]
        .map((p) => ({ p, n: ((S.guesses && S.guesses[p.id]) || []).length, done: (S.finished || []).some((f) => f.pid === p.id) }))
        .sort((a, b) => a.n - b.n)
        .map(({ p, n, done }) => `<li class="wg-chip${done ? ' is-done' : ''}">${esc(p.name)} · ${n}</li>`).join('');
    }
    const feed = el.querySelector('#nFeed');
    if (feed) {
      const feedKey = JSON.stringify([S.history, S.players]);
      if (feedKey === el._feedKey) return;
      el._feedKey = feedKey;
      const scrollTop = feed.scrollTop;
      feed.innerHTML = [...(S.history || [])].reverse().slice(0, 200).map((h) =>
        `<div class="nh-hint${h.pid === S.me ? ' is-you' : ''}"><span class="nh-who">${esc(nameOf(S, h.pid))}</span><span class="nh-guess">${h.guess}</span>`
        + `<span class="nh-dir">${h.result === 'correct' ? '<span class="wg-tag is-good">Found it</span>' : `<span class="wg-tag">${h.dir === 'higher' ? 'Go higher' : 'Go lower'}</span>`}</span>`
        + `<span class="nh-flavor">${esc(h.flavor || h.result || '')}</span></div>`).join('')
        || `<p class="wg-feed-empty">${esc(t.no_guesses || 'No guesses yet — be the first!')}</p>`;
      feed.scrollTop = scrollTop;
    }
  },
};
