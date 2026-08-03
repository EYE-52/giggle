# Global Age Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every behavior change starts with a failing test.

**Goal:** Make Giggle's current social/video product verified-18+ using one live server decision, a privacy-minimizing Yoti flow, and fail-closed enforcement across HTTP, squads, matchmaking, sockets, Agora, web, and native.

**Architecture:** Keep the existing DOB fields as declaration evidence, make `ageVerified` provider-owned, and add one small `ageAccessService` reused everywhere. Split identity authentication from adult product authorization. Reuse the current blocking AgeGate UI and shared core session instead of creating a second onboarding system. Use Node's native `fetch`; add no dependency.

**Tech stack:** Node.js/Express/Mongoose, Socket.IO, React 19/Next.js 16, Expo 56/React Native, Yoti AVS hosted flow, Node test runner.

---

## File map

- Add `server/src/services/ageAccessService.js`: one adult-access decision plus bulk roster check.
- Add `server/src/services/yotiAgeService.js`: create/fetch Yoti sessions with native `fetch`.
- Add `server/src/controllers/ageVerificationController.js`: start and reconcile the authenticated user's verification.
- Modify `server/src/models/User.js`: minimal provider receipt/session metadata.
- Modify `server/src/middlewares/authMiddleware.js`: identity-only auth and live verified-adult auth.
- Modify `server/src/routes/meRoutes.js`, `server/src/routes/adminRoutes.js`: identity-only exceptions and age-verification endpoints.
- Modify `server/src/controllers/authController.js`: adult-only declaration response and truthful client state.
- Modify `server/src/controllers/squadController.js`: target/roster checks and rejection of sexual/mature room tags.
- Modify `server/src/services/matchmakingService.js`: final locked roster recheck.
- Modify `server/src/services/socketService.js`: live adult check during handshake.
- Modify `packages/core/src/api.ts`, `packages/core/src/session.ts`: verification API/state shared by web and native.
- Modify `apps/desktop/components/AgeGate.tsx`, `apps/desktop/app/(app)/layout.tsx`: two-step verification and delayed socket connection.
- Modify `apps/mobile/components/AgeGate.tsx`, `apps/mobile/app/_layout.tsx`: equivalent native flow using `Linking`.
- Modify focused server/core/desktop/mobile tests; no new test framework.

## Task 1: Centralize the adult-access decision

**Files:**
- Add: `server/src/services/ageAccessService.js`
- Test: `server/test/ageAccessService.test.js`

- [ ] **Step 1: Write failing decision tests**

Cover missing users, unconfirmed users, minors, self-attested adults, verified adults, duplicated ids, and a missing roster user. Prove production ignores the development bypass.

```js
assert.equal(hasAdultAccess({ ageConfirmed: true, isAdult: true, ageVerified: false }, production), false);
assert.equal(hasAdultAccess({ ageConfirmed: true, isAdult: true, ageVerified: true }, production), true);
assert.equal(await allUsersHaveAdultAccess(["u1", "u2"], fakeFind), false);
```

- [ ] **Step 2: Run the new test and verify red**

```bash
cd server && node --test test/ageAccessService.test.js
```

- [ ] **Step 3: Implement the smallest shared service**

Export `hasAdultAccess(user, env)` and `allUsersHaveAdultAccess(userIds, { User, env })`. Dedupe ids, fetch only the three age fields, and require every requested user to exist and pass.

- [ ] **Step 4: Run the test green**

```bash
cd server && node --test test/ageAccessService.test.js
```

- [ ] **Step 5: Commit**

```bash
git add server/src/services/ageAccessService.js server/test/ageAccessService.test.js
git commit -m "feat: centralize verified adult access"
```

## Task 2: Make HTTP authorization read live server state

**Files:**
- Modify: `server/src/middlewares/authMiddleware.js`
- Modify: `server/src/routes/meRoutes.js`
- Modify: `server/src/routes/adminRoutes.js`
- Test: `server/test/authMiddleware.test.js`
- Test: `server/test/server.test.js`

- [ ] **Step 1: Add failing middleware tests**

Prove a valid JWT with forged/stale adult claims is denied when Mongo says pending; a verified adult is allowed; missing user/database failure fails closed; responses distinguish `AGE_VERIFICATION_REQUIRED` from `AGE_RESTRICTED`.

