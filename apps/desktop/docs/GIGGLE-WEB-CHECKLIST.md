# Giggle Web Delivery Checklist

Last updated: 2026-07-12

Canonical repository: `/Users/divyansh/Projects/giggle-stack/giggle-web`

Local frontend URL: `http://localhost:4000`

Local backend default: `http://localhost:3001`

Design source of truth: `docs/superpowers/specs/2026-07-12-giggle-web-experience-design.md`

## Milestone 0: Baseline and Safety Rails

- [x] Confirm the standalone repository and Vercel configuration
- [x] Inventory routes, shared components, assets, workspace packages, and existing tests
- [x] Persist and commit the product/responsive experience design
- [x] Restore a clean generated `next-env.d.ts` state without overwriting user work
- [x] Run the existing unit tests and production build
- [x] Start the frontend against the configured backend
- [x] Capture baseline screenshots at 390x844, 768x1024, 1280x800, 1440x1100, and 1728x1117
- [x] Record console errors, failed requests, and layout overflow
- [x] Run automated blank-media pixel checks for landing video
- [x] Add Playwright browser coverage and screenshot directories

Baseline evidence from 2026-07-12:

- `pnpm test`: 91 passed
- `pnpm --filter @giggle/core test`: 25 passed
- `pnpm test:e2e e2e/landing.spec.ts`: 10 passed across five viewport projects
- `pnpm build`: passed, 19 static routes generated
- Frontend `http://localhost:4000`: HTTP 200 from this repository
- Backend `http://localhost:3001/api/stats`: HTTP 200
- Screenshots: `artifacts/visual-audit/2026-07-12/landing/*-baseline.png`
- Current shell warning: Node 25.6.1 is outside the repository's supported `>=20.18 <25` range; release verification must use the pinned `.node-version` runtime.

## Milestone 1: Public Landing

- [x] Keep the live squad-versus-squad product as the first viewport signal
- [x] Restore the scroll-driven three-use-case story: form squad, match by vibe, meet live
- [x] Use a curated pinned scrub sequence with a shorter phone scroll track
- [x] Reserve stable dimensions for hero and story media
- [x] Provide poster/fallback imagery for every active landing video
- [x] Verify navigation, CTA, trust copy, privacy links, reduced motion, and keyboard access
- [x] Remove visual effects that do not strengthen hierarchy or product understanding
- [x] Capture phone, tablet, laptop, desktop, wide-desktop, and reduced-motion evidence

Story evidence from 2026-07-12:

- Existing `DemoStage` retained; duplicate story components were deliberately not added.
- Scene-caption collision fixed by mounting exactly one active caption.
- Real poster frame added for slow media and reduced-motion users.
- Browser checks validate the expected title and nonblank decoded video pixels at all three scroll checkpoints.
- `pnpm test:e2e e2e/landing.spec.ts --grep "cinematic story"`: 6 passed, 4 intentionally skipped viewport duplicates.
- Complete landing browser gate: 17 passed, 8 intentionally skipped keyboard/reduced-motion viewport duplicates.
- Public navigation follows a logical keyboard order with a visible focus ring; Enter hands the primary CTA to sign-in and legal links resolve to Privacy and Terms.
- `pnpm build`: passed after the story repair; TypeScript clean and all 19 static routes generated.
- Screenshots: `artifacts/visual-audit/2026-07-12/landing-story/`.

## Milestone 2: Sign-In and Session Handoff

- [x] Keep one dominant OAuth action and concise data-use context
- [x] Verify referral-code preservation and safe callback routing
- [x] Add explicit loading, provider failure, backend failure, and retry states
- [x] Verify local dev sign-in without exposing a production bypass
- [x] Confirm authenticated users continue to the intended route
- [x] Capture phone, tablet, and desktop evidence

Authentication evidence from 2026-07-12:

