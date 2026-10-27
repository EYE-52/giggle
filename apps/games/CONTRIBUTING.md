# Contributing to Giggle Games

Canonical repository: **https://github.com/EYE-52/giggle**, component `apps/games`. Older standalone copies are stale. Ask the owner to grant your GitHub account repository access. Use your own account and SSH key; the handover does not include the owner's GitHub, Vercel, Railway, Namecheap or agent login sessions.

## First setup

Install Node.js **24 LTS** with npm. From the cloned repository:

```sh
node scripts/contributor.mjs setup --check
npm run dev:local
```

Setup runs `npm ci` and the build, creates `.env` with local defaults, and runs the smoke check when `--check` is supplied. It preserves an existing `.env`. The dev command explicitly loads this file; ordinary `npm start` uses the process environment and is intended for hosting.

Visit `http://127.0.0.1:8123`. Use a second browser profile or private window for another independent player. Refresh to check seat resume; join mid-match to check spectators. Standalone rooms need no API key, database, embedding API, account or video provider. Word similarity data and licensed game assets ship locally.

For a phone on your own network, set `HOST=0.0.0.0` in local `.env` and open the computer's LAN address at port8123. Camera/microphone access and some browser capabilities need HTTPS or a browser-trusted localhost origin; use a trusted development HTTPS endpoint when testing those features.

## Environment files and credentials

| File | Use |
| --- | --- |
| `.env.example` | Inert documented template, committed to Git |
| `.env` | Private local environment, created with owner-only file permissions |
| `.env.production` | Optional private maintainer configuration restored from an encrypted handover; never loaded by local setup |
| `.env.local` | A hosting tool may create this; it is not a transferable contributor credential |

Real env files and `*.gghandover` bundles are ignored by Git and excluded from deployment. No secret belongs in browser JavaScript, assets, `PUBLIC_*` URLs, screenshots, issues or PR descriptions. Public config only exposes game/WS URLs and whether the optional bridge is enabled.

### Local Giggle Meet integration

For integration work, use a development Giggle instance and a separate development bridge secret:

```sh
node scripts/contributor.mjs setup --bridge
```

This generates a local secret in `.env` and trusts `http://localhost:3000` / `http://127.0.0.1:3000` as development parent origins. Adjust them to your local Giggle frontend's actual origin. Copy that local `GAME_BRIDGE_SECRET` privately into the development Giggle API environment, and set its `GAMES_PUBLIC_URL=http://127.0.0.1:8123`. Both servers must use the same secret. Restart after env changes. Do not use the production bridge key for local ticket generation.

Giggle identity, call and media credentials belong to the separate **EYE-52/giggle** project. Its owner grants that project and its development environment separately. The game iframe uses the parent call bridge; opening a game does not request the microphone or move a call to a new provider. Test sign-in, active-call access, switching games, reconnect and media cleanup with actual authorized test accounts.

### Private maintainer handover

Game contributors can skip this section. An authorized maintainer can restore the owner-supplied encrypted bundle:

```sh
node scripts/contributor.mjs import --bundle /private/path/giggle-games.gghandover
```

Enter the separately supplied passphrase when prompted. The script writes `.env.production` with private file permissions, refuses to overwrite an existing file, and leaves `.env` unchanged. The bundle contains only the game backend's allowlisted application variables. It excludes personal/temporary login tokens and unrelated services.

To create another handover, the owner uses their own authorized Railway CLI session:

```sh
node scripts/contributor.mjs export --railway --out /private/path/giggle-games.gghandover
# Or export an existing app-only env file:
node scripts/contributor.mjs export --from /private/path/.env.production --out /private/path/giggle-games.gghandover
```

The existing destination must be outside the repository. The parent directory must already exist. Choose a passphrase of at least 16 characters. Encryption uses Node's native scrypt and AES-256-GCM. Send the bundle only to an authorized maintainer and send the passphrase separately. A production bridge key can authorize private game joins; possession should be limited to people who need that responsibility. For automation, `--passphrase-file` accepts an owner-only regular file; the passphrase never goes in command arguments or console output.

## Game development and checks

Use a `codex/` or descriptive feature branch. Start from the reviewed `main` baseline unless you are explicitly coordinating with an active rebuild. Do not replace another contributor's uncommitted files.

