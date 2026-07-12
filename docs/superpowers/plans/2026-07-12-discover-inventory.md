# Discover Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Discover filterable, honest, and useful at every inventory level while creating open squads atomically.

**Architecture:** Extend the existing create-squad request with an optional visibility field defaulted and validated by `giggle-server`. Keep Discover state local, reuse the shared `VIBES`, `SquadCard`, and preview flow, and replace only the filter/empty-state composition.

**Tech Stack:** Next.js, React, TypeScript, Express, Mongoose, Node test runner, Playwright.

---

### Task 1: Extend Squad Creation Safely

**Files:**
- Modify: `packages/core/src/api.ts`
- Modify: `packages/core/test/api.test.cjs`
- Modify: `../giggle-server/src/controllers/squadController.js`
- Modify: `../giggle-server/src/routes/squadRoutes.js`
- Modify: `../giggle-server/test/squadPrivacy.test.js`

- [x] Add failing client and server contract tests for optional creation visibility, private defaulting, validation, persistence, and API documentation.
- [x] Extend the shared TypeScript body with `visibility?: "private" | "open"`.
- [x] Validate and persist visibility in `createSquadHandler`; keep missing values private.
- [x] Update the create endpoint documentation.
- [x] Run both core and server tests.

### Task 2: Redesign Discover Inventory

**Files:**
- Modify: `apps/desktop/app/(app)/discover/page.tsx`
- Modify: `apps/desktop/test/next-config.test.js`

- [x] Add failing source tests for visible `VIBES` filters, URL synchronization, open creation, contextual header action, and the unframed empty state.
- [x] Render `All` plus shared vibe chips and integrate the result count.
- [x] Keep deep-link initialization and update the URL whenever filters change.
- [x] Pass `visibility: "open"` from Discover creation.
- [x] Replace the bordered empty card with a viewport-aware unframed state.
- [x] Run the desktop test suite.

### Task 3: Verify And Record

**Files:**
- Modify: `UI_UX_CHECKLIST.md`

- [x] Capture empty and populated Discover at `390x844`, `834x1194`, and `1440x900`.
- [x] Exercise filter selection, URL persistence, open squad creation, preview, and join behavior.
- [ ] Run core tests, server tests, desktop tests, and the production desktop build.
- [ ] Mark only proven Discover checklist items complete and push each repository branch.
