# Profile Responsive Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Profile first-fold waste while preserving every existing setting and handler.

**Architecture:** Modify only the current Profile page. Recompose its existing identity and premium JSX into one surface and change the existing responsive grid condition; do not add components, dependencies, state, or API calls.

**Tech Stack:** Next.js, React, TypeScript, Node test runner.

---

### Task 1: Lock The Responsive Contract

- [ ] Add failing source tests for one identity surface, compact phone identity, tablet two-column layout, and a 44px Save action.
- [ ] Run desktop tests and confirm the new contract fails.

### Task 2: Recompose Existing UI

- [ ] Move the existing premium status/upsell into the identity surface.
- [ ] Make avatar sizing and identity direction responsive on phones.
- [ ] Keep tablet and desktop in two columns with responsive left widths.
- [ ] Raise Save to 44px without changing its handler.
- [ ] Run desktop tests.

### Task 3: Verify And Record

- [ ] Capture Profile at `390x844`, `834x1194`, and `1440x900`.
- [ ] Exercise avatar edit, premium navigation, demographics save, switches, and sign-out.
- [ ] Run core tests, desktop tests, and the production build.
- [ ] Update `UI_UX_CHECKLIST.md`, commit, push, and restore the local dev runtime.
