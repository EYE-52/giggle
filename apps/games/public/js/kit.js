/* Game kit helpers: print the standard components from public/css/game-ui.css
 * (see the class list at the top of that file and GAME_UI_GUIDE.md).
 * Pure string builders with escaping; no DOM access, safe in tests.
 *
 *   import { hudHtml, choicesHtml, inputRowHtml, waitingHtml,
 *            rankRows, winnerLine, resultsHtml } from '../kit.js';
 */
import { esc } from './util.js';

export { esc };

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/* "Round 2 of 5" — the one wording for round counters. */
export function roundLabel(round, rounds, word = 'Round') {
  const r = Number(round) || 0;
  const n = Number(rounds) || 0;
  return n ? `${word} ${r} of ${n}` : `${word} ${r}`;
}

/* "2 of 4 locked in" */
export function progressText(done, total, verb = 'locked in') {
  return `${Number(done) || 0} of ${Number(total) || 0} ${verb}`;
}

/* HUD row. Every part is optional except that the timer slot is always
 * printed (empty keeps its width) so the row never shifts between phases.
 * timer: a number of seconds, a ready string, or ''/null for none. */
export function hudHtml({ round = '', phase = '', progress = '', timer = null, urgent = false } = {}) {
  const t = timer === null || timer === undefined || timer === '' ? '' : (typeof timer === 'number' ? `${Math.max(0, Math.ceil(timer))}s` : String(timer));
  const isUrgent = urgent || (typeof timer === 'number' && timer <= 5 && timer > 0);
  return `<div class="gk-hud">`
    + (round ? `<span class="gk-hud-round">${esc(round)}</span>` : '')
    + (phase ? `<span class="gk-hud-phase">${esc(phase)}</span>` : '')
    + (progress ? `<span class="gk-hud-progress">${esc(progress)}</span>` : '')
    + `<span class="gk-hud-timer${isUrgent ? ' is-urgent' : ''}" aria-live="off">${esc(t)}</span>`
    + `</div>`;
}

/* Choice cards. options: [{ value, label, selected, correct, wrong, dim, disabled, mark }]
 * or plain strings. locked: the viewer locked in (check on the pick, others dim).
 * Each button carries data-choice="<value>" for the view's click handler. */
export function choicesHtml(options, { locked = false, cols = 2, phoneCols = 1, disabled = false, name = 'Answers' } = {}) {
  const list = (options || []).map((o, i) => (typeof o === 'object' && o !== null ? o : { value: i, label: o }));
  const style = `--gk-cols:${cols};--gk-cols-phone:${phoneCols}`;
  return `<div class="gk-choices${locked ? ' is-locked' : ''}" role="group" aria-label="${esc(name)}" style="${style}">`
    + list.map((o, i) => {
      const cls = ['gk-choice', o.selected && 'is-selected', o.correct && 'is-correct', o.wrong && 'is-wrong', o.dim && 'is-dim'].filter(Boolean).join(' ');
      const mark = o.mark === false ? '' : `<span class="gk-mark" aria-hidden="true">${esc(o.mark ?? LETTERS[i] ?? '')}</span>`;
      const off = disabled || locked || o.disabled;
      return `<button type="button" class="${cls}" data-choice="${esc(o.value ?? i)}" aria-pressed="${o.selected ? 'true' : 'false'}"${off ? ' disabled' : ''}>`
        + `${mark}<span class="gk-choice-text">${esc(o.label)}</span></button>`;
    }).join('')
    + `</div>`;
}

/* 48px field + same-height button. The view wires submit on the form. */
export function inputRowHtml({ id = 'gkInput', label = 'Your answer', placeholder = '', value = '', button = 'Send', maxLength = 80, disabled = false, enterKeyHint = 'send' } = {}) {
  return `<form class="gk-input-row" data-gk-input autocomplete="off">`
    + `<input class="gk-input" id="${esc(id)}" type="text" aria-label="${esc(label)}" placeholder="${esc(placeholder)}" value="${esc(value)}" maxlength="${Number(maxLength) || 80}" enterkeyhint="${esc(enterKeyHint)}"${disabled ? ' disabled' : ''}>`
    + `<button class="gk-btn gk-primary" type="submit"${disabled ? ' disabled' : ''}>${esc(button)}</button>`
    + `</form>`;
}

