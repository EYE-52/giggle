# Friends First-Run Design

## State Model

- First run: loading finished, no friends, no incoming/outgoing requests, and no active query.
- Search: query has at least two trimmed characters; results, empty results, or an explicit search failure render below the search field.
- Operational: requests or friends exist; retain requests and the online-first friend grid.
- Load failure: show a retryable error instead of the first-run state.

## First-Run Experience

Use one viewport-aware, unframed `Find your people.` workspace. The search input is the primary interaction and is not repeated under a `Your friends` heading. Supporting copy explains that display names are searchable without introducing suggestions or privacy assumptions.

## Operational Experience

Keep the compact search field, request actions, friend presence, invite-to-squad flow, and optimistic rollback behavior. Increase all actionable controls to at least 44px.

## Acceptance Criteria

- Empty users see one search-first workspace at phone, tablet, and desktop sizes.
- Active search does not render a redundant empty friends section.
- Initial-load and search failures are distinguishable and retryable.
- Search, request, presence, invite, and remove behavior remain wired to existing APIs.
- No horizontal overflow or browser errors occur at target sizes.
