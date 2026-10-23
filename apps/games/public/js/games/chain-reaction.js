import { nameOf, countdown } from '../util.js';
import {
  applyArrival, applyBurstSource, applyPlacement, capacityAt, decideUpdate,
  boardsEqual, eventSeq, MAX_REPLAY_MS, neighborsOf, planTimings, replayTape,
} from '../engines/chain-visual.mjs';
import { createChainScene, displayPalette, shouldTranspose } from '../renderers/chain-scene.mjs';

/* Chain Reaction renderer: staged, server-faithful cascade replay.
 *
 * Authority always stays server-side. Each snapshot carries the final board
 * plus the last move's firing tape; this view replays placement, then every
 * burst with its traveling orbs and arrival captures in order, from the
 * currently displayed (consecutive) board. Anything unreplayable — a rematch,
 * a missed event, a truncated tape, reduced motion, no measurable layout —
 * renders the authoritative board instantly. The replay always settles by
 * copying the authoritative snapshot board, never its own arithmetic. */

const instances = new WeakMap();
let active = null;
const CSS = `
.chain-reaction{--cr-teal:#71edd1;--cr-coral:#ff718f;--cr-yellow:#ffd23d;--cr-well:var(--well,#2a2f3d);--cr-well-line:var(--line,#363c4d);--cr-well-play:var(--line-strong,#586078);--cr-focus:var(--accent,#da216c);color:var(--ink,#f0f3fa);max-width:100%;min-width:0;font-family:var(--font-body,"Nunito",system-ui,sans-serif);background:transparent}
.cr-head{display:flex;align-items:center;justify-content:center;gap:10px;margin:0 0 8px;min-width:0;text-align:center}
.cr-head-main{flex:0 1 auto;min-width:0;max-width:100%}
.cr-actor{display:flex;align-items:center;justify-content:center;gap:8px;min-width:0}
.cr-turn-mark{position:relative;flex:none;width:22px;height:22px}.cr-turn-mark .cr-orb{left:0;top:0;width:22px;height:22px}.cr-turn-mark[hidden]{display:none}
.cr-turn{flex:0 1 auto;min-width:0;margin:0;font-family:var(--font-body,inherit);font-size:20px;font-weight:800;line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60vw}
.cr-kicker{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.cr-clock{--cr-clock-bg:var(--card,#21242f);--cr-clock-ink:var(--accent,#da216c);--cr-clock-track:var(--line,#363c4d);--cr-time:100%;display:grid;place-items:center;box-sizing:border-box;flex:none;width:44px;height:44px;border:0;border-radius:50%;padding:0;background:radial-gradient(circle,var(--cr-clock-bg) 63%,transparent 64%),conic-gradient(var(--cr-clock-ink) var(--cr-time),var(--cr-clock-track) 0);color:var(--cr-clock-ink);font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;box-shadow:none}
.cr-clock[hidden]{display:none}.cr-clock.urgent{--cr-clock-ink:var(--melon,#ff7a80)}
.cr-replay{position:absolute;left:0;bottom:0;width:100%;height:44px;display:flex;align-items:center;justify-content:center;gap:8px;margin:0 0 8px;padding:0;border:0;background:transparent;box-shadow:none}
.cr-replay[hidden]{display:none}
.cr-progress{display:none}
.cr-skip{flex:none;min-height:44px;min-width:84px;padding:8px 16px;font:inherit;font-size:14px;font-weight:700;border:1px solid var(--line-strong,#586078);border-radius:10px;background:var(--card,#21242f);color:var(--ink,#f5f6fa);cursor:pointer;touch-action:manipulation;box-shadow:none}
.cr-skip:hover{border-color:var(--accent,#da216c)}.cr-skip:focus-visible{outline:3px solid var(--accent,#da216c);outline-offset:2px}
.cr-layout{display:flex;flex-direction:column;align-items:center;gap:8px;min-width:0}
.cr-board{position:relative;width:min(100%,calc((100dvh - 156px)*var(--cr-cols,6)/var(--cr-rows,8)));max-width:560px;box-sizing:border-box;margin:0 auto;min-width:calc(44px*var(--cr-cols,6));background:transparent;border:0;border-radius:0;box-shadow:none;padding:0}
.cr-arena{position:absolute;inset:0;width:100%;height:100%;display:block;border:0;padding:0}
.cr-grid{position:relative;z-index:2;display:grid;grid-template-columns:repeat(var(--cols),minmax(44px,1fr));gap:0;min-width:0}
.chain-reaction[data-transpose="yes"] .cr-grid{--cols:8}
.cr-flight{position:absolute;inset:0;pointer-events:none;z-index:5;overflow:visible}
.cr-fly{position:absolute;width:16px;height:16px;margin:-8px 0 0 -8px;transition-property:transform;transition-timing-function:linear;will-change:transform;z-index:6}
.cr-cell{position:relative;min-width:44px;min-height:44px;aspect-ratio:1;border:0;border-radius:50%;background:transparent;padding:0;display:grid;place-items:center;cursor:default;touch-action:manipulation;color:var(--ink,#f0f3fa);font:inherit;box-sizing:border-box}
.cr-cell[data-playable="yes"]{cursor:pointer}.cr-cell[data-playable="yes"]:hover{background:transparent}
.cr-cell[data-playable="yes"]:hover::after{content:'';position:absolute;inset:14%;border:2px solid var(--accent,#da216c);border-radius:50%;pointer-events:none}
.cr-cell:focus-visible{outline:3px solid var(--accent,#da216c);outline-offset:-4px;border-radius:50%;z-index:3}
.cr-cell.critical::before{content:'';position:absolute;inset:14%;border:1px solid var(--orb);border-radius:50%;opacity:.55;pointer-events:none}
.cr-cell.last::after{content:'';position:absolute;inset:8%;border:2px solid var(--sun,#f5c451);border-radius:50%;pointer-events:none}
.cr-cell.placed{animation:cr-pop .3s ease-out}
.cr-cell.bursting{animation:cr-flash .3s ease-out}
.cr-cell.arriving{animation:cr-land .25s ease-out}
.chain-reaction[data-scene="canvas"] .cr-cell{animation:none}
.chain-reaction[data-scene="canvas"] .cr-flight,.chain-reaction[data-scene="canvas"] .cr-cluster,.chain-reaction[data-scene="canvas"] .cr-total,.chain-reaction[data-scene="canvas"] .cr-cap{display:none}
.cr-cluster{width:70%;max-width:55px;aspect-ratio:1;position:relative;pointer-events:none}
.cr-orb{position:absolute;width:44%;aspect-ratio:1;box-sizing:border-box;left:28%;top:28%;border:2px solid color-mix(in srgb,var(--orb) 70%,#000);border-radius:50%;background:var(--orb);box-shadow:none}
.cr-orb::after{content:'';position:absolute;width:30%;height:30%;left:35%;top:35%;background:#ffffffe6;border-radius:50%}
.cr-orb.diamond::after{transform:rotate(45deg);border-radius:0}.cr-orb.square::after{border-radius:0}
.cr-orb.triangle::after{width:34%;height:30%;left:38%;top:40%;border-radius:0;clip-path:polygon(50% 0,100% 100%,0 100%)}
.cr-orb.star::after{width:35%;height:35%;left:37%;top:37%;border-radius:0;clip-path:polygon(50% 0,62% 34%,98% 35%,70% 58%,80% 95%,50% 73%,20% 95%,30% 58%,2% 35%,38% 34%)}
.cr-orb.cross::after{width:34%;height:34%;left:38%;top:38%;border-radius:0;clip-path:polygon(33% 0,67% 0,67% 33%,100% 33%,100% 67%,67% 67%,67% 100%,33% 100%,33% 67%,0 67%,0 33%,33% 33%)}
.cr-fly.cr-orb{width:20px;height:20px;margin:-10px 0 0 -10px}
.cr-fly::before{content:'';position:absolute;left:50%;top:50%;height:3px;width:27px;transform-origin:0 50%;transform:rotate(calc(var(--flight-angle) + 3.14159rad));background:var(--orb);border-radius:100%;opacity:.35;z-index:-1}
.cr-cluster.two .cr-orb:nth-child(1){left:4%;top:28%}.cr-cluster.two .cr-orb:nth-child(2){left:52%;top:28%}
.cr-cluster.three .cr-orb:nth-child(1){left:28%;top:2%}.cr-cluster.three .cr-orb:nth-child(2){left:3%;top:50%}.cr-cluster.three .cr-orb:nth-child(3){left:53%;top:50%}
.cr-cluster.four .cr-orb:nth-child(1){left:3%;top:3%}.cr-cluster.four .cr-orb:nth-child(2){left:53%;top:3%}.cr-cluster.four .cr-orb:nth-child(3){left:3%;top:53%}.cr-cluster.four .cr-orb:nth-child(4){left:53%;top:53%}
.cr-total{position:absolute;right:2px;bottom:0;font-size:16px;font-weight:800;border-radius:4px;background:var(--card,#21242f);color:var(--ink,#f5f6fa);padding:0 2px}
.cr-cap{position:absolute;right:4px;bottom:2px;font-size:12px;font-weight:800;color:var(--ink-dim,#a8b0c5)}
.cr-side{position:relative;min-width:0;width:100%;display:flex;flex-direction:column;align-items:center;gap:8px}
.cr-help{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.cr-seats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:0;padding:0;list-style:none;width:100%}
.cr-seat{min-width:0;max-width:100%;min-height:44px;padding:6px 10px;border:1px solid var(--line,#363c4d);border-radius:12px;background:var(--card,#21242f);display:flex;align-items:center;gap:8px}
.cr-seat.current{border-color:var(--accent,#da216c);background:var(--card,#21242f);box-shadow:inset 3px 0 0 var(--accent,#da216c)}
.cr-seat.out{opacity:.58}.cr-mark{position:relative;flex:none;width:20px;height:20px}.cr-mark .cr-orb{left:2px;top:2px;width:16px;height:16px}
.cr-seat>div{display:flex;align-items:baseline;gap:4px;min-width:0;flex:1}
.cr-name{flex:1;min-width:0;font-size:14px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:14ch;line-height:1.2}.cr-score{font-size:16px;font-weight:800;line-height:1.2;color:var(--ink-dim,#a8b0c5);white-space:nowrap;font-variant-numeric:tabular-nums}
.cr-note{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}.cr-rules{font-size:16px;line-height:1.5;border:0;padding:0;margin:0;text-align:center;max-width:100%}
.cr-rules summary{cursor:pointer;font-weight:700;min-height:44px;min-width:44px;display:inline-flex;align-items:center;justify-content:center;padding:6px 14px;border:1px solid var(--line,#363c4d);border-radius:10px;background:var(--card,#21242f);color:var(--ink,#f5f6fa);list-style:none}
.cr-rules summary::-webkit-details-marker{display:none}.cr-rules[open] summary{margin-bottom:8px}.cr-rules p{margin:0 0 8px;text-align:left;color:var(--ink,#f5f6fa)}
.cr-roster{font-size:14px;color:var(--ink-dim,#a8b0c5);text-align:left;margin:0 0 8px;overflow-wrap:anywhere}
.cr-result{border:1px solid var(--line,#363c4d);border-radius:12px;background:var(--card,#21242f);padding:12px;font-size:19px;font-weight:800;margin-bottom:12px;color:var(--ink,#f5f6fa)}
.cr-result[hidden]{display:none}

/* Field-first responsive HUD; semantic wells stay at least 44px. */
.chain-reaction{position:relative}
.chain-reaction[data-seats="2"] .cr-seats{grid-template-columns:repeat(2,minmax(0,1fr))}
[data-replaying="yes"] .cr-rules{visibility:hidden}.cr-side{max-width:560px}.cr-rules{position:relative}.cr-rules[open]{z-index:12;position:fixed;inset:64px max(12px,calc((100vw - 520px)/2)) 16px;max-width:none;max-height:calc(100dvh - 80px);overflow:auto;background:var(--card,#21242f);padding:14px;border:1px solid var(--line,#363c4d);border-radius:12px;text-align:left;box-shadow:var(--shadow-card,0 6px 22px #0003)}
.cr-rules[open]>div,.cr-rules[open]>p{padding:10px 14px;margin:0}
.chain-reaction[data-scene="dom"] .cr-cell{background:radial-gradient(circle,var(--cr-well) 46%,transparent 49%)}
.chain-reaction[data-scene="dom"] .cr-cell::before{content:'';position:absolute;inset:16%;border:1px solid var(--cr-well-line);border-radius:50%;pointer-events:none}
@media(min-width:820px){.cr-turn{font-size:22px;max-width:520px}}
@media(max-width:420px){.cr-head{padding-left:102px;justify-content:flex-end}.cr-actor{gap:5px}.cr-turn{font-size:16px;max-width:42vw}.cr-mark{width:16px;height:16px}.cr-mark .cr-orb{left:0;top:0}.cr-name{font-size:13px}.cr-seat{gap:4px;padding:3px 4px}}
@media(min-width:560px) and (max-height:500px){
.chain-reaction{height:calc(100dvh - 16px);display:grid;grid-template-columns:128px minmax(0,1fr);grid-template-rows:160px minmax(0,1fr);column-gap:8px}
.cr-head{grid-column:1;grid-row:1;align-self:start;margin:52px 0 0;flex-direction:column;gap:6px}
.cr-turn{font-size:16px;max-width:120px;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cr-turn-mark{width:16px;height:16px}.cr-turn-mark .cr-orb{width:16px;height:16px}.cr-actor{gap:4px}
.cr-clock{width:44px;height:44px;font-size:15px}.cr-layout{display:contents}
.cr-board{grid-column:2;grid-row:1/span 2;width:min(100%,calc((100dvh - 16px)*var(--cr-cols,8)/var(--cr-rows,6)));max-width:none}
.cr-side{grid-column:1;grid-row:2;align-self:end;gap:6px;width:128px;max-width:128px}
.cr-seats{grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}.cr-seat{padding:3px;gap:3px}.cr-seat>div{gap:3px}.cr-name{display:none}.cr-score{font-size:16px}
.cr-mark{width:16px;height:16px}.cr-mark .cr-orb{left:0;top:0}.cr-replay{position:absolute;left:0;bottom:0;z-index:11;max-width:128px;flex-direction:row;gap:0;margin:0;background:var(--bg,#171922)}.cr-progress{display:none}.cr-skip{padding:8px;font-size:14px}
.cr-rules[open]{position:fixed;inset:60px 12px 12px;max-width:none;background:var(--card,#21242f);padding:12px;overflow:auto;text-align:left;border:1px solid var(--line,#363c4d);border-radius:12px}
}
/* Phones: the same steady column as every board game (turn, players,
 * board, help). */
@media(max-width:759px) and (min-height:501px),(max-width:559px){
.chain-reaction{display:flex;flex-direction:column;gap:10px}
.cr-layout,.cr-side{display:contents}
.cr-head{order:0;min-height:44px;margin:0;padding-left:104px;justify-content:space-between;text-align:left}
.cr-actor{justify-content:flex-start}
.cr-turn{white-space:normal;max-width:none;font-size:16px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.cr-seats{order:1}
.chain-reaction[data-seats="2"] .cr-seats,.cr-seats{grid-template-columns:repeat(2,minmax(0,1fr))}
.cr-board{order:2}
.cr-rules{order:4;align-self:center}
.cr-replay{order:3;position:static}
}
/* Wide frames: the same board + side panel layout as every board game. */
@media(min-width:760px) and (min-height:501px){
.chain-reaction{display:grid;grid-template-columns:minmax(0,1fr) 296px;grid-template-rows:auto auto 1fr;column-gap:20px;row-gap:12px;align-items:start;min-height:calc(100dvh - 24px)}
.cr-layout{display:contents}
.cr-board{grid-column:1;grid-row:1/span 3;align-self:center;width:min(100%,calc((100dvh - 32px)*var(--cr-cols,6)/var(--cr-rows,8)));max-width:none}
.cr-head{grid-column:2;grid-row:1;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:10px;margin:0;text-align:left}
.cr-kicker{position:static;width:auto;height:auto;margin:0;overflow:visible;clip:auto;white-space:normal;font-size:0;color:var(--ink,#f5f6fa)}
.cr-kicker::before{content:"Chain Reaction";display:block;font:800 26px/1.2 var(--font-display,inherit)}
.cr-round{display:block;font:400 13px/1.4 var(--font-body,inherit);color:var(--ink-dim,#a8b0c5)}
.cr-head-main{display:flex;flex-direction:column;gap:10px}
.cr-actor{justify-content:flex-start;min-height:3em;padding:10px 12px;border-radius:12px;background:var(--well,#2a2f3d)}
.cr-turn{white-space:normal;font-size:16px;max-width:none}
.cr-clock{align-self:flex-start}
.cr-side{grid-column:2;grid-row:2;align-items:stretch;max-width:none}
.cr-seats{grid-template-columns:minmax(0,1fr)!important;gap:8px}
.cr-name{max-width:none}
.cr-rules{text-align:left}.cr-rules summary{width:100%;justify-content:flex-start}
.cr-replay{position:static;height:auto;margin:0}
}
@keyframes cr-pop{40%{transform:scale(.86)}70%{transform:scale(1.05)}}@keyframes cr-flash{0%{box-shadow:0 0 0 0 var(--orb)}100%{box-shadow:0 0 0 10px transparent}}@keyframes cr-land{0%{transform:scale(1.12)}100%{transform:scale(1)}}
@media(prefers-reduced-motion:reduce){.chain-reaction *,.chain-reaction *::after{animation:none!important;transition:none!important}}
`;

