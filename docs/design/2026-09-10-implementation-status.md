# Giggle implementation status

Date: 10 September 2026

This is an implementation and automated-check report. It is not a production-readiness or live-call report.

## Approved reference

`APPROVED-DIRECTION.md` is the design reference. The current preview is version 12 at https://giggle-design-playground.divyanx.chatgpt.site/?v=12#encounter. Version 12 removes vague slogans and uses clear screen/action labels. Version 10 aligns stacked phone groups to the top. Version 11 shortens the call header, removes the duplicated matchup row, and places one name/count label above each squad. These are refinements within the approved theme. `/design-check` still redirects there. The rejected standalone previews are not mounted.

## Implemented in the actual call apps

The shared camera-aware grid now uses the approved preview's packing rules. It keeps participant order, fits frames to actual camera proportions, and changes squad space with the available width, height, and participant count. It no longer uses equal-size frames in the default live-call layout. Web reads camera dimensions from media elements; native uses Agora dimension events with rotation normalization. Camera-off people use a neutral square fallback. Empty squads and tiny stages have explicit bounds checks; large rosters use a bounded set of layout candidates.

Both call apps now open personal options from a participant tile. Web shows a small dot hint only on hover, keyboard focus, or while the menu is open. Native opens a compact sheet on tap. Adjust view, Focus on this person, and Mute for me live in this menu. Camera-off participants keep their menu with framing disabled. Your own tile has no remote listening action. Enhance voice is explicitly unavailable; there is no voice enhancement implementation.

Full view, Fill, and 1x–2.5x zoom change the viewer's presentation. They do not change capture settings, publish a new track, or rejoin the channel. Web uses a muted copy of the existing camera stream as the blurred background in Full view. Its framing preview uses the current tile proportions. Closing the preview releases only the decorative media elements; it never stops shared stream tracks. Native uses a clipped texture view for framing and zoom. Native does not yet render the blurred duplicate backdrop.

Mute for me calls the SDK for the selected remote participant: remote audio-track volume on web, per-user playback gain on native. It does not change the sender's microphone or other listeners. SDK failures leave the displayed preference unchanged and show an error. Web reapplies the selected volume before a replacement audio track starts playing. Leaving the call clears the listening preferences. These SDK paths were exercised with mocks; actual audible behavior still needs a device test.

Web uses a stable media host while menus, zoom, and personal listening settings change. Listening changes no longer trigger the page's remote-video attachment effect. Web stale subscription completions are ignored after leave. Existing report, block, personal leave, leader-controlled end, and access checks remain in the call flow.

The default call stage is flat and dark, with neutral camera-off tiles and restrained name labels. Desktop chat remains beside video; phone chat remains a separate view while the call stays connected. Existing header, focus-mode chrome, and other product screens still require a screen-by-screen comparison with the approved reference before claiming the full migration is visually complete.

## Checks for this implementation

- Core (previous grid pass): 73 tests passed, including 504 mixed squad-size/stage combinations with source-ratio, bounds, and overlap checks, invalid dimensions, empty squads, and a 2,000-person bounded-work case.
- An additional comparison of 84 phone, landscape, tablet, and desktop layouts matched the approved preview's geometry within 0.001 pixels.
- Agora: 21 tests passed. Mock SDK checks cover selected-person mute, republished audio, leaving during SDK loading/channel joining/microphone or camera creation/publishing, cleanup failures, old callbacks after rejoin, delayed leave completion, pending native join cancellation, and failed initialization followed by retry.
- Desktop: 153 tests passed.
- Mobile: 110 tests passed.
- Desktop production build passed with localhost backend build inputs.
- Mobile TypeScript and Expo web export passed. An Expo web export does not validate the native Agora renderer.

The browser inspection tool failed to start with `Sky Computer Use native pipe startup failed`. This pass has no new visual browser check and no physical iOS/Android check. Previous Safari checks were for the simulated Site, not these live-app components.

## Connection lifetime update

Web and native call clients now bind setup and event callbacks to their owning session. Web tracks that arrive after leave are closed without being published. An old leave completion cannot clear a replacement call. Track stop and close are isolated so a failed stop does not skip device cleanup. Late local toggle results cannot change the new call's capture state. Concurrent join attempts on an active client are rejected.

Native leave immediately rejects a pending join rather than waiting for its timeout. Queued events from released engines are ignored. Engine release still runs if leave or handler removal throws. Dimension subscribers remain registered across leave/rejoin until they explicitly unsubscribe.

The web and native encounter cleanup paths now request SDK leave immediately when the screen unmounts. Their existing join chains still wait for earlier work and cleanup before starting the next call attempt. Browser permission prompts themselves cannot be dismissed by this implementation; a late granted track is closed when the SDK returns it.

This pass reran 21 Agora, 153 desktop, and 110 mobile tests. Desktop production build and mobile TypeScript passed. The Site build and local route response passed before version 11 was privately published. The header change has not yet been visually verified in a browser or ported into the actual app headers. No server changes or real device testing were performed.

## Remaining verification and system limits

