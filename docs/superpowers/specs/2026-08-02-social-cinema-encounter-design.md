# Social Cinema Encounter Design

**Date:** 2026-08-02

**Status:** Approved for web implementation
**Scope:** Responsive web encounter on phone, tablet, laptop, and desktop. Native keeps compatibility but gets a separate visual pass.

## Goal

Make Giggle calls feel like a playful social room instead of a meeting tool while preserving as much space as possible for faces. Portrait phone cameras, square feeds, laptop landscape feeds, and ultrawide cameras must all remain recognizable without stretching or accidental face crops.

## Direction: Social Cinema

- Video is the product: the stage uses the full remaining viewport with 4-10 px gutters.
- Remove `VS`, opposing-team color frames, the center battle seam, cover thumbnails, gradient icon fills, and neon control glows.
- Squad names remain as quiet text chips so identity is explicit without implying competition.
- The current speaker gets one restrained inset cue. Pinning gets a neutral outline.
- Controls use monochrome line icons on translucent neutral surfaces. Muted devices and End encounter are the only danger-colored controls.
- Existing Grid, Squad Split, Focus, and Filmstrip layouts remain adaptive modes; no layout-engine rewrite.

## Theme and Customization Contract

- Midnight, Cloud, and Tangerine Pop keep one information hierarchy but may change accent, type, radius, border weight, and surface treatment through existing semantic tokens.
- The media canvas remains neutral dark in every theme so video and camera-off states stay legible.
- Header, controls, menus, chat, nameplates, focus cues, and reactions inherit the active app theme.
- Existing squad cover customization becomes a low-opacity ambient backdrop in stage gutters. It is not repeated as an icon or split into competing halves.
- Reuse `useTheme`, `coverKind`, `coverBackground`, and `fallbackGradient`; add no theme storage or customization backend.

## Mixed Camera Aspect Rules

1. Never stretch a stream.
2. Every large or primary tile uses Fit with a dim, blurred copy behind it. This includes both sides of 1v1 and 2v2 Squad Split, featured people, focused people, and dual-focus people.
3. Filmstrips, compact companion tiles, and self-view use Crop because they are navigation surfaces, not the primary view. Tapping any thumbnail promotes it to a fitted large tile.
4. The existing focused Fit/Crop action remains a per-call viewer preference. It never changes another participant's view.
5. Tile geometry is stable when a source rotates or reconnects; media fitting changes, participant order does not.
6. Required source coverage is 9:16, 3:4, 1:1, 4:3, 16:9, and at least 21:9 on phone portrait, phone landscape, tablet, laptop, and desktop.

The browser already exposes the intrinsic dimensions on the injected `<video>`. The implementation may expose that orientation as a data attribute for testing, but it does not need a new Agora API or shared aspect-ratio model because layout selection is intentionally source-agnostic.

## One Clip Boundary

- `VideoTile` is the sole rounded media frame.
- Caller sizing may change width, height, or flex behavior but may not override its radius or overflow clipping.
- The media host, Agora-injected wrappers/video, blurred backdrop, overlays, and speaking cue inherit the same frame and cannot paint beyond it.
- External shadows are neutral. Speaker color is rendered inside the boundary.

## Responsive Structure

- Phone portrait stacks two large squad areas for small rooms; dense rooms use one large focus plus a bottom filmstrip.
- Phone landscape uses the available width and keeps the control dock inside the usable viewport.
- Desktop keeps large primary feeds; chat is a side drawer at 1180 px and wider and an overlay below that breakpoint.
- Self-view stays compact and predictable. It never covers the primary face, nameplate, chat close action, or controls.
- Every participant remains reachable in 8v8 without a sixteen-tile phone grid.

## Chat Reliability

- A sent message appears immediately in the current encounter as pending.
- The server acknowledges every send attempt with either the canonical message or an explicit error.
- Success replaces/deduplicates the pending item. Failure leaves the message visible with Retry.
- Encounter chat state lives for the route lifetime, so closing/reopening chat or crossing the drawer breakpoint does not erase it.
- A client message id makes retry and server echo idempotent. The server continues deriving sender identity and room authorization; the client-provided sender remains untrusted display fallback only.

## Existing State Behavior Kept

- Reactions stay visible for about 1.8 seconds and never claim success when sending fails.
- Camera, microphone, reconnect, permission, report, and end states stay truthful.
- End encounter remains destructive for both squads and keeps its confirmation.
- Keyboard focus, 44 px web targets, safe areas, reduced motion, and no horizontal page overflow remain acceptance requirements.

## Minimal Architecture

- Restyle and harden `apps/desktop/app/(app)/encounter/page.tsx` instead of creating a new call component tree.
- Reuse the current adaptive layout policy, Agora adapter, icons, theme tokens, cover helpers, `ChatPanel`, and Socket.IO transport.
- Lift only encounter chat messages and delivery state into `EncounterInner`; lobby chat can keep its current uncontrolled use.
- Add Socket.IO acknowledgements to the existing send event without adding a dependency or database history.

## Verification

- Unit/source checks cover ack payloads, client ids, controlled message state, no forced dark root, no `VS`, and clipping invariants.
- Playwright covers real two-client send/receive, pending-to-delivered, close/reopen, responsive breakpoint retention, failure/retry, mixed source ratios, all required viewports, all three themes, reactions, controls, focus, and no overflow.
- Capture and visually review representative phone portrait, phone landscape, laptop, and desktop screenshots for each theme before completion.
- Run desktop/core/server suites and a production Next build after targeted checks pass.

## Non-Goals

- New themes, theme marketplaces, filters, virtual backgrounds, beauty effects, screen sharing, captions, recording, or replacing Agora.
- Native visual redesign in this pass. Shared socket changes must remain backward compatible with native.
- Persisted chat history after leaving or reloading an encounter.
