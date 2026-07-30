# Full-App UI Audit

**Date:** 2026-07-30  
**Status:** In progress; this file is a defect ledger, not completion evidence.  
**Baseline commit:** `5e62b05`

## Objective

Make every Giggle route clean, useful, truthful, accessible, and deliberately responsive across phone, tablet, laptop, and wide desktop. Repeated entities may use a grid; empty states, settings, status, and primary tasks must not become decorative card walls.

## Current Verification Baseline

| Surface | Result | What it proves |
| --- | --- | --- |
| Core | 25/25 tests pass | Shared API, session, billing, reporting, chat, and reaction contracts covered by the suite are green. |
| Server | 111/111 tests pass | Current backend validation, auth, matching, privacy, realtime, and profile contracts covered by the suite are green. |
| Mobile | 54/54 tests pass; TypeScript passes | Existing source contracts compile and pass, but the tests do not prove visual quality or full web/native parity. |
| Desktop | 73/94 tests pass | Twenty-one checks fail. The failures mix real regressions, stale source-string assertions, and incorrect post-monorepo paths. |
| Desktop build | Passes; 19 routes generated | Production compilation succeeds. Current Node `25.6.1` is outside the declared `>=20.18 <25` engine. |
| Visual browser audit | Not run | The in-app browser had no runtime and Computer Use could not start its native pipe. No route is pixel-approved from source inspection alone. |

## Journey 1: Lobby to Encounter

### Lobby

- Web reintroduced an Invite tile, phone `4 / 3` tiles, a scroll-first stage, and a wrapping media-control row after the approved people-first Lobby work.
- Native renders enough empty Invite tiles to reach four cells and uses fixed two-column 16:9 cards.
- Both contradict `docs/superpowers/specs/2026-07-12-lobby-stage-design.md`.
- The earlier member-only implementation still exists in git history and should be restored selectively rather than rewritten.

### Matchmaking

- Web devotes most of the viewport to concentric rings, spokes, a dot field, a sweep, and multiple status blocks.
- The compact-phone cancel check and failed-cancel check currently fail.
- Native is calmer and keeps Cancel visible, but both clients should expose one honest status, elapsed time, and recovery path.

### Match handoff

- Web uses real squad names, rosters, covers, and tags, but requires manual joining for 20 seconds and then returns the squad to search.
- Native auto-joins after 10 seconds but uses two bundled generic photos and hardcoded `Casual`, `Gaming`, and `Late Night` tags.
- The same backend provides a 60-second acknowledgement window to both clients. The user-facing rule must be identical.

### Encounter

- Approved direction: Squad Split by default, tap-to-focus filmstrip for dense calls, and focused media shown with Fit plus blurred fill so ultrawide feeds do not crop to teeth.
- Capacity is up to 8 people per squad, 16 total.
- Reactions appear near the sender, float, and fade after about 1.8 seconds.
- Implementation planning remains gated on review of `docs/superpowers/specs/2026-07-30-responsive-encounter-design.md` and the live-journey direction.

## Journey 2: Signed-In Product

### Home

- Web lost its approved zero-squad branch and again shows three activity figures, a separate `No squads yet` state, a Live Signals rail, and a ghost Browse card.
- Mobile has Create, Join, and Discover actions but never loads or opens the user's existing squads.
- Mobile creation always applies the selected vibe; web Home intentionally creates a neutral squad. The product rule is inconsistent.

### Discover

- Web largely retains the approved visible filters, real `SquadCard` inventory, preview-before-join flow, and open-squad creation.
- Native ignores real squad covers, alternates two bundled venue photos, and passes vibe tags into an avatar stack as if they were member names.
- Native Discover creates a private squad even though creation from Discover is specified as open.

### Friends

- Web lost the approved search-first empty state and explicit initial-load/search-failure states.
- Search failure currently becomes `No people found`, which is factually wrong.
- Friend-card icon actions remain 40px instead of the 44px minimum.
- Native has no Friends route.

### Profile

- Web again separates identity and Giggle+ into two cards and stacks tablet content, contradicting the approved combined identity surface and tablet two-column layout.
- Native shows four account-fact cards before preferences, starts with hardcoded vibe preferences, derives a public handle from email, and saves preferences only to local browser storage.
- Native settings sheets list actions as `Available in app settings` but do not perform those actions.

### Premium / Wallet

- Web uses a relatively calm balance, referral, token-perk list, and launch-status surface.
- Native shows an unbuyable plan preview, an unbuyable four-card token-pack grid, and another boost-card grid. It also advertises unbuilt history and video upgrades.
- The native screen should align with the truthful Wallet model and omit unavailable purchase inventory until checkout exists.

## Journey 3: Public and Auth

- Landing follows the approved cinema-first direction in source, but its 1,318-line implementation and every target viewport remain visually unverified.
- Sign-in currently exposes Google only. The failing Apple assertion conflicts with a source comment that Apple backend configuration is incomplete; do not add a dead provider button.
- Privacy and Terms use the shared dark `LegalPage`; the current failure checks theme markup in the route files instead of the shared component.
- Native onboarding tests pass, but its real phone/tablet composition still needs screenshots and keyboard/rotation checks.

## Desktop Failure Triage

The 21 failures are not one category:

- **Likely real UI/behavior regressions:** compact matchmaking, Lobby readiness contract, phone Encounter height, Home first-run composition, Friends failure states, and Profile hierarchy.
- **Stale implementation-string assertions:** Home/Friends toast handling, Discover header condition, Premium disabled-button structure, legal theme placement, and picker/modal composition.
- **Broken monorepo assumptions:** missing `apps/desktop/vercel.json`, incorrect `apps/desktop/packages/core` paths, and standalone Next tracing expectations.
- **Needs direct investigation:** cover background assertion, notification dismissal assertion, social auth gates, and current production provider configuration.

No failing assertion should be updated merely to become green. Each one needs a behavior-level decision and the smallest runnable check that proves it.

## Required Visual Matrix

Web: `320x568`, `390x844`, `430x932`, `844x390`, `768x1024`, `834x1194`, `1280x800`, `1440x900`, and `1728x1117`.

Native: smallest supported iPhone, current iPhone, compact Android phone, current Android phone, iPad portrait/landscape, and Android tablet portrait/landscape.

For every route and meaningful state, record overflow, clipping, target sizes, keyboard/focus path, reduced motion, loading, empty, backend failure, offline/reconnect, permissions where relevant, and truthful real-data rendering.

## Next Gates

1. Approve one live-journey direction in the visual companion.
2. Write and review the Lobby/Matchmaking/Match design spec and implementation plan.
3. Implement the live journey by restoring existing good code before adding new code.
4. Restore the already-approved Home, Friends, Profile, and Lobby responsive contracts selectively from history.
5. Design the missing native parity work for Home, Discover, Friends, Profile, and Wallet.
6. Run visual verification when a controllable browser/runtime is available; keep every unobserved pixel claim open until then.
