'use strict';

/* Reusable, server-authoritative exploding-orb grid. No game id, transport,
 * renderer, or clock implementation lives in the rules. */
function geometry(cols, rows) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) ||
      cols < 4 || cols > 6 || rows < 4 || rows > 8) {
    throw new RangeError('Chain boards must be 4–6 columns and 4–8 rows.');
  }
  const neighbors = Array.from({ length: cols * rows }, (_, i) => {
    const x = i % cols, y = Math.floor(i / cols);
    const out = [];
    if (x > 0) out.push(i - 1);
    if (x < cols - 1) out.push(i + 1);
    if (y > 0) out.push(i - cols);
    if (y < rows - 1) out.push(i + cols);
    return out;
  });
  return { cols, rows, neighbors, capacities: neighbors.map((a) => a.length),
    maxStableOrbs: neighbors.reduce((n, a) => n + a.length - 1, 0) };
}

function owners(board) {
  return new Set(board.filter((c) => c.orbs > 0).map((c) => c.owner));
}

/* Transport bound for the replay tape: ordered firing source indices, one
 * entry per firing in exact FIFO order (repeats included). Real matches peak
 * near ~100 firings per move; the tape keeps every firing up to this cap and
 * marks larger avalanches truncated so the client snaps to the authoritative
 * board instead of guessing. Resolution itself is never truncated. */
const MAX_TAPE_EVENTS = 1500;

/* Apply to a COPY, then commit the complete resolution. Firing removes exactly
 * the cell's degree and sends one orb along every edge, capturing neighbors.
 * A terminal board can still be unstable: victory ends the avalanche, not an
 * invented orb sink. The final snapshot preserves its entire orb count.
 *
 * Finite bound: until an enemy (or, before entry, an empty cell) is reached,
 * treat that cell as a sink. The graph-Laplacian potential decreases by one
 * per firing; its height is at most V(V-1). At most V such targets change.
 * Pre-entry mass is at most six and V >= 16, so an empty target always exists.
 * After entry, capturing the last enemy is terminal. This bounds every LEGAL
 * resolution by mass * V(V-1)(V+1). The guard is an invariant failure, never
 * a truncated or partly committed move.
 *
 * The returned tape records every firing source index in exact FIFO order,
 * repeats included: placement plus tape deterministically replays the whole
 * avalanche (one orb per orthogonal neighbor, capture on arrival) to the
 * identical board. Only the tape is transport-bounded (options.tapeLimit,
 * default MAX_TAPE_EVENTS): beyond it the avalanche still resolves fully,
 * but tape keeps its recorded prefix and truncated is true, so the client
 * must snap to the authoritative board rather than replay a partial tape. */
