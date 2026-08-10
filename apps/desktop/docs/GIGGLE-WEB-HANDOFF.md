# Giggle Session Handoff

Updated: 2026-08-10 (Asia/Kolkata)

## Start here

- Canonical repository: `/Users/divyansh/Projects/giggle-stack/giggle`
- Release branch: `main`
- Release commit: `53ae2d124d9dd78c9e7ac70de8258668754e08db`
- Remote: `EYE-52/giggle`
- Merged PR: https://github.com/EYE-52/giggle/pull/3
- Do not use the old `giggle-app` or `giggle-web` split repositories.

The safety, performance, responsive encounter, and launch-polish work is merged into `main`, pushed, and deployed to web production. Native source is included, but no App Store or Play Store build was submitted.

## What was delivered

### Verified-adult safety

- One live verified-18+ access decision across API, squads, matchmaking, sockets, Agora, desktop, and mobile.
- Under-18 and unverified accounts cannot use social or video discovery.
- Identity-only access remains available for support, account export, deletion, recovery, and sign-out.
- Report, block/unblock, moderation review, privacy, deletion serialization, and discovery kill switches are implemented.
- Production stranger discovery remains explicitly disabled.

### Performance and encounter flow

- Ready state responds locally instead of waiting for a full squad reload.
- Leave and encounter exit stop local media immediately while backend confirmation remains retryable.
- Encounter cleanup parallelizes independent post-commit writes without weakening retryability.
- Matchmaking keeps the squad visible, prevents overlapping polls, and preserves cancellation recovery.
- Match handoff, requeue, next-encounter authority, chat retry, reactions, and mid-encounter squad behavior have regression coverage.

### UI and responsive behavior

- Phone and desktop calling use one responsive, theme-aware social-video system.
- Radar, battle framing, decorative versus panels, duplicated notices, and intrusive chrome were removed.
- Phone controls retain safe-area spacing and 44-point minimum touch targets.
- Ultrawide, portrait, square, and landscape video-fit behavior is covered by deterministic browser fixtures.

## Production state

### Web

- URL: https://www.gigglemeet.com
- Vercel project: `giggle-web`
- Deployment: `dpl_65sgpW8wun3LSh9NAFxoPFsVSq8E`
- Deployment URL: https://giggle-egqnroqn7-divyansh24888-5115s-projects.vercel.app
- Smoke check: homepage, Privacy, Terms, Safety, and Support returned HTTP 200.

### API

- URL: https://giggle-server-production.up.railway.app
- Railway project/service: `giggle` / `giggle-server`
- Deployment: `f0a57f6f-92a1-4153-8eb2-b57807e9150d`
- Smoke check: `/health` returned HTTP 200 with API, database, and Redis all `UP` or connected.

### Safety flags and remaining launch gates

- `STRANGER_DISCOVERY_ENABLED=false` in Railway.
- `NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED=false` in Vercel.
- The Yoti callback is `/home`; do not point it at a nonexistent API callback route.
- Do not enable stranger discovery until live Yoti verification, moderation/support staffing, legal review, trusted location handling, vendor retention/deletion, and app-store declarations are complete and evidenced.
- Do not describe the product as globally compliant until counsel and live regional/provider checks are complete.

## Verification evidence

Checks on the released code:

- Server: 302/302 passed.
- Core: 61/61 passed.
- Desktop source: 153/153 passed.
- Mobile: 110/110 passed; TypeScript passed.
- Desktop production build passed with 21 routes.
- Expo web export passed with 20 routes.
- Browser matrix: 139 passed and 94 intentionally skipped; its two brittle fixture assertions were fixed and rechecked together with 9 passed and 3 intentional skips.
- Server production audit: 0 vulnerabilities.
- Root production audit: two Expo/Metro `image-size` advisories remain; the registry reports no patched release. They are in the build-time mobile asset path, not the server runtime.
- Local verification used Node 25.6.1 with engine warnings; the repository supports Node `>=20.18 <25`, and Vercel built successfully on Node 22.

## Next session

```bash
cd /Users/divyansh/Projects/giggle-stack/giggle
git status -sb
git pull --ff-only origin main
```

Then:

1. Provision and live-test Yoti plus the external launch gates before enabling discovery.
2. Run a real two-account production smoke test for sign-in, age verification, lobby media, matchmaking, encounter, report/block, and exit/requeue.
3. Profile real devices and Railway request traces if perceived latency remains after the optimistic UI release.
4. Handle native store builds separately when mobile deployment resumes.

Never print Railway, Vercel, Yoti, MongoDB, Redis, Agora, auth, or email secret values while checking configuration.