- Google OAuth remains configured and is the dominant provider action; Apple remains secondary.
- A same-origin OAuth preflight keeps backend/provider-start failures retryable on the sign-in screen.
- Safe continuations are stored per tab through the redirect and validated again in the callback.
- Dev sign-in reaches the requested local route; protocol-relative/external continuations fall back to `/home`.
- `pnpm test:e2e e2e/signin.spec.ts`: 25 passed across five viewport projects.
- Screenshots: `artifacts/visual-audit/2026-07-12/signin/`.

## Milestone 3: Lobby

- [x] Put squad, readiness, device state, and the next action in the first viewport
- [x] Explain camera/microphone intent before browser permission prompts
- [x] Keep invite, vibe, visibility, cover, and join-policy controls secondary
- [x] Make leader/member permissions and ready state unambiguous
- [x] Preserve squad state through media errors and recoverable API failures
- [x] Verify loading, missing squad, permission denied, disconnected, and retry states
- [x] Capture phone, tablet, desktop, and short-phone evidence

Lobby evidence from 2026-07-12:

- Camera and microphone startup now follows an explicit, retryable user action that explains media is used in the lobby and live encounters.
- Declining or failing media access leaves the squad, readiness, matchmaking, and chat surfaces intact.
- Source-level regression coverage verifies missing-squad recovery, media permission messaging, loading, disconnected-member treatment, API rollback, and retryable errors.
- Matchmaking remains disabled with “Waiting for everyone” until all current members are ready.
- Starting matchmaking no longer silently changes the leader's ready state.
- Microphone and camera controls expose state through accessible names and `aria-pressed`.
- Readiness remains in the first viewport at 390x650, 390x844, tablet, laptop, desktop, and wide desktop sizes.
- `pnpm test:e2e e2e/lobby.spec.ts`: 5 standard viewport checks passed; short-phone check passed separately.
- Screenshots: `artifacts/visual-audit/2026-07-12/lobby/`.

## Milestone 4: Matchmaking and Match Confirmation

- [x] Show meaningful search stages instead of an indefinite spinner
- [x] Keep cancellation visible and safe
- [x] Preserve the squad when cancellation or polling fails
- [x] Deduplicate socket and polling match-found events
- [x] Verify timeout, retry, cancellation, and match-found handoff
- [x] Capture phone, tablet, and desktop evidence

Matchmaking evidence from 2026-07-12:

- Queue status advances through active-squad checking, vibe matching, and strongest-live-match stages.
- Socket and polling events retain the existing single-reveal guard and timer cleanup.
- Failed cancellation keeps the squad queued, explains that state, and changes the action to `Try cancel again`.
- Expiry and delayed handoff timers are cleaned up on unmount; the real two-user encounter test verifies queue-to-match-to-encounter handoff.
- `pnpm test:e2e e2e/matchmaking.spec.ts`: 6 passed, 4 intentionally skipped duplicate recovery checks.
- Screenshots: `artifacts/visual-audit/2026-07-12/matchmaking/`.

## Milestone 5: Live Encounter

- [x] Make participant media the dominant surface
- [x] Keep call controls stable across resize, phone rotation, and safe areas
- [x] Make mute, camera, connection, participant departure, and ended states clear
- [x] Verify grid, versus, spotlight, and focused-participant modes
- [x] Verify reactions, chat, report, leave, and end-call permissions
- [x] Clean up media tracks, socket listeners, timers, and pending navigation
- [x] Run canvas/video pixel checks and confirm nonblank media frames
- [x] Capture phone, tablet, desktop, wide-desktop, and reduced-motion evidence

Encounter evidence from 2026-07-12:

- Browser automation creates two real users, squads, queues, and a shared encounter before testing the UI.
- Participant frames remain at usable dimensions in Versus, Grid, and Spotlight modes.
- The control toolbar exposes stable microphone, camera, and end-action names and state.
- Phone portrait and landscape, tablet, laptop, desktop, wide-desktop, and reduced-motion layouts pass.
- Frame screenshots are downsampled and checked for luminance range/non-dark pixel ratio, catching blank media surfaces.
- Ending the encounter performs backend cleanup and returns the leader to Home.
- Screenshots: `artifacts/visual-audit/2026-07-12/encounter/`.

