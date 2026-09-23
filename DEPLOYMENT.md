# Giggle release runbook

This runbook deploys the unified repository. It does not certify worldwide compliance. Keep production stranger discovery off until the external release gates below are complete.

## Current production setup

Last verified: **23 September 2026 (Asia/Kolkata)**. This section records the live setup; the provisioning and release requirements below also cover work that is not yet enabled.

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
| `NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED` | Vercel / `vercel.json` | `false` |
| `SELF_DECLARED_AGE_ACCESS` | Railway | **`true`**, verified in the production Variables screen |
| `STRANGER_DISCOVERY_ENABLED` | Railway | Required to remain `false` until release gates pass; recheck the actual value before any discovery release |
| Database, Redis, Google OAuth, Agora and signing secrets | Railway | Existing server-only variables; use `server/.env.example` for names, never for production credentials |

The current age flow accepts a date-of-birth declaration for adults **18+** and skips the hosted Yoti check. Existing adults who already declared their age can proceed without repeating the form. Under-18 declarations remain blocked. This is self-declaration, not independent age verification.

From commit `279d64a`, temporary access is evaluated from the server setting and **does not set the database's permanent `ageVerified` flag**. When Yoti is ready, configure its server credentials and callback, set `SELF_DECLARED_AGE_ACCESS=false`, deploy/restart Railway, and test the hosted flow. Before that switch, audit any accounts created under older code: the earlier temporary implementation could have persisted `ageVerified=true` without Yoti. Disabling the flag alone does not undo those older persisted values; reconcile them against genuine provider evidence before claiming all users are Yoti-verified.

### Deploy the next change

1. Merge reviewed changes into `main` in `EYE-52/giggle` and push. Keep credentials out of commits.
2. For backend changes, check Railway's source branch and `/server` root, then verify that the latest commit is deployed. If deployment does not start automatically, use the service's deployment controls to deploy latest `main`; redeploying an older deployment can reuse its older source.
3. Check the Vercel **`giggle-meet`** deployment for the same commit and wait for **Ready** with the production domains assigned. Public environment variables are build-time values and need a new frontend build after changes.
4. Check `/health` for API `UP`, database `connected`, and Redis `connected`. All testing happens locally: before merging, run the production web build against the local API (`next build` with `NEXT_PUBLIC_BACKEND_URL=http://localhost:3001`, then `next start -p 4000`, with the API from `server/.env.local`) and `pnpm --filter @giggle/desktop test:local-smoke`. This signs in a synthetic account through the development auth exchange, checks home, friends, wallet, profile and the avatar, then creates a squad and leaves it. Run the Playwright suite (`e2e/`) as well, plus `npm --prefix server run verify:deploy-bundle`. That check boots the API from only the files the deploy ships (`server/` minus `.dockerignore`) and fails unless it stays healthy after its delayed startup jobs; it exists because a require into the excluded `scripts/` folder once crashed production 15 seconds after every start. After deploying, check only the public production endpoints, and keep polling `/health` for at least 5 minutes: a crash that happens after startup only shows up once the deploy has already been marked successful. `test:prod-smoke` exists for production, but it needs Railway's `AUTH_EXCHANGE_SECRET` in the gitignored `apps/desktop/.env.prod-smoke` and is not part of the normal process.
5. For a rollback, use Vercel's previous production deployment and Railway's previous successful backend deployment as appropriate. Check environment variables separately: rolling back code is not a guarantee that variables are restored. Repeat health and sign-in checks after rollback.

### Last verified release

