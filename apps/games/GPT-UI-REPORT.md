# Giggle Games UI polish

## Games header, 12 November

The three phone actions previously occupied 156 CSS pixels with their labels hidden. A single 44 × 44 options button now opens the theme, sound and report actions at widths up to 720 pixels. The full Game Night name fits at 320 pixels. On wider screens the same three actions are visible as unboxed icons with individual 44 × 44 targets. The sticky dock is 52 pixels tall.

- Chrome exercised home and lobby, scrolling, theme and sound changes, report dismissal, keyboard focus and the 720/721-pixel transition in both themes. A second player joining while the host was in options or reporting an issue did not interrupt that task.
- WebKit checked the actual header and report dialog at 320, 375, 390, 1024 and 1440 pixels in both themes. These were browser viewport checks on a Mac.
- The Number Hunt practice screenshot sweep found zero clipped or covered controls across six views. It covered all four handoff sizes, with Night repeated at 390 and 1440 pixels.

The 259 normal Games test commands passed across the main run and reruns. The first run found an old test expecting Doodle strokes without their published IDs. That assertion was corrected separately. The telemetry browser check timed out once on an independent game frame and passed on rerun. The 72-game layout sweep passed all 1,224 measurements.

## White and black themes

| Surface | Previous Day / Night | Current Day / Night |
| --- | --- | --- |
| Home background | Apricot paper `#fcf6e9` / forest green `#18241e` | White `#ffffff` / black `#080808`, with rose light near the edges |
| Main panels | White / forest green `#24332a` | White / charcoal `#181818` |
| Main action | Raspberry / marigold | Rose `#a72550` / light rose `#f6a3bb` |

The home, catalogue, game guides, room menus and one-device table share the same palette. Game art, chess squares, dice, player markers and vote results carry their own colours. All 72 guides use the shared theme loader. The browser toolbar updates for the selected theme.

- Chrome checked 1440×900, 1024×768, 390×844 and 375×667 in Day and Night. The home, one-device setup and Chess guide had zero horizontal overflow before and after. The Chess clipping check reported zero findings across eight captures after the change.
- Real room creation, joining, catalogue search and draft preservation passed at all four sizes in both themes. The additional 320×568 home check also passed.
- One-device tests completed 16 three-person Truth or Dare rounds across both prompt styles, both themes and all four sizes. Each result led back to setup for a legal Four in a Row move. All 21 one-device games also mounted on a phone-sized viewport.
- At 375×667, the timer and spin card originally began at the same vertical position. The timer now ends at 222 px and the card begins at 230 px. Ballots and prompts remain readable through private handoffs.
- The main button label has 6.95:1 contrast in Day and 8.86:1 in Night. Chess coordinates on the Night board rim have 8.22:1 contrast.

The full Games test suite passed on Node 24.21.0. The browser fit sweep measured all 72 games 1,224 times, with zero failures and zero browser errors.

The remaining sections record earlier layout work.

## Scope and approach

Small layout and contrast fixes, retaining the current artwork, colours, fonts,
game rules and network behaviour. No framework or animation dependency added.
The owner retired the project Giggle design skill; its two tracked files were
removed. The downloaded Impeccable and UI UX Pro Max skills informed scoped
usability checks. DESIGN_CONSISTENCY.md records the shared workspace pattern.

## Why the problems persisted

Several shared and per-game styles gave the same element conflicting sizes.
A generic short-panel rule forced active controls into a scrolling area, while
later game styles kept their larger fixed heights. An older utility translation
also moved the drawing full-screen button left of the viewport. Day ink was
being mixed with dark embedded card/status fills. Geometry-only checks missed
buttons entirely below the viewport and colour problems, so this pass also
uses screenshots, pointer actions and explicit primary-button checks.

## Changes

- Shared drawing desk: complete tool rows on phones; wrapping tools in the wide
  side rail. Canvas dimensions and pointer coordinates stay unchanged.
- Doodle Guess and Draw Phone: normal-flow title/menu/full-screen/report slots.
  Remove the old reserved left gutter and duplicated Draw Phone identity.
- Draw Phone: compact write screen keeps the input, Save and all three ideas
  together on the short phone.
- Draw Off and Sketchy Impostor: keep the existing square paper/frame and
  wide side rail; tools no longer cut at its edge. Drawing and gallery checked.
