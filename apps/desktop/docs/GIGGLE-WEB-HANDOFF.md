# Giggle Session Handoff

Updated: 2026-08-10 (Asia/Kolkata)

## Start here

- Canonical repository: `/Users/divyansh/Projects/giggle-stack/giggle`
- Active worktree: `/Users/divyansh/.config/superpowers/worktrees/giggle/global-age-safety`
- Branch: `codex/global-age-safety`
- Reviewed code commit: `6c1a41be69d950c9464eeb86d4fe2315024396c3`
- Remote: `EYE-52/giggle`
- Draft PR: https://github.com/EYE-52/giggle/pull/2 (targets `main`)
- Do not use the old `giggle-app` or `giggle-web` split repositories.

The branch is pushed and clean. It is not merged into `main`. Production was deployed manually from this branch, so production is currently ahead of `main`.

## What was delivered

### Verified-adult safety

- One live verified-18+ access decision across API, squads, matchmaking, sockets, Agora, desktop, and mobile.
- Under-18 and unverified accounts cannot use social/video discovery.
- Identity-only access remains available for support, account export, deletion, recovery, and sign-out.
- Report, block/unblock, moderation review, privacy, deletion serialization, and discovery kill switches are implemented.
- Production stranger discovery is explicitly disabled.

### Performance

- Ready state updates locally instead of waiting for full squad reloads.
- Redis session and queue mutations use pipelines with rollback/error handling.
- Squad reads parallelize independent network work.
- Matchmaking returns after durable queue insertion and polls without overlapping requests.
- Desktop and mobile cancellation races are guarded.
- Desktop audio-only lobby entry and chat retry behavior are covered by regressions.

## Production state

### Web

- URL: https://www.gigglemeet.com
- Vercel project: `giggle-web`
- Deployment: `dpl_GQCeHK2wxfibCSbowx2NJg2rrLZ8`
- Deployment URL: https://giggle-rc16tpkhl-divyansh24888-5115s-projects.vercel.app
- Last smoke check: HTTP 200; Vercel target `production`, status `Ready`.

### API

- URL: https://giggle-server-production.up.railway.app
- Railway project/service: `giggle` / `giggle-server`
- Deployment: `1779e84a-f83f-459b-8790-524867236feb`
- Last smoke check: API health and the public web, Privacy, Terms, Safety, and Support pages returned HTTP 200.

### Safety flags and blockers

- `STRANGER_DISCOVERY_ENABLED=false` in Railway.
- `NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED=false` in Vercel.
- The Yoti callback is configured as `https://www.gigglemeet.com/home`; the previous documented API callback route did not exist and was corrected.
- Yoti production API key and SDK id are still missing. Verification therefore fails closed; social access remains unavailable.
- `ADMIN_EMAIL` is not configured in Railway, so the moderation review queue has no production admin identity yet.
- Do not enable stranger discovery until Yoti, moderation/support staffing, legal review, trusted location handling, vendor retention/deletion, and app-store declarations are complete and evidenced.
- Mobile source is pushed, but no App Store/Play Store build was deployed.

## Verification evidence

Fresh checks on `6c1a41b`:

- Server: 301/301 passed.
- Core: 61/61 passed.
- Desktop: 145/145 passed.
- Mobile: 104/104 passed.
- Desktop production build passed.
- Mobile TypeScript check and Expo web export passed (20 routes).
- Root production audit: no known vulnerabilities.
- Server production audit: 0 vulnerabilities.
- Local verification used Node 25.6.1 with engine warnings; the repository supports Node `>=20.18 <25`, and Vercel built successfully on Node 22.

## Next session

```bash
cd /Users/divyansh/.config/superpowers/worktrees/giggle/global-age-safety
git status -sb
git fetch origin --prune
gh pr view 2
```

Then:

1. Review PR #2 and merge it only when the user asks; `main` has not been changed.
2. Provision and live-test Yoti plus the external launch gates before enabling discovery.
3. Run a real two-account production smoke test for sign-in, age verification, lobby media, matchmaking, encounter, report/block, and exit/requeue.
4. Handle native store builds separately when the user resumes mobile deployment.

Never print Railway, Vercel, Yoti, MongoDB, Redis, Agora, auth, or email secret values while checking configuration.
