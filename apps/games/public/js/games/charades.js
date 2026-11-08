/* Charades view: the actor sees the secret word and every guess; guessers
 * see the letter mask and their own field. Built on the game kit.
 * Contracts: {guess}, {next:true} (actor or host, reveal). */
import { esc, nameOf, countdown, ensureStylesheet } from '../util.js';
import { hudHtml, roundLabel, waitingHtml, resultsHtml } from '../kit.js';

const CSS = [['word-games-css', '/css/compact-answer-games.css'], ['charades-css', '/css/charades.css'], ['create-kit-css', '/css/create-kit.css']];
let lastKey = '', current = null, clock = null;

function ensureCss() { for (const [id, href] of CSS) ensureStylesheet(id, href); }

/* Stage pieces in the create kit markup (create-kit.css; the camera games
 * build the same parts in toolkit/create-stage.js). Kept local so the view
 * stays one module for the test loaders. */
const RING_LEN = 125.66;
function ringHtml() {
  return `<div class="ck-ring ch-ring" role="timer" aria-live="off"><svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">`
    + `<circle class="ck-ring-track" cx="24" cy="24" r="20"/><circle class="ck-ring-bar" cx="24" cy="24" r="20" stroke-dasharray="${RING_LEN}" stroke-dashoffset="0"/></svg>`
    + `<span class="ck-ring-num"></span></div>`;
}
function paintRing(ring, left, key, totalSeconds) {
  if (!ring) return;
  if (ring._ckKey !== key) { ring._ckKey = key; ring._ckTotal = 0; }
  const on = left !== null && Number.isFinite(left);
  ring.classList?.toggle('is-off', !on);
  ring._ckTotal = on ? Math.max(Number(totalSeconds) || 0, ring._ckTotal || 0, left, 1) : ring._ckTotal;
  const num = ring.querySelector?.('.ck-ring-num');
  const text = on ? String(left) : '';
  if (num && num.textContent !== text) num.textContent = text;
  ring.querySelector?.('.ck-ring-bar')?.setAttribute?.('stroke-dashoffset', String(on ? Math.round(RING_LEN * (1 - left / ring._ckTotal) * 100) / 100 : RING_LEN));
  ring.classList?.toggle('is-urgent', on && left <= 10 && left > 0);
  ring.setAttribute?.('aria-label', on ? `${left} seconds left` : 'No timer');
}
function initialOf(name) {
  const words = String(name || '?').trim().split(/\s+/);
  const tail = words.length > 1 && /^\d{1,2}$/.test(words[words.length - 1]) ? words[words.length - 1] : '';
  return (Array.from(words[0] || '?')[0] || '?').toLocaleUpperCase() + tail;
}
function paintRoster(box, S, statusOf) {
  if (!box) return;
  const html = `<ul class="ck-roster" aria-label="Players">` + (S.players || []).filter((p) => p && !p.left).map((p, i) => {
    const st = statusOf(p), name = nameOf(S, p.id);
    return `<li class="ck-player ${st.cls}${p.id === S.me ? ' is-you' : ''}" style="--ck-hue:${(i * 67) % 360}">`
      + `<span class="ck-ava" aria-hidden="true">${esc(initialOf(name))}</span>`
      + `<span class="ck-pname">${esc(name)}${p.id === S.me ? ' <small>(you)</small>' : ''}</span><span class="ck-pstate">${esc(st.text)}</span></li>`;
  }).join('') + `</ul>`;
  if (box._ckRoster === html) return;
  box._ckRoster = html;
  box.innerHTML = html;
}
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
  paintRing(el.querySelector?.('.ch-ring'), S.phase === 'act' ? left : null, `${S.instanceId}:${S.round}`, S.roundMs / 1000);
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

/* The hidden word as toy tiles: a blank tile per letter, a gap per space,
 * other marks (hyphens, apostrophes) shown on their own tile. */
function tilesHtml(masked) {
  return `<span class="ck-sr">${esc(Array.from(String(masked || '')).join(' '))}</span>` + Array.from(String(masked || '')).map((c) => c === '_' ? '<span class="ck-tile is-blank" aria-hidden="true">_</span>'
    : c === ' ' ? '<span class="ck-tile is-gap" aria-hidden="true"></span>'
      : `<span class="ck-tile is-mark" aria-hidden="true">${esc(c)}</span>`).join('');
}
/* The longest word's tile count: phones size the tiles so a word never
 * breaks across two rows. */
function longestWord(masked) {
  return Math.max(1, ...String(masked || '').split(' ').map((w) => Array.from(w).length));
}