A real two-device call is required to check mixed camera orientations, rotation during calls, native texture clipping, mute/unmute and reconnect behavior, framing without audio interruption, and switching phone chat while the call runs. The environment has not verified a configured Agora project and working backend services for this flow. Do not describe the implementation as live-call verified or deployed.

Queue transitions still need atomic server-side race protection and bounded scans. Chat merges are limited to 200 messages, but Redis deduplication is ephemeral: a process crash between claiming and broadcasting a message can lose it. Reliable delivery needs a durable message record and an outbox or replay path. This pass did not change those server systems or rerun server tests.

The earlier local infrastructure check found MongoDB 8 incompatible with Docker kernel `7.0.12`; this was not refreshed in this pass. Redis was previously exposed on loopback port 16379. Check these services again before attempting a live call.

## Reproduce local checks

```sh
export PATH=/Users/divyansh/.local/share/giggle-tools/node-v22.23.2-darwin-arm64/bin:$PATH
corepack pnpm --filter @giggle/core test
corepack pnpm --filter @giggle/agora test
corepack pnpm --filter @giggle/desktop test
corepack pnpm --filter @giggle/mobile test
corepack pnpm --filter @giggle/mobile exec tsc --noEmit
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001 corepack pnpm --filter @giggle/desktop build
EXPO_PUBLIC_BACKEND_URL=http://localhost:3001 corepack pnpm --filter @giggle/mobile exec expo export --platform web --output-dir /tmp/giggle-mobile-export
```

## Page review and centered controls — current pass

The private Site is now version 13: https://giggle-design-playground.divyanx.chatgpt.site/?v=13#encounter . Source commit `fd5c9715e3d3a9d7a34a7b50dfe4539d531c24bd`. Deployment succeeded. The updated preview has five centered call controls, no bottom divider or separate right-hand actions, clearer Discover/Wallet/verification headings, and compact phone verification spacing.

Actual app changes include the same five call controls on web/native, separate personal leave and encounter-ending confirmations, a fix for a recovery banner covering More on short screens, readable phone navigation icons, shorter lobby tiles, clearer matching and profile copy, and shared colors for native avatars/profile. The native interests sheet scrolls. The public web welcome screen now uses the approved cream/terracotta direction, with a direct sign-in path and sample-photo illustration. It replaces the old cinematic landing page, its decorative film, and live-count polling. Ten assertions specific to that removed landing page were retired; welcome/sign-in browser coverage now verifies reachable actions at 320, 390 and 1440 pixels. Web sign-in, legal layouts and native onboarding use the same theme. OAuth and age access logic remain in their existing handlers.

Browser verification is now available through Playwright. The prior notes that no browser verification was possible are superseded for this pass. The review covered all 11 preview pages at desktop/phone sizes, eight protected web routes at 320/390/1440 pixels, six public web routes at phone size, and native application screens through an Expo web export. All measured page widths fit their viewport. Reference screenshots and JSON results are under `/tmp/giggle-page-audit/` (temporary local QA files). Web profile's final action remains above the bottom navigation when scrolled. The centered call row fits compact phones and short landscape screens.

Six isolated call browser tests passed across desktop and phone: chat and acknowledged retry, reactions, person focus, menu actions, group-end recovery, and personal leave. Two duplicate project cases intentionally skipped. A separate welcome/sign-in browser test passed across three widths. The API and socket fixtures do not contact other users; synthetic video frames validate layout, not real media transport.

A stale Expo export initially lacked the configured backend address and showed a blank page. A clean export with `EXPO_PUBLIC_BACKEND_URL=http://localhost:3001` and `--clear` removed that stale output. The exported mobile screens then opened without JavaScript errors using isolated API fixtures. This is browser validation of React Native web output, not a physical iOS/Android test.

The main app changes are local source, not a production deployment. The privately published Site is still a simulated design preview. Real multi-device audio/video, native device behavior, and the server durability/race limits listed above still need their own verification.

Final validation: 143 desktop tests and 110 mobile tests passed. Desktop production build, mobile TypeScript and Expo web export passed. The final exported native app browser check also opened chat and More successfully with no JavaScript errors.


## Connected main app — latest pass

The approved design is now in the actual web and native routes. The private Site remains a separate simulated preview. No production deployment was made in this pass.

The real local API is now running on loopback port 3001 with MongoDB 8.0.30 on port 17017 and Redis on port 16379. MongoDB runs natively on this Mac because its current Docker Linux kernel cannot start MongoDB 8. The database uses the `giggle-dev` replica set. Secrets are in ignored `server/.env.local`, with owner-only permissions. The API supports `HOST` for explicit loopback binding. Startup steps are in `docs/LOCAL-DEVELOPMENT.md`.

The main desktop and native More menus now offer leader-only Next squad with confirmation and retry. The five centered controls are unchanged. The server performs the skip transition under the matchmaking lock, then runs the matcher after releasing it. Repeated skip requests do not clear a newer encounter. The previous pair is excluded for two minutes. A queue-state event moves the members of both squads to the correct screen after admission completes.

