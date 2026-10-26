# Game Night production deployment

## Canonical source and local integration

Use `EYE-52/giggle`, component `apps/games`; older standalone repositories
are historical inputs. See `INTEGRATION.md`. The active manual workflow is
root `.github/workflows/deploy-games.yml` (Deploy Games). All component
commands below run from `apps/games`; its stamp records the root Giggle SHA.
The CLI upload uses `up . --path-as-root`, retaining the existing service
root; this is not permission to change any provider root/configuration.
Current provider state and rollback pairs must be reverified after access
is restored. Historical release records below do not prove current state.

## Topology

- Public frontend and 42 active individual game pages: https://play.gigglemeet.com on Vercel (`giggle-play`).
- Authoritative room, rules, timers and WebSocket server: `giggle-play-production.up.railway.app` on Railway.
- Verified game-server region: Singapore (`asia-southeast1-eqsg3a`), one replica. Vercel serves static assets globally; realtime game actions go directly to Railway over WSS. Historical IDs below require fresh verification before release.
- Private player report inbox: `/reports/`; bearer access is configured privately. Reports persist at `/data/reports.sqlite` on the attached Railway games volume. Preserve that volume during deployments and rollback. Public submissions go directly to the configured backend; the frontend proxies only the exact inbox/report routes.
- Giggle Meet: https://www.gigglemeet.com, using its existing API service, auth and Agora media. The parent call remains mounted while the embedded game opens, changes layout or closes.
- Namecheap DNS: `play` CNAME `da6b5019fcd56d35.vercel-dns-016.com`, automatic TTL. Apex, www and mail records are retained.

## Manual release gate (prepared locally; not deployed)

The Deploy Games workflow is manual only. Review and merge the release-gate changes
before using it. Select `main` and enter its full reviewed commit as `release_sha`.
Confirm Railway incident https://status.railway.com/incident/QH8L8B3E is resolved,
reverify the actual games service configuration and successful deployment, and
obtain approval for the production release and in-memory room reset before
checking the workflow's two acknowledgement inputs. An acknowledgement is a
human preflight assertion, not an automated incident or topology check.

Keep project `2e301782-c882-4553-94e4-61b898d98f1f`, production environment
`bd367c27-b9f2-4715-a40c-842f19a1f66c`, games service
`163cf83c-20a2-40f1-8795-d503a9c7840b`, one Singapore replica, zero overlap, and
volume `573d8387-4d26-462b-a982-64ef94d4d7f9` mounted at `/data` unchanged.
Reverify the Oct 15 backend baseline `c4ab5d49-af01-4bfa-a448-26648dce0060`
(source `8db29b2cb79e08fd6d3e4e7a52fa86e79c93f61b`). The observed Oct 18 Vercel
deployment `2xxUwrBtQawo6AfoJAgR3wcrvQzM` is newer than the documented paired
frontend; establish its source and rollback compatibility before release.

All four existing deployment credentials must be present before a backend
restart. Missing credentials fail the workflow. Do not add secrets or create
persistent access merely to enable automation; that requires specific approval.
Existing authorized manual CLI release remains possible after the same gates.
The gate also requires the reviewed Games Vercel team/project IDs before a
backend restart. The frontend helper checks them again before temporary auth
storage and always deploys from `apps/games`, regardless of the caller's cwd.

The pinned Vercel 39.4.2 CLI does not read `VERCEL_TOKEN` directly. The workflow's
frontend helper reads the existing approved CI token into an owner-only temporary
`auth.json` outside the checkout, passes only its directory with `--global-config`,
and removes it after success or failure. Tokens are not command arguments and
Railway credentials are omitted from the Vercel child process. This helper does
not create credentials, sign in, or grant access; do not run it until credential
safety and the production release have been approved.

After Node 24 installation, tests and build, set `RELEASE_SOURCE_SHA` to the
reviewed checkout's full commit and run `node scripts/release-identity.js stamp`.
This requires a clean checkout and creates the generated, uncommitted
`public/release.json`: source commit, package version and deterministic SHA256
of shipped runtime/build bytes. Keep that file in both uploads. Never commit it
or stamp before the final build. Both hosts verify stamped bytes on subsequent
builds; the backend also verifies them on startup. An unstamped local server
reports `release: null`, which cannot pass the production release gate.

The backend publishes this manifest plus Railway's `RAILWAY_DEPLOYMENT_ID` in
uncached `/config.json`. The release gate requires exact source/build/version,
expected bridge/origin/WebSocket/reporting configuration, the exact new deployment ID
returned by this upload, and that exact deployment in provider terminal
`SUCCESS`. Queueing, skipped/failed jobs and stale responses cannot pass. The
frontend runs only after this gate and an immediate recheck. Its own static
`/release.json` must match; frontend `/config.json` proxies the backend and is
not evidence of the frontend build. Retain both provider IDs and the manifest
with the release report. A failed frontend verification needs investigation;
it must not trigger an automatic backend rollback or another room reset.

