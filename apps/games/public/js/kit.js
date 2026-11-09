/* Game kit helpers: print the standard components from public/css/game-ui.css
 * (see the class list at the top of that file and GAME_UI_GUIDE.md).
 * Pure string builders with escaping; no DOM access, safe in tests.
 *
 *   import { hudHtml, choicesHtml, inputRowHtml, waitingHtml,
 *            rankRows, winnerLine, resultsHtml } from '../kit.js';
 */
import { esc, nameOf } from './util.js';

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
    + `<span class="gk-hud-round">${esc(round)}</span>`
    + `<span class="gk-hud-phase">${esc(phase)}</span>`
    + `<span class="gk-hud-progress">${esc(progress)}</span>`
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
/* Each root remembers the length of its current deadline (first sight of a
 * new endsAt, or totalMs when the view knows it) so the slot can carry how
 * much of the window is left as --gk-timer-left (0–1) for timer bars. */
const hudSpans = new WeakMap();
export function syncHudTimer(root, S, now, { show = hudTimerShown(S), endsAt = S?.endsAt, totalMs = 0 } = {}) {
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
  let span = root && hudSpans.get(root);
  if (live && (!span || span.endsAt !== endsAt)) {
    span = { endsAt, total: Math.max(1, Number(totalMs) || endsAt - clock()) };
    hudSpans.set(root, span);
  }
  const paint = () => {
    const slot = root.querySelector?.('.gk-hud-timer');
    if (!slot) return;
    const left = live ? Math.max(0, Math.ceil((endsAt - clock()) / 1000)) : null;
    const text = left === null ? '' : `${left}s`;
    if (slot.textContent !== text) slot.textContent = text;
    slot.classList?.toggle('is-urgent', left !== null && left <= 5);
    slot.classList?.toggle('is-warn', left !== null && left > 5 && left <= 10);
    const frac = left === null || !span ? 0 : Math.max(0, Math.min(1, (endsAt - clock()) / span.total));
    slot.style?.setProperty?.('--gk-timer-left', frac.toFixed(3));
    if (left === 0) stopHudTimer(root);
  };
  paint();
  if (live && typeof setInterval === 'function' && Math.ceil((endsAt - clock()) / 1000) > 0) {
    const id = setInterval(paint, 250);
    id?.unref?.();
    hudClocks.set(root, id);
  }
}

/* ---- Party live strip ----
 * The bottom band of the party and answer games (party-scenes.css): one
 * seat per player with an avatar, a mark for "already acted this phase"
 * and their score, plus one dot per round. It has no controls, so watchers
 * have nothing to tap. paintLiveStrip(scene, S, opts) keeps one
 * <aside class="pl-live"> as the scene's last child, rewrites its parts
 * only when their text changes, moves the scene's rules disclosure into its
 * header, and marks the scene .pl-fill so it stretches to the viewport with
 * the strip at the bottom.
 *   acted    pids that acted this phase (check mark + verb)
 *   actors   pids expected to act (default: every player still here)
 *   roles    { pid: 'Target' } a tag that replaces the acted state;
 *            { pid: { text: 'Fouled', tone: 'bad' } } marks it with a cross
 *   verb     'Voted'; waiting: 'Voting' (shown to actors still to act)
 *   gains    { pid: points } won this round, shown as +N
 *   scores   defaults to S.scores; score: false hides the points line
 *   family   'party' (default) or 'arcade' */
