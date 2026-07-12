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
5. Conditional discovery link:
   - show `Browse N open squads` only when `openSignals > 0`;
   - omit discovery messaging when no public squads exist.
6. Combine the greeting and first-room task into one heading so the page has one clear entry point.

The zero-state branch removes:

- the three zero-value activity metrics;
- the separate `Your squads` heading and empty card;
- the empty `Live signals` rail;
- the duplicate `Browse open squads` button when public inventory is zero.

## Responsive Behavior

- Desktop and tablet: the first-run workspace is a compact, top-aligned column capped at `760px`.
- Phone: all controls stack; the create button and invite-code control are full width.

## Visual Direction

The workspace is unframed, top-aligned, and has no forced viewport height, divider, decorative glow, or explanatory step rail. Violet marks the primary action. No gradients, empty cover art, fake avatars, or nested cards are introduced.

## Behavior And Accessibility

- Existing `handleCreate`, `handleJoin`, invite-code formatting, validation, loading, and error rendering are reused.
- Buttons keep 44px minimum targets.
- Invite code retains its accessible label and Enter-key submission.
- Loading continues to show the existing dashboard skeleton until squad state is known; first-run UI never flashes before data resolves.

## Acceptance Criteria

- A zero-squad user sees one dominant task rather than dashboard metrics and duplicate empty states.
- Open-squad discovery appears only when inventory exists.
- No horizontal overflow occurs at `390x844`, `834x1194`, or `1440x900`.
- Create and join-code browser journeys still reach Lobby.
- Existing Home correctness tests pass, with a new assertion covering the adaptive zero-state branch.
