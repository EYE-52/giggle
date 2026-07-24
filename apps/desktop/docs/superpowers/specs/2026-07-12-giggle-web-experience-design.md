# Giggle Web Experience Design

**Status:** Approved for implementation on 2026-07-12

**Canonical repository:** `/Users/divyansh/Projects/giggle-stack/giggle-web`

**Product objective:** Ship Giggle as a complete, production-grade web experience that feels cinematic before sign-in and fast, clear, and social after sign-in. Every supported viewport receives a deliberately composed experience rather than a scaled desktop layout.

## Delivery Strategy

Build and validate one end-to-end vertical slice first:

1. Public landing
2. Sign-in and OAuth callback
3. Lobby and squad readiness
4. Encounter and matchmaking
5. Live match

After this journey is coherent, apply the same system to Home, Discover, Friends, Profile, and Premium. This order proves the core promise before spending time on secondary routes.

## Product Principles

- **People are the visual subject.** Real participant imagery and video carry the interface. Abstract decoration never competes with faces or the social moment.
- **One action owns each state.** A screen may expose secondary options, but only one action should read as the next step.
- **Live state is unmistakable.** Lime is reserved for ready, live, connected, or successful states. Violet owns navigation and primary actions. Coral indicates risk or destructive actions.
- **Surfaces have jobs.** Cards frame repeated entities, dialogs, and interactive tools. Page sections and layout bands remain unframed.
- **Motion explains progression.** Scroll and transition effects reveal how Giggle moves from forming a squad to meeting another squad and continuing the relationship.
- **No hidden dependency on motion.** Reduced-motion users receive identical information and controls without parallax, autoplay, or animated sequencing.

## Visual Direction

Giggle uses a dark editorial-cinematic system:

- Near-black backgrounds with restrained violet, teal, lime, and coral signals
- Characterful display typography paired with a highly legible body face
- Full-bleed media, hairline separators, controlled bloom, and subtle grain
- Strong asymmetry on wide screens, balanced stacking on smaller screens
- Tight corner radii for controls and practical surfaces; larger radii only for media frames
- Minimal pills: status, filters, and segmented modes only
- No decorative card grids, generic glass panels, or gradients without a functional visual purpose

## Responsive Experience Matrix

### Phone: 320-599px

- Single-column flow with 16px content gutters
- Thumb-reachable primary actions and bottom navigation inside the authenticated app
- Stacked participant media and simplified encounter composition
- No pinned scroll sections; the three use cases become horizontally swipeable or sequential full-width scenes
- Minimum 44px interactive targets and safe-area-aware fixed controls
- Short copy, visible state labels, and no hover-dependent affordances

### Tablet: 600-1023px

- Split layouts where each pane remains at least 280px wide
- Compact top navigation with touch-first controls
- Two-column squad and participant compositions
- Reduced parallax amplitude and no fragile hover-only actions

### Desktop: 1024-1439px

- Cinematic landing composition with scroll-scrubbed three-use-case story
- Persistent authenticated top navigation and contextual side content only where it improves task flow
- Rich participant-media layouts, keyboard interactions, and restrained hover feedback

### Wide Desktop: 1440px+

- Full-bleed media bands with content constrained to a 1200-1320px reading grid
- Additional negative space and depth, not larger body copy or stretched controls
- Participant media may break the content grid while commands remain aligned

## Public Landing Journey

The landing page presents the product, not a marketing abstraction.

1. **Hero:** a live squad-versus-squad encounter is visible immediately with the Giggle name, literal value proposition, sign-in, and get-started action.
2. **Trust bridge:** concise explanation of how Giggle works and what requires camera/microphone access.
3. **Three-use-case story:** a desktop pinned sequence reveals:
   - Form your squad
   - Meet another squad
   - Keep the connection going
4. **Feature proof:** show real product states for lobby, encounter, and friends rather than feature-description cards.
5. **Final action:** return to one get-started command with privacy and safety context nearby.

