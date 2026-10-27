# New 3D games — reviewed planning direction

Date: 14 October 2026. Status: planning only. Current production remains 0.1.36 with 42 active games. No new game is registered, implemented, played or deployed by this packet. Castle remains removed; tower defence remains deferred.

## Build order

| Order | Original game | Players | What should make people rematch | First convincing slice |
|---|---|---|---|---|
|1|Cloud Links|2–8|Shared near misses, a satisfying bank shot and a safe route versus a risky shortcut|One complete simultaneous-play golf hole, independent non-colliding balls, real ramp/contact, aim/power, out-of-bounds recovery, recap and rematch|
|2|Rocket Room|2–6|Friends solve a repair that requires each other's information, then swap roles|One tangible 3D repair station, untimed teaching attempt, timed rescue, meaningful 2–6 player responsibilities and text/pings alongside Giggle Meet|
|3|Bomb Garden|2–8|Readable escapes and bomb chains that create reversals in short rounds|One arena, movement and planting, precise blast/cover rules, safe spawn validation, rounds capped at 45 seconds and a useful spectator experience|

Marble Rush and Parcel Panic stay in the later backlog. They need additional rolling/traversal or shared-carry physics proof. The goal is three distinct experiences, not extra kart variants or a dozen unfinished cards.

Cloud Links explicitly replaces the older sequential-shot idea with simultaneous independent balls. Avoiding player-ball collisions is an intentional first-version rule, not a missing collision feature; course surfaces still have real contacts. It needs shared start/recap and readable friend shots to feel social rather than separate solo play.

## Work sequence and ownership

1. **Design review:** root defines the fantasy, controls, visual language, camera and exact rules. Muse develops concrete layouts, level decisions, recovery paths and QA cases using supplied references and skills. An independent reviewer challenges fun and technical assumptions. User and root review the design before production work.
2. **Mechanics experiment:** prove the first game's core action and network flow in an isolated local branch. This is internal work, not a catalogue entry. Two real people should be able to start, act and rematch without designer coaching. Observe frustration and involuntary waiting. Replace the mechanic if it fails; do not hide weakness with more scenery.
3. **Polished slice:** finish one level with approved actual assets, camera/input feel, gameplay motion, meaningful audio and a small HUD. Review desktop, phone and embedded compositions. Only then make the other two golf holes or advance the next game.
4. **Independent QA:** the implementer supplies reproduction cases and candidate captures; a separate reviewer verifies them. Rules, rendered visuals, physical controls, performance, audio and human fun have separate results. Unverified is not pass. Root fixes rejected work or gives Muse a narrowly specified correction.
5. **Release candidate:** freeze exact code and asset versions, pass existing platform regressions and the new game's checks, finish real lifecycle play, then review matching deployment bytes. No raw credentials/private reports in Git. Preserve original failures, hash-bound evidence and recovery artifacts.

Planning, asset selection and QA preparation may run in parallel. Production simulation/input implementation starts with one game so a defective runtime does not spread into three. Do not start every map at once. Every new map must change decisions and pass its own collision/spawn/visibility/playthrough checks.

## Runtime choices

Use the existing imperative Three.js 0.186.1, Node 24, room API and appropriate Rapier 0.21.0 integration. No new engine or React migration is justified by this plan. Simulation owns outcomes; the scene is a view. Reuse identity, clock, instance/window guards, pending actions, input capabilities, readiness, disposal, reporting, kick/end/leave and Giggle Meet call mediation.

Golf contacts use a fixed simulation step with bounded catch-up, not the 10Hz snapshot rate. Bomb movement/blasts use a precise discrete authority model with smooth 3D presentation. Rocket repair actions use private projections and exact-once phase settlement. Introduce prediction only after measured latency proves it necessary, with reconciliation tests. Never run model construction, large allocations or texture decoding during the first attack.

Readiness includes critical resources, loaded physics state and an actual warmed render. A count-down must not begin over an empty world. Distinguish optional decorative paint from mandatory renderer readiness. Preparation failure must return to a usable room with a clear reason.

## Art and interaction

Cloud Links: saturated sunny course, coherent bevels/materials, 3D landscaping, real hills/ramps, patterned balls and a stable aim camera. Rocket Room: navy/coral/amber tangible repair instruments, animated ship consequences and readable private information. Bomb Garden: bright overhead arena, large recognisable character/bomb silhouettes, obvious cover and escape lanes. Each game has its own identity while room/report/navigation affordances remain consistent.

Use documented licensed asset candidates in REFERENCES.md and inspect individual models before approval. Use images for useful illustrations/icons/textures, not a complete gameplay scene with fake buttons pasted over it. Home/card illustrations remain appropriate. Reference games supply design principles; their proprietary levels/models/audio are not reused.

HUDs protect the centre and the active input area. Secondary scores/settings/help collapse. Show a controls hint once, then keep it available on request. Width adapts composition; capabilities and user preference choose input. Touchscreen laptops retain keyboard/mouse. The playfield contains touch movement while menus/drawers retain normal scrolling. Test phone keyboard-open states and compact Giggle Meet frames separately.

Sound supports actions: golf strike/contact/cup, bomb fuse/blast/chain, ship power/repair. Navigation stays quiet. No forced hum/loop unrelated to gameplay. Verify audio by listening, comfortable levels and voice ducking; automated sound-event counts do not approve quality.

## Current next deliverable

Muse completed two planning iterations in an isolated workspace, with first-minute sequences, rules, level plans, responsive HUD/control layouts, asset candidates and planned QA cases. Root and an independent reviewer assessed the drafts; DESIGN_SPEC.md records the corrected direction. Actual asset/layout previews and the user's design review remain the next gate. The next production task after design review is Cloud Links' single-hole slice. No completion date for the three shipped games is promised before that slice establishes its actual scope and performance.
