---
name: giggle-design
description: "The Giggle Games \"soft arcade\" visual system: one clean playful base (soft rims, candy buttons on their own-colour lip) plus a hand-crafted skin per game in light and dark, colour per game, springy motion on one curve, named text styles, a fixed spacing scale, the full interactive state set, one primary action per panel, phone rules, and an anti-slop review checklist. Use it whenever you build, restyle, review or screenshot-check any screen in apps/games (home, lobby, practice, a game's HUD, board, results, dialogs), even for a one-line CSS change, and before choosing any colour, size, spacing, radius, shadow, transition or button style there."
---

# Giggle design: soft arcade, skinned per game

Giggle is a party-game site. A screen should feel like a box of good toys:
bright, solid, a little bouncy, and obvious to use the first time. It should
never feel like a SaaS settings form with a game drawn inside it.

The tokens and components live in `apps/games/public/css/style.css` (tokens,
`.tb-*` components) and `apps/games/public/css/game-ui.css` (the `.gk-*` game
kit). `apps/games/DESIGN_TOKENS.md` lists every token and class with a
before/after example. Every value you write resolves to a token from there.
If you need a value that is not a token, you are probably solving the wrong
problem; if you are sure, add the token in `style.css` and the doc in the
same change.

## Scope

All UI in `apps/games`: platform pages, game screens, dialogs, and game art
that sits next to UI. Per-game CSS files may add game art (boards, pieces,
scenes) freely, but the controls around that art use these rules. When the
user's prompt conflicts with a rule, the user wins.

## 1. The look in one paragraph

One clean, playful base everywhere (think Duolingo), and a hand-crafted skin
per game on top. No black ink outlines: rims are soft (`--outline` is a pale
tint in Day and a near-black lip in Night), and cards and buttons sit on a
straight-down "lip" (`0 4–6px 0`) instead of a black offset shadow. Coloured
controls sit on a darker lip of their own colour (`--fam-lip`) and sink onto
it when pressed, like candy buttons. Rounded but not pill-shaped panels;
Baloo 2 for anything loud, Nunito for anything you read. Colour comes from
the game (its skin), not from decoration. Gradients and patterns are allowed
on game art, scenes and backdrops, not on controls or text panels. Every
screen works in Day and Night; Night follows the device until the player
picks.

**Skins.** `public/css/skins.css` gives every game its own `--fam`/`--accent`
colours and page tint (`--bg`), with a Night version, keyed on
`body[data-game="<id>"]` (set by app.js while a game plays). A game's own
CSS adds its scene and signature piece (racetrack lanes, quiz-show stage,
wooden chess board, sketchbook paper), also keyed on `body[data-game]`, with
a `[data-theme="night"]` variant. Shared controls never change per game.

## 2. Colour

Keep both themes working: Day (`:root`), Night (`[data-theme="night"]` on
`<html>`) and Inside Giggle (`body.is-embed`). Never hard-code a hex in a
component; use a token so all three resolve.

- **Ground and ink:** `--bg`, `--card`, `--well`, `--ink`, `--ink-dim`,
  `--line`, `--line-strong`, `--outline`.
- **Family colour.** Each game belongs to one family. Set it once on the
  game's root element and every `.tb-primary`, selected chip, segmented
  choice, turn badge and tinted card picks it up:

  | `data-family` | Games | Day colour |
  |---|---|---|
  | `board` | chess, checkers, reversi, four-in-a-row, kalah, ludo, fleet-duel, memory-tray, castle-clash | teal `--fam-board` |
  | `party` | trivia, would-you-rather, most-likely, never-ever, hot-takes, two-truths, bluff, rapid-polls, rank-it, pick-one, funny-answer, compliment-battle, roast-toast, truth-dare, dare-roulette, five-second, story-builder, emoji-story, twenty-questions | raspberry `--fam-party` (default) |
  | `create` | doodle-guess, draw-phone, charades, pose-party, show-and-go, word-chain, warm-words, countdown-word, scattergories, lyric-fill | sky `--fam-create` |
  | `arcade` | pocket-karts, reaction-tap, typing-race, number-hunt, chain-reaction | orange `--fam-arcade` |

  Components read `--fam`, `--fam-deep` (text on soft fills), `--fam-soft`
  (tints) and `--on-fam` (text on a `--fam` fill).
- **Status colours:** `--success`, `--danger`, `--warning` with `-soft` and
  `--on-` partners. Status colour means status. Never use `--danger` as
  decoration or `--success` as a brand colour.
- **Player colours** belong to the game (pieces, avatars). Do not reuse a
  player colour for a control, or a player will think the button is theirs.
- Text on a fill uses its `--on-*` partner. Body text never sits on a
  saturated family fill; use `--fam-soft` behind text.

## 3. Sticker shapes

- **Card** (`.tb-card`): `--card` fill, a soft 2px rim (`--outline`),
  `--radius-xl` (24px), a straight-down lip (`--shadow-sticker-lg`),
  `--space-24` padding (`.is-compact`: 16px). `.is-tint` uses `--fam-soft`.
  A clickable card lifts 2–3px on hover and sinks onto its lip on press.
