# Giggle Launch Performance and UI Polish Design

**Date:** 2026-08-10

**Status:** Approved by the user's instruction to complete the full polish without further approval prompts

**Scope:** Unified `giggle` repository. Web core journey first, then native parity. Age-safety and discovery release gates remain unchanged.

## Goal

Make every core Giggle action feel immediate and make the product read as a deliberate Gen Z social-video experience across Midnight, Cloud, and Tangerine Pop—not a themed meeting app.

## Evidence

- Production health requests currently take roughly 450–600 ms from the development location even when healthy.
- Railway recorded 10–15 second upstream connection failures during the current production deployment.
- Ready already updates optimistically and receives a realtime member delta; it does not need another state architecture.
- Lobby Leave waits for the full server mutation before navigation.
- End encounter waits for the full backend teardown, then waits for Agora leave, then navigates.
- The encounter teardown performs multiple Mongo, Redis, eligibility, queue, and matchmaking operations in series.
- Matchmaking forces the dark theme and uses fixed decorative gradients.
- Match still uses competitive squad panels and a central `VS` treatment.
- The phone Lobby action row can collide when media, Ready, and Find Match controls coexist.
- Encounter notices can stack over the media stage.

## Approaches Considered

### A. Rewrite the client and realtime architecture

Rejected. The current socket delta path, optimistic Ready state, adaptive encounter layout, and safety transitions already work. A rewrite would expand launch risk without evidence that React or Socket.IO is the primary bottleneck.

### B. Cosmetic-only polish

Rejected. It would leave Leave and End feeling blocked and would ignore production availability evidence.

### C. Progressive launch hardening

Selected. Measure and shorten critical paths, make user intent visible immediately, then polish each route using existing tokens and components. Preserve durable server transitions and fail-closed safety behavior.

## Performance Contract

- A click must show visible pressed, pending, or navigational feedback within the next rendered frame.
- Ready remains optimistic and rolls back on failure.
- Leave and End stop local interaction immediately; durable server failure remains visible and retryable.
- Independent Mongo and Redis operations may run concurrently. Safety checks, authorization, and durable state transitions remain awaited.
- No speculative cache, state library, queue worker, or realtime rewrite is added.
- Existing request-duration logging and Railway HTTP timing provide before/after evidence.
- Production infrastructure failures are reported separately from application-handler latency.

## UI Direction

Use the existing Social Cinema system: people and video dominate, controls are quiet and tactile, and themes alter chrome rather than the media canvas.

- Home: one theme-native action surface; no fixed violet promotional gradient.
- Lobby: media first, one clear primary action, phone controls split into stable rows, no overlapping status copy.
- Matchmaking: a restrained, token-driven search state that keeps the squad visible; no intrusive radar takeover or forced dark theme.
- Match: a short `Room ready` handoff with people and shared context; no `VS`, battle framing, or opponent color coding.
- Encounter: keep the adaptive video stage; consolidate transient notices into one priority slot and preserve actionable safety/device errors.
- Mobile: mirror the same hierarchy and behavior using existing React Native primitives and theme tokens.

## Delivery Order

1. Critical interaction immediacy and server-path concurrency.
2. Home and Lobby polish.
3. Matchmaking and Match theme/handoff polish.
4. Encounter notice and control polish.
5. Native parity.
6. Responsive, theme, reduced-motion, latency, build, and production smoke verification.

## Verification

- Unit/source tests are written first for every behavior change.
- Web E2E covers click feedback, failure rollback, phone layout, themes, reduced motion, and core transitions.
- Native source tests cover matching hierarchy and truthful pending/error states.
- Visual captures are regenerated for phone and desktop across all three themes without development chrome.
- Production validation compares Railway endpoint timing and verifies no new slow or failed transition paths.

## Non-Goals

- Enabling stranger discovery before Yoti, moderation, legal, and store gates pass.
- Replacing Agora, Socket.IO, MongoDB, Redis, Next.js, or Expo.
- Adding a new design system, animation dependency, state library, or background-job system.
- Redesigning secondary settings or monetization screens before the core social-video journey is launch-ready.