```sh
npm run new-game -- my-game
npm run check-game -- my-game
npm test
npm run build
npm run pack:kit
```

See [GAME_GUIDE.md](GAME_GUIDE.md), [GAME_AUTONOMY_GUIDE.md](GAME_AUTONOMY_GUIDE.md), and [GAME_KIT_GUIDE.md](GAME_KIT_GUIDE.md) for the actual game contracts. The platform owns rooms and identity; each game can own its render engine, HUD, controls, menus and animation. Rules, scoring, deadlines and private information stay authoritative on the server. Dispose listeners, graphics, timers and audio when leaving or changing the game. Do not choose touch-only controls from viewport width; mouse/keyboard and touch-capable laptops must remain usable.

For Muse-assisted implementation, follow [MUSE_QA.md](MUSE_QA.md). Muse must exercise the real browser tools and record failures; a source review alone is not a playtest.

Before a PR, exercise a complete match and rematch with multiple players, a late watcher, a reconnect, rapid duplicate actions and a host leaving. Check keyboard-only controls and portrait/landscape touch layouts. Confirm game results wait for the final action animation. Record the devices and browsers actually tested; screenshots at phone dimensions are not a physical-phone test. Keep asset source URLs, licenses and required credits with the assets.

## Deployment and ownership

| Service | Existing target |
| --- | --- |
| Vercel frontend | `giggle-play`, serving `play.gigglemeet.com` |
| Railway backend | `giggle-play-production.up.railway.app`, service `giggle-play` |
| Railway project | `2e301782-c882-4553-94e4-61b898d98f1f` |
| Railway service | `163cf83c-20a2-40f1-8795-d503a9c7840b` |
| Railway environment | `bd367c27-b9f2-4715-a40c-842f19a1f66c` |
| Giggle Meet | `https://www.gigglemeet.com`, separate app and media service |

The owner invites maintainers to the appropriate hosting teams. Sign into each service with your own account. Do not copy the owner's CLI tokens or create a new similarly named production project. The encrypted app env does not grant a hosting login.

Run the full checks on one clean snapshot. Follow [DEPLOYMENT_PLAN.md](DEPLOYMENT_PLAN.md): deploy the backend first, wait for health, then promote its matching frontend. Keep one authoritative backend replica and zero overlap while rooms are in memory. A backend restart resets active game rooms, so announce it before deployment. Do not change the separate Giggle API, Redis, shared bridge key or DNS during a routine games release. Verify fresh hosted rooms and retain the last tested release for rollback.

## Player issue reports

Players can report a game from its Room menu, or rooms/platform issues from the home and lobby footer. Reports include the selected game, issue type, description, optional steps, browser, screen size and release version. They do not automatically include room codes, names, chat, hidden words, drawings or call media. Failed submissions keep the draft and can be retried without duplicate reports.

The private inbox is `/reports/`. Its access key is an operator secret; never put it in frontend code, a URL, Git or a shared screenshot. Use the hosting team's secret controls to provision authorized maintainers. The local operator CLI accepts `GAME_REPORT_ADMIN_TOKEN`, or an owner-only JSON file selected by `GAME_REPORT_ACCESS_FILE` with `url` and `token` fields.

```sh
npm run reports -- list
npm run reports -- list --game doodle-guess --status all
npm run reports -- triage REPORT_ID
npm run reports -- resolve REPORT_ID
```

Production requires `GAME_REPORT_DB` on a persistent volume and a random `GAME_REPORT_ADMIN_TOKEN` of at least 32 characters. The Railway games service uses `/data/reports.sqlite`. Keep one service replica for this SQLite inbox and the authoritative in-memory rooms. Configure `GAME_REPORT_TRUST_RAILWAY=1` only behind Railway ingress; direct/local servers ignore forwarding headers. Preserve the volume when releasing or rolling back. Reports remain private when unauthenticated.

For a reported issue: reproduce it on the named release and browser, record the failure, add a regression check where it verifies meaningful behavior, fix it, check affected match transitions and layouts, then mark it resolved only after the fix is deployed. Do not mark physical phone or camera behavior tested from a resized browser fixture.