`public/test/` and `public/fixtures/` are local QA tools, excluded from both
hosting uploads. The production backend also rejects those routes. Verify
`/test/`, `/test/index.html`, `/fixtures/` and unknown routes return 404 on both
hosts. The known hosted backend `/%ZZ` returned 502 rather than expected 400;
retain that failing result until a new hosted check proves it resolved.

## Release checks

Run Node 24 `npm ci`, `npm test`, and `npm run build`. The required suite covers registry/rules, Room and WebSocket contracts, stale actions/timers/rematches, private roles, watchers, bridge leases/origins, board and kart simulation, clock skew and optional media cleanup. It includes unit, DOM-stub and transport checks. Separate native playthrough and screenshot ledgers cover each active game with their exact limits. Static pages are generated from the actual registry, settings and pack schemas.

Review desktop and 390px phone-width layouts, including actual actor forms and the Doodle drawing canvas. Use game-owned HUDs for boards/3D, bounded logs for text games and 44px minimum primary touch targets. Browser width screenshots do not substitute for physical device/touch or real Agora camera/microphone testing.

Build and test a clean source checkout first. Upload only `public`, `server`, `games`, `locales`, `scripts`, `sdk` and package/lock/hosting configuration files. Tests, contributor guides, evidence and editable asset sources remain in the Git source checkout. Exclude real `.env` files, credentials, `node_modules`, QA HTML/fixtures, internal evidence/design galleries and local QA logs. Only the inert `.env.example` template may remain. Preserve a checksum manifest and release archive.

## Shared identity and call bridge

The API and game server must use the same strong `GAME_BRIDGE_SECRET`, configured privately. Set `GAMES_PUBLIC_URL=https://play.gigglemeet.com` on the Giggle API. On games, allow exactly `https://www.gigglemeet.com` for embedded joins and the custom domain plus stable Vercel alias for standalone connections.

The parent requests a90-second single-use ticket only for an active adult squad/encounter member. Private encounter room claims include both squads; tickets renew every60seconds. Embedded identity stays in memory and uses fresh verified tickets to resume its seat. Standalone guest games remain account-free. Child microphone requests require the parent's explicit enable-mic action; opening a game never starts capture.

## Publish sequence

1. Verify the merged Giggle integration has healthy production API/auth/feature endpoints and a ready frontend.
2. Upload a fresh, tested source release using the production project's existing configuration. Keep one replica and zero deployment overlap. A redeploy of an older Railway deployment reuses its old region/config snapshot and is insufficient when changing regions.
3. Wait for the fresh game deployment to succeed. Verify its actual deployment region, exactly one replica and `/config.json` reporting the intended public URLs and enabled Giggle bridge.
4. Deploy the same clean release to Vercel production. Verify custom-domain HTTPS, all42 detail pages, room/QR routes, trusted frame-ancestor CSP and unknown/QA routes returning404.
5. Run hosted WSS checks with four actual peers: all42 starts, chess moves/watchers, private Doodle word/stroke/solve, custom30Q/hints/duplicate-award rejection, Chain moves and authoritative kart movement. Keep rendered-readiness and protocol-ACK evidence distinct. Reject an untrusted origin. Verify a private report receipt, unauthorized inbox rejection, and report persistence across a service restart before promoting a release that changes reporting.
6. Measure realtime delivery with24 clients (8drivers/16watchers), record RTT, snapshot gaps, buffering and disconnects. Record actual deployment IDs and test evidence in the release report.

## Operating limits and rollback

Rooms and ticket replay state currently live in one process. Use one replica and zero deployment overlap; multiple replicas need shared state before they are safe. A restart resets active game rooms. The separate Giggle media call stays mounted, but players must start/rejoin a fresh game room after a game-server restart.

To roll back, stop the current game process and upload the preserved previous release with matching production configuration, then promote its matching Vercel frontend. Do not rotate the bridge key or modify unrelated API/Redis/DNS settings during a routine game release.

This framework provides bounded server ticks, discardable backlogged motion snapshots, local prediction and remote interpolation. Internet latency still varies; no zero-lag or zero-bug guarantee is claimed. Remaining manual acceptance includes real two-device Agora media and physical mobile touch controls. Discord Activity is a future adapter; advertising placements are reserved, with no ad provider enabled.

## Release sequencing

Build and test the frontend and backend from one clean source snapshot.
Publish the backend first and wait for successful startup, public health and
the new catalogue schema before promoting the frontend production alias.
A frontend preview may be prepared while the backend builds. This avoids
new game controls meeting an older server during a split-service rollout.
Rooms are currently in memory; announce the room reset before backend
updates. Persistent room handoff and concurrent-room load acceptance remain
separate work. Keep one authoritative replica until those are implemented.

## Published 0.1.5 release — 6 October 2026

