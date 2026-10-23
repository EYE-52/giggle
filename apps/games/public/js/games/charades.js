/* Charades view: the actor sees the secret word and every guess; guessers
 * see the letter mask and their own field. Built on the game kit.
 * Contracts: {guess}, {next:true} (actor or host, reveal). */
import { esc, nameOf, countdown, ensureStylesheet } from '../util.js';
import { hudHtml, roundLabel, waitingHtml, resultsHtml } from '../kit.js';

const CSS = [['word-games-css', '/css/compact-answer-games.css'], ['charades-css', '/css/charades.css']];
let lastKey = '', current = null, clock = null;

function ensureCss() { for (const [id, href] of CSS) ensureStylesheet(id, href); }
function removeCss() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  document.getElementById('charades-css')?.remove();
}

function paintClock(el, S, api) {
  const slot = el.querySelector?.('.gk-hud-timer');
  if (!slot) return;
  const left = S.endsAt > 0 && !S.preparing && S.phase !== 'done' ? countdown(S.endsAt, api?.now) : null;
  const text = left === null ? '' : `${left}s`;
  if (slot.textContent !== text) slot.textContent = text;
  slot.classList?.toggle('is-urgent', left !== null && left <= 10 && S.phase === 'act');
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

function spaced(masked) {
  return Array.from(String(masked || '')).join(' ');
}

function guessers(S) { return (S.players || []).filter((p) => p.id !== S.actor && !p.left); }
function guessedLine(S) {
  return `${Object.keys(S.guessed || {}).length} of ${guessers(S).length} guessed`;
}

function foundHtml(S) {
  if (!S.guessed || !Object.keys(S.guessed).length) return '';
  return Object.keys(S.guessed).map((pid) =>
    `<li class="wg-chip is-done" data-solved="${esc(pid)}">${esc(nameOf(S, pid))} +${S.guessed[pid]}</li>`).join('');
}

export default {
  styles: ['/css/compact-answer-games.css', '/css/charades.css'],
  ownsTimer: true,
  dispose() {
    if (clock !== null) clearInterval(clock);
    clock = null; lastKey = ''; current = null; removeCss();
  },
  render(el, S, api) {
    ensureCss();
    const prior = current;
    if (prior?.el !== el) lastKey = '';
    if (!S.audioBaseline && prior?.el === el && prior.S.instanceId === S.instanceId && prior.S.round === S.round &&
        S.guessed?.[S.me] && !prior.S.guessed?.[S.me]) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:charade-solved`, gain: 0.8 });
    }
    runClock(el, S, api);
    if (S.phase === 'done') {
      current = null;
      lastKey = `done:${S.instanceId || ''}`;
      el.innerHTML = `<section class="gk-final wg wg-final ch gk-col gk-stack" data-game="charades" data-phase="done" aria-label="Charades final scores">`
        + resultsHtml({ title: 'Final scores', scores: S.scores || {}, players: S.players || [], you: S.me })
        + `</section>`;
      return;
    }
    const isActor = S.me === S.actor;
    const key = `${S.instanceId || ''}:${S.me || ''}:${S.phase}:${S.round}:${S.actor || ''}:${isActor ? 'a' : 'g'}:${S.spectator ? 'w' : 'p'}:${S.hostId || ''}`;
    current = { el, S, api, key };
    const next = el.querySelector('#cNext');
    if (next) next.disabled = !!S.preparing;
    if (key !== lastKey) {
      lastKey = key;
      const turn = roundLabel(S.round, S.rounds, 'Turn');
      if (S.phase === 'act') {
        const who = S.spectator ? 'Watching' : isActor ? 'You act' : `${nameOf(S, S.actor)} acts`;
        const stage = isActor
          ? `<p class="gk-meta">Act this out — no talking</p><h2 class="gk-prompt ch-secret">${esc(S.wordShown || '')}</h2>`
          : `<p class="gk-meta">${esc(nameOf(S, S.actor))} is acting · ${String(S.masked || '').replace(/[^_]/g, '').length} letters</p>`
            + `<h2 class="gk-prompt ch-mask" aria-label="Hidden word, ${String(S.masked || '').length} characters">${esc(spaced(S.masked))}</h2>`;
        const field = !isActor && !S.spectator
          ? `<form class="gk-input-row" id="cForm" autocomplete="off"><input class="gk-input" id="cGuess" type="text" aria-label="Guess the word being acted out" placeholder="Your guess…" maxlength="60" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" inputmode="text">`
            + `<button class="gk-btn gk-primary" id="cSend" type="submit">Guess</button></form>`
          : `<p class="wg-placeholder" role="status">${isActor ? 'Every guess shows up below.' : 'You are watching the actor.'}</p>`;
        el.innerHTML = `<section class="wg ch gk-col gk-stack${!isActor ? ' is-guesser' : ''}" data-game="charades" data-phase="act" aria-label="Charades">`
          + hudHtml({ round: turn, phase: who, progress: guessedLine(S), timer: '' })
          + `<div class="ch-stage">${stage}</div>`
          + field
          + `<ul class="wg-chips ch-found" id="cFound" aria-label="Guessed it"></ul>`
          + `<div class="wg-feed ch-feed" id="cFeed" role="log" aria-label="Guesses; scroll for more" tabindex="0"></div>`
          + `</section>`;
        const send = () => {
          const live = current;
          if (!live || live.el !== el || live.key !== key) return;
          const state = live.S;
          const inp = el.querySelector('#cGuess');
          if (inp && !inp.disabled && inp.value.trim() && !state.spectator && !state.preparing &&
              state.phase === 'act' && !state.guessed?.[state.me] &&
              !(typeof live.api.now === 'function' && live.api.now() >= state.endsAt)) {
            if (live.api.send({ guess: inp.value.trim() }) === false) return;
            inp.value = '';
            inp.focus();
          }
        };
        const form = el.querySelector('#cForm');
        if (form) form.onsubmit = (e) => { e?.preventDefault?.(); send(); };
        const btn = el.querySelector('#cSend');
        if (btn) btn.onclick = (e) => { e?.preventDefault?.(); send(); };
        const inp = el.querySelector('#cGuess');
        if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.repeat && !e.isComposing && e.keyCode !== 229) { e.preventDefault?.(); send(); } };
        runClock(el, S, api);
      } else if (S.phase === 'reveal') {
        const word = S.word || S.wordShown || '';
        const canNext = !S.spectator && (isActor || S.me === S.hostId);
        const found = foundHtml(S);
        el.innerHTML = `<section class="wg ch gk-col gk-stack" data-game="charades" data-phase="reveal" aria-label="Charades answer">`
          + hudHtml({ round: turn, phase: 'The word', progress: guessedLine(S), timer: '' })
          + `<div class="ch-stage"><p class="gk-meta">${esc(nameOf(S, S.actor))} acted</p><h2 class="gk-prompt ch-secret">${esc(word)}</h2></div>`
          + `<p class="wg-status" role="status">${esc(S.endReason || '')}${S.guessed?.[S.me] ? ` · you got it: +${S.guessed[S.me]}` : ''}</p>`
          + `<div class="wg-slot">${canNext ? `<button class="gk-btn gk-primary" id="cNext" type="button">Next</button>` : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next actor soon')}</div>`
          + (found ? `<ul class="wg-chips ch-found" aria-label="Guessed it">${found}</ul>` : '<p class="gk-meta">Nobody got it this time.</p>')
          + `</section>`;
        const nx = el.querySelector('#cNext');
        if (nx) {
          nx.disabled = !!S.preparing; nx.onclick = () => {
            const live = current;
            if (live?.el === el && live.key === key && !live.S.preparing && !live.S.spectator && (live.S.actor === live.S.me || live.S.hostId === live.S.me)) live.api.send({ next: true });
          };
        }
        runClock(el, S, api);
        return;
      }
    }
    if (S.phase === 'act') {
      const progress = el.querySelector('.gk-hud-progress');
      if (progress) progress.textContent = guessedLine(S);
      const found = el.querySelector('#cFound');
      const foundKey = JSON.stringify([S.guessed, S.players]);
      if (found && found._foundKey !== foundKey) {
        found._foundKey = foundKey; found.innerHTML = foundHtml(S);
        if (!S.audioBaseline && prior?.el === el && prior.S.instanceId === S.instanceId && prior.S.round === S.round &&
            !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
          for (const chip of found.querySelectorAll?.('[data-solved]') || []) {
            if (!prior.S.guessed?.[chip.dataset.solved]) chip.animate?.([{ opacity: 0.4 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
          }
        }
      }
      const feed = el.querySelector('#cFeed');
      const feedKey = JSON.stringify([S.guesses, S.guessed, S.spectator, S.players]);
      if (feed && feed._feedKey !== feedKey) {
        feed._feedKey = feedKey;
        const scrollTop = feed.scrollTop;
        const list = (S.guesses || []).slice(-200).reverse();
        feed.innerHTML = isActor
          ? list.map((g) => `<div class="ch-guess"><span class="ch-who">${esc(nameOf(S, g.pid))}</span>`
            + `<span class="ch-txt">${esc(g.text)}</span></div>`).join('')
            || '<p class="wg-feed-empty">Waiting for guesses…</p>'
          : S.spectator ? '<p class="wg-feed-empty">You are watching the actor.</p>'
            : (S.guessed && S.guessed[S.me]
              ? `<p class="wg-feed-empty">You got it! +${S.guessed[S.me]} points — watch the stage.</p>`
              : (list.length
                ? `<p class="wg-feed-empty">Your tries: ${list.map((g) => esc(g.text)).join(' · ')}</p>`
                : '<p class="wg-feed-empty">First guess is yours to make.</p>'));
        feed.scrollTop = scrollTop;
      }
      const lock = el.querySelector('#cGuess');
      const locked = !!S.guessed?.[S.me];
      if (lock) { lock.disabled = !!(locked || S.spectator || S.preparing); if (locked) lock.placeholder = 'You got it!'; }
      const send = el.querySelector('#cSend');
      if (send) send.disabled = !!(locked || S.spectator || S.preparing);
      const mask = el.querySelector('.ch-mask');
      if (mask && S.masked) {
        mask.textContent = spaced(S.masked);
        mask.setAttribute('aria-label', `Hidden word, ${String(S.masked).length} characters`);
      }
    }
  },
};
