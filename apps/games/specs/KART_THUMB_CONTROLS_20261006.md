# Karts thumb controls — 2026-10-06

Familiar phone-game controls for the kart arena: a LEFT fixed analog stick
plus a RIGHT circular cluster. Replaces the six rectangles; keyboard play
and the arena HUD are retained. Radar moves above the action cluster in short landscape.

## Layout

- LEFT bottom: fixed stick pad (`#pk-stick`), rubber/translucent round base,
  movable thumb, small `Drive` label. Thumb position flows via CSS variables
  `--pk-sx`/`--pk-sy` (set by the stick module); spring-back is a CSS
  `transform` transition only — no timer/rAF. `data-active` present while
  dragging (transition only when absent). Reduced-motion removes the spring.
- RIGHT bottom: 2×2 circular cluster, all ≥44px, transparent with rubber
  edge and bounded pressed glow, center of the screen left clear:
  - large Fire/action `#pk-tb` (keeps dynamic short labels / accessible
    names, ammo-disabled and KO state; discrete, exactly once per contact),
  - large Drift `#pk-th`,
  - smaller Gas `#pk-tg`, Brake `#pk-td`.
- Ids `pk-tb`/`pk-th`/`pk-tg`/`pk-td` kept for compatibility; `pk-tl`/`pk-tr`
  removed. No giant bottom panel. The obsolete inline six-button `<style>`
  is deleted; all styling lives in `kart-arena.css`.
- Adapts at 390×844, 320×640, 844×390, 568×320 via coarse/short-landscape
  media queries (compact stick/cluster under 500px/360px landscape height).
  Safe-area insets on left/right/bottom; readout/radar sit above the taller
  controls so they cannot overlap. Desktop keeps keyboard; touch UI stays
  `display:none` unless coarse pointer or short phone landscape.

## Intent policy (wire format unchanged)

Analog controls send ONLY `{ steer, throttle, boost, drift }` floats in
`[-1,1]` — never coordinates or timestamps. Server-authoritative routing,
local prediction, the 500ms keepalive, and the server receipt-time 1500ms
TTL are preserved. Prediction reads every stick move immediately. Sustained
analog sends coalesce to 30Hz using one latest-value timeout; first movement,
neutral release, action/digital changes and every global stop bypass the wait.
Those immediate sends cancel any superseded timeout, and teardown cancels it.

- `steer`: keyboard wins while left/right held (digital −1/0/+1, both = 0);
  otherwise stick `x` (−1 left … +1 right).
- `throttle`, first match wins:
  1. digital brake/down → −1 (overrides positive stick/Auto gas, keeps reverse);
  2. manual gas/up → +1;
  3. nonzero stick vertical → `−y` (UP pushes, DOWN brakes/reverses, proportional);
  4. Auto gas → +1;
  5. else 0.
- `drift`: Shift or Drift button (held). `boost`: discrete Fire edge.
- Fire owns one pointer, including a non-primary second thumb. A second finger
  on Fire cannot duplicate the contact. Release/cancel clears capture and sends
  the neutral edge promptly. Pointer-backed clicks (`detail > 0` or a nonempty
  `pointerType`) are ignored after pointer activation; zero-detail keyboard /
  assistive clicks still activate after cancellation. Focused Enter/Space fires
  once, ignores repeats, and re-arms on key release.
- Stick shaping: radial deadzone ≈.14, rescaled so the deadzone edge reads 0
  and the pad edge reads 1; direction preserved, diagonals proportional
  (corner = unit length, x=y≈.707), off-pad drags clamp to unit.

## Reusable module

`public/js/toolkit/mobile-stick.mjs` — dependency-free Pointer Events
behavior, no kart knowledge:

- `createMobileStick(el, { onChange, enabled, window, document, deadzone })`
  → `{ reset, dispose, value }`; `reset(false)` silences `onChange` for host
  atomic clear; `normalizeStickVector(dx, dy, radius, deadzone)` is the pure
  helper tests target.