- **Button** (`.tb-btn`): soft 2px rim, `--radius-lg` (16px), a 2px
  (secondary) or 4px (primary) lip it sinks into on press. Coloured buttons
  use `--fam-lip` (a darker shade of their own fill) for rim and lip.
- **Borders go all the way round or not at all.** No one-sided card borders.
- **Lips go straight down.** Never a diagonal offset shadow, never black ink
  around a control. Soft blurred shadows (`--shadow-card`) are only for
  floating layers: dialogs, toasts, popovers. In Night a subtle glow may mark
  the one thing that matters (your progress, the active player, an error).
- **Nested radius.** When a shape sits inside another and the gap is under
  32px: `inner = outer − gap`. Only apply when the result is above 2px;
  otherwise square the inner corner. Example: a 16px segmented track with
  4px padding gives 12px buttons. A 24px card with 16px padding gives 8px
  inner tiles.
- Tilts (`rotate(±1–2deg)`) are for decorative stickers and labels only,
  never for text you must read quickly, buttons, or board cells.

## 4. Type

Two fonts, already self-hosted: Baloo 2 (`--font-display`) and Nunito
(`--font-body`). No third font. Weights 600–800; no 900.

Every piece of text uses one named style. Use the token (`font:
var(--text-title)`) or the class (`.t-title`).

| Style | Token / class | Font | Size / line | Use |
|---|---|---|---|---|
| heading | `--text-heading` `.t-heading` | Baloo 2 800 | 26–34 / 1.15 | One per screen: the prompt, the question, "Your turn" |
| title | `--text-title` `.t-title` | Baloo 2 800 | 20 / 1.25 | Card titles, panel titles, player name in a turn banner |
| body | `--text-body` `.t-body` | Nunito 600 | 17 / 1.5 | Running text, answers, rules |
| button | `--text-button` `.t-button` | Baloo 2 800 | 17 / 1.2 (primary 19) | Text inside buttons |
| button-sm | `--text-button-sm` | Nunito 800 | 15 / 1.2 | Chips, segmented options, small toolbar buttons |
| caption | `--text-caption` `.t-caption` | Nunito 700 | 13 / 1.4 | Counts, timers' labels, helper text, badges, disabled reasons |

`h1` keeps its existing clamp for page heroes. Headings get `text-wrap:
balance`, body gets `text-wrap: pretty`. Sentence case everywhere. Numbers
that change (scores, timers) use `font-variant-numeric: tabular-nums`.

## 5. Spacing

Only `--space-4, 8, 12, 16, 24, 32, 40, 48, 64`. Nothing between, nothing
outside. Gaps inside a control: 8. Between controls in a row: 8–12. Card
padding: 24 (16 on phones or `.is-compact`). Between sections: 32–48.

Control heights: 44px floor (`--control-h-sm`) for anything tappable, 48px
for normal buttons (`--control-h`), 56px for the primary (`--control-h-lg`).

## 6. Buttons and the primary-action rule

Variants: `.tb-btn` plus one of