- Rank It: compact instruction and full-height tap targets; all five ranks and
  Lock ranking fit on the short phone. Tally space remains reserved.
- Know Me: compact hot-seat area and readable answer fills; all four choices
  remain visible before Lock my answer.
- Dial In and Ballpark: compact the instrument/number card rather than clipping
  its input or pushing the main action below the phone.
- Scattergories: five labelled input rows fit together; letter die stays inside
  its bounds.
- Banned Words, Letter Lock and Word Grid: fit active task controls as a unit;
  compact helper space. Word Grid retains 44px tiles and its Save action.
- Moonlit Village, Odd One Out, Undercover and Whisper: reserve the desktop
  roster column at a specificity that game styles cannot cancel; compact
  short-phone task/action rows.
- Pick One: smaller reserved result area and separate roster gutter, retaining
  the same slots through vote/reveal.
- Board games: full line height for turn text and titles, no fake scrollport on
  display:contents player wrappers. Fleet Duel tab labels fit their controls.
- Block Stack: focus ring drawn inside the playfield. Dice Fibs: room for the
  active cup's ring. Roulette labels do not intercept hits on other labels.
- Shared Day palette: inherit soft status fills and their text partners too;
  chess player cards now use Day surfaces when Day is selected.

## Framework and game logic review

The project already has reusable layers; it is not 72 fully independent apps.

| Shared layer | Source | Responsibility |
| --- | --- | --- |
| Registry and contract | `games/registry.js`, `games/_validate.js`, `games/_sdk.js` | Discover games, validate manifests/settings, provide shared context |
| Room lifecycle | `server/Room.js` | Membership, permissions, readiness, clocks, awards, reconnect and removal |
| Rule families | `games/engines/b2-party.js`, `b4-rounds.js`, `b6-round.js`, board engines | Shared round/timer/score and player-departure rules |
| Drawing input | `games/engines/drawing-input.js`, `b6-ink.js`, `public/js/games/b6-drawing.js` | Normalised strokes, ink revisions, rendering and input lifecycle |
| View lifecycle | `public/js/game-host.js` | Mount/update/dispose, stylesheet readiness and transition cleanup |
| UI composition | `public/js/kit.js`, `b2-party-kit.js`, `b6-kit.js`, `party-round-kit.js` | HUD, player strip, actions, results and input slots |
| Content flow | `games/engines/flow/` | Validated content definitions, seeded selection, phase/state transitions |

Draw Off and Sketchy Impostor share both round/ink engines and the batch view;
Know Me composes the shared party-round view. Draw Phone and Doodle Guess have
specific game flows but reuse the common host/input/platform infrastructure.
That is a useful boundary: the matching lifecycle should be shared, while
rules that genuinely differ can stay in their game adapter.

The main fault found in this pass was the CSS layer overriding those shared
slots with conflicting fixed heights and palettes. Fixes therefore stayed in
shared layout/control CSS plus small game-specific corrections. The rule,
privacy, stale-action, host-migration and full-match tests are the evidence for
logic behaviour; passing UI measurements alone would not establish that.
No speculative rule rewrite was made just to force every game into one engine.

## Measurements

Local Chrome, 1440×900, 1024×768, 390×844 and 375×667, Day and Night.
The catalogue audit rendered real game modules against initial server-projected
states: 72 games × 4 sizes × 2 themes = 576 measurements before and after.
Raw checker hits: **370 before → 4 after**. The four remaining hits are the
intentional ellipsis of Charlotte (you) in Story Builder at phone widths.
There are **zero actionable clipping/coverage/horizontal-overflow findings**
in those sampled states. Raw hits include repeated elements and checker false
positives; they are not counts of unique bugs. Random prompts can vary.

The supplied live practice checker was also run on the four drawing games.
Doodle Guess and Draw Phone passed 8/8 size/theme checks after real word/phrase
selection, pointer drawing, undo, menu open/close and a stable-clock check.
Draw Off passed drawing and gallery checks. Sketchy Impostor passed its opening
state. The existing drawing resize test sends actual pointer strokes, checks
normalised coordinates and verifies that ink survives resizing and Focus.

Screenshot sheets were reviewed for all 72 opening states on desktop/phone in
Day and Night; the affected screens were also opened at full resolution.

## Validation

