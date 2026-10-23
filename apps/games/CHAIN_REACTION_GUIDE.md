# Chain Reaction on GameKit

`games/chain-reaction/server.js` is a thin manifest and configuration over
`games/engines/chain-reaction.js`. The registry discovers it automatically.
The first six roster members play; everyone else in a room of up to 24 watches.
Late joiners also watch until the next match. Two players are required.

The host can choose Compact (5 × 6), Standard (6 × 8), a 15–60 second turn
timer, and Candy or Ink palettes. Each seat has its own color **and shape**.
The reusable factory accepts other 4–6 column, 4–8 row board configurations,
palettes, default settings, and a configurable win award. The default award
is 100 session points. It has no transport or browser dependency.

An active player sends `{ x, y, turnNo }`, using the current snapshot token.
Coordinates are zero based. Only an empty or owned cell is legal. The client
sends one intent per turn; the engine also checks ownership, integer bounds,
current player, deadline, and the monotonically increasing turn token.
GameKit adds the instance and action-window envelope, rejecting old-match and
old-turn packets. There are no network actions in the animation or clock loop.

## Cascade and elimination rules

A cell bursts **at** its orthogonal neighbor count: corner 2, edge 3, inner
4. A burst removes exactly that many orbs, sends one to every neighbor, and
captures each destination. FIFO processing is deterministic. A move resolves
on a copied board before committing; every accepted move preserves all old
orbs plus its one added orb. Every continuing snapshot has stable cell counts.

All players must receive their first opportunity before elimination. A missed
deadline counts as that opportunity and skips the turn. Once everyone has
entered, a player with zero orbs is eliminated and skipped. If one owner
remains **during** a cascade, victory ends the match immediately. A terminal
board may still contain a cell at or above its burst threshold; its orb count
is preserved because the match has already ended.

Conservative dense grids have no sink and can otherwise avalanche forever.
The engine checks for last-owner victory after each complete firing, uses a
finite graph-potential bound, and never silently drops excess orbs or returns a
partly resolved live board. Invalid dense pre-entry fixtures are rejected.
A legal match must end no later than its board's maximum stable orb mass plus
one move. Both dense boards and complete legal matches are covered by tests.

Each turn schedules a cancelable `ctx.later` callback with a captured `turnNo`;
GameKit also guards its instance/window. `onTick` covers an overdue deadline.
Away players get the same bounded deadline, so remaining players can continue.
All-away empty games finish after the first opportunities expire; all-away
games with orbs keep skipping and can resume. The UI identifies an away player
and explains the next skip. A new framework start is a fresh independent
rematch; normal host start/lobby/rematch controls remain in the shell.

## View and lifecycle

The explicit server projection contains public board/rule/turn/result data,
and the viewer's seat index. Internal cancellation closures and context never
leave the server. No peer input or secret state is recorded in a snapshot.

The DOM renderer mounts once and patches cells in place. It uses a paper grid,
orbiting shapes, short bursts, readable current-player names and orb counts,
and a calibrated `api.now()` countdown. Every grid cell is at least 44 × 44 px.
Both grids fit a 390 px phone with ordinary shell padding. Arrow keys explore
the board; native button Enter/Space activates a legal cell. Labels announce
owner, shape, count, threshold, and whether placement is available. Reduced
motion disables animations. `dispose` removes the delegated click/keyboard
listeners, interval, pending animation frame, style element, and cached state.

## Validation

Run with Node 24:

```sh
/Users/divyansh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node test/chain-reaction.js
/Users/divyansh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/check-game.js chain-reaction
```

The game-specific check plays full legal matches with two, three, and six seats
on both board sizes, and a complete two-player match through real `Room`
actions and snapshot tokens. It covers conservation, live-board stability,
first-entry gating, elimination, dense termination, deterministic cascades,
invalid/opponent/duplicate/stale actions, deadline skips, reconnect play,
spectators, private projection, rematch, points, and executed client cleanup.
The DOM double checks actual renderer intents and disposal; browser visual QA
belongs to the integration pass and has not been claimed here.

## Driver for the shared all-game playability suite

The integration owner can add this before the runner in
`test/game-playability.js`. It uses that file's existing helpers and plays only
legal moves read from public views; it does not force a winner or fire timers.

```js
driver('chain-reaction', () => {
  const def = registry.get('chain-reaction');
  const results = [];
  for (const n of [2, 3]) {
    const ctx = new FakeCtx(roster(n), { boardSize: 'Compact' });
    const state = def.create(ctx);
    garbageOk(def, state, ctx, state.turnPid);
    while (state.phase === 'play') {
      const pid = state.turnPid;
      const v = V(def, state, pid);
      const legal = v.board.flatMap((cell, i) =>
        cell.owner === null || cell.owner === pid ? [i] : []);
      must(legal.length > 0, 'current seat has a legal move');
      const i = legal[Math.floor(Math.random() * legal.length)];
      const before = v.board.reduce((total, cell) => total + cell.orbs, 0);
      act(def, state, ctx, pid, {
        x: i % v.cols, y: Math.floor(i / v.cols), turnNo: v.turnNo,
      });
      const after = V(def, state, pid);
      must(after.board.reduce((total, cell) => total + cell.orbs, 0) === before + 1,
        'legal move conserves previous orbs plus one');
      must(state.moves <= 100, 'compact legal match terminates');
    }
    must(state.result && state.result.winner, 'legal match has a winner');
    must(ctx.awards[state.result.winner] === 100, 'winner awarded');
    results.push(`${n} seats: ${state.moves} legal moves`);
    def.dispose(state);
  }
  return results.join('; ');
});
```
