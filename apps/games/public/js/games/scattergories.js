/* Scattergories view: one letter, five categories, unique answers score.
 * Built on the game kit. Rebuild only on round/lock change so typing
 * survives snapshots. Contracts: {answers}, {answers, lock:true},
 * {finish:true} (host), {next:true} (host, reveal). */
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

const CSS = [['word-games-css', '/css/compact-answer-games.css'], ['scattergories-world-css', '/css/scattergories-world.css']];
function ensureCss() { for (const [id, href] of CSS) ensureStylesheet(id, href); }
function removeCss() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  document.getElementById('scattergories-world-css')?.remove();
}

function paintClock(el, S, api) {
  const slot = el.querySelector?.('.gk-hud-timer');
  if (!slot) return;
  const left = S.endsAt > 0 && !S.preparing && S.phase !== 'done' ? countdown(S.endsAt, api?.now) : null;
  const text = left === null ? '' : `${left}s`;
  if (slot.textContent !== text) slot.textContent = text;
  slot.classList?.toggle('is-urgent', left !== null && left <= 5 && S.phase === 'write');
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

export default {
  styles: ['/css/compact-answer-games.css', '/css/scattergories-world.css'],
  ownsTimer: true,
  dispose(el) {
    if (clock !== null) clearInterval(clock);
    clock = null; current = null; if (el) delete el._key; removeCss();
  },
  render(el, S, api) {
    const prior = current;
    current = { el, S, api };
    if (!S.audioBaseline && prior?.el === el && prior.S.instanceId === S.instanceId && prior.S.round === S.round &&
        prior.S.phase === 'write' && S.phase === 'reveal' && S.last?.points?.[S.me] > 0) {
      api.cue?.('correct', { id: `${S.instanceId}:${S.round}:categories-scored`, gain: 0.8 });
    }
    ensureCss();
    if (S.phase === 'done') {
      const resultKey = JSON.stringify(['done', S.instanceId, S.rounds, S.players, S.scores, S.me]);
      if (el._key === resultKey) return;
      el.innerHTML = `<section class="gk-final wg wg-final sg gk-col gk-stack" data-game="scattergories" data-phase="done" aria-label="Scattergories final scores">`
        + resultsHtml({ title: 'Final scores', scores: S.scores || {}, players: S.players || [], you: S.me })
        + `</section>`;
      el._key = resultKey;
      runClock(el, S, api);
      return;
    }
    if (S.phase === 'reveal' && S.last) {
      const resultKey = JSON.stringify(['reveal', S.instanceId, S.round, S.me, S.hostId, S.spectator, S.players, S.last]);
      if (el._key === resultKey) { const next = el.querySelector('#sNext'); if (next) next.disabled = !!S.preparing; runClock(el, S, api); return; }
      const openCategories = [...(el.querySelectorAll?.('[data-sc-category][open]') || [])].map((n) => n.dataset.scCategory);
      const letter = String(S.last.letter || '');
      const sections = S.last.categories.map((c, i) => {
        const rows = (S.players || []).map((p) => {
          const ans = (S.last.answers[p.id] || [])[i] || '';
          const unique = !!(S.last.unique[p.id] && S.last.unique[p.id][i]);
          const tag = !ans ? '' : unique ? '<span class="wg-tag is-good">Unique</span>'
            : ans.trim().toLowerCase().startsWith(letter.toLowerCase()) ? '<span class="wg-tag">Shared</span>' : `<span class="wg-tag is-bad">Not ${esc(letter)}</span>`;
          return `<li class="wg-row${p.id === S.me ? ' is-you' : ''}"><span class="wg-who">${esc(p.name)}${p.id === S.me ? ' <small>(you)</small>' : ''}</span>`
            + `<span class="wg-ans${ans ? '' : ' is-empty'}">${ans ? esc(ans) : 'No answer'} ${tag}</span>`
            + `<span class="wg-pts${unique ? '' : ' is-zero'}">+${unique ? 40 : 0}</span></li>`;
        }).join('');
        const open = openCategories.length ? openCategories.includes(String(i)) : i === 0;
        return `<details class="wg-more sg-cat" data-sc-category="${i}" ${open ? 'open' : ''}><summary>${esc(c)}</summary><ol class="wg-rows" aria-label="${esc(c)} answers">${rows}</ol></details>`;
      }).join('');
      const mine = S.last.points?.[S.me];
      const watch = S.spectator || !(S.players || []).some((p) => p.id === S.me);
      const isHost = S.me === S.hostId && !watch;
      el.innerHTML = `<section class="wg sg gk-col gk-stack" data-game="scattergories" data-phase="reveal" aria-label="Scattergories answers">`
        + hudHtml({ round: roundLabel(S.round, S.rounds), phase: 'Answers', progress: `Letter ${letter}`, timer: '' })
        + `<div class="sg-head"><span class="sg-letter" aria-hidden="true">${esc(letter)}</span><h2 class="gk-prompt">Unique answers score</h2></div>`
        + `<p class="wg-status${mine ? ' is-good' : ''}" role="status">${watch ? 'You are watching.' : mine ? `You scored +${mine} this round.` : 'No unique answers for you this round.'}</p>`
        + `<div class="wg-slot">${isHost ? '<button class="gk-btn gk-primary" id="sNext" type="button">Next</button>' : waitingHtml(S.round >= S.rounds ? 'Final scores are next' : 'Next round soon')}</div>`
        + `<div class="sg-cats">${sections}</div>`
        + `</section>`;
      el._key = resultKey;
      const nx = el.querySelector('#sNext');
      if (nx) { nx.disabled = !!S.preparing; nx.onclick = () => sendAction(el, S, 'reveal', { next: true }); }
      runClock(el, S, api);
      return;
    }
    // Write phase: rebuild only on round/lock change so typing survives snapshots.
    const key = `write:${S.instanceId || ''}:${S.me || ''}:${S.round}:${S.myLocked ? 1 : 0}:${S.spectator ? 'w' : 'p'}`;
    if (el._key === key) {
      const progress = el.querySelector('.gk-hud-progress');
      if (progress) progress.textContent = lockLine(S);
      const wait = el.querySelector('#scState');
      if (wait) wait.textContent = waitText(S);
      paintSaved(el, S);
      for (const control of el.querySelectorAll?.('input') || []) control.disabled = !!(S.myLocked || S.spectator || S.preparing);
      for (const id of ['scSave', 'scLock']) { const control = el.querySelector(`#${id}`); if (control) control.disabled = !!(S.myLocked || S.spectator || S.preparing); }
      const finish = el.querySelector('#scFin');
      if (finish) finish.disabled = !!S.preparing;
      runClock(el, S, api);
      return;
    }
    el._key = key;
    const dis = (S.myLocked || S.spectator || S.preparing) ? 'disabled' : '';
    const letter = String(S.letter || '');
    el.innerHTML = `<section class="wg sg gk-col gk-stack" data-game="scattergories" data-phase="write" aria-label="Scattergories">`
      + hudHtml({ round: roundLabel(S.round, S.rounds), phase: S.spectator ? 'Watching' : S.myLocked ? 'Locked in' : 'Write', progress: lockLine(S), timer: '' })
      + `<div class="sg-head"><span class="sg-letter" aria-hidden="true">${esc(letter)}</span><h2 class="gk-prompt">Words that start with ${esc(letter)}</h2></div>`
      + `<div class="sg-fields" role="group" aria-label="Five category answers">${(S.categories || []).map((c, i, arr) => (
        `<div class="sg-field"><label for="sc${i}">${esc(c)}</label>`
        + `<input class="gk-input" type="text" id="sc${i}" maxlength="40" value="${esc((S.mine || [])[i] || '')}" ${dis} placeholder="${esc(letter)}…" autocomplete="off" autocapitalize="words" autocorrect="off" spellcheck="false" inputmode="text" enterkeyhint="${i === arr.length - 1 ? 'done' : 'next'}" /></div>`
      )).join('')}</div>`
      + `<div class="gk-actions"><button class="gk-btn gk-primary" id="scLock" type="button" ${dis}>Lock in</button><button class="gk-btn" id="scSave" type="button" ${dis}>Save</button></div>`
      + `<p class="wg-status" id="scSaved" role="status"></p>`
      + `<div class="wg-slot"><p class="gk-wait" id="scState" role="status">${esc(waitText(S))}</p></div>`
      + `<details class="wg-more sc-rules"><summary>Rules</summary>`
      + `<p>Each answer that starts with ${esc(letter)} and that nobody else wrote earns 40 points. Save keeps editing; Lock in submits.</p>`
      + (S.me === S.hostId && !S.spectator ? '<button class="gk-btn" id="scFin" type="button">Finish now</button>' : '')
      + `</details></section>`;
    const collect = () => (S.categories || []).map((_, i) => {
      const inp = el.querySelector(`#sc${i}`);
      return inp ? inp.value.slice(0, 40) : '';
    });
    const sv = el.querySelector('#scSave');
    if (sv) sv.onclick = () => sendAction(el, S, 'write', { answers: collect() });
    const lk = el.querySelector('#scLock');
    if (lk) lk.onclick = () => sendAction(el, S, 'write', { answers: collect(), lock: true });
    const fn = el.querySelector('#scFin');
    if (fn) { fn.disabled = !!S.preparing; fn.onclick = () => sendAction(el, S, 'write', { finish: true }); }
    (S.categories || []).forEach((_, i, arr) => {
      const inp = el.querySelector(`#sc${i}`);
      if (!inp) return;
      inp.oninput = () => paintSaved(el, current?.S || S);
      inp.onkeydown = (e) => {
        if (e.key !== 'Enter' || e.repeat || e.isComposing || e.keyCode === 229 || inp.disabled) return;
        e.preventDefault();
        const next = el.querySelector(`#sc${i + 1}`);
        if (next && !next.disabled) next.focus();
        else if (i === arr.length - 1 && sv && !sv.disabled) sendAction(el, S, 'write', { answers: collect() });
      };
    });
    paintSaved(el, S);
    runClock(el, S, api);
  },
};

function lockLine(S) {
  return progressText(S.locked ? S.locked.length : 0, activeCount(S));
}

function waitText(S) {
  const total = activeCount(S), done = S.locked ? S.locked.length : 0;
  if (S.spectator) return `${done} of ${total} locked in`;
  if (!S.myLocked) return 'Fill what you can, then lock in';
  const waiting = Math.max(0, total - done);
  return waiting ? `Waiting for ${waiting} ${waiting === 1 ? 'player' : 'players'}` : 'Everyone is in';
}

function paintSaved(el, S) {
  const line = el.querySelector('#scSaved');
  if (!line) return;
  const saved = S.mine?.some(Boolean) && (S.categories || []).every((_, i) => el.querySelector(`#sc${i}`)?.value === (S.mine[i] || ''));
  line.textContent = saved ? S.myLocked ? 'Locked in. Your answers are ready for the reveal.' : 'Saved. You can keep editing until you lock in.' : '';
}
