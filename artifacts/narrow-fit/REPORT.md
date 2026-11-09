# Narrow and embedded fit

All 72 games now use the game panel as their layout boundary. The checked active screens fit phone, iPad, desktop, and narrow Meet-like panels in Day and Night. Drawing keeps its ink and pointer coordinates when the panel changes size.

Work is local to the `narrow-fit` worktree. Nothing was pushed or deployed. Baseline: `6e91b6b626ce350538f19ff6154d34f229678cc6`.

## What changed

- The game host loads a shared size container. Game breakpoints and viewport units now follow that container. A short panel has its own height budget, even inside a larger browser window.
- One animation-frame job handles a burst of resize events. The height controller writes CSS only when its value changes. Scrolling a page or a nested panel does not change the height budget. Disposal releases observers, listeners, and queued work.
- Draw-Off, Doodle Guess, Draw Phone, and Sketchy Impostor use square logical paper. Layout changes scale the existing canvas rather than replacing or clearing it. Stored strokes still use normalized coordinates. Focus starts at Fit, showing the whole sheet.
- Narrow drawing toolbars use compact horizontal rows. Doodle Guess collapses its optional chat for the artist until they choose to open it. Long histories, ranks, rosters, and answer lists have their own scroll areas.
- Chess and the board games use the available height as well as width. Kalah changes orientation from the root's shape. Ludo reserves room for its status. Fleet Duel keeps a usable chart and places Confirm before the secondary tray.
- Short timed games keep every pad, emoji, color choice, and keypad key visible. Math Dash uses a side-by-side problem and keypad in short wide panels.
- Canvas and Three.js resize work is batched and skips unchanged dimensions. The shared 2D renderer copies its old pixels before changing backing dimensions, preserving their shape instead of stretching them. Three.js keeps its camera aspect in sync. Its generated kart bundle was rebuilt.
- Embedded Day inherits Day text and surface tokens, fixing pale screens with white text. Existing game art and board-kit visuals were kept.

New layout tokens: `--game-paper-min: 180px` and `--game-board-min: 200px`, documented in `apps/games/DESIGN_TOKENS.md`.

## Check matrix

Each game is measured at these eight sizes, in both themes:

| Size | Use |
| --- | --- |
| 360×640 | Small Meet panel |
| 420×700 | Narrow Meet panel |
| 560×760 | Larger Meet panel |
| 800×600 | Short landscape panel |
| 1440×900 | Desktop |
| 1024×768 | iPad landscape |
| 768×1024 | iPad portrait |
| 390×844 | Phone |

There is also a container-only check: a 420×700 panel inside a 1440×900 window. This changes the panel without changing the window. Total: **17 measurements per game, 1,224 measurements**.

The browser test loads the real registry, server view projections, game host, styles, and game clients. It waits for the framed Chain Reaction board to render and measures inside that frame too. It checks:

- No page horizontal overflow.
- Primary controls are visible, including their visible intersection with clipping ancestors.
- Rendered boards and canvases have at least 180px of visible width and height.
- Every timed pad and keypad input is visible without scrolling.
- No uncaught page errors.

The four drawing games also receive a real pointer stroke. Checks verify normalized coordinates, the same canvas node, identical pixel data across repeated container resizes, usable Focus mode, and pointer mapping after resizing. Unit checks verify resize coalescing, unchanged-size deduplication, scrolling stability, and cleanup.

## Visual review

Before/after screenshots cover all eight sizes and both themes: 1,152 images in each set. I reviewed all 48 final contact sheets, then opened individual drawing, board, and timed-game screens where the sheets showed a concern. This found the clipped Echo Pads and Math Dash inputs; the final layout and automated checks include those fixes.

There are 72 final resize videos, about six minutes total. I reviewed six time samples per video using the video contact sheets. The recordings include size and theme changes; drawing recordings also include the retained stroke and Focus change. Initial loading frames can appear before the measured screen is ready.

The fit follows the native-app benchmark: the paper or board stays stable, the main action stays in view, and secondary information yields space. This change does not replace the game's visual language or the sibling engineer's menu and board-kit work.

### Rubric samples

SCREEN: Doodle Guess at 390×844, Night. Draw the shown word on the square paper.
C1: HIGH - The prompt and drawing paper show the next action.
C2: HIGH - Drawing tools are a compact rail below the paper.
C3: HIGH - Framed paper, visible ink, and a sketchbook background.
C4: HIGH - Ink and labels remain readable in Night.
C5: HIGH - Paper and controls keep the existing drawing-kit style.
C6: HIGH - Prompt, timer, tools, and small status have clear roles.
C7: MED - The bottom tool row is dense; secondary tools scroll horizontally.
C8: HIGH - Artist, round, and timer stay visible above the sheet.
C9: N/A - No disabled or waiting control in this screen.
C10: HIGH - Tools and view controls stay outside the paper.
C11: HIGH - Paper and main drawing controls fit without page sideways scroll.
C12: HIGH - The word and drawing role are specific.
OVERALL: HIGH
TOP FIX: A later tool-sheet design could make secondary tools easier to discover.

