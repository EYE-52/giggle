# Giggle mockups

Try the [interactive website](https://giggle-design-playground.divyanx.chatgpt.site). It is a private design preview with sample people and simulated calls. The standalone source is in `prototypes/design-preview/` at the repository root.

These are design concepts with sample people and activity. They are not screenshots of the existing app.

Direction: warm cream, coral actions, clear type, and dark call surfaces. Home, Lobby, and Live Call share the same visual rules. Mockups show discovery enabled and the squad leader's controls.

Generation: built-in image generation tool. Exact prompts are saved alongside the images.

## View the mockups

| Board | Screens |
| --- | --- |
| [Mobile main journey](mobile-warm-social-v1.png) | Returning Home, Lobby, Live Call |
| [Desktop main journey](desktop-core-v1.png) | Returning Home, Live Call |
| [Mobile supporting screens](mobile-support-v1.png) | Discover, Friends, Profile, Wallet |
| [Desktop supporting screens](desktop-support-v1.png) | Discover, Friends, Profile, Wallet |
| [Mobile entry](mobile-entry-v1.png) | Welcome, Adult Verification, First Visit, Search |
| [Desktop entry and lobby](desktop-journey-v2.png) | Welcome, Adult Verification, Lobby, Search |
| [Shared states](shared-states-v1.png) | Match Found, Empty Discovery, Camera Off, Reconnecting, Squad Chat, Report |

Start with the main journey boards, then compare the supporting screens on both devices. The shared states are focused UI details; their final layout will use a sheet on small screens or a panel/dialog on desktop.

## Before coding

These seven boards establish the first visual direction. They do not specify every setting, dialog, or service state. The public marketing website is also a separate design pass.

- Sample faces and member counts can vary between generated panels. Real UI must use actual participants and accurate counts.
- Generated text is not final copy: the desktop welcome button still renders Google incorrectly after a correction attempt. The implementation label must be exactly “Continue with Google”.
- Native Friends is a proposed addition; it is not implemented in the current native app.
- Apple sign-in is not configured in the current web sign-in screen. Its active appearance in the mobile concept is a future state, not a working feature. Native sign-in also needs to preserve the existing email path until provider sign-in is supported there.
- Match cancellation, camera-off entry, report options, and leader/member actions must use the actual service rules. The state board proposes presentation, not new permissions or API behavior.
- Verification is an access check, not a guarantee that a person is safe.
- The final build needs real contrast checks, text styles, responsive dimensions, and control sizes; an image cannot verify these.
- Keep private-room-only Home, failed loads, verification pending/failed, blocked access, full squads, join requests, microphone denial, and account controls in the implementation scope even though they do not each have a dedicated image.

The [implementation handoff](implementation-handoff.md) breaks the work into small tasks that can be assigned to Luna after the direction is chosen. No production app code was changed for these mockups.

The mockups are for choosing the visual direction. Before implementation, turn the selected design into exact layout rules, reusable components, and small coding tasks. Generated image text and spacing are not a pixel specification.
