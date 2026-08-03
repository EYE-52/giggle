# Launch Safety and Account Rights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the launch-blocking safety, privacy, moderation, blocking, account-rights, and discovery-control gaps around Giggle's verified-18+ web and native product.

**Architecture:** Extend the existing live adult-access decision instead of adding a second authorization system. Persist reports, blocks, and deletion state in MongoDB; reuse existing squad, matchmaking, Socket.IO, Redis, Agora, and moderation boundaries for enforcement. Keep legal/support content public and identity-only account rights available even when social access is suspended, while documenting vendor, store, operational, and legal work as release gates rather than code-complete claims.

**Tech stack:** Node.js/Express/Mongoose, Socket.IO/Redis/Redlock, React 19/Next.js 16, Expo 56/React Native, Yoti AVS, Agora, Node test runner, Playwright.

---

## Delivery boundary

This plan ships only behavior the current unified repository can enforce:

- one verified-18+ service; no teen/adult mixing and no 13-17 discovery mode;
- explicit admin DTOs rather than raw Mongoose documents;
- no local-only privacy controls that imply server enforcement;
- public Privacy, Terms, Safety, and Support pages plus working native links;
- effective suspension, shadow-ban, pending-deletion, report, block, chat-filter, export, and deletion behavior;
- a server-wide stranger-discovery kill switch and build-time web/iOS surface switches.

This plan does **not** claim worldwide certification. Trusted geolocation, jurisdiction rules, contracts, store declarations, staffing, law-enforcement escalation, and reviewed legal identity/addresses remain external release gates listed at the end.

## File map

### Server

- Modify `server/src/models/User.js`: remove duplicate `age`; add suspension, deletion, and blocked-user state.
- Add `server/src/models/SafetyReport.js`: minimal, indexed, idempotent report record.
- Modify `server/src/services/ageAccessService.js`: make moderation/deletion states part of the existing social-access decision.
- Add `server/src/services/interactionSafetyService.js`: one block-pair decision reused by friends, squads, matchmaking, rooms, chat, and video.
- Add `server/src/services/accountDeletionService.js`: staged, idempotent, Redlock-serialized cleanup; user deleted last.
- Modify `server/src/services/socketService.js`, `server/src/utils/socketAccess.js`: persist report acknowledgements, moderate chat, enforce blocks, disconnect revoked users.
- Modify `server/src/services/matchmakingService.js`, `server/src/controllers/squadController.js`, `server/src/controllers/friendsController.js`, `server/src/controllers/matchmakingController.js`, `server/src/controllers/agoraController.js`, and `server/src/controllers/encounterController.js`: enforce blocks and the discovery switch at shared interaction boundaries.
- Add `server/src/controllers/accountController.js`: explicit export and staged deletion handlers.
- Modify `server/src/controllers/adminController.js`: safe projections plus moderation actions/report queue.
- Modify `server/src/routes/meRoutes.js`, `server/src/routes/friendsRoutes.js`, `server/src/routes/adminRoutes.js`, `server/src/routes/squadRoutes.js`, and `server/src/server.js`: expose only the intended routes and start retry cleanup.
- Modify `server/src/config/appConfig.js`: global discovery switch.
- Modify focused `server/test/*.test.js` files; add `safetyReport.test.js`, `interactionSafety.test.js`, and `accountRights.test.js`.

### Shared clients

- Modify `packages/core/src/api.ts`: typed blocks, export, deletion, and report acknowledgements.
- Modify `packages/core/src/socket.ts`, `packages/core/src/report.ts`: await authoritative report acknowledgement.
- Modify `packages/core/test/api.test.cjs`, `packages/core/test/socket.test.cjs`.

### Web

- Modify `apps/desktop/app/privacy/page.tsx`, `apps/desktop/app/terms/page.tsx`, `apps/desktop/components/LegalPage.tsx`, and `apps/desktop/app/page.tsx`.
- Add `apps/desktop/app/safety/page.tsx` and `apps/desktop/app/support/page.tsx`.
- Modify `apps/desktop/app/(app)/profile/page.tsx`, `apps/desktop/app/(app)/friends/page.tsx`, `apps/desktop/app/(app)/encounter/page.tsx`, `apps/desktop/app/(app)/discover/page.tsx`, `apps/desktop/app/(app)/home/page.tsx`, and `apps/desktop/app/(app)/lobby/page.tsx`.
- Modify `apps/desktop/test/next-config.test.js` and relevant Playwright specs.

### Native

- Modify `apps/mobile/app/index.tsx`, `apps/mobile/components/AgeGate.tsx`, `apps/mobile/app/profile.tsx`, `apps/mobile/app/encounter.tsx`, `apps/mobile/app/home.tsx`, `apps/mobile/app/discover.tsx`, `apps/mobile/app/lobby.tsx`, and `apps/mobile/app/_layout.tsx`.
- Add `apps/mobile/constants/discovery.ts`.
- Modify `apps/mobile/test/onboarding.test.cjs`, `apps/mobile/test/encounter.test.cjs`, and `apps/mobile/test/accessibility.test.cjs`.

### Configuration and documentation

- Modify `.gitignore` so a sanitized `server/.env.example` is tracked.
- Add/replace `server/.env.example` with no credentials.
- Modify `README.md`, `DEPLOYMENT.md`, `server/README.md`, and `vercel.json` only where the runtime/deployment contract needs it.

---

## Task 1: Stop leaking admin documents and remove false privacy state

**Files:**
- Modify: `server/src/controllers/adminController.js`
- Modify: `server/src/models/User.js`
- Modify: `server/src/controllers/authController.js`
- Modify: `server/src/controllers/squadController.js`
- Modify: `packages/core/src/api.ts`
- Modify: `apps/desktop/app/(app)/profile/page.tsx`
- Test: `server/test/adminController.test.js`
- Test: `server/test/ageVerification.test.js`
- Test: `apps/desktop/test/next-config.test.js`

