# Media Toolkit Guide (PartyBox `public/js/toolkit/`)

Practical ES modules with no new dependencies: 2D canvas lifecycle, keyboard/pointer
input, WebAudio sound cues, voice-over-parent-call, and the existing Three.js 3D
helper re-exported from one entry. DOM/custom game UIs are unrestricted — use as
much or as little per game as fits.

```js
import {
  createCanvasView, createInput, createSoundBank,
  createVoiceClient, createThreeView, createSessionToolkit,
} from '../toolkit/index.js';
```

All modules are import-safe: no `window`/`document` access at module scope, no
bare imports. Run `node test/media-toolkit.js` for the executable lifecycle suite.

## Canvas 2D (`toolkit/canvas-view.js`)

`createCanvasView(mountEl, { frame, resize?, autostart?, maxDpr?, onDispose? })`

- Creates a `<canvas>`, mounts it, sizes it DPR-aware (cap 2, `maxDpr` overrides),
  and runs `frame(ctx, dt, t, size)` on `requestAnimationFrame` (`setTimeout`
  fallback when rAF is missing). `ctx` is pre-scaled: draw in CSS pixels.
- `dt` clamped to `[0, 0.1]`; `t` is seconds; `size` is `{ w, h, dpr }`.
- Resize via `ResizeObserver` + `window` resize/orientation fallback; `resize(w, h, dpr)`
  hook runs after every resize.
- Handle: `{ canvas, ctx, size(), resize(), start(), stop(), running(), track(),
  reducedMotion(), disposed(), dispose() }`, or `{ fallback: true, reason }` when
  no 2D canvas can start (`no-mount`, `no-frame`, `no-dom`, `no-2d`, `mount-failed`).
- `dispose()` stops the loop, disconnects the observer, removes listeners and the
  canvas, runs `onDispose`. Idempotent, never throws.

## Input (`toolkit/input.js`)

`createInput(target, { onKey?, onPointer?, preventKeys?, captureInFields?, allowRepeat?, window?, document? })`

- Keys tracked by `e.code`; edges only (repeat ignored unless `allowRepeat`).
  `onKey({ type: 'down'|'up', code, key })`.
- Pointer down/move/up/cancel on `target` with capture best-effort;
  `onPointer({ type, id, x, y, nx, ny, event })`, `x/y` in target CSS pixels,
  `nx/ny` normalized 0..1.
- Guaranteed release: held keys and active pointers clear on `window` blur,
  `document` hidden, `pointercancel`, and `dispose()` (up/cancel events carry
  `released: true` / `event: null` so games can tell).
- Focused-field guard: key events from `input`/`textarea`/`select`/`contentEditable`
  are ignored unless `captureInFields: true`, so chat typing never drives the game.
- `preventKeys: ['ArrowUp', 'Space', ...]` calls `preventDefault` for those codes.
- Handle: `{ keys(), isDown(code), pointers(), releaseAll(), disposed(), dispose() }`.

This is the toolkit's own input; kart and other game-specific inputs are untouched.

## Sound (`toolkit/audio.js`)

`createSoundBank({ muted?, autoUnlock?, createContext? })`, cues: `click, turn,
tick, join, win, lose, error` (see `CUES`).

- Call `unlock()` inside a real user gesture (start button, first tap). Before that,
  `cue()` returns `false` and schedules nothing. `autoUnlock` (default true) also
  unlocks on the first `pointerdown`/`keydown`.
- `cue(name)` returns `true` when scheduled, `false` when muted, locked, disposed,
  unknown, or WebAudio is missing. Missing WebAudio never throws.
- `setMuted(m)`, `isMuted()`, `isUnlocked()`, `available()`, `cues()`, `dispose()`
  (removes gesture listeners, closes the context). Mute is in-memory only.

## Voice over the parent call (`toolkit/voice.js`)

The game never captures audio: no `getUserMedia`, no `RTCPeerConnection`, no
`MediaStream` in this module. Voice rides the parent Giggle page's existing Agora
call; this client only requests the parent prompt and mirrors the parent's actual
capture/mute status.

`createVoiceClient({ expectedOrigin, postFn, authed?, enabled?, window? })`