SCREEN: Chess at 390×844, Day. Move one of your pieces on the wooden board.
C1: HIGH - The turn banner says to move.
C2: HIGH - Secondary match actions are compact and below the board.
C3: HIGH - Wood, pieces, and ranks make the board clear.
C4: HIGH - Pieces and labels are readable.
C5: HIGH - Existing board art and surrounding controls are consistent.
C6: HIGH - Game title, clocks, board, and turn message have a clear order.
C7: HIGH - The board and action row have even margins.
C8: HIGH - Both clocks and the side to move remain visible.
C9: N/A - No empty or disabled state in this screen.
C10: HIGH - No control covers a cell.
C11: HIGH - Board and main match actions fit the phone width.
C12: HIGH - The turn copy says what to do.
OVERALL: HIGH
TOP FIX: No fit fix remains in this checked state.

SCREEN: Math Dash at 800×600, Night. Enter the answer with the visible keypad, then check it.
C1: HIGH - Check answer is the main action.
C2: HIGH - The keypad is grouped as a game input.
C3: MED - The problem and keypad are clear but use a plain panel.
C4: HIGH - Problem, digits, and labels have clear contrast.
C5: HIGH - Keypad and problem share the same panel style.
C6: HIGH - Problem, answer, keypad, and action read in order.
C7: HIGH - Side-by-side input spends the short panel's width well.
C8: HIGH - Solved count and timer stay above the input.
C9: MED - Check answer is disabled while the answer is blank; the nearby label gives the task but no explicit disabled reason.
C10: HIGH - Nothing covers the input or keypad.
C11: N/A - Landscape tablet panel.
C12: HIGH - Solve the next one and Check answer describe the task.
OVERALL: HIGH
TOP FIX: The separate visual pass can give the problem panel more game character.

## Real practice-mode check

`live.cjs` starts the actual local game server on port 8397. It opens `/practice/?game=<id>`, starts the seats and match, selects the active drawing seat, and loads that seat with `&look=giggle`.

Draw-Off, Sketchy Impostor, Doodle Guess, and Draw Phone passed at all eight sizes in both themes. Each received a real pointer stroke. Canvas identity and ink coverage stayed stable through resize and theme changes; all four had zero page errors. These runs use real room/server traffic, separately from the repeatable view matrix.

## Evidence and commands

- `before/`: baseline screenshots and `measurements.json`.
- `final/`: after screenshots, drawing Focus shots, `measurements.json`, and `video/<game-id>.webm`.
- `review/final/`: all-size, all-theme contact sheets, named `<width>-<theme>-<page>.jpg`.
- `review/video/`: sampled video frames and six contact sheets.
- `live/`: real practice screenshots and four video folders; `live.log` records the four results.
- `test-matrix/`: the browser results from the final full npm test.
- `npm-test.log`: complete npm test output.
- `SUMMARY.json`: compact per-game before/after results, committed with this report.

From the worktree root:

```sh
NODE_PATH=/private/tmp/codex-driving-browser/node_modules FIT_PORT=8396 FIT_ARTIFACTS=../../artifacts/narrow-fit/test-matrix npm --prefix apps/games test
NODE_PATH=/private/tmp/codex-driving-browser/node_modules FIT_PORT=8392 FIT_SHOTS=1 FIT_VIDEO=1 FIT_ARTIFACTS=artifacts/narrow-fit/final node apps/games/test/container-fit-browser.cjs
NODE_PATH=/private/tmp/codex-driving-browser/node_modules node artifacts/narrow-fit/live.cjs
```

`npm test` now includes `test:container-fit`. Playwright is pinned in the package lock. This Mac uses the supplied Chrome binary. Other environments can set `PLAYWRIGHT_EXECUTABLE_PATH`, or install the Playwright Chromium browser.

The raw screenshots and videos stay in the local ignored artifacts folder. The report, compact results, and practice check script are committed so the evidence is easy to find and repeat. No release stamp was created.

## Scope and merge notes

These are Chrome checks of representative active states, plus real practice input for the four drawing games. They do not cover every phase, long translation, software keyboard, Safari, or physical iPad. No frame-rate claim is made; the tests prove resize batching and retained state, while the recordings provide visual evidence.

Keep the container root, height variable, and container-query breakpoints when merging the sibling board/menu redesign. Board sheet edits here change sizing and breakpoints; they do not replace board artwork or menu design.

## Results