- [ ] **Step 1: Write failing admin-projection tests**

Add a fake pending user containing `birthDate`, friend arrays, referral fields, tokens, raw age-verification identifiers, and Mongoose metadata. Call both `getPendingUsersHandler` and `approveUserHandler` and assert the response has exactly this shape:

```js
{
  id: "507f1f77bcf86cd799439011",
  email: "member@example.com",
  name: "Member",
  image: null,
  isApproved: false,
  ageConfirmed: true,
  isAdult: true,
  ageVerified: false,
  verificationStatus: "pending",
  createdAt: "2026-08-04T00:00:00.000Z"
}
```

Assert that `birthDate`, `ageVerification`, `sessionId`, `referenceId`, `evidenceId`, `friends`, `blockedUserIds`, `referralCode`, `tokens`, and `__v` never serialize.

- [ ] **Step 2: Write failing privacy-surface tests**

In `ageVerification.test.js`, assert the User schema no longer has `age` and `normalizeProfilePatch({ age: 22 })` ignores/rejects it. In `next-config.test.js`, replace the old local-persistence assertion with:

```js
assert.equal(profileSource().includes('label="Open to Discovery"'), false);
assert.equal(profileSource().includes('label="Show Online Status"'), false);
assert.equal(profileSource().includes('const [age, setAge]'), false);
assert.equal(profileSource().includes('label="Notification pop-ups"'), true);
```

- [ ] **Step 3: Run the tests and verify red**

```bash
cd server && node --test test/adminController.test.js test/ageVerification.test.js
pnpm --filter @giggle/desktop test
```

Expected: FAIL because admin routes return raw users and the duplicate/profile-only fields still exist.

- [ ] **Step 4: Add one explicit admin serializer**

Add `toAdminUser(user)` in `adminController.js`, use it for list and approve responses, and select only the fields the serializer needs. Do not spread or return a Mongoose document.

- [ ] **Step 5: Delete duplicate age and fake controls**

Remove `User.age`, `age` from `getMyProfile`, `normalizeProfilePatch`, `updateMyProfile`, squad member demographics, core DTOs, and the web profile editor. Keep `birthDate` private and derived booleans authoritative. Keep the notification toggle because it controls real in-app notification toasts; delete only Discovery and Online controls because they currently change local storage without changing server behavior.

- [ ] **Step 6: Run green and commit**

```bash
cd server && node --test test/adminController.test.js test/ageVerification.test.js test/squadPrivacy.test.js
pnpm --filter @giggle/core test
pnpm --filter @giggle/desktop test
git add server/src/controllers/adminController.js server/src/models/User.js server/src/controllers/authController.js server/src/controllers/squadController.js packages/core/src/api.ts 'apps/desktop/app/(app)/profile/page.tsx' server/test/adminController.test.js server/test/ageVerification.test.js apps/desktop/test/next-config.test.js
git commit -m "fix: expose only truthful account data"
```

## Task 2: Publish truthful legal, safety, support, and age-help surfaces

**Files:**
- Modify: `apps/desktop/components/LegalPage.tsx`
- Modify: `apps/desktop/app/privacy/page.tsx`
- Modify: `apps/desktop/app/terms/page.tsx`
- Add: `apps/desktop/app/safety/page.tsx`
- Add: `apps/desktop/app/support/page.tsx`
- Modify: `apps/desktop/app/page.tsx`
- Modify: `apps/mobile/app/index.tsx`
- Modify: `apps/mobile/components/AgeGate.tsx`
- Modify: `apps/mobile/app/profile.tsx`
- Test: `apps/desktop/test/next-config.test.js`
- Test: `apps/mobile/test/onboarding.test.cjs`
- Test: `apps/mobile/test/accessibility.test.cjs`

- [ ] **Step 1: Add failing public-page and link tests**

Assert all four routes exist; the landing footer links Privacy, Terms, Safety, and Support; legal pages say verified `18+`; and none claim Giggle records calls, stores raw Yoti selfies/documents, accepts sexual content, or is globally certified. Assert support actions are `mailto:` links rather than a non-persistent form.

For native, assert `Linking.openURL` is used for separate Terms, Privacy, Safety, Support, and age-verification-help controls, each with `accessibilityRole="link"` and a 44-point touch target.

- [ ] **Step 2: Run tests and verify red**

```bash
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
```

Expected: FAIL because Safety/Support pages and actionable mobile links do not exist.

- [ ] **Step 3: Generalize the existing legal layout without a new design system**

Change `LegalPage` from one `otherLink` to `links: Array<{ href; label }>` and keep the existing responsive layout/theme. Use these exact factual sections:

- Privacy: account/profile data; private DOB and derived gates; minimized Yoti receipt only; squads/friends/messages; transient live chat and live Agora media not recorded by Giggle; persisted safety reports; service providers; retention/deletion; export/delete/contact rights.
- Terms: verified 18+ eligibility; account accuracy; prohibited harassment/hate/sexual or illegal content; no child sexual abuse material; squad/video consent; reporting/blocking; suspension; paid product/store terms; service availability; support contact.
- Safety: adult-only boundary; report and block; prohibited content/conduct; urgent danger instructions; child-safety escalation; appeals/contact.
- Support: working `mailto:support@gigglemeet.com` links with encoded subjects for account help, age-verification appeal, safety report, export, and deletion. Do not build a fake ticket form.

Mark the copy effective `2026-08-04` but keep legal review as a production gate.

- [ ] **Step 4: Add native links with the installed platform API**