- `.tb-primary`: family fill, 56px, 4px lift. **One per panel.** It is the
  thing the player is most likely to do next ("Lock in", "Fire", "Start
  round"). Put it where the thumb is: bottom of the panel on phones.
- `.tb-secondary`: card fill. At most two beside a primary.
- `.tb-chip`: pill, 44px, no lift. For filters, options, settings, toggles,
  "Skip", "Hint", "Rules". Selected chips use `aria-pressed="true"`.
- `.tb-icon`: 48px square (with `.tb-chip`: 44px round). For sound, zoom,
  close, menu. Always has an `aria-label`; add a visible label on desktop
  when there is room.
- `.tb-danger`: `--danger` fill for "Leave", "End game", "Kick". Ask before
  it acts.
- `.tb-seg`: a segmented toggle for 2–4 mutually exclusive options
  (difficulty, mode, board size). Never a row of equal buttons for this.

If a panel has more than one primary, or more than three equal-weight
buttons, it is wrong: pick the main action, demote the rest to chips or
icons, or move them into the room menu.

## 7. The state set

Every interactive element ships all of these. Missing states are bugs.

- **Hover** (only inside `@media (hover: hover)`): lift `translateY(-2px)`
  or a rim colour change. Touch taps must never leave a stuck hover.
- **Active**: sink onto the shadow (`translateY(var(--tb-lift))`, shadow
  removed) or `scale(0.96–0.98)` for flat controls.
- **Focus-visible**: `outline: var(--focus-ring); outline-offset:
  var(--focus-offset)`. Never remove an outline without replacing it.
- **Disabled, with a reason**: `:disabled` or `aria-disabled="true"` turns
  the control grey and flat with `cursor: not-allowed`, and a `.tb-reason`
  caption next to it says why in plain words ("Wait for Ann to finish",
  "Pick a square first"). A disabled button with no reason is a bug.
- **Loading**: `aria-busy="true"` on a button keeps its size and shows a
  pulsing bar. Areas that are loading show `.tb-skeleton` blocks shaped like
  the real content. No spinners.
- **Empty**: `.tb-empty` or `.gk-wait-card`: who or what we are waiting for,
  and what happens next. Never a blank panel.
- **Error**: inline, next to the thing that failed, says what to do next.
  Never `alert()`.
- **Selected / correct / wrong** on choices: `.gk-choice` states, or
  `aria-pressed` on chips. Colour plus a mark (check, cross), never colour
  alone.

## 8. Motion

- One curve: `--ease` = `cubic-bezier(0.22, 1, 0.36, 1)`. Never `ease`,
  `linear` or `ease-in-out`.
- Durations: `--dur-quick` 200ms (press, hover), `--dur-base` 300ms (cards,
  panels), `--dur-slow` 500ms (screen-level entrances).
- **Only `transform` and `opacity` animate.** Colour, border and shadow
  changes are instant. Never animate `top`, `left`, `width`, `height`,
  `margin` or `box-shadow`.
- Springy comes from shape, not from the curve: a press sinks 2–4px, a
  hover lifts 2–3px, a new item pops from `scale(0.96)` to `1`, a correct
  answer bounces once. One-shot, never looping, except a waiting pulse.
- Board moves, score changes and turn changes get feedback. Repaints from
  the server never replay an entrance.
- `prefers-reduced-motion: reduce` removes movement; opacity changes may
  stay. `style.css` already kills animations under reduced motion; do not
  re-enable them with `!important`.

## 9. Phone rules

- Check at **390px** wide (and 320px for text-heavy screens): no horizontal
  scroll, no clipped button labels, primary action visible without
  scrolling on the play screen.
- **Floating controls never cover the board.** The room menu, report
  button, rematch bar, toasts and HUD sit outside the playfield or reserve
  their own space (padding on the playfield, not an overlay on cells). If a
  floating thing can sit on a tappable cell, it is a bug.
- Board games fit the board to the viewport: `min(100%, 100dvh − chrome)`,
  square cells, nothing scrolls during a turn.
- Tap targets 44px or more, 8px apart. Thumb actions live in the bottom
  half.
- Respect safe areas (`env(safe-area-inset-*)`) on fixed elements.
- Changing state (timer ticking, "waiting" to "your turn") must not move a
  tap target. Reserve the space (`.gk-reserve`, fixed min-heights).

## 10. Copy

- Say what is happening and what to do: "Your turn: tap a square to fire",
  "Waiting for Ann", "3 of 4 locked in". Short, specific, in the game's
  words.
- **Banned filler:** "Let's get started", "Get ready for fun", "Awesome
  experience", "Seamless", "Unleash", "Level up your", "Welcome to the
  game", "Click here", "Submit", "Lorem", "Coming soon" on something that
  exists, "Something went wrong" without the next step.
- Exclamation marks are allowed for real moments (a win, a hit, a correct
  answer). Not on instructions, errors or buttons.
- Buttons are verbs: "Fire", "Lock in", "Play again", "Copy invite".
- No placeholder players ("Player 1") when a name is known. No invented
  stats.

## 11. Anti-slop checklist

Review every screen against `review-rubric.md` in this folder (it is phrased
so a model can grade screenshots HIGH / MED / LOW). The short version:

- [ ] There is one obvious thing to do, and it is the biggest, brightest
      control.
- [ ] Not a row of identical white buttons. Options are chips or a
      segmented toggle; tools are icons.
- [ ] The playfield looks like a game (texture, pieces, colour, a frame), not
      an empty grid on a blank page.
- [ ] Family colour is present and consistent; status colours mean status.
- [ ] Sticker treatment is consistent: outlines, offset shadows, radius from
      the tokens; no mix of flat 1px boxes and stickers on one panel.
- [ ] Every text uses a named style; hierarchy reads in two seconds.
- [ ] Spacing is on the scale and even; no cramped or floating clusters.
- [ ] Whose turn it is and what changed are visible without reading small
      text.
- [ ] Disabled controls say why; empty areas say what we wait for.
- [ ] Nothing overlaps the board; nothing overflows at 390px.
- [ ] Copy is specific; none of the banned filler.
- [ ] Day and Night both look intentional.

## 12. Workflow

1. Pick the family; set `data-family` on the game root.
2. Find the primary action for each state (setup, my turn, their turn,
   result). Everything else becomes chips, icons or the room menu.
3. Build with `.tb-*` / `.gk-*` classes and tokens. Per-game CSS only adds
   game art and layout.
4. Screenshot at 1280×800 and 390×844, Day and Night, in each state.
   Grade with `review-rubric.md`. Fix every LOW before shipping.

---

## Credits

The disciplines in this skill (a fixed spacing scale, named text styles, the
nested radius formula, the full interactive state set, one motion curve with
transform/opacity only and reduced motion, the 390px check, and the ban on
filler copy) are adapted from the `landing-page-design` skill in
[elayadesign/ai-design-skills](https://github.com/elayadesign/ai-design-skills),
MIT licensed, Copyright (c) 2026 Elaya. Its SaaS-specific rules (grey-only
palette, no gradients, a single typeface, no exclamation marks) were
deliberately not adopted: a party-game site needs colour and bounce.
