# App feel — review and validation

Completed locally in the app-feel worktree. No push or deployment. Game rules and server actions are unchanged. The full suite passed; targeted UI checks were rerun after the final accessibility polish.

## What changed

- Secondary content now opens in an anchored desktop popover or a phone bottom sheet. The shared native dialog handles keyboard focus, Escape, outside click, reduced motion, and background input. Existing ids, inputs, form ownership, and game event handlers stay attached to their original owners.
- Two-player board games put compact player bars above and below the board. Status and tools keep fixed slots. Resign and draw live in More. Incoming draw offers stay visible in the status line. An ended game closes its old action sheet so Rematch remains usable.
- Multiplayer games use a short, horizontally scrollable player rail. A new turn reveals the active player inside that rail. Four or eight players no longer turn the roster into a tall stack above the board.
- Chess has original SVG pieces, a quiet sage/ivory board, crisp coordinates, and captures beside player names. The move list docks at 1000px of available game width; smaller views use the same floating panel system. Flip also swaps the player bars to match the board.
- Fleet Duel uses a ship chooser panel. Place, Rotate, Ready, and Fire stay near the chart. Ludo's pawn choices share one row. Pig Dice and Snakes & Ladders keep their main actions in their reserved space.
- The shared Room, Report, Fullscreen, and practice controls use a calm toolbar and segmented seat switcher. Meet keeps its dark chrome. The layout reads the actual game container, including a narrow column.
- Chain Reaction's separate game iframe loads the panel controller too. Its Help uses the same interaction as the main shell.

The visual direction follows the user's native-app brief: board first, quiet controls, clear names and turns, and one main action. Existing Nunito/Baloo UI tokens stay in use. Chess art uses ivory `#e9e4d4`, sage `#7c9686`, and a dark green rim. The shared light base keeps its existing ground `#f8f8fc`, card `#ffffff`, ink `#27243b`, and muted ink `#6b677f`. Each other board keeps its own game materials.

## Evidence

The before set uses Git version `6e91b6b626ce350538f19ff6154d34f229678cc6`, rendered against the same local room server. The after set uses the changed production client. These are actual practice rooms and game views, not image mockups.

Both sets have 144 board screenshots: 12 games × 6 sizes × Day/Night. The game iframe itself is exactly **1440×900, 1024×768, 768×1024, 390×844, 420×700, or 560×760**. The two narrow cases load the seat URL with `look=giggle`.

The 12 games are Chess, Checkers, Reversi, Kalah, Four in a Row, Five in a Row, Fleet Duel, Dots & Boxes, Ludo, Snakes & Ladders, Pig Dice, and Mega Tic-Tac-Toe. Extra sets cover four-player Ludo and eight-player Snakes & Ladders/Pig Dice, plus shared shell and non-board menus.

Quick comparisons:

- [Chess on a phone](contacts/compare-chess-390x844-day.jpg)
- [Chess in a narrow Meet column](contacts/compare-chess-420x700-day-meet.jpg)
- [Chess at night on desktop](contacts/compare-chess-1440x900-night.jpg)
- [Fleet Duel on a phone](contacts/compare-fleet-duel-390x844-day.jpg)
- [Ludo on a phone](contacts/compare-ludo-390x844-day.jpg)
- [Five in a Row on a phone](contacts/compare-five-row-390x844-day.jpg)
- [Larger rooms](contacts/larger-rooms.jpg)
- [Shared menus](contacts/shared-menus.jpg)

Recordings:

- [Board matrix: all six sizes, Day/Night, rules, move sheet, and cancel](video/boards.mp4)
- [Four-player Ludo](video/ludo-four-players.mp4)
- [Eight-player rooms](video/eight-players.mp4)
- [Resign, draw reply, rematch, and Chess flip](video/actions.mp4)
- [Practice, player management, Room, fullscreen, and game picker](video/shared-shells.mp4)
- [Party scoring, word rules, and framed Chain Reaction Help](video/other-menus.mp4)

I reviewed screenshots, the contact sheets, and sampled frame strips from the recordings. Fixes made during that review included overlapping tools, detached scores, a small Fleet chart, a two-row Ludo pawn dock, wrong Meet contrast, hidden framed Help, and a four-pixel phone jump caused by old fullscreen-tip padding and a missing grid gap.

All individual PNGs are saved locally in `before/` and `after/`. The commit includes the contact sheets, selected full-size comparisons, checks, logs, and compressed videos. Temporary raw recordings were removed after conversion.

## Checks