Use React Native `Linking.openURL` for `https://gigglemeet.com/{privacy,terms,safety,support}` and the support mailto. Keep Yoti provider launching unchanged; add only a visible age-help link on blocked/pending/error states.

- [ ] **Step 5: Run green and commit**

```bash
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
pnpm --filter @giggle/mobile check
git add apps/desktop/components/LegalPage.tsx apps/desktop/app/privacy/page.tsx apps/desktop/app/terms/page.tsx apps/desktop/app/safety/page.tsx apps/desktop/app/support/page.tsx apps/desktop/app/page.tsx apps/mobile/app/index.tsx apps/mobile/components/AgeGate.tsx apps/mobile/app/profile.tsx apps/desktop/test/next-config.test.js apps/mobile/test/onboarding.test.cjs apps/mobile/test/accessibility.test.cjs
git commit -m "feat: publish safety and account help"
```

## Task 3: Make suspension, shadow-ban, and deletion states actually revoke access

**Files:**
- Modify: `server/src/models/User.js`
- Modify: `server/src/services/ageAccessService.js`
- Modify: `server/src/middlewares/authMiddleware.js`
- Modify: `server/src/services/socketService.js`
- Modify: `server/src/controllers/adminController.js`
- Modify: `server/src/routes/adminRoutes.js`
- Test: `server/test/ageAccessService.test.js`
- Test: `server/test/authMiddleware.test.js`
- Test: `server/test/socketAccess.test.js`
- Test: `server/test/adminController.test.js`

- [ ] **Step 1: Add failing social-access tests**

For an otherwise verified adult, assert `hasAdultAccess` returns false for each state:

```js
{ isSuspended: true }
{ isShadowBanned: true }
{ deletionStatus: "pending" }
```

Prove production HTTP and Socket.IO deny those users from live state, while `requireIdentityAuth` still permits profile read, export, delete, verification/help, and admin review. Expect `ACCOUNT_UNAVAILABLE` for moderation/deletion rather than exposing shadow-ban internals.

- [ ] **Step 2: Add failing admin-action tests**

Test one validated route:

```text
PATCH /api/admin/users/:userId/access
body: { suspended?: boolean, shadowBanned?: boolean }
```

Reject an empty body, unknown keys, non-booleans, and malformed ids. Return `toAdminUser`, never the raw document. Restoring access must not set `ageVerified`; it only clears moderation flags.

- [ ] **Step 3: Run red**

```bash
cd server && node --test test/ageAccessService.test.js test/authMiddleware.test.js test/socketAccess.test.js test/adminController.test.js
```

- [ ] **Step 4: Add minimal schema/state enforcement**

Add:

```js
isSuspended: { type: Boolean, default: false },
suspendedAt: { type: Date, default: null },
isShadowBanned: { type: Boolean, default: false }, // retain existing field
deletionStatus: { type: String, enum: ["active", "pending"], default: "active" },
deletionRequestedAt: { type: Date, default: null },
```

Extend the existing `hasAdultAccess`; do not create a parallel social-access middleware. Update the live Mongo projections in HTTP, sockets, and bulk roster checks. The admin action sets timestamps consistently and calls `disconnectUserSockets(userId)` when access changes from allowed to denied.

Extend Task 1's `toAdminUser` with only `isSuspended`, `isShadowBanned`, and `deletionStatus`; the serializer remains the sole admin User response shape.

- [ ] **Step 5: Run green and commit**

```bash
cd server && node --test test/ageAccessService.test.js test/authMiddleware.test.js test/socketAccess.test.js test/adminController.test.js
git add server/src/models/User.js server/src/services/ageAccessService.js server/src/middlewares/authMiddleware.js server/src/services/socketService.js server/src/controllers/adminController.js server/src/routes/adminRoutes.js server/test/ageAccessService.test.js server/test/authMiddleware.test.js server/test/socketAccess.test.js server/test/adminController.test.js
git commit -m "fix: revoke suspended account access"
```

## Task 4: Persist and acknowledge reports without automatic punishment

**Files:**
- Add: `server/src/models/SafetyReport.js`
- Modify: `server/src/services/socketService.js`
- Modify: `server/src/controllers/adminController.js`
- Modify: `server/src/routes/adminRoutes.js`
- Modify: `packages/core/src/report.ts`
- Modify: `packages/core/src/socket.ts`
- Modify: `apps/desktop/app/(app)/encounter/page.tsx`
- Modify: `apps/mobile/app/encounter.tsx`
- Add: `server/test/safetyReport.test.js`
- Modify: `server/test/socketAccess.test.js`
- Modify: `server/test/adminController.test.js`
- Modify: `packages/core/test/socket.test.cjs`
- Modify: `apps/desktop/test/next-config.test.js`
- Modify: `apps/mobile/test/encounter.test.cjs`

- [ ] **Step 1: Write failing report-record tests**

Define and test this minimal record:

```js
{
  reporterUserId: String,
  reporterSquadId: String,
  targetSquadId: String,
  targetUserIds: [String],
  encounterId: String,
  category: "harassment" | "hate" | "sexual" | "minor_safety" | "spam" | "other",
  details: String, // normalized, optional, max 500
  status: "open" | "reviewing" | "actioned" | "dismissed",
  reviewedBy: String,
  reviewedAt: Date,
  actionNote: String,
  createdAt: Date,
  updatedAt: Date
}
```

Add a unique index on `{ reporterUserId, encounterId, targetSquadId }` so retries return the same acknowledgement rather than duplicate reports. Prove the target ids come from the authoritative encounter/squad roster, never the client.

- [ ] **Step 2: Write failing no-auto-penalty and ack tests**

Assert `report_squad`:

- accepts a Socket.IO acknowledgement callback;
- returns `{ ok: true, reportId, status: "open" }` only after Mongo persistence;
- returns a stable error for invalid scope/write failure;
- does not mutate `Squad.reputationScore`, `User.reputationScore`, `reportCount`, `lastReportedAt`, or `isShadowBanned`.

Update core/client tests so the UI sets “Reported” only after the server acknowledgement, and a timeout/write failure remains retryable.

- [ ] **Step 3: Run red**

```bash
cd server && node --test test/safetyReport.test.js test/socketAccess.test.js test/adminController.test.js
pnpm --filter @giggle/core test
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
```

- [ ] **Step 4: Implement persistence and a safe review queue**

Use `SafetyReport.findOneAndUpdate(filter, { $setOnInsert: record }, { upsert: true, new: true })`. Replace the penalty loop entirely. Add admin routes:

```text
GET   /api/admin/reports?status=open&limit=50
PATCH /api/admin/reports/:reportId
body: { status, actionNote? }
```

Project only report fields plus safe names/emails needed to investigate; never populate or serialize raw User documents, DOB, Yoti identifiers, friend graphs, or tokens.

- [ ] **Step 5: Run green and commit**

```bash
cd server && node --test test/safetyReport.test.js test/socketAccess.test.js test/adminController.test.js
pnpm --filter @giggle/core test
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
git add server/src/models/SafetyReport.js server/src/services/socketService.js server/src/controllers/adminController.js server/src/routes/adminRoutes.js packages/core/src/report.ts packages/core/src/socket.ts 'apps/desktop/app/(app)/encounter/page.tsx' apps/mobile/app/encounter.tsx server/test/safetyReport.test.js server/test/socketAccess.test.js server/test/adminController.test.js packages/core/test/socket.test.cjs apps/desktop/test/next-config.test.js apps/mobile/test/encounter.test.cjs
git commit -m "feat: persist acknowledged safety reports"
```

## Task 5: Add real block and unblock state at the user boundary

**Files:**
- Modify: `server/src/models/User.js`
- Add: `server/src/services/interactionSafetyService.js`
- Modify: `server/src/controllers/friendsController.js`
- Modify: `server/src/routes/friendsRoutes.js`
- Modify: `server/src/models/Notification.js`
- Modify: `packages/core/src/api.ts`
- Modify: `apps/desktop/app/(app)/friends/page.tsx`
- Modify: `apps/desktop/app/(app)/profile/page.tsx`
- Modify: `apps/mobile/app/profile.tsx`
- Add: `server/test/interactionSafety.test.js`
- Modify: `packages/core/test/api.test.cjs`
- Modify: `apps/desktop/test/next-config.test.js`
- Modify: `apps/mobile/test/encounter.test.cjs`

- [ ] **Step 1: Write failing pair-decision tests**

Add `blockedUserIds: [{ type: String }]` and test these exports:

```js
hasBlockedPair(userA, userB)
loadBlockState(userIds, { User })
anyBlockedPair(userIds, { User })
filterBlockedCandidates(viewerId, candidateIds, { User })
```

Blocking is symmetric for enforcement: interaction is denied if either user lists the other. Missing users and database failures fail closed at interaction boundaries.

- [ ] **Step 2: Write failing endpoint tests**

Use these adult-gated routes:

```text
POST   /api/users/block          body: { userIds: [ObjectId] } (1-8 unique targets)
DELETE /api/users/:userId/block
GET    /api/me/blocks
```

Reject self, malformed ids, missing targets, more than eight, and empty arrays. Blocking must atomically add ids to the caller, remove both sides' friendship and pending-request references, and delete notifications between the two sides. Repeating block/unblock is idempotent. List responses expose only `{ userId, name, image }`.

- [ ] **Step 3: Run red**

```bash
cd server && node --test test/interactionSafety.test.js
pnpm --filter @giggle/core test
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
```

- [ ] **Step 4: Implement the smallest reusable service and endpoints**

Use Mongo projections `_id blockedUserIds` and `$addToSet`/`$pull`/`$in`; add no graph library. Friend list, requests, search, send, and accept must filter/reject both directions through the shared service.

Add a confirmed “Block” action beside desktop friend/search/request rows and a Blocked accounts list with Unblock on desktop and native profiles. Do not silently combine Remove Friend with Block.

- [ ] **Step 5: Run green and commit**

```bash
cd server && node --test test/interactionSafety.test.js
pnpm --filter @giggle/core test
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
git add server/src/models/User.js server/src/services/interactionSafetyService.js server/src/controllers/friendsController.js server/src/routes/friendsRoutes.js server/src/models/Notification.js packages/core/src/api.ts 'apps/desktop/app/(app)/friends/page.tsx' 'apps/desktop/app/(app)/profile/page.tsx' apps/mobile/app/profile.tsx server/test/interactionSafety.test.js packages/core/test/api.test.cjs apps/desktop/test/next-config.test.js apps/mobile/test/encounter.test.cjs
git commit -m "feat: add user block controls"
```

## Task 6: Enforce blocks across squads, discovery, and matchmaking

**Files:**
- Modify: `server/src/controllers/squadController.js`
- Modify: `server/src/app/squadAccess.js`
- Modify: `server/src/services/sessionService.js`
- Modify: `server/src/services/socketService.js`
- Modify: `server/src/services/matchmakingService.js`
- Modify: `server/src/controllers/matchmakingController.js`
- Test: `server/test/squadPrivacy.test.js`
- Test: `server/test/matchmakingService.test.js`
- Test: `server/test/matchmakingController.test.js`
- Test: `server/test/interactionSafety.test.js`

- [ ] **Step 1: Add failing squad-boundary tests**