- [ ] **Step 2: Add failing route-contract checks**

Age declaration, verification endpoints, profile read, and admin review must use identity-only auth. Social routes and both Agora token routes must keep verified-adult auth.

- [ ] **Step 3: Run targeted tests red**

```bash
cd server && node --test test/authMiddleware.test.js test/server.test.js
```

- [ ] **Step 4: Split identity from product authorization**

Rename the current JWT behavior to `requireIdentityAuth`. Make `requireApiAuth` call it, fetch the live user, apply `hasAdultAccess`, attach the user, and fail closed. Do not authorize from JWT age booleans.

- [ ] **Step 5: Apply only the narrow exceptions**

Use identity-only auth for `GET /me/profile`, `POST /me/age`, the new verification routes, and admin routes. Keep profile mutation and every social route adult-gated.

- [ ] **Step 6: Run targeted tests green and commit**

```bash
cd server && node --test test/authMiddleware.test.js test/server.test.js
git add server/src/middlewares/authMiddleware.js server/src/routes/meRoutes.js server/src/routes/adminRoutes.js server/test/authMiddleware.test.js server/test/server.test.js
git commit -m "fix: enforce live adult authorization"
```

## Task 3: Integrate privacy-minimized Yoti assurance

**Files:**
- Add: `server/src/services/yotiAgeService.js`
- Add: `server/src/controllers/ageVerificationController.js`
- Modify: `server/src/models/User.js`
- Modify: `server/src/routes/meRoutes.js`
- Modify: `server/src/controllers/authController.js`
- Test: `server/test/yotiAgeService.test.js`
- Test: `server/test/ageVerification.test.js`

- [ ] **Step 1: Write failing provider-service tests**

Mock `fetch` and assert:

- session creation sends `OVER`, 18+ Digital ID/document thresholds, conservative estimation, opaque `reference_id`, retries, consent-compatible defaults, and secret headers only server-side;
- the returned URL contains encoded session/sdk ids;
- result parsing accepts only `COMPLETE`, matching reference, and a passing 18+ selected method;
- pending, mismatch, rejected, malformed, timeout, and non-2xx results never verify.

- [ ] **Step 2: Write failing controller tests**

Under-18/self-attested-missing users cannot start verification. An adult declaration can start; only its stored session can complete; provider errors preserve pending state; success stores provider/session/evidence/method/threshold/timestamps but no age, selfie, biometric, document, or provider payload.

- [ ] **Step 3: Run tests red**

```bash
cd server && node --test test/yotiAgeService.test.js test/ageVerification.test.js
```

- [ ] **Step 4: Implement Yoti with native fetch**

Use `https://age.yoti.com/api/v1/sessions`, `Authorization: Bearer`, and `Yoti-SDK-Id`. Keep configuration access inside the service. A missing production configuration returns `AGE_VERIFICATION_UNAVAILABLE`; it never marks a user verified and never falls back to DOB.

- [ ] **Step 5: Add minimal receipt metadata**

Add one `ageVerification` subdocument with status, provider, session id, evidence id, method, threshold, policy version, requested/verified timestamps. Keep `birthDate` private and `ageVerified` false until a reconciled provider result passes.

- [ ] **Step 6: Add endpoints**

- `POST /api/me/age/verification-session`
- `GET /api/me/age/verification-status`

The status endpoint fetches the user's stored pending result server-to-server and returns only `{ status, ageVerified, reason? }`.

- [ ] **Step 7: Make DOB copy and responses adult-only**

Keep the set-once declaration. Return a stable adult-only denial for users below 18 and never describe sexual/adult content as an allowed mode.

- [ ] **Step 8: Run tests green and commit**

```bash
cd server && node --test test/yotiAgeService.test.js test/ageVerification.test.js
git add server/src/services/yotiAgeService.js server/src/controllers/ageVerificationController.js server/src/models/User.js server/src/routes/meRoutes.js server/src/controllers/authController.js server/test/yotiAgeService.test.js server/test/ageVerification.test.js
git commit -m "feat: add verified adult age assurance"
```

