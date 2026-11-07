# Design tokens: the toy box

The reference for restyling Giggle screens. Rules and reasons live in
`.claude/skills/giggle-design/SKILL.md`. Screenshot grading lives in
`.claude/skills/giggle-design/review-rubric.md`.

Tokens are defined in `public/css/style.css` (`:root`, with Night values
under `[data-theme="night"]` and Inside Giggle values under
`body.is-embed`). Components `.tb-*` are in `style.css`, so they work on
home, practice and inside `#gbody`. The game kit `.gk-*` is in
`public/css/game-ui.css` and reads the same tokens.

## Tokens

### Spacing
`--space-4` `--space-8` `--space-12` `--space-16` `--space-24` `--space-32`
`--space-40` `--space-48` `--space-64`. The only values for padding, gap
and margin.

### Radius
`--radius-sm` 8, `--radius-md` 12, `--radius-lg` 16, `--radius-xl` 24,
`--radius-pill` 999. Nested shapes with a gap under 32px use
`calc(outer - gap)`, only when that is above 2px.

### Outline, lift, shadow
| Token | Value | Use |
|---|---|---|
| `--outline` | Day `#321829`, Night `#000`, embed `#0b0c11` | Sticker outline and offset shadow colour. Not turned off in `#gbody` (unlike `--hard`). |
| `--outline-w` / `--outline-w-lg` | 2px / 3px | Buttons and badges / cards |
| `--lift-sm` / `--lift` / `--lift-lg` | 2 / 4 / 6px | Offset shadow height |
| `--shadow-sticker-sm` / `--shadow-sticker` / `--shadow-sticker-lg` | `0 <lift> 0 var(--outline)` | Sticker shadows |
| `--shadow-card`, `--shadow-sm`, `--shadow-btn` | existing soft shadows | Floating layers only (dialogs, toasts) |

### Controls
`--control-h-sm` 44px (floor for any tap target), `--control-h` 48px,
`--control-h-lg` 56px (primary).

Start-menu layout: `--howto-dialog-w` 920px and `--howto-dialog-h` 600px
bound the desktop dialog; `--howto-seat-w` 304px reserves the setup column.
`--howto-controls-w` 536px bounds the in-game Controls sheet. Viewport and
safe-area limits take priority over these preferred sizes.

`--home-card-art` 96px is the square art tile shared by home picks and
catalogue cards. Each card pairs it with one compact text/action stack.

### Text styles
Use as `font: var(--text-title)` or the class.

| Token | Class | Value |
|---|---|---|
| `--text-heading` | `.t-heading` | Baloo 2 800, clamp(26px, 3.2vw, 34px) / 1.15 |
| `--text-title` | `.t-title` | Baloo 2 800, 20px / 1.25 |
| `--text-body` | `.t-body` | Nunito 600, 17px / 1.5 |
| `--text-button` | `.t-button` | Baloo 2 800, 17px / 1.2 |
| `--text-primary` | | Baloo 2 800, 19px / 1.2 (primary actions) |
| `--text-button-sm` | | Nunito 800, 15px / 1.2 (chips, segments) |
| `--text-caption` | `.t-caption` | Nunito 700, 13px / 1.4, `--ink-dim` |

Fonts: `--font-display` (Baloo 2), `--font-body` (Nunito).

### Motion
`--ease` `cubic-bezier(0.22, 1, 0.36, 1)` (the only curve),
`--dur-quick` 200ms, `--dur-base` 300ms, `--dur-slow` 500ms. Animate only
`transform` and `opacity`.

### Focus
`--focus-ring` `3px solid var(--accent-deep)`, `--focus-offset` 2px.

### Colour
Existing ground and ink: `--bg` `--card` `--well` `--ink` `--ink-dim`
`--line` `--line-strong` `--accent` `--accent-deep` `--accent-soft`
`--accent-ink` `--sun` `--melon` `--teal` `--sky` `--green`.

Status (each with `-soft` and `--on-` partners): `--success`, `--danger`,
`--warning`.

Family colours, each with `-deep` and `--on-` partners:
`--fam-board` (teal), `--fam-party` (raspberry), `--fam-create` (sky),
`--fam-arcade` (orange).

The active family, set by `data-family="board|party|create|arcade"` on any
element (party is the default on `body`):

| Token | Meaning |
|---|---|
| `--fam` | Family fill: primary buttons, selected segment, turn badge |
| `--fam-deep` | Family text on light fills (selected chip label) |
| `--fam-soft` | Tint behind text (`.tb-card.is-tint`, selected chip) |
| `--on-fam` | Text on a `--fam` fill |

Kit mapping for wave 2: board kit uses `board`, party and answer kit uses
`party`, drawing, camera and word kit uses `create`. Race and reaction games
use `arcade`.

