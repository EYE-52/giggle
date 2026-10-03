# Giggle release runbook

This runbook deploys the unified repository. It does not certify worldwide compliance. The owner switched production stranger discovery on on 2 October 2026, before the external release gates below were complete; those gates are still open.

## Current production setup

Last verified: **4 October 2026 (Asia/Kolkata)**. This section records the live setup; the provisioning and release requirements below also cover work that is not yet enabled.

| Component | Current deployment |
| --- | --- |
| Canonical source | [EYE-52/giggle](https://github.com/EYE-52/giggle), branch `main` |
| Public website | [www.gigglemeet.com](https://www.gigglemeet.com/) |
| Apex domain | `gigglemeet.com` redirects to `https://www.gigglemeet.com/` with HTTP 308 |
| Web hosting | Vercel team `divyansh24888-5115s-projects`, project **`giggle-meet`** ([dashboard](https://vercel.com/divyansh24888-5115s-projects/giggle-meet)) |
| Vercel fallback URL | [giggle-meet.vercel.app](https://giggle-meet.vercel.app/) |
| API and realtime hosting | Railway workspace **Divyansh's Projects**, project **`giggle`**, environment **`production`**, service **`giggle-server`** ([dashboard](https://railway.com/project/2e301782-c882-4553-94e4-61b898d98f1f/service/7874f27b-f974-4fb4-9523-fb3043c38f31?environmentId=bd367c27-b9f2-4715-a40c-842f19a1f66c)) |
| API URL | `https://giggle-server-production.up.railway.app` |
| Health check | [API /health](https://giggle-server-production.up.railway.app/health), reports API, MongoDB and Redis status |
| Redis | Existing Railway service **`giggle-redis`** in the same project/environment |
| MongoDB | Existing database configured through Railway `MONGODB_URI`; its provider/account was not audited during this deployment |
| Domain registrar | Namecheap; domain migration used Vercel's project-domain move and required no registrar DNS changes |

**Use `giggle-meet`, not the old Vercel `giggle-web` project.** Both production domains were moved to `giggle-meet`. The old `giggle-web` project was not deleted during this handover. A separate older Vercel project named `giggle` is also not the current web deployment. JobCraft is a separate project and is not part of this setup.

### How each service builds

- **Vercel:** import the repository root (`./`), production branch `main`, Next.js framework. The checked-in [`vercel.json`](vercel.json) installs with `pnpm install --frozen-lockfile --filter @giggle/desktop...`, builds with `pnpm --filter @giggle/desktop build`, and publishes `apps/desktop/.next`. Do not change the Vercel root to `apps/desktop` while using these root-level commands.
- **Railway:** source `EYE-52/giggle`, branch `main`, root directory **`/server`**, Railpack builder. The observed build uses `npm install` and starts with `npm run start` (`node src/server.js`). The service runs in US West with one replica. It previously used CLI uploads; on 23 September it was connected to GitHub and deployed from `main`.
- Vercel builds **production only**: `vercel.json` sets `git.deploymentEnabled` so only `main` deploys, and branches/PRs get no preview deployment (previews failed because `NEXT_PUBLIC_BACKEND_URL` is only set for Production). To re-enable previews, add the two public variables to the Preview environment and remove that rule.
- Vercel automatically deploys pushes to `main`. Railway's setup screen once showed **“Auto deploy unavailable”**, but since 23 September merges to `main` have deployed automatically (Railway posts a `giggle - giggle-server` commit status). Still check Railway after every push and use **Deploy Changes** on the latest `main` commit if no build starts.
- Google sign-in goes through `https://www.gigglemeet.com/api/auth/google/callback`. Next.js proxies `/api/auth/*` to Railway; normal API calls and realtime sockets use the Railway backend URL directly. Keep the branded callback URL registered with Google when updating OAuth settings.

### Configuration and temporary age form

Production configuration is stored in the **Railway service Variables** and **Vercel project Environment Variables** screens. Do not copy secret values into this repository.

| Setting | Location | Current state / purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_BACKEND_URL` | Vercel / `vercel.json` | `https://giggle-server-production.up.railway.app` |
| `NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED` | (retired) | No longer read by the web app, which asks the API (`GET /api/features`); a leftover value in the Vercel dashboard does nothing and can be deleted |
| `SELF_DECLARED_AGE_ACCESS` | Railway | **`true`**, verified in the production Variables screen |
| `STRANGER_DISCOVERY_ENABLED` | Railway | `true` (owner decision, 2 October 2026; set by the owner in Railway). The one switch for web matching: the site reads it from `GET /api/features` and shows or hides matching without a rebuild |
| Database, Redis, Google OAuth, Agora and signing secrets | Railway | Existing server-only variables; use `server/.env.example` for names, never for production credentials |

The current age flow accepts a date-of-birth declaration for adults **18+** and skips the hosted Yoti check. Existing adults who already declared their age can proceed without repeating the form. Under-18 declarations remain blocked. This is self-declaration, not independent age verification.

From commit `279d64a`, temporary access is evaluated from the server setting and **does not set the database's permanent `ageVerified` flag**. When Yoti is ready, configure its server credentials and callback, set `SELF_DECLARED_AGE_ACCESS=false`, deploy/restart Railway, and test the hosted flow. Before that switch, audit any accounts created under older code: the earlier temporary implementation could have persisted `ageVerified=true` without Yoti. Disabling the flag alone does not undo those older persisted values; reconcile them against genuine provider evidence before claiming all users are Yoti-verified.

### Deploy the next change

1. Merge reviewed changes into `main` in `EYE-52/giggle` and push. Keep credentials out of commits.
2. For backend changes, check Railway's source branch and `/server` root, then verify that the latest commit is deployed. If deployment does not start automatically, use the service's deployment controls to deploy latest `main`; redeploying an older deployment can reuse its older source.
3. Check the Vercel **`giggle-meet`** deployment for the same commit and wait for **Ready** with the production domains assigned. Public environment variables are build-time values and need a new frontend build after changes.
4. Check `/health` for API `UP`, database `connected`, and Redis `connected`. All testing happens locally: before merging, run the production web build against the local API (`next build` with `NEXT_PUBLIC_BACKEND_URL=http://localhost:3001`, then `next start -p 4000`, with the API from `server/.env.local`) and `pnpm --filter @giggle/desktop test:local-smoke`. This signs in a synthetic account through the development auth exchange, checks home, friends, wallet, profile and the avatar, then creates a squad and leaves it. Run the Playwright suite (`e2e/`) as well, plus `npm --prefix server run verify:deploy-bundle`. That check boots the API from only the files the deploy ships (`server/` minus `.dockerignore`) and fails unless it stays healthy after its delayed startup jobs; it exists because a require into the excluded `scripts/` folder once crashed production 15 seconds after every start. After deploying, check only the public production endpoints, and keep polling `/health` for at least 5 minutes: a crash that happens after startup only shows up once the deploy has already been marked successful. `test:prod-smoke` exists for production, but it needs Railway's `AUTH_EXCHANGE_SECRET` in the gitignored `apps/desktop/.env.prod-smoke` and is not part of the normal process.
5. For a rollback, use Vercel's previous production deployment and Railway's previous successful backend deployment as appropriate. Check environment variables separately: rolling back code is not a guarantee that variables are restored. Repeat health and sign-in checks after rollback.

### Verified production checkpoint (4 October 2026)

- Commit: [`eec12ff`](https://github.com/EYE-52/giggle/commit/eec12ff), including the earned-credit Wallet, seven-day Giggle+, character accessories, topics and call-state fixes.
- Vercel: [`F33pPeVNUn7MkiRmrfKQ3aahtPfp`](https://vercel.com/divyansh24888-5115s-projects/giggle-meet/F33pPeVNUn7MkiRmrfKQ3aahtPfp), **Ready**, serving the production domains.
- Railway: [`eb2f23f9-eec7-4459-9c80-0a8c5f3a7ecb`](https://railway.com/project/2e301782-c882-4553-94e4-61b898d98f1f/service/7874f27b-f974-4fb4-9523-fb3043c38f31?environmentId=bd367c27-b9f2-4715-a40c-842f19a1f66c&id=eb2f23f9-eec7-4459-9c80-0a8c5f3a7ecb), **Success**.
- Production check: 12 public health checks over 316 seconds had zero failures; API, MongoDB and Redis stayed connected. Normal Google logout/login returned the owner to Home and preserved appearance preferences. The production Wallet loaded without granting rewards to an ineligible squad member.
- Local validation: 710 automated tests passed; web production build, native TypeScript and server deploy-bundle startup passed. Browser layout and functional evidence, plus remaining physical-device limits, are recorded in [the QA report](docs/superpowers/audits/2026-10-04-launch-qa.md).
- These deployment IDs identify a verified checkpoint. For any later push, inspect the current `main` deployment in both dashboards and repeat the checks above; do not redeploy an old ID expecting newer source.

Historical incident: a September cover-storage release crashed the API about 15 seconds after boot because a startup job required a file excluded by `.dockerignore`. The bundle check and five-minute health watch remain required to catch delayed startup failures.

## 3 October 2026 UI and lobby fixes

- Production still deploys automatically from `main`: Vercel serves the website, Railway serves the API and realtime connections.
- `STRANGER_DISCOVERY_ENABLED=true` was restored on the Railway `giggle-server` service; `/api/features` now reports `strangerDiscovery: true`. The lobby leader gets **Find a squad**; other members must be ready first. Keep the existing external release gates in this runbook visible.
- Friend refreshes discard snapshots started before a mutation, and crossed requests that become a friendship appear correctly. Lists keep their natural height across skins.
- Media controls follow capture state, camera off releases capture, and repeated lobby refreshes no longer restart the same video playback. Camera and microphone controls remain visible before connecting and during phone chat; each starts only its chosen device. Find a squad remains visible to all members, with a disabled state and explanation when the leader must act. Returning to the browser refreshes the matching feature switch.
- Chat follows each skin, with native Unicode emoji choices. Scrapbook uses a ruled notepad and taped participant frames. No external emoji image library is required.
- Validation: desktop and Agora checks, a production build, local friend acceptance/reload, local chat delivery, and visual checks of all five skins, including Scrapbook on a phone. Physical two-device camera/microphone validation is still needed.

## 4 October 2026 prelaunch UI and QA

- Home, Friends, Discover, Profile and sign-in now share more consistent spacing and theme surfaces. Scrapbook settings use notebook paper; Home retains the sticky-note cards and the shared Giggle mark.
- Chat links are clickable, short-screen emoji pickers keep the input reachable, and notifications no longer sit below transformed page content.
- Approved squad requests enter the lobby automatically. Encounter device controls follow actual capture state and cannot show a disconnected device as enabled.
- Local validation and remaining physical-device gaps are recorded in [the prelaunch QA report](docs/superpowers/audits/2026-10-04-launch-qa.md). This does not close the external release gates or certify real camera/microphone behavior.

## Earned credits and Giggle+ (4 October 2026)

The web Wallet has no checkout, subscription pricing, token packs or automatic renewal. The legacy preview billing processor remains disabled in production. Credits are noncash app rewards; existing `User.tokens` stores their server balance.

- A successful new-account referral gives the inviter and new member 100 credits each. Existing accounts cannot apply a referral again. The landing/sign-in flow preserves the invite code.
- Leading a squad earns 25 credits once per account. `GET /api/me/wallet` checks authoritative squad membership and atomically records `first_squad` in `earnedRewardIds`; refreshes and concurrent requests cannot duplicate it. This also allows existing squad leaders to earn the reward once.
- `POST /api/me/wallet/redeem` accepts only `perkId: "giggle_plus"`. The server atomically spends 200 credits and grants a seven-day pass. Active passes and insufficient balances return a conflict without spending. These values live in `server/src/services/walletService.js`.
- Plus provides eight-person squad capacity and a profile badge. Free squads allow four. Capacity is calculated from the current leader's live, unexpired entitlement; an expired pass returns to four. Existing members are not evicted when a pass expires. Legacy permanent premium grants without an expiry remain supported.
- Wallet reads/redemption require normal adult API authorization and use private, no-store responses. Cached client balances are display-only and are replaced by the server response, including debits.
- Cover styles, character accessories and color controls remain freely available. Do not describe already-free cosmetics as paid perks. The native Wallet no longer advertises subscriptions or cosmetic purchases; pass redemption is currently on the website.

Topics can be selected at squad creation and edited in the lobby. Popular topics count currently open squads rather than inventing a historical trend. Client and server reject known sexual/hateful/harmful terms, including common obfuscation, but this keyword filter does not replace moderation operations or detect every language and evasion.

## Runtime

- **Frontend runtime:** Node 22.13.0 and pnpm 10.x.
- **Backend runtime:** Node >=20.18 <25 and npm >=10.

## Required order

1. **Provision Mongo, Redis, Agora, Yoti, auth providers, monitored support/safety mailboxes, and high-entropy secrets.** Configure Railway from `server/.env.example`; use reviewed production URLs and credentials.
2. **Deploy `server/` to Railway from this repository.** Verify `/health`, Yoti verification session/status, report persistence, block enforcement, identity-only export, and staged account deletion before building clients.
3. **Deploy the repository root to Vercel.** Use checked-in `vercel.json`, which builds `apps/desktop` and outputs `apps/desktop/.next`. Set `NEXT_PUBLIC_BACKEND_URL`. Web matching follows the API's `STRANGER_DISCOVERY_ENABLED`; there is no web build flag for it.
4. **Build `apps/mobile` with Expo/EAS after server verification.** Set `EXPO_PUBLIC_BACKEND_URL`, `EXPO_PUBLIC_STRANGER_DISCOVERY_ENABLED=false`, and `EXPO_PUBLIC_IOS_DISCOVERY_ENABLED=false` in the selected EAS environment. Rebuild after changing these public build-time values.
5. **Smoke-test with two verified accounts.** Confirm report acknowledgement, blocking/no rematch, chat rejection, export, deletion staging, and a full match: search, automatic join, call, leave.

## Environment contract

Railway server-only values include:

```text
MONGODB_URI
REDIS_URL
JWT_SECRET
AUTH_EXCHANGE_SECRET
BACKEND_PUBLIC_URL
FRONTEND_URL
AGORA_APP_ID
AGORA_APP_CERTIFICATE
YOTI_AGE_API_KEY
YOTI_AGE_SDK_ID
AGE_VERIFICATION_CALLBACK_URL
ADMIN_EMAIL
STRANGER_DISCOVERY_ENABLED=false
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
APPLE_SERVICE_ID
APPLE_TEAM_ID
APPLE_KEY_ID
APPLE_PRIVATE_KEY
```

Set `AGE_VERIFICATION_CALLBACK_URL=https://www.gigglemeet.com/home`. Yoti appends its session id and returns the signed-in browser to the existing age gate, which reconciles the result server-to-server. There is no API callback route.

Vercel build values:

```text
NEXT_PUBLIC_BACKEND_URL
```

- **Vercel project `giggle-meet`:** configure `NEXT_PUBLIC_BACKEND_URL` (from `vercel.json`); keep server and OAuth secrets out.

Expo/EAS build values:

```text
EXPO_PUBLIC_BACKEND_URL
EXPO_PUBLIC_STRANGER_DISCOVERY_ENABLED=false
EXPO_PUBLIC_IOS_DISCOVERY_ENABLED=false
```

`JWT_SECRET` and `AUTH_EXCHANGE_SECRET` must each be at least 32 characters. `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` values are visible in client bundles and are surface controls, not authorization. Never put Yoti, Agora certificate, JWT, OAuth, email, database, or Redis secrets in public variables, `vercel.json`, or `app.json`. The server flag is the enforcement boundary and takes effect after an API restart.

Missing Yoti configuration leaves identity, support, data export, and account deletion available, but age verification and all social access fail closed — unless `SELF_DECLARED_AGE_ACCESS=true` is set, in which case self-attested DOB (18+) alone grants adult access with no document/liveness check. This mode does not persist provider verification: existing and new declared adults receive temporary access, and disabling the flag requires Yoti again. This is a **temporary, weaker-than-verified-adult posture**: unset it in Railway (or leave default `false`) the moment `YOTI_AGE_API_KEY`/`YOTI_AGE_SDK_ID` are live, and treat it as still-open in the release gates below until then.

Redis TLS certificate verification stays enabled by default. Use `REDIS_TLS_REJECT_UNAUTHORIZED=false` only as a temporary escape hatch for a controlled deployment with a self-signed Redis TLS certificate.

## Native store age controls

- **Apple:** keep iOS stranger discovery disabled, complete the App Store age questionnaire, apply an **18+ age-rating override**, and evaluate the Declared Age Range capability for each distributed region before shipping a native build. Apple currently says services used primarily for random or anonymous chat do not belong on the App Store.
- **Google Play:** declare an adult-only target audience, supply the public Safety standards and a staffed child-safety contact, and configure Play Console minor blocking before the random-chat rule takes effect on **August 26, 2026**. Use the Play Age Signals API only where applicable law requires an app-side age signal; it supplements rather than replaces Yoti's server-side verified-adult gate.
- Record store-console screenshots, reviewer notes, and real-device results as release evidence. Checked-in source cannot prove these external settings.

## Release gates

Web stranger discovery is live by owner decision (2 October 2026). Do not submit store builds or describe the product as globally compliant until there is evidence for:

- production Yoti tenant, callback, consent/retention terms, appeal path, and live verification tests (`SELF_DECLARED_AGE_ACCESS=true` does NOT satisfy this gate — it's a stopgap, not verification);
- trusted geolocation and counsel-reviewed jurisdiction policy;
- staffed moderation/support, report response, emergency, CSAM, and law-enforcement processes;
- reviewed legal entity identity, addresses, Terms, Privacy, Safety, and store declarations;
- vendor deletion/retention/backups and production data-processing agreements;
- Apple/Google age-rating, child-safety, random-chat, privacy, and account-deletion declarations;
- production credentials, monitoring, rollback ownership, and two-account web/iOS/Android smoke evidence.

Until these gates clear, keep the native discovery flags `false` and describe the repository as code-ready, not globally compliant.