- Commit: [`7c58c1b`](https://github.com/EYE-52/giggle/commit/7c58c1b) — re-land squad cover storage without crashing the deployed server (#11). It builds on UI polish and API scaling (#5), shared avatars (#6), covers served by URL, free-only avatars and the production smoke test (#8), and cover storage (#9, reverted in #10, fixed in #11).
- Vercel: [`9MSk3kZE6KEFLEkHbpRr4BCrsTAC`](https://vercel.com/divyansh24888-5115s-projects/giggle-meet/9MSk3kZE6KEFLEkHbpRr4BCrsTAC), **Ready**, serving the production domains.
- Railway: [`deeb5b20-7141-4bf9-98bb-f6c0e4d09501`](https://railway.com/project/2e301782-c882-4553-94e4-61b898d98f1f/service/7874f27b-f974-4fb4-9523-fb3043c38f31?environmentId=bd367c27-b9f2-4715-a40c-842f19a1f66c&id=deeb5b20-7141-4bf9-98bb-f6c0e4d09501), **Success**, deployed automatically from GitHub.
- Verified live: `/health` returned 200 with API `UP` and database and Redis `connected` at every 28-second check for 6.5 minutes after the deploy (16:11–16:18 UTC, 23 September 2026). The website returns 200.
- Local validation (all testing is local):
  - Unit tests: server 359/359 with Redis, desktop 143/143, core 74/74.
  - `verify:deploy-bundle` passed.
  - The local production build plus the real API passed `test:local-smoke` (phone and desktop).
  - Playwright: 135 passed and 0 failed on phone, tablet, laptop, desktop and wide; the real two-browser lifecycle and avatar specs passed 16/16.
- Incident: #9 (`dfcb2a5`) crashed the API about 15 seconds after every boot, from about 22:43 UTC on 22 September until #10 restored service at about 15:58 UTC on 23 September. The startup job required a file from `server/scripts/`, which `.dockerignore` excludes from the deployed image. `test/deployBundle.test.js` and `verify:deploy-bundle` now catch that failure, and step 4 above requires watching `/health` for 5 minutes after each deploy.
- Update this section after future releases; these IDs are a historical checkpoint, not necessarily the latest deployment.

## Runtime

- **Frontend runtime:** Node 22.13.0 and pnpm 10.x.
- **Backend runtime:** Node >=20.18 <25 and npm >=10.

## Required order

1. **Provision Mongo, Redis, Agora, Yoti, auth providers, monitored support/safety mailboxes, and high-entropy secrets.** Configure Railway from `server/.env.example`; use reviewed production URLs and credentials.
2. **Deploy `server/` to Railway from this repository.** Verify `/health`, Yoti verification session/status, report persistence, block enforcement, identity-only export, and staged account deletion before building clients.
3. **Deploy the repository root to Vercel.** Use checked-in `vercel.json`, which builds `apps/desktop` and outputs `apps/desktop/.next`. Set `NEXT_PUBLIC_BACKEND_URL` and keep `NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED=false`.
4. **Build `apps/mobile` with Expo/EAS after server verification.** Set `EXPO_PUBLIC_BACKEND_URL`, `EXPO_PUBLIC_STRANGER_DISCOVERY_ENABLED=false`, and `EXPO_PUBLIC_IOS_DISCOVERY_ENABLED=false` in the selected EAS environment. Rebuild after changing these public build-time values.
5. **Smoke-test with two verified accounts.** Confirm report acknowledgement, blocking/no rematch, chat rejection, export, deletion staging, and the disabled-discovery state. Enable `STRANGER_DISCOVERY_ENABLED=true` only after every release gate passes.

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
NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED=false
```

- **Vercel project `giggle-meet`:** configure `NEXT_PUBLIC_BACKEND_URL` and `NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED=false`; keep server and OAuth secrets out.

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

Do not enable stranger discovery, submit store builds, or describe the product as globally compliant until there is evidence for:

- production Yoti tenant, callback, consent/retention terms, appeal path, and live verification tests (`SELF_DECLARED_AGE_ACCESS=true` does NOT satisfy this gate — it's a stopgap, not verification);
- trusted geolocation and counsel-reviewed jurisdiction policy;
- staffed moderation/support, report response, emergency, CSAM, and law-enforcement processes;
- reviewed legal entity identity, addresses, Terms, Privacy, Safety, and store declarations;
- vendor deletion/retention/backups and production data-processing agreements;
- Apple/Google age-rating, child-safety, random-chat, privacy, and account-deletion declarations;
- production credentials, monitoring, rollback ownership, and two-account web/iOS/Android smoke evidence.

Until these gates clear, keep `STRANGER_DISCOVERY_ENABLED=false` and describe the repository as code-ready, not globally compliant.
