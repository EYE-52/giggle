# Squad games (Game Night embed bridge)

Squads can play Game Night together **inside** the existing lobby page,
beside the same call, friends, and invitations. This is a small embed
adapter — not a replacement auth/call framework. The lobby keeps owning
the Agora client; games add no video, auth, or billing of their own.

## How it works

1. The lobby shows **Play together** when `GET /api/features` reports
   `games: true` (server-side config only; no build-time copy to drift).
2. Opening it mounts `GamePanel` as the main stage **inside** the lobby.
   The seats shrink to a compact rail but stay mounted: `vcRef`, media
   nodes, membership checks, and camera/mic controls never reset across
   game selection, rematch, customization, or closing/reopening.
3. `GamePanel` frames Game Night (`?embed=1&parentOrigin=<exact-origin>`)
   and mints a **fresh 90-second single-use ticket** per auth send via
   `POST /api/squads/:squadId/games/token`. Tickets cross the frame
   boundary over `postMessage` v1 only — never URLs, storage, or logs.
4. Game Night verifies the ticket (exact HS256/issuer/audience,
   timing-safe signature, exact 90s window, single-use `jti`), maps the
   verified `squadId` to a private room and the verified `sub` to a
   stable seat, and grants a lease bound to the ticket's own expiry
   (`claims.exp` — a ticket consumed near expiry buys no extra time).
   The parent renews with a fresh ticket ~every 60s on the SAME
   iframe/socket/seat, so removal/age/account/block changes land within
   ~90s (30s renewal margin).
5. Replay protection fails closed: every unexpired consumed `jti` is kept
   until expiry (max 5000); while full, new tickets are rejected with a
   distinct capacity error instead of making old tickets reusable.
6. Closing the panel (or picking games on/off) never touches the call.

The iframe gets **no** camera/mic permission (`allow` omits both); media
stays entirely in the Giggle parent. No video permission is needed to play.

## Protocol (postMessage v1)

Child → parent: `ready {v}`, `auth-needed {v}`, `authed {v, n}`,
`state {v, game, players, watchers?, presentation?}`.
Parent → child: `auth {v, ticket, n}`, `context {v, theme?}`
(validated ids).

Voice uses the same exact-origin, exact-source, verified-auth channel:
child → parent `voice-request {v, id}`; parent → child
`voice-state {v, mic, enabled, for?}`. `mic` reflects the parent's actual
capture state (`active`, `off`, `denied`, `unavailable`). A request shows an
explicit **Enable microphone** prompt in the parent; only clicking that
button invokes the existing device control. Games never capture audio.
Standalone games explain that voice is available from a Giggle call.

`authed` is the verified authorization acknowledgment: the child posts it
only after the game server accepts a ticket (Giggle hello on the child's
socket), echoing the server's echo of the parent's per-send nonce `n`.
Freshness is exact: the panel mints a fresh nonce per auth send
(`createAuthNonce`) and promotes loading to live only on an ack echoing
its latest pending id (`isFreshAuthAck`), consumed single-use — an old
duplicate can never authorize a new attempt, and a posted ticket or a
stale state snapshot never suffices. Uncorrelated traffic never marks the
frame heard: only a live child script (`ready`/`auth-needed`) or an
accepted current ack proves the document, so a stale ack or pre-auth
state snapshot cannot make a dead (404/blank) document look alive.
Presence counts are typed protocol fields (finite nonnegative integers ≤
the 24-seat room cap); out-of-shape counts are dropped, never shown.
Every Retry re-arms the bounded 20 s ready-timeout and clears the pending
authorization; when the framed document never answered (service
404/blank/blocked), Retry reloads the game iframe (only the iframe —
parent video stays mounted), while auth-only Retry on a live frame
preserves it.

Both sides enforce the **exact** configured origin and the **exact**
`event.source` (parent window vs `iframe.contentWindow`). No `'*'`, no
accepting messages from unrelated same-origin frames. The child treats
the `parentOrigin` query value as a claim and confirms trust against the
server's public `/config.json` (`giggleAllowedOrigins` + `allowHttp`)
before sending `ready`/`auth-needed` or accepting `auth`/`context`.
Child implementation: Game Night `public/js/embed.js`; parent:
`apps/desktop/lib/gameBridge.ts` + `components/GamePanel.tsx`.

One seat is active at a time: when the same seat is taken over in
another window, the replaced socket closes with code `4001` and shows
**Playing in another window** with a deliberate **Rejoin here** action
instead of auto-reconnecting. A normal dropped connection still
auto-resumes. Embedded rooms show one compact context line (host +
count) plus name chips — the parent already shows friends/video, so the
frame reserves its space for games.

## Configuration

API (`server/.env`, see `server/.env.example`):

