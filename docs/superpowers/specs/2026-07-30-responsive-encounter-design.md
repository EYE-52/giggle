# Responsive Encounter Design

**Date:** 2026-07-30  
**Status:** Approved direction, ready for implementation planning  
**Scope:** The live encounter screen on desktop web, responsive web, iOS, and Android.

## Goal

Make the encounter feel like a natural squad conversation on every supported device. People and video get the space; controls stay predictable; large rooms never become a wall of tiny boxes.

This is the first journey in the full-app UI audit. Lobby, matchmaking, match handoff, signed-in product routes, and public/auth routes receive separate design-build-verify cycles.

## Current Evidence

- The canonical web encounter is `apps/desktop/app/(app)/encounter/page.tsx`; the native screen is `apps/mobile/app/encounter.tsx`.
- The web screen currently exposes four manual layouts: Versus, Grid, Spotlight, and Focus Opponent.
- The web screen forces every live feed to `object-fit: cover`, which can crop focused or unusually wide feeds too aggressively.
- Native chat replaces the video stage, and native video state does not yet expose the web adapter's connection and audio/video truth.
- Free squads allow 4 members; premium squads allow 8. A real encounter can therefore contain 2–16 people, including 8v8.
- Existing unit/source checks do not prove visual correctness. The current checklist also reports stale passing counts while the current desktop suite has failures.

## Approved Product Direction

The approved visual direction combines:

1. **Squad Split** as the normal call view.
2. **Focus + Filmstrip** when the user taps a person or the room is too dense for useful tiles.
3. Focused video that preserves the source ratio. It uses fitted media over a restrained blurred fill; Crop is optional, never forced.

The four persistent layout tabs are removed. Layout adapts automatically, and tapping a person is the only primary layout interaction.

## Layout Policy

Layout is local to each viewer and never changes another participant's screen.

### 1v1

- The remote participant owns the main stage.
- Self-view is a small lower-corner tile and can be minimized.
- Tapping self-view swaps focus without changing what others see.

### 2–4 people total

- Use Squad Split with generous tiles.
- Each squad keeps an explicit text label as well as its color accent.
- The current speaker gets a restrained outline; no pulsing multi-ring glow.

### 5–8 people total

- Use Squad Split with one featured person per squad and compact teammate tiles.
- A manually pinned person wins over active-speaker selection.
- When nobody is pinned, a new speaker must remain dominant for 600 ms before focus changes, and each automatic focus holds for at least 1.5 seconds.

### 9–16 people total

- Desktop uses dual focus: one large active or pinned person per squad plus a filmstrip for each squad.
- Phone and narrow tablet use one focused person, a segmented `Yours` / `Theirs` filmstrip, and compact self-view.
- All participants remain reachable without rendering sixteen tiny phone tiles.
- Filmstrips scroll horizontally only when their contents exceed the available width; the page and control dock never scroll sideways.

### Focus and media fit

- Tap a tile or filmstrip item to focus it; tap it again or use Back/Escape to return.
- Focused feeds default to Fit (`object-fit: contain`) with a blurred, darkened copy behind the media.
- Small gallery and filmstrip tiles use Crop (`object-fit: cover`).
- A visible Fit/Crop action appears only for focused media and remembers the choice for the current call.
- Portrait, 4:3, 16:9, and ultrawide sources must remain recognizable without stretching.

## Call Chrome

### Header

- Show squad names and counts on desktop.
- Show LIVE and elapsed time on every device.
- Phone hides duplicate squad names from the header because the stage already labels each squad.
- Connection state replaces decorative status: Connecting, Reconnecting, or Live.

### Controls

Always visible:

- Microphone
- Camera
- Chat
- More
- End encounter

Rules:

- Every target is at least 44×44 CSS pixels on web and 48×48 points on native.
- End encounter is spatially separated and uses the danger color.
- The current backend endpoint ends the encounter for both squads. The UI must say `End encounter`, not imply a private leave, and must confirm the destructive effect.
- More contains reactions, report, focused-media Fit/Crop, minimize self-view, and Switch camera on native phones. It does not become a second settings screen.
- Desktop at 1024 px or wider exposes a reaction shortcut beside More. Narrower screens keep reactions in More.

### Reactions

- The picker remains until selection, outside dismissal, Escape/Back, or another sheet opens.
- A successfully sent reaction floats for 1.8 seconds and then fades.
- Reaction animation avoids faces and controls and respects reduced motion.
- Failed sends do not animate success.

## Chat

- Desktop at 1180 px or wider opens a 340 px side panel. Below 1180 px it becomes an overlay so the media stage does not collapse.
- Phone opens a bottom sheet capped at 55% of the usable viewport; video remains visible above it.
- When the software keyboard opens, the sheet expands to the space below a 96 px compact live-video header.
- Closing chat restores focus to the Chat control.
- Unread count clears when chat opens.
- Failed messages remain in the input with an inline retryable error.

## State and Error Behavior

### Loading and joining

- Do not fabricate squads, participants, live state, or elapsed time.
- Show a quiet stage skeleton while encounter details load.
- Join with whichever tracks are available. Camera or microphone denial must not block chat or the other permitted track.
- Permission errors identify the affected device and provide a concise recovery action.