- Owns exactly ONE pointer: secondary stick fingers rejected without
  `preventDefault`, so Drift/Gas/Fire fingers are independent. Capture +
  window move/up/cancel fallbacks track off-pad drags; unrelated ids
  ignored everywhere; no move without contact; non-left mouse rejected. A
  mouse move with `buttons === 0` cancels a missed mouseup. If the enabled
  predicate becomes false during a drag, the next move resets it.
- Reset + release of ACTUAL capture exactly once on primary
  up/cancel/lostcapture/blur/hidden/legacy orientation/modern orientation/
  document `game-screenchange`/dispose; identity cleared
  BEFORE `releasePointerCapture` (sync `lostcapture` becomes a no-op).
  Dispose idempotent and silent, no callbacks after. A multi-control host must
  register global-stop listeners before creating the stick, silently reset all
  controls, then send one neutral intent. The host also owns final neutral
  delivery on dispose and game-specific stops such as drawers or phase changes.

## Atomic stop

Blur, hidden tab, orientation change, `game-screenchange`, `screen.orientation`
change (when present), opening `.room-menu`, phase done, spectator loss,
KO, and remount/dispose all drop stick + digital identities, visual-held state,
captures, and Auto gas. Host clears silently (`reset(false)` + hold clears)
then sends ONE final zero packet where the live instance permits
(`youDrive` + drive/countdown). Dispose sends zero before `api`/`S` nulling
when active. Host global-stop listeners register BEFORE the stick is created
so the host silent clear runs first and the stick's own emit becomes a no-op.
Document `game-screenchange` is bound (landscape helper dispatches it);
`game-screen.mjs` untouched. Drive keys ignored in rooms/forms/buttons, open
drawer/dialog, hidden tab, KO, and watcher/done views. Stick, right-side
buttons and Auto gas share the same new-contact guard. Respawn requires a
fresh contact; it does not revive an old held thumb. Phase done and watcher
loss clear locally because the authoritative new state already rejects drive
intents; no late drive packets are sent from those states.

## Verification and provenance

- `node test/mobile-stick.mjs` — 117 assertions: vector shaping, pointer identity
  including id zero, capture/window fallbacks, unrelated releases, synchronous
  lost capture, missed mouseup, enable changes, modern/legacy screen stops,
  silent reset, and leak-free idempotent disposal.
- `node test/kart-view.js` — 250 assertions against the real mount/update/dispose:
  analog/digital/keyboard merge, 100-move coalescing/latest-value prediction,
  Fire contact + keyboard dedupe, six atomic global-stop paths with all four
  control contacts held, capture release exactly once, Room/modal/KO gates,
  keepalive, driver loss, done, rematch, HUD/garage, and pending-timeout cleanup.
- Independently rerun existing Karts suites: kart-framework, kart-mechanics,
  kart-network-render, pocket-karts-smooth, and pocket-karts-release (real WS).
  Root owns the full clean release suite and final browser verification.
- Initial implementation used actual `muse-spark-1.3-contributor` with reasoning
  effort `max`, default sandbox and approval judge `on`, with no approval or
  sandbox bypass. Session `01a11264-bb9c-70e0-aa38-d1e465bd680b`, run
  `fb63204b-1f61-4a6d-85ba-476ceb487ff7`. The independent follow-up corrected
  Fire cancel/click handling, right-button capture cleanup, modern cleanup,
  drawer/KO gates, short-landscape radar overlap and high-refresh coalescing.
  Muse's live-server test met its default-sandbox `listen EPERM` boundary;
  independently authorized WS testing ran outside that CLI without changing
  its sandbox or approval policy.

Browser viewport and native browser action evidence is reported by root under
`/tmp/giggle-landscape-20261006/root`. Synthetic multi-contact checks do not
establish physical iOS or Android touch acceptance. No physical-phone,
OS-orientation-lock, or multitouch hardware verification is claimed here.