Prove a blocked pair cannot:

- see each other in people search/open-squad discovery;
- join the same squad by id/code/random;
- invite, request, or approve each other;
- start search while a legacy shared squad still contains a blocked pair.

Public discovery must exclude a squad when either the viewer blocks a member or any member blocks the viewer.

When a new block intersects an existing same-squad membership, remove the blocker (not the blocked target) from every shared squad using the existing leave/persist lifecycle: reset/dequeue searches, promote the first remaining member when needed, clear the removed member's Redis session fields, revoke their squad/encounter rooms, and end/requeue the opponent only if that squad becomes empty. This prevents `GET /squads/:id` from continuing to expose a blocked person through legacy membership.

- [ ] **Step 2: Add failing locked-match tests**

Inside the existing matchmaking lock, combine both freshly loaded rosters and assert `anyBlockedPair` before encounter creation. A blocked seeker/candidate is reset/dequeued exactly like other stale ineligible squads. `getEncounterHandoffHandler` must deny a legacy encounter containing a blocked cross-squad pair rather than returning opponent identity data.

- [ ] **Step 3: Run red**

```bash
cd server && node --test test/squadPrivacy.test.js test/matchmakingService.test.js test/matchmakingController.test.js test/interactionSafety.test.js
```

- [ ] **Step 4: Reuse the shared decision at entry and final-commit points**

Do not add per-controller block arrays. Load live state through `interactionSafetyService`; enforce at target admission, roster admission, public projection filtering, shared-membership cleanup, and final locked matchmaking. Preserve all existing membership/leader/capacity checks.

- [ ] **Step 5: Run green and commit**

```bash
cd server && node --test test/squadPrivacy.test.js test/matchmakingService.test.js test/matchmakingController.test.js test/interactionSafety.test.js
git add server/src/controllers/squadController.js server/src/app/squadAccess.js server/src/services/sessionService.js server/src/services/socketService.js server/src/services/matchmakingService.js server/src/controllers/matchmakingController.js server/test/squadPrivacy.test.js server/test/matchmakingService.test.js server/test/matchmakingController.test.js server/test/interactionSafety.test.js
git commit -m "fix: enforce blocks in matching"
```

## Task 7: Enforce blocks and content filtering in rooms, chat, reactions, and Agora

**Files:**
- Modify: `server/src/utils/socketAccess.js`
- Modify: `server/src/services/socketService.js`
- Modify: `server/src/controllers/agoraController.js`
- Modify: `server/src/controllers/encounterController.js`
- Modify: `apps/desktop/app/(app)/encounter/page.tsx`
- Modify: `apps/mobile/app/encounter.tsx`
- Test: `server/test/socketAccess.test.js`
- Test: `server/test/server.test.js`
- Test: `apps/desktop/test/next-config.test.js`
- Test: `apps/mobile/test/encounter.test.cjs`

- [ ] **Step 1: Add failing live-boundary tests**

Assert blocked pairs cannot join a shared squad/encounter room, send chat/reactions into it, fetch encounter details, or receive lobby/encounter Agora tokens. Re-authorize each send against current Mongo membership/block state; `socket.rooms.has(room)` alone is insufficient after a block or removal.

Test `disconnectUserSockets(userId)` calls `io.in('user_<id>').disconnectSockets(true)` so block/admin/deletion changes immediately clear rooms and presence through the existing disconnect cleanup.

- [ ] **Step 2: Add failing chat-moderation tests**

Use existing `normalizeChatText` and `classifyVibe`; reject `mature` and `blocked` verdicts with `{ ok: false, error: "That message is not allowed." }`. Prove the rejected text is neither emitted nor cached as an idempotent success. Keep the existing 500-character and rate limits.

- [ ] **Step 3: Add failing user-facing block-flow tests**

In each encounter More menu, add an explicit confirmed “Block opponent squad” action that sends the current opponent member ids (maximum eight), then disconnects/leaves the encounter. The label must state that every visible opponent member will be blocked; reporting remains a separate action.

- [ ] **Step 4: Run red**

```bash
cd server && node --test test/socketAccess.test.js test/server.test.js test/interactionSafety.test.js
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
```

- [ ] **Step 5: Make message/reaction handlers async and authorize before broadcast**

Pass `User` into the existing socket authorization helpers, load both encounter squads for encounter rooms, and deny on any live blocked pair. After a successful bulk block, disconnect the blocker sockets so automatic room rejoin is re-evaluated. Do not record chat or inspect media in this task.

- [ ] **Step 6: Run green and commit**

```bash
cd server && node --test test/socketAccess.test.js test/server.test.js test/interactionSafety.test.js
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
git add server/src/utils/socketAccess.js server/src/services/socketService.js server/src/controllers/agoraController.js server/src/controllers/encounterController.js 'apps/desktop/app/(app)/encounter/page.tsx' apps/mobile/app/encounter.tsx server/test/socketAccess.test.js server/test/server.test.js apps/desktop/test/next-config.test.js apps/mobile/test/encounter.test.cjs
git commit -m "fix: protect realtime interaction boundaries"
```

## Task 8: Add an identity-only, explicit data export

**Files:**
- Add: `server/src/controllers/accountController.js`
- Modify: `server/src/routes/meRoutes.js`
- Modify: `packages/core/src/api.ts`
- Modify: `apps/desktop/app/(app)/profile/page.tsx`
- Modify: `apps/mobile/app/profile.tsx`
- Add: `server/test/accountRights.test.js`
- Modify: `server/test/server.test.js`
- Modify: `packages/core/test/api.test.cjs`
- Modify: `apps/desktop/test/next-config.test.js`
- Modify: `apps/mobile/test/encounter.test.cjs`

