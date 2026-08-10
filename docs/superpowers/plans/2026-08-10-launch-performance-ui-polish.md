# Giggle Launch Performance and UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Giggle's core web and native social-video journey feel immediate, coherent, theme-aware, and launch-ready.

**Architecture:** Keep the current API, Socket.IO, Agora, adaptive layout, and theme-token boundaries. Shorten only measured critical paths, expose instant local feedback, and polish one existing route at a time without adding dependencies or a parallel design system.

**Tech Stack:** React 19, Next.js 16, Expo 56, TypeScript, Node/Express, MongoDB, Redis, Socket.IO, Agora, Node test runner, Playwright.

---

### Task 1: Make Leave and End react immediately

**Files:**
- Modify: `apps/desktop/app/(app)/lobby/page.tsx`
- Modify: `apps/desktop/app/(app)/encounter/page.tsx`
- Test: `apps/desktop/test/next-config.test.js`
- Test: `apps/desktop/e2e/lobby.spec.ts`
- Test: `apps/desktop/e2e/encounter.spec.ts`

- [ ] Add failing checks that Leave shows an immediate pending exit state and End begins local media cleanup before awaiting backend completion.
- [ ] Run the targeted desktop tests and confirm the new checks fail for the intended ordering.
- [ ] Make the smallest handler changes: preserve server-confirmed navigation and rollback, but start local UI/media exit work on click and run independent cleanup concurrently.
- [ ] Run targeted unit and E2E tests, including backend failure retry behavior.
- [ ] Commit only Task 1 files.

### Task 2: Shorten the durable encounter teardown

**Files:**
- Modify: `server/src/services/matchmakingService.js`
- Test: `server/test/matchmakingService.test.js`

- [ ] Add failing ordering tests proving independent guarded squad writes and member session cleanup do not serialize.
- [ ] Run the focused server test and verify the intended failure.
- [ ] Use `Promise.all` only for independent operations; keep authorization, eligibility, durable queue insertion, rollback, and errors awaited.
- [ ] Run the focused test, then all 301 server tests with safe local Redis/Agora test values.
- [ ] Commit only Task 2 files.

### Task 3: Polish Home and the phone Lobby

**Files:**
- Modify: `apps/desktop/app/(app)/home/page.tsx`
- Modify: `apps/desktop/app/(app)/lobby/page.tsx`
- Test: `apps/desktop/test/next-config.test.js`
- Test: `apps/desktop/e2e/lobby.spec.ts`

- [ ] Add failing source and phone-viewport checks for a token-native Home action and non-overlapping Lobby controls.
- [ ] Verify the checks fail against the fixed violet gradient and current phone toolbar.
- [ ] Replace the Home gradient with the active theme surface and give the phone match action a stable full-width row.
- [ ] Verify leader/not-ready, leader/all-ready, member, media-off, and media-on states at phone and desktop sizes.
- [ ] Commit only Task 3 files.

### Task 4: Replace the radar takeover with theme-aware matchmaking

**Files:**
- Modify: `apps/desktop/app/(app)/matchmaking/page.tsx`
- Test: `apps/desktop/test/next-config.test.js`
- Test: `apps/desktop/e2e/matchmaking.spec.ts`

- [ ] Add failing checks that Matchmaking does not force dark mode, keeps squad members visible, and uses semantic tokens instead of fixed violet/lime gradients.
- [ ] Run the focused tests and verify the current forced-dark radar fails.
- [ ] Restyle the existing state machine in place: compact search signal, visible squad strip, stable Cancel, long-search copy, and reduced-motion equivalent.
- [ ] Verify Midnight, Cloud, and Tangerine at phone and desktop sizes.
- [ ] Commit only Task 4 files.

### Task 5: Replace the VS handoff with a social Room-ready transition

**Files:**
- Modify: `apps/desktop/app/(app)/match/page.tsx`
- Test: `apps/desktop/test/next-config.test.js`
- Test: `apps/desktop/e2e/encounter.spec.ts`

- [ ] Add failing checks for no visible `VS`, no forced dark mode, preserved roster/leader data, and theme-aware loading/error/handoff states.
- [ ] Verify the current competitive handoff fails those checks.
- [ ] Recompose the current route as a short `Room ready` transition using the same acknowledgement and countdown logic.
- [ ] Verify loading, recoverable error, acknowledgement, expiry, and reduced-motion behavior.
- [ ] Commit only Task 5 files.

### Task 6: Consolidate Encounter notices

**Files:**
- Modify: `apps/desktop/app/(app)/encounter/page.tsx`
- Test: `apps/desktop/test/next-config.test.js`
- Test: `apps/desktop/e2e/encounter.spec.ts`

- [ ] Add a failing viewport test that triggers reconnect, media, and confirmation notices together and asserts one transient slot plus persistent actionable errors.
- [ ] Verify the current stack fails.
- [ ] Reuse existing state and render one prioritized transient notice surface; do not hide safety, block, or device recovery actions.
- [ ] Verify phone, desktop, reduced motion, and all three themes.
- [ ] Commit only Task 6 files.

### Task 7: Apply native parity

**Files:**
- Modify: `apps/mobile/app/(app)/lobby.tsx`
- Modify: `apps/mobile/app/(app)/matchmaking.tsx`
- Modify: `apps/mobile/app/(app)/match.tsx`
- Modify: `apps/mobile/app/(app)/encounter.tsx`
- Test: `apps/mobile/test/encounter.test.cjs`

- [ ] Add failing source tests for immediate exit feedback, non-radar Matchmaking, no `VS`, theme tokens, and one recovery banner.
- [ ] Verify the tests fail only for missing parity.
- [ ] Apply the web hierarchy with native components; preserve safe-area, 44-point targets, media truth, and current routing.
- [ ] Run all mobile tests, typecheck, and Expo web export.
- [ ] Commit only Task 7 files.

### Task 8: Launch verification and production evidence

**Files:**
- Update: `apps/desktop/docs/GIGGLE-WEB-HANDOFF.md`
- Add visual artifacts under: `apps/desktop/artifacts/visual-audit/2026-08-10/`

- [ ] Run core, desktop, mobile, and server suites from a clean working tree.
- [ ] Run responsive Playwright journeys for Home, Lobby, Matchmaking, Match, and Encounter.
- [ ] Build desktop with the explicit production backend URL; run mobile typecheck and Expo export.
- [ ] Capture phone and desktop Midnight, Cloud, and Tangerine states without development chrome and inspect every image.
- [ ] Compare Railway endpoint timing before and after; report infrastructure connection failures separately.
- [ ] Run `git diff --check`, review the full diff, push the branch, update the draft PR or create a dedicated PR, and deploy only after all gates pass.
