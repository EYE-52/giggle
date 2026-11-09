# Classic arena redesign

Design written before implementation. North is up (-z). The sketches show
play routes, not road paint alone. `#` is solid cover, `=` a safe fast route,
`*` a pickup route, `~` slippery ice, `F` fountain cover, `P` a portal.
Keep the existing toy materials, low silhouettes and shared geometry.

## Rookie Ring — the bow tie

```
    P     ========       cannon
       ==   ##   ==
       | *      * |
       ==\      /==
          \ ** /
          / ** \       central crossover
       ==/      \==
       | *      * |
       ==   ##  ==
           ========      P
```

60 m square. Two broad turning lobes meet at one open crossover. Four
short cover islands frame the turns; no vertical centre highway or outer
square road. Beginners can follow the eight; experienced drivers switch
lobes, intercept at the crossing, or jump along the outside edge. Pickups
pull players through each lobe and the contested crossing. Opposite first
spawns face their lobe exits, with space to turn away from a fight.

## Bumper Blocks — the switchback yard

```
    cannon    *     P
    ======   ========
    * #######  ## *
    =======*=======
    ## *   ##   * ##
    =======*=======
    * ##  ####### *
    ======   ========
    P         *    pit
```

60 m square. Unequal, staggered bumper walls and an S-shaped spine create three connected horizontal
combat lanes and side escape lanes. The middle cover breaks long shots;
wide gates and short wall ends allow flanking. This is a porous maze, never
single-file corridors or dead ends. Low side dividers expose jump escapes.
Pickups alternate between lane ends and exposed junctions. The crane and
striped bumper walls orient players; no generic oval/cross underneath.

## Garden Circuit — fountain and four garden rooms

```
       ======== gate ========
       |  ####  *  ####    |
       *  #    ===    #   *
       |     == F ==       |
    P == *   = FFF =   *  == P
       |     == F ==       |
       *  #    ===    #   *
       |  ####  *  ####    |
       ======== gate ========
```

120 m square. A solid central fountain island replaces the empty centre.
A diamond promenade links four broad garden rooms separated by hedges.
Outer paths give retreat and long flanks; garden gates shorten pursuit.
The fountain blocks straight shots across the middle; four approaches
allow clockwise and counterclockwise fights. Crates sit along the diamond,
behind hedges and on the perimeter so collecting makes a route. The blue
fountain and watchtower provide local and distant landmarks.

## Frosty Pass — split lake and frozen bridge

```
       ======= north shore =======
       | ##       *        ##   |
       |    ~~~~~~~~~~~~~~~     |
       *    ~~~  north  ~~~     *
       =====*=== bridge ===*=====
       *    ~~~  south  ~~~     *
       |    ~~~~~~~~~~~~~~~     |
       | ##       *        ##   |
       ======= south shore =======
```

120 m square. Two large low-grip lake halves flank a narrow, grippy frozen
causeway. Bank cover at the bridge mouths prevents a whole-map firing
lane. Shore roads form two safer, longer horseshoes. The ice is drivable,
not lethal: players can slide around the bridge instead of queueing.
Pickups tempt bridge crossings and ice excursions. A separate cracked-ice
hazard stays on an outer detour. Blue lake halves, white bridge rails and
the ski lift are easy landmarks. Turbo sits on the shores, not on the ice.

## Neon Yard — city blocks and market plaza

```
    P  =====================
       | ##### | ##### |  |
       | ##### * ##### *  |
       ====== plaza =======
       * ###  * *  ###    |
       | ### *   * ###    *
       =======   ==========
       | ##### * ##### |  |
       ================== P
```

120 m square. Six solid city blocks create offset alleys around an open
market plaza. Two main streets give medium sightlines; perpendicular
alleys and offset buildings stop cross-map shots. The plaza supports open
brawls while the alleys allow ambushes and escape. Pickups alternate plaza,
street crossings and back alleys. Cyan and pink roof caps mark opposite
sides. Existing crane and portals stay as distant and corner landmarks.

## Shared implementation and acceptance

- Author map collision, roads, grip, features, pickups and starts in
  `apps/games/games/engines/kart-maps.js`. The server sends that geometry;
  the browser consumes it. Carry an explicit revision in every snapshot.
- Keep cannon, portal and hazard approach/exit clearances. Reposition
  features only when needed for the new layout. No combat-rule changes.
- Spawn candidates clear tall cover, low walls, ramps, hazards, launchers,
  landings and portals. First seats spread across opposite map regions;
  32 players keep at least 4.6 m between starts.
- Use existing instanced walls and batched cover. Stay under the existing
  per-map full-scene draw ceilings and 85,000 world triangles.
- Check all destinations with a chassis-width flood fill. Check actual
  Rapier jumps/portals/cannons, server snapshots and prediction.
- Save top-down and chase images of each map in Daybreak and Starlight.
  Review silhouettes, gates, pickups, visibility and map identity. Also
  drive the real practice page and run the 32-driver browser check.

## Evidence

Implementation measurements and screenshot review are recorded below after
validation. Browser FPS is a measurement on this shared Mac, not a promise
about other devices.

### Implementation review (9 November 2026)

The final Bumper review replaced equal north/south walls with unequal,
staggered walls. The main road now snakes through opposite gates. This
separates its maze silhouette from Neon's city blocks. The switchback
revision is `blocks-switchback-20261109-2`; the other four use revision 1.