function liveDotsHtml(S) {
  const round = Math.max(1, Math.min(Number(S?.round) || 1, Number(S?.rounds) || Infinity));
  const rounds = Number(S?.rounds) || 0;
  if (rounds > 0 && rounds <= 20) {
    return `<ol class="pl-dots" aria-label="${esc(roundLabel(round || 1, rounds))}">${Array.from({ length: rounds }, (_, i) => `<li class="${i + 1 < round ? 'is-done' : i + 1 === round ? 'is-now' : ''}"></li>`).join('')}</ol>`;
  }
  return rounds ? `<span class="pl-round">${esc(roundLabel(round || 1, rounds))}</span>` : '';
}
export function liveSeatsHtml(S, opts = {}) {
  const players = S?.players || [];
  const scores = opts.scores || S?.scores || {};
  const acted = new Set(opts.acted || []);
  const actors = new Set(opts.actors || players.filter((p) => !p.left).map((p) => p.id));
  const roles = opts.roles || {};
  const gains = opts.gains || {};
  const verb = opts.verb || 'Done';
  const waiting = opts.waiting || 'Thinking';
  return players.map((p, i) => {
    const role = typeof roles[p.id] === 'object' && roles[p.id] ? roles[p.id].text : roles[p.id];
    const bad = typeof roles[p.id] === 'object' && roles[p.id]?.tone === 'bad';
    const did = acted.has(p.id);
    const waits = !did && !role && !p.left && actors.has(p.id) && opts.waiting !== false;
    const state = p.left ? 'Left' : role || (did ? verb : waits ? waiting : '');
    const cls = ['pl-seat', `pl-c${i % 5}`, did && 'is-acted', waits && 'is-waiting', role && 'is-role', bad && 'is-bad', p.id === S?.me && 'is-you', p.left && 'is-left'].filter(Boolean).join(' ');
    const gain = Number(gains[p.id]) || 0;
    const name = nameOf(S, p.id);
    return `<li class="${cls}"><span class="pl-avatar" aria-hidden="true">${esc(initials(name))}<i class="pl-badge"></i></span>`
      + `<span class="pl-name">${esc(name)}${p.id === S?.me ? '<small> (you)</small>' : ''}</span>`
      + `<span class="pl-state">${esc(state)}</span>`
      + (opts.score === false ? '' : `<span class="pl-points"><b>${Number(scores[p.id]) || 0}</b><small class="pl-unit">pts</small><small class="pl-gain${gain ? '' : ' is-empty'}">${gain ? `+${gain}` : '+0'}</small></span>`)
      + `</li>`;
  }).join('');
}
export function paintLiveStrip(scene, S, opts = {}) {
  if (!scene || typeof document === 'undefined') return null;
  scene.classList?.add('pl-fill');
  if (!scene.getAttribute?.('data-family')) scene.setAttribute?.('data-family', opts.family || 'party');
  // The shell's game zoom (CSS zoom on #gbody) also scales viewport units:
  // the stage divides by it so it still fills the screen.
  const zoom = parseFloat(scene.closest?.('#gbody')?.style?.zoom) || 1;
  scene.style?.setProperty?.('--pl-zoom', String(zoom));
  // Reserve the available stage height, with the roster in normal flow.
  // Document coordinates keep scrolling from growing it on repaint.
  const body = scene.closest?.('#gbody');
  const top = body?.getBoundingClientRect?.().top;
  const viewport = document.defaultView?.innerHeight;
  if (Number.isFinite(top) && viewport > 0) {
    const used = top + (document.defaultView?.scrollY || 0);
    scene.style?.setProperty?.('--pl-stage-height', `${Math.max(0, (viewport - used - 32) / zoom)}px`);
  }
  let strip = scene.querySelector?.('.pl-live');
  if (!strip) {
    strip = document.createElement?.('aside');
    // Minimal DOMs (tests, headless hosts) without real elements get no strip.
    if (!strip || typeof strip.setAttribute !== 'function') return null;
    strip.className = 'pl-live';
    strip.setAttribute('aria-label', opts.label || 'Players');
    strip.innerHTML = `<div class="pl-head"><span class="pl-label">${esc(opts.label || 'Players')}</span><span class="pl-slot"></span><span class="pl-dotsbox"></span></div><ul class="pl-seats"></ul>`;
    if (typeof strip.querySelector !== 'function' || typeof scene.appendChild !== 'function') return null;
    scene.appendChild(strip);
  } else if (scene.lastElementChild && scene.lastElementChild !== strip) {
    scene.appendChild(strip);
  }
  // The scene's rules disclosure rides in the strip's header as a chip.
  const slot = strip.querySelector('.pl-slot');
  for (const child of Array.from(scene.children || [])) {
    if (child !== strip && (child.classList?.contains('party-more') || child.classList?.contains('wg-more'))) slot?.appendChild(child);
  }
  const dots = liveDotsHtml(S);
  const box = strip.querySelector('.pl-dotsbox');
  if (box && box.plHtml !== dots) { box.innerHTML = dots; box.plHtml = dots; }
  const seats = liveSeatsHtml(S, opts);
  strip.style?.setProperty?.('--pl-visible-seats', String(Math.min(3, Math.max(1, S.players?.length || 1))));
  const list = strip.querySelector('.pl-seats');
  if (list && list.plHtml !== seats) { list.innerHTML = seats; list.plHtml = seats; }
  return strip;
}
/* A player's avatar disc in the strip's seat colour, for "your pick" tags
 * and voter rows on choice cards. */
export function faceHtml(S, pid, { name: withName = false } = {}) {
  const i = Math.max(0, (S?.players || []).findIndex((p) => p.id === pid));
  const name = nameOf(S, pid);
  const face = `<span class="pl-face pl-c${i % 5}" aria-hidden="true">${esc(initials(name))}</span>`;
  return withName ? `<span class="pl-voter">${face}${esc(name)}</span>` : face;
}
/* "Ann" -> "A", "Player 2" -> "P2", "Mary Jo" -> "MJ". */
function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words[0].charAt(0) + (words[1] ? words[1].charAt(0) : '')).toUpperCase();
}
/* For views that run their own clock: marks a .gk-hud-timer slot amber in
 * the last ten seconds and sets --gk-timer-left (0–1) for the timer bar.
 * The window's length is totalMs, or how long was left when this endsAt
 * was first seen. */
const spans = new Map();
export function timerSlotState(slot, endsAt, nowMs, totalMs = 0) {
  if (!slot) return;
  const live = Number(endsAt) > 0;
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (live && !spans.has(endsAt)) {
    if (spans.size > 32) spans.clear();
    spans.set(endsAt, Math.max(1, endsAt - now));
  }
  const left = live ? Math.max(0, endsAt - now) : 0;
  const total = Number(totalMs) || (live ? spans.get(endsAt) : 1);
  const secs = Math.ceil(left / 1000);
  slot.classList?.toggle('is-warn', live && secs > 5 && secs <= 10);
  slot.style?.setProperty?.('--gk-timer-left', live ? Math.max(0, Math.min(1, left / total)).toFixed(3) : '0');
}
