# Giggle release runbook

This runbook deploys the unified repository. It does not certify worldwide compliance. Keep production stranger discovery off until the external release gates below are complete.

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

- **Vercel project `giggle-web`:** configure `NEXT_PUBLIC_BACKEND_URL` and `NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED=false`; keep server and OAuth secrets out.

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