function resolveCascade(board, grid, index, pid, victoryAllowed, options) {
  const { neighbors, capacities } = grid;
  if (board.length !== neighbors.length || !Number.isInteger(index) ||
      index < 0 || index >= board.length || typeof pid !== 'string') {
    throw new TypeError('Invalid cascade input.');
  }
  const tapeLimit = options && Number.isInteger(options.tapeLimit) && options.tapeLimit >= 0
    ? options.tapeLimit : MAX_TAPE_EVENTS;
  const next = board.map((c, i) => {
    if (!c || !Number.isInteger(c.orbs) || c.orbs < 0 || c.orbs >= capacities[i] ||
        (c.orbs > 0 ? typeof c.owner !== 'string' : c.owner !== null)) {
      throw new TypeError('A live board must have stable, owned orb counts.');
    }
    return { owner: c.owner, orbs: c.orbs };
  });
  if (next[index].owner !== null && next[index].owner !== pid) {
    throw new RangeError('Only empty or your own cells can be played.');
  }
  next[index].owner = pid;
  next[index].orbs += 1;
  const mass = next.reduce((n, c) => n + c.orbs, 0);
  // A valid first-entry board is sparse. Reject artificial pre-entry dense
  // inputs rather than permitting a conservative graph to run forever.
  if (!victoryAllowed && mass >= next.length) {
    throw new RangeError('Dense cascades require first-turn eligibility.');
  }
  const limit = mass * next.length * (next.length - 1) * (next.length + 1);
  const queue = [index], queued = new Set(queue), bursts = new Set();
  const tape = [];
  let head = 0, steps = 0, truncated = false;
  const onlyOwner = () => victoryAllowed && owners(next).size === 1;
  if (onlyOwner()) return { board: next, winner: pid, steps, bursts: [], tape, truncated };
  while (head < queue.length) {
    const i = queue[head++];
    queued.delete(i);
    if (next[i].orbs < capacities[i]) continue;
    if (++steps > limit) throw new Error('Chain cascade exceeded its proved legal bound.');
    next[i].orbs -= capacities[i];
    next[i].owner = next[i].orbs ? pid : null;
    bursts.add(i);
    // Record the full firing order; the transport tape alone is bounded.
    if (!truncated) {
      if (tape.length < tapeLimit) tape.push(i);
      else truncated = true;
    }
    // Complete the entire firing before inspecting victory: no lost edges.
    for (const n of neighbors[i]) {
      next[n].owner = pid;
      next[n].orbs += 1;
      if (next[n].orbs >= capacities[n] && !queued.has(n)) {
        queued.add(n);
        queue.push(n);
      }
    }
    if (onlyOwner()) return { board: next, winner: pid, steps, bursts: [...bursts], tape, truncated };
    if (next[i].orbs >= capacities[i] && !queued.has(i)) {
      queued.add(i);
      queue.push(i);
    }
    // Keep queue storage bounded while preserving deterministic FIFO order.
    if (head > 1024) { queue.splice(0, head); head = 0; }
  }
  return { board: next, winner: null, steps, bursts: [...bursts], tape, truncated };
}

function legalMoves(state, pid) {
  if (state.phase !== 'play' || pid !== state.turnPid) return [];
  return state.board.flatMap((c, i) => c.owner === null || c.owner === pid
    ? [{ x: i % state.cols, y: Math.floor(i / state.cols) }] : []);
}