**154 failing measurements across 50 games before; 0 failing measurements after.** All 72 games have 17 checked layouts. There were zero uncaught page errors. The smallest measured visible board/canvas side after the fix was 184px (test floor: 180px).

Full npm test: **PASS (exit 0)**, including all 72 game playability checks and the 1,224-layout browser matrix. The separate 12-check-file HUD/layout pass passed; the media toolkit passed 179 assertions, including retained-image shape.

The table counts failed size/theme cases, rather than separate issues within a case. A dash means the state uses DOM game cards or controls rather than a measured canvas/board.

| Game | Cases | Before failures | After failures | Smallest visible field side |
| --- | ---: | ---: | ---: | ---: |
| would-you-rather | 17 | 0 | 0 | — |
| doodle-guess | 17 | 2 | 0 | 206.3px |
| truth-dare | 17 | 0 | 0 | — |
| never-ever | 17 | 0 | 0 | — |
| most-likely | 17 | 0 | 0 | — |
| hot-takes | 17 | 1 | 0 | — |
| rank-it | 17 | 9 | 0 | — |
| two-truths | 17 | 3 | 0 | — |
| funny-answer | 17 | 1 | 0 | — |
| bluff | 17 | 1 | 0 | — |
| story-builder | 17 | 1 | 0 | — |
| emoji-story | 17 | 0 | 0 | — |
| trivia | 17 | 0 | 0 | — |
| scattergories | 17 | 9 | 0 | — |
| word-chain | 17 | 0 | 0 | — |
| countdown-word | 17 | 0 | 0 | — |
| lyric-fill | 17 | 0 | 0 | — |
| five-second | 17 | 0 | 0 | — |
| charades | 17 | 1 | 0 | — |
| twenty-questions | 17 | 0 | 0 | — |
| pick-one | 17 | 0 | 0 | — |
| memory-tray | 17 | 0 | 0 | — |
| rapid-polls | 17 | 5 | 0 | — |
| dare-roulette | 17 | 1 | 0 | — |
| compliment-battle | 17 | 1 | 0 | — |
| roast-toast | 17 | 0 | 0 | — |
| draw-phone | 17 | 7 | 0 | 215.1px |
| reaction-tap | 17 | 0 | 0 | — |
| typing-race | 17 | 0 | 0 | — |
| number-hunt | 17 | 3 | 0 | — |
| backronyms | 17 | 3 | 0 | — |
| ballpark | 17 | 5 | 0 | — |
| banned-words | 17 | 3 | 0 | — |
| block-stack | 17 | 1 | 0 | 284px |
| chain-reaction | 17 | 0 | 0 | 302px |
| checkers | 17 | 1 | 0 | 280px |
| chess | 17 | 1 | 0 | 228px |
| clue-grid | 17 | 3 | 0 | — |
| color-clash | 17 | 1 | 0 | — |
| dial-in | 17 | 7 | 0 | — |
| dice-fibs | 17 | 5 | 0 | — |
| dots-boxes | 17 | 1 | 0 | 280px |
| draw-off | 17 | 9 | 0 | 184px |
| echo-pads | 17 | 0 | 0 | — |
| emoji-spotter | 17 | 2 | 0 | — |
| five-row | 17 | 1 | 0 | 280px |
| fleet-duel | 17 | 7 | 0 | 200px |
| four-in-a-row | 17 | 1 | 0 | 275.7px |
| hot-potato | 17 | 4 | 0 | — |
| kalah | 17 | 1 | 0 | 185.1px |
| know-me | 17 | 3 | 0 | — |
| letter-lock | 17 | 3 | 0 | — |
| ludo | 17 | 3 | 0 | 200px |
| math-dash | 17 | 4 | 0 | — |
| mega-tic-tac-toe | 17 | 1 | 0 | 280px |
| moonlit-village | 17 | 3 | 0 | — |
| odd-one-out | 17 | 1 | 0 | — |
| penalty-kicks | 17 | 1 | 0 | 220px |
| pig-dice | 17 | 0 | 0 | — |
| pocket-karts | 17 | 0 | 0 | 360px |
| pose-party | 17 | 1 | 0 | — |
| read-my-lips | 17 | 3 | 0 | — |
| reversi | 17 | 1 | 0 | 280px |
| show-and-go | 17 | 1 | 0 | — |
| sketchy-impostor | 17 | 9 | 0 | 192px |
| snakes-ladders | 17 | 0 | 0 | — |
| think-alike | 17 | 1 | 0 | — |
| undercover | 17 | 3 | 0 | — |
| warm-words | 17 | 0 | 0 | — |
| whisper | 17 | 5 | 0 | — |
| who-wrote | 17 | 5 | 0 | — |
| word-grid | 17 | 5 | 0 | — |
