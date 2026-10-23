/* Reversi: a felt table with SVG hit cells. Authority supplies every legal
 * placement and flip; animation never changes a turn, score or board. */
import { nameOf } from '../util.js';
import { bkEnsureCss, bkRemoveCss, bkPanelHTML, bkPaint, bkClick, bkDispose, bkDrawState, bkTimer, bkMeta, bkRank, bkHeadline, bkReason, bkHost } from './board-kit.js';
const CSS_ID = 'reversi-tabletop-css';
let sceneId = 0;
function css() {
  bkEnsureCss();
  if (document.getElementById(CSS_ID)) return;
  const link = document.createElement('link'); link.id = CSS_ID; link.rel = 'stylesheet'; link.href = '/css/reversi-tabletop.css'; document.head.appendChild(link);
}
function sideName(side) { return side === 1 ? 'Charcoal' : 'Ivory'; }
const DISC = { 1: ['#2b2f38', '#14171d'], 2: ['#f3eee0', '#bdb49b'] };
function chip(side) { return `<svg viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="${DISC[side][0]}" stroke="${DISC[side][1]}" stroke-width="2"/></svg>`; }
function label(cell) { return 'ABCDEFGH'[cell % 8] + (Math.floor(cell / 8) + 1); }
function reduced() { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
function status(S) {
  if (S.phase === 'done') {
    if (!S.result?.winner) return S.result?.reason === 'agreement' ? 'Draw agreed. It’s a tie.' : `It’s a tie, ${S.counts[0]} discs each.`;
    const win = nameOf(S, S.result.winnerPid), lose = nameOf(S, S.seats[2 - S.result.winner]);
    return S.result.reason === 'complete' ? `${win} wins, ${S.counts[S.result.winner - 1]} to ${S.counts[2 - S.result.winner]}.` : `${win} wins. ${bkReason(S.result.reason, lose)}`;
  }
  const mine = S.youAre === S.turn && !S.spectator;
  const cue = mine ? 'Your turn. Place a disc on a dot.' : `${nameOf(S, S.seats[S.turn - 1])} to move${S.spectator || !S.youAre ? ' · Watching' : ''}.`;
  return S.lastMove?.passed ? `${sideName(S.lastMove.passed)} has no move and passes. ${cue}` : cue;
}
function board(S, c, animate) {
  const legal = new Set(S.legal || []), flips = new Set(animate ? S.lastMove?.flips || [] : []);
  const grid = Array.from({ length: 7 }, (_, i) => {
    const p = 24 + (i + 1) * 69; return `<path d="M${p} 24V576M24 ${p}H576"/>`;
  }).join('');
  const cells = S.board.map((side, cell) => {
    const x = 24 + cell % 8 * 69, y = 24 + Math.floor(cell / 8) * 69, cx = x + 34.5, cy = y + 34.5;
    const can = S.phase === 'play' && !S.spectator && S.youAre === S.turn && legal.has(cell);
    const flipping = flips.has(cell), placed = animate && S.lastMove?.cell === cell, last = S.lastMove?.cell === cell;
    const desc = `${label(cell)}, ${side ? sideName(side) + ' disc' : can ? 'legal placement' : 'empty'}${last ? ', last move' : ''}`;
    return `<g id="rv-cell-${cell}" data-cell="${cell}" role="button" tabindex="${c.cursor === cell ? 0 : -1}"${c.cursor === cell ? ' data-game-focus' : ''} aria-label="${desc}" aria-disabled="${!can}">
      <rect class="rv-hit" x="${x}" y="${y}" width="69" height="69"/>
      ${last ? `<rect class="rv-lastsq" x="${x + 1.5}" y="${y + 1.5}" width="66" height="66"/>` : ''}
      ${can ? `<circle class="rv-legal" cx="${cx}" cy="${cy}" r="9"/>` : ''}
      ${side ? `<g class="rv-disc ${flipping ? 'rv-flip' : placed ? 'rv-place' : ''}" style="--flip-delay:${flipping ? Math.min(120, [...flips].indexOf(cell) * 18) : 0}ms">
        <circle cx="${cx}" cy="${cy}" r="26" fill="${DISC[side][0]}" stroke="${DISC[side][1]}" stroke-width="2"/>
        ${flipping ? `<circle class="rv-old-face" cx="${cx}" cy="${cy}" r="26" fill="${DISC[3 - side][0]}" stroke="${DISC[3 - side][1]}" stroke-width="2"/>` : ''}
        ${last ? `<circle class="rv-last" cx="${cx}" cy="${cy}" r="5" fill="${side === 1 ? '#f3eee0' : '#2b2f38'}"/>` : ''}
      </g>` : ''}
      <rect class="rv-cursor" x="${x + 3}" y="${y + 3}" width="63" height="63" rx="5" fill="none"/>
    </g>`;
  }).join('');
  return `<svg viewBox="0 0 600 600" class="rv-board" role="grid" aria-label="Reversi board, eight rows and eight columns">
    <rect class="rv-frame" x="2" y="2" width="596" height="596" rx="16"/>
    <rect class="rv-felt" x="24" y="24" width="552" height="552"/>
    <g class="rv-grid">${grid}</g>
    ${[[162, 162], [438, 162], [162, 438], [438, 438]].map(([x, y]) => `<circle class="rv-star" cx="${x}" cy="${y}" r="4"/>`).join('')}
    ${cells}
  </svg>`;
}
function bind(el, c) {
  const listen = (target, type, fn) => { target.addEventListener(type, fn); c.bound.push([target, type, fn]); };
  const canSend = () => { const S = c.S; return !c.pending && !c.settling && !S.preparing && S.phase === 'play' && !S.spectator && !!S.youAre; };
  const place = cell => {
    const S = c.S;
    if (!canSend() || S.youAre !== S.turn || !S.legal.includes(cell)) return;
    beginPending(el, c);
    c.api.send({ place: cell, rev: S.rev });
  };
  const sendFlag = action => { if (!canSend()) return; beginPending(el, c); c.api.send({ ...action, rev: c.S.rev }); };
  const finalAction = name => { if (c.S.phase === 'done' && !c.settling && c.api.context?.().isHost === true && !c.api.context?.().roomActionPending) c.api[name]?.(); };
  listen(el, 'click', e => {
    if (bkClick(e, {
      arm: () => { c.armed = !c.armed; paintRail(el, c); },
      keep: () => { c.armed = false; paintRail(el, c); },
      resign: () => { if (c.armed) sendFlag({ resign: true }); },
      offerDraw: () => sendFlag({ offerDraw: true }),
      acceptDraw: () => sendFlag({ acceptDraw: true }),
      declineDraw: () => sendFlag({ declineDraw: true }),
      rematch: () => finalAction('rematch'), lobby: () => finalAction('lobby'),
    })) return;
    const cell = e.target.closest?.('[data-cell]');
    if (cell && cell.closest('.rv-stage')) { c.cursor = Number(cell.dataset.cell); place(c.cursor); }
  });
  listen(el, 'keydown', e => {
    const cell = e.target.closest?.('[data-cell]'), svg = el.querySelector('.rv-board');
    const arrows = { ArrowLeft: [0,-1], ArrowRight: [0,1], ArrowUp: [-1,0], ArrowDown: [1,0] };
    if (arrows[e.key]) {
      if (!cell) return;
      e.preventDefault();
      const [dy, dx] = arrows[e.key], old = c.cursor;
      c.cursor = Math.max(0, Math.min(7, Math.floor(old / 8) + dy)) * 8 + Math.max(0, Math.min(7, old % 8 + dx));
      svg.querySelectorAll('[data-cell]').forEach(n => n.setAttribute('tabindex', Number(n.dataset.cell) === c.cursor ? '0' : '-1'));
      c.api.focus?.(el.querySelector(`#rv-cell-${c.cursor}`));
    } else if (cell && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); place(Number(cell.dataset.cell)); }
  });
}
function beginPending(el, c) {
  clearTimeout(c.pendingTimer);
  c.pending = true; c.retry = false; c.armed = false;
  const timer = c.pendingTimer = setTimeout(() => {
    if (el._reversi !== c || c.pendingTimer !== timer) return;
    c.pendingTimer = 0; c.pending = false; c.retry = true;
    paintRail(el, c);
  }, 4000);
  paintRail(el, c);
}
function finalModel(S, c) {
  if (S.phase !== 'done' || c.settling) return null;
  const me = S.youAre && !S.spectator ? S.seats[S.youAre - 1] : null;
  const rows = bkRank(S.seats.map((pid, i) => ({ name: nameOf(S, pid), points: S.scores?.[pid] ?? 0, you: pid === me, order: i, note: `${S.counts[i]} discs` })));
  const winners = S.result?.winnerPid ? [nameOf(S, S.result.winnerPid)] : S.seats.map(pid => nameOf(S, pid));
  const lose = S.result?.winner ? nameOf(S, S.seats[2 - S.result.winner]) : '';
  const detail = S.result?.reason === 'complete' ? (S.result.winner ? `${S.counts[S.result.winner - 1]} discs to ${S.counts[2 - S.result.winner]}.` : `${S.counts[0]} discs each.`) : bkReason(S.result?.reason, lose);
  return { headline: bkHeadline(winners), detail, rows, ...bkHost(c.api) };
}
function paintRail(el, c) {
  const S = c.S, me = S.youAre && !S.spectator ? S.seats[S.youAre - 1] : null;
  for (const node of el.querySelectorAll('[data-cell]')) node.setAttribute('aria-disabled', String(!!S.preparing || c.pending || c.settling || S.phase !== 'play' || S.spectator || S.youAre !== S.turn || !S.legal.includes(Number(node.dataset.cell))));
  for (const dot of el.querySelectorAll('.rv-legal')) dot.setAttribute('visibility', c.settling || c.pending ? 'hidden' : 'visible');
  const counts = c.settling ? c.countsBefore : S.counts;
  bkPaint(el, {
    meta: bkMeta(S),
    players: [1, 2].map(side => ({ name: nameOf(S, S.seats[side - 1]), side: sideName(side), chip: chip(side), stat: counts[side - 1], statLabel: 'discs', turn: S.phase === 'play' && !c.settling && S.turn === side, you: S.youAre === side && !S.spectator })),
    status: S.preparing ? 'Getting the table ready…' : c.pending ? 'Placing your disc…' : c.settling ? `Flipping ${S.lastMove.flips.length} ${S.lastMove.flips.length === 1 ? 'disc' : 'discs'}…` : c.retry ? 'Move not confirmed. Try again.' : status(S),
    timer: bkTimer(S, c.api), done: S.phase === 'done', player: !!me, busy: c.pending || c.settling || !!S.preparing,
    armed: c.armed, drawOffer: bkDrawState(S, me), drawBlocked: S.drawBlocked === me,
    final: finalModel(S, c),
  });
}
export default {
  styles: ['/css/board-duels.css', '/css/reversi-tabletop.css'],
  ownsTimer: true, ownsInputs: true, ownsRematch: true,
  render(el, S, api) {
    css(); let c = el._reversi;
    if (!c || c.instance !== S.instanceId) {
      this.dispose(el); css();
      c = el._reversi = { id: ++sceneId, instance: S.instanceId, S, baseline: S, api, cursor: S.legal?.[0] ?? 19, rev: -1, phase: null, timer: 0, pendingTimer: 0, bound: [], armed: false, pending: false, retry: false, settling: false };
      el.innerHTML = `<section class="bk-game rv-duel" aria-label="Reversi game"><div class="rv-stage bk-stage"></div>${bkPanelHTML({ title: 'Reversi', help: ['Place a disc on a dot to trap your opponent’s discs between yours. Every trapped line flips. No move? Your turn passes. Most discs wins when neither player can move.', 'Keyboard: arrow keys, then Enter or Space. Charcoal starts.'] })}</section>`;
      bind(el, c);
    }
    if (S.rev < c.rev) return;
    const previousPhase = c.phase, roleChanged = c.S.youAre !== S.youAre || c.S.spectator !== S.spectator;
    // Retain the released board across preparation of the next revision.
    const confirmed = !roleChanged && !S.preparing && !S.audioBaseline && c.rev >= 0 && S.rev === c.baseline.rev + 1 && S.lastMove?.rev === S.rev;
    const animate = confirmed && !reduced();
    const changed = confirmed || c.rev !== S.rev || c.phase !== S.phase || roleChanged;
    if (changed) c.countsBefore = confirmed ? c.baseline.counts : c.S.counts;
    c.S = S; c.api = api;
    if (S.audioBaseline) { c.effect = null; c.readyPending = false; }
    if (changed) {
      clearTimeout(c.pendingTimer); c.pendingTimer = 0; c.pending = false; c.retry = false;
      const focusedCell = document.activeElement?.closest?.('[data-cell]');
      const restoreFocus = focusedCell && focusedCell.closest('.rv-stage') === el.querySelector('.rv-stage');
      clearTimeout(c.timer); c.timer = 0; c.armed = false; c.settling = animate; c.effect = confirmed ? S.lastMove : null;
      el.querySelector('.rv-stage').innerHTML = board(S, c, animate);
      if (restoreFocus) api.focus?.(el.querySelector(`#rv-cell-${c.cursor}`));
    }
    if (!S.audioBaseline && S.phase === 'done' && previousPhase === 'play') c.readyPending = true;
    const settle = () => {
      if (el._reversi !== c) return;
      c.timer = 0; c.settling = false; paintRail(el, c);
      if (c.effect) { c.api.cue?.(c.effect.flips.length ? 'capture' : 'piece', { id: `${c.instance}:${c.effect.rev}:flip`, gain: .8 }); c.effect = null; }
      if (c.readyPending && c.S.phase === 'done') { c.readyPending = false; c.api.resultsReady?.(c.instance); }
    };
    if (changed && animate) { const timer = c.timer = setTimeout(() => { if (c.timer === timer) settle(); }, 580); }
    else if (!c.settling && (c.readyPending || c.effect)) settle();
    paintRail(el, c);
    c.rev = S.rev; c.phase = S.phase;
    if (!S.preparing || S.audioBaseline || roleChanged) c.baseline = S;
  },
  dispose(el) {
    const c = el?._reversi;
    if (c) { clearTimeout(c.timer); clearTimeout(c.pendingTimer); c.bound.forEach(([t, k, f]) => t.removeEventListener(k, f)); bkDispose(el); delete el._reversi; }
    bkRemoveCss();
    document.getElementById(CSS_ID)?.remove();
  },
};
