# Friends First-Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Friends search-first for an empty social graph and reliable under API failure without changing established friend actions.

**Architecture:** Keep the existing page and handlers. Extract the current search input into local JSX, derive one explicit first-run boolean, add load/search error state, and conditionally compose first-run versus operational sections.

**Tech Stack:** Next.js, React, TypeScript, Node test runner, Playwright.

---

### Task 1: Lock The State Contract

- [x] Add failing desktop source tests for `showFirstRun`, the search-first workspace, explicit load/search errors, and 44px controls.
- [x] Run the desktop suite and confirm only the new contract fails.

### Task 2: Implement Adaptive Friends

- [x] Add retryable load and search error state without changing existing API methods.
- [x] Reuse one search-field JSX value in first-run and operational compositions.
- [x] Render the first-run workspace only for a truly empty successful load.
- [x] Suppress the friends heading/empty row during first-run and active search.
- [x] Increase friend and modal actions to 44px.
- [x] Run desktop tests.

### Task 3: Verify And Record

- [ ] Capture first-run and populated states at `390x844`, `834x1194`, and `1440x900`.
- [ ] Exercise successful search, no results, search failure/retry, friend request, accept, invite, and remove rollback behavior where locally feasible.
- [x] Run core tests, desktop tests, and the production build.
- [ ] Update `UI_UX_CHECKLIST.md`, commit, push, and restore the local dev runtime.
