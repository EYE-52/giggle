/* Four in a Row: a flat SVG rack; counters fall behind the front plate.
 * Hover is local. Server revision, gravity and winning line stay authoritative. */
import { nameOf } from '../util.js';
import { bkEnsureCss, bkRemoveCss, bkPanelHTML, bkPaint, bkClick, bkDispose, bkDrawState, bkTimer, bkMeta, bkRank, bkHeadline, bkReason, bkHost } from './board-kit.js';
const CSS_ID = 'four-tabletop-css';
let sceneId = 0;
function css() {
  bkEnsureCss();
  if (document.getElementById(CSS_ID)) return;
  const link = document.createElement('link'); link.id = CSS_ID; link.rel = 'stylesheet'; link.href = '/css/four-tabletop.css'; document.head.appendChild(link);
}
function reduced() { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
function sideName(side) { return side === 1 ? 'Red' : 'Yellow'; }
const COUNTER = { 1: ['#e5484d', '#b8323a'], 2: ['#f5b82e', '#c98d12'] };
function chip(side) { return `<svg viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="${COUNTER[side][0]}" stroke="${COUNTER[side][1]}" stroke-width="2"/><circle cx="15" cy="15" r="8" fill="none" stroke="${COUNTER[side][1]}" stroke-width="1.5" opacity=".6"/></svg>`; }
function status(S) {
  if (S.phase === 'done') {
    if (!S.result?.winner) return S.result?.reason === 'agreement' ? 'Draw agreed. It’s a tie.' : 'Board full. It’s a tie.';
    const win = nameOf(S, S.result.winnerPid), lose = nameOf(S, S.seats[2 - S.result.winner]);
    return S.result.reason === 'four' ? `${win} connects four!` : `${win} wins. ${bkReason(S.result.reason, lose)}`;
  }
  if (S.youAre === S.turn && !S.spectator) return 'Your turn. Drop a counter.';
  return `${nameOf(S, S.seats[S.turn - 1])} to drop${S.spectator || !S.youAre ? ' · Watching' : ''}.`;
}
const X = i => 82 + i % 7 * 66, Y = i => 108 + Math.floor(i / 7) * 66;
function board(S, c, animate) {
  const p = `fr${c.id}`, canAct = S.phase === 'play' && !S.spectator && S.youAre === S.turn;
  const holes = S.board.map((_, i) => `<circle cx="${X(i)}" cy="${Y(i)}" r="26"/>`).join('');
  const discs = S.board.map((side, i) => {
    if (!side) return '';
    const cx = X(i), cy = Y(i), last = S.lastMove && S.lastMove.row * 7 + S.lastMove.col === i, drop = animate && last;
    return `<g class="fr-counter ${drop ? 'fr-drop' : ''}" style="--drop:${-(cy + 32)}px"><circle cx="${cx}" cy="${cy}" r="25" fill="${COUNTER[side][0]}" stroke="${COUNTER[side][1]}" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="17" fill="none" stroke="${COUNTER[side][1]}" stroke-width="2" opacity=".55"/>${last ? `<circle class="fr-last" cx="${cx}" cy="${cy}" r="6" fill="#fff" opacity=".85"/>` : ''}</g>`;
  }).join('');
  const win = new Set(S.winning || []);
  const rings = [...win].map(i => `<circle class="fr-win" cx="${X(i)}" cy="${Y(i)}" r="29" fill="none" stroke="#ffffff" stroke-width="4"/>`).join('');
  const targets = Array.from({ length: 7 }, (_, col) => `<g id="fr-column-${col}" data-column="${col}" role="button" tabindex="${c.cursor === col ? 0 : -1}"${c.cursor === col ? ' data-game-focus' : ''} aria-label="Column ${col + 1}${S.board[col] ? ', full' : ', drop here'}" aria-disabled="${!canAct || !S.legal.includes(col)}"><rect class="fr-hit" x="${49 + col * 66}" y="40" width="66" height="434" fill="transparent"/><rect class="fr-cursor" x="${52 + col * 66}" y="70" width="60" height="402" rx="26" fill="none"/></g>`).join('');
  return `<svg viewBox="0 0 560 500" class="fr-board ${animate ? '' : 'fr-settled'}" role="grid" aria-label="Four in a Row, seven columns, six rows">
    <defs><mask id="${p}-holes"><rect x="30" y="66" width="500" height="418" rx="22" fill="white"/><g fill="black">${holes}</g></mask></defs>
    <g class="fr-slots">${holes}</g>
    ${discs}
    <rect class="fr-rack" x="30" y="66" width="500" height="418" rx="22" mask="url(#${p}-holes)"/>
    <g>${rings}</g>
    <g class="fr-preview" aria-hidden="true"><rect class="fr-preview-beam" x="${53 + c.cursor * 66}" y="70" width="58" height="402" rx="26"/><circle cx="${82 + c.cursor * 66}" cy="34" r="24" fill="${COUNTER[S.youAre || 1][0]}" stroke="${COUNTER[S.youAre || 1][1]}" stroke-width="2"/></g>
    ${targets}
  </svg>`;
}
function paintPreview(el, c, show = false) {
  const S = c.S, active = show && !S.preparing && S.phase === 'play' && !S.spectator && S.youAre === S.turn && S.legal.includes(c.cursor) && !c.pending && !c.settling;
  const g = el.querySelector('.fr-preview'); if (!g) return;
  g.classList.toggle('is-visible', active);
  g.querySelector('circle').setAttribute('cx', 82 + c.cursor * 66);
  g.querySelector('.fr-preview-beam').setAttribute('x', 53 + c.cursor * 66);
}
function finalModel(S, c) {
  if (S.phase !== 'done' || c.settling) return null;
  const me = S.youAre && !S.spectator ? S.seats[S.youAre - 1] : null;
  const rows = bkRank(S.seats.map((pid, i) => ({ name: nameOf(S, pid), points: S.scores?.[pid] ?? 0, you: pid === me, order: i })));
  const winners = S.result?.winnerPid ? [nameOf(S, S.result.winnerPid)] : S.seats.map(pid => nameOf(S, pid));
  const lose = S.result?.winner ? nameOf(S, S.seats[2 - S.result.winner]) : '';
  return { headline: bkHeadline(winners), detail: S.result?.reason === 'four' ? 'Four in a row.' : S.result?.reason === 'draw' ? 'The board is full.' : bkReason(S.result?.reason, lose), rows, ...bkHost(c.api) };
}
function paintRail(el, c) {
  const S = c.S, me = S.youAre && !S.spectator ? S.seats[S.youAre - 1] : null;
  for (const node of el.querySelectorAll('[data-column]')) node.setAttribute('aria-disabled', String(!!S.preparing || c.pending || c.settling || S.phase !== 'play' || S.spectator || S.youAre !== S.turn || !S.legal.includes(Number(node.dataset.column))));
  const shown = c.settling && c.boardBefore ? c.boardBefore : S.board;
  bkPaint(el, {
    meta: bkMeta(S),
    players: [1, 2].map(side => ({ name: nameOf(S, S.seats[side - 1]), side: sideName(side), chip: chip(side), stat: shown.filter(x => x === side).length, statLabel: 'counters', turn: S.phase === 'play' && !c.settling && S.turn === side, you: S.youAre === side && !S.spectator })),
    status: S.preparing ? 'Getting the table ready…' : c.pending ? 'Sending your move…' : c.settling ? 'Counter dropping…' : c.retry ? 'Move not confirmed. Try again.' : status(S),
    timer: bkTimer(S, c.api), done: S.phase === 'done', player: !!me, busy: c.pending || c.settling || !!S.preparing,
    armed: c.armed, drawOffer: bkDrawState(S, me), drawBlocked: S.drawBlocked === me,
    final: finalModel(S, c),
  });
}
function beginPending(el, c) {
  clearTimeout(c.pendingTimer);
  c.pending = true; c.retry = false; c.armed = false;
  const timer = c.pendingTimer = setTimeout(() => {
    if (el._four !== c || c.pendingTimer !== timer) return;
    c.pendingTimer = 0; c.pending = false; c.retry = true;
    paintRail(el, c);
  }, 4000);
  paintPreview(el, c); paintRail(el, c);
}
function bind(el, c) {
  const listen = (target, type, fn) => { target.addEventListener(type, fn); c.bound.push([target, type, fn]); };
  const canSend = () => { const S = c.S; return !c.pending && !c.settling && !S.preparing && S.phase === 'play' && !S.spectator && !!S.youAre; };
  const drop = col => {
    const S = c.S;
    if (!canSend() || S.youAre !== S.turn || !S.legal.includes(col)) return;
    beginPending(el, c); c.api.send({ drop: col, rev: S.rev });
  };
  const sendFlag = action => { if (!canSend()) return; beginPending(el, c); c.api.send({ ...action, rev: c.S.rev }); };
  const finalAction = name => { if (c.S.phase === 'done' && c.api.context?.().isHost === true && !c.api.context?.().roomActionPending && !c.settling) c.api[name]?.(); };
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
    const target = e.target.closest?.('[data-column]');
    if (target && target.closest('.fr-stage')) { c.cursor = Number(target.dataset.column); drop(c.cursor); }
  });
  listen(el.querySelector('.fr-stage'), 'pointermove', e => {
    if (e.pointerType === 'touch') return;
    const target = e.target.closest?.('[data-column]'); if (target) { c.cursor = Number(target.dataset.column); paintPreview(el, c, true); }
  });
  listen(el.querySelector('.fr-stage'), 'pointerleave', () => paintPreview(el, c));
  listen(el, 'focusin', e => { const target = e.target.closest?.('[data-column]'); if (target) { c.cursor = Number(target.dataset.column); paintPreview(el, c, true); } });
  listen(el, 'keydown', e => {
    const column = e.target.closest?.('[data-column]');
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      if (!column) return;
      e.preventDefault(); c.cursor = Math.max(0, Math.min(6, c.cursor + (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0)));
      el.querySelectorAll('[data-column]').forEach(n => n.setAttribute('tabindex', Number(n.dataset.column) === c.cursor ? '0' : '-1'));
      c.api.focus?.(el.querySelector(`#fr-column-${c.cursor}`)); paintPreview(el, c, true);
    } else if (column && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); drop(Number(column.dataset.column)); }
  });
}
export default {
  styles: ['/css/board-duels.css', '/css/four-tabletop.css'],
  ownsTimer: true, ownsInputs: true, ownsRematch: true,
  render(el, S, api) {
    css(); let c = el._four;
    if (!c || c.instance !== S.instanceId) {
      this.dispose(el); css();
      c = el._four = { id: ++sceneId, instance: S.instanceId, S, baseline: S, api, cursor: 3, rev: -1, phase: null, timer: 0, pendingTimer: 0, bound: [], armed: false, pending: false, retry: false, settling: false, readyPending: false, boardBefore: null };
      el.innerHTML = `<section class="bk-game fr-duel" aria-label="Four in a Row game"><div class="fr-stage bk-stage"></div>${bkPanelHTML({ title: 'Four in a Row', help: ['Drop a counter into any open column. Connect four across, up, or diagonally before your opponent does. Red starts.', 'Keyboard: Left and Right choose a column, then Enter or Space.'] })}</section>`;
      bind(el, c);
    }
    if (S.rev < c.rev) return;
    const previousPhase = c.phase, roleChanged = c.S.youAre !== S.youAre || c.S.spectator !== S.spectator;
    // Retain the released board across preparation of the next revision.
    const confirmed = !roleChanged && !S.preparing && !S.audioBaseline && c.rev >= 0 && S.rev === c.baseline.rev + 1 && S.lastMove?.rev === S.rev;
    const animate = confirmed && !reduced();
    const changed = confirmed || c.rev !== S.rev || c.phase !== S.phase || roleChanged;
    const before = c.baseline?.board;
    c.S = S; c.api = api;
    if (S.audioBaseline) { c.effect = null; c.readyPending = false; }
    if (changed) {
      clearTimeout(c.pendingTimer); c.pendingTimer = 0; c.pending = false; c.retry = false;
      const focusedColumn = document.activeElement?.closest?.('[data-column]');
      const restoreFocus = focusedColumn && focusedColumn.closest('.fr-stage') === el.querySelector('.fr-stage');
      clearTimeout(c.timer); c.timer = 0; c.armed = false; c.settling = animate; c.effect = confirmed ? S.lastMove : null;
      c.boardBefore = animate && before ? before : null;
      el.querySelector('.fr-stage').innerHTML = board(S, c, animate);
      if (restoreFocus) api.focus?.(el.querySelector(`#fr-column-${c.cursor}`));
      paintPreview(el, c, document.activeElement?.closest?.('[data-column]')?.closest?.('.fr-stage') === el.querySelector('.fr-stage'));
    }
    if (!S.audioBaseline && S.phase === 'done' && previousPhase === 'play') c.readyPending = true;
    const settle = () => {
      if (el._four !== c) return;
      c.timer = 0; c.settling = false; c.boardBefore = null; el.querySelector('.fr-board')?.classList.add('fr-settled'); paintRail(el, c);
      if (c.effect) { c.api.cue?.('piece', { id: `${c.instance}:${c.effect.rev}:land`, gain: .8 }); c.effect = null; }
      if (c.readyPending && c.S.phase === 'done') { c.readyPending = false; c.api.resultsReady?.(c.instance); }
    };
    if (changed && animate) { const timer = c.timer = setTimeout(() => { if (c.timer === timer) settle(); }, 640); }
    else if (!c.settling && (c.readyPending || c.effect)) settle();
    paintRail(el, c); c.rev = S.rev; c.phase = S.phase;
    if (!S.preparing || S.audioBaseline || roleChanged) c.baseline = S;
  },
  dispose(el) {
    const c = el?._four;
    if (c) { clearTimeout(c.timer); clearTimeout(c.pendingTimer); c.bound.forEach(([t, k, f]) => t.removeEventListener(k, f)); bkDispose(el); delete el._four; }
    bkRemoveCss();
    document.getElementById(CSS_ID)?.remove();
  },
};
