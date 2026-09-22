# Adaptive camera layout and brand study

The preview now computes frame placement from camera ratios and available space. It tests row and column groupings without changing participant order. It fits frames within the available area and penalizes layouts that give one person a huge tile beside tiny peers. It reallocates space between squads as people or camera orientations change. Camera-off tiles use a square fallback. This currently uses the preview's camera metadata; live Agora dimensions still need to be connected in the real apps.

252 combinations of six viewport sizes, 1-6 own participants, and 0-6 remote participants are checked for preserved aspect ratio, bounds, and overlap. Rotated feeds are checked separately. Browser review covered mixed phone cameras and a laptop with one own participant and six remote participants. Tests are in prototypes/design-preview/test/call-layout.test.mts.

The user selected the smiling two-g mark and approved applying it. A preliminary web search found related double-loop marks, including Moreloop (https://moreloop.ws/) and stock loop lettermarks. This does not establish worldwide uniqueness or clear the mark.

The selected mark has asymmetric heights and a joined lower stroke. It now appears in the preview, web and native components, browser icons, and native app/splash assets. The real apps share SVG geometry through ui-tokens; the independently hosted preview carries the same geometry locally. Connecting draws the mark once. In-call and header marks stay still. Reduced-motion settings skip the animation. The /brand route keeps replay and still controls for review.

Published preview version 7: https://giggle-design-playground.divyanx.chatgpt.site/layouts
Brand study: https://giggle-design-playground.divyanx.chatgpt.site/brand
Final preview source: c586348a1b7d7fa5e393c52a73e5c7a5f004d92b. Preview build and TypeScript passed. Web production build, web/native TypeScript, and 110 native checks passed after applying the brand. The desktop suite currently passes 135 of 153 checks; 18 failures concern the earlier Home/navigation/chat redesign. These need review, including Home action-level auth guards and changed phone chat expectations. A successful build does not mean the full app rollout or live call verification is complete.

Safari review found an older cached page requesting removed assets; a fresh tab loaded the new page. Drawing now uses actual SVG units and returns to the plain stroke after finishing, avoiding a persistently hidden animated mark.

Web and preview also remove the drawing class after 1.4 seconds so a browser pausing CSS animation does not leave the logo hidden. Replay starts a fresh drawing; the timeout is cleared on unmount.

Published version 7 was opened in a fresh Safari tab. The selected gg and connecting mark remain visible after the time limit; the still and replay controls are present. Existing cached tabs may need a fresh load after publishing.
