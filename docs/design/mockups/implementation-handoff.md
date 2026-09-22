# Build plan after the mockups are chosen

Status: implementation in progress. The approved direction is the warm, compact preview.

### Current implementation — 9 September 2026

- Shared warm palette, local web fonts, branding, and web navigation are implemented.
- The selected smiling gg is applied to web/native/preview components and app icons, with a single connecting animation and reduced-motion support.
- Web Home uses real squad services, with named creation, join requests, retry, and guarded actions.
- Call chat supports Everyone and Your squad in the real web and native apps. Private chat excludes encounter messages even when they carry the same squad ID. Drafts and unread counts are separate.
- On phones, chat takes the main area and Back to video restores the stage. Media clients stay mounted; call controls remain available. Desktop chat stays beside video.
- Web sends show delivery failures and retry. Native waits for a server acknowledgement before clearing the draft.
- The hosted design preview has the same phone/desktop chat pattern and separate sample conversations.
- Verified: core tests (62), native checks (110), web/native TypeScript, web production build, preview build, and browser checks of preview chat at phone/laptop sizes. Browser checks use simulated calls.
- Still required for the full revamp: remaining real app screens, native Home/navigation, and live multi-device call testing. No local backend/Agora credentials are configured. Do not describe the full real app revamp or live call verification as complete.
- Desktop suite status after the brand update: 135/153 pass. Review 18 Home/navigation/chat checks against the changed design and restore any lost behavior; do not dismiss them as stale without checking. The production build and TypeScript pass independently of this suite.

The task list below remains the plan for unfinished screens.

## Settle the design first

Choose the palette and overall layout. Then specify actual font sizes, spacing, breakpoints, color contrast, and control sizes in code. Use the mockup as a visual reference, not as a source for exact pixel measurements.

The concept uses a returning user with an active squad. Also design the first visit, missing friends, no public squads, failed load, discovery disabled, camera denied, long search, and disconnected call. Keep separate leader and member controls.

Native Friends is missing in the current route inventory. The mockup proposes a Friends navigation item; decide whether to implement that feature or omit it before coding navigation. It must not become a dead button.

## Small tasks suitable for separate coding turns

1. **Shared visual rules.** Add the chosen color, spacing, radius, and text styles. Map web and native to the same values. Check readable contrast. Keep existing themes working until a migration is explicitly chosen.
2. **Basic controls.** Build or adapt Button, Avatar, IconButton, and text styles. Check visible focus, disabled states, and touch targets. Follow the actual platform framework docs required by each app's AGENTS.md.
3. **Squad components.** Build the active squad card, compact public squad row, invite-code row, and empty seat tile with sample props. Keep network calls outside these components.
4. **Home.** Compose the components around existing squad data and actions. Cover first visit, returning user, loading, failed load, and discovery-disabled states. Keep wallet and account controls reachable through the final navigation design.
5. **Lobby.** Rework layout around current video and squad behavior. Keep invite codes, permissions, ready states, and leader controls. Do not replace the room/session logic for a visual change.
6. **Live call.** Rework participant layout and control placement around the existing call system. Support real participant counts rather than a fixed five-person grid. Clearly distinguish personal leave from a group skip/end. Keep report and block actions reachable.
7. **Cross-device review.** Compare rendered Home, Lobby, and Call against the selected mockups at small phone, tablet, and desktop sizes. Verify readable text, no clipping, keyboard use, and working call controls.

After the core journey passes review, create separate bounded tasks for entry and verification, Discover, Friends, Profile, and Wallet using their respective boards. Native Friends needs an explicit feature task before navigation exposes it. Treat chat, report, permission recovery, and reconnecting as separate states of the existing flows, using the actual service contracts. Preserve current sign-in paths; Apple must remain unavailable until configured.

Keep each task limited to one feature or component group. Build shared controls before assigning screens that depend on them.

## What each coding task should contain

- One concrete outcome and the chosen reference image.
- Exact files and existing components to inspect.
- Final text, visual rules, and layout behavior at each width.
- States to handle and service behavior to preserve.
- A short acceptance checklist and relevant existing checks.
- A rendered screenshot for review when the task changes a screen.

Use the repository's existing framework and service contracts. Review shared rules and the call journey carefully before accepting the work. Model choice alone does not replace a clear task or visual verification.

### Latest mobile preview refinement

Published preview version 3 uses a 44px call header and one five-button row (mic, camera, chat, More, Leave) on phones. Next squad is in More and still requires confirmation. Phone chat occupies the main area; desktop chat stays beside video. Checked at 375x667, 390x844, and 1366x768 using the interactive layout tester. The preview uses sample people, not live media. Live preview: https://giggle-design-playground.divyanx.chatgpt.site/layouts