- The full `FIT_PORT=18480 npm test` command ran through the Harbor Fork checks
  before the session interruption stopped it. The five unfinished commands
  were resumed in order: Foundry Wheel, container fit and the three telemetry
  checks. The broad browser check caught six failures at additional sizes:
  Rank It at 800×600 and Scattergories/Word Grid at 360×640, Day and Night.
  Those cases were corrected and rerun against the merged all-game result.
  Final merged browser result: **72 games, 1,224 measurements, zero failures,
  zero page errors**. Foundry Wheel and telemetry validation/client/browser
  checks all passed. This was a resumed suite, not one uninterrupted run.
- Targeted game layout, layout stability, visual regression, board view, batch
  2/batch 3 rule and party HUD checks passed after the layout changes.
- Framework, view host, room transitions and mount/focus tests passed.
- Real home create/join, search, drafts and phone/header browser checks passed,
  including 320×568; no home change was needed.
- Impeccable's final mechanical scan found one existing false positive: the
  two-stroke CSS chevron in the chess history summary was mistaken for a card's
  accent border. It is an arrow, so it was retained.
- `git diff --check`: passed.

## Limits

This is local Chromium desktop and phone emulation, not a physical iOS/Android
or Safari certification. The catalogue scan samples one opening state per game;
it does not certify every possible state of every game. Full-match tests and
additional live drawing states are separate coverage. Long secondary rosters,
logs and histories may scroll. No push, deployment, merge or branch switch.

## Per-game raw clipping/coverage counts

Each total combines the eight sampled size/theme combinations.

| Game | Before | After |
| --- | ---: | ---: |
| backronyms | 0 | 0 |
| ballpark | 2 | 0 |
| banned-words | 2 | 0 |
| block-stack | 4 | 0 |
| bluff | 0 | 0 |
| chain-reaction | 0 | 0 |
| charades | 0 | 0 |
| checkers | 8 | 0 |
| chess | 8 | 0 |
| clue-grid | 0 | 0 |
| color-clash | 0 | 0 |
| compliment-battle | 0 | 0 |
| countdown-word | 0 | 0 |
| dare-roulette | 16 | 0 |
| dial-in | 4 | 0 |
| dice-fibs | 4 | 0 |
| doodle-guess | 44 | 0 |
| dots-boxes | 12 | 0 |
| draw-off | 2 | 0 |
| draw-phone | 44 | 0 |
| echo-pads | 0 | 0 |
| emoji-spotter | 0 | 0 |
| emoji-story | 0 | 0 |
| five-row | 12 | 0 |
| five-second | 0 | 0 |
| fleet-duel | 10 | 0 |
| four-in-a-row | 16 | 0 |
| funny-answer | 0 | 0 |
| hot-potato | 0 | 0 |
| hot-takes | 0 | 0 |
| kalah | 8 | 0 |
| know-me | 8 | 0 |
| letter-lock | 2 | 0 |
| ludo | 72 | 0 |
| lyric-fill | 0 | 0 |
| math-dash | 0 | 0 |
| mega-tic-tac-toe | 12 | 0 |
| memory-tray | 0 | 0 |
| moonlit-village | 8 | 0 |
| most-likely | 0 | 0 |
| never-ever | 0 | 0 |
| number-hunt | 0 | 0 |
| odd-one-out | 10 | 0 |
| penalty-kicks | 0 | 0 |
| pick-one | 2 | 0 |
| pig-dice | 12 | 0 |
| pocket-karts | 0 | 0 |
| pose-party | 0 | 0 |
| rank-it | 8 | 0 |
| rapid-polls | 0 | 0 |
| reaction-tap | 0 | 0 |
| read-my-lips | 0 | 0 |
| reversi | 8 | 0 |
| roast-toast | 0 | 0 |
| scattergories | 8 | 0 |
| show-and-go | 0 | 0 |
| sketchy-impostor | 0 | 0 |
| snakes-ladders | 12 | 0 |
| story-builder | 0 | 4 |
| think-alike | 0 | 0 |
| trivia | 0 | 0 |
| truth-dare | 0 | 0 |
| twenty-questions | 0 | 0 |
| two-truths | 0 | 0 |
| typing-race | 0 | 0 |
| undercover | 2 | 0 |
| warm-words | 0 | 0 |
| whisper | 4 | 0 |
| who-wrote | 0 | 0 |
| word-chain | 0 | 0 |
| word-grid | 6 | 0 |
| would-you-rather | 0 | 0 |