Chat retries now rebroadcast the original message ID. This closes the earlier claim-before-broadcast retry gap when the sender retries; clients already merge by ID. This is not durable offline history or an outbox. Queue admission atomicity, bounded queue scans, and load testing remain separate production work.

`server/test/integration/live-flow.cjs` exercises a real local API, MongoDB, Redis and four authenticated Socket.IO clients. It creates and joins two squads, sets ready state and simulated lobby-video presence, matches them, acknowledges the encounter, checks everyone and private squad chat, retries a message with the same ID, checks personal leave, and ends the encounter. A second run checks concurrent Next squad requests, queue-state delivery to all four clients, exclusion of the previous opponent, and queue cancellation. It does not test camera or audio transport. Local test accounts remain in the database under `qa-...@giggle.local`.

A separate real-browser check used two actual sessions at 1440×900 and 390×844. It verified cross-squad chat delivery, switching phone chat back to video, no horizontal page overflow, and Next squad navigation in both sessions. No API or socket mocks were used. Four explicitly identified local QA accounts were marked verified in the local database for this check; this does not validate Google or Yoti. Screenshots are temporarily stored at `/tmp/giggle-live-verified-0.png` and `/tmp/giggle-live-verified-1.png`.

Validation: 310 server tests, 143 desktop tests, and 110 mobile tests passed. Desktop production build, mobile TypeScript, and Expo web export passed with a local backend URL. The integration and real-browser checks above passed. No physical iOS/Android or real Agora call was verified.

Still required before a real launch: connect the user's Agora project, Google OAuth project, age-verification provider, and production hosting/database settings; verify a real multi-device call and the hosted sign-in/verification flow. No service credentials were available locally, and no production discovery flag was enabled. The local age bypass is development-only.

## Local sign-in follow-up

Local testing now supports `DEV_AUTH_ENABLED=true` on the development API. The existing **Use dev account** action prepares only synthetic `@dev.giggle.local` accounts with adult fixture flags, including on repeat sign-in. No database seeding is needed for these browser accounts. Ordinary accounts and OAuth sessions keep their verification checks; production ignores this fixture option. The local setting is enabled in the ignored environment file.

Google's local failure was confirmed as HTTP 503 `PROVIDER_NOT_CONFIGURED`, not a network failure. The sign-in screen now shows that reason and points to the local account action. Google OAuth credentials are still required for a real Google login.

Validation: 315 server tests and 143 desktop tests passed; desktop TypeScript passed. Two opt-in browser tests used the real local API at phone and desktop sizes. They verified the Google error, dev sign-in to Home, and continued access after refresh. Test: `apps/desktop/e2e/local-auth.spec.ts` with `GIGGLE_LOCAL_AUTH_E2E=true` against the running local app and its development API.


## Main lobby and squad flow — current follow-up

The screenshot exposed a remaining legacy lobby, despite the earlier call-screen migration. Both actual lobby routes now use the approved cream, terracotta and smiling gg theme. Solo tiles are bounded; the floating dock, crowded settings header, fallback interests and duplicate invite sidebar are removed. Settings, member actions and join requests live in a sheet. The selected web cover is visible beside the squad heading. Phone chat has its own view; its mounted chat state survives switching back to the lobby.

Home and Discover now use the same explicit squad-name form on each platform. Creation starts with no interests. The existing invite codes, leader permissions, privacy, approval and readiness rules remain enforced by the API. Web approval from either an invite link or Home code entry follows the accepted member into the lobby; native Home also polls a pending code request. Polling no longer overwrites an open web interests draft. Matching events move the squad together, and a removed web member returns Home. Local media state comes from the SDK rather than assuming capture succeeded. Lobby member payloads include the same Agora UID used by the lobby token so remote video can attach to the right member. Actual media transport remains unverified.

Four opt-in Playwright tests in `apps/desktop/e2e/lobby-flow.spec.ts` passed against the real local API and sockets. They cover named creation and blank-name validation, invite joining, two-user chat, readiness, leader-only search, failed device setup staying in the lobby, rename and interest propagation, leadership transfer, approval through both entry paths, removal and final-member leave. The lifecycle runs at 390 and 1440 pixels; additional layout checks cover 320x568, 844x390 and 720x450 with no horizontal page overflow. These are viewport checks, not a physical browser-zoom test. Screenshots were visually inspected on desktop and phone.

A separate Expo web check at 390x844 used the real local API to create a named squad, send an acknowledged chat message, retain it when changing views and leave with confirmation. The final screenshot is `/tmp/giggle-native-lobby.png`; the temporary script is `/tmp/giggle-native-browser.cjs`. This is not a physical iOS/Android check, and native approval was not exercised in this browser script.

Validation: 315 server, 143 desktop and 110 mobile tests passed. Desktop production build, mobile TypeScript and final Expo web export passed. No production deployment, Google login, real Agora call or physical-device validation is claimed. Refresh the main local app at http://localhost:4000/home to use this lobby; the published Site remains a separate preview.
