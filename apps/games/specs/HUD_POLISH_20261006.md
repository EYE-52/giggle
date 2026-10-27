# Game-owned HUD polish

The user rejects the current HUDs as app-like and wants polished game interfaces across all 37 catalogue games. The phone/touch behavior shipped in 0.1.6 must survive this work. This is an interface release: no new rules, transport, timers, economy, game catalogue entries or media permissions.

## Shared platform boundary

During play the platform should be a small room-control launcher with optional player/voice context. Move long room/host descriptions, cumulative night totals, sound/theme, invitation and Change game into its drawer. Avoid a second brand masthead and heavy enclosing card above/around an already game-owned scene. Game name stays readable. Spectator status remains honest and accessible. Rematch/Change game and host-wait text stay reachable after results. Preserve all existing action/window guards, secrets, focus, composition, gesture and disposal behavior.

Each game owns its fantasy, palette, typography, phase/turn presentation and action arrangement. Share only useful behavior/accessibility. Do not force all games into the same rounded panels, CSS grids or timer style. Surface the live objective, whose turn/action it is, time if relevant and meaningful progress. Hide optional help and verbose instruction paragraphs behind a real disclosure while keeping the next action clear.

## Visual direction

- Karts: sporty racing instruments. Timer/score in one compact race strip, a distinctive equipped-weapon slot, subtle speed/drift telemetry and a small minimap. No five equal boxed cards, persistent controls paragraph or oversized player leaderboard. Keep chase-camera world and lower center clear. Device thumb controls retain at least 44px hit areas, simultaneous fingers and Auto gas safety.
- Castle: faction banners and an expedition toolbelt. Short phase/clock and team health/resource data; contextual build/aim feedback. Use illustrated silhouettes and asymmetric hierarchy rather than flat admin inventory cards. Retain sunset valley, supply/build orders, upgrade/unlock affordances and orbit-versus-build boundaries. Put detailed counts/descriptions in Help or a disclosure. Every essential tool stays usable on phones.
- Chain: atomic tabletop with a compact current-player/round strip, stable player-color/turn cues and scoped rules/results. Protect the board and preserve ordered traveling cascades, cell targets, scrolling and result reveal.
- Party games: game-specific stage cues and small round/phase marker. Voting games expose locked-in/awaiting/results clearly; prompt remains the centerpiece. Writing games retain composer identity and keyboard paths. Match standings are distinct from cumulative night totals.
- Skill games: game-specific instruments (drawing desk, chess clock, reaction signal, typing track, word desk). Explicit actor/turn/action state with a concise round/phase cue. Retain readable secret/prompt type and current-turn/control feedback. No duplicate timer or generic dashboard frame.

## Verification and ownership

Root owns shared app/style, Karts, Castle, versions, build and deployment. Parallel party, skill and Chain agents own only their game clients/styles and local tests. Try actual Muse Spark 1.3 Contributor MAX first in each owned group; Codex reviews and corrects delivery. No Git repo/worktree assumptions and no deployment by child agents.

Use actual production modules/engine projections. Review active, awaiting/reveal, done, watcher and long-name/custom-text states. Desktop 1280×800, portrait 390×844 and 320×640, landscape 844×390 or 568×320. Retain 44px primary targets (dense chess board exception), 16px input fonts, safe areas, vertical scrolling where needed, focus rings and reduced motion. No clipped/inaccessible drawer, HUD/target overlap, stale composer or private word leakage. Measure the actual playfield/HUD bounds; screenshots are mandatory for 3D. Native actions and real socket acknowledgements cover meaningful root and group flows. Browser viewport checks do not imply physical-device testing.

Reuse existing render/input/clock helpers. Native CSS, DOM and SVG are sufficient; do not add an animation/UI library. Motion answers time urgency, hits, lock-in or phase changes; no always-running decorative pulses. Finish with a clean Node 24 suite/build, source snapshot and frontend-only Vercel release if backend source remains unchanged.