| Check | Result |
|---|---|
| Full `apps/games` `npm test` | PASS; [complete log](full-test.log) |
| Board browser matrix | PASS; 144 cases, no browser errors, no page-width overflow, board and tools visible, player bars clear of the board, rules do not reflow play |
| Larger rooms | PASS; 12 four-player cases and 24 eight-player cases |
| Shared panel checks | PASS; 37 disclosure families at all six sizes and both themes; keyboard, focus trap/return, outside click, saved text, no reflow, snapshot replacement, and resize |
| Game guides | PASS; all 72 generated rule pages open and close their real rules in sheets |
| Shared shells | PASS; practice guide, Manage players, game chooser, arrow-key seat switching, Room focus, and real fullscreen enter/exit |
| Non-board menus | PASS; real Would You Rather, Word Chain, and Chain Reaction rooms at all six sizes and both themes |
| Authority actions | PASS; real resign/confirmation, draw offer/reply, settled result, usable Rematch, board flip, and toolbar Tab order |
| Fresh page build, Chain Arena and Castle view checks | PASS after adding the framed Help entry point |
| Git whitespace check | PASS |

Machine-readable results: [boards](after/review.json), [four players](after/review-4p.json), [eight players](after/review-8p.json), [panels](panel-checks.json), [shells](shell-checks.json), [actions](action-checks.json), [other menus](other-menu-checks.json).

These are automated Chrome checks at the stated sizes. They do not claim testing on a physical iPad, iPhone, or a live Giggle Meet call.

## Rubric review

The user's calm native-app direction takes priority over the older sticker treatment for shared controls.

| Rubric | Final review |
|---|---|
| C1 — obvious next action | HIGH: the board, Roll, Place, or Fire owns the task; waiting and turn text remain visible |
| C2 — no button wall | HIGH: one short tool row; extra actions are in a menu |
| C3 — board is the hero | HIGH: full-width boards on phones and a viewport-sized stage on larger screens |
| C4 — purposeful colour | HIGH: each game's materials remain clear; Day, Night, and Meet controls have readable contrast |
| C5 — consistent controls | HIGH: one quiet toolbar and floating-layer treatment |
| C6 — clear type | HIGH: title, player names, turn, and secondary text have separate roles |
| C7 — even space | HIGH: shared spacing tokens; player bars and action slots align with the board |
| C8 — visible state | HIGH: turn, score/captures, clocks when enabled, and draw replies are visible |
| C9 — explained states | HIGH: Fleet placement and waiting actions retain their reason; empty moves say no moves yet |
| C10 — board safety | HIGH: live utilities stay outside cells; an opened modal blocks play until closed |
| C11 — phone fit | HIGH: no page-width overflow or cut labels; menu and toolbar targets are at least 44px |
| C12 — specific copy | HIGH: short game actions and real room state; no new filler or invented scores |

## Run again

Start the task-owned local server on port 8380. Run the scripts from this worktree with:

```sh
NODE_PATH=/private/tmp/codex-driving-browser/node_modules node apps/games/tools/app-feel/review.cjs
NODE_PATH=/private/tmp/codex-driving-browser/node_modules node apps/games/tools/app-feel/panels.cjs
NODE_PATH=/private/tmp/codex-driving-browser/node_modules node apps/games/tools/app-feel/shells.cjs
NODE_PATH=/private/tmp/codex-driving-browser/node_modules node apps/games/tools/app-feel/other-menus.cjs
NODE_PATH=/private/tmp/codex-driving-browser/node_modules node apps/games/tools/app-feel/actions.cjs
```

`APP_FEEL_PHASE=before` selects the fixed Git baseline. `APP_FEEL_SEATS=4 APP_FEEL_LABEL=4p APP_FEEL_GAMES=ludo` records the larger Ludo room. Use `APP_FEEL_SEATS=8 APP_FEEL_LABEL=8p APP_FEEL_GAMES=snakes-ladders,pig-dice` for eight-player rooms. Run `package-evidence.cjs` after recordings finish and `contact-sheets.cjs` after both PNG sets exist.

## Complete disclosure inventory

The audit found **125 source locations in 108 files**. **122 active locations** use the shared panel system or the existing fixed Room layer. The remaining three are retired Castle Clash home controls: the registry excludes that game and the page is not exported. The two old playable castle-grid disclosures were changed to permanent sections.

Native `details` elements remain as stable owners where existing game code reads `open` or binds handlers. With JavaScript enabled, their content is placed in a top-layer dialog; opening them no longer inserts content into page flow. Static guide pages still have a readable native fallback without JavaScript.