All classic geometry is still authored in `kart-maps.js`. Snapshot maps now
include `revision`. Prediction includes it in its world identity. Fountain
parts are authored on the centre block: the same piece dimensions build
both the visible stone and the finite Rapier colliders; water is cosmetic.
Crowd starts now reject low barriers and ramp feet as well as tall cover.
No loading, vendor, game-host, weapon-rule or rendering-budget code changed.

### Before / after measurements

Scene counts below use the existing full-scene GLB test: no camera culling,
including animated sky/features, excluding shadow passes. No ceiling was
raised. World triangles use the existing world statistics check.

| Arena | Before peak scene draws | After peak scene draws | Existing ceiling | After world triangles | Pickup sockets before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| Rookie Ring | 96 | 96 | 97 | 74,550 | 24 → 31 |
| Bumper Blocks | 96 | 98 | 98 | 56,517 | 25 → 25 |
| Garden Circuit | 116 | 113 | 117 | 82,103 | 36 → 38 |
| Frosty Pass | 107 | 107 | 108 | 77,489 | 37 → 39 |
| Neon Yard | 87 | 87 | 91 | 57,062 | 37 → 37 |

All maps provide 32 legal starts with a measured minimum spacing of 4.6 m.
One-metre navigation checks find no disconnected drivable cells. Every
pickup, start, cannon landing and portal exit is reachable with chassis
clearance. The existing physics tests exercise every jump and both sides
of every portal, plus actual ground support and released-control parking.

A normalized road-footprint comparison (intersection / union, 51×51 grid)
changed from 46.0% mean overlap across map pairs to 39.2%. This is a limited
shape measurement; the signature geometry and visual review are the main
checks for identity. The regression also checks the bow-tie crossover,
staggered maze walls, solid fountain, two low-grip lake halves with a grippy
bridge, and the six city blocks around an open plaza.

### Browser and visual evidence

[All 20 final views](../artifacts/kart-maps/after/contact-sheet.png) show
Daybreak and Starlight, each from top-down and the normal landscape chase
pose (60° field of view, 8.8 m back, 3.2 m high, terrain-aware look-ahead).
The review fixture uses production world, lighting, GLBs, map structures and
features. It displays every pickup socket for route review, rather than a
match's smaller random active subset. It is an art fixture, not multiplayer
performance evidence. Its small caption is review-only.

| Arena | Visual review of all four views |
| --- | --- |
| Rookie Ring | Two lobes and one crossover are clear; inner low walls mark each turn. Day and night keep the crossing readable. |
| Bumper Blocks | Unequal walls and opposite gates create a visible S route. Cover breaks the chase sightline without hiding the next junction. |
| Garden Circuit | The blue fountain is the local anchor; the diamond splits around it and four garden rooms offer flanks. Low hedges preserve the horizon. |
| Frosty Pass | Blue lake halves and white bridge rails distinguish the long central fight from the shore detours. Ice remains readable at night. |
| Neon Yard | Broad streets and offset alleys enclose the plaza. Opposite cyan/pink blocks and the city skyline orient the driver. |

The scene checks C3 (game identity), C4 (readable colour), and C10 (clear
playfield) are HIGH in this review. Control/text/phone checks are N/A to the
art-only shots. The real practice screenshot and the garage browser cases
supply separate UI evidence; the production HUD remains unchanged.

Real `/practice/?game=pocket-karts` play used two ordinary seats and the
Maps & settings dialog. In Garden, real keyboard input moved the kart
33.9 m, retained three hearts, and produced no browser errors. See
[practice screenshot](../artifacts/kart-maps/practice/garden-desktop.png),
[driving video](../artifacts/kart-maps/practice/garden-desktop.webm), and
[reviewed video frames](../artifacts/kart-maps/practice/drive-filmstrip.png).
Earlier forced-software two-seat practice attempts timed out during
preparation; normal Chrome rendering completed. Loading code was untouched.

The unmodified software-rendering settings in `kart-32-browser.cjs` passed:
32/32 connected, 32.1 binary updates/s, 84.6 m browser movement, no errors.
Measured rendering was **4 FPS**, 397 draw calls/frame, and a 1,667 ms worst
frame on this busy shared Mac. This is not a claim of smooth rendering on
all devices. See [raw metrics](../artifacts/kart-maps/32/kart-32-browser.json)
and [32-driver screenshot](../artifacts/kart-maps/32/kart-32-browser.png).
The garage browser file passed all ten desktop/tablet/phone cases in day
and night using the supplied Chrome executable.

### Reproducing the review

From the worktree root:

```
NODE_PATH=/private/tmp/codex-driving-browser/node_modules node apps/games/tools/kart-map-review.cjs
```

This owns port 8310, writes the twenty views and metrics under
`artifacts/kart-maps/after`, and closes its browser/server. Set
`MAP_REVIEW_VIDEO=1` for recordings or `MAP_REVIEW_SOFTWARE=1` to force
SwiftShader. The shipping renderer is unchanged.

`test/kart-map-designs.mjs` is included in `package.json`'s main test chain.
Existing map-specific fixtures now use the new legal routes and cover
faces. Physics, damage, timing and draw-budget assertions remain in place.

Final validation: all **106 kart test files listed in package scripts**
passed (104 node files and both browser files). The framework cover-face
fixture was aligned with the final staggered wall and rerun successfully.
The three `pocket-karts*.js` files also passed. The final source kept the
original draw ceilings. See [test status](../artifacts/kart-maps/test-status.json)
and [run plus rerun logs](../artifacts/kart-maps/kart-tests.log).
