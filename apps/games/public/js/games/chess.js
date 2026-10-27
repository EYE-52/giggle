/* Chess view: DOM board, mount/update/dispose lifecycle.
 * Selection by click/tap; roving-tabindex arrows + Enter for keyboard;
 * explicit promotion chooser; live clocks; flip is visual-only. */
import { esc, nameOf, ensureStylesheet } from '../util.js';
import { bkEnsureCss, bkRemoveCss, bkPanelStatic, bkTickStatic, bkClick, bkDrawState, bkTimer, bkMeta, bkRank, bkHeadline, bkHost } from './board-kit.js';

const FILES = 'abcdefgh';
const NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
/* Board themes: Mono (cool neutral graphite/white default), Blue
 * (harbor) and Green (fern) optional. Pre-D7 names map to their matching
 * board so older stored configs still render. */
const THEMES = {
  Mono: 'theme-mono', Blue: 'theme-harbor', Green: 'theme-fern',
  Violet: 'theme-harbor', Mint: 'theme-fern', Monochrome: 'theme-mono',
};
/* The board keeps its authored pieces and materials inside a native room. */
const CSS_ID = 'chess-tabletop-css';
const CSS_HREF = '/css/chess-tabletop.css';

function ensureCss() {
  bkEnsureCss();
  ensureStylesheet(CSS_ID, CSS_HREF);
}

function removeCss() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return;
  const l = document.getElementById(CSS_ID);
  if (l) l.remove();
  bkRemoveCss();
}

let sel = null; // selected square, e.g. 'e2'
let lastInstance = ''; // server instanceId; a new game resets local UX state
let cursor = 'e2'; // roving-tabindex cursor
let flipped = null; // null = auto from seat; boolean once user/snapshot sets it
let promo = null; // {from,to} awaiting promotion choice
let armedResign = false; // resign waits for a confirmation in the panel
let moveTimerInfo = null; // kit timer model for the live tick
let lastHistLen = -1;
let lastPhase = '';
let lastCheck = false;
let clockTimer = 0;
let clockInfo = null; // {clocks, stamp, turn, phase}
let clockNowFn = null; // api.now when the shell provides it, else wall clock
let bound = [];
let previousHistory = -1;
let previousSnapshotPhase = '';
let moveMotion = null;
let settleTimer = 0;
let readyInstance = '';
let resultSent = false;
let latestSnapshot = null;
let latestApi = null;
let pendingMove = false, pendingTimer = 0, moveRetry = false, settledEffect = null;

