# Rejected call preview experiment

The user rejected this direction. This page is no longer mounted. Use `APPROVED-DIRECTION.md` as the reference. The notes below are retained only as a record of the discarded experiment.

The user rejected the equal-frame preview. Putting portrait and landscape cameras inside identical boxes created empty bars. Showing eight remote people plus the local squad on a phone also made faces too small. Passing code checks did not make that a good design.

The corrected `/design-check` preview restores warm call chrome, dark video space, source-shaped frames and a compact local squad. It uses the existing `packVideoFeeds` helper, which preserves each simulated camera ratio. It does not put another padded frame around the camera.

On narrow stages, two remote participants are shown per page. Previous and next controls expose the full squad. Your squad has its own two-person pages. Wider stages show up to eight remote people and four local people. Camera shapes and participant counts remain available in the layout settings. Phone chat replaces the visual stage; desktop chat sits beside it.

The default sample has two people in each squad. Ten different stock portraits cover the two-person local squad plus an eight-person remote squad without repeating faces. Additional local squad members use distinct names and explicit camera-off states, so no person appears in both squads. Names are fictional. New photo sources are recorded in `apps/desktop/public/img/call-preview/CREDITS.md`.

This correction is in the design preview only. It deliberately leaves the current live-call component unchanged while this visual direction is being reviewed. A production version of paging must preserve media hosts and audio subscriptions for off-page participants; this photo preview does not implement that service behavior.

Validation: desktop TypeScript passed. Safari review covered the two-squad phone view, all four pages of an eight-person squad, and the desktop view with video and chat. This is visual preview validation, not live call or native-device validation.