## Task 4: Close squad and matchmaking bypasses

**Files:**
- Modify: `server/src/controllers/squadController.js`
- Modify: `server/src/services/matchmakingService.js`
- Test: `server/test/squadPrivacy.test.js`
- Test: `server/test/matchmakingService.test.js`

- [ ] **Step 1: Add failing target and roster tests**

Prove an eligible leader cannot invite or approve an ineligible target. Starting search rejects any ineligible member, for every squad rather than only mature-tag squads.

- [ ] **Step 2: Add failing stale-queue tests**

Under the matchmaking lock, a stale seeker or candidate with any missing/ineligible member must be reset/dequeued and no Encounter may be created.

- [ ] **Step 3: Add failing mature-tag tests**

Squad creation/tag updates reject all tags classified `mature` or `blocked`; no sexual-tagged room is permitted merely because users are adults.

- [ ] **Step 4: Run targeted tests red**

```bash
cd server && node --test test/squadPrivacy.test.js test/matchmakingService.test.js test/ageVerification.test.js
```

- [ ] **Step 5: Reuse the shared bulk check**

Apply `hasAdultAccess` to invite/approval targets and `allUsersHaveAdultAccess` to search admission and both freshly loaded matcher rosters. Remove obsolete room-only age checks where the shared rule supersedes them.

- [ ] **Step 6: Reject explicit/mature tags**

Reuse the existing moderation classifier; do not add another word list or content system.

- [ ] **Step 7: Run tests green and commit**

```bash
cd server && node --test test/squadPrivacy.test.js test/matchmakingService.test.js test/ageVerification.test.js
git add server/src/controllers/squadController.js server/src/services/matchmakingService.js server/test/squadPrivacy.test.js server/test/matchmakingService.test.js server/test/ageVerification.test.js
git commit -m "fix: close squad age assurance bypasses"
```

## Task 5: Close realtime and media bypasses

**Files:**
- Modify: `server/src/services/socketService.js`
- Test: `server/test/socketAccess.test.js`
- Test: `server/test/server.test.js`

- [ ] **Step 1: Add failing socket tests**

Prove a valid token for a missing, minor, self-attested-only, or rejected user cannot establish a production socket. A verified adult can. A database error rejects the connection.

- [ ] **Step 2: Add Agora route tests**

Assert both lobby and encounter token routes still use `requireApiAuth`, and age/profile routes use only identity auth.

- [ ] **Step 3: Run targeted tests red**

```bash
cd server && node --test test/socketAccess.test.js test/server.test.js
```

- [ ] **Step 4: Reuse live access during async handshake**

After JWT identity validation, load the current user and call `hasAdultAccess` before presence, user-room, squad-room, or encounter-room access. Keep development tokenless behavior only outside production.

- [ ] **Step 5: Run tests green and commit**

```bash
cd server && node --test test/socketAccess.test.js test/server.test.js
git add server/src/services/socketService.js server/test/socketAccess.test.js server/test/server.test.js
git commit -m "fix: enforce adult access for realtime media"
```

## Task 6: Share truthful verification state with clients

**Files:**
- Modify: `packages/core/src/api.ts`
- Modify: `packages/core/src/session.ts`
- Test: `packages/core/test/session.test.cjs`

- [ ] **Step 1: Write failing shared-client tests**

Assert API wrappers exist for start/status, session exposes `ageVerified`, sync returns verified access rather than DOB completion, and no client can set `ageVerified` directly.

- [ ] **Step 2: Run core tests red**

```bash
pnpm --filter @giggle/core test
```

- [ ] **Step 3: Add minimal API and session methods**

Add `startAgeVerification()`, `getAgeVerificationStatus()`, `session.hasAdultAccess`, and `session.syncAgeFromServer()` returning the verified state. Keep DOB submission as stage one.

- [ ] **Step 4: Run core tests green and commit**

```bash
pnpm --filter @giggle/core test
git add packages/core/src/api.ts packages/core/src/session.ts packages/core/test/session.test.cjs
git commit -m "feat: share age assurance state"
```

## Task 7: Turn the web gate into a two-step verification flow