- [ ] **Step 1: Write a failing explicit-DTO test**

Test identity-only `GET /api/me/export`. Seed the User, relevant squads, notifications, blocks, and safety reports with extra private/internal fields. Assert the response uses an explicit object with these top-level keys only:

```js
[
  "generatedAt",
  "account",
  "ageAssurance",
  "profile",
  "friends",
  "blocks",
  "squads",
  "notifications",
  "safetyReports",
  "walletAndReferral"
]
```

The user's own declared DOB may be included as `YYYY-MM-DD`; raw Yoti session/reference/evidence ids, provider payloads, other users' emails/demographics, JWTs, internal moderation notes, Mongo `__v`, and secrets must not be included.

- [ ] **Step 2: Add failing route/client tests**

Assert export uses `requireIdentityAuth`, so suspended/pending-deletion identities retain the right while the User record exists. Core returns a typed `AccountExport`. Desktop downloads a JSON Blob named `giggle-data-YYYY-MM-DD.json`; native uses React Native's installed `Share.share` with the JSON text and handles cancellation/errors visibly.

- [ ] **Step 3: Run red**

```bash
cd server && node --test test/accountRights.test.js test/server.test.js
pnpm --filter @giggle/core test
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
```

- [ ] **Step 4: Implement explicit mapping only**

Query each collection with narrow projections and map each returned record field-by-field. Do not use `res.json(user)`, `toObject()` spreading, or a generic serializer. Cap notification/report export reads only if the API also returns a clear `truncated` flag; otherwise return the complete subject dataset.

- [ ] **Step 5: Run green and commit**

```bash
cd server && node --test test/accountRights.test.js test/server.test.js
pnpm --filter @giggle/core test
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
git add server/src/controllers/accountController.js server/src/routes/meRoutes.js packages/core/src/api.ts 'apps/desktop/app/(app)/profile/page.tsx' apps/mobile/app/profile.tsx server/test/accountRights.test.js server/test/server.test.js packages/core/test/api.test.cjs apps/desktop/test/next-config.test.js apps/mobile/test/encounter.test.cjs
git commit -m "feat: add private account export"
```

## Task 9: Stage account deletion and revoke access before cleanup

**Files:**
- Modify: `server/src/controllers/accountController.js`
- Modify: `server/src/routes/meRoutes.js`
- Modify: `server/src/models/User.js`
- Add: `server/src/services/accountDeletionService.js`
- Modify: `server/src/app/squadAccess.js`
- Modify: `server/src/services/sessionService.js`
- Modify: `server/src/services/socketService.js`
- Modify: `server/src/server.js`
- Modify: `packages/core/src/api.ts`
- Modify: `apps/desktop/app/(app)/profile/page.tsx`
- Modify: `apps/mobile/app/profile.tsx`
- Modify: `server/test/accountRights.test.js`
- Modify: `server/test/sessionService.test.js`
- Modify: `server/test/squadPrivacy.test.js`
- Modify: `server/test/server.test.js`
- Modify: `packages/core/test/api.test.cjs`

- [ ] **Step 1: Write failing stage-first tests**

Test identity-only `DELETE /api/me/account`. The first database mutation must atomically set:

```js
{
  deletionStatus: "pending",
  deletionRequestedAt: now,
  ageVerified: false
}
```

before any graph cleanup. From that point, `hasAdultAccess` is false, HTTP/social sockets fail closed, and all user sockets are disconnected. Repeating the request remains safe.

- [ ] **Step 2: Write failing idempotent cleanup tests**

Under a per-user existing Redlock key `lock:account-delete:<userId>`, prove the service can resume after a failure at every stage and eventually performs all of these operations:

1. Remove the id from every User `friends`, incoming/outgoing request, and `blockedUserIds` array.
2. Remove `referredBy` links pointing to the id; then recompute the deleted account's referrer's `referralCount` from remaining referrals so retries cannot double-decrement it. Do not claw back token history.
3. Remove the id from every Squad `invitedUserIds`, `joinRequests`, and `members`.
4. For each membership: dequeue/reset a searching squad; promote the first remaining member when the deleted user led; delete empty squads; end/requeue an active opponent only when the deleted user's squad becomes empty.
5. Delete that member's Redis ready/video fields; clear an empty squad session; remove queue metadata.
6. Disconnect sockets so the existing disconnect path removes presence keys and rooms.
7. Delete notifications where the id is either `userId` or `fromUserId`.
8. Remove/pseudonymize the id in SafetyReport reporter/target fields while retaining the safety event and admin action trail.
9. Delete the User document **last**.

On any failure, leave the User in `pending` and return `{ status: "pending" }`; never restore social access and never delete the User early.

- [ ] **Step 3: Add failing retry-worker tests**

Test `sweepPendingAccountDeletions({ limit: 25 })` selects only pending users, calls the same cleanup function, tolerates one account failure, continues to the next, and uses an `unref()` interval started once from `startServer` after Mongo connects.

- [ ] **Step 4: Run red**

```bash
cd server && node --test test/accountRights.test.js test/sessionService.test.js test/squadPrivacy.test.js test/server.test.js
```

- [ ] **Step 5: Implement the staged service without a cross-store transaction**

Use idempotent Mongo `$pull`/`$unset`/`deleteMany`, existing squad lifecycle helpers, queue/session helpers, Socket.IO disconnect, and the already-installed Redlock. The deliberate ceiling is eventual cleanup across Mongo/Redis; document it with:

```js
// ponytail: Mongo and Redis cannot share a transaction; pending + idempotent
// retries are the recovery boundary. Add an external job queue only at scale.
```

Return `200 { status: "deleted" }` when cleanup completes synchronously and `202 { status: "pending" }` when it will retry.