- `GAMES_PUBLIC_URL` — Game Night base URL handed to clients.
- `GAME_BRIDGE_SECRET` — ≥32 high-entropy chars, shared with Game Night.

Desktop build (`apps/desktop/.env.example`):

- `NEXT_PUBLIC_GAMES_URL` — the one origin this app may `frame-src`.
  Its origin **must match** `GAMES_PUBLIC_URL`'s origin.

URL rules (both sides): absolute http(s); https in production, http only
in development; no credentials, query, or hash. Anything misconfigured →
`games: false` and an honest **Games are unavailable** state with retry.

Game Night side: `GAME_BRIDGE_SECRET` (same value),
`GIGGLE_ALLOWED_ORIGINS` (comma-separated exact Giggle origins, gating
`frame-ancestors`, cross-origin WS, and child trust). `http` origins
(such as Tailnet previews like `http://divyanshs-mac-mini:4012`) are
honored only outside production; production requires `https`.
Standalone play always works.

## Security properties

- Route: `requireApiAuth` (DB-backed verified-adult + account, every call)
  + `requireSquadMemberAccess` (live membership) + the same
  `anyBlockedPair` check as the Agora lobby token route.
- Identity (`sub`, `squadId`, `displayName`) derives from
  `req.squadAccess` + `req.giggleIdentity` + `member.displayName`;
  request-body claims are ignored.
- The ticket is not a Giggle backend JWT and grants no Giggle privileges.
- CSP: precise `frame-src` for the configured origin; Giggle keeps
  `frame-ancestors 'none'`, `X-Frame-Options: DENY`, and
  `camera`/`microphone` locked to `self`.

## Files

- `server/src/services/gameBridgeService.js` — config validation + minting
- `server/src/routes/gameRoutes.js` — token route (+ `server.js` wiring)
- `server/src/routes/statsRoutes.js` — `games` in `/api/features`
- `packages/core/src/api.ts` — `gameToken`, `GameTicket`, features flag
- `apps/desktop/lib/gameBridge.ts` — parent postMessage/URL helpers
- `apps/desktop/lib/games.ts` — games-enabled switch hook
- `apps/desktop/components/GamePanel.tsx` (+ scoped CSS) — the stage
- `apps/desktop/app/(app)/lobby/` — entry + stage/rail layout (minimal)
- `apps/desktop/next.config.ts` — precise `frame-src`

Tests: `server/test/gameBridge.test.js`,
`server/test/gameEncounterBridge.test.js`,
`packages/core/test/api.test.cjs`, `apps/desktop/test/game-bridge.test.js`,
`apps/desktop/test/game-encounter.test.js`,
`apps/desktop/test/voice-game-bridge.test.js`, plus Game Night `test/bridge.js`.

## Framed game UI

The framed Game Night keeps its own sticker-party Day/Night look
(raspberry + sunshine, never corporate blue/purple or brown) and follows
the parent's mode via `context` — no remount, no new ticket. In-call game
screens play compact: no nested topbar (the parent owns brand/close),
title + host-only Change game + sound toggle in the gamehead, a one-line
watcher status with a Why? disclosure, and turn/clocks above the
playfield — so a full chess board fits a 390px-wide call frame beside the
friends rail and mic/camera controls. Standalone Game Night UI is
unchanged.

## Contextual video

`state.presentation` is an optional hint — `social` | `board` |
`immersive` | `balanced` — inferred by the child from public catalog
metadata only (Game Night `presentationForGame`, never per-game ids):
`communication: video` → `social` (faces matter, e.g. Charades);
`cat: board` → `board` (calm side-by-side, e.g. chess); `renderer: 3d`
or `realtime: true` → `immersive` (compact filmstrip, maximum game area,
e.g. pocket karts); anything else, unknown, or omitted → `balanced`.
The parent rejects messages containing an invalid presentation value.
An omitted hint remains compatible with older children and uses
`balanced`; unfamiliar catalog metadata also derives `balanced`.

Video modes follow the same contract: **Auto** tracks the hint above,
**Faces** pins large faces, **Compact** pins the filmstrip, and **Floating**
overlays the existing call inside the game view. The floating call has four
corner positions and a Hide/Friends toggle; hiding tiles leaves the call
connected. Mic/camera controls stay in the page's control bar. Closing games
resets the floating corner to bottom right and restores expanded tiles.
This is an in-page floating panel; it does not create a separate browser
picture-in-picture window. Layout changes,
tile focus, game changes and rematches preserve the iframe, Agora client
and video nodes. Focusing reveals the original tile with a one-time rail
scroll; Escape restores its size and returns focus with `preventScroll`.
Closing games removes the iframe while the call and its video nodes stay
mounted. Reopening creates a new game frame. Signed-in Giggle members play as their Giggle
identity with Giggle media; anonymous standalone Game Night rooms stay
fully independent games with no account and no call.

