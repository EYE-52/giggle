/* Word Countdown view: the nine tiles are the game — tap them to build, or
 * type. Save keeps editing, Lock in submits, Pass skips. Built on the game
 * kit. Contracts: {word}, {word, lock:true}, {pass:true}, {finish:true},
 * {next:true}. */
import { esc, countdown, ensureStylesheet } from '../util.js';
import { hudHtml, roundLabel, progressText, waitingHtml, resultsHtml } from '../kit.js';

let current = null, clock = null;

function sendAction(el, origin, phase, action) {
  const live = current;
  if (!live || live.el !== el || live.S.instanceId !== origin.instanceId || live.S.round !== origin.round ||
      live.S.me !== origin.me || live.S.phase !== phase || live.S.spectator || live.S.preparing ||
      (phase !== 'reveal' && live.S.endsAt > 0 && typeof live.api.now === 'function' && live.api.now() >= live.S.endsAt)) return false;
  if (live.S.myLocked && !action.finish && !action.next) return false;
  if ((action.finish || action.next) && live.S.hostId !== live.S.me) return false;
  return live.api.send(action);
}

const CSS = [['word-games-css', '/css/compact-answer-games.css'], ['countdown-word-world-css', '/css/countdown-word-world.css']];
function ensureCss() { for (const [id, href] of CSS) ensureStylesheet(id, href); }
function removeCss() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  document.getElementById('countdown-word-world-css')?.remove();
}

