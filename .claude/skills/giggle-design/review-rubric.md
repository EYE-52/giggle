# Giggle screen review rubric

Use this to grade one screenshot of a Giggle Games screen. It is written for
a vision model (for example GLM Flash) or a person. It goes with
`SKILL.md` in this folder.

## How to grade

1. Look at the whole screenshot for three seconds. Write one sentence: what
   is this screen, and what should the player do next?
2. Go through checks C1 to C12 in order. For each, give **HIGH**, **MED** or
   **LOW** using the descriptions under it. Judge only what you can see. If a
   check cannot be judged from this screenshot (for example no buttons are
   visible), write **N/A**.
3. For every MED or LOW, write one line of evidence: what you see and where
   ("top right: three white buttons of equal size: Rules, Sound, Leave").
   Do not invent problems you cannot point to.
4. Give the overall grade with the rule at the end.

Grades mean:

- **HIGH**: looks finished and intentional. Nothing to fix.
- **MED**: works, but looks generic, uneven or a little confusing. Fix
  before the next release.
- **LOW**: looks broken, empty, cheap or confusing, or a player could tap
  the wrong thing. Fix now.

## Checks

### C1. One obvious next action
- HIGH: one control is clearly the biggest and most colourful (the
  primary). It says a verb ("Fire", "Lock in", "Play again"). Or it is not
  the viewer's turn and the screen clearly says who we are waiting for.
- MED: a primary exists but competes with another control of similar size
  or colour.
- LOW: two or more controls look equally important, or there is no visible
  way to act and no message saying why.

### C2. No wall of identical buttons
- HIGH: secondary options are small pills (chips), a segmented toggle, or
  icons. Buttons differ in size and weight by importance.
- MED: three similar buttons in a row, but they are grouped and labelled.
- LOW: four or more same-looking plain buttons (often white rectangles with
  thin grey borders), like a web form.

### C3. The playfield looks like a game
- HIGH: the board, cards or scene has colour, texture, pieces or a frame. It
  fills its space. You could tell what game it is with the text hidden.
- MED: the playfield is clear but plain (flat grid, single colour).
- LOW: an empty flat grid or blank box on a blank page, or the playfield is
  small with large empty margins around it.

### C4. Colour with a purpose
- HIGH: one family colour carries the primary action and highlights;
  green, red and yellow are only used for status (correct, wrong, waiting).
  Both text and controls are easy to read on their backgrounds.
- MED: colour is mostly right but one place uses a random colour, or the
  screen is nearly all grey and white.
- LOW: many unrelated colours, low contrast text, or red/green used for
  decoration so status is unclear.

### C5. Consistent sticker style
- HIGH: cards and buttons share the same look: a thick dark outline, rounded
  corners, and a hard shadow straight below. Corner sizes look related
  (inner corners smaller than outer ones).
- MED: mostly consistent but one panel or button is flat with a thin grey
  border, or has a blurry shadow.
- LOW: a mix of styles on one screen (flat boxes, stickers, blurry glows,
  sharp corners next to round ones), so it looks assembled from parts.

### C6. Text hierarchy
- HIGH: one big heading (prompt or turn), clear titles, readable body text,
  small captions. You can tell what matters in two seconds.
- MED: hierarchy is there but two levels look the same size, or one block of
  text is too small to read comfortably.
- LOW: everything is the same size, or important text (whose turn, the
  question) is small or hidden.

### C7. Even spacing
- HIGH: gaps between related items are small and equal; gaps between groups
  are larger and equal. Nothing touches an edge.
- MED: one or two uneven gaps, or a cluster that feels cramped.
- LOW: elements touch or overlap, or controls float far from what they
  control, or large random empty areas.

### C8. Game state is visible
- HIGH: you can see whose turn it is, the score or progress, and the timer if
  there is one, without reading small text. A recent move or result is
  marked.
- MED: state is shown but only in small text or in one corner.
- LOW: you cannot tell whose turn it is or what just happened.

### C9. States are explained
- HIGH: greyed-out controls have a short reason next to them ("Wait for
  Ann"). Waiting or empty areas say who or what we are waiting for. Loading
  areas show grey placeholder shapes.
- MED: a disabled control with no reason, or a waiting message that is vague
  ("Please wait").
- LOW: a blank panel, a spinner on its own, or a control that looks
  clickable but is not.

### C10. Nothing covers the board (layout safety)
- HIGH: menus, the report button, toasts, the rematch bar and HUD sit beside
  or above the playfield, never on top of cells or cards you need to tap.
- MED: a floating control slightly overlaps the edge of the playfield but no
  tappable cell.
- LOW: a floating control, banner or toast covers board cells, cards or the
  primary action.

### C11. Phone fit (judge only on screenshots about 390px wide)
- HIGH: no sideways scrolling, no cut-off text or buttons, labels fit inside
  their buttons, the primary action is visible on the first screen, tap
  targets look at least finger-sized.
- MED: one label wraps awkwardly or the primary action needs a small
  scroll.
- LOW: content is cut off at the right edge, buttons overflow, text is
  clipped, or controls are too small to tap.
- On desktop screenshots (about 1280px wide) write N/A.

### C12. Specific copy, no filler
- HIGH: text says exactly what is happening and what to do, in game words
  ("3 of 4 locked in", "Tap a square to fire").
- MED: one generic phrase ("Get ready!", "Submit", "Click here").
- LOW: several filler phrases ("Let's get started", "Welcome to the game",
  "Awesome experience", "Something went wrong"), placeholder text, or
  "Player 1" where a real name should be.

## Overall grade

- **LOW** if any of C1, C3, C10 or C11 is LOW, or three or more checks are
  LOW.
- **HIGH** if no check is LOW and at most two are MED.
- **MED** otherwise.

## Answer format

Reply with exactly this structure and nothing else:

```
SCREEN: <one sentence: what the screen is and the next action>
C1: HIGH|MED|LOW|N/A - <evidence, or "ok">
C2: ...
C3: ...
C4: ...
C5: ...
C6: ...
C7: ...
C8: ...
C9: ...
C10: ...
C11: ...
C12: ...
OVERALL: HIGH|MED|LOW
TOP FIX: <the single change that would raise the grade most>
```
