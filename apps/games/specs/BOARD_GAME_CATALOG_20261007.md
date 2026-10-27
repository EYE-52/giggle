# Board-game catalog: first expansion

Ship six complete games alongside Chess and Chain Reaction. A catalog card alone is not an implementation. Future candidates are Draw Dominoes, Nine Men's Morris, Backgammon and 9×9 Go; they are not part of this release.

## Shared platform contract

Keep rooms, invitation, identity, authoritative transport, calls and totals in the platform. Each game owns its board, artwork, palette, controls, help, animation and result presentation. These are SVG tabletop games, not variations of the platform card grid.

All six accept rooms of 2–24. Reversi, Four in a Row, Checkers, Kalah and Fleet Duel have two active seats; Ludo has up to four. Remaining friends and late joiners watch. Seat identity is fixed for the match and retained on reconnect.

Validate phase, seat, turn, action shape, range and expected revision on the server. Duplicate or stale input must not move twice or award twice. A server snapshot confirms every visual move. Fleet placement has independent per-captain revision windows so simultaneous Ready actions can succeed without admitting stale shots.

Use `runtime: { type: 'module', waitForResult: true }`. Complete the final move animation before calling `api.resultsReady(instanceId)`. Do not replay a move, award or celebration on reconnect to a finished game. Rematch/Change game use the current `api.context().isHost`; game state does not contain `hostId`. Respect the platform's pending room action state.

Provide touch and keyboard actions together. Small laptop widths must not force touch controls. Preserve an existing board focus when replacing SVG nodes; never introduce unsolicited mount autofocus or steal focus from an open Room drawer. Help and Resign are compact local controls; resignation requires a clear confirmation.

## Rules and visual direction

| Game | Declared rules preset | Game-specific appearance |
| --- | --- | --- |
| Reversi | Standard 8×8, all eight bracket directions, forced passes, end when neither side can move; equal totals draw. | Emerald felt, a thin walnut frame and beveled charcoal/ivory discs. Legal dots and short flip ripples. |
| Four in a Row | 7×6 gravity board; four in any straight direction wins; full board without a line draws. | Cobalt lacquered physical rack, coral/yellow counters, preview and a short drop/bounce. Winning line appears after the drop settles. |
| Checkers | English 8×8: forward men, short kings, compulsory captures, same-piece continuation, choice of capture branch, crowning ends the move. Repetition, 80 half-turn no-progress and agreed draws. | Slate/ivory squares, carved red/charcoal pieces and obvious crowns, with confirmed slide/jump motion. |
| Kalah | Six bowls per side, four seeds each. Sow into own store, skip the other; own-store finish gives another turn. Empty own bowl captures only if its opposite is occupied. End sweeps each side's remaining seeds into its own store. | Carved walnut bowls, glossy jade/amber pebbles and visible sowing arcs. Portrait rotates the actual bowl arrangement rather than shrinking six columns. |
| Ludo | Four pawns each; six enters and earns another roll; exact home finish. Safe starts/stars, landing captures every opponent pawn on an unsafe square. No blockade or three-sixes penalty. First four home wins. | Saturated festival board, inlaid lanes, four distinctive pawn markers and one tactile die. Two players occupy opposite homes. |
| Fleet Duel | Hidden 10×10 fleets of 5/4/3/3/2. Horizontal/vertical ships may touch, not overlap. Both Ready starts alternating single shots, including after hits. Sink all five to win. | Dusk navy harbor chart, brass bearings, recognizable vessel silhouettes, coral hits and ivory misses. Own/target tabs on phone; aim then Fire. |

Ludo dice come exclusively from the server. Its two-seat lane mapping is `[0,2]`; three/four seats use their corresponding ordered lanes. Public trail/capture coordinates and drawing must use the same mapping.

Fleet projections reveal a captain's own vessels and only sunk enemy vessels. Spectators receive only sunk fleets and public shot results, including during placement, on reconnect and after resignation. Never leak unsunk locations through `lastMove`, errors or result metadata.

## Acceptance

Each game needs rule edge-position checks, a full legal match, a rematch, watchers, reconnects, host migration and stale/duplicate/out-of-turn probes through real Rooms/WebSockets. Kalah conserves all 48 seeds. Test privacy independently of rendering.

Review native browser actions and actual renderers at 1280px desktop, 390px portrait and 844×390/568×320 landscape. Record narrow dense-board targets honestly rather than claiming every cell remains 44px in a 320px viewport. Physical-phone and external-network checks require separate evidence.

The aggregate playability suite drives every registered game through actual legal actions. Its Ludo dice source is a repeatable test fixture; native and transport tests use the server's crypto dice. Fleet's full-play driver scans unknown bearings without peeking at enemy vessels.

Rules references are listed in game-specific QA research: publisher/federation rules inform behavior, while all board artwork is original. Do not copy publisher branding, illustrations or assets.