function reduced() { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
function sprite(side, type, extra = '') { return `<img class="ch-piece ${extra}" src="/assets/boards/chess/${side}${type}.webp" width="256" height="256" alt="" draggable="false" aria-hidden="true">`; }
function captureTray(S, side) {
  const remaining = {p:8,n:2,b:2,r:2,q:1,k:1};
  for (const [i, san] of (S.history || []).entries()) {
    if ((i % 2 === 0 ? 'w' : 'b') !== side) continue;
    const promotion = san.match(/=([QNBR])/);
    if (promotion) { remaining.p--; remaining[promotion[1].toLowerCase()]++; }
  }
  for (const row of S.board || []) for (const cell of row || []) if (cell?.c === side) remaining[cell.t]--;
  const pieces = ['p','n','b','r','q'].flatMap(t => Array.from({length:Math.max(0,remaining[t])}, () => sprite(side,t))).join('');
  return `<div class="ch-captured" aria-label="Captured ${side === 'w' ? 'white' : 'black'} pieces">${pieces || '<span>None</span>'}</div>`;
}
/* Number of the side's pieces taken so far (material on the tray). */
function capturedCount(S, side) {
  let n = 16;
  for (const row of S.board || []) for (const cell of row || []) if (cell?.c === side) n--;
  return n;
}


function clockNow() {
  if (typeof clockNowFn === 'function') {
    try {
      const v = clockNowFn();
      if (Number.isFinite(v)) return v;
    } catch { /* fall through to wall clock */ }
  }
  return Date.now();
}

function on(t, type, fn, opts) {
  if (!t || !t.addEventListener) return;
  t.addEventListener(type, fn, opts);
  bound.push([t, type, fn, opts]);
}

function sqAt(file, rank) {
  return FILES[file] + (rank + 1);
}

function parseSq(sq) {
  return [FILES.indexOf(sq[0]), Number(sq[1]) - 1];
}

function fmtClock(ms) {
  if (ms === null || ms === undefined) return '–';
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

function paintClocks() {
  if (moveTimerInfo && typeof document !== 'undefined' && document.getElementById) bkTickStatic(document.getElementById('chess-root'), moveTimerInfo);
  if (!clockInfo || !clockInfo.clocks) return;
  const elW = document.getElementById('ch-clock-w');
  const elB = document.getElementById('ch-clock-b');
  if (!elW || !elB) return;
  const { clocks, stamp, turn, phase } = clockInfo;
  let w = clocks.w;
  let b = clocks.b;
  if (phase === 'play') {
    // Server stamp vs calibrated server time: skewed walls still agree.
    const dt = Math.max(0, clockNow() - stamp);
    if (turn === 'w') w = Math.max(0, w - dt);
    else b = Math.max(0, b - dt);
  }
  elW.textContent = fmtClock(w);
  elB.textContent = fmtClock(b);
  elW.classList.toggle('low', phase === 'play' && w < 30000);
  elB.classList.toggle('low', phase === 'play' && b < 30000);
}

function sideWord(c) { return c === 'w' ? 'White' : 'Black'; }
function resultText(S) {
  const r = S.result;
  if (!r) return '';
  if (!r.winner) return `It’s a tie. ${r.detail || 'Drawn game'}.`;
  const who = `${sideWord(r.winner)} (${nameOf(S, r.winnerPid)}) wins`;
  if (r.outcome === 'checkmate') return `Checkmate — ${who}.`;
  return `${r.detail || ''} — ${who}.`;
}
function reasonText(S) {
  const r = S.result;
  if (!r) return '';
  if (r.outcome === 'checkmate') return 'Checkmate.';
  if (r.outcome === 'resign') return `${nameOf(S, r.winner === 'w' ? S.black : S.white)} resigned.`;
  if (r.outcome === 'forfeit') return `${nameOf(S, r.winner === 'w' ? S.black : S.white)} left the game.`;
  if (r.outcome === 'timeout') return `${nameOf(S, r.winner === 'w' ? S.black : S.white)} ran out of time.`;
  return `${r.detail || 'Drawn game'}.`;
}
function statusLine(S) {
  if (S.preparing) return 'Getting the board ready…';
  if (moveMotion) return 'Move settling…';
  if (pendingMove) return 'Sending your move…';
  if (moveRetry) return 'Move not confirmed. Try again.';
  if (S.phase === 'done') return resultText(S);
  return `${S.turn === 'w' ? 'White' : 'Black'} to move${S.check ? ' · Check' : ''}${!S.youAre ? ' · Watching' : ''}`;
}

function repaintWithFocus(el, S, api, view) {
  const owned = el.contains?.(document.activeElement), id = document.activeElement?.id;
  view.update(el, S, api);
  if (owned) api.focus?.(id && el.querySelector('#' + id) || el.querySelector('#chsq-' + cursor));
}

function beginPending(el, S, api, view) {
  pendingMove = true; moveRetry = false; clearTimeout(pendingTimer);
  const timer = pendingTimer = setTimeout(() => {
    if (pendingTimer !== timer || lastInstance !== S.instanceId) return;
    pendingTimer = 0; pendingMove = false; moveRetry = true;
    repaintWithFocus(el, latestSnapshot, latestApi, view);
  }, 4000);
  repaintWithFocus(el, S, api, view);
}

export default {
  styles: [CSS_HREF],
  ownsTimer: true, ownsInputs: true, ownsRematch: true,
  async ready(el) {
    await Promise.all([...el.querySelectorAll('img')].map(img => img.decode()));
  },
  mount(el) {
    ensureCss();
    disposeAll();
    sel = null;
    cursor = 'e2';
    flipped = null;
    promo = null;
    armedResign = false;
    lastHistLen = -1;
    lastPhase = '';
    lastCheck = false;
    clockInfo = null;
    el.innerHTML = '<div class="bk-game ch-tabletop chess" id="chess-root" role="region" aria-label="Chess game"></div>';
    clockTimer = setInterval(paintClocks, 250);
  },

  update(el, S, api) {
    ensureCss();
    // Rematch/new instance: drop selection, orientation, and announce memory.
    if ((S.instanceId || '') !== lastInstance) {
      lastInstance = S.instanceId || '';
      sel = null;
      cursor = 'e2';
      flipped = null;
      promo = null;
      armedResign = false;
      lastHistLen = -1;
      lastPhase = '';
      lastCheck = false;
      clearTimeout(settleTimer); settleTimer = 0; moveMotion = null;
      previousHistory = -1; previousSnapshotPhase = ''; readyInstance = ''; resultSent = false;
      clearTimeout(pendingTimer); pendingTimer = 0; pendingMove = false; moveRetry = false; settledEffect = null;
    }
    const prior = latestSnapshot, historyLength = (S.history || []).length;
    if (prior && prior.instanceId === S.instanceId && (historyLength < previousHistory || prior.phase === 'done' && S.phase !== 'done')) return;
    const roleChanged = prior?.youAre !== S.youAre || prior?.spectator !== S.spectator;
    const confirmed = !roleChanged && !S.preparing && !S.audioBaseline && previousHistory >= 0 && historyLength === previousHistory + 1 && S.lastMove;
    const confirmedMove = confirmed && !reduced();
    if (roleChanged || historyLength !== previousHistory || S.phase !== previousSnapshotPhase) { clearTimeout(pendingTimer); pendingTimer = 0; pendingMove = false; moveRetry = false; }
    if (roleChanged || historyLength !== previousHistory && !confirmedMove) { clearTimeout(settleTimer); settleTimer = 0; moveMotion = null; }
    latestSnapshot = S; latestApi = api;
    if (S.audioBaseline && moveMotion) moveMotion.silent = true;
    if (confirmedMove) {
      clearTimeout(settleTimer); settleTimer = 0;
      const moves = [{from:S.lastMove.from,to:S.lastMove.to}];
      if (/^O-O/.test(S.lastMove.san || '')) {
        const rank = S.lastMove.from[1], long = S.lastMove.to[0] === 'c';
        moves.push({from:(long?'a':'h')+rank,to:(long?'d':'f')+rank});
      }
      const oldCells = Object.fromEntries((prior?.board || []).flat().filter(Boolean).map(p => [p.s, p]));
      const moved = oldCells[S.lastMove.from];
      const captureSquare = oldCells[S.lastMove.to] ? S.lastMove.to : /x/.test(S.lastMove.san || '') && moved?.t === 'p' ? S.lastMove.to[0] + S.lastMove.from[1] : null;
      moveMotion = { moves, before: prior, captured: captureSquare ? oldCells[captureSquare] : null, promotion: /=/.test(S.lastMove.san || '') ? moved : null, id: `${lastInstance}:${historyLength}:land`, until:Date.now()+340 };
    }
    if (S.phase === 'done' && previousSnapshotPhase === 'play') readyInstance = lastInstance;
    const root = el.querySelector('#chess-root') || el;
    const themeCls = THEMES[S.boardTheme] || THEMES.Mono;
    if (flipped === null) flipped = S.youAre === 'b';
    const myTurn = !S.preparing && S.phase === 'play' && !S.spectator && S.youAre && S.youAre === S.turn && !moveMotion && !pendingMove;
    const legal = S.legal || {};

    // Drop selections that no longer make sense (turn changed, piece moved).
    if (!myTurn) { sel = null; promo = null; }
    if (promo && (!legal[promo.from] || !legal[promo.from].some((d) => d.to === promo.to))) promo = null;

    clockNowFn = api && typeof api.now === 'function' ? api.now.bind(api) : null;
    clockInfo = { clocks: S.clocks, stamp: S.clockStamp || clockNow(), turn: S.turn, phase: S.preparing ? 'preparing' : S.phase };

    const board = S.board || [];
    const cells = {};
    for (const row of board) for (const cell of row || []) if (cell) cells[cell.s] = cell;

    const lastSet = new Set();
    if (S.lastMove) { lastSet.add(S.lastMove.from); lastSet.add(S.lastMove.to); }
    const dests = new Set(sel && legal[sel] ? legal[sel].map((d) => d.to) : []);
    const srcs = new Set(myTurn && !promo ? Object.keys(legal) : []);

    // Board squares: rank 8 at top unless flipped.
    let squares = '';
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const file = flipped ? 7 - f : f;
        const rank = flipped ? r : 7 - r;
        const sq = sqAt(file, rank);
        const cell = cells[sq];
        const isLight = (file + rank) % 2 === 1;
        const cls = ['sq', isLight ? 'light' : 'dark'];
        if (sq === sel) cls.push('sel');
        if (sq === cursor) cls.push('cursor');
        if (lastSet.has(sq)) cls.push('last');
        if (sq === S.checkSquare) cls.push('check');
        if (dests.has(sq)) cls.push(cell ? 'cap' : 'dest');
        if (srcs.has(sq)) cls.push('src');
        const movement = moveMotion?.moves.find(m => m.to === sq);
        let motionStyle = '';
        if (movement) {
          const [ff,fr] = parseSq(movement.from), [tf,tr] = parseSq(movement.to);
          const dx = (ff-tf)*(flipped?-1:1)*100, dy = (fr-tr)*(flipped?1:-1)*100;
          motionStyle = ` style="--dx:${dx}%;--dy:${dy}%;--move-delay:${Math.min(0,moveMotion.until-Date.now()-340)}ms"`;
        }
        const fileLabel = r === 7 ? `<small class="ch-file">${FILES[file]}</small>` : '';
        const rankLabel = f === 0 ? `<small class="ch-rank">${rank+1}</small>` : '';
        const captured = moveMotion?.captured?.s === sq ? moveMotion.captured : null;
        const promotion = movement && moveMotion.promotion;
        const piece = cell
          ? `${cell.c === 'w' ? 'White' : 'Black'} ${NAMES[cell.t] || ''} on ${sq}`
          : `${sq}, empty`;
        const extra = sq === sel ? ', selected' : dests.has(sq) ? ', move target' : '';
        squares += `<button type="button" id="chsq-${sq}" data-sq="${sq}" class="${cls.join(' ')}" ` +
          `tabindex="${sq === cursor ? '0' : '-1'}"${sq === cursor ? ' data-game-focus' : ''} aria-disabled="${!myTurn}" aria-label="${esc(piece + extra)}">` +
          `${captured ? `<span class="ch-piece-slot ch-capture-away" style="--move-delay:${Math.min(0,moveMotion.until-Date.now()-340)}ms">${sprite(captured.c,captured.t)}</span>` : ''}<span class="ch-piece-slot ${movement ? 'ch-moving' : ''}"${motionStyle}>${cell ? sprite(cell.c,cell.t,promotion?'ch-promoted':'') : ''}${promotion ? sprite(promotion.c,promotion.t,'ch-promotion-before') : ''}</span>${fileLabel}${rankLabel}</button>`;
      }
    }

    const hist = S.history || [];
    let movesHtml = '';
    for (let i = 0; i < hist.length; i += 2) {
      const n = i / 2 + 1;
      movesHtml += `<div class="mv"><span class="n">${n}.</span><span>${esc(hist[i])}</span>` +
        `<span>${hist[i + 1] ? esc(hist[i + 1]) : ''}</span></div>`;
    }

    const canAct = !S.preparing && !S.spectator && S.youAre && S.phase === 'play' && !moveMotion && !pendingMove;
    const resignArmed = armedResign && Date.now() - armedResign < 8000;
    const promoHtml = promo ? `<div class="promo" role="dialog" aria-label="Choose promotion piece">
        <span>Promote to:</span>
        ${['q', 'r', 'b', 'n'].map((p) =>
          `<button type="button" class="btn ghost" data-promo="${p}" aria-label="Promote to ${NAMES[p]}">` +
          `${sprite(S.turn || 'w',p)}<span>${NAMES[p]}</span></button>`).join('')}
        <button type="button" class="btn ghost" data-promo-x>Cancel</button>
      </div>` : '';

    /* Board on the stage; the shared board panel on the side. */
    const me = S.youAre && !S.spectator ? (S.youAre === 'w' ? S.white : S.black) : null;
    const done = S.phase === 'done' && !moveMotion;
    const shownForCaptures = moveMotion?.before || S;
    const host = bkHost(api);
    const histOpen = root.querySelector('.chhist-wrap')?.open === true;
    const helpOpen = root.querySelector('.bk-help')?.open === true;
    const histHtml = `<details class="chhist-wrap"${histOpen ? ' open' : ''}><summary>Moves${hist.length ? ` · ${Math.ceil(hist.length / 2)}` : ''}</summary><div class="chhist" id="ch-hist" aria-label="Move history" tabindex="0">${movesHtml || '<span class="muted">No moves yet.</span>'}</div></details>`;
    const extra = `<div class="ch-capture-rail"><div><small>Taken from Black</small>${captureTray(shownForCaptures,'b')}</div><div><small>Taken from White</small>${captureTray(shownForCaptures,'w')}</div></div>${histHtml}`;
    moveTimerInfo = bkTimer(S, api);
    const final = done ? {
      headline: bkHeadline(S.result?.winnerPid ? [nameOf(S, S.result.winnerPid)] : [S.white, S.black].filter(Boolean).map(pid => nameOf(S, pid))),
      detail: reasonText(S),
      rows: bkRank([S.white, S.black].filter(Boolean).map((pid, i) => ({ name: nameOf(S, pid), points: S.scores?.[pid] ?? 0, you: pid === me, order: i }))),
      ...host,
    } : null;
    const panelHtml = bkPanelStatic({
      title: 'Chess', flip: true, flipId: 'ch-flip', resignId: 'ch-resign', statusClass: 'chstatus', finalClass: 'ch-result-tools', helpOpen,
      help: ['Choose a piece, then one of its dots. Use the arrow keys and Enter or Space. Pawns promote with a chooser. Check means you must protect your king.'],
      extra,
    }, {
      meta: bkMeta(S, S.timeControl && S.timeControl !== 'Off' && S.timeControl !== 'Untimed' ? `${S.timeControl} each` : 'No time control'),
      players: ['b', 'w'].map(side => ({
        name: nameOf(S, side === 'w' ? S.white : S.black), side: side === 'w' ? 'White' : 'Black',
        chip: `<span class="ch-chip">${sprite(side, 'p')}</span>`,
        stat: capturedCount(shownForCaptures, side === 'w' ? 'b' : 'w'), statLabel: 'captures',
        clock: S.clocks ? fmtClock(S.clocks[side]) : null, statId: S.clocks ? `ch-clock-${side}` : null,
        turn: S.phase === 'play' && S.turn === side && !moveMotion, you: S.youAre === side && !S.spectator,
      })),
      status: statusLine(S), timer: moveTimerInfo, done: S.phase === 'done', player: !!me,
      busy: !!S.preparing || !!moveMotion || pendingMove, armed: armedResign,
      drawOffer: bkDrawState(S, me), drawBlocked: S.drawBlocked === me, flipBusy: !!moveMotion,
      final,
    });
    const turnCls = S.phase === 'play' ? (S.turn === 'w' ? 'tomove-w' : 'tomove-b') : '';
    const boardHtml = `<div class="bk-stage chboard-col ${turnCls}"><div class="ch-frame"><div class="chboard" role="group" aria-label="Chess board">${squares}</div></div>${promoHtml}</div>`;
    for (const cls of ['theme-mono', 'theme-harbor', 'theme-fern']) root.classList.toggle(cls, cls === themeCls);
    root.innerHTML = boardHtml + panelHtml;

    // Listeners are re-wired per snapshot: drop the previous snapshot's
    // tracked listeners first (their nodes are discarded with innerHTML, but
    // the tracking array itself must not grow without bound).
    for (const [t, type, fn, opts] of bound) {
      try { t.removeEventListener(type, fn, opts); } catch { /* noop */ }
    }
    bound = [];

    const tryMove = (from, to) => {
      if (!myTurn || pendingMove || moveMotion) return false;
      const opts = (legal[from] || []).filter((d) => d.to === to);
      if (!opts.length) return false;
      if (opts.some((d) => d.promo)) {
        promo = { from, to };
        this.update(el, S, api);
        // Promotion is a user-triggered choice below the board. The shell
        // restores focus without scrolling, so reveal the chooser explicitly
        // on a short phone screen; ordinary snapshots keep their scroll.
        root.querySelector('.promo')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        const first = root.querySelector('[data-promo]');
        if (first) api.focus(first);
        return true;
      }
      sel = null;
      beginPending(el, S, api, this);
      api.send({ move: { from, to } });
      return true;
    };

    // Internal repaints (selection, cursor, dialogs) bypass the shell's
    // focus guard, so they restore focus themselves; snapshot-driven
    // paints keep focus via the shell.
    const repaint = (focusId) => {
      this.update(el, S, api);
      const n = document.getElementById(focusId);
      if (n) api.focus(n);
    };
    const onSquare = (sq) => {
      if (!myTurn || promo) return;
      if (sel && dests.has(sq)) { tryMove(sel, sq); return; }
      const cell = cells[sq];
      if (cell && ((S.turn === 'w' && cell.c === 'w') || (S.turn === 'b' && cell.c === 'b')) && legal[sq]) {
        sel = sel === sq ? null : sq;
        cursor = sq;
        repaint('chsq-' + cursor);
      } else {
        sel = null;
        repaint('chsq-' + cursor);
      }
    };

    root.querySelectorAll('[data-sq]').forEach((b) => {
      on(b, 'click', () => { cursor = b.dataset.sq; onSquare(b.dataset.sq); });
      on(b, 'keydown', (e) => {
        const [f, r] = parseSq(b.dataset.sq);
        // Arrows follow the VISUAL layout, so a flipped board inverts them.
        const sx = flipped ? -1 : 1;
        const sy = flipped ? -1 : 1;
        let nf = f;
        let nr = r;
        if (e.key === 'ArrowLeft') nf = f - sx;
        else if (e.key === 'ArrowRight') nf = f + sx;
        else if (e.key === 'ArrowUp') nr = r + sy;
        else if (e.key === 'ArrowDown') nr = r - sy;
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSquare(b.dataset.sq); return; }
        else if (e.key === 'Escape') { sel = null; promo = null; repaint('chsq-' + cursor); return; }
        else return;
        e.preventDefault();
        nf = Math.max(0, Math.min(7, nf));
        nr = Math.max(0, Math.min(7, nr));
        cursor = sqAt(nf, nr);
        repaint('chsq-' + cursor);
      });
    });

    root.querySelectorAll('[data-promo]').forEach((b) => {
      on(b, 'click', () => {
        if (!promo || !myTurn || pendingMove || moveMotion) return;
        const action = { move: { from: promo.from, to: promo.to, promotion: b.dataset.promo } };
        promo = null; sel = null;
        beginPending(el, S, api, this); api.send(action);
      });
    });
    const px = root.querySelector('[data-promo-x]');
    if (px) on(px, 'click', () => { promo = null; repaint('chsq-' + cursor); });

    const flip = root.querySelector('#ch-flip');
    if (flip) on(flip, 'click', () => { if (moveMotion) return; flipped = !flipped; repaint('ch-flip'); });

    const sendFlag = (action, focusId) => {
      if (!canAct || pendingMove || moveMotion) return;
      armedResign = false;
      beginPending(el, S, api, this); api.send(action);
      if (focusId) repaint(focusId);
    };
    on(root, 'click', (e) => {
      bkClick(e, {
        arm: () => { if (!canAct) return; armedResign = !armedResign; repaint(armedResign ? 'bk-keep' : 'ch-resign'); },
        keep: () => { armedResign = false; repaint('ch-resign'); },
        resign: () => { if (armedResign) sendFlag({ resign: true }); },
        offerDraw: () => sendFlag({ offerDraw: true }),
        acceptDraw: () => sendFlag({ acceptDraw: true }),
        declineDraw: () => sendFlag({ declineDraw: true }),
        rematch: () => { if (S.phase === 'done' && !moveMotion && api.context?.().isHost === true && !api.context?.().roomActionPending) api.rematch?.(); },
        lobby: () => { if (S.phase === 'done' && !moveMotion && api.context?.().isHost === true && !api.context?.().roomActionPending) api.lobby?.(); },
      });
    });

    previousHistory = historyLength; previousSnapshotPhase = S.phase;
    if (confirmedMove) { const timer = settleTimer = setTimeout(() => {
      if (lastInstance !== S.instanceId || settleTimer !== timer) return;
      settledEffect = moveMotion; settleTimer = 0; moveMotion = null;
      repaintWithFocus(el,latestSnapshot,latestApi,this);
    },340); }
    if (settledEffect) { const effect = settledEffect; settledEffect = null; if (!effect.silent) api.cue?.(effect.captured ? 'capture' : 'piece', { id: effect.id, gain: .8 }); }
    if (confirmed && !confirmedMove) api.cue?.(/x/.test(S.lastMove.san || '') ? 'capture' : 'piece', { id: `${lastInstance}:${historyLength}:land`, gain: .8 });
    if (readyInstance === lastInstance && S.phase === 'done' && !moveMotion && !resultSent) {
      resultSent = true; api.resultsReady?.(lastInstance);
      api.announce?.(resultText(S).replace(/<[^>]*>/g,''));
    }
    // Move history follows the game; announcements for screen readers.
    if (hist.length !== lastHistLen) {
      lastHistLen = hist.length;
      const hbox = root.querySelector('#ch-hist');
      if (hbox) hbox.scrollTop = hbox.scrollHeight;
    }
    if (S.phase !== lastPhase) {
      lastPhase = S.phase;
      // The result is announced only after the final piece settles.
    }
    if (!!S.check !== lastCheck) {
      lastCheck = !!S.check;
      if (S.check && S.phase === 'play') api.announce('Check.');
    }
    paintClocks();
  },

  dispose() {
    disposeAll();
    removeCss();
  },
};

function disposeAll() {
  if (clockTimer) { clearInterval(clockTimer); clockTimer = 0; }
  for (const [t, type, fn, opts] of bound) {
    try { t.removeEventListener(type, fn, opts); } catch { /* noop */ }
  }
  bound = [];
  sel = null;
  lastInstance = '';
  cursor = 'e2';
  flipped = null;
  promo = null;
  armedResign = false;
  lastHistLen = -1;
  lastPhase = '';
  lastCheck = false;
  clockInfo = null;
  clockNowFn = null;
  moveTimerInfo = null;
  clearTimeout(settleTimer); settleTimer = 0; moveMotion = null;
  clearTimeout(pendingTimer); pendingTimer = 0; pendingMove = false; moveRetry = false; settledEffect = null;
  previousHistory = -1; previousSnapshotPhase = ''; readyInstance = ''; resultSent = false; latestSnapshot = null; latestApi = null;
}
