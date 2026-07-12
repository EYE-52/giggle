# Giggle Web UI/UX Checklist

Canonical source: this repository only. Web lives in `apps/desktop`; Android and iOS live in `apps/mobile`. The legacy `giggle-web` repository must not be used or deployed.

## Product Direction

- [x] Keep the landing page cinematic, branded, and scroll-led.
- [x] Keep signed-in navigation across the top; no left sidebar.
- [x] Make signed-in Home operational rather than marketing-heavy.
- [x] Reserve visual drama for real people, live video, and squad covers.
- [x] Use tokens as the spend currency; Giggle+ provides stipend and pack bonuses.
- [x] Give calling surfaces maximum space for people and video.

## Cross-Device Audit

Viewports: phone `390x844`, tablet `834x1194`, desktop `1440x900`.

- [ ] Landing: hero, navigation, How it works, scroll-scrub video, Features, footer.
- [ ] Sign-in: one-viewport fit, provider actions, legal links, dev login.
- [x] Home: adaptive empty state and populated squad dashboard at phone, tablet, and desktop sizes.
- [x] Discover: visible URL-synced filters, cover cards, inventory-aware empty state, atomic open creation, preview, and join across all target sizes.
- [ ] Friends: search, requests, friend cards, empty state, invite flow.
- [ ] Profile: identity, vibes, account settings, premium placement.
- [ ] Lobby: people-first stage, readiness, invite, settings, chat, calling controls.
- [ ] Matchmaking, Match, Encounter: viewport fit and video priority.

## Interaction Journeys

- [x] Landing navigation reaches How it works and Features.
- [x] Scroll progress advances `/landing/demo.mp4`.
- [x] Dev login repairs malformed legacy browser state and reaches Home.
- [x] Create Squad reaches a fully loaded Lobby.
- [x] Invalid squad codes show actionable inline validation without navigation.
- [x] Discover creation produces a genuinely open squad visible to another user.
- [x] Discover preview and join reach the shared Lobby without console errors.
- [ ] Join with code handles invalid and valid codes clearly.
- [ ] Squad readiness and Find a Match expose backend failures without losing state.
- [ ] Profile edits persist and survive reload.
- [ ] Sign-out and protected-route redirects behave correctly.

## Engineering Gates

- [x] Backend health: API, database, and Redis connected.
- [x] Core tests: 27 passing.
- [x] Desktop tests: 100 passing.
- [x] Next production build: 19 routes.
- [ ] Phone, tablet, and desktop screenshots reviewed after the final changes.
- [ ] No browser console or page errors across audited journeys.
- [ ] Final branch pushed to `EYE-52/giggle` and PR checks green.