## Milestone 6: Shared Product Experience

- [x] Curate authenticated navigation separately for phone, tablet, and desktop
- [x] Apply the visual system to Home, Discover, Friends, Profile, and Premium
- [x] Remove card/pill clutter and keep one primary action per state
- [x] Standardize loading, empty, failure, offline, and success feedback
- [x] Verify theme behavior, focus rings, touch targets, and text contrast

Navigation evidence from 2026-07-12:

- Phone uses a safe-area-aware four-destination bottom bar while theme and notifications remain in a quiet top utility bar.
- Tablet uses icon-first top navigation; laptop, desktop, and wide desktop use labeled top navigation.
- Active destinations expose `aria-current="page"`, and phone content reserves space for the fixed bar.
- `pnpm test:e2e e2e/navigation.spec.ts`: 5 passed.
- Screenshots: `artifacts/visual-audit/2026-07-12/navigation/`.

Product-route evidence from 2026-07-12:

- Home, Discover, Friends, Profile, and Wallet each expose a clear first task without horizontal overflow, console errors, or failed requests.
- Phone layouts keep primary actions and empty-state guidance above the fixed navigation; larger layouts constrain content instead of stretching cards across the viewport.
- Profile keeps chips only for direct multi-select preferences and identity choices; the remaining routes avoid decorative pill and card repetition.
- Wallet remains informational while payments are deferred and exposes no misleading buy, subscribe, or checkout action.
- `pnpm test:e2e e2e/product-routes.spec.ts`: 25 passed across five viewport projects.
- Screenshots: `artifacts/visual-audit/2026-07-12/product-routes/`.
- Saved light mode survives reload, keyboard users can reveal and activate the skip link, and focused controls expose a visible ring.
- Phone shell navigation and utilities retain at least 44x44 CSS-pixel targets; primary body-text tokens clear 4.5:1 contrast in both themes.
- `pnpm test:e2e e2e/shell-accessibility.spec.ts`: 3 passed, 7 intentionally skipped duplicate viewport checks.
- Unit contracts cover compact loading skeletons, actionable empty states, inline failure and retry feedback, offline presence, and success only after backend confirmation.

## Milestone 7: Release Gate

- [x] Run all unit and Playwright tests
- [x] Run a clean production build from the standalone repository
- [x] Verify production environment validation and OAuth rewrite behavior
- [x] Review browser console errors and failed network requests
- [x] Verify no horizontal overflow or overlapping controls at all target viewports
- [x] Verify reduced motion and keyboard-only navigation
- [x] Document final local URL, commands, screenshots, remaining risks, and deployment steps
- [x] Mark the active goal complete only after every required gate has evidence

Final release evidence from 2026-07-12:

- Node `22.13.0`: `pnpm install --frozen-lockfile` completed with the lockfile unchanged.
- `pnpm test`: 94 passed.
- `pnpm --filter @giggle/core test`: 25 passed.
- `pnpm test:e2e`: 92 passed, 23 intentionally skipped duplicate viewport checks.
- Production `pnpm build` with the configured backend URL: passed; 19 routes generated.
- Browser checks cover console errors, failed requests, overflow, media pixels, phone landscape, reduced motion, keyboard navigation, theme persistence, focus, touch targets, and text contrast.
- Canonical Node `22.13.0` dev server: `http://localhost:4000` returned HTTP 200; local backend `/api/stats` returned HTTP 200.
- Deployment and residual-risk handoff: `docs/GIGGLE-WEB-HANDOFF.md`.

## Working Rules

- Update this file as checklist items are completed.
- Store visual evidence under `artifacts/visual-audit/YYYY-MM-DD/<route>/<viewport>.png`.
- Store important decisions in the design spec or the implementation plan, not only in chat.
- Do not overwrite unrelated worktree changes.
- Add no dependency when existing React, Next.js, browser APIs, or installed packages cover the requirement.
- Every non-trivial behavior change starts with a failing test and ends with fresh verification.
