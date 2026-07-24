# Giggle Web Handoff

Date: 2026-07-12

## Source

- Canonical repository: `/Users/divyansh/Projects/giggle-stack/giggle-web`
- Branch: `ui-redesign`
- Local frontend: `http://localhost:4000`
- Local backend: `http://localhost:3001`
- Runtime: Node `22.13.0` from `.node-version`

## Delivered

- Responsive public story with scroll-scrub video, poster fallback, reduced motion, and keyboard/legal navigation.
- Google-first sign-in with retryable provider handoff and safe per-tab continuation routing.
- Device-specific authenticated navigation: phone bottom bar, tablet icon navigation, desktop labeled navigation.
- Explicit lobby media consent, readiness rules, recoverable media/API states, and short-phone layout.
- Progressive matchmaking, safe cancellation/retry, real two-user match handoff, and stable encounter controls/media layouts.
- Audited Home, Discover, Friends, Profile, and Wallet across five viewport classes.
- Shared theme persistence, focus rings, 44px phone targets, contrast checks, and console/network/overflow assertions.

## Verification

Run from the repository root with Node `22.13.0`:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm --filter @giggle/core test
pnpm test:e2e
NEXT_PUBLIC_BACKEND_URL=https://giggle-server-production.up.railway.app pnpm build
```

Final results:

- Web unit tests: 94 passed
- Core unit tests: 25 passed
- Playwright: 92 passed, 23 intentionally skipped duplicate viewport checks
- Production build: passed; 19 routes generated
- Browser matrix: 390x844, 390x650, 768x1024, 1280x800, 1440x1100, 1728x1117, phone landscape, and reduced motion
- Visual evidence: `artifacts/visual-audit/2026-07-12/`

## Deploy

1. Confirm Vercel is linked to this repository root, not the legacy monorepo desktop path.
2. Confirm `NEXT_PUBLIC_BACKEND_URL` resolves to the production API; `vercel.json` currently sets the Railway production URL.
3. Confirm the backend OAuth credentials and Google redirect URI match the production Giggle domain and proxied `/api/auth/google` flow.
4. Run `vercel deploy --prod --yes --archive=tgz` from this repository root.
5. Smoke test Google sign-in, lobby camera/microphone consent, a two-squad match, encounter end, and mobile safe areas on the deployed URL.

## Remaining Risks

- Payments and production token redemption remain intentionally deferred; Wallet does not expose checkout.
- Automated OAuth tests verify frontend handoff and callback safety, not the live Google consent screen or production secrets.
- Browser media tests verify nonblank participant frames and responsive controls; a production smoke test on real camera/microphone hardware and a constrained network is still required.
- Next development mode may print an HMR origin advisory for `127.0.0.1`; it is not present in the production build or page console checks.