**Files:**
- Modify: `apps/desktop/components/AgeGate.tsx`
- Modify: `apps/desktop/app/(app)/layout.tsx`
- Test: `apps/desktop/test/next-config.test.js`
- Test: `apps/desktop/e2e/signin.spec.ts`

- [ ] **Step 1: Add failing source and browser checks**

Verify the app remains blocked until `ageVerified`, an under-18 declaration shows adult-only denial, an adult can launch the hosted provider, pending/error/retry states are visible, and the realtime socket is not opened before access.

- [ ] **Step 2: Read the versioned Next 16 docs for any changed API**

Use existing browser APIs and component conventions where possible; do not add a redirect handler or dependency unless the current APIs cannot cover it.

- [ ] **Step 3: Run checks red**

```bash
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/desktop test:e2e -- e2e/signin.spec.ts --project=desktop
```

- [ ] **Step 4: Extend the existing gate in place**

After an adult DOB, start the hosted session on explicit user action, navigate to Yoti, and reconcile status when the app returns/focuses. Under 18 gets sign-out/help, not a retryable DOB picker. Copy says Giggle is for verified adults, not that it contains adult content.

- [ ] **Step 5: Delay realtime presence**

Only call `connectSocket()` after authentication and verified adult access are both true.

- [ ] **Step 6: Run checks green and commit**

```bash
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/desktop test:e2e -- e2e/signin.spec.ts --project=desktop
git add apps/desktop/components/AgeGate.tsx 'apps/desktop/app/(app)/layout.tsx' apps/desktop/test/next-config.test.js apps/desktop/e2e/signin.spec.ts
git commit -m "feat: require adult verification on web"
```

## Task 8: Apply the same gate to Expo/native

**Files:**
- Modify: `apps/mobile/components/AgeGate.tsx`
- Modify: `apps/mobile/app/_layout.tsx`
- Test: `apps/mobile/test/age-gate.test.cjs`

- [ ] **Step 1: Read Expo 56 Linking/AppState documentation**

Use the installed Expo/React Native APIs; do not add a WebView or browser dependency when `Linking.openURL` plus status polling/focus reconciliation is enough.

- [ ] **Step 2: Write failing native source checks**

Assert the same adult-only states and that sockets remain disconnected while unverified.

- [ ] **Step 3: Run mobile checks red**

```bash
pnpm --filter @giggle/mobile test
pnpm --filter @giggle/mobile check
```

- [ ] **Step 4: Extend the existing native gate**

Open the provider URL externally, reconcile on `AppState` active, show pending/retry/unavailable/under-18 states, and call `onDone` only after the server returns verified.

- [ ] **Step 5: Run mobile checks green and commit**

```bash
pnpm --filter @giggle/mobile test
pnpm --filter @giggle/mobile check
git add apps/mobile/components/AgeGate.tsx apps/mobile/app/_layout.tsx apps/mobile/test/age-gate.test.cjs
git commit -m "feat: require adult verification on native"
```

## Task 9: Full verification and integration review

**Files:** all changed files

- [ ] **Step 1: Run focused security paths**

```bash
cd server && node --test test/ageAccessService.test.js test/authMiddleware.test.js test/yotiAgeService.test.js test/ageVerification.test.js test/squadPrivacy.test.js test/matchmakingService.test.js test/socketAccess.test.js
```

- [ ] **Step 2: Run all package checks**

```bash
cd server && npm test
pnpm --filter @giggle/core test
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
pnpm --filter @giggle/mobile check
pnpm build:desktop
```

- [ ] **Step 3: Run relevant Playwright paths**

```bash
pnpm --filter @giggle/desktop test:e2e -- e2e/signin.spec.ts e2e/lobby.spec.ts e2e/matchmaking.spec.ts e2e/encounter.spec.ts
```

- [ ] **Step 4: Review the diff against the design**

Confirm there is one shared decision, no JWT authorization, no raw provider evidence, no production bypass, no minor/mixed path, and no mature-room exception.

- [ ] **Step 5: Document external release prerequisites**

List Yoti production credentials/configuration, provider contract/DPA, privacy/terms/community-safety copy, named safety contact and moderation SLA, Apple/Google declarations, and counsel approval as deployment gates. Do not call these code-complete items “globally certified.”

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: enforce verified adult access"
```
