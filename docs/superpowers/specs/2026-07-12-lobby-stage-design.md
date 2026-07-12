# Lobby People-First Stage Design

## Problem

The lobby stage gives empty invite affordances the same visual weight as people. On desktop, one empty invite tile can consume half the stage. On phones, fixed 4:3 tiles and a wrapped two-row control bar leave too little first-viewport space for a person.

## Layout

- Render only real members in the video grid. Invite remains available in the header and information rail.
- Make the phone stage fill the viewport below the compact room header before the information sheet begins.
- Fill the available grid height with video tiles instead of enforcing 4:3 cards.
- On phones, use one column for one or two people and two columns for three or four people.
- Keep microphone, camera, readiness, and the leader's Find a Match action in one phone control row.
- Preserve the existing desktop stage/rail split, room settings, chat, invite, cover, and error behavior.

## Interaction And Accessibility

- Existing handlers and API calls remain unchanged.
- All controls retain at least 44px targets.
- Invite stays discoverable in two operational locations without appearing as fake video content.
- The information sheet remains below the phone stage and scrollable.

## Acceptance Criteria

- No empty invite tile appears in the video grid at any viewport.
- One phone participant receives most of the first viewport.
- Two phone participants stack vertically; three or four use a 2-column grid.
- Phone controls do not wrap at 390px width.
- Tablet and desktop retain the collapsible information rail and maximize real-member video.
- Existing lobby failure and action tests remain green.
