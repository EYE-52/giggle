# Home Zero-State Design

## Scope

This iteration changes only signed-in Home when `mySquadsLoading` is false and `mySquads.length === 0`. The populated dashboard, API calls, squad handlers, and top navigation remain unchanged.

## Problem

The current first-run page presents three versions of the same absence: zero-value activity metrics, a large `No squads yet` card, and an empty `Live signals` rail. Create and browse actions also compete before either personal or public inventory exists. The result has weak information hierarchy, excessive segmentation, and large unused desktop space.

## Replacement

Render one first-run workspace below the greeting:

1. Headline: `Start with your people.`
2. Supporting copy: create a room, invite friends, then choose the squad vibe together.
3. Primary action: `Create your first squad`.
4. Secondary path: a clearly labeled invite-code field and `Join squad` action.
5. A shared Live Signals panel beside the first-room actions when public inventory is loading or available. It uses the same real squad rows and join handlers as the populated dashboard.
6. Omit the Live Signals panel when the public inventory has loaded empty.
7. Combine the greeting and first-room task into one heading so the page has one clear entry point.

The zero-state branch removes:

- the three zero-value activity metrics;
- the separate `Your squads` heading and empty card;
- the empty `Live signals` rail;
- duplicate Browse calls when the Live Signals panel already exposes `View all`.

## Responsive Behavior

- Desktop: first-room actions and real Live Signals share a compact two-column workspace.
- Tablet: first-room actions and Live Signals stack.
- Phone: all controls stack; the create button and invite-code control are full width.

## Visual Direction

The workspace is top-aligned with one framed action surface and one real-inventory surface. It has no forced viewport height, decorative glow, or explanatory step rail. Violet marks the primary action and its top identity edge. No gradients, empty cover art, fake avatars, or nested cards are introduced.

## Behavior And Accessibility

- Existing `handleCreate`, `handleJoin`, invite-code formatting, validation, loading, and error rendering are reused.
- Buttons keep 44px minimum targets.
- Invite code retains its accessible label and Enter-key submission.
- Loading continues to show the existing dashboard skeleton until squad state is known; first-run UI never flashes before data resolves.

## Acceptance Criteria

- A zero-squad user sees one dominant task rather than dashboard metrics and duplicate empty states.
- Open-squad discovery appears as real squad rows when inventory exists.
- No horizontal overflow occurs at `390x844`, `834x1194`, or `1440x900`.
- Create and join-code browser journeys still reach Lobby.
- Existing Home correctness tests pass, with a new assertion covering the adaptive zero-state branch.
