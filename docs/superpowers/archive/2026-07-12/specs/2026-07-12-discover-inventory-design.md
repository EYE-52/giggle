# Discover Inventory Design

## Scope

Redesign the signed-in Discover inventory and correct squad creation semantics across `giggle` and `giggle-server`. Home and mobile callers keep private-by-default creation.

## Product Contract

- Discover displays visible `All` and vibe filters; filtering is no longer hidden behind URL parameters.
- The selected vibe remains reflected in `?vibe=` for deep links and refreshes.
- The result count sits with the filters rather than floating independently.
- Populated inventory uses the existing cover-driven `SquadCard` grid and preview-before-join flow.
- The header action is contextual: `Join random` for all inventory, or preview a matching squad while filtered.
- Empty inventory is an unframed, vertically intentional state rather than a thin card.
- Creating from Discover atomically creates an `open` squad. Creating from Home and every existing caller remains `private` by default.

## Backend Contract

`POST /api/squads/create` accepts optional `visibility: "private" | "open"`.

- Missing visibility resolves to `private`.
- Any other value returns `400 INVALID_VISIBILITY` before persistence.
- The visibility is stored in the initial squad document, avoiding a partially-created private squad when a second request fails.

## Responsive Behavior

- Phone: horizontally scrollable filter row with stable chip sizes; empty content uses the remaining viewport without overflow.
- Tablet and desktop: wrapping filter row, contextual header action, centered empty state, responsive squad grid.

## Acceptance Criteria

- Vibe filters are visible at all target sizes and synchronize with the URL.
- Filtered creation includes both the selected tag and `visibility: "open"`.
- Unfiltered creation includes `visibility: "open"`.
- Home creation remains unchanged and private by default.
- Invalid backend visibility is rejected before a squad is saved.
- Existing previews, joins, errors, and loading states continue to work.
