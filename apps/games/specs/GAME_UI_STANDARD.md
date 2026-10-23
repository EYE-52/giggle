# Game UI standard

Every Game Night game should look and feel like a finished, first-class product: clean, calm, professional and bug-free. Not fancy. A clear focus, balanced space, readable type, the same controls and states in every game, and no visual bugs. This page is the bar every game screen is checked against.

## One look

- **Flat and quiet.** Surfaces use `--card` / `--well` with a 1px `--line` border and a 10–14px radius. No hard offset ("sticker") shadows, no tilted labels, no notches or torn-ticket effects. A soft shadow (`--shadow-card`) is allowed on a single raised element, such as a dialog.
- **No painted backgrounds or bitmap scenery.** Game screens are built from colour tokens, CSS and inline SVG. Bitmaps are only for real game pieces where a drawing would be worse (for example chess piece sprites). Boards use flat colours, not wood or stone textures.
- **Tokens only** for UI chrome: `--bg`, `--card`, `--well`, `--ink`, `--ink-dim`, `--line`, `--line-strong`, `--accent`, `--accent-soft`, `--accent-ink`, `--green`, `--melon`, `--sun`, `--sun-ink`, `--font-display`, `--font-body`. Hard-coded colours are for game art only (pieces, board squares, player colours).
- **Two places, one design.** The Game Night site has Day and Night themes. Inside Giggle (`body.is-embed`) the page uses the call room's navy palette. Because screens use tokens only, the same markup works in all three.
- **One accent.** `--accent` (raspberry) is the only colour for primary actions and selection. Each game does not invent its own accent.

## Layout

- The playfield owns the stage. Text and voting games use one centred column (max 760px). Boards and canvases use the full width.
- The main question and the main action are visible without scrolling at 980×820 (the Giggle panel) and 390×780 (a phone).
- No large empty regions next to tiny content. Nothing stuck in a corner.
- **Nothing jumps.** Parts that appear and disappear between phases or turns (timers, banners, "waiting" lines, buttons) keep their space or are overlays. A phase change must not shift the layout.
- No horizontal scrolling. Long names and answers wrap or end with an ellipsis. Nothing overflows its box.

## Type

| Role | Desktop | Phone |
| --- | --- | --- |
| Prompt / question | 26–32px, weight 800 | 22–26px |
| Body, answers, choices | 16–18px | 16px |
| Labels, meta, counts | 13–14px | 13px |

Nothing below 12px. Titles use line-height about 1.2, body about 1.45. `--font-display` only for prompts, titles and big numbers; everything else uses `--font-body`.

## Components (the same in every game)

- **HUD row** at the top of the playfield: round, phase name, progress ("2 of 4 locked in"), and the timer when there is one. One line, one style.
- **Buttons**: at least 44px tall (primary 48px), radius 10–12px. Primary = filled `--accent`. Secondary = `--card` with a 1px border. One primary action per screen.
- **Choices**: equal-height cards in a row, at least 56px tall, with a letter or icon marker and clear hover and focus.
- **States**:
  - selected: accent outline and `--accent-soft` fill;
  - locked in: a check mark, the other options dimmed;
  - correct: `--green` outline and tint;
  - wrong: `--melon` outline and tint;
  - waiting: a calm "Waiting for 2 players" line, never a blank area.
  Avoid large yellow fills; `--sun` is a small highlight only.
- **Inputs**: 48px tall, the full width of their column, with the submit button the same height and aligned.
- **Round results and game over**: a winner line (a tie says "It's a tie" and names everyone tied), then a ranked list where equal points share a rank and the viewer's row is highlighted, then the rematch row.

## Motion

Short (150–250ms), purposeful, and off under `prefers-reduced-motion`. Never animate an element's size in a way that pushes other content.

## Bugs that always count

Console errors, horizontal scroll, clipped or overlapping text, controls under 44px, overlapping elements, states that look stuck, unreadable contrast (text on yellow, grey on grey), wrong winners or ranks on ties.

## How to check a game

1. **Play it for real with the test table.** Open `/test/` on any Game Night server (local `http://localhost:8135/test/` or the live site). Pick 2–4 players, a game and a look (Inside Giggle or the Game Night site), then press Start test room. Every frame is a real player in the same room; Player 1 is the host.
2. **See every phase at once with the gallery tool** (`tools/ui-gallery/`). It records every phase of every game with the playability drivers and screenshots it in the real client, inside a Giggle-style frame or standalone:
   1. `node tools/ui-gallery/record.js [repo] [games]` → `snaps/<game>.json` (first/mid/last moment of each phase).
   2. `node tools/ui-gallery/serve.js <repo> <gamePort> <parentPort> [snapsDir]` → serves the client and replays one moment.
   3. `node tools/ui-gallery/shoot.js <outDir> <parentPort> <games> p1,p2 desk,phone [embed|solo]` → screenshots plus a report of console errors and horizontal scroll.
   4. `node tools/ui-gallery/compare.js <outDir> <oldSnaps> <oldParentPort> <newSnaps> <newParentPort>` → the same three moments per game (playing, mid-game, final screen) from two checkouts, for side-by-side review.