function paintClock(el, S, api) {
  const slot = el.querySelector?.('.gk-hud-timer');
  if (!slot) return;
  const left = S.endsAt > 0 && !S.preparing && S.phase !== 'done' ? countdown(S.endsAt, api?.now) : null;
  const text = left === null ? '' : `${left}s`;
  if (slot.textContent !== text) slot.textContent = text;
  slot.classList?.toggle('is-urgent', left !== null && left <= 5 && S.phase === 'make');
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

function activeCount(S) { return (S.players || []).filter((p) => !p.left).length; }
function lockLine(S) { return progressText(S.locked ? S.locked.length : 0, activeCount(S)); }
function waitText(S) {
  const total = activeCount(S), done = S.locked ? S.locked.length : 0;
  if (S.spectator) return `${done} of ${total} locked in`;
  if (!S.myLocked) return 'Save a word, then lock in';
  const waiting = Math.max(0, total - done);
  return waiting ? `Waiting for ${waiting} ${waiting === 1 ? 'player' : 'players'}` : 'Everyone is in';
}

function tilesHtml(letters, { interactive, disabled }) {
  return `<div class="cw-tiles" role="group" aria-label="Available letters">${(letters || []).map((L, i) => (interactive
    ? `<button type="button" class="cw-tile" data-tile="${i}" data-letter="${esc(L)}" ${disabled ? 'disabled' : ''} aria-label="Use letter ${esc(L)}">${esc(L)}</button>`
    : `<span class="cw-tile">${esc(L)}</span>`)).join('')}</div>`;
}

export default {
  styles: ['/css/compact-answer-games.css', '/css/countdown-word-world.css'],
  ownsTimer: true,
  dispose(el) {
    if (clock !== null) clearInterval(clock);
    clock = null; current = null; if (el) delete el._key; removeCss();
  },
  render(el, S, api) {
    const previous = current;
    current = { el, S, api };
    if (!S.audioBaseline && previous?.el === el && previous.S.instanceId === S.instanceId && previous.S.round === S.round &&
        S.phase === 'make' && S.mine && S.mine !== previous.S.mine && S.myFeedback?.ok) {
      api.cue?.('place', { id: `${S.instanceId}:${S.round}:saved-word:${S.mine}`, gain: 0.65 });
    }
    if (!S.audioBaseline && previous?.el === el && previous.S.instanceId === S.instanceId && previous.S.round === S.round &&
        previous.S.phase === 'make' && S.phase === 'reveal' && S.last?.valid?.[S.me]) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:word-scored`, gain: 0.8 });
    }
    ensureCss();
    if (S.phase === 'done') {
      const resultKey = JSON.stringify(['done', S.instanceId, S.players, S.rounds, S.scores, S.me]);
      if (el._key === resultKey) return;
      el.innerHTML = `<section class="gk-final wg wg-final cw gk-col gk-stack" data-game="countdown-word" data-phase="done" aria-label="Word Countdown final scores">`
        + resultsHtml({ title: 'Final scores', scores: S.scores || {}, players: S.players || [], you: S.me })
        + `</section>`;
      el._key = resultKey;
      runClock(el, S, api);
      return;
    }
    if (S.phase === 'reveal' && S.last) {
      const resultKey = JSON.stringify(['reveal', S.instanceId, S.round, S.me, S.hostId, S.spectator, S.players, S.last]);
      if (el._key === resultKey) { const next = el.querySelector('#cwNext'); if (next) next.disabled = !!S.preparing; runClock(el, S, api); return; }
      const rows = (S.players || []).map((p) => {
        const w = S.last.answers[p.id];
        const ok = S.last.valid[p.id];
        const pts = S.last.points[p.id] || 0;
        const tag = !w ? '' : !ok ? '<span class="wg-tag is-bad">Not accepted</span>'
          : w.length === S.last.longest ? '<span class="wg-tag is-good">Longest</span>' : `<span class="wg-tag">${w.length} letters</span>`;
        return `<li class="wg-row${p.id === S.me ? ' is-you' : ''}"><span class="wg-who">${esc(p.name)}${p.id === S.me ? ' <small>(you)</small>' : ''}</span>`
          + `<span class="wg-ans${w ? '' : ' is-empty'}">${w ? `<span class="cw-word">${esc(w)}</span>` : 'No word'} ${tag}</span>`
          + `<span class="wg-pts${pts ? '' : ' is-zero'}">+${pts}</span></li>`;
      }).join('');
      const watch = S.spectator || !(S.players || []).some((p) => p.id === S.me);
      const isHost = S.me === S.hostId && !watch;
      const mine = S.last.points?.[S.me] || 0;
      el.innerHTML = `<section class="wg cw gk-col gk-stack" data-game="countdown-word" data-phase="reveal" aria-label="Word Countdown answers">`
        + hudHtml({ round: roundLabel(S.round, S.rounds), phase: 'Answers', progress: S.last.longest ? `Longest: ${S.last.longest} letters` : 'No valid words', timer: '' })
        + `<h2 class="gk-prompt">One we spotted: <b class="cw-word">${esc(S.last.best || '')}</b></h2>`
        + tilesHtml(S.last.letters, { interactive: false })
        + `<p class="wg-status${mine ? ' is-good' : ''}" role="status">${watch ? 'You are watching.' : mine ? `You scored +${mine} this round.` : 'No points for you this round.'}</p>`
        + `<div class="wg-slot">${isHost ? '<button class="gk-btn gk-primary" id="cwNext" type="button">Next</button>' : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next tray soon')}</div>`
        + `<ol class="wg-rows" aria-label="Everyone's words">${rows}</ol>`
        + `</section>`;
      el._key = resultKey;
      const nx = el.querySelector('#cwNext');
      if (nx) { nx.disabled = !!S.preparing; nx.onclick = () => sendAction(el, S, 'reveal', { next: true }); }
      runClock(el, S, api);
      return;
    }
    const key = `make:${S.instanceId || ''}:${S.me || ''}:${S.round}:${S.myLocked ? 1 : 0}:${S.spectator ? 'w' : 'p'}`;
    const paintStatus = () => {
      const progress = el.querySelector('.gk-hud-progress');
      if (progress) progress.textContent = lockLine(S);
      const state = el.querySelector('#cwState');
      if (state) state.textContent = waitText(S);
      const feedback = el.querySelector('#cwFeedback');
      if (feedback) {
        feedback.textContent = S.myFeedback?.message || '';
        feedback.classList?.toggle('is-error', S.myFeedback?.ok === false);
      }
      for (const id of ['cwWord', 'cwSave', 'cwLock', 'cwBack', 'cwClear', 'cwPass']) {
        const control = el.querySelector(`#${id}`);
        if (control) control.disabled = !!(S.myLocked || S.spectator || S.preparing);
      }
      for (const tile of el.querySelectorAll?.('[data-tile]') || []) tile.disabled = !!(S.myLocked || S.spectator || S.preparing || tile.classList.contains('is-used'));
      const finish = el.querySelector('#cwFin');
      if (finish) finish.disabled = !!S.preparing;
    };
    runClock(el, S, api);
    if (el._key === key) { paintStatus(); return; }
    // Preserve the typed draft across snapshots on the same round.
    const prior = el._key && String(el._key).startsWith(`make:${S.instanceId || ''}:${S.me || ''}:${S.round}:`)
      ? (el.querySelector('#cwWord')?.value || '')
      : '';
    el._key = key;
    const off = !!(S.myLocked || S.spectator);
    const dis = off ? 'disabled' : '';
    el.innerHTML = `<section class="wg cw gk-col gk-stack" data-game="countdown-word" data-phase="make" aria-label="Word Countdown">`
      + hudHtml({ round: roundLabel(S.round, S.rounds), phase: S.spectator ? 'Watching' : S.myLocked ? 'Locked in' : 'Build a word', progress: lockLine(S), timer: '' })
      + `<h2 class="gk-prompt">Make the longest word</h2>`
      + tilesHtml(S.letters, { interactive: true, disabled: off })
      + `<form class="gk-input-row" id="cwForm" autocomplete="off"><input class="gk-input cw-input" id="cwWord" type="text" aria-label="Your word from the available letters" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" inputmode="text" maxlength="9" value="${esc(prior || S.mine || '')}" ${dis} placeholder="Tap tiles or type…" />`
      + `<button class="gk-btn gk-primary" id="cwLock" type="submit" ${dis} aria-label="Lock in your word">Lock in</button></form>`
      + `<div class="gk-actions cw-tools"><button class="gk-btn" id="cwSave" type="button" ${dis} aria-label="Save word and keep editing">Save</button>`
      + `<button class="gk-btn" id="cwBack" type="button" ${dis} aria-label="Delete last letter">⌫</button>`
      + `<button class="gk-btn" id="cwClear" type="button" ${dis}>Clear</button>`
      + `<button class="gk-btn gk-quiet" id="cwPass" type="button" ${dis} aria-label="Pass this round without a word">Pass</button></div>`
      + `<p class="wg-status" id="cwFeedback" role="status" aria-live="polite"></p>`
      + `<div class="wg-slot"><p class="gk-wait" id="cwState" role="status">${esc(waitText(S))}</p></div>`
      + `<details class="wg-more cw-rules"><summary>Rules</summary>`
      + `<p>Use 3–9 of the letters, each as often as it appears. A valid word earns 50 points plus 10 per letter; the longest earns 50 more. Save keeps editing, Lock in submits, Pass skips.</p>`
      + (S.contentNote ? `<p>${esc(S.contentNote)}</p>` : '')
      + (S.me === S.hostId && !S.spectator ? '<button class="gk-btn" id="cwFin" type="button">Finish now</button>' : '')
      + `</details></section>`;
    const inp = el.querySelector('#cwWord');
    const tileBtns = typeof el.querySelectorAll === 'function' ? el.querySelectorAll('[data-tile]') : [];
    const syncTiles = () => {
      // Grey out tiles already consumed by the typed word, left to right.
      const want = inp ? inp.value.toUpperCase() : '';
      const counts = {};
      for (const ch of want) counts[ch] = (counts[ch] || 0) + 1;
      tileBtns.forEach((t) => {
        const L = t.dataset.letter;
        if ((counts[L] || 0) > 0) { counts[L] -= 1; t.classList.add('is-used'); }
        else t.classList.remove('is-used');
        t.disabled = !!(current?.S.myLocked || current?.S.spectator || current?.S.preparing || t.classList.contains('is-used'));
        t.setAttribute?.('aria-pressed', String(t.classList.contains('is-used')));
      });
    };
    tileBtns.forEach((t) => {
      t.onclick = () => {
        if (!inp || inp.disabled || current?.el !== el || current?.S.round !== S.round || current?.S.instanceId !== S.instanceId) return;
        const avail = (S.letters || []).filter((L) => L === t.dataset.letter).length;
        const have = inp.value.toUpperCase().split('').filter((c) => c === t.dataset.letter).length;
        if (inp.value.length >= 9 || have >= avail) return;
        inp.value += t.dataset.letter;
        syncTiles();
      };
    });
    if (inp) inp.oninput = syncTiles;
    const val = () => (inp ? inp.value : '');
    const lockIn = () => sendAction(el, S, 'make', { word: val(), lock: true });
    const form = el.querySelector('#cwForm');
    if (form) form.onsubmit = (e) => { e?.preventDefault?.(); lockIn(); };
    const sv = el.querySelector('#cwSave');
    if (sv) sv.onclick = () => sendAction(el, S, 'make', { word: val() });
    const lk = el.querySelector('#cwLock');
    if (lk) lk.onclick = (e) => { e?.preventDefault?.(); lockIn(); };
    if (inp) inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.repeat && !e.isComposing && e.keyCode !== 229 && !inp.disabled) { e.preventDefault?.(); lockIn(); } };
    const back = el.querySelector('#cwBack');
    if (back) back.onclick = () => { if (!inp || inp.disabled) return; inp.value = inp.value.slice(0, -1); syncTiles(); };
    const clear = el.querySelector('#cwClear');
    if (clear) clear.onclick = () => { if (!inp || inp.disabled) return; inp.value = ''; syncTiles(); };
    const pass = el.querySelector('#cwPass');
    if (pass) pass.onclick = () => sendAction(el, S, 'make', { pass: true });
    const fn = el.querySelector('#cwFin');
    if (fn) fn.onclick = () => sendAction(el, S, 'make', { finish: true });
    syncTiles();
    paintStatus();
  },
};