- [ ] **Step 6: Add confirmed web/native deletion UI**

Require a two-step confirmation that says deletion revokes access immediately and may finish in the background. On `deleted` or `pending`, clear the local session and return to sign-in. A failed staging request must keep the user signed in and show a retryable error.

- [ ] **Step 7: Run green and commit**

```bash
cd server && node --test test/accountRights.test.js test/sessionService.test.js test/squadPrivacy.test.js test/server.test.js
pnpm --filter @giggle/core test
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
git add server/src/controllers/accountController.js server/src/routes/meRoutes.js server/src/models/User.js server/src/services/accountDeletionService.js server/src/app/squadAccess.js server/src/services/sessionService.js server/src/services/socketService.js server/src/server.js packages/core/src/api.ts 'apps/desktop/app/(app)/profile/page.tsx' apps/mobile/app/profile.tsx server/test/accountRights.test.js server/test/sessionService.test.js server/test/squadPrivacy.test.js server/test/server.test.js packages/core/test/api.test.cjs
git commit -m "feat: add retryable account deletion"
```

## Task 10: Add enforceable global and platform discovery kill switches

**Files:**
- Modify: `server/src/config/appConfig.js`
- Modify: `server/src/controllers/squadController.js`
- Modify: `server/src/services/matchmakingService.js`
- Add: `server/test/discoveryKillSwitch.test.js`
- Add: `apps/mobile/constants/discovery.ts`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/app/home.tsx`
- Modify: `apps/mobile/app/discover.tsx`
- Modify: `apps/mobile/app/lobby.tsx`
- Modify: `apps/mobile/app/encounter.tsx`
- Modify: `apps/desktop/app/(app)/discover/page.tsx`
- Modify: `apps/desktop/app/(app)/home/page.tsx`
- Modify: `apps/desktop/app/(app)/lobby/page.tsx`
- Test: `apps/mobile/test/encounter.test.cjs`
- Test: `apps/desktop/test/next-config.test.js`

- [ ] **Step 1: Write failing global-switch tests**

With `STRANGER_DISCOVERY_ENABLED=false`, assert:

- `GET /api/squads/discover` returns `503 DISCOVERY_DISABLED`;
- `POST /api/squads/join-random` returns the same;
- starting search refuses before queue mutation;
- `tryMatchmakeForSquad` dequeues/resets a stale searching squad;
- encounter requeue ends at idle instead of re-entering the queue.

Direct invite/code-based squads continue to work; this is a stranger-discovery switch, not a full outage switch.

- [ ] **Step 2: Write failing platform-surface tests**

Define pure helpers:

```ts
isWebDiscoveryEnabled = NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED !== "false"
isNativeDiscoveryEnabled =
  EXPO_PUBLIC_STRANGER_DISCOVERY_ENABLED !== "false" &&
  (Platform.OS !== "ios" || EXPO_PUBLIC_IOS_DISCOVERY_ENABLED !== "false")
```

Assert disabled builds hide/disable Discover, random join, start/next encounter, and matchmaking routes while preserving private squad creation, code join, profile, support, export, and delete.

- [ ] **Step 3: Run red**

```bash
cd server && node --test test/discoveryKillSwitch.test.js test/matchmakingService.test.js test/squadPrivacy.test.js
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
```

- [ ] **Step 4: Enforce the server switch and label client flags honestly**

Read the server env at request/match time through `isStrangerDiscoveryEnabled(env = process.env)` so tests and emergency changes are deterministic after a process restart. Client flags are store/build surface controls, **not** legal/security authorization: users can spoof a platform and call APIs, so only the global server flag is authoritative.

Do not add IP-to-country inference, accept a client country header, or use the profile `country` field for legal gating.

- [ ] **Step 5: Run green and commit**

```bash
cd server && node --test test/discoveryKillSwitch.test.js test/matchmakingService.test.js test/squadPrivacy.test.js
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
pnpm --filter @giggle/mobile check
git add server/src/config/appConfig.js server/src/controllers/squadController.js server/src/services/matchmakingService.js server/test/discoveryKillSwitch.test.js apps/mobile/constants/discovery.ts apps/mobile/app/_layout.tsx apps/mobile/app/home.tsx apps/mobile/app/discover.tsx apps/mobile/app/lobby.tsx apps/mobile/app/encounter.tsx 'apps/desktop/app/(app)/discover/page.tsx' 'apps/desktop/app/(app)/home/page.tsx' 'apps/desktop/app/(app)/lobby/page.tsx' apps/mobile/test/encounter.test.cjs apps/desktop/test/next-config.test.js
git commit -m "feat: add discovery kill switches"
```

## Task 11: Correct Yoti and unified-repository deployment documentation

**Files:**
- Modify: `.gitignore`
- Add: `server/.env.example`
- Modify: `README.md`
- Modify: `server/README.md`
- Modify: `DEPLOYMENT.md`
- Modify: `vercel.json`
- Test: `server/test/server.test.js`
- Test: `apps/desktop/test/next-config.test.js`
- Test: `apps/mobile/test/onboarding.test.cjs`

- [ ] **Step 1: Add failing documentation-contract tests**

Assert the tracked env example and deployment docs contain:

```text
YOTI_AGE_API_KEY
YOTI_AGE_SDK_ID
AGE_VERIFICATION_CALLBACK_URL
STRANGER_DISCOVERY_ENABLED
NEXT_PUBLIC_STRANGER_DISCOVERY_ENABLED
EXPO_PUBLIC_STRANGER_DISCOVERY_ENABLED
EXPO_PUBLIC_IOS_DISCOVERY_ENABLED
ADMIN_EMAIL
```

Assert no document says to run from sibling `giggle-app`, `giggle-server`, or legacy `giggle-web` repositories; the only canonical source is this monorepo, with web in `apps/desktop`, native in `apps/mobile`, and API in `server`.

- [ ] **Step 2: Verify red**

```bash
cd server && node --test test/server.test.js
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
```

- [ ] **Step 3: Track a sanitized env example safely**

Add `!server/.env.example` after the broad `.env.*` ignore rule. Replace the worktree-only symlink with a regular tracked file containing placeholders/comments only; never copy values from `server/.env` and never print them. Document that missing Yoti configuration leaves identity/support/export/delete available but fails all social access closed.

- [ ] **Step 4: Rewrite deployment order for the unified repository**

Document this order:

1. Provision Mongo, Redis, Agora, Yoti, auth providers, monitored support/safety mailboxes, and high-entropy secrets.
2. Deploy `server/` to Railway from this repository and verify `/health`, verification-session/status, report persistence, block enforcement, export, and deletion staging.
3. Set Vercel public env and deploy the repository root using the checked-in `vercel.json` (`apps/desktop` build/output).
4. Set Expo/EAS public backend/discovery vars and build native after server verification.
5. Run smoke tests with two verified accounts before enabling `STRANGER_DISCOVERY_ENABLED=true`.

Remove stale Render/split-repository instructions from primary docs. Do not place Yoti secrets in `vercel.json`, `app.json`, `NEXT_PUBLIC_*`, or `EXPO_PUBLIC_*`.

- [ ] **Step 5: Run green and commit**

```bash
git ls-files --error-unmatch server/.env.example
cd server && node --test test/server.test.js
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
git add .gitignore server/.env.example README.md server/README.md DEPLOYMENT.md vercel.json server/test/server.test.js apps/desktop/test/next-config.test.js apps/mobile/test/onboarding.test.cjs
git commit -m "docs: document verified adult deployment"
```

## Task 12: Run the complete safety and release verification

**Files:** all files changed by Tasks 1-11

- [ ] **Step 1: Run focused server security paths**

```bash
cd server && node --test \
  test/ageAccessService.test.js \
  test/authMiddleware.test.js \
  test/ageVerification.test.js \
  test/yotiAgeService.test.js \
  test/adminController.test.js \
  test/safetyReport.test.js \
  test/interactionSafety.test.js \
  test/accountRights.test.js \
  test/discoveryKillSwitch.test.js \
  test/squadPrivacy.test.js \
  test/matchmakingService.test.js \
  test/matchmakingController.test.js \
  test/socketAccess.test.js \
  test/sessionService.test.js \
  test/server.test.js