## November 11 Day and Night update

Day now blends apricot and warm paper. Night blends forest green and olive with a marigold primary action. Both use a static background. The home artwork and catalogue entries appear together on first paint. Browsing, room controls and one-device play draw from the same palette. The browser toolbar follows an explicit theme change and a saved Night preference survives reload.

Chrome checks at 1440 × 900, 1024 × 768, 390 × 844 and 375 × 667 covered Day/Night switching, reload, the Chess details dialog and one-device setup. Both themes had zero horizontal overflow. The homepage browser suite also passed real room creation and joining, search, draft preservation and 320 px phone controls.

The full normal game test command passed. The browser fit check covered all 72 games, with 1,224 measurements and zero failures. The focused Chess review had zero clipping findings in its six desktop and phone captures. A two-player one-device Truth or Dare round also advanced from the spin to a playable card on both desktop and phone.

## One-device setup icons and modal scrolling

In the original picker, a 500 px wheel movement pushed the close button from y=34 to y=−466 in desktop WebKit. A wheel movement over the backdrop moved the setup page from y=100 to y=420. The shared dialog now keeps its heading in place, scrolls only its body, and uses a thin native thumb matched to the theme. The background stays at its original offset until the dialog closes.

Browser checks covered 1440 × 900, 1024 × 768, 390 × 844 and 375 × 667 in Day and Night, using Chromium and WebKit. The checks included wheel, touch, Page Down, keyboard focus wrapping, Escape, and selecting Reversi at the bottom of the catalogue. The same changes retained pinned Chess history on desktop and the history sheet on phones. The report and how-to dialogs also kept their background page still.

The one-device and online setup controls, report categories and kart picker use the rounded Phosphor duotone artwork already used by Giggle. The empty roster shows a seat. The 16 browser configurations passed, including full three-player one-device rounds, touch-sized controls, and theme changes.

## Pocket Karts driving and combat