/* "Waiting for 2 players" / "Waiting for Ann" / custom text. */
export function waitingText(waiting) {
  if (Array.isArray(waiting)) {
    if (!waiting.length) return 'Everyone is in';
    if (waiting.length === 1) return `Waiting for ${waiting[0]}`;
    return `Waiting for ${waiting.length} players`;
  }
  const n = Number(waiting) || 0;
  if (!n) return 'Everyone is in';
  return `Waiting for ${n} ${n === 1 ? 'player' : 'players'}`;
}

export function waitingHtml(waiting, { done = false } = {}) {
  const text = typeof waiting === 'string' ? waiting : waitingText(waiting);
  return `<p class="gk-wait${done ? ' is-done' : ''}" role="status">${esc(text)}</p>`;
}

/* Calm waiting card for screens where the viewer has nothing to do yet:
 * who we wait for (title), what happens next (text), and the waiting line.
 *   waitCardHtml({ title: 'Dan is picking a word', text: 'Then Dan draws it and everyone guesses.', waiting: 'Waiting for Dan' }) */
export function waitCardHtml({ title = '', text = '', waiting = '', kicker = '', attrs = '' } = {}) {
  return `<div class="gk-card gk-wait-card" role="status"${attrs ? ' ' + attrs : ''}>`
    + (kicker ? `<p class="gk-meta gk-wait-kicker">${esc(kicker)}</p>` : '')
    + (title ? `<p class="gk-wait-title">${esc(title)}</p>` : '')
    + (text ? `<p class="gk-sub gk-wait-text">${esc(text)}</p>` : '')
    + (waiting ? `<p class="gk-wait">${esc(waiting)}</p>` : '')
    + `</div>`;
}

/* Standard competition ranking: equal points share a rank (1, 1, 3).
 * scores: { pid: points }; players: [{ id, name, left? }]. Players without a
 * score count as 0. Within a tie the order is by name, never by seat, so no
 * one looks "first among equals" because of where they sat. */
