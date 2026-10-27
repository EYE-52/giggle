# Game rules standard: points, time, ending and leaving

Every game follows the same rules for scoring, length and quitting, so a night of mixed games feels fair and familiar. This page goes with `GAME_UI_STANDARD.md`.

## Points

- **Round games** (most party, word and speed games): a good round is worth **100 points**. Extras (speed, streak, order, being the drawer or the target) add **at most 100 more** per round. A "half credit" result (close answer, partly right) is 50.
- **Whole-match games** (board games, Pocket Karts, Word Chain, Chain Reaction): the winner gets **300**. Other places get 200, then 100, then 0 (karts and Ludo by finishing place). A draw gives **150 to each** player in the draw.
- **Award points when they are earned** with `ctx.award` (round games: at the end of each round; whole-match games: at the end of the match). Points already awarded stay when the host ends a game early.
- **Every game keeps a match scoreboard** (`state.scores`) and shows it on the final screen. A game that is "just for fun" (Rapid Polls) awards 25 points per round to everyone who took part, so it still has a scoreboard.
- **Ties**: equal points mean equal rank (1, 1, 3). A tied win says "It's a tie" and names everyone tied. Tied players get the same points. Never break a tie by list order.

## Time and length

Every game offers the same two settings first, with the same labels:

- **Rounds**: 1–12. The default is the game's natural length (for turn games, one turn per player, shown as "Auto"). Whole-match games have no Rounds setting.
- **Pace**: Relaxed, Normal (default) or Quick. Pace multiplies **every** timer in the game, including vote and reveal: Relaxed ×1.5, Normal ×1, Quick ×0.67, rounded to whole seconds, never below 3 seconds. A game may keep specific timer settings it already has (for example "Seconds to draw"); Pace then scales the remaining fixed timers.

Use the shared helpers in `games/_sdk.js` (`roundsSetting`, `paceSetting`, `paced(ctx|settings, seconds)`) so every game reads and labels these the same way.

- **Pocket Karts**: round length 1–5 minutes, default 3 minutes; a score target can end a match early on every map.
- **Turn-based duels** (board games): an optional **Move timer**: Off (default), 30 seconds or 60 seconds per move. When it runs out the turn is skipped in Chain Reaction and lost as a timeout loss in the others.

## Ending and leaving

- **End game** (host, any time, every game): ends the match, shows the final scores with points so far, then the room returns to picking a game. One name everywhere: "End game". After the final scores the host's buttons are "Rematch" and "Change game".
- **Leave** (anyone, any time, including inside Giggle): leaves the game room. In Giggle it returns to the game picker of the call; it never leaves the call.
- **A player who leaves or stays disconnected for 60 seconds** during a match:
  - in a 2-player duel, loses by forfeit;
  - in Ludo and Pocket Karts, drops out and the others play on;
  - in turn-based party games, their turn is skipped;
  - in voting games, they are simply not waited for.
- **Every 2-player board game** has **Resign** and **Offer draw** (Fleet Duel: Resign only, since it cannot draw). Wording: "Resign", "Offer draw", "Accept draw", "Decline".
- **Skipping the reveal**: the host can always press "Next" during a reveal. The round's lead player (drawer, actor, subject…) can too.

## Words

"End game", "Leave", "Rematch", "Change game", "Resign", "Offer draw", "Final scores", "Round 2 of 5", "It's a tie".