### Live changes

- Participant positions remain stable when someone mutes, disables video, reconnects, joins late, or leaves.
- Camera-off tiles show the real participant identity and truthful status.
- Remote mute/video indicators render only from known SDK state.
- Reconnecting is non-blocking. Preserve the stage, controls, chat draft, pin, and Fit/Crop choice.
- A disconnected state offers Retry without navigating away.

### Ending and recovery

- End confirmation states that both squads will leave the current encounter.
- If the end request fails, remain in the encounter and show the failure near the destructive action.
- If the other squad or server ends the encounter, stop media, explain what happened, and offer Home or Find another match.
- Invalid or expired encounter links show recovery actions and never create a fake room.

## Accessibility and Input

- Controls use native buttons with visible focus, accessible names, and `aria-pressed` or native selected state where appropriate.
- Team identity never relies on color alone.
- Sheets trap focus on web, support Escape, and map to the platform Back action on Android.
- Chat messages use a polite live region; connection failures and ending state use assertive announcements only when necessary.
- Long names truncate visually while their full names remain available to assistive technology.
- The layout supports keyboard-only control, touch, mouse, 200% browser zoom, larger native text, safe areas, and reduced motion.

## Device and Orientation Rules

Required web viewports:

- 320×568 compact phone
- 390×844 phone
- 430×932 large phone
- 844×390 phone landscape
- 768×1024 small tablet
- 834×1194 tablet
- 1280×800 laptop
- 1440×900 desktop
- 1728×1117 wide desktop

Required native coverage:

- Small iPhone-class device
- Current standard iPhone-class device
- Standard Android phone
- iPad-class tablet
- Standard Android tablet

The stage uses the usable viewport (`dvh` plus safe-area insets), not hard-coded screen height. Opening chat, rotating, resizing, or invoking the keyboard must not cover the control dock or strand a close action off-screen.

## Architecture

- Keep API, socket, reaction, report, and media lifecycle in the existing screen controller.
- Reuse the existing Agora adapter, ChatPanel, icons, session, and UI tokens.
- Add one small pure shared layout-policy helper in `@giggle/core`. Inputs are viewport class, squad membership, active speaker, and optional pinned participant; output is layout kind and ordered participant groups.
- Keep DOM and React Native rendering platform-specific. Do not add a generic cross-platform UI framework or dependency.
- Remove obsolete manual-layout state and rendering branches after the adaptive policy replaces them.
- Bring the native adapter to truthful parity for connection, audio, and video state instead of faking every remote as active.
- Surface separate camera and microphone capture outcomes from both adapters so permission recovery never relies on parsing a generic join error.

The shared helper is justified because the same 1–16-person behavior must stay identical across two clients. It remains pure, dependency-free, and directly testable.

## Verification Contract

### Pure layout checks

Cover at minimum:

- 1v1, 2v2, 3v3, 4v4, and 8v8
- Phone, tablet, laptop, desktop, and phone landscape
- No speaker, active speaker, manual pin, pin target leaving, and late join
- Stable participant order across mute, video-off, and reconnect changes

### Web interaction checks

- Join a real two-client encounter and verify live media, mic, camera, chat, reaction, report, focus, Fit/Crop, reconnect, and end.
- Use seeded rosters and synthetic media frames for 4v4 and 8v8 visual checks; do not require sixteen physical cameras.
- Check every required viewport, dark/light/Tangerine themes, reduced motion, keyboard navigation, and 200% zoom.
- Assert no horizontal page overflow, hidden controls, stage/control overlap, or sheet exit outside the viewport.
- Capture and review screenshots for closed chat, open chat, More, confirmation, camera-off, permission error, reconnecting, and ended states.
- Treat browser console errors and failed app requests as failures unless the test intentionally triggers them.

### Native checks

- Run mobile unit/type checks and build/export gates.
- Exercise camera and microphone permissions independently on iOS and Android.
- Verify safe areas, rotation, keyboard/chat, Android Back, larger text, camera-off, reconnect, and end confirmation on real simulator/emulator surfaces.
- Capture screenshots for the same core participant counts and states as web where the platform can reproduce them.

### Acceptance thresholds

- No primary control is smaller than the platform target minimum.
- No primary control, sheet close action, participant name, or error recovery action is clipped at any required viewport.
- The call stage occupies the remaining viewport after the compact header and control dock; decorative chrome never takes a second row on phones.
- Focused media is never stretched and defaults to uncropped Fit.
- Phone never renders a sixteen-tile grid.
- Every participant is reachable in an 8v8 room.
- A manual pin remains stable until cleared or that participant leaves.
- All state-changing controls roll back or stay put when their backend/media action fails.
- Automated checks, production builds, screenshot review, and live two-client verification all pass before this journey is marked complete.

## Non-Goals

- Screen sharing, captions, recording, beauty filters, virtual backgrounds, or a new moderation backend.
- Replacing Agora, Socket.io, or the current encounter API.
- A generic design-system rewrite.
- Redesigning unrelated app routes inside this encounter change.
