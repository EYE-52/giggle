'use strict';
/* Shared helpers for game modules: shuffling, rotation, timers, voting. */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/* Deal unique content items per room (no repeats until exhausted). */
function dealer(items) {
  let bag = shuffle(items);
  return function next() {
    if (!bag.length) bag = shuffle(items);
    return bag.pop();
  };
}

/* Majority/plurality winner from {pid: choice}. Returns {winners:[pid], counts}. */
function tally(votes) {
  const counts = {};
  for (const pid of Object.keys(votes)) {
    const c = votes[pid];
    counts[c] = counts[c] || { n: 0, who: [] };
    counts[c].n += 1;
    counts[c].who.push(pid);
  }
  let best = 0;
  const winners = [];
  for (const c of Object.keys(counts)) {
    if (counts[c].n > best) {
      best = counts[c].n;
      winners.length = 0;
      winners.push(c);
    } else if (counts[c].n === best) {
      winners.push(c);
    }
  }
  return { winners, counts, top: best };
}

function allIn(players, record) {
  return players.every((p) => record[p.id] !== undefined);
}

function names(players) {
  const m = {};
  for (const p of players) m[p.id] = p.name;
  return m;
}

/* Action-window token: identifies the current input window (phase + round /
 * index / turn coordinates) so stale timers and delayed actions from a
 * previous window can be dropped. Includes ONLY fields that change on
 * transitions — never votes, answers, entries, or other transient input, so
 * concurrent same-window actions share one token and all count. Games with
 * cycling turns in one phase (word-chain) add a monotonic turnNo. */
function actionWindow(state) {
  if (!state || typeof state !== 'object') return '{}';
  const w = {};
  if (state.phase !== undefined) w.phase = state.phase;
  if (state.round !== undefined) w.round = state.round;
  if (state.index !== undefined) w.index = state.index;
  if (state.turn !== undefined) w.turn = state.turn;
  if (state.turnIdx !== undefined) w.turnIdx = state.turnIdx;
  if (state.turnPid !== undefined) w.turnPid = state.turnPid;
  if (state.turnNo !== undefined) w.turnNo = state.turnNo;
  return JSON.stringify(w);
}

/* ---- Shared length and pace settings (specs/GAME_RULES_STANDARD.md) ----
 * Every game offers Rounds (when it has rounds) and Pace first, with the
 * same labels, so a night of mixed games reads the same everywhere:
 *
 *   manifest.settings: [roundsSetting({ def: 6 }), paceSetting(), ...own]
 *   const secs = paced(ctx, 30);          // 45 Relaxed, 30 Normal, 20 Quick
 *   ctx.later(paced(ctx, 30) * 1000, next);
 *
 * Pace multiplies EVERY timer (answer, vote, reveal…), rounded to whole
 * seconds and never below 3. Games may keep their own explicit timer
 * settings (for example "Seconds to draw"); Pace scales the rest. */
const PACE_OPTIONS = Object.freeze(['Relaxed', 'Normal', 'Quick']);
const PACE_FACTORS = Object.freeze({ Relaxed: 1.5, Normal: 1, Quick: 0.67 });
const PACE_MIN_SECONDS = 3;

/* Rounds: 1–12 by default. def null = "Auto" (the game's natural length,
 * e.g. one turn per player); pass autoLabel to say what Auto means. */
function roundsSetting(opts = {}) {
  const min = Number.isInteger(opts.min) ? opts.min : 1;
  const max = Number.isInteger(opts.max) ? opts.max : 12;
  const def = opts.def === undefined ? null : opts.def;
  const s = { key: 'rounds', label: 'Rounds', type: 'int', min, max, def };
  if (def === null) s.autoLabel = typeof opts.autoLabel === 'string' && opts.autoLabel ? opts.autoLabel : 'Auto';
  return s;
}

/* Pace: Relaxed / Normal (default) / Quick. */
function paceSetting(opts = {}) {
  const def = PACE_OPTIONS.includes(opts.def) ? opts.def : 'Normal';
  return { key: 'pace', label: 'Pace', type: 'enum', options: PACE_OPTIONS.slice(), def };
}

/* Accepts a ctx (reads ctx.settings()), a settings object, or a pace
 * name. Unknown or missing values mean Normal. */
function paceOf(settingsOrCtx) {
  let v = settingsOrCtx;
  if (v && typeof v === 'object' && typeof v.settings === 'function') {
    try { v = v.settings(); } catch { v = null; }
  }
  if (v && typeof v === 'object') v = v.pace;
  return PACE_OPTIONS.includes(v) ? v : 'Normal';
}

function paceFactor(settingsOrCtx) {
  return PACE_FACTORS[paceOf(settingsOrCtx)];
}

/* Whole seconds after Pace, never below 3. */
function paced(settingsOrCtx, seconds) {
  const base = Number(seconds);
  if (!Number.isFinite(base) || base <= 0) return PACE_MIN_SECONDS;
  return Math.max(PACE_MIN_SECONDS, Math.round(base * paceFactor(settingsOrCtx)));
}

/* Same as paced(), in milliseconds (for ctx.later / endsAt). */
function pacedMs(settingsOrCtx, seconds) {
  return paced(settingsOrCtx, seconds) * 1000;
}

/* Optional per-move timer for turn-based duels: Off (default), 30 or 60
 * seconds. moveSeconds() returns 0 for Off. */
const MOVE_TIMER_OPTIONS = Object.freeze(['Off', '30 seconds', '60 seconds']);
function moveTimerSetting(opts = {}) {
  const def = MOVE_TIMER_OPTIONS.includes(opts.def) ? opts.def : 'Off';
  return { key: 'moveTimer', label: 'Move timer', type: 'enum', options: MOVE_TIMER_OPTIONS.slice(), def };
}
function moveSeconds(settingsOrCtx) {
  let v = settingsOrCtx;
  if (v && typeof v === 'object' && typeof v.settings === 'function') {
    try { v = v.settings(); } catch { v = null; }
  }
  if (v && typeof v === 'object') v = v.moveTimer;
  return v === '30 seconds' ? 30 : v === '60 seconds' ? 60 : 0;
}

module.exports = {
  shuffle, pick, dealer, tally, allIn, names, actionWindow,
  PACE_OPTIONS, PACE_FACTORS, PACE_MIN_SECONDS, MOVE_TIMER_OPTIONS,
  roundsSetting, paceSetting, paceOf, paceFactor, paced, pacedMs,
  moveTimerSetting, moveSeconds,
};