function now(d) {
  return typeof d.api.now === 'function' ? d.api.now() : Date.now();
}

function prefersReducedMotion() {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/* Travelers need real cell geometry; without it the update still settles
 * instantly on the authoritative board. */
function canMeasure(d) {
  try {
    const board = d.el.querySelector('.cr-board');
    return !!(board && d.cells.length &&
      typeof board.getBoundingClientRect === 'function' &&
      typeof d.cells[0].getBoundingClientRect === 'function' &&
      d.cells[0].getBoundingClientRect().width > 0);
  } catch {
    return false;
  }
}

/* Arena scene helpers: presentation only, never gameplay authority. Every
 * scene call is guarded: stripped imports (tests) or a missing canvas/2D
 * context resolve to the semantic DOM fallback without touching replay. */
function displayStyleFor(S, seat) {
  const raw = (S.palette && S.palette[Math.max(0, seat)]) || { color: '#ffffff', shape: 'circle', label: '' };
  try {
    if (typeof displayPalette === 'function' && Array.isArray(S.palette)) {
      const mapped = displayPalette(S.palette, S.paletteName);
      if (mapped[Math.max(0, seat)]) return mapped[Math.max(0, seat)];
    }
  } catch { /* fall through to the authoritative palette entry */ }
  return raw;
}

function isTransposed(S) {
  try {
    if (typeof shouldTranspose === 'function') return shouldTranspose(S.cols, S.rows);
    if (S.cols === 6 && S.rows === 8 && typeof matchMedia === 'function') {
      return !!matchMedia('(min-width:560px) and (max-height:500px)').matches;
    }
  } catch { /* visual transpose needs measurable media */ }
  return false;
}

/* Short-landscape Standard: logical (x,y) shows at visual col=y, row=x in an
 * 8x6 matrix. Logical data-cell and actions never change; arrow navigation follows the displayed wells. */
function visualOrderFor(i, S) {
  const x = i % S.cols, y = Math.floor(i / S.cols);
  return x * 8 + y;
}

function applyTranspose(d) {
  const S = d.state;
  if (!S || !d.cells.length) return false;
  const t = isTransposed(S);
  try {
    const grid = d.el.querySelector('.cr-grid');
    if (grid && grid.style && typeof grid.style.setProperty === 'function') {
      grid.style.setProperty('--cols', t ? 8 : S.cols);
    }
    const root = d.el.querySelector('.chain-reaction');
    if (root && root.dataset) root.dataset.transpose = t ? 'yes' : 'no';
    if (root && root.style) {
      root.style.setProperty('--cr-cols', t ? S.rows : S.cols);
      root.style.setProperty('--cr-rows', t ? S.cols : S.rows);
    }
    for (let i = 0; i < d.cells.length; i++) {
      if (d.cells[i] && d.cells[i].style) d.cells[i].style.order = t ? String(visualOrderFor(i, S)) : '';
    }
  } catch { /* visual order is cosmetic */ }
  if (d.scene && !d.scene.fallback && typeof d.scene.resize === 'function') {
    try { d.scene.resize(undefined, undefined, { transpose: t, cols: S.cols, rows: S.rows }); } catch { /* ignore */ }
  }
  return t;
}

function ensureScene(d) {
  if (d.scene || !d.state) return d.scene || null;
  try {
    if (typeof createChainScene !== 'function') return null;
    const canvas = d.el.querySelector('.cr-arena');
    if (!canvas) return null;
    const S = d.state;
    d.scene = createChainScene(canvas, {
      cols: S.cols, rows: S.rows,
      palette: S.palette, paletteName: S.paletteName, order: S.order,
      transpose: isTransposed(S),
      reducedMotion: prefersReducedMotion(),
      dimmed: S.spectator === true,
    });
    const root = d.el.querySelector('.chain-reaction');
    if (root && root.dataset) root.dataset.scene = d.scene && !d.scene.fallback ? 'canvas' : 'dom';
  } catch {
    d.scene = null;
  }
  return d.scene;
}

/* Sync the canvas to the newest displayed board after every DOM patch. */
function syncScene(d) {
  if (!d.state || !d.shown) return;
  const scene = d.scene || ensureScene(d);
  if (!scene || scene.fallback || typeof scene.setBoard !== 'function') return;
  try {
    const S = d.state;
    const playable = [];
    for (let i = 0; i < d.shown.length; i++) {
      if (canPlay(d, i)) playable.push(i);
    }
    scene.setBoard(d.shown, {
      palette: S.palette, paletteName: S.paletteName, order: S.order,
      playable, focus: d.focusIndex ?? null, dimmed: S.spectator === true,
      transpose: isTransposed(S), cols: S.cols, rows: S.rows,
      reducedMotion: prefersReducedMotion(),
    });
  } catch { /* scene sync must never break replay */ }
}

function paintClock(d) {
  if (!d.state) return;
  const clock = d.el.querySelector('.cr-clock');
  // Move timer Off: no deadline, no clock.
  clock.hidden = d.replaying || d.state.preparing || d.state.phase !== 'play' || !(d.state.endsAt > 0);
  if (!(d.state.endsAt > 0)) return;
  const left = countdown(d.state.endsAt, now(d));
  clock.style.setProperty('--cr-time', Math.max(0, Math.min(100, left / Math.max(1, d.state.turnSeconds || 30) * 100)) + '%');
  clock.textContent = left + 's';
  clock.classList.toggle('urgent', left <= 5);
  clock.setAttribute('aria-label', left + (left === 1 ? ' second' : ' seconds') + ' left in this turn');
}

function shownBoard(d) {
  return d.shown || (d.state ? d.state.board : []);
}

function liveCounts(d) {
  const s = d.state;
  const counts = Object.fromEntries(s.order.map((id) => [id, 0]));
  for (const cell of shownBoard(d)) {
    if (cell.owner && counts[cell.owner] !== undefined) counts[cell.owner] += cell.orbs;
  }
  return counts;
}

function canPlay(d, index) {
  const s = d.state;
  if (!s || s.preparing || d.replaying || !d.shown) return false;
  return s.phase === 'play' && !s.spectator && s.turnPid === s.you &&
    d.pendingTurn !== s.turnNo && index >= 0 && index < d.shown.length &&
    (d.shown[index].owner === null || d.shown[index].owner === s.you);
}

function play(d, index) {
  if (!canPlay(d, index) || (d.state.endsAt > 0 && now(d) >= d.state.endsAt)) return;
  const s = d.state;
  d.pendingTurn = s.turnNo; // one intent, even if a finger double taps
  d.api.send({ x: index % s.cols, y: Math.floor(index / s.cols), turnNo: s.turnNo });
  patchCells(d);
  updateTexts(d); // pending feedback only; turn token/action schema unchanged
}

function paintCell(d, b, cell, i) {
  const s = d.state;
  const seat = s.order.indexOf(cell.owner);
  const style = displayStyleFor(s, seat);
  const x = i % s.cols, y = Math.floor(i / s.cols);
  const capacity = capacityAt(s.cols, s.rows, i);
  const key = cell.owner + ':' + cell.orbs;
  if (b.dataset.content !== key) {
    b.dataset.content = key;
    b.replaceChildren();
    b.style.setProperty('--orb', style.color);
    if (cell.orbs) {
      const cluster = document.createElement('span');
      cluster.className = 'cr-cluster' + (cell.orbs > 1 ? ' multiple' : '') +
        (cell.orbs === 2 ? ' two' : cell.orbs === 3 ? ' three' : cell.orbs >= 4 ? ' four' : '');
      cluster.setAttribute('aria-hidden', 'true');
      for (let n = 0; n < Math.min(4, cell.orbs); n++) {
        const orb = document.createElement('i');
        orb.className = 'cr-orb ' + style.shape;
        cluster.appendChild(orb);
      }
      b.appendChild(cluster);
      if (cell.orbs > 4) {
        const count = document.createElement('span');
        count.className = 'cr-total'; count.textContent = String(cell.orbs);
        b.appendChild(count);
      }
    } else {
      const cap = document.createElement('span');
      cap.className = 'cr-cap'; cap.textContent = String(capacity);
      cap.setAttribute('aria-hidden', 'true'); b.appendChild(cap);
    }
  }
  b.dataset.playable = canPlay(d, i) ? 'yes' : 'no';
  b.setAttribute('aria-disabled', b.dataset.playable === 'no' ? 'true' : 'false');
  b.classList.toggle('critical', cell.orbs === capacity - 1);
  b.classList.toggle('last', s.lastEvent?.kind === 'move' && s.lastEvent.x === x && s.lastEvent.y === y);
  b.setAttribute('aria-label', `Row ${y + 1}, column ${x + 1}: ` +
    (cell.orbs ? nameOf(s, cell.owner) + ', ' + style.label + ', ' + cell.orbs + (cell.orbs === 1 ? ' orb. ' : ' orbs. ') : 'Empty. ') +
    `Bursts at ${capacity}.` + (canPlay(d, i) ? ' Add an orb.' : ''));
}

function patchCells(d) {
  const shown = shownBoard(d);
  for (let i = 0; i < d.cells.length; i++) {
    paintCell(d, d.cells[i], shown[i] || { owner: null, orbs: 0 }, i);
  }
  syncScene(d);
}

function paintActorMark(d, pid) {
  const mark = d.el.querySelector('.cr-turn-mark');
  if (!mark) return;
  const S = d.state;
  const seat = typeof pid === 'string' ? S.order.indexOf(pid) : -1;
  const style = seat >= 0 && S.palette[seat] ? displayStyleFor(S, seat) : null;
  if (!style) {
    mark.replaceChildren();
    mark.hidden = true;
    return;
  }
  mark.hidden = false;
  mark.style.setProperty('--orb', style.color);
  const key = seat + ':' + style.shape;
  if (mark.dataset.actor === key && mark.children && mark.children.length) return;
  mark.dataset.actor = key;
  mark.replaceChildren();
  const orb = document.createElement('i');
  orb.className = 'cr-orb ' + style.shape;
  mark.appendChild(orb);
}

function updateTexts(d) {
  const S = d.state, el = d.el;
  try {
    const root = el.querySelector('.chain-reaction');
    if (root && root.dataset) {
      root.dataset.spectator = S.spectator === true ? 'yes' : 'no';
      root.dataset.seats = String(S.order.length);
      if (!root.dataset.scene) root.dataset.scene = 'dom';
    }
    const roster = el.querySelector('.cr-roster');
    if (roster) roster.textContent = 'At the reactor: ' + S.order.map((id) => nameOf(S, id)).join(' · ');
    if (d.scene && !d.scene.fallback && typeof d.scene.setDimmed === 'function') {
      d.scene.setDimmed(S.spectator === true);
    }
  } catch { /* arena chrome is cosmetic */ }
  const mine = !S.spectator && S.mySeat >= 0;
  const out = mine && S.eliminated.includes(S.you);
  const current = nameOf(S, S.turnPid);
  const reacting = d.replaying && d.replayCtx.tape.length > 0;
  const pending = !d.replaying && S.phase === 'play' && d.pendingTurn === S.turnNo && S.turnPid === S.you;
  el.querySelector('.cr-round').textContent = d.replaying ? reacting ? 'Atoms in motion' : 'Orb placed' : S.phase === 'done' ? 'Final board' : 'Turn ' + S.turnNo;
  const title = !d.replaying && S.preparing ? 'Getting the table ready…' : d.replaying ? reacting ? nameOf(S, d.replayCtx.pid) + ' set it off!' : 'One more orb…' : S.phase === 'done'
    ? S.result.winner ? nameOf(S, S.result.winner) + ' wins' : 'Match over'
    : !mine ? 'Watching · ' + current + '’s turn'
    : out ? 'You’re out · ' + current + '’s turn'
    : pending ? 'Atom placed' : S.turnPid === S.you ? 'Your turn' : current + '’s turn';
  const heading = el.querySelector('.cr-turn');
  if (heading.textContent !== title) heading.textContent = title;
  heading.setAttribute('title', title === 'Your turn' ? title + ' · ' + current : title);
  heading.setAttribute('aria-label', title === 'Your turn' ? title + ', ' + current : title);
  const markPid = d.replaying ? d.replayCtx.pid : S.phase === 'done' ? (S.result ? S.result.winner : null) : S.turnPid;
  paintActorMark(d, markPid);
  const result = el.querySelector('.cr-result'); result.hidden = d.replaying || S.phase !== 'done';
  if (S.result) result.textContent = S.result.detail + ' Use Rematch to play again.';
  el.querySelector('.cr-help').textContent = d.replaying ? reacting ? 'Atoms in motion — each burst captures its neighbors.' : 'The next turn opens when the atom lands.' : S.phase === 'done' ? 'Settled. Rematch from the table when ready.'
    : !mine ? 'Only seated players place atoms.'
    : out ? 'Watch the remaining atoms.'
    : pending ? 'Placed. Waiting for the room…'
    : S.turnPid === S.you ? 'Place an atom on an empty or owned cell.'
    : 'Plan your next burst.';
  const counts = liveCounts(d);
  for (const { id, li, name, score } of d.seats) {
    name.textContent = nameOf(S, id);
    const seat = S.order.indexOf(id);
    const gone = !d.replaying && S.eliminated.includes(id);
    const atoms = counts[id] + (counts[id] === 1 ? ' atom' : ' atoms');
    li.setAttribute('aria-label', nameOf(S, id) + (id === S.you ? ', you' : '') + ', ' + S.palette[seat].label + ', ' + (gone ? 'eliminated' : atoms + (!S.entered[id] ? ', first turn coming' : '')));
    li.setAttribute('title', nameOf(S, id) + ' · ' + (gone ? 'Out' : atoms));
    score.textContent = gone ? 'Out' : String(counts[id]);
    li.classList.toggle('current', id === (d.replaying ? d.replayCtx.pid : S.turnPid));
    li.classList.toggle('out', !d.replaying && S.eliminated.includes(id));
  }
  // During a replay the note keeps its single announcement; per-burst
  // progress stays on the aria-hidden progress line.
  if (d.replaying) return;
  const note = el.querySelector('.cr-note');
  const away = (S.players || []).find((p) => p.id === S.turnPid && p.connected === false);
  const steps = S.lastCascade ? S.lastCascade.steps : 0;
  note.textContent = S.phase === 'done' ? 'Settled.'
    : away ? current + ' is away. Their turn skips when the timer ends.'
    : S.lastEvent?.kind === 'timeout' ? nameOf(S, S.lastEvent.pid) + ' missed a turn — the game keeps moving.'
    : steps ? steps + (steps === 1 ? ' burst' : ' bursts') + ' last turn.'
    : !S.order.every((id) => S.entered[id]) ? 'Everyone gets a first turn before elimination.' : 'Keep at least one atom to stay in.';
}

/* ---- Replay plumbing: one chained timer at a time, no snapshot history. ---- */

function later(d, fn, ms) {
  const generation = d.replayGeneration;
  const id = setTimeout(() => {
    d.replayTimers.delete(id);
    if (d.disposed || generation !== d.replayGeneration) return;
    fn();
  }, ms);
  d.replayTimers.add(id);
  return id;
}

function clearReplayTimers(d) {
  for (const t of d.replayTimers) {
    try { clearTimeout(t); } catch { /* teardown must never throw */ }
  }
  d.replayTimers.clear();
  if (d.frame) {
    try { cancelAnimationFrame(d.frame); } catch { /* teardown must never throw */ }
    d.frame = 0;
  }
}

function clearFlyers(d) {
  try {
    const flight = d.el.querySelector('.cr-flight');
    if (flight) flight.replaceChildren();
  } catch { /* teardown must never throw */ }
}

function clearAnimClasses(d) {
  for (const b of d.cells) {
    b.classList.remove('bursting');
    b.classList.remove('arriving');
    b.classList.remove('placed');
  }
}

function hideReplayBar(d) {
  const bar = d.el.querySelector('.cr-replay');
  if (bar) bar.hidden = true;
}

function paintProgress(d, done, total) {
  const p = d.el.querySelector('.cr-progress');
  if (p) p.textContent = total ? 'Reacting…' : 'Placing atom…';
}

function signalReplay(d) {
  d.el.dataset.replaying = d.replaying ? 'yes' : 'no';
  d.el.querySelector('.cr-grid')?.setAttribute('aria-busy', String(d.replaying));
  if (d.notifiedReplaying === d.replaying) return;
  d.notifiedReplaying = d.replaying;
  if (typeof CustomEvent === 'function' && typeof d.el.dispatchEvent === 'function') {
    d.el.dispatchEvent(new CustomEvent('chain-replay', { detail: { active: d.replaying } }));
  }
}

function cancelReplay(d) {
  d.replayGeneration += 1;
  d.replaying = false;
  d.motionEndsAt = 0;
  d.replayCtx = null;
  clearReplayTimers(d);
  clearFlyers(d);
  clearAnimClasses(d);
  try { if (d.scene && !d.scene.fallback) d.scene.clearEphemeral(); } catch { /* cosmetic */ }
  hideReplayBar(d);
}

/* Authoritative settle: the displayed board becomes a copy of the snapshot
 * board. Intermediate replay arithmetic never survives this step. */
function settleTo(d, S) {
  cancelReplay(d);
  d.shown = S.board.map((c) => ({ owner: c.owner, orbs: c.orbs }));
  d.lastSeq = eventSeq(S);
  d.lastInstance = S.instanceId;
  patchCells(d);
  updateTexts(d);
  signalReplay(d);
}

function skipReplay(d) {
  if (!d.replaying || !d.state) return;
  settleTo(d, d.state);
  paintClock(d);
}

/* One orb dot per orthogonal neighbor, flown from the source cell center to
 * each destination center. Returns false when anything is unmeasurable, in
 * which case the caller lands the arrivals immediately. */
function spawnFlyers(d, src, dsts, pid, travelMs) {
  try {
    const s = d.state;
    const seat = s.order.indexOf(pid);
    const style = displayStyleFor(s, seat);
    const flight = d.el.querySelector('.cr-flight');
    if (!flight) return false;
    const boardRect = flight.getBoundingClientRect();
    const srcRect = d.cells[src].getBoundingClientRect();
    if (!boardRect || !srcRect) return false;
    const sx = srcRect.left + srcRect.width / 2 - boardRect.left;
    const sy = srcRect.top + srcRect.height / 2 - boardRect.top;
    flight.replaceChildren();
    const jobs = [];
    for (const n of dsts) {
      const r = d.cells[n].getBoundingClientRect();
      if (!r) continue;
      const dot = document.createElement('span');
      dot.className = 'cr-fly cr-orb ' + style.shape;
      dot.style.setProperty('--orb', style.color);
      dot.style.left = sx + 'px';
      dot.style.top = sy + 'px';
      dot.style.setProperty('--flight-angle', Math.atan2(r.top - srcRect.top, r.left - srcRect.left) + 'rad');
      flight.appendChild(dot);
      jobs.push([dot, r.left + r.width / 2 - boardRect.left - sx, r.top + r.height / 2 - boardRect.top - sy]);
    }
    if (!jobs.length) return false;
    try {
      if (d.scene && !d.scene.fallback && typeof d.scene.onFlight === 'function') {
        d.scene.onFlight(src, dsts, style.color, travelMs, style.shape);
      }
    } catch { /* canvas trail is cosmetic; DOM dots carry the motion */ }
    const generation = d.replayGeneration;
    const launch = () => {
      if (d.disposed || generation !== d.replayGeneration) return;
      d.frame = 0;
      for (const [dot, dx, dy] of jobs) {
        try {
          dot.style.transitionDuration = Math.max(0, travelMs) + 'ms';
          dot.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        } catch { /* a lost dot must not stall the replay */ }
      }
    };
    if (typeof requestAnimationFrame === 'function') {
      if (d.frame) {
        try { cancelAnimationFrame(d.frame); } catch { /* continue */ }
      }
      d.frame = requestAnimationFrame(launch);
    } else {
      launch();
    }
    return true;
  } catch {
    return false;
  }
}

function finishReplay(d) {
  const latest = d.state;
  cancelReplay(d);
  if (!latest) return;
  if (eventSeq(latest) === d.lastSeq) {
    // The animated event is still the latest: snap to its authoritative end.
    d.shown = latest.board.map((c) => ({ owner: c.owner, orbs: c.orbs }));
    patchCells(d);
    updateTexts(d);
    paintClock(d);
    signalReplay(d);
    return;
  }
  // A newer event arrived mid-replay; route it through the same decision.
  routeUpdate(d);
}

function runStage(d, i) {
  if (!d.replaying || !d.replayCtx || !d.state) return;
  const ctx = d.replayCtx;
  if (i >= ctx.tape.length) {
    // The last arrivals/shock rings finish before the clock, result bridge
    // and next legal input open. Long tapes retain the same bounded pacing.
    const remaining = Math.max(0, d.motionEndsAt - Date.now());
    if (remaining) later(d, () => finishReplay(d), remaining);
    else finishReplay(d);
    return;
  }
  const src = ctx.tape[i];
  const cap = capacityAt(ctx.cols, ctx.rows, src);
  if (!d.shown[src] || d.shown[src].orbs < cap) {
    // Baseline drift must never paint a wrong board: settle authoritatively.
    settleTo(d, d.state);
    paintClock(d);
    return;
  }
  const dsts = neighborsOf(ctx.cols, ctx.rows, src);
  paintProgress(d, i + 1, ctx.tape.length);
  // The source bursts now; arrivals land after the visible flight.
  d.shown = applyBurstSource(d.shown, ctx.cols, ctx.rows, src, ctx.pid);
  patchCells(d);
  if (d.cells[src]) d.cells[src].classList.add('bursting');
  d.motionEndsAt = Math.max(d.motionEndsAt, Date.now() + 380);
  try { if (d.scene && !d.scene.fallback) d.scene.onBurst(src, ctx.pid); } catch { /* cosmetic */ }
  if (!ctx.quiet) d.api.cue?.('burst', { id: `${d.lastInstance}:${d.lastSeq}:burst:${i}`, gain: 0.75 });
  // Schedule against the original clock: layout and late timers must not
  // add a fresh delay to every firing in a long chain.
  const stageEndsAt = ctx.startsAt + ctx.placeMs + (i + 1) * ctx.stageMs;
  const travelMs = Math.min(ctx.travelMs, Math.max(0, stageEndsAt - Date.now()));
  const arrivalAt = Date.now() + travelMs;
  const flown = travelMs > 0 && spawnFlyers(d, src, dsts, ctx.pid, travelMs);
  later(d, () => {
    if (!d.replaying) return;
    for (const n of dsts) d.shown = applyArrival(d.shown, n, ctx.pid);
    patchCells(d);
    updateTexts(d);
    for (const n of dsts) {
      if (d.cells[n]) d.cells[n].classList.add('arriving');
    }
    d.motionEndsAt = Math.max(d.motionEndsAt, Date.now() + 250);
    try { if (d.scene && !d.scene.fallback) d.scene.onArrival(dsts, ctx.pid); } catch { /* cosmetic */ }
    clearFlyers(d);
    if (d.cells[src]) d.cells[src].classList.remove('bursting');
    paintProgress(d, i + 1, ctx.tape.length);
    later(d, () => {
      if (!d.replaying) return;
      if (i + 1 < ctx.tape.length) for (const n of dsts) {
        if (d.cells[n]) d.cells[n].classList.remove('arriving');
      }
      runStage(d, i + 1);
    }, Math.max(0, stageEndsAt - Date.now()));
  }, flown ? Math.max(0, arrivalAt - Date.now()) : 0);
}

function startReplay(d, S) {
  cancelReplay(d);
  const cols = S.cols, rows = S.rows;
  const c = S.lastCascade || {};
  const pid = c.pid;
  const place = Number.isInteger(c.x) && Number.isInteger(c.y) ? c.y * cols + c.x : -1;
  const tape = Array.isArray(c.tape) ? c.tape : null;
  if (!d.shown || typeof pid !== 'string' || !tape ||
      place < 0 || place >= d.shown.length || place >= S.board.length) {
    settleTo(d, d.state);
    return;
  }
  try {
    if (!boardsEqual(replayTape(d.shown, cols, rows, place, pid, tape), S.board)) {
      settleTo(d, S); return;
    }
  } catch { settleTo(d, S); return; }
  const t = planTimings(tape.length, { reducedMotion: false });
  d.replaying = true;
  d.replayCtx = { tape, pid, cols, rows, stageMs: t.stageMs, travelMs: t.travelMs,
    startsAt: Date.now(), placeMs: t.placeMs + 30, quiet: S.audioBaseline === true };
  d.lastSeq = eventSeq(S);
  d.lastInstance = S.instanceId;
  patchCells(d);
  updateTexts(d);
  signalReplay(d);
  const bar = d.el.querySelector('.cr-replay');
  if (bar) bar.hidden = false;
  paintProgress(d, 0, tape.length);
  const note = d.el.querySelector('.cr-note');
  if (note) {
    note.textContent = tape.length
      ? 'Chain reaction. ' + tape.length + (tape.length === 1 ? ' burst.' : ' bursts.')
      : 'Orb placed.';
  }
  // Placement lands first, visibly, before any burst runs.
  // Browser timer clamping or a suspended tab must never hold the next turn.
  // Ordinary chains finish their full tape; an extreme delay settles safely.
  later(d, () => { if (d.replaying) skipReplay(d); }, MAX_REPLAY_MS + 1000);
  later(d, () => {
    if (!d.replaying) return;
    d.shown = applyPlacement(d.shown, place, pid);
    patchCells(d);
    updateTexts(d);
    if (d.cells[place]) d.cells[place].classList.add('placed');
    d.motionEndsAt = Date.now() + 300;
    try { if (d.scene && !d.scene.fallback) d.scene.onPlacement(place); } catch { /* cosmetic */ }
    if (!d.replayCtx.quiet) d.api.cue?.('place', { id: `${d.lastInstance}:${d.lastSeq}:place`, gain: 0.7 });
    later(d, () => {
      if (!d.replaying) return;
      if (d.replayCtx.tape.length && d.cells[place]) d.cells[place].classList.remove('placed');
      runStage(d, 0);
    }, t.placeMs);
  }, 30);
}

function routeUpdate(d) {
  const S = d.state;
  if (!S) return;
  // A seat already in the background receives later turns without another
  // visibilitychange. Settle those boards before the frame acknowledges them.
  if (document.hidden) { settleTo(d, S); return; }
  if (!d.shown || d.lastInstance === null || S.instanceId !== d.lastInstance) {
    // First paint, rematch, or instance reset: authoritative board at once.
    settleTo(d, S);
    return;
  }
  const c = S.lastCascade || {};
  const place = Number.isInteger(c.x) && Number.isInteger(c.y) ? c.y * S.cols + c.x : -1;
  const decision = decideUpdate({
    snapSeq: eventSeq(S),
    snapInstance: S.instanceId,
    lastSeq: d.lastSeq === null || d.lastSeq === undefined ? -1 : d.lastSeq,
    lastInstance: d.lastInstance,
    replaying: d.replaying,
    truncated: c.truncated === true,
    kind: S.lastEvent ? S.lastEvent.kind : null,
    reducedMotion: prefersReducedMotion(),
    measurable: canMeasure(d),
    tape: c.tape,
    cellCount: S.board.length,
    place,
    pid: c.pid,
  });
  if (decision.action === 'ignore') {
    if (!d.replaying) patchCells(d);
    updateTexts(d);
    return;
  }
  if (decision.action === 'instant') {
    settleTo(d, S);
    return;
  }
  if (decision.action === 'queue') {
    // d.state already holds the newest snapshot; finishReplay re-routes it.
    updateTexts(d);
    return;
  }
  startReplay(d, S);
}

const view = {
  ownsTimer: true,
  mount(el, api) {
    if (active) this.dispose(active.el);
    const style = document.createElement('style');
    style.textContent = CSS; document.head.appendChild(style);
    el.innerHTML = `<section class="chain-reaction">
      <div class="cr-head"><div class="cr-head-main"><div class="cr-kicker">Chain Reaction · <span class="cr-round"></span></div><div class="cr-actor"><span class="cr-turn-mark" aria-hidden="true"></span><h2 class="cr-turn" role="status" aria-live="polite"></h2></div></div><div class="cr-clock"></div></div>
      <div class="cr-result" role="status" hidden></div>
      <div class="cr-layout"><div class="cr-board"><canvas class="cr-arena" aria-hidden="true"></canvas><div class="cr-grid" role="group" aria-label="Chain Reaction board"></div><div class="cr-flight" aria-hidden="true"></div></div>
        <aside class="cr-side"><div class="cr-replay" hidden><span class="cr-progress" aria-hidden="true"></span><button class="cr-skip" type="button" aria-label="Finish animation">Finish</button></div><p class="cr-help"></p><ul class="cr-seats" aria-label="Players and orb counts"></ul><p class="cr-note" aria-live="polite"></p>
          <details class="cr-rules"><summary>Help</summary><div class="cr-roster"></div><p>Corners burst at <b>2</b>, edges at <b>3</b>, inner cells at <b>4</b>. Each burst sends one atom to every neighbor and captures it.</p><p>Everyone gets one turn before elimination. Lose all atoms and you’re out; last owner wins. Missed turns skip.</p><p>Atoms have color and shape. Arrows explore; Enter or Space places.</p></details>
        </aside></div></section>`;
    const d = { el, api, state: null, shown: null, cells: [], seats: [], key: '',
      pendingTurn: null, frame: 0, interval: 0, listeners: [], style,
      replaying: false, notifiedReplaying: null, replayCtx: null, replayTimers: new Set(), replayGeneration: 0, motionEndsAt: 0, disposed: false, lastSeq: null, lastInstance: null,
      retiredInstances: new Set(), scene: null, focusIndex: null };
    const listen = (target, event, fn) => {
      target.addEventListener(event, fn); d.listeners.push([target, event, fn]);
    };
    const grid = el.querySelector('.cr-grid');
    listen(grid, 'click', (e) => {
      const cell = e.target.closest('[data-cell]');
      if (cell && grid.contains(cell)) play(d, Number(cell.dataset.cell));
    });
    listen(grid, 'keydown', (e) => {
      if (!d.state || !e.target.dataset.cell) return;
      const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      let delta = offsets[e.key]; if (!delta) return;
      if (isTransposed(d.state)) delta = [delta[1], delta[0]];
      const i = Number(e.target.dataset.cell), s = d.state;
      const x = i % s.cols + delta[0], y = Math.floor(i / s.cols) + delta[1];
      if (x >= 0 && x < s.cols && y >= 0 && y < s.rows) {
        e.preventDefault(); d.cells[y * s.cols + x].focus();
      }
    });
    const skip = el.querySelector('.cr-skip');
    if (skip) listen(skip, 'click', () => skipReplay(d));
    /* Focus light lives on the container so grid keeps exactly its
     * click/keyboard delegation; the canvas well lights with the button. */
    listen(el, 'focusin', (e) => {
      try {
        const cell = e.target && e.target.closest ? e.target.closest('[data-cell]') : null;
        d.focusIndex = cell ? Number(cell.dataset.cell) : null;
        if (d.scene && !d.scene.fallback) d.scene.setFocus(d.focusIndex);
      } catch { /* focus light is cosmetic */ }
    });
    listen(el, 'focusout', () => {
      d.focusIndex = null;
      try { if (d.scene && !d.scene.fallback) d.scene.setFocus(null); } catch { /* ignore */ }
    });
    if (typeof matchMedia === 'function') {
      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      if (typeof motion.addEventListener === 'function') listen(motion, 'change', () => { if (motion.matches) skipReplay(d); syncScene(d); });
      try {
        const landscape = matchMedia('(min-width:560px) and (max-height:500px)');
        if (landscape && typeof landscape.addEventListener === 'function') {
          listen(landscape, 'change', () => { applyTranspose(d); syncScene(d); });
        }
      } catch { /* static layout without media queries */ }
    }
    if (typeof document.addEventListener === 'function') {
      listen(document, 'visibilitychange', () => { if (document.hidden) skipReplay(d); });
    }
    d.interval = setInterval(() => paintClock(d), 250);
    instances.set(el, d); active = d;
  },

  update(el, S, api) {
    if (!instances.has(el)) this.mount(el, api);
    const d = instances.get(el);
    d.api = api;
    if (d.retiredInstances.has(S.instanceId)) return;
    if (d.state && S.instanceId === d.state.instanceId && eventSeq(S) < eventSeq(d.state)) return;
    const key = S.instanceId + ':' + S.cols + ':' + S.rows;
    if (key !== d.key) {
      if (d.state && d.state.instanceId !== S.instanceId) {
        d.retiredInstances.add(d.state.instanceId);
        if (d.retiredInstances.size > 4) d.retiredInstances.delete(d.retiredInstances.values().next().value);
      }
      d.key = key; d.pendingTurn = null;
      cancelReplay(d); d.shown = null; d.lastSeq = null; d.lastInstance = null;
      const grid = el.querySelector('.cr-grid'); grid.replaceChildren();
      grid.style.setProperty('--cols', S.cols);
      d.cells = S.board.map((_, i) => {
        const b = document.createElement('button'); b.type = 'button';
        b.className = 'cr-cell'; b.dataset.cell = String(i); grid.appendChild(b); return b;
      });
      const list = el.querySelector('.cr-seats'); list.replaceChildren();
      d.seats = S.order.map((id, seat) => {
        const li = document.createElement('li'); li.className = 'cr-seat';
        li.style.setProperty('--orb', displayStyleFor(S, seat).color);
        const mark = document.createElement('span'); mark.className = 'cr-mark'; mark.setAttribute('aria-hidden', 'true');
        const orb = document.createElement('i'); orb.className = 'cr-orb ' + S.palette[seat].shape; mark.appendChild(orb);
        const body = document.createElement('div');
        const name = document.createElement('div'); name.className = 'cr-name';
        const score = document.createElement('div'); score.className = 'cr-score';
        body.append(name, score); li.append(mark, body); list.appendChild(li);
        return { id, li, name, score };
      });
    }
    if (d.pendingTurn !== S.turnNo) d.pendingTurn = null;
    d.state = S;
    if (S.audioBaseline && d.replayCtx) d.replayCtx.quiet = true;
    applyTranspose(d);
    routeUpdate(d); paintClock(d);
  },

  isReplaying(el) { return instances.get(el)?.replaying === true; },

  dispose(el) {
    const d = el ? instances.get(el) : active; if (!d) return;
    d.disposed = true;
    clearInterval(d.interval); cancelReplay(d);
    try { if (d.scene && typeof d.scene.dispose === 'function') d.scene.dispose(); } catch { /* teardown must never throw */ }
    d.scene = null; d.focusIndex = null;
    for (const [target, event, fn] of d.listeners) target.removeEventListener(event, fn);
    d.style.remove(); instances.delete(d.el); if (active === d) active = null;
    d.state = null; d.shown = null; d.cells = []; d.seats = [];
  },
};

export default view;
