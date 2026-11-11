# Giggle Games UI polish — 11 November 2026

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