export function rankRows(scores, players, { you = null } = {}) {
  const s = scores && typeof scores === 'object' ? scores : {};
  const rows = (players || []).map((p) => ({
    id: p.id, name: p.name || '?', points: Number.isFinite(Number(s[p.id])) ? Number(s[p.id]) : 0,
    you: p.id === you, left: !!p.left,
  }));
  rows.sort((a, b) => (b.points - a.points) || a.name.localeCompare(b.name));
  let rank = 0;
  rows.forEach((r, i) => {
    if (i === 0 || r.points !== rows[i - 1].points) rank = i + 1;
    r.rank = rank;
  });
  for (const r of rows) r.tied = rows.filter((x) => x.rank === r.rank).length > 1;
  return rows;
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/* "Ann wins" / "It's a tie: Ann and Bo" / "No one scored". */
export function winnerLine(rows, { verb = 'wins' } = {}) {
  if (!rows || !rows.length) return '';
  const top = rows.filter((r) => r.rank === 1);
  if (top[0].points <= 0) return 'No one scored';
  if (top.length > 1) return `It's a tie: ${joinNames(top.map((r) => r.name))}`;
  return `${top[0].name} ${verb}`;
}

/* Round result or final scores: title, winner line, ranked list with the
 * viewer highlighted. */
export function resultsHtml({ title = 'Final scores', scores = {}, players = [], you = null, unit = 'pts', winner = true } = {}) {
  const rows = rankRows(scores, players, { you });
  const line = winner ? winnerLine(rows) : '';
  const tie = rows.filter((r) => r.rank === 1).length > 1 && rows[0]?.points > 0;
  return `<section class="gk-results" aria-label="${esc(title)}">`
    + (title ? `<h2 class="gk-results-title">${esc(title)}</h2>` : '')
    + (line ? `<p class="gk-winner${tie ? ' is-tie' : ''}">${esc(line)}</p>` : '')
    + `<ol class="gk-ranks">`
    + rows.map((r) => `<li class="gk-rank-row${r.rank === 1 && r.points > 0 ? ' is-top' : ''}${r.you ? ' is-you' : ''}${r.left ? ' is-left' : ''}">`
      + `<span class="gk-rank" aria-label="Rank ${r.rank}${r.tied ? ', tied' : ''}">${r.rank}</span>`
      + `<span class="gk-name">${esc(r.name)}${r.you ? ' <small>(you)</small>' : ''}${r.left ? ' <small>(left)</small>' : ''}</span>`
      + `<span class="gk-pts">${esc(r.points)}${unit ? ` <small class="gk-meta">${esc(unit)}</small>` : ''}</span></li>`).join('')
    + `</ol></section>`;
}

/* Game over screen for standard-layout games: the same Final scores block
 * in every game (centred title, winner line, ranked rows with "pts", the
 * viewer highlighted) plus an optional one-line note under the list
 * (watching: true adds "You watched this game." for spectators). The
 * shell adds the Rematch / Change game row after it. */
export function finalHtml({ scores = {}, players = [], you = null, note = '', watching = false, unit = 'pts', title = 'Final scores', scene = '' } = {}) {
  return `<div class="gk-final gk-col" role="status"${scene ? ` data-scene="${esc(scene)}" data-phase="done"` : ''}>`
    + resultsHtml({ title, scores, players, you, unit })
    + (note ? `<p class="gk-final-note">${esc(note)}</p>` : '')
    + (watching ? `<p class="gk-final-note">You watched this game.</p>` : '')
    + `</div>`;
}

/* Paints finalHtml into el once per distinct result (scores, players,
 * viewer), so snapshots that change nothing keep the shell's Rematch row
 * and its focus. Returns true when it wrote new markup. */
const finalKeys = new WeakMap();
export function paintFinal(el, opts = {}) {
  if (!el) return false;
  const key = JSON.stringify([opts.scene || '', opts.scores || {}, (opts.players || []).map((p) => [p.id, p.name, !!p.left]), opts.you ?? null, opts.note || '', !!opts.watching]);
  if (finalKeys.get(el) === key && el.querySelector?.('.gk-final')) return false;
  finalKeys.set(el, key);
  el.innerHTML = finalHtml(opts);
  return true;
}

/* Live HUD timer. Keeps the .gk-hud-timer slot inside root counting down to
 * endsAt on the calibrated server clock (pass the view's api, or api.now).
 * One ticker per root:
 * calling again replaces it, and a falsy endsAt or show:false empties the
 * slot (its width stays reserved by the CSS). Views call stopHudTimer(root)
 * from dispose(). The default `show` hides the timer while the room is
 * preparing, after the match ended and in result phases, like the shell. */
const hudClocks = new WeakMap();
const RESULT_PHASE = /^(done|reveal|result|results|score|scores|final)$/;
export function hudTimerShown(S) {
  return !!S && Number(S.endsAt) > 0 && !S.preparing && !S.matchEnded && !RESULT_PHASE.test(S.phase || '');
}
export function stopHudTimer(root) {
  const id = root && hudClocks.get(root);
  if (id !== undefined && id !== null) clearInterval(id);
  if (root) hudClocks.delete(root);
}
export function syncHudTimer(root, S, now, { show = hudTimerShown(S), endsAt = S?.endsAt } = {}) {
  stopHudTimer(root);
  if (!root) return;
  const clock = () => {
    try {
      const v = typeof now === 'function' ? now() : typeof now?.now === 'function' ? now.now() : NaN;
      if (Number.isFinite(v)) return v;
    } catch { /* wall clock */ }
    return Date.now();
  };
  const live = !!show && Number(endsAt) > 0;
  const paint = () => {
    const slot = root.querySelector?.('.gk-hud-timer');
    if (!slot) return;
    const left = live ? Math.max(0, Math.ceil((endsAt - clock()) / 1000)) : null;
    const text = left === null ? '' : `${left}s`;
    if (slot.textContent !== text) slot.textContent = text;
    slot.classList?.toggle('is-urgent', left !== null && left <= 5);
    if (left === 0) stopHudTimer(root);
  };
  paint();
  if (live && typeof setInterval === 'function' && Math.ceil((endsAt - clock()) / 1000) > 0) {
    const id = setInterval(paint, 250);
    id?.unref?.();
    hudClocks.set(root, id);
  }
}