| Source | Control | Replacement |
|---|---|---|
| `public/fixtures/castle-blocks.html:1` | Room | Existing fixed room layer, now anchored on desktop and bottom sheet on phones |
| `public/games/backronyms/index.html:52` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/ballpark/index.html:52` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/banned-words/index.html:54` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/block-stack/index.html:57` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/bluff/index.html:57` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/chain-reaction/index.html:58` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/charades/index.html:57` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/checkers/index.html:58` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/chess/index.html:59` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/clue-grid/index.html:54` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/color-clash/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/compliment-battle/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/countdown-word/index.html:57` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/dare-roulette/index.html:54` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/dial-in/index.html:52` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/dice-fibs/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/doodle-guess/index.html:60` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/dots-boxes/index.html:55` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/draw-off/index.html:54` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/draw-phone/index.html:58` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/echo-pads/index.html:52` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/emoji-spotter/index.html:52` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/emoji-story/index.html:56` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/five-row/index.html:55` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/five-second/index.html:55` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/fleet-duel/index.html:58` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/four-in-a-row/index.html:57` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/funny-answer/index.html:56` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/hot-potato/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/hot-takes/index.html:54` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/kalah/index.html:58` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/know-me/index.html:52` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/letter-lock/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/ludo/index.html:57` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/lyric-fill/index.html:55` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/math-dash/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/mega-tic-tac-toe/index.html:55` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/memory-tray/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/moonlit-village/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/most-likely/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/never-ever/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/number-hunt/index.html:55` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/odd-one-out/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/penalty-kicks/index.html:55` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/pick-one/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/pig-dice/index.html:55` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/pocket-karts/index.html:61` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/pose-party/index.html:55` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/rank-it/index.html:56` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/rapid-polls/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/reaction-tap/index.html:57` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/read-my-lips/index.html:54` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/reversi/index.html:57` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/roast-toast/index.html:54` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/scattergories/index.html:56` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/show-and-go/index.html:55` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/sketchy-impostor/index.html:54` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/snakes-ladders/index.html:55` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/story-builder/index.html:56` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/think-alike/index.html:52` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/trivia/index.html:52` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/truth-dare/index.html:54` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/twenty-questions/index.html:57` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/two-truths/index.html:57` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/typing-race/index.html:55` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/undercover/index.html:52` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/warm-words/index.html:55` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/whisper/index.html:52` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/who-wrote/index.html:52` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/word-chain/index.html:57` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/word-grid/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/games/would-you-rather/index.html:53` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/app.js:1926` | QR code | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/app.js:1945` | Manage players | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/app.js:2460` | Room controls | Existing fixed room layer, now anchored on desktop and bottom sheet on phones |
| `public/js/app.js:2697` | Why? | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/customize.js:348` | Saved setups on this device | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/engines/kart-elevated-view.js:654` | Game menu | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/engines/kart-runtime.mjs:191` | Leaderboard standings, expand for full timing | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/engines/kart-runtime.mjs:205` | Driving controls help | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/engines/kart-runtime.mjs:300` | Game menu | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/engines/kart-view.js:600` | Leaderboard standings, expand for full timing | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/engines/kart-view.js:614` | Driving controls help | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/board-kit.js:58` | How to play | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/board-kit.js:58` | Match actions | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/board-kit.js:334` | How to play | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/board-kit.js:334` | Match actions | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/castle-clash-2d.js:372` | Teams &amp; Core defenses | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/castle-clash-2d.js:388` | Core defense &amp; scoring | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/castle-clash.js:108` | Camera controls | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/castle-clash.js:109` | Help | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/chain-reaction.js:853` | Help | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/chess.js:319` | Moves & captures(count)` : ''} | Docked move panel at 1000px+, floating sheet below 600px, popover between |
| `public/js/games/countdown-word.js:197` | Rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/fleet-duel.js:93` | Ships | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/hot-takes.js:133` | Scoring | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/letter-lock.js:72` | wp-detail ll-others | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/most-likely.js:98` | Scoring | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/never-ever.js:60` | Scoring | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/pick-one.js:75` | Scoring | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/rank-it.js:187` | Round points | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/rapid-polls.js:219` | +Add answers C and D | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/scattergories.js:88` | (count) | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/scattergories.js:140` | Rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/trivia.js:149` | Scoring | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/twenty-questions.js:167` | Letter hints | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/two-truths.js:115` | Need an idea? | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/warm-words.js:164` | Rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/word-chain.js:77` | (count) | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/word-chain.js:159` | (count) | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/word-chain.js:160` | Rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/word-grid.js:147` | wp-detail wg3-words | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/games/would-you-rather.js:45` | Scoring | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/howto.js:82` | howto-all | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/kart-setup.js:101` | Lighting | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/report-inbox.js:32` | report-diagnostics | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/report-issue.js:39` | Add steps to reproduce Optional | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/report-issue.js:41` | Run diagnostics | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `public/js/same-room.js:69` | Choose a game | Game chooser popover / bottom sheet; full catalogue scrolls inside the panel |
| `public/practice/index.html:40` | About practice | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
| `games/castle-clash/home/index.html:357` | Build menu shared bricks, own half only | Retired source: Castle Clash is excluded by registry.js and this page is not exported or served |
| `games/castle-clash/home/index.html:372` | Siege weapons tap a foe to fire | Retired source: Castle Clash is excluded by registry.js and this page is not exported or served |
| `games/castle-clash/home/index.html:386` | House rules host controls | Retired source: Castle Clash is excluded by registry.js and this page is not exported or served |
| `scripts/build-game-pages.js:132` | All rules | Shared native dialog: anchored popover at 600px+, bottom sheet below 600px |