The visual target was to identify a pickup from the chase camera, keep sight of the driver on a ramp and see what each press of Fire did. Tall Team’s published [Smash Karts screenshots](https://play.google.com/store/apps/details?id=com.tallteam.citychase) provided the side-mounted rocket reference. The [public game](https://smashkarts.io/) loads Unity WebGL. Pocket Karts keeps its existing Three.js renderer and shared driving simulation.

- The twelve item portraits come from the mounted models. The rocket rack loses a visible round for each shot, rear gear sits outside the spoiler, and the spinner circles the wheels. The HUD shows the award immediately, including its name, action and remaining uses. Confirmed fire, hits and knockouts keep their own feedback.
- A live Chrome drive collected a blaster from one pad. Its replacement appeared on a different pad. Three rockets flew up a 17° incline. After the rear-ground check was fixed, all three mines dropped on the same climb. A second rocket can knock out a full-health rival while the attacker still has a third round. The tracking blaster can turn toward a visible nearby rival beside or behind the kart.
- The outer ground now carries a small repeating surface texture. Hills and grouped trees move at different speeds against the distant peaks as the kart turns. In a matched Rookie Ribbons bridge view the final terrain took 45 draw calls, down from 48 in the first hills pass. The 128px texture adds 2,901 bytes. A 120-frame moving camera test on the M5 Mac held a median 16.7 ms per frame.
- The matched timing test used one rendered Chrome driver and three real WebSocket bot clients. At 1280×720, parked Rookie Ring HUD and room updates fell from 3,025 to 118 DOM changes per 3.2 seconds. While driving they fell from 2,634 to 33. The 95th-percentile frame interval stayed around 16.7–16.8 ms. This machine was already running close to 60 fps.
- The twelve mounted shapes, ammo counts, touch steering and simultaneous firing were checked in Chrome at 390×844 and 1280×720. Playwright WebKit rendered four karts in a normal room and drove 27.6 units. The phone tests used touch emulation on macOS. The item gallery used controlled grants. Pickup and uphill firing also ran through normal steering and Fire inputs.
- The declared GLB preload and decoder total 956,216 bytes. The two real-room loading checks on Rookie Ring and Rookie Ribbons fetched the gear during prefetch and made no additional GLB requests before driving.

The [play and performance plan](../../docs/pocket-karts-play-and-performance.md) records the asset process, weapon decisions, measured lag and the next physical-device playtest.

The 256 commands in the Games test chain passed across the main run and targeted reruns after fixes. The last full layout sweep covered 72 games and 1,224 viewport/state measurements, with zero failures or browser errors. A separate Dial In correction keeps both 56px turn buttons visible on short phones. Every one of its 56 spectrum pairs passed at 360×640 in both themes.

The shipping loadout passed 432 layout combinations, including narrow keyboard windows and wide touch screens. The classic and raised galleries each captured 144 states with zero browser errors. A real pickup drive confirmed the HUD on desktop and phone-size screens.


## In-game headers and controls — 12 November 2026

The normal public game entry cut off “Two Truths & a Lie” at 320px and squeezed “Mega Tic-Tac-Toe” beneath the Report icon. Immersive touch games also showed a second full-screen invitation above the same full-screen control. The shared header now keeps two 44px utilities: Room and Full screen. Report remains a labelled action inside Room. Flat-game icons have no resting fill; karts and 3D battle scenes keep a dark contrast surface. Drawing headers use the same two slots and safe-area padding. Full screen remains a deliberate tap, with the existing capability, iOS hint, busy, exit and failure behavior.

The complete game title fits the checked phone widths. The local one-device banner wraps its title and round metadata instead of cutting the round off. Closing Report now returns keyboard focus to the visible Room launcher. Controls, sound, theme and the host’s end-game confirmation remain available. The catalogue/card changes are separate from this work.

The browser pass also found a real short-landscape board defect: at 568×320, Chess’s stacked height budget left a tiny board and player names with zero width. Simple boards now place a usable board beside the roster, status and tools below the shared title row. Mega’s turn instruction and next-board hint have enough reserved height to remain visible. Its header icons remain flat on the light board surface.

Validation used the normal public room/setup UI with real WebSocket companions, not injected game snapshots. `test/game-header-browser.cjs` passed 120 Chrome game/size/theme cases: twelve public games at 320×568, 375×667, 390×844 and 1280×800 in Day and Night; three signed cross-origin embedded games; and six local one-device cases. The public games were Two Truths & a Lie, Never Have I Ever, Compliment Battle, Would You Rather, Clue Grid, Doodle Guess, Draw Phone, Number Hunt, Reaction Tap, Mega Tic-Tac-Toe, Chess and Pocket Karts. It checked full title bounds, transparent flat-game controls, real tap targets, Report/Controls focus recovery, sound, theme, end confirmation and supported full-screen entry/exit. Chrome recorded no page or console errors.

Playwright WebKit passed 48 cases across the longest standard title, drawing, Mega, signed frames and local play. It recorded nine known guarded cross-origin frame-access diagnostics. The same messages reproduce on unchanged commit `c8844e1c`; a smaller-height comparison also reproduced the same ResizeObserver notification on both versions. These diagnostics were recorded separately, and the actual menu/game flows worked. This is macOS browser testing with touch emulation, not a physical iPhone claim.

`test/board-landscape-browser.cjs` passed 90 checks with real legal Chess moves through Fool’s Mate, final controls and rematch, Ludo controls, and actual Mega cell taps in portrait and short landscape. Its assertions now inspect the visible board/roster/actions and the native Rules dialog, rather than requiring the obsolete `.bk-panel` wrapper or inline disclosure. `game-screen-ui.mjs`, `game-screen.mjs`, `modal-game-input.mjs`, and the play-shell fixture’s 29 source checks passed. The combined full suite is owned by the coordinating agent.

The optional matrix is available as `npm run test:game-header:browser`; it stays outside the default suite like the existing browser matrices. `GAME_HEADER_BROWSER=webkit` selects WebKit, `GAME_HEADER_GAMES` narrows the public families, and `GAME_HEADER_EVIDENCE` saves screenshots and JSON.

Local evidence is in `/tmp/giggle-game-header/`: `final/report.json`, `webkit-final/report.json`, `board-results/`, and the matching `before-final-*.png` images from `c8844e1c`. Representative final captures are `final-mega-320-day.png`, `final-mega-390-day.png`, `final/public-two-truths-320-night.png`, `final/public-doodle-guess-390-day.png`, `final/public-pocket-karts-390-day.png`, `final/local-two-truths-375-day.png`, and `board-results/chess-live-568.png`. These are local QA artifacts, not published assets.

## Game catalogue and room picks on phones

The whole entry now opens the game guide or setup. The Pocket Karts art, name, description and player count fit in one row. The old Play badge duplicated that action and the 3D label covered the thumbnail. Home recommendations, the catalogue and the room now use the same entry. Keyboard focus marks its full width.

| Phone width | Previous Pocket Karts row | Updated row |
| --- | --- | --- |
| 320 pixels | 201 pixels | 124 pixels |
| 390 pixels | 183 pixels | 88 pixels |

The catalogue and guide checks passed in 18 desktop, tablet and phone layouts. In 12 additional WebKit and Chromium runs, two browser players joined a local room, opened the recommendations and full catalogue, and selected a game. The card art stayed inside its frame in both appearances. A separate Number Hunt check found zero clipped or covered elements across four viewport sizes in Day and Night.

The full 259-command Games suite passed. Its container check measured 72 games in 1,224 layouts with zero failures or browser errors. The separate portrait and short-landscape board playtest passed 90 checks on the final board layout.

## Pocket Karts practice, maps and pickups

The practice toolbar used three heavy outlines on its player counter and stacked the number above its label. The revised controls keep the count on one line and use a single primary Play action. In the match, the pickup display also moves above the kart in a narrow keyboard window. The layout checker found zero cut or covered elements at 375, 390, 1024 and 1440 pixels. The checks included the night theme at 390 and 1440 pixels.

All 18 battle arenas now allow 2–32 drivers. The recommended party size appears on the map card. The results screen lets the host change arenas. All 558 combinations started. Each of the 160 extra starting positions on smaller raised maps passed a six-metre departure test. On the older raised maps, 96 original starts also passed a 20-metre clearance check and a full-throttle drive. The original free-driving and touch measurements are in the Pocket Karts playtest report.

The player used to disappear behind a low barrier or a decorative light post on Rookie Ring. On Neon Harbor, a nearby decorative light could fill the screen. The camera now checks visibility of the body and wheels near low walls; nearby decorative lights fade. A moving cannon entry also stays outside the kart. The visual checks covered all 18 map families; the full camera test included 22 desktop and phone shots. On older raised maps the ground outside the arena now meets the existing foothills.

Meshy supplied eight new pickup models and the shared mystery-crate shell. Three earlier Meshy models remain in use. The fake crate borrows its appearance from the real pickup. The HUD portraits come from the equipped meshes. Controlled browser checks exercised all 12 pickups on a keyboard and on an emulated touch screen, including driving into an actual crate and triggering the item. The test selected the next reward so every item could be checked.

## Practice, one-device setup and shared game controls

Practice uses the original cover art, text tabs and a single Play action. At 390 pixels the selected game panel went from about 338 pixels high to 128. The setup bar fits in 56 pixels at both 375 and 390 pixels. At 320 pixels it wraps into two rows with full touch targets. Keyboard navigation follows the visible category, including Home and End. The browser checks selected all 72 titles in each theme and played Trivia, Chess and Pocket Karts.

One-device setup now shows the selected game's rules summary and actual player range. On desktop, Start sits beneath the player names. On phones it stays within reach as the settings scroll. The Hide button previously split onto two lines even on desktop. It now holds its full label in a 44-pixel touch target. The round number stays together. Result colours, focus rings and pressed states are still visible with the thinner borders.

A browser check followed 26 screens at 390 and 1280 pixels, including a private vote and a two-browser Four in a Row match. Neither width had page overflow or browser errors. Another check played a full three-person Truth or Dare round using both random cards and custom questions at all four sizes and in both themes, and mounted all 21 one-device games. The final Pocket Karts clipping check found zero clipped or covered elements in all eight viewport/theme combinations. The final Meshy assets held 60 fps on an Apple M5 during the keyboard and touch driving samples. A stock Practice preview also loaded the arena and two connected seats over the Wi-Fi address in Mac WebKit. Physical phone performance is unverified.

Shared-device games now identify people by name through a handoff, reveal and final score. Online players keep their own seat marker. In a two-player Four in a Row match, the active seat moved from Ada to Bo after the move. The 390-pixel Would You Rather vote counter uses 58 pixels of its 89-pixel slot.

The complete 262-command Games suite passed on the final application commit, including the new shared-seat regression, all 72 games in 1,224 layout measurements, the generated kart bundle check and the telemetry browser flow. The automated layout sweep reported zero failures and zero browser errors.