function createChainReaction(config) {
  const { moveTimerMs } = require('./board-duel');
  const boards = config.boards;
  const grids = Object.fromEntries(Object.entries(boards).map(([key, b]) =>
    [key, geometry(b.cols, b.rows)]));
  const boardNames = Object.keys(grids);
  const palettes = config.palettes;
  const paletteNames = Object.keys(palettes);
  if (!boardNames.length || !paletteNames.length) throw new TypeError('Chain configuration is empty.');

  function finish(s, ctx, winner, detail) {
    if (s.phase !== 'play') return;
    s.phase = 'done';
    s.endsAt = 0;
    s.result = { winner, detail };
    s.turnPid = null;
    s._cancel?.();
    s._cancel = null;
    // Whole-match points: the last owner standing scores (300 by default).
    s.scores = Object.fromEntries(s.order.map((id) => [id, id === winner ? config.winPoints ?? 300 : 0]));
    if (winner) ctx.award(winner, s.scores[winner]);
  }

  function eliminate(s, ctx) {
    if (!s.order.every((id) => s.entered[id])) return false;
    const alive = owners(s.board);
    s.eliminated = s.order.filter((id) => !alive.has(id));
    if (alive.size <= 1) {
      finish(s, ctx, alive.size ? [...alive][0] : null,
        alive.size ? 'Last orb owner standing!' : 'No orbs were placed. Start a rematch!');
      return true;
    }
    return false;
  }

  /* Move timer (Off by default): a missed turn is skipped. */
  function arm(s, ctx) {
    s._cancel?.();
    s._cancel = null;
    if (!(s.turnSeconds > 0)) { s.endsAt = 0; return; }
    s.endsAt = ctx.now() + s.turnSeconds * 1000;
    const turnNo = s.turnNo;
    s._cancel = ctx.later(s.turnSeconds * 1000, () => {
      if (s.phase !== 'play' || s.turnNo !== turnNo) return;
      timeout(s, ctx);
      ctx.broadcast();
    });
  }

  function nextTurn(s, ctx) {
    if (eliminate(s, ctx)) return;
    do { s.turnIdx = (s.turnIdx + 1) % s.order.length; }
    while (s.eliminated.includes(s.order[s.turnIdx]) || s.dropped.includes(s.order[s.turnIdx]));
    // A monotonic turn token prevents a delayed move from a previous lap.
    if (s.turnNo >= Number.MAX_SAFE_INTEGER) {
      finish(s, ctx, null, 'Turn limit reached. Start a rematch!');
      return;
    }
    s.turnNo += 1;
    s.turnPid = s.order[s.turnIdx];
    arm(s, ctx);
  }

  function timeout(s, ctx) {
    if (s.phase !== 'play') return;
    if (s.seq >= Number.MAX_SAFE_INTEGER) {
      finish(s, ctx, null, 'Event limit reached. Start a rematch!');
      return;
    }
    const pid = s.turnPid;
    s.seq += 1;
    s.entered[pid] = true; // their first opportunity expires, then entry counts
    s.lastEvent = { kind: 'timeout', pid, seq: s.seq };
    s.lastCascade = { bursts: [], steps: 0, tape: [], truncated: false, seq: s.seq };
    nextTurn(s, ctx);
  }

  return {
    create(ctx) {
      const settings = ctx.settings() || {};
      const boardSize = boardNames.includes(settings.boardSize) ? settings.boardSize : config.defaultBoard || boardNames[0];
      const paletteName = paletteNames.includes(settings.palette) ? settings.palette : config.defaultPalette || paletteNames[0];
      const turnSeconds = Math.round(moveTimerMs(ctx) / 1000);
      const grid = grids[boardSize];
      const order = ctx.allPlayers().slice(0, 6).map((p) => p.id);
      const s = {
        phase: 'play', order, entered: Object.fromEntries(order.map((id) => [id, false])),
        eliminated: [], dropped: [], scores: {}, board: Array.from({ length: grid.cols * grid.rows }, () => ({ owner: null, orbs: 0 })),
        cols: grid.cols, rows: grid.rows, boardSize, paletteName,
        palette: palettes[paletteName].map((p) => ({ ...p })),
        turnSeconds, turnIdx: 0, turnPid: order[0], turnNo: 1, seq: 0,
        moves: 0, endsAt: 0, result: null, lastEvent: null,
        lastCascade: { bursts: [], steps: 0, tape: [], truncated: false, seq: 0 }, _cancel: null,
      };
      if (order.length < 2) {
        finish(s, ctx, null, 'Invite a second player, then start again.');
      } else arm(s, ctx);
      return s;
    },

    onAction(s, ctx, pid, a) {
      if (s.phase !== 'play' || pid !== s.turnPid || !a || typeof a !== 'object' ||
          Array.isArray(a) || a.turnNo !== s.turnNo || !Number.isSafeInteger(a.turnNo)) return false;
      if (s.endsAt > 0 && ctx.now() >= s.endsAt) { timeout(s, ctx); return; }
      const { x, y } = a;
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= s.cols || y >= s.rows) return false;
      const index = y * s.cols + x;
      if (s.board[index].owner !== null && s.board[index].owner !== pid) return false;
      if (s.seq >= Number.MAX_SAFE_INTEGER) {
        finish(s, ctx, null, 'Event limit reached. Start a rematch!');
        return;
      }
      const allowed = s.order.every((id) => id === pid || s.entered[id]);
      const resolved = resolveCascade(s.board, grids[s.boardSize], index, pid, allowed);
      s.board = resolved.board;
      s.entered[pid] = true;
      s.moves += 1;
      s.seq += 1;
      s.lastEvent = { kind: 'move', pid, x, y, turnNo: s.turnNo, seq: s.seq };
      // The cascade carries its own placement/capturer copy so replay reads
      // one record; seq matches lastEvent and dedupes rebroadcasts.
      s.lastCascade = {
        bursts: resolved.bursts, steps: resolved.steps,
        tape: resolved.tape, truncated: resolved.truncated,
        pid, x, y, seq: s.seq,
      };
      if (resolved.winner) {
        s.eliminated = s.order.filter((id) => id !== resolved.winner);
        finish(s, ctx, resolved.winner, 'Last orb owner standing!');
      } else nextTurn(s, ctx);
    },

    onTick(s, ctx) {
      if (s.phase === 'play' && s.endsAt > 0 && ctx.now() >= s.endsAt) {
        timeout(s, ctx);
        ctx.broadcast();
      }
    },

    /* Room hook: a seated player left or stayed away 60 s. In a duel the
     * other player wins by forfeit; with more players the leaver drops
     * out (their orbs leave the board) and the rest play on. */
    onPlayerGone(s, ctx, pid) {
      if (s.phase !== 'play' || !s.order.includes(pid) || s.dropped.includes(pid) || s.eliminated.includes(pid)) return false;
      const active = s.order.filter((id) => !s.eliminated.includes(id) && !s.dropped.includes(id));
      s.dropped.push(pid);
      s.eliminated.push(pid);
      s.entered[pid] = true;
      for (const cell of s.board) if (cell.owner === pid) { cell.owner = null; cell.orbs = 0; }
      s.seq += 1;
      s.lastEvent = { kind: 'left', pid, seq: s.seq };
      s.lastCascade = { bursts: [], steps: 0, tape: [], truncated: false, seq: s.seq };
      const rest = active.filter((id) => id !== pid);
      if (rest.length <= 1) {
        s.eliminated = s.order.filter((id) => id !== rest[0]);
        finish(s, ctx, rest[0] || null, rest.length ? 'The other player left. Win by forfeit!' : 'Everyone left.');
      } else if (s.turnPid === pid) nextTurn(s, ctx);
      return true;
    },

    view(s, pid, ctx) {
      const counts = Object.fromEntries(s.order.map((id) => [id, 0]));
      for (const cell of s.board) if (cell.owner) counts[cell.owner] += cell.orbs;
      // Explicit projection: internal cancellation closures and context stay
      // server-side. Every board fact is public, including the last burst.
      return {
        phase: s.phase, board: s.board.map((c) => ({ ...c })), cols: s.cols, rows: s.rows,
        order: s.order.slice(), entered: { ...s.entered }, eliminated: s.eliminated.slice(), counts,
        dropped: s.dropped.slice(), scores: { ...s.scores },
        boardSize: s.boardSize, paletteName: s.paletteName, palette: s.palette.map((p) => ({ ...p })),
        turnPid: s.turnPid, turnNo: s.turnNo, moves: s.moves, endsAt: s.endsAt, turnSeconds: s.turnSeconds,
        mySeat: s.order.indexOf(pid), result: s.result ? { ...s.result } : null,
        lastEvent: s.lastEvent ? { ...s.lastEvent } : null,
        lastCascade: {
          bursts: s.lastCascade.bursts.slice(), steps: s.lastCascade.steps,
          tape: s.lastCascade.tape.slice(), truncated: s.lastCascade.truncated,
          pid: s.lastCascade.pid ?? null,
          x: s.lastCascade.x ?? null, y: s.lastCascade.y ?? null,
          seq: s.lastCascade.seq,
        },
      };
    },

    dispose(s) { if (s) { s._cancel?.(); s._cancel = null; } },
  };
}

module.exports = { geometry, resolveCascade, legalMoves, createChainReaction, MAX_TAPE_EVENTS };