```

Expected: all PASS with no live vendor calls.

- [ ] **Step 2: Run every package check**

```bash
cd server && npm test
pnpm --filter @giggle/core test
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/mobile test
pnpm --filter @giggle/mobile check
NEXT_PUBLIC_BACKEND_URL=https://giggle-server-production.up.railway.app pnpm build:desktop
pnpm audit:prod
```

- [ ] **Step 3: Run browser journeys**

```bash
pnpm --filter @giggle/desktop test:e2e -- \
  e2e/signin.spec.ts \
  e2e/product-routes.spec.ts \
  e2e/lobby.spec.ts \
  e2e/matchmaking.spec.ts \
  e2e/encounter.spec.ts
```

Add/retain checks for: legal links at phone/desktop sizes; verified gate; acknowledged report success/failure; block then no rematch/rejoin; chat rejection; export download; staged deletion; and disabled-discovery state.

- [ ] **Step 4: Review the diff against launch invariants**

```bash
git diff --check
git status --short
git diff --stat main...HEAD
```

Confirm:

- no raw User/SafetyReport/provider payload serialization;
- no DOB/JWT/client/platform header used as social authorization;
- no automatic report-based punishment;
- no block bypass through friends, squads, matching, rooms, chat, reactions, encounter DTOs, or Agora;
- no account deletion before all retryable cleanup stages;
- no fake privacy/support controls;
- no secret committed or placed in public client configuration;
- no “global compliance/certification” claim.

- [ ] **Step 5: Commit any verification-only fixes**

```bash
git add -A
git commit -m "test: verify launch safety boundaries"
```

Skip this commit when verification requires no file changes.

---

## External release blockers (not solvable by repository code)

Do not enable production stranger discovery or submit stores until all are evidenced:

- Yoti production tenant, API key/SDK id/callback, contract/DPA, biometric-consent configuration, failure/appeal runbook, and test-account evidence.
- Named legal entity, address, controller/contact details, reviewed Privacy/Terms/Safety text, retention schedule, lawful-basis/consumer-rights review, and counsel sign-off for launch countries.
- Monitored `support@`/safety contact inbox, ownership, response SLA, age-appeal process, report triage staffing, moderator access controls/audit trail, emergency escalation, and required child-safety/law-enforcement reporting process.
- Apple age rating/review notes and random-chat risk decision; Google Play Child Safety Standards self-certification, published standards/contact, and the 2026-08-26 minor-restriction requirement; Expo/EAS store metadata and privacy manifests reviewed.
- Verified backups/retention/deletion behavior across MongoDB Atlas, Redis, Railway logs, Agora, Yoti, email/auth providers, analytics, and support systems; repository cleanup cannot delete copies held by vendors automatically.
- A trusted edge/provider location signal plus counsel-maintained jurisdiction matrix before any country-specific availability or consent claim. Profile country, IP parsing in this app, and client headers are not trustworthy legal gates.
- Production credentials and deployment access. Tests use mocks; they cannot prove the live vendor/store setup.

Until those blockers clear, keep `STRANGER_DISCOVERY_ENABLED=false` in production and describe the result as code-ready, not globally compliant.