## Components (`style.css`)

| Class | What |
|---|---|
| `.tb-btn` | Base button: 48px, 2px outline, 16px radius, 2px lift it sinks into on press |
| `.tb-btn.tb-primary` | Family fill, 56px, 4px lift. One per panel |
| `.tb-btn.tb-secondary` | Card fill |
| `.tb-btn.tb-chip` | 44px pill, no lift. Selected: `aria-pressed="true"` / `aria-checked="true"` / `.is-selected` |
| `.tb-btn.tb-icon` | 48px square icon button (add `.tb-chip` for 44px round). Needs `aria-label` |
| `.tb-btn.tb-danger` | `--danger` fill |
| `.tb-reason` | Caption that says why a control is disabled |
| `.tb-seg` | Segmented toggle; child `<button>`s with `aria-checked` or `aria-pressed` |
| `.tb-card` | Sticker card: 3px outline, 24px radius, 6px shadow, 24px padding. `.is-tint`, `.is-compact`. As `<button>`/`<a>` it lifts and sinks |
| `.tb-badge` | Status pill. `.is-turn` `.is-live` `.is-wait` `.is-done` `.is-alert` |
| `.tb-skeleton` | Loading placeholder. `.is-text` `.is-btn` `.is-card` |
| `.tb-empty` | Composed empty state: dashed panel with a line of what to do next |
| `.t-heading` `.t-title` `.t-body` `.t-button` `.t-caption` | Text styles |

States on every `.tb-btn`: hover lift (hover devices only), active sink,
`:focus-visible` ring, `:disabled` / `aria-disabled="true"` grey and flat,
`aria-busy="true"` loading bar.

The game kit (`.gk-btn`, `.gk-primary`, `.gk-choice`, `.gk-card`,
`.gk-hud`, `.gk-results`…) stays flat and is documented at the top of
`game-ui.css`; it now reads the same spacing, radius, text and motion
tokens. The older `.btn`, `.btn.ghost`, `.btn.big`, `.chip` and `.card`
rules read the tokens too, with their look unchanged.

## Before / after

Fleet Duel's setup controls (simplified): eight identical white buttons under a flat
grid.

```html
<!-- before -->
<div class="fd-controls">
  <button class="gk-btn">Rotate</button>
  <button class="gk-btn">Random</button>
  <button class="gk-btn">Clear</button>
  <button class="gk-btn">Small</button>
  <button class="gk-btn">Classic</button>
  <button class="gk-btn">Big</button>
  <button class="gk-btn" disabled>Ready</button>
  <button class="gk-btn">Rules</button>
</div>
```

```css
/* before: hand-picked values */
.fd-panel { padding: 18px 20px; border: 1px solid #ddd; border-radius: 14px; }
.fd-panel h3 { font: 800 22px/1.2 var(--font-display); margin-bottom: 10px; }
.fd-cell { transition: background .15s ease; }
```

```html
<!-- after: one primary, options as a segmented toggle, tools as chips -->
<section class="tb-card fd-panel" data-family="board">
  <h3 class="t-title">Place your fleet</h3>
  <div class="tb-seg" role="radiogroup" aria-label="Fleet size">
    <button role="radio" aria-checked="false">Small</button>
    <button role="radio" aria-checked="true">Classic</button>
    <button role="radio" aria-checked="false">Big</button>
  </div>
  <div class="fd-tools">
    <button class="tb-btn tb-chip">Rotate</button>
    <button class="tb-btn tb-chip">Random</button>
    <button class="tb-btn tb-chip">Clear</button>
    <button class="tb-btn tb-icon tb-chip" aria-label="Rules">?</button>
  </div>
  <button class="tb-btn tb-primary" disabled>Ready</button>
  <p class="tb-reason">Place 2 more ships first</p>
  <span class="tb-badge is-wait">Ann is placing</span>
</section>
```

```css
/* after: tokens only; per-game CSS adds layout and art */
.fd-panel { display: grid; gap: var(--space-16); }
.fd-tools { display: flex; flex-wrap: wrap; gap: var(--space-8); }
.fd-cell { border-radius: calc(var(--radius-lg) - var(--space-8)); transition: transform var(--dur-quick) var(--ease); }
```

Loading the same panel before the server answers:

```html
<section class="tb-card fd-panel" aria-busy="true">
  <span class="tb-skeleton is-text"></span>
  <span class="tb-skeleton is-card"></span>
  <span class="tb-skeleton is-btn"></span>
</section>
```

### Pocket Karts garage

`--kart-garage-w` (880px) caps the results parts bench; `--kart-garage-preview-w` (224px) reserves its desktop display column; `--kart-garage-preview-h` (208px) reserves the thumbnail area before the model is ready. Cards use the existing spacing, type, colour, radius, control and motion tokens.
