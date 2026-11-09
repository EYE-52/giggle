/* The five new boards use the existing board panel and HUD clock. Each game
 * supplies its own art and short status model. All mutable UI state is local
 * to a mount, so rematches and separate practice frames cannot share caches. */
import { motionClock, motionReduced, diceSVG, diceTrack, DICE_MS } from './board-motion.js';
import { esc, nameOf } from '../util.js';
import { syncHudTimer, stopHudTimer } from '../kit.js';
import { bkPanelHTML, bkPaint, bkClick, bkDispose, bkDrawState, bkRank, bkHeadline, bkHost } from './board-kit.js';

export { esc, nameOf };
export const b5Text = (S, key, args = {}) => String(S.strings?.[key] || '').replace(/\{(\w+)\}/g, (_, k) => args[k] ?? '');
export const b5Can = S => S.phase === 'play' && !S.preparing && !S.spectator && S.youAre !== null &&
  S.youAre === S.turn && !S.out.includes(S.seats[S.youAre]) && !S.finished?.includes(S.seats[S.youAre]);
export const b5Chip = i => `<span class="b5-token b5-seat-${i}" aria-hidden="true">${i + 1}</span>`;

export const b5Die = value => diceSVG(value);

export function createBatch5View(config) {
  function draw(el, c, animate = false) {
    const stage = el.querySelector('.b5-playfield');
    const focused = document.activeElement?.closest?.('[data-cell],[data-edge]');
    const focusId = focused && stage.contains(focused) ? focused.id : null;
    stage.innerHTML = config.board(c.S.preparing && c.released ? c.released : c.S, animate);
    for (const target of stage.querySelectorAll('[data-cell],[data-edge]')) {
      target.setAttribute('tabindex', Number(target.dataset.cell ?? target.dataset.edge) === c.cursor ? '0' : '-1');
    }
    if (focusId) stage.querySelector(`#${focusId}`)?.focus({ preventScroll: true });
  }

  function paint(el, c) {
    const S = c.S, me = S.youAre !== null && !S.spectator ? S.seats[S.youAre] : null;
    const done = S.phase === 'done';
    const winners = S.result?.winners || [];
    const detail = b5Text(S, S.result?.reason || 'done');
    bkPaint(el, {
      meta: config.meta(S),
      players: S.seats.map((pid, i) => ({
        name: nameOf(S, pid), side: config.side?.(S, i) || '', chip: b5Chip(i),
        stat: config.stat(S, pid), statLabel: config.unit(S),
        turn: !done && S.turn === i, you: pid === me, out: S.out.includes(pid),
      })),
      status: done ? (winners.length ? bkHeadline(winners.map(pid => nameOf(S, pid))) : 'Game ended') :
        S.preparing ? 'Getting the table ready…' : c.pending ? 'Sending your move…' : c.retry ? 'Move not confirmed. Try again.' :
          b5Can(S) ? b5Text(S, 'yourTurn') : b5Text(S, 'waiting', { name: nameOf(S, S.seats[S.turn]) }),
      hint: S.spectator || S.youAre === null ? 'Watching this table' : config.hint(S),
      done, player: !!me && !S.out.includes(me) && !S.finished?.includes(me), busy: c.pending || c.animating || !!S.preparing,
      draw: S.seats.length === 2, actions: true, armed: c.armed,
      drawOffer: bkDrawState(S, me), drawBlocked: S.drawBlocked === me,
      final: done && !c.animating ? {
        headline: winners.length ? bkHeadline(winners.map(pid => nameOf(S, pid))) : 'Game ended',
        detail: [detail, winners.length > 1 ? winners.map(pid => nameOf(S, pid)).join(' · ') : ''].filter(Boolean).join(' '),
        rows: bkRank(S.seats.map((pid, i) => ({ name: nameOf(S, pid), points: S.scores[pid] || 0, you: pid === me, order: i }))),
        ...bkHost(c.api),
      } : null,
    });
    // The kit timer slot keeps its width even when the timer is off or done.
    syncHudTimer(el, S, c.api, { totalMs: S.moveTimerMs });
    el.querySelector('.b5-hud-label').textContent = config.hud(S);
    el.querySelector('.b5-hud-turn').textContent = done ? 'Final scores' : `Turn ${S.turnNo + 1}`;
    const root = el.querySelector('.b5-game');
    root.dataset.phase = S.phase;
    root.dataset.seats = S.seats.length;
    const columns = ['pig-dice', 'snakes-ladders'].includes(config.id) ? 3 : 2;
    const rows = Math.ceil(S.seats.length / columns);
    root.style.setProperty('--b5-roster-height', `${rows * 44 + (rows - 1) * 8}px`);
    const reason = el.querySelector('.b5-action-reason');
    reason.textContent = c.pending ? 'Sending your move…' : S.drawOffer === me ? 'Waiting for the draw reply' :
      S.drawBlocked === me ? 'Play a move before offering again' : '';
    config.paint?.(el, S, c.pending, c.animating);
    const can = b5Can(S) && !c.pending && !c.animating;
    for (const target of el.querySelectorAll('[data-cell],[data-edge]')) {
      const value = Number(target.dataset.cell ?? target.dataset.edge);
      target.setAttribute('aria-disabled', String(!can || !S.legal.includes(value)));
    }
    for (const button of el.querySelectorAll('[data-roll],[data-hold],[data-swap]')) {
      button.disabled = !can || (button.hasAttribute('data-swap') && !S.swapAvailable);
    }
  }

  function send(el, c, action) {
    const S = c.S;
    if (c.pending || c.animating || S.preparing || S.phase !== 'play' || S.spectator || S.youAre === null ||
        S.out.includes(S.seats[S.youAre]) || S.finished?.includes(S.seats[S.youAre])) return;
    c.pending = true; c.retry = false; c.armed = false;
    clearTimeout(c.pendingTimer);
    c.pendingTimer = setTimeout(() => {
      if (el._b5 !== c) return;
      c.pending = false; c.retry = true; paint(el, c);
    }, 4000);
    paint(el, c);
    c.api.send({ ...action, rev: S.rev });
  }

  return {
    styles: ['/css/board-duels.css', '/css/batch5-boards.css', `/css/${config.id}.css`],
    ownsTimer: true, ownsInputs: true, ownsRematch: true,
    mount(el) {
      // game-host loads styles in the declared order. Appending another copy
      // of board-duels here would put its phone defaults after our layout.
      const c = el._b5 = { motion: motionClock(), animating: false, bound: [], pending: false, retry: false, armed: false, rev: -1, cursor: 0 };
      el.innerHTML = `<section class="bk-game b5-game ${config.prefix}" data-family="board" aria-label="${esc(config.title)}">
        <div class="b5-hud gk-hud"><span class="b5-hud-label"></span><span class="b5-hud-turn"></span><span class="gk-hud-timer" aria-hidden="true"></span></div>
        <div class="bk-stage b5-playfield"></div>
        ${bkPanelHTML({ title: config.title, draw: true, extra: `${config.extra || ''}<p class="tb-reason b5-action-reason"></p>` })}
      </section>`;
      const listen = (type, fn) => { el.addEventListener(type, fn); c.bound.push([type, fn]); };
      listen('click', e => {
        if (!c.S) return;
        if (bkClick(e, {
          arm: () => { c.armed = true; paint(el, c); }, keep: () => { c.armed = false; paint(el, c); },
          resign: () => { if (c.armed) send(el, c, { resign: true }); },
          offerDraw: () => send(el, c, { offerDraw: true }), acceptDraw: () => send(el, c, { acceptDraw: true }),
          declineDraw: () => send(el, c, { declineDraw: true }),
          rematch: () => { if (bkHost(c.api).isHost) c.api.rematch?.(); },
          lobby: () => { if (bkHost(c.api).isHost) c.api.lobby?.(); },
        })) return;
        const target = e.target.closest?.('[data-cell],[data-edge],[data-roll],[data-hold],[data-swap]');
        if (!target || target.disabled || target.getAttribute('aria-disabled') === 'true' || !b5Can(c.S)) return;
        if (target.hasAttribute('data-cell')) { c.cursor = Number(target.dataset.cell); send(el, c, { cell: c.cursor }); }
        else if (target.hasAttribute('data-edge')) { c.cursor = Number(target.dataset.edge); send(el, c, { edge: c.cursor }); }
        else if (target.hasAttribute('data-roll')) send(el, c, { roll: true });
        else if (target.hasAttribute('data-hold')) send(el, c, { hold: true });
        else send(el, c, { swap: true });
      });
      listen('keydown', e => {
        const target = e.target.closest?.('[data-cell],[data-edge]');
        if (!target) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); target.dispatchEvent(new MouseEvent('click', { bubbles: true })); return; }
        const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -(config.columns || 3), ArrowDown: config.columns || 3 }[e.key];
        if (!step) return;
        e.preventDefault();
        const nodes = [...el.querySelectorAll('[data-cell],[data-edge]')];
        const at = nodes.indexOf(target), next = nodes[(at + step + nodes.length) % nodes.length];
        nodes.forEach(n => n.setAttribute('tabindex', n === next ? '0' : '-1'));
        c.cursor = Number(next.dataset.cell ?? next.dataset.edge); next.focus({ preventScroll: true });
      });
    },
    update(el, S, api) {
      const c = el._b5;
      if (!c || (c.instance && c.instance !== S.instanceId)) { this.dispose(el); this.mount(el); }
      const state = el._b5, previous = state.S;
      if (previous && previous.instanceId === S.instanceId && S.rev < state.rev) return;
      if (S.audioBaseline) state.resultsPending = false;
      state.S = S; state.api = api; state.instance = S.instanceId;
      const changed = state.rev !== S.rev || previous?.youAre !== S.youAre || previous?.spectator !== S.spectator;
      const animate = !!previous && previous.youAre === S.youAre && previous.spectator === S.spectator && S.rev === (state.releasedRev ?? -1) + 1 && !S.audioBaseline && !S.preparing && S.lastMove?.rev === S.rev;
      if (changed || animate || S.audioBaseline) {
        state.motion.stop(); state.animating = false;
        clearTimeout(state.pendingTimer); state.pending = false; state.retry = false; state.armed = false;
        draw(el, state, animate);
        if (animate) api.cue?.(S.lastMove?.die ? 'dice' : 'piece', { id: `${S.instanceId}:${S.rev}` });
      }
      const help = el.querySelector('.bk-help-body');
      if (help && help.dataset.ready !== S.instanceId) {
        help.innerHTML = (S.strings?.help || []).map(t => `<p>${esc(t)}</p>`).join('');
        help.dataset.ready = S.instanceId;
      }
      if (S.phase === 'done' && previous?.phase === 'play' && !S.audioBaseline) state.resultsPending = true;
      state.animating = state.animating || (animate && !!S.lastMove?.die);
      paint(el, state);
      if (!state.animating || motionReduced()) diceTrack(el, S.die)(DICE_MS);
      const settle = () => {
        state.animating = false;
        paint(el, state);
        if (state.resultsPending) { state.resultsPending = false; api.resultsReady?.(S.instanceId); }
      };
      if (animate && S.lastMove?.die) {
        const reduced = motionReduced(), die = diceTrack(el, S.die);
        const trail = !reduced && config.motion?.(el, S);
        const duration = reduced ? 120 : Math.max(DICE_MS, trail?.duration || 0);
        const svg = el.querySelector(`[data-sl-pawn="${S.lastMove.side}"]`)?.querySelector('.sl-pawn-motion') || el.querySelector('.bm-die-body');
        state.motion.play(duration, ms => {
          if (reduced) { svg?.setAttribute('opacity', String(.55 + .45 * ms / duration)); return; }
          die(ms); trail?.frame(ms);
        }, () => { trail?.finish?.(); settle(); });
      } else if (!state.animating && state.resultsPending) settle();
      state.rev = S.rev;
      if (!S.preparing || S.audioBaseline) { state.releasedRev = S.rev; state.released = S; }
    },
    dispose(el) {
      const c = el?._b5;
      if (c) {
        c.motion.stop();
        clearTimeout(c.pendingTimer);
        c.bound.forEach(([type, fn]) => el.removeEventListener(type, fn));
        bkDispose(el); stopHudTimer(el); delete el._b5;
      }
    },
  };
}