/* Who acts, who already got it (+points), who is still guessing. */
function rosterStatus(S) {
  return (p) => p.id === S.actor ? { cls: 'is-on', text: 'Acting' }
    : S.guessed?.[p.id] ? { cls: 'is-ready', text: `Got it +${S.guessed[p.id]}` }
      : { cls: '', text: S.phase === 'reveal' ? 'Missed it' : 'Guessing' };
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
  styles: ['/css/compact-answer-games.css', '/css/charades.css', '/css/create-kit.css'],
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
      el.innerHTML = `<section class="gk-final wg wg-final ch ck gk-col gk-stack" data-family="create" data-game="charades" data-phase="done" aria-label="Charades final scores">`
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
          ? `<span class="ck-label">Act this out, no talking</span><h2 class="gk-prompt ch-secret">${esc(S.wordShown || '')}</h2>`
          : `<span class="ck-label">${esc(nameOf(S, S.actor))} is acting · ${String(S.masked || '').replace(/[^_]/g, '').length} letters</span>`
            + `<h2 class="gk-prompt ch-mask ck-tiles" style="--ch-len:${longestWord(S.masked)}" aria-label="Hidden word, ${String(S.masked || '').length} characters">${tilesHtml(S.masked)}</h2>`;
        const field = !isActor && !S.spectator
          ? `<form class="gk-input-row" id="cForm" autocomplete="off"><input class="gk-input" id="cGuess" type="text" aria-label="Guess the word being acted out" placeholder="Your guess…" maxlength="60" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="send" inputmode="text">`
            + `<button class="gk-btn gk-primary" id="cSend" type="submit">Guess</button></form>`
          : isActor ? '' : `<p class="wg-placeholder" role="status">You are watching the actor.</p>`;
        el.innerHTML = `<section class="wg ch ck gk-col gk-stack${!isActor ? ' is-guesser' : ''}" data-family="create" data-game="charades" data-phase="act" aria-label="Charades">`
          + hudHtml({ round: turn, phase: who, progress: guessedLine(S), timer: '' })
          + `<div class="ch-stage ck-card is-tint"><div class="ch-stage-text">${stage}</div>${ringHtml()}</div>`
          + field
          + `<ul class="wg-chips ch-found" id="cFound" aria-label="Guessed it"></ul>`
          + `<div class="ch-board ck-card"><div class="ck-head"><h3>${isActor ? 'Guesses coming in' : S.spectator ? 'Guesses' : 'Your tries'}</h3><span class="gk-meta ch-count"></span></div>`
          + `<div class="wg-feed ch-feed" id="cFeed" role="log" aria-label="Guesses; scroll for more" tabindex="0"></div></div>`
          + `<div class="ch-players ck-card"><div class="ck-head"><h3>Players</h3></div><div class="ch-roster"></div></div>`
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
        el.innerHTML = `<section class="wg ch ck gk-col gk-stack" data-family="create" data-game="charades" data-phase="reveal" aria-label="Charades answer">`
          + hudHtml({ round: turn, phase: 'The word', progress: guessedLine(S), timer: '' })
          + `<div class="ch-stage ck-card is-tint"><div class="ch-stage-text"><span class="ck-label">${esc(nameOf(S, S.actor))} acted</span><h2 class="gk-prompt ch-secret">${esc(word)}</h2></div></div>`
          + `<p class="wg-status" role="status">${esc(S.endReason || '')}${S.guessed?.[S.me] ? ` · you got it: +${S.guessed[S.me]}` : ''}</p>`
          + `<div class="wg-slot">${canNext ? `<button class="gk-btn gk-primary" id="cNext" type="button">Next</button>` : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next actor soon')}</div>`
          + (found ? `<ul class="wg-chips ch-found" aria-label="Guessed it">${found}</ul>` : '<p class="gk-meta">Nobody got it this time.</p>')
          + `<div class="ch-players ck-card"><div class="ck-head"><h3>Players</h3></div><div class="ch-roster"></div></div>`
          + `</section>`;
        paintRoster(el.querySelector('.ch-roster'), S, rosterStatus(S));
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
        const empty = (art, title, line) => `<div class="ck-empty ch-empty"><span class="ck-empty-art" aria-hidden="true">${art}</span>`
          + `<p class="ck-empty-title">${title}</p><p>${line}</p></div>`;
        const mine = list.filter((g) => g.pid === S.me);
        feed.innerHTML = isActor
          ? list.map((g) => `<div class="ch-guess ck-row"><span class="ch-who">${esc(nameOf(S, g.pid))}</span>`
            + `<span class="ch-txt">${esc(g.text)}</span></div>`).join('')
            || empty('?!', 'Waiting for guesses…', 'Every guess the room makes lands here as they type.')
          : S.spectator ? empty('👀', 'You are watching the actor.', 'Guesses stay private to the actor.')
            : (S.guessed && S.guessed[S.me]
              ? `<p class="wg-feed-empty">You got it! +${S.guessed[S.me]} points — watch the stage.</p>`
              : (mine.length
                ? mine.map((g) => `<div class="ch-guess ck-row is-miss"><span class="ch-txt">${esc(g.text)}</span><span class="wg-tag is-bad">Not it</span></div>`).join('')
                : empty('?', 'First guess is yours to make.', `Watch ${esc(nameOf(S, S.actor))} on the call and type what you see. Faster guesses score more.`)));
        const count = el.querySelector('.ch-count');
        if (count) count.textContent = isActor ? `${list.length} ${list.length === 1 ? 'guess' : 'guesses'}` : (!S.spectator && !S.guessed?.[S.me] ? `${mine.length} ${mine.length === 1 ? 'try' : 'tries'}` : '');
        feed.scrollTop = scrollTop;
      }
      paintRoster(el.querySelector('.ch-roster'), S, rosterStatus(S));
      const lock = el.querySelector('#cGuess');
      const locked = !!S.guessed?.[S.me];
      if (lock) { lock.disabled = !!(locked || S.spectator || S.preparing); if (locked) lock.placeholder = 'You got it!'; }
      const send = el.querySelector('#cSend');
      if (send) send.disabled = !!(locked || S.spectator || S.preparing);
      const mask = el.querySelector('.ch-mask');
      if (mask && S.masked && mask._ckMask !== S.masked) {
        mask._ckMask = S.masked;
        mask.innerHTML = tilesHtml(S.masked);
        mask.setAttribute('style', `--ch-len:${longestWord(S.masked)}`);
        mask.setAttribute('aria-label', `Hidden word, ${String(S.masked).length} characters`);
      }
    }
  },
};
