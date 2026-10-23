import { nameOf } from '../util.js';
import { bkEnsureCss, bkRemoveCss, bkPanelHTML, bkPaint, bkClick, bkDispose, bkDrawState, bkTimer, bkMeta, bkRank, bkHeadline, bkReason, bkHost } from './board-kit.js';

let root, api, state, baseline, selected = null, cursor = 40, flipped = false, instance = '', revision = -1;
let pending = null, pendingTimer = 0, frame = 0, moving = null, armed = false, resultReady = '', boardEl, svgEl, bound = [];
const sideOf = p => p ? (p - 1) % 2 : -1;
const text = key => state?.strings?.[key] || key;
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function listen(node, type, fn) { node.addEventListener(type, fn); bound.push([node, type, fn]); }
function coord(i) { let r = Math.floor(i / 8), c = i % 8; if (flipped) { r = 7 - r; c = 7 - c; } return { x: 64 + c * 96, y: 64 + r * 96 }; }
const PIECE = { 0: ['#d9434e', '#a52a35', '#f08a91'], 1: ['#363a43', '#1b1d22', '#6b707b'] };
function token(piece, x, y, opacity = 1) {
  const [fill, edge, ring] = PIECE[sideOf(piece)], crowned = piece > 2;
  return `<g transform="translate(${x} ${y})" opacity="${opacity}">
    <circle r="36" fill="${fill}" stroke="${edge}" stroke-width="3"/>
    <circle r="25" fill="none" stroke="${ring}" stroke-width="3" opacity=".7"/>
    ${crowned ? '<path d="M-17 8L-20 -11L-9 -2L0 -16L9 -2L20 -11L17 8Z" fill="#f6c445" stroke="#b7861b" stroke-width="2" stroke-linejoin="round"/>' : ''}
  </g>`;
}
function chip(side) { return `<svg viewBox="0 0 30 30"><circle cx="15" cy="15" r="13" fill="${PIECE[side][0]}" stroke="${PIECE[side][1]}" stroke-width="2"/><circle cx="15" cy="15" r="8" fill="none" stroke="${PIECE[side][2]}" stroke-width="1.5"/></svg>`; }
function svg(board, floating) {
  let squares = '', pieces = '';
  const last = state?.lastMove && !moving ? new Set([state.lastMove.from, state.lastMove.to]) : new Set();
  for (let i = 0; i < 64; i++) {
    const { x, y } = coord(i), dark = (Math.floor(i / 8) + i % 8) % 2;
    squares += `<rect class="${dark ? 'ck-dark' : 'ck-light'}" x="${x - 48}" y="${y - 48}" width="96" height="96"/>${last.has(i) ? `<rect class="ck-last" x="${x - 48}" y="${y - 48}" width="96" height="96"/>` : ''}`;
    if (board[i]) pieces += token(board[i], x, y, i === moving?.capture ? moving.captureOpacity : 1);
  }
  if (floating) pieces += token(floating.piece, floating.x, floating.y);
  return `<rect class="ck-frame" width="800" height="800" rx="18"/>${squares}${pieces}`;
}
function myTurn() { return !state?.preparing && state?.phase === 'play' && state.youAre !== null && !state.spectator && state.turn === state.youAre; }
function send(action) {
  if (pending !== null || moving || !state || state.preparing || state.spectator || state.youAre === null || state.phase !== 'play') return;
  pending = state.revision;
  const retryTimer = pendingTimer = setTimeout(() => { if (pendingTimer !== retryTimer) return; pendingTimer = 0; pending = null; paint(); api?.toast?.(text('retry')); }, 4000);
  api.send({ ...action, revision: state.revision }); paint();
}
function activate(i) {
  if (!myTurn() || moving || pending !== null) return;
  const legal = state.legal || {};
  if (selected !== null && (legal[selected] || []).some(m => m.to === i)) { send({ from: selected, to: i }); selected = null; return; }
  if (state.forced !== null) { selected = state.forced; paint(); return; }
  selected = legal[i]?.length ? (selected === i ? null : i) : null; paint();
}
function reasonText(r) {
  const lose = r.winner === null ? '' : nameOf(state, state.seats[1 - r.winner]);
  return bkReason(r.reason, lose) || text(r.reason + 'Reason');
}
function resultLabel() {
  if (!state.result) return '';
  const r = state.result;
  return r.winner === null ? 'It’s a tie.' : nameOf(state, r.winnerPid) + ' ' + text('win') + '.';
}
function finalModel(done) {
  if (!done) return null;
  const me = state.youAre === null || state.spectator ? null : state.seats[state.youAre];
  const rows = bkRank(state.seats.map((pid, i) => ({ name: nameOf(state, pid), points: state.scores?.[pid] ?? 0, you: pid === me, order: i })));
  const winners = state.result.winnerPid ? [nameOf(state, state.result.winnerPid)] : state.seats.map(pid => nameOf(state, pid));
  return { headline: bkHeadline(winners), detail: reasonText(state.result), rows, ...bkHost(api) };
}
function paint() {
  if (!root || !state) return;
  const active = myTurn() && !moving && pending === null, legal = state.legal || {};
  const dest = new Set(selected !== null ? (legal[selected] || []).map(m => m.to) : []);
  const board = moving?.board || state.board, done = state.phase === 'done' && !moving;
  svgEl.innerHTML = svg(board, moving?.floating);
  for (const button of boardEl.querySelectorAll('[data-square]')) {
    const i = Number(button.dataset.square), r = Math.floor(i / 8), c = i % 8, p = state.board[i];
    button.style.gridRow = (flipped ? 8 - r : r + 1); button.style.gridColumn = (flipped ? 8 - c : c + 1);
    button.tabIndex = cursor === i ? 0 : -1;
    if (cursor === i) button.setAttribute('data-game-focus', ''); else button.removeAttribute?.('data-game-focus');
    button.classList.toggle('is-selected', active && i === selected);
    button.classList.toggle('is-destination', active && dest.has(i));
    button.classList.toggle('is-source', active && selected === null && legal[i]?.length > 0);
    button.setAttribute('aria-disabled', String(!active));
    const square = String.fromCharCode(97 + c) + (8 - r);
    // setAttribute is a text sink; locale strings are never parsed as markup.
    button.setAttribute('aria-label', text('square') + ' ' + square + ', ' + (p ? text(sideOf(p) ? 'charcoal' : 'red') + ' ' + text(p > 2 ? 'king' : 'man') : text('empty')) + (selected === i ? ', ' + text('selected') : dest.has(i) ? ', ' + text('legal') : ''));
  }
  const mandatory = Object.values(legal).some(ms => ms.some(m => m.capture !== null));
  const helpBody = root.querySelector('.bk-help-body');
  if (helpBody.textContent !== text('instructions')) helpBody.textContent = text('instructions');
  const me = state.youAre === null || state.spectator ? null : state.seats[state.youAre];
  bkPaint(root, {
    meta: bkMeta(state, text('variant')),
    players: [0, 1].map(side => {
      const count = (moving?.before || state.board).filter(p => p && sideOf(p) === side).length;
      return { name: nameOf(state, state.seats[side]), side: text(side ? 'charcoal' : 'red'), chip: chip(side), stat: count, statLabel: text(count === 1 ? 'man' : 'pieces'), turn: !done && !moving && !state.preparing && state.phase === 'play' && state.turn === side, you: state.youAre === side && !state.spectator };
    }),
    status: moving ? text('moving') : done ? resultLabel() : state.preparing ? '' : state.youAre === null ? text('watching') + ' · ' + nameOf(state, state.seats[state.turn]) : myTurn() ? text('yourTurn') : text('waiting'),
    hint: done ? reasonText(state.result) : moving || state.preparing ? '' : state.youAre === null ? text('spectatorHelp') : myTurn() && state.forced !== null ? text('continue') : myTurn() && mandatory ? text('capture') : myTurn() ? text('choose') : text('waitingHint'),
    timer: bkTimer(state, api), done: state.phase === 'done', player: !!me, busy: !!moving || pending !== null || state.preparing === true,
    armed, drawOffer: bkDrawState(state, me), drawBlocked: state.drawBlocked === me, flipBusy: !!moving,
    final: finalModel(done),
  });
  if (done && resultReady === 'pending') { resultReady = state.instanceId; api.resultsReady?.(state.instanceId); }
}
function animate(move) {
  const start = performance.now(), duration = move.capture === null ? 280 : 400, a = coord(move.from), b = coord(move.to);
  const board = move.before.slice(), piece = board[move.from]; board[move.from] = 0;
  const animation = moving = { board, before: move.before, capture: move.capture, captureOpacity: 1, captured: false, floating: { piece, ...a } };
  function step(now) {
    if (!root || moving !== animation) return;
    const t = Math.min(1, (now - start) / duration), e = t * t * (3 - 2 * t);
    moving.floating = { piece: move.crowned && t > .9 ? piece + 2 : piece, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e - Math.sin(t * Math.PI) * (move.capture === null ? 4 : 18) };
    let captureCue = false;
    if (move.capture !== null) {
      moving.captureOpacity = Math.max(0, Math.min(1, (.72 - t) / .24));
      if (t >= .72 && !moving.captured) { moving.captured = true; moving.board[move.capture] = 0; captureCue = !moving.silent; }
    }
    paint();
    if (captureCue) api.cue?.('capture', { id: `${instance}:${move.revision}:capture`, gain: .8 });
    if (t < 1) frame = requestAnimationFrame(step);
    else { const silent = moving.silent; frame = 0; moving = null; if (move.capture === null && !silent) api.cue?.('piece', { id: `${instance}:${move.revision}:land`, gain: .8 }); paint(); }
  }
  frame = requestAnimationFrame(step);
}
export default {
  styles: ['/css/board-duels.css', '/css/checkers.css'],
  ownsTimer: true, ownsInputs: true, ownsRematch: true, waitForResult: true,
  // Flat board: no bitmap materials to decode.
  ready() { return Promise.resolve(); },
  mount(el, suppliedApi) {
    this.dispose(); api = suppliedApi;
    bkEnsureCss();
    if (!document.getElementById('checkers-css')) { const css = document.createElement('link'); css.id = 'checkers-css'; css.rel = 'stylesheet'; css.href = '/css/checkers.css'; document.head.appendChild(css); }
    el.innerHTML = `<section class="bk-game ck" aria-label="Checkers"><div class="bk-stage ck-board"><svg class="ck-art" viewBox="0 0 800 800" aria-hidden="true"></svg><div class="ck-grid" role="group" aria-label="Checkers board">${Array.from({ length: 64 }, (_, i) => `<button type="button" data-square="${i}" data-watchok tabindex="-1"></button>`).join('')}</div></div>${bkPanelHTML({ title: 'Checkers', flip: true, help: [] })}</section>`;
    root = el.querySelector('.ck'); boardEl = root.querySelector('.ck-grid'); svgEl = root.querySelector('.ck-art');
    const sendFlag = action => { if (state?.youAre !== null && !state?.spectator) send(action); };
    const finalAction = name => { if (state?.phase === 'done' && !moving && api.context?.().isHost === true && !api.context?.().roomActionPending) api[name]?.(); };
    listen(root, 'click', e => {
      if (bkClick(e, {
        arm: () => { armed = !armed; paint(); },
        keep: () => { armed = false; paint(); },
        resign: () => { if (armed) sendFlag({ resign: true }); },
        offerDraw: () => sendFlag({ offerDraw: true }),
        acceptDraw: () => sendFlag({ acceptDraw: true }),
        declineDraw: () => sendFlag({ declineDraw: true }),
        flip: () => { if (moving) return; flipped = !flipped; paint(); },
        rematch: () => finalAction('rematch'), lobby: () => finalAction('lobby'),
      })) return;
      const button = e.target.closest('button'); if (!button) return;
      if (button.dataset.square !== undefined) { cursor = Number(button.dataset.square); activate(cursor); }
    });
    listen(boardEl, 'keydown', e => {
      const target = e.target.closest('[data-square]'); if (!target) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(Number(target.dataset.square)); return; }
      if (e.key === 'Escape') { selected = state.forced; paint(); return; }
      const dirs = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }, d = dirs[e.key];
      if (!d) return; e.preventDefault();
      const i = Number(target.dataset.square), sign = flipped ? -1 : 1;
      const r = Math.max(0, Math.min(7, Math.floor(i / 8) + d[0] * sign)), c = Math.max(0, Math.min(7, i % 8 + d[1] * sign));
      cursor = r * 8 + c; paint(); boardEl.querySelector(`[data-square="${cursor}"]`).focus({ preventScroll: true });
    });
  },
  update(el, snapshot, suppliedApi) {
    api = suppliedApi;
    if (instance === snapshot.instanceId && snapshot.revision < revision) return;
    const fresh = instance !== snapshot.instanceId, prior = state;
    if (fresh) { if (frame) cancelAnimationFrame(frame); frame = 0; moving = null; instance = snapshot.instanceId; revision = -1; selected = null; pending = null; armed = false; resultReady = ''; flipped = snapshot.youAre === 1; cursor = snapshot.youAre === 1 ? 17 : 40; }
    const roleChanged = prior?.youAre !== snapshot.youAre || prior?.spectator !== snapshot.spectator;
    // A prepared turn is current authority, but not yet a presented move.
    const confirmed = !fresh && !roleChanged && !snapshot.preparing && !snapshot.audioBaseline && baseline?.phase === 'play' && snapshot.lastMove?.revision === snapshot.revision && snapshot.revision === baseline.revision + 1;
    const changed = confirmed || revision !== snapshot.revision || roleChanged;
    if (changed) { if (pendingTimer) clearTimeout(pendingTimer); pendingTimer = 0; pending = null; armed = false; selected = snapshot.forced !== null && snapshot.turn === snapshot.youAre ? snapshot.forced : null; }
    state = snapshot;
    if (snapshot.audioBaseline) { if (moving) moving.silent = true; resultReady = ''; }
    if (!fresh && !snapshot.audioBaseline && prior?.phase === 'play' && snapshot.phase === 'done') resultReady = 'pending';
    if (confirmed && !reduced()) {
      if (frame) cancelAnimationFrame(frame); moving = null; animate(snapshot.lastMove);
    } else if (changed) { if (frame) cancelAnimationFrame(frame); frame = 0; moving = null; }
    revision = snapshot.revision; paint();
    if (fresh || !snapshot.preparing || snapshot.audioBaseline || roleChanged) baseline = snapshot;
    if (confirmed && reduced()) api.cue?.(snapshot.lastMove.capture !== null ? 'capture' : 'piece', { id: `${instance}:${revision}:land`, gain: .8 });
    if (!snapshot.preparing && snapshot.phase === 'play' && (prior?.preparing === true || prior?.turn !== snapshot.turn || prior?.youAre !== snapshot.youAre || prior?.spectator !== snapshot.spectator)) api.announce?.(myTurn() ? text('yourTurn') : nameOf(snapshot, snapshot.seats[snapshot.turn]) + ' · ' + text('waiting'));
  },
  dispose() {
    if (frame) cancelAnimationFrame(frame);
    if (pendingTimer) clearTimeout(pendingTimer); pendingTimer = 0;
    bound.forEach(([node, type, fn]) => node.removeEventListener(type, fn)); bound = [];
    if (root) bkDispose(root);
    root = api = state = baseline = boardEl = svgEl = moving = null; frame = 0; instance = ''; revision = -1; pending = null; selected = null; armed = false; resultReady = '';
    bkRemoveCss();
    document.getElementById('checkers-css')?.remove();
  },
};
