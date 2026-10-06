# Giggle developer handover

Giggle Meet is a casual place for friends to form squads, talk on video, meet another squad, and play games together. This handover lets a new developer set up the existing product and continue building it. The owner always means **Giggle Meet** when referring to their call product.

The canonical repository is [EYE-52/giggle](https://github.com/EYE-52/giggle). Production web runs at [gigglemeet.com](https://www.gigglemeet.com); standalone Game Night runs at [play.gigglemeet.com](https://play.gigglemeet.com). Game Night has a separate source repository and deployment. A Giggle web deployment does not publish game-engine changes.

## Start with the existing code

```sh
git clone git@github.com:EYE-52/giggle.git
cd giggle
git switch -c codex/my-change
scripts/setup-dev.sh --check
scripts/setup-dev.sh --local-auth
```

Use Node 22 and pnpm 10; the supported Node range is 20.18 through 24. The setup script installs locked dependencies, creates missing `server/.env` and `apps/desktop/.env`, and generates local signing secrets without printing them. It preserves existing configuration. `--local-auth` enables only synthetic `@dev.giggle.local` accounts in a newly created development environment; keep that environment private and never copy the flag into a shared deployment.

Start MongoDB and Redis before the API. MongoDB should be configured as a replica set for transaction-dependent operations; a standalone database is insufficient for complete acceptance testing. The defaults are MongoDB on port 27017 and Redis on port 6379. Configure their actual connection URLs in `server/.env`. For a local replica set, use a connection string such as `mongodb://127.0.0.1:27017/giggle?replicaSet=rs0` after initializing the replica set. Obtain real provider credentials through the project owner when testing real video or OAuth.

Run these in separate terminals:

```sh
npm --prefix server run dev
pnpm dev:desktop
```

Open `http://localhost:4000`; the API defaults to `http://localhost:3001`. Check `http://localhost:3001/health`. The local development exchange can supply a synthetic signed-in account without sending email or using production identity. Empty Agora keys mean real camera calls cannot connect; UI fixtures and SDK mocks do not certify real media quality.

`npm --prefix server run dev:local` explicitly loads `server/.env.local` instead of the plain `.env` workflow. Do not mix the two without checking which configuration is active. Next also gives `.env.local` precedence. The setup script does not overwrite either existing file. Treat every `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` value as public.

## Source map

| Area | Main files | Responsibility |
| --- | --- | --- |
| Web app | `apps/desktop/app`, `apps/desktop/components` | Next App Router screens and shared UI |
| Authenticated shell | `apps/desktop/app/(app)/layout.tsx` | Session and adult-access gates, app presence, persistent call lifetime |
| Squad calls | `apps/desktop/lib/squadCall.tsx` | Binds call ownership to API tokens and membership presence |
| Media library | `packages/agora/src/callSession.ts`, `web.ts`, `native.ts` | Capture, publication, subscriptions, transport and cancellation |
| Shared client | `packages/core/src` | REST API, session, Socket.IO, avatars, rewards and layout helpers |
| Native app | `apps/mobile` | Expo and React Native; do not assume web behavior has native parity |
| API | `server/src/controllers`, `routes`, `middlewares` | Auth, squads, social access, games tickets and media tokens |
| Realtime state | `server/src/services` | Matchmaking, presence, Redis sessions, notifications and encounter lifecycle |
| Design | `apps/desktop/app/skins`, `design/skins`, `packages/ui-tokens` | Five skins, palettes, fonts, brand and shared geometry |
| Games adapter | `GamePanel.tsx`, `lib/gameBridge.ts`, `docs/GAME_INTEGRATION.md` | Trusted iframe messaging and game/call presentation |

Before editing Next code, read `apps/desktop/AGENTS.md` and the relevant versioned docs under `node_modules/next/dist/docs`. Read any additional directory instructions. Keep credentials out of code, logs, screenshots and prompts.

## Call behavior to preserve

A squad owns one call session above individual pages. Lobby, matchmaking and match acceptance subscribe to that session; leaving a page alone must not close camera or microphone tracks. Search and match screens show live own-squad tiles through `SquadCallPanel`. Opponent media starts only after the encounter is active.

Entering an encounter changes the Agora channel while reusing existing capture tracks and explicit mic/camera choices. Returning to the squad changes back to its private channel. The channel transfer still requires a network handshake; it cannot promise uninterrupted transport or zero latency. Explicitly leaving the squad/call, leaving calling routes or losing the authenticated shell stops capture. A newly entered call leaves devices off until an explicit request.

The web SDK warms on call routes without asking for device access. An explicit request for camera and microphone together uses Agora's joint acquisition API and overlaps capture startup with the channel handshake. Single-device buttons request only that device. Token expiry renews the existing client. Generation guards reject stale tokens, subscriptions, device operations and late permission results. Preserve these guards when adding features.

Camera off releases camera capture through the SDK; mic mute stops transmission. Browser permission persistence remains a browser/user setting. Do not keep a camera secretly capturing just to make re-enabling faster. Call-quality acceptance needs two physical devices, including a phone and a laptop, on realistic networks.

## Product and visual direction

Keep the product warm, playful and casual. Use the existing character avatars, Giggle mark, skin fonts, theme tokens and tactile surfaces. The owner dislikes corporate blue defaults, generic slogan headings, tiny game text, clipped handwriting, oversized empty columns and rigid layouts that force every game to look identical.

Design around the activity: a social game can spotlight a performer; a board game needs room for its board; an immersive 3D game needs the playfield with compact or floating call tools. Keep actual media hosts stable while their geometry changes. Use motion for feedback, hover lift and clear transitions, with reduced-motion support. Test intrinsic text height, long names, short screens and every skin; one screenshot cannot establish whole-product correctness.

## Game Night and the reusable game framework

On the owner's Mac mini, the separate source is `/Users/divyansh/Projects/partygames`. For another developer, obtain the appropriate repository/archive from the owner; this Giggle checkout does not contain that source. Start with its `GAME_KIT_GUIDE.md`, `GAME_AUTONOMY_GUIDE.md`, `CASTLE_GUIDE.md` and `DEPLOYMENT_PLAN.md`. That working tree may contain ongoing uncommitted work; inspect and coordinate before editing it.

Game Night owns rooms, authoritative simulation, clocks, spectators, game actions and catalog browsing. Its `sdk/server.js`, `sdk/browser.mjs` and scaffolder provide reusable engine and browser helpers. Games may use DOM, canvas, 3D or an isolated browser document and may supply their own HUD, controls and home page. Use shared capabilities before copying per-game mechanics; avoid imposing a universal game UI. Server-side validation remains authoritative regardless of renderer.

Giggle owns identity and media. `GamePanel` opens games inside the call with exact-origin/source `postMessage` checks and fresh, single-use, 90-second server tickets. Tickets never belong in URLs or browser storage. The games iframe receives no camera/microphone permission. Voice requests show an explicit parent control; camera scenes identify a performer or a gallery using bounded, authenticated metadata. See [GAME_INTEGRATION.md](GAME_INTEGRATION.md) for the complete protocol.

The catalog includes party games, Chess, Pocket Karts, Chain Reaction, a semantic word game and Castle Clash. Consult the current registry and per-game QA before calling any game release-ready. The castle concept is teams building defenses in one phase, attacking in the next, and using earned points for unlocks. Continue its reusable engine and individual presentation rather than starting another disconnected implementation.

The game server currently keeps rooms and replay protection in one process. Use one replica with no release overlap. A restart resets game rooms, while the separate Giggle call can continue. Do not place the persistent realtime game process in a Vercel request function; Vercel serves its frontend and Railway hosts its process. Ads are a later monetization discussion; no ad provider or Discord Activity should be assumed implemented.

## Checks before handing off a change

```sh
pnpm --filter @giggle/agora test
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/desktop exec tsc --noEmit
npm --prefix server test
npm --prefix server run verify:deploy-bundle
EXPO_PUBLIC_BACKEND_URL=http://localhost:3001 pnpm check:mobile
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001 pnpm build:desktop
```

Choose the checks appropriate to the files changed. Redis-dependent server tests need development Redis configuration in the test process; use only its `REDIS_*` settings, because loading a whole development environment with age bypasses or feature overrides changes the policy tests' assumptions. The deploy-bundle check follows the existing `server/.env.local` workflow. Run the configured local smoke and E2E workflows from [DEPLOYMENT.md](../DEPLOYMENT.md) for releases; they require a healthy local API and configuration. Verify UI in a browser at desktop, 390px and 360px widths, a short landscape viewport, all five skins and relevant dark mode. Check errors, loading feedback, permissions denied, long names, large squads and keyboard access.

For media, cover off/on choices, lobby → search → cancel, match acceptance, encounter → next/private squad, personal leave, account exit, reconnect and token expiry. `packages/agora/test/squadCall.test.cjs` covers the capture-preserving transfer and cancellation cases with a mocked SDK. Synthetic browser checks can verify routes and layout but need separate physical-device validation.

The [7 October media and layout QA record](qa/2026-10-07-squad-calls.md) records the latest focused validation and its remaining hardware limits.

For games, test real multi-client action delivery, server deadlines, duplicate/stale actions, reconnect, spectators, customization and completed matches. Read each game service's release evidence; do not infer that all games work because the catalog loads.

## Deploy and recover

Giggle's release branch is `main`. Create a focused branch, commit only owned files, push to `EYE-52/giggle`, open a reviewable PR and run the required checks. Follow [DEPLOYMENT.md](../DEPLOYMENT.md) for the current Vercel `giggle-meet` and Railway `giggle-server` projects. Merging into `main` triggers their configured deploys. Confirm the exact commit and production domains before reporting a release.

Read environment settings from the relevant dashboard without printing secret values. Web public variables require a rebuild. Backend releases require the deploy-bundle check and sustained health checks to catch delayed startup failures. Roll back to a known successful deployment for the affected service, then verify configuration and health separately. Game Night deployments follow the other repository's runbook, backend first and frontend second.

Giggle is currently adults-only. Production has used temporary adult DOB declarations while Yoti is being configured. Preserve the documented age/access gates; do not describe self-declaration as provider verification. Stranger discovery is controlled by the API's runtime feature flag, with unresolved release gates documented in the deployment runbook. Do not silently change these policies during UI or media work.

## Work still needing acceptance

1. Test real camera/audio startup and continuity on two physical devices, including Safari/iOS and permission-denied recovery. Record device, browser, network and measured startup times.
2. Finish a browser QA matrix across common modals, call layouts, roster sizes and all skins. Fix shared geometry where it causes repeated failures; retain per-screen freedom where it serves the activity.
3. Continue individual game polish and playability checks in the separate game repository, especially action races, clocks, Doodle input, semantic hints, castle progression and 3D kart controls/balance. Record completed-match evidence per game.
4. Validate camera-led games with real remote participants and the authenticated bridge. Keep voice/camera choices explicit throughout.
5. Complete the operational, identity-verification and native release gates in the deployment runbook. Concurrent-room scale acceptance and shared game state are separate from single-session load measurements.

## Prompt for the next builder

Copy the following into the next coding session, along with the specific task:

> Continue building Giggle Meet in EYE-52/giggle. Read README.md, docs/HANDOVER.md, DEPLOYMENT.md, docs/ARCHITECTURE.md, docs/GAME_INTEGRATION.md and applicable AGENTS.md files, then inspect git status and the current source. Preserve unrelated work. Use the existing five skins and casual Giggle identity. Keep squad media owned by the shared session across calling pages; preserve device choices and cancellation guards. Games use the separate PartyBox framework and trusted bridge, with server-authoritative actions and game-specific UI. Use the owner's authenticated Muse Spark 1.3 Contributor in MAX mode for bounded implementation/review tasks when requested; confirm actual model availability rather than silently substituting. Parallel workers need nonoverlapping file ownership or isolated checkouts. Give concise progress updates, prove behavior with appropriate tests and browser screenshots, and distinguish synthetic checks from real hardware acceptance. Ship only the authorized changes, report remaining gaps honestly, and keep secrets out of every artifact.
