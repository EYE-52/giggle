# Text game presentation

## Game kit (start here)

Every game screen uses the same standard components
(`specs/GAME_UI_STANDARD.md`). They live in `public/css/game-ui.css`
(loaded on every page; the class list and markup are documented at the top
of that file) and `public/js/kit.js` prints them:

| Component | Classes | Helper (`public/js/kit.js`) |
| --- | --- | --- |
| Column / surfaces | `gk-col` (760px), `gk-stack`, `gk-card`, `gk-reserve` | – |
| HUD row | `gk-hud` > `gk-hud-round`, `gk-hud-phase`, `gk-hud-progress`, `gk-hud-timer` (`.is-urgent`) | `hudHtml({ round, phase, progress, timer })`, `roundLabel(2, 5)` → "Round 2 of 5", `progressText(2, 4)` → "2 of 4 locked in" |
| Prompt and meta | `gk-prompt`, `gk-sub`, `gk-meta` | – |
| Buttons | `gk-btn` (secondary), `gk-btn gk-primary` (48px, accent), `gk-btn gk-quiet`, row `gk-actions` | – |
| Choices | `gk-choices` (`--gk-cols`, `--gk-cols-phone`, `.is-locked`) > `gk-choice` (`.is-selected` or `aria-pressed="true"`, `.is-correct`, `.is-wrong`, `.is-dim`) > `gk-mark`, `gk-choice-text` | `choicesHtml(options, { locked, cols })` (buttons carry `data-choice`) |
| Input row | `gk-input-row` > `gk-input` + `gk-btn gk-primary` | `inputRowHtml({ id, label, button })` |
| Waiting line | `gk-wait` (`.is-done`) | `waitingHtml(2)` → "Waiting for 2 players" |
| Round result / final scores | `gk-results` > `gk-results-title`, `gk-winner` (`.is-tie`), `gk-ranks` > `gk-rank-row` (`.is-top`, `.is-you`, `.is-left`) > `gk-rank`, `gk-name`, `gk-pts` | `resultsHtml({ title: 'Final scores', scores, players, you })`, `rankRows()`, `winnerLine()` |
| Game over screen | `gk-final` (no HUD row) > `gk-results` + `gk-final-note` | `finalHtml({ scores, players, you, note, watching })`, `paintFinal(el, opts)` (repaints only when the result changes, so the shell's Rematch row keeps focus) |
| Live timer | the HUD's `gk-hud-timer` | `syncHudTimer(el, S, api)` after every render (ticks on `api.now()`, `.is-urgent` at 5 s, empty in result phases), `stopHudTimer(el)` in `dispose()`; set `ownsTimer: true` so the shell's bar stays hidden |

Rules the kit already follows, so use it instead of re-inventing: tokens
only, one accent (`--accent`) for primary actions and selection, 1px
borders, 12px radius, controls at least 44px (primary 48px), the HUD timer
slot is always printed so the row never shifts (one timer presentation:
every standard game shows its clock there, never the shell's bar), every
game ends on the same `finalHtml` block, equal points share a rank
(1, 1, 3), a tied win says "It's a tie: Ann and Bo", the viewer's row is
highlighted. Inside `#gbody` the older sticker styling is switched off
(`--hard: transparent`, no hover lifts), so screens are flat by default.

## Ending and leaving (rules plumbing)

The room implements `specs/GAME_RULES_STANDARD.md`; games only add hooks.

- **Settings**: put `roundsSetting({ def, autoLabel })` and `paceSetting()`
  from `games/_sdk.js` first in `manifest.settings`. Scale every timer with
  `paced(ctx, seconds)` / `pacedMs(ctx, seconds)` (Relaxed ×1.5, Normal ×1,
  Quick ×0.67, whole seconds, at least 3). Board duels may add
  `moveTimerSetting()` and read `moveSeconds(ctx)` (0 = Off).
  `_validate.js` rejects a `rounds`, `pace` or `moveTimer` setting with a
  different label or options.
- **End game** (host, Room drawer, every layout): the room cancels pending
  game timers, keeps every point already given with `ctx.award`, and calls
  the optional `def.onEnd(state, ctx, { reason })` (`reason` is `'host'`,
  or `'players'` when too few players remain). Award whole-match points
  there and move to the `'done'` phase, so the game's own final screen
  shows. Without `onEnd` the match freezes (no ticks, no actions) and the
  shell shows a generic **Final scores** list (the view's `scores` keyed by
  player id when present, else the points awarded in this match).
  Snapshots then carry `matchEnded: true` and `matchPoints`. `ctx.ended()`
  is true from then on. Afterwards the host sees **Rematch** and
  **Change game** (shell footer `#rematch`, or the game's own buttons via
  `api.rematch()` / `api.lobby()`).
- **Leave** (everyone, Room drawer): the seat stops playing at once. The
  room calls the optional `def.onPlayerGone(state, ctx, pid, 'left')`
  (fallback: `def.onConnection(state, ctx, pid, false)`). The seat stays in
  the roster and `players[]` (marked `left: true`, `connected: false`), but
  it is not in `ctx.players()` and its actions are ignored. Standalone, the
  seat is given up and the player goes home. Inside Giggle the seat stays
  in the call's room: the frame shows the game picker ("…is being played",
  with Watch) and plays the next game. A host who leaves the match hands
  hosting to someone still playing.
- **Away**: a match member who stays disconnected for 60 seconds triggers
  `def.onPlayerGone(state, ctx, pid, 'away')` once per match; reconnecting
  in time cancels it. Use it to forfeit a duel, drop a racer or skip a turn.
- When fewer than two players are still playing (in a one-player game:
  nobody), the room ends the match itself (End game with
  `reason: 'players'`).
- Views can call `api.endGame()` and `api.leave()` for game-owned menus;
  words are always "End game", "Leave", "Rematch", "Change game",
  "Final scores".

## Game size ("− 100% +")

Standard-layout games get a size control in the play toolbar, next to
Room (`public/js/zoom.js`): 80, 90, 100, 115 and 130%, tap the percentage
to reset to 100%. It sets CSS `zoom` on `#gbody` only, so the toolbar and
Room stay put, the playfield still fills its column, and pointer
coordinates stay right (checked for the Doodle Guess and Draw Phone
canvases at 80% and 130%). The choice is stored per device with the
seat-aware `store` (`pb_zoom`); without a choice a small frame starts at
90% (under 520px wide or 560px tall) or 80% (under 520px tall, or a
phone under 400×600). Full-screen games (boards, 3D, framed games) keep
100%: they already fit their board to the viewport. A game that hides
the toolbar title (the drawing desks) also keeps 100%. Keep your layout
in normal flow (no `position: fixed` panels sized in viewport units)
and it zooms cleanly; Ctrl/Cmd +/− stay the browser's.

## Older notes

The platform provides room controls and a catalog; every game owns its visual language, HUD and input. `manifest.layout: 'immersive'` gives a game its own viewport with platform controls in an optional room drawer. `standard` (the default) supplies a slim game title/room toolbar and a scrolling game surface. It adds no enclosing title card or permanent night-score footer. Rendering technology is a separate choice, so any DOM, canvas or 3D game can use either layout.

`public/css/game-ui.css` holds the game kit above plus flat defaults for the older shared text-game classes under `#gbody[data-layout="standard"]`. Its broad font/control rules and those in `style.css` never match immersive views (the `gk-*` kit classes work in both layouts). Other game-specific interfaces keep their own geometry and can adopt immersive layout when appropriate.

Prompts use flat panels, answer cards use 1px borders and the accent for selection, text inputs and buttons wrap into usable rows, and score/history rows wrap long content. Poll tracks stay on rows with actual `.fill` markup; plain history/ranking rows no longer show empty poll tracks. Zero-percent poll fills have no artificial minimum width. The existing 28px desktop / 24px phone prompt typography remains in place.

Word Countdown uses a real nine-column tile grid with static letter tiles, including at 390px. The input has an accessible name, Enter locks in, and the locked-player count updates without rebuilding the word input. Memory Tray uses a four-column desktop / two-column phone word grid, shows the configured memorize duration, and permits enough recall text for all eight maximum-length custom items.

20 Questions retains its separate question-desk stylesheet. Its newest-first filtered history has its own keyboard-focusable scroll box. Pending-answer controls wrap inside narrow desk columns, and optional hints disclose both the two-hint cap and their 50-point cost.

20 Questions uses original inline SVG thumbs-up, thumbs-down, and shrug art on answer buttons, filters, and history pills. The named `answerIcon()` export reuses the same shapes with theme colors and ink outlines. Text labels remain explicit, and the art is hidden from screen readers. No bitmap assets or animation are required.

Doodle word choices become one column on phones. Doodle and Draw Phone use native keyboard-operable color buttons with names, selection state, and 44px targets. Input fields have accessible names or associated labels. Typing Race adds immediate plain-language correctness/error feedback and an underline on incorrect characters, alongside its existing color feedback.

Validation: Node 24 full-suite checks include all 35 legal complete playthroughs,
race/clock/media/bridge regressions and game-specific rules. Muse Spark 1.3
Contributor MAX supplied parallel implementation/review work and a static markup
audit of the 33 games present before Chain Reaction and Warm Words were added.
All 35 game layouts were subsequently captured and visually reviewed at desktop
and 390px phone width. Primary actions, narrow forms, the drawing canvas, dense
boards and bounded histories received direct browser checks; 20 Questions also
received an interactive custom-30Q/hints/filter/rematch check. The clean release
is deployed and hosted multiplayer checks pass. Browser screenshots establish
layout behavior, not physical touch or real Agora camera/microphone acceptance.
Exact evidence and remaining manual checks are recorded in `RELEASE_REPORT.md`.

## Browser game autonomy (Game Kit 0.1.2)

Game-owned home pages and standalone browser bundles are supported in addition
to module views. No platform stylesheet is injected into these documents.
Use `manifest.homepage: true` for `games/<id>/home/index.html`, and
`runtime: { type: 'frame', entry: 'index.html' }` for an export under
`games/<id>/browser/`. Renderer labels are descriptive, not an engine enum.
`npm run new-game -- my-world --template frame` creates the working paths.
The optional `createGameClient` bridge exposes snapshots, validated intents,
calibrated time and parent-call voice without duplicating room transport.
See `GAME_AUTONOMY_GUIDE.md` for the contract and verification.

## Phone input and game-owned layouts

Every playable action needs a visible tap equivalent. Keyboard shortcuts and
hover may supplement it. A game owns those controls: steering and hold buttons
for Karts, tap-to-select/move for Chess, one-contact strokes for drawing, native
answer buttons for text games, and orbit/pinch/tap for the Castle scene.

Use pointer IDs, capture where appropriate, and ignore unrelated releases.
Clean held input on blur, hidden documents, capture loss, cancelled pointers,
orientation changes, phase changes and disposal. Never turn a cancelled orbit
or pinch into a build/fire action. `createInput` and `createArenaControls` are
optional reusable helpers; they do not force a shared HUD or renderer.

Keep primary controls at least 44 CSS pixels, allow ordinary scrolling and
pinch zoom outside gesture surfaces, and preserve focused fields, draft values,
selections and IME composition across snapshot updates. Inputs use phone
keyboard hints without requiring Enter to submit. Soft keyboards still need
physical Safari/Android testing; desktop viewport resizing cannot prove that.
Use `100dvh`, `viewport-fit=cover` and safe-area insets for edge HUDs. Test narrow
portrait and short landscape; hiding secondary statistics is preferable to
shrinking every control or covering the world.

Karts offers optional Auto gas so two thumbs can steer, drift and fire. Brake
and reverse override it, and leaving the driving view resets it. Castle's short
landscape HUD keeps the tap toolbelt and camera/help controls around the
battlefield. Rules remain in Help when the first-match strip is collapsed.

## Live HUD boundary (0.1.7)

The platform keeps room membership, invites, sound/theme, host controls and
cumulative night totals in a compact Room drawer. Standard games receive a
slim title toolbar; immersive games receive a 96 × 44px launcher with a 112px
top-left clearance. Opening the drawer must not enlarge that launcher.
On portrait phones the same clearance contains two 44px icon buttons:
Room and Play landscape. Neither adds another row over the playfield.
The playfield owns its objective, role, phase, round, action feedback and style.

Use one primary live instrument and a small optional secondary cluster. Keep
rare instructions, move history, full standings and armory details in native
disclosures. Their open state, focused inputs, drafts and composition must
survive fresh snapshots. Show actual match scores only when the engine
projects them; cumulative room awards belong in Night totals.

Use the calibrated server clock. Games with an owned timer set `ownsTimer`;
others receive the thin platform deadline line. Neither reveal nor final
results should show an active leftover deadline. Chain's next-turn clock
stays hidden while its ordered cascade is replaying.

Each game can use different materials, colors and instruments. Karts uses
a racing strip, speed/drift readout and weapon silhouettes; Castle uses
faction banners and a build/siege toolbelt; Chess uses opposing clocks;
drawing games use canvas-aligned tools; quiz and social games use role and
lock-in cues. A game is free to replace the whole interface.