- `expectedOrigin`: exact configured parent origin (`''` = standalone mode).
- `postFn(envelope, exactOrigin)`: root wires to
  `window.parent.postMessage(envelope, exactOrigin)`.
- `setAuthed(bool)`: root sets `true` after the game server accepts a ticket (the
  same moment the shell posts `authed`), `false` on socket close/leave.
  Pre-handshake voice traffic is rejected.
- `setEnabled(bool)`: local switch. Manifest `communication=voice` guides layout;
  it never forces permission — games that need no voice call `setEnabled(false)`.
- `request()` posts `{ v: 1, t: 'voice-request', id }` and returns `{ ok: true, id }`.
  It merely asks the parent to show its prompt — nothing is captured until the
  player clicks the parent's real Enable microphone button (existing device toggle,
  real gesture). Standalone/pre-handshake/disabled calls return `{ ok: false,
  reason }` (`standalone`, `not-authed`, `disabled`, `disposed`, `post-failed`) and
  post nothing.
- `handleEvent(ev, parentWindow)`: strict gate — exact configured origin, exact
  current parent source, v1 schema, authed handshake, local enabled — then applies
  `{ v: 1, t: 'voice-state', mic, enabled, for? }`. Forged, pre-handshake, disabled,
  and stale (`for` ≠ latest request id) messages return `false` and change nothing.
  A parent `enabled: false` surfaces as `unavailable`. Returns `true` only when a
  status update was applied.
- `getStatus()` → `{ mode: 'embedded'|'standalone', mic:
  'unknown'|'active'|'off'|'denied'|'unavailable', enabled, updatedAt, hint? }`.
  Standalone reports `unavailable`-style status with an honest hint ("Voice chat
  needs a Giggle call — open this game from Play together."). No raw audio,
  secrets, or tickets ever appear in statuses, events, storage, or logs.
- `subscribe(fn)` → unsubscribe; `dispose()`/`end()` removes the attached listener
  (when `window` was passed) and clears subscribers.

## 3D (`toolkit/index.js` → `renderers/three-view.js`)

`createThreeView(mountEl, hooks)` is re-exported unchanged: pinned local vendor
build, GL lifecycle only, `{ fallback: true, reason }` so the view can run its 2D
fallback on the same snapshots. See `renderers/three-view.js` for `hooks.build`.

## One session object (`createSessionToolkit`)

```js
const session = createSessionToolkit({
  canvas: { mount: el, hooks: { frame: draw } }, // or null
  input: { target: el, opts: { onKey, preventKeys: ['Space'] } },
  audio: { muted: false },
  voice: { expectedOrigin, postFn },
});
session.audio.unlock(); // from the start-button gesture
// ...
session.dispose(); // or session.end() — disposes every built piece
```

Missing sections stay `null`; a section whose builder throws becomes `null` with
the error collected in `session.errors`. `dispose()`/`end()` is idempotent.

## Shell wiring (actual API)

The shell exposes factories — it never builds a session for a game. Views
choose their pieces and dispose them on unmount; DOM games use none of it.

- `api.toolkit = { createCanvasView, createInput, createSoundBank,
  createThreeView, createSessionToolkit }` — the same
  factory exports as `toolkit/index.js`. A canvas view mounts only when a
  game calls a factory with its own element and hooks; nothing is appended
  automatically and no game is captured.
- Voice is page-lifetime and shell-owned: the client is created once the
  parent origin is verified (`embedTrusted`), before the auth ack, and
  lives across games so the first parent `voice-state` is never lost.
  The shell's root `message` listener routes
  `voice.handleEvent(ev, window.parent)` (exact parent + exact origin),
  calls `setAuthed(true)` when the server hello accepts the ticket and
  `setAuthed(false)` on socket close/lease expiry. Games use the stable
  `api.voice` facade (`getStatus/subscribe/request`) — never a private
  client, never `getUserMedia`. The shared gamehead carries the Voice
  chat/mic-status button for trusted embed games; clicking it asks the parent to show its
  mic prompt (the parent's real Enable button does the enabling).
  Standalone keeps any-call support and reports the honest Giggle hint.

Views with a dedicated HUD clock export `ownsTimer: true` to suppress the shell
countdown. Use `api.now()` against server deadlines and hide gameplay countdowns
in results/done. Ordinary text views get the shared clock automatically.
