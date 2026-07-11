# Home Zero-State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the empty signed-in Home dashboard with one focused first-run workspace while preserving the populated dashboard.

**Architecture:** Keep `HomePage` and all existing handlers in `app/(app)/home/page.tsx`. Add one explicit render branch after data loading so zero-squad users receive a dedicated composition and populated users continue through the existing dashboard.

**Tech Stack:** Next.js 16, React 19, TypeScript, inline responsive styles through the existing `useViewport` helper, Node test runner, Playwright smoke checks.

---

### Task 1: Lock The State Contract

**Files:**
- Modify: `apps/desktop/test/next-config.test.js`

- [x] Add a source-level regression test asserting that Home contains a `showFirstRun` state, `Start with your people.`, and conditional open-squad copy while the first-run block excludes the live activity strip.
- [x] Run `pnpm --filter @giggle/desktop test` and confirm the new test fails because the branch does not exist.

### Task 2: Implement The First-Run Workspace

**Files:**
- Modify: `apps/desktop/app/(app)/home/page.tsx`

- [x] Derive `showFirstRun = !mySquadsLoading && mySquads.length === 0` next to the existing squad-state calculations.
- [x] Render the approved first-run greeting, create action, invite-code control, conditional discovery link, and three-step progress line when `showFirstRun` is true.
- [x] Render the existing greeting, live strip, command bar, squad grid, and live rail only when `showFirstRun` is false.
- [x] Reuse `handleCreate`, `handleJoin`, `actionError`, and existing button styles; do not add helpers, dependencies, API calls, or state.
- [x] Run the desktop test suite and confirm all tests pass.

### Task 3: Verify Every Target Viewport

**Files:**
- Modify: `UI_UX_CHECKLIST.md`

- [x] Use Playwright with fresh dev identities at `390x844`, `834x1194`, and `1440x900`.
- [x] Capture Home screenshots and verify no horizontal overflow, duplicate empty-state section, zero-value stats, or empty live rail.
- [x] Exercise invalid invite-code validation and Create Squad to Lobby.
- [x] Mark the Home cross-device and interaction checklist items complete only after the browser checks pass.
- [x] Run `pnpm --filter @giggle/core test`, `pnpm --filter @giggle/desktop test`, and `NEXT_PUBLIC_BACKEND_URL=https://giggle-server-production.up.railway.app pnpm build:desktop`.