The provided Giggle screenshot is a composition and motion reference. The implementation keeps Giggle's current brand, product truth, and assets rather than copying another layout literally.

## Authenticated Journey

### Sign-In

- One clear OAuth action with concise privacy context
- Visible loading, provider failure, backend-unavailable, and retry states
- Return users continue to the intended route after authentication

### Lobby

- The squad, readiness, camera/microphone state, and next action appear in the first viewport
- Invite and device controls remain secondary to starting the encounter
- Permissions are explained before the browser prompt when possible

### Encounter and Matchmaking

- Connection progress uses meaningful stages rather than an indefinite spinner
- Cancellation remains visible and safe
- Failed or timed-out matching preserves the squad and offers retry

### Match

- Participant media owns the viewport
- Call controls are stable, safe-area aware, and never overlap media labels
- Connection quality, muted state, and participant departures remain understandable
- Mobile rotation and resize preserve controls and active video

## Shared Application System

- Continue using Next.js 16 App Router, React 19, existing `@giggle/core`, `@giggle/agora`, and `@giggle/ui-tokens` packages
- Keep tokens in `app/globals.css` and small shared primitives in `components/`
- Use native CSS and existing React code for responsive layout and motion; add no animation or UI dependency unless a measured limitation requires one
- Keep route data in the existing core/session APIs rather than duplicating server state locally
- Use route-level state for loading and failures, and component state only for local interaction

## State and Failure Handling

Every route in the vertical slice must define:

- Initial loading state with stable dimensions
- Empty state with one recovery action
- Backend failure with retry where safe
- Offline or socket-disconnected state where realtime behavior is required
- Permission-denied state for camera and microphone
- Cleanup for media tracks, sockets, timers, and pending async work on navigation

User-entered state and the current squad must survive recoverable failures. Destructive or irreversible actions require explicit confirmation.

## Accessibility

- Semantic landmarks, headings, labels, and live regions
- Full keyboard path through navigation, forms, lobby, matchmaking, and call controls
- Visible focus treatment and no color-only state communication
- WCAG AA contrast for text and essential controls
- Reduced-motion behavior for every scroll, entrance, and looping animation
- Captions or text equivalents for meaningful prerecorded media

## Performance

- Landing media uses poster images, responsive dimensions, and lazy loading below the first viewport
- The hero loads only media required for its visible composition
- Avoid layout shift by reserving media dimensions
- Defer Agora and authenticated realtime code until required by the relevant route
- Production build must complete without relying on files outside this standalone repository

## Verification Matrix

Required viewport checks:

- 390x844 phone
- 768x1024 tablet
- 1280x800 laptop
- 1440x1100 desktop
- 1728x1117 wide desktop

Required evidence:

- Unit tests for non-trivial state and responsive contracts
- Production `pnpm build`
- Playwright screenshots for every route in the vertical slice at phone, tablet, and desktop widths
- Interaction checks for navigation, sign-in, lobby readiness, matchmaking cancellation/retry, and match controls
- Console-error and failed-request review
- Reduced-motion screenshot and interaction check
- Canvas/video pixel checks where browser media is rendered

## Completion Criteria

The milestone is complete only when:

- The standalone repo installs, tests, builds, and starts locally
- Landing through match forms a coherent, navigable journey
- All five viewport classes are intentionally composed without overlap, clipping, or unreadable text
- Critical loading, empty, failure, permission, and reconnect states are implemented and verified
- The three-use-case story works with scroll motion on desktop and equivalent static/swipe content on touch devices
- Important implementation decisions, commands, URLs, screenshots, and remaining work are stored in repository documentation

## Explicit Non-Goals for the First Milestone

- Replacing the existing backend or Agora integration
- Adding payments or new premium entitlements
- Creating a second design system beside existing tokens
- Adding speculative social features not required by landing-to-match
- Rebuilding all secondary routes before the core journey is proven
