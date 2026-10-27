# Solo practice and loading direction

This feature lets one person walk through the existing owned games by playing each real seat in one page. It does not provide computer opponents, automatic answers or a fair hidden-information contest. A normal online room is created only after Start practice. No production auth exception or lower game-player minimum is introduced.

Reuse the existing sticker-party palette: pale ground #f8f8fc, ink #27243b, raspberry #d92972, deeper text accent #8f0f42, sunshine #ffbe35 and teal #0e9b8a. Existing Night tokens apply too. Keep the self-hosted Baloo 2 display and Nunito body fonts. The UI/UX search's corporate/legal result did not fit; its narrower gaming result still suggested heavy WebGL decoration and a new palette, which would slow loading and break the existing identity. Neither was adopted.

The memorable element is three outlined game pieces during real loading. They have one restrained staggered hop, remain static under reduced motion, and disappear immediately when work completes. There is no fake percentage, forced delay or decorative 3D download. A stalled initial import changes to an actionable error after 12 seconds.

Layout:

    Back / Solo practice                         Current status
    Game + player count + Start     [setup only before playing]
    How practice works                         [closed in play]
    Player 1 | Player 2 | ...      All seats / Reload / End
    +------------------------------------------------------+
    |          Selected player's full game surface         |
    +------------------------------------------------------+

Keep controls at the edge and collapse setup during play. All seats is optional and scrolls within its area; it is not the default playfield. Tabs support arrows/Home/End, visible focus and at least 44 px targets. Player counts exclude spectator-only slots and are capped at 8 to bound simultaneous renderers. Inactive frames retain a real viewport for readiness but cannot take focus or pointer input. Switching away releases held inputs.

Per-game notes distinguish turns, hidden information, timed rounds, drawing, pretend performance/judging and parked kart seats. Do not imply camera or microphone acceptance: those permissions are blocked in practice frames. Explain that the normal room is online, code sharing allows joins, and scores are walkthrough results.

Review includes real screenshots, desktop/mobile entry, all 42 games' real seat minimums and readiness, keyboard/touch controls, server-acknowledged cleanup, selected natural completions/rematch, real kart settings, reduced motion, empty/error/retry and storage isolation. Source build and regression checks follow on frozen code; tests never call production providers.

Inactive 3D seats retain actual first-frame readiness, then skip continuous GL submissions until selected. This avoids rendering an invisible table full of scenes while one person acts in another seat; server clocks and gameplay remain unchanged.