## Encounter calls share one game room

Someone already joined in a Giggle Meet (encounter) call moves into games
with no hassle and keeps the existing call: a **Play together** dice button
in the call's control bar mounts the same `GamePanel` as a stage **inside**
the encounter page, beside the video stage. Both squads receive tickets for
the SAME namespaced game room (`enc:<encounterId>` in the existing ticket
claim), so they land in one game together — never each side's separate
squad room, no routing to the lobby, no new tab, no Agora leave/rejoin.

- Token route: `POST /api/encounters/:encounterId/games/token`
  (`requireApiAuth` + the same checks as the encounter Agora token route:
  verified adult/account, live membership in one of the two squads, the
  squad still pointing at this encounter, encounter `active`, no blocked
  pair across BOTH rosters). Scope derives from the URL + session + server
  records; the body is ignored. Every renewal re-checks: an ended
  encounter or removed member stops getting tickets within ~90s.
- Ticket protocol is unchanged (same claims, issuer, audience, 90s window,
  single-use `jti`); Game Night treats the room claim opaquely.
- The encounter page keeps owning its Agora client: opening, laying out,
  or closing games only mounts the game section and restyles the video
  stage into a rail (lobby geometry: 232/300/168px, phone 108/132/84px)
  via `gg-games-open`/`data-games-layout` — tile nodes, media hosts, and
  `vcRef` stay mounted. Opening games requests no media permission.
  The shared room closes with the call.
- Phone: mic/cam stay in the bottom control bar, Close in the game header,
  game viewport on top with the friends rail below.

## Game runtime and deployment

Shared catalog browsing (search, category chips, customizable toggle,
sort) and the native How to play dialog are Game Night shell features —
the parent needs no change and the state/presentation contract above is
untouched. Individual game pages return players to the same room flow;
they never automatically start a game. The child exposes optional canvas,
input, audio, 3D and voice helpers, leaving each game's layout free to fit
its mechanics. Server snapshots carry a stable phase start and server time;
the child calibrates a monotonic clock from bounded round trips. Scoring,
deadlines and phase transitions stay on the server. Actions are bound to
the game instance and action window to reject delayed moves and timers.

Game Night is one stateful process: rooms and replay protection live in
memory, so multiple replicas or overlapping releases are unsupported.
A game-service restart resets game rooms; it does not terminate Giggle
calls. Hosting, env matrix and restart procedure live in PartyBox
`DEPLOYMENT_PLAN.md` alongside its source.

## Honest limitations

- In-call game proof uses the labeled synthetic TEST RTC stand-in
  (join/leave counting + a mounted video node) — never a real remote
  call. No real-call quality, media, or billing behavior is asserted.
- No Discord Activity implementation; the embed contract (URL + context
  message) is the documented future adapter boundary.
- Floating-call lifecycle checks use local development accounts, an actual
  game WebSocket room, and synthetic video at 1280px and 390px widths.
  Switching corners/layouts, collapsing/expanding and phone chat preserve
  the same media host and game iframe. A physical camera/microphone call
  still requires manual acceptance testing.


## Camera games: the call is the playfield

The optional v1 `state.camera` field is `{mode: "spotlight" | "gallery", featured: string | null, caption: string}`. Captions are public, capped at120 characters. A spotlight carries the verified Giggle user ID mapped by the trusted game server from a stable seat; gallery has `featured: null`. Malformed scenes reject the message. Origin, iframe-source and live authorization checks apply before any scene changes the parent.

`GamePanel.onCameraScene` reports deduplicated scenes through a callback ref, without changing authorization effects or frame identity. Auto chooses Game stage for an active scene. Explicit Faces/Compact/Floating pins win; an explicit Game stage pin shows a gallery even for another game. Closing games clears the scene. The same original lobby articles and encounter video components retain their keys and media hosts. `arrangeCameraStage` returns only boxes: spotlight occupies over half the playfield, gallery uses the available viewport; phones put video above controls. Existing camera/microphone controls and the explicit voice-request flow remain authoritative. No media stream crosses postMessage, and the iframe has no camera or microphone permission.

Pose Party rotates a performer; Show & Go shows everyone collecting an ordinary object; Charades spotlights the actor while the answer stays private. Their shared camera engine owns deadlines and ballots. Automated checks cover bounded scenes, verified identity vs duplicate names, private Charades answers, layout pins, phone/desktop geometry, fixed performance windows, duplicate/stale actions, scoring and complete matches. Browser QA uses a labeled synthetic SDK; physical two-device Agora video/audio acceptance must be tested separately.
