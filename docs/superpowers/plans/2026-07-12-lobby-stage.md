# Lobby People-First Stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give real people the full lobby stage at every supported viewport without changing lobby behavior.

**Architecture:** Keep the current lobby page and handlers. Simplify the existing grid derivation to count members only, adapt phone columns by participant count, and adjust the existing stage/control styles rather than introducing components or dependencies.

**Tech Stack:** Next.js, React, TypeScript, Node test runner.

---

### Task 1: Lock The Stage Contract

- [ ] Add failing source tests for member-only tiles, adaptive phone columns, viewport-height phone stage, and a single-row phone control bar.
- [ ] Run the desktop tests and confirm the new lobby contract fails for the expected reasons.

### Task 2: Implement The Minimal Layout Change

- [ ] Remove the invite tile and its hover-only state from the video grid.
- [ ] Derive grid rows and phone columns from real member count only.
- [ ] Let the member grid fill the phone stage without fixed 4:3 tiles.
- [ ] Keep phone controls in one row without changing handlers.
- [ ] Run desktop tests.

### Task 3: Verify And Record

- [ ] Capture lobby states at `390x844`, `834x1194`, and `1440x900`.
- [ ] Verify one, two, and four-member layouts where locally feasible.
- [ ] Run core tests, desktop tests, and the production build.
- [ ] Update `UI_UX_CHECKLIST.md`, commit, push, and restore the local dev runtime.
