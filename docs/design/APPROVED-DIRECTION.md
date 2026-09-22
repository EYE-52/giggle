# Approved design reference

The user approved the existing Giggle Design Playground, including the smiling gg mark. Later standalone `/design-check` redesigns were rejected because they introduced a different interface and theme. They are not the design reference.

Approved preview: https://giggle-design-playground.divyanx.chatgpt.site

Approved source: `prototypes/design-preview`, commit `c586348a1b7d7fa5e393c52a73e5c7a5f004d92b` (published version 7).

- Home: `/#home`
- Call: `/#encounter`
- Existing device and participant tester: `/layouts`
- Approved brand: `/brand`

The approved visual baseline is version 7. Version 8 (`12e0ae6eb10686e7e06868d345d27fae1b35d8a2`) adds the user-requested personal framing controls and blurred photo backgrounds inside that design. The camera-aware grid algorithm, call shell, and branding are unchanged. The development-only `/design-check` URL now sends the user to its approved call view. The discarded test components remain in source for recovery, but the route no longer mounts them.

Preserve the approved page structure, colors, type, navigation, call controls, and logo. Fix concrete defects inside those components. Do not invent another call shell, slogan, paging interaction, or test interface as a substitute for the approved design.

The user explicitly asked the primary agent to handle this design work without subagents. Follow that instruction.

Earlier implementation notes describe work in progress, not approval of a new visual direction. Live-app migration is still incomplete and must be compared with this reference screen by screen.

## Personal framing refinement

The call preview now lets each viewer select Full view or Fill, zoom from 1x to 2.5x, and reset each person independently. Full view shows the complete sample photo against a decorative blurred copy of the same photo. Zoom never changes tile geometry or the transmitted camera. These remain simulated calls; this does not implement sender-side camera zoom in the live SDK.

Validated with the existing 252 layout combinations, TypeScript, a production build, and native Safari checks for phone framing, zoom buttons, full view, closing the sheet, separate phone chat, and enlarged browser zoom. The new component passes lint; existing page lint findings are outside this change.

## Person menus

The user rejected the always-visible framing buttons. Version 9 (`b08a68cc064a0333e4601392b641f5821024a5db`) keeps faces clear by default. Hover or keyboard focus reveals a small three-dot hint; tapping or clicking a tile opens its person menu. Framing lives inside this menu. Remote participants have a simulated Mute for me / Unmute for me action, with a small muted status beside the name. Camera-off participants keep their menu; framing is disabled while the camera is off. Your own tile does not offer remote listening controls.

Enhance voice is explicitly unavailable in this preview. Do not describe either audio action as live audio processing. The current Site contains sample photos and simulated calls. Live listening controls still need per-participant audio integration. Verified desktop and phone menu access, local mute state, framing access, Escape dismissal, and camera-off self options; TypeScript, component lint, and production build passed.

## Actual app implementation, 10 September 2026

The real web and native encounter screens now use the approved camera-shaped packing rules, personal framing, and person menus. Mute for me is wired to each platform's SDK and tested through mock SDKs; the Site remains simulated and unchanged. Web Full view uses a blurred copy of the live stream; native currently uses its clipped camera surface without a duplicate blur layer.

This does not certify the full product migration or live device behavior. See `2026-09-10-implementation-status.md` for current checks and remaining work. Continue to compare changes against version 9 instead of creating another visual direction.

## Phone top-spacing correction

Version 10 (`82866f98e30feccd35d659e35669c550b3a36d94`) removes the large empty band above the stacked phone grid. Stacked groups align to the top of their existing stage; wide side-by-side groups keep their existing alignment. Camera geometry, theme, and controls are unchanged. The same alignment rule is applied to both actual app stages. Site build, local route response, and web/native TypeScript checks passed; no new visual browser check was performed.

## Call header refinement

Version 11 (`6888ca08ef840ae06f8578cb7dd9a8e6a5600afa`) responds to the user's screenshot of a crowded top area. The preview removes the redundant matchup row, aligns the logo/header to the call's side padding, reduces the desktop header to 60px, and places each participant count beside its squad label. Phone headers remain 44px. The existing logo, theme, framing, menus, and chat modes remain in place. The Site build passed and the update was privately published; visual verification and live-app header migration remain outstanding.

## Plain product copy

Version 12 (`15b9922cb4f5f0de3af43b4be1f0c65ebe0facff`) removes the call slogan “Say hi. See where it goes.” and the decorative home note/footer slogan. Home, Friends, matching, and modal headings now describe the screen or action directly, such as Create a squad, Friends, and Finding a squad. Main call controls remain centered after removing the note. The user asked to remove vague AI-style copy; do not add replacement slogans simply to fill space. The logo, theme, media geometry, and safety/preview disclosures are preserved.

The Site build and local response check passed before private publishing. Equivalent entry copy was cleaned up in local web/mobile landing and home screens and desktop Friends. Those app copy changes are not deployed by publishing the Site.

## Centered controls and page consistency (version 13)

Published source `fd5c9715e3d3a9d7a34a7b50dfe4539d531c24bd`. The user rejected the split bottom row and divider. Five equal buttons now form one centered group: Mic, Camera, Chat, More, Leave. Next squad stays inside More in the simulated preview. All four tested sizes (1440x900, 390x844, 320x568, 844x390) have zero center offset and no horizontal overflow. The theme, logo, camera-shaped packing, and person menus remain the reference.

The real web and native call controls now share this layout. Personal Leave updates only the departing member's video presence; End encounter remains a separate confirmed action inside More. Do not rename a whole-encounter action as personal Leave.


## Actual lobby follow-up

The actual web and native lobby routes now share the approved brand and palette, bounded people tiles, one invite area, centered media controls and settings sheets. Squad creation requires an explicit name and does not invent interests. This corrects the legacy lobby shown in the user's screenshot; it is not a new call-design reference. See the latest section of `2026-09-10-implementation-status.md` for real local interaction checks and remaining device/service limits.