The Railway deployment `9b1e9109-fd6e-47ee-928b-fbff56c1434d` succeeded before Vercel deployment `dpl_Hc4erDJQzxT6iQQbB6JLdF3yMNUV` became ready at the production alias. Public configuration reports the existing Giggle bridge enabled. No DNS or shared-auth changes were needed.

Clean Node 24 installation: 51 test commands pass; 37 individual pages build. All 190 shipped public files match the clean release hashes. A hosted three-minute Garage Battle with 8 drivers and 16 watchers completed with 65 knockouts and respawns, all six weapons, a paid earned-coins upgrade, duplicate rejection and an upgraded rematch. Hosted Castle and Chain checks also pass. Detailed reports and source/package checksums are in `releases/2026-10-06-game-polish`.

Measured hosted RTT was 112.36 ms median / 189.83 ms p95. Snapshot gaps were 99.99 ms median / 173.33 ms p95, with a 730.83 ms maximum. This verifies the measured session, not every network or device. Physical-device and human balance acceptance remains necessary.

Railway reports that its existing `railway.json` configuration format works until 1 December 2026. Migrate that configuration in a separate tested release before the deadline.

## Published 0.1.6 phone update — 6 October 2026

Vercel deployment `dpl_47uAtzL6rcFmxL1SVM6tRW311YUB` is READY at https://play.gigglemeet.com. All 198 public files match the clean release hashes, all 37 game pages and the WSS catalogue/configuration pass, trusted framing is retained, and QA/unknown routes return404. A hosted phone-layout room confirms Auto gas movement, pickup, room-drawer release and native weapon use; portrait/landscape controls remain in bounds.

This release changes only frontend input/layout and the portable kit. All60 compared authoritative server and game rules files remain byte-identical to0.1.5. Railway deployment `9b1e9109-fd6e-47ee-928b-fbff56c1434d` is retained; no backend restart or DNS/auth change occurred. For frontend-only rollback, promote the preceding Vercel deployment without restarting Railway.

Clean Node 24 tests:51 commands pass; build37 pages; Game Kit0.1.6 consumer tests pass. Three Muse Contributor MAX sessions and Codex browser/contact QA cover all37 games; physical iOS/Android/Safari acceptance remains pending. Release archive, checksum manifest and exact evidence are in `releases/2026-10-06-phone-touch`.

## Published 0.1.9 quality release — 7 October 2026

Railway `d7bff491-482e-4824-a430-009091280f1e` is healthy with one Singapore replica. Vercel `dpl_EwYSbrFKkZFKSiHDPWT3JNLfZGUQ` was built without switching the custom domain, then promoted after backend health and the 43-game catalogue passed. All 107 clean-release test commands pass; all 43 pages build and 345 public file hashes match. Hosted 24-client Harbor Heights and all-game start/lobby checks pass. See RELEASE_REPORT.md for scope, measurements and remaining acceptance. The preserved rollback pair is Railway `9b1e9109-fd6e-47ee-928b-fbff56c1434d` with Vercel `dpl_BDuGE5Vrs4XxfwxjceHZpoQ7xj66`; backend rollback resets rooms again.

## Published 0.1.10 catalogue repair — 9 October 2026

Railway `8fa9eb88-190f-421b-9bee-506f335c18ea` is SUCCESS with one Singapore replica and zero overlap. Vercel `dpl_CeBXWP55TF4pL6uZbnttiDZccd5T` is READY and promoted at https://play.gigglemeet.com after backend health. Clean source e18a231 passes 127 required files and builds 42 pages; all 383 public hashes match. All 42 hosted protocol start/readiness/lobby paths, representative rules, native WYR rematch/End/Leave and the 24-client kart measurement are recorded in RELEASE_REPORT.md and evidence/acceptance-20261009. Castle is absent and tower defence deferred. Curated hosting upload excludes tests/evidence/galleries/fixtures and secrets; complete contributor source remains in Git. The Game Kit is synchronized at 0.1.10.

## Published 0.1.11 drawing and kart repair — 9 October 2026

Railway `4460b554-78e1-4eeb-bedc-88a29f68fde5` is SUCCESS with one Singapore replica and zero overlap. Vercel `dpl_HyRvT5xCb35M9tveM8xMzMKcv5d5` is READY and promoted after backend health. Frozen source `025a323926ffd59dc8e83f80662e057eb7076374` passes all 131 distinct required test files and builds 42 pages; all 394 deployed public hashes match. All 42 hosted protocol start/readiness/lobby checks pass. Native Doodle layout, kart setup, Chrome/Safari driving measurements and explicit limitations are recorded in `evidence/setup-20261009`. The runtime archive and manifest exclude test fixtures, galleries, real environment files and credentials. Game Kit versions are synchronized at 0.1.11. Source/evidence live on `codex/game-repair-20261008`; production code remains frozen at the source commit above.
