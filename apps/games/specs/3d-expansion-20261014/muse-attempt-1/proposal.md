# Three browser-3D games — design proposal (G0)

Date: 14 October 2026. State: design packet for parent review, **not** a ship
decision. No code was written, no browser QA was run, no assets were downloaded.
Every QA case in [qa-cases.json](qa-cases.json) is `PLANNED`. Parent chooses
product, visual direction and release status; a separate reviewer challenges
networking, fun and evidence quality. Nothing here approves its own follow-up
work: each gate below names the evidence that must exist before advancing.

Release context (wins over older copies): release 0.1.36 has 42 active games,
Castle removed, tower defence deferred. Source of truth for platform behaviour
is `context/RELEASE_REPORT.md`, `context/ARCHITECTURE.md`, `context/GAME_KIT_GUIDE.md`
and `context/GAME_UI_GUIDE.md` in this workspace.

How to read the sourcing tags used throughout:

- `[ref]` — taken from a supplied primary reference page (see §6).
- `[inf]` — inference from a reference or from platform behaviour, not observed.
- `[new]` — original design proposed in this packet.

Skills applied: `web-game-foundations` (sim/render split, DOM HUD, GLB-first),
`three-webgl-game` (plain Three.js on the pinned 0.186.1 vendor build, Rapier
only where contacts justify it, low-chrome first view), `web-3d-asset-pipeline`
(GLB shipping, collision proxies, critical-vs-optional manifests),
`game-ui-frontend` (one primary HUD cluster, playfield protection, DOM text UI),
`game-playtest` (screenshot-led review once a build exists). The Three.js
reference hub named in REFERENCES.md resolves to the same pinned vendor build
plus `guidance/references/threejs-stack.md` and `three-webgl-architecture.md`;
no new engine or framework is proposed.

## 1. Shared foundations (all three games)

**Stack [ref].** Plain Three.js 0.186.1 from `public/vendor/three/`, Node 24
authoritative WebSocket rooms, Vercel static + one Railway room process.
`manifest.layout: 'immersive'` with game-owned CSS under the view root; DOM
overlays for all text HUD, menus and dialogs; canvas/WebGL owns only the
playfield. No React/engine migration.

**Simulation boundary [new, constrained by brief].** Fixed server step 60 Hz
for golf ball integration, 20 Hz grid logic is sufficient for bombs (discrete
rules, no continuous physics), puzzle authority event-driven for repairs.
Bounded catch-up: at most 3 steps per 10 Hz broadcast tick, then authoritative
snap; client renders interpolated positions only and never judges rest, cup
entry, explosion outcome or repair success. Shared 10 Hz snapshots carry state;
clients interpolate between the last two snapshots with `api.now()` calibration.

**Countdown and readiness [ref].** Countdown starts after required assets,
physics and the first rendered frame; preload and warm effects so the first
shot/explosion does not freeze. Readiness expiry recovers to lobby with a
named reason, never overlapping countdown text. Offscreen clients skip the
decorative paint wait (release-36 Safari lesson) while keeping CSS, fonts,
decode, renderer-readiness and replay settlement mandatory.

**Layout states [ref].** Desktop, portrait phone, landscape phone, tablet and
compact Giggle embed are five distinct review states. Width controls layout,
not device identity; touch-capable laptops keep keyboard/mouse and touch
controls follow actual capability. Page movement locks only inside active play
gestures; drawers and menus scroll normally.

**Audio [ref].** Event-driven gameplay sounds only, comfortable level, stopped
on dispose, ducked around conversation. No homepage/navigation sounds.
Reduced-motion alternatives preserve all game information (blast danger,
aim direction, repair state) without flashing or shaking.

**Giggle Meet [ref].** Floating tiles beside golf/bomb playfields; call-central
placement for Rocket Room. Games never open a second microphone/camera capture
and never record. Text plus contextual pings must complete every game fully.

**Initial measurable targets (proposed, not observed).** Critical compressed
first-play payload ≤ 4 MB; usable cold playfield ≤ 5 s on 10 Mbps/100 ms with
visible loading throughout; desktop 60 FPS (p95 frame ≤ 20 ms); midrange phone
30 FPS (p95 ≤ 36 ms) plus 10-minute thermal play; local feedback ≤ 50 ms,
server acknowledgement timed separately. Network acceptance: nominal,
150/300 ms RTT with jitter, interrupted snapshots, 3 s disconnect. WebSocket
runs over ordered TCP; arbitrary packet reordering is not the test condition.

**Quality gates.** G0 reviewed spec/reference/asset plan (this packet). G1 two
people enjoy the central mechanic in one greybox. G2 one polished level with
real assets/camera/HUD/audio. G3 independent behaviour, native visual/input,
physical-device, network and human-fun acceptance. G4 exact-source candidate
with verified matching deployed bytes. Catalogue entry requires G4.

## 2. Game A — Cloud Links (build first, 2–8 players)

Social mini-golf with simultaneous putting. This packet explicitly supersedes
the 6 October sequential-shot proposal [new]: everyone putts at once against a
shared hole deadline, which removes turn waiting but requires readable rival
balls, fair moving hazards, crowd-free aiming and spectating for early
finishers.

**First minute [new].** Room lobby → 5 s hole intro (hole name, par,
one-line aim hint) → all balls visible on the tee pads, local ball ringed in
white. Player drags anywhere on the playfield: an aim arrow grows from the
ball, power reads on a meter pinned next to the ball, releasing putts.
A one-screen onboarding line explains the single non-obvious rule: *"Balls pass
through each other — lowest strokes wins."* First putt is rolling within
20 seconds of the hole opening for a first-time player (G1 human-gate check).

**Core actions [new].** Drag to aim and set power (one gesture), release to
putt; drag back to the ball or press Esc to cancel with no stroke charged.
Optional keyboard: arrows adjust aim, hold Space for power, Enter confirms.
Camera pan (right-drag / two-finger drag) and follow/reset button are separate
inputs that never alter aim; aiming locks the camera stable. After release the
camera follows the local interpolated ball; holed players may follow any
friend's ball (view-only). A rolling ball cannot accept a second shot —
input is rejected with a visible "ball rolling" state, not queued.

**Scoring, win, ties [new].** Lowest total strokes across the course wins;
equal totals share the rank (no tiebreak putt in this slice). Stroke cap 8
per hole; hitting the cap or the shared hole deadline records cap+1 and moves
the ball to spectate. Out-of-bounds resets to the last rest position +1
stroke. Zero-stroke and all-tied results are legal final states with their own
results copy ("Nobody needed a second shot" / "A three-way tie").

**Rest and cup authority (proposal for server, renderer never decides) [new].**
Rest = speed below 0.35 m/s for 0.5 s continuously on a 60 Hz fixed step.
Cup entry requires contact speed below 4.5 m/s with the cup centre within the
capture radius; faster contact lips out (visible rim bounce, ball stays live).
These numbers are starting values for the G1 greybox, not tuned constants.

**Roster [new].** 2–8 active seats; seats beyond 8 are watchers. At 7–8 the tee
pads stagger in two rows and rival-ball labels shrink to pattern chips so aim
stays readable. Mid-game joiners spectate until the next hole.

**Initial level: "Banker's Garden", par 3 [new].** One hole, one ramped bank
board along the left wall producing genuine 3D roll and rebound (the brief's
mandatory contoured surface). Safe route: straight two-putt up the middle.
Risky route: one-shot bank off the left board past a sandlip; missing long
leaves a downhill return. Geometry is fixed; no ball-to-ball collision; one
slow rotating sweeper arm is decorative only in this slice (it never touches
balls — fairness before spectacle). The later three-hole release may add a
shared-phase windmill and a downhill funnel, authored only after this slice
is enjoyable.

**Camera and controls [new].** Orbit-follow hybrid: tee overview at hole
start, smooth follow of the local ball after release, free pan gated to
non-aiming moments, one-tap reset to ball. Touch: single drag aims; camera
uses a separate two-finger or edge-pan gesture so aiming never fights the
camera. Inverse-power and cancel-on-release-outside-arena are specified, not
assumed.

**HUD [new].** Desktop: top-left chip (Hole 1/1 · Par 3 · your strokes),
top-right compact standings (collapsed to top 3 + you), one small deadline
bar under the top edge, power meter floating by the ball only while aiming.
Portrait phone: strokes chip top-left, deadline as a 3 px line, standings
behind a Room-style disclosure. Embed: strokes + deadline only; standings via
Why?-style disclosure below the playfield. Playfield centre stays clear.

**Asset shopping list [ref + new].** Kenney Minigolf Kit (verified 14 Oct:
CC0, 125 files) — select only: 2 straight turf tiles, 1 corner, 1 bank-board
wall piece, 1 ramp wedge, 1 flag + cup set, 1 sweeper-arm decoration, border
edging. Per-file format/dimensions/materials still to inspect at G1 (gap, see
status). Balls: original patterned-ring designs (stripes, dots, chevrons in
player colour) so identity survives colour-blindness; palette pass to emerald
turf, turquoise edges, warm-yellow flags, coral accents, matte balls, soft
contact shadows, consistent bevels. Critical manifest: tiles, walls, cup,
local-ball model. Optional: surrounding landscaping dressing (streams in
after first frame).

**Why it should be fun in minute one [new].** Everyone is always doing
something (no turn queue), the bank shot is visible from the tee so the risky
idea forms before the first putt, and near misses are social because rival
balls are visible but never physically in your way.

**At most two refinements [new].** (1) Rival-ball trails: 1.5 s fading path
ribbons so friends' shots read at a glance without clutter. (2) Early-finisher
"coach mode": holed players get a zoom-to-friend picker; explicitly no hints
or aim assistance, spectating only.

**Risk experiment (G1 exit) [new].** Two first-time players, one bank-shot
hole, greybox art: both hole out within the deadline without coaching, both
can describe why their missed bank failed, and both voluntarily rematch. If
either cannot aim without moving the camera, the input boundary fails G1.

## 3. Game B — Rocket Room (second, 2–6 players)

Cooperative ship repair where talking is the mechanic. Pilot sees the 3D
module; engineer(s) hold the constraints; neither screen solves anything
alone. No new microphone/camera capture, no recording; text and contextual
pings complete the same mission [new].

**First minute [new].** Crew assembles in a dock view of the little ship with
role cards dealt face-down. Untimed teaching attempt opens: the pilot sees the
"Crossover Box" with five terminals, the engineer sees the legend. The pair
must complete one guided connection with hints on before the timed rescue
unlocks. A first-time crew finishes the teaching attempt within 6 minutes
without designer coaching (G1 human gate).

**Initial module: "Crossover Box" (original) [new].** Pilot's panel shows five
terminals labelled with shapes (triangle, wave, cross, ring, fork) each
flashing one of three pulse rhythms; pilot can toggle breakers but has no
wiring map. Engineer's sheet shows which shape pairs may link and a route
constraint ("ring may not share a bus with fork") but not the live rhythms.
The crew must agree three legal links; each correct link visibly restores a
ship system (lights → pumps → engine glow). Shapes always pair with text
labels; colour is never the only channel. Symbols, procedures and art are
original — Spaceteam [ref] supplies only the pressure pattern, and this slice
is deliberately calm, not shouting.

**Roster-to-responsibility [new].**

| Crew | Pilot | Engineers | Ownership rule |
|---|---|---|---|
| 2 | 1 (acts + interprets) | 1 (legend + acts on own breaker pair) | Both interpret and act |
| 3 | 1 | 2 (links / constraints split) | Each engineer owns one clue family |
| 4 | 1 | 3 (links, constraints, power budget) | Budget owner approves third link |
| 5–6 | 1 + co-pilot (reads rhythms aloud, no breakers) | 3–4, one clue each | Co-pilot has no secret text; 6-player version must be demonstrated before content expansion |

**Failure, recovery, fairness [new].** Wrong breaker: forgiving buzz, the
link flashes amber, no score damage, hint counter offers one bounded hint
("two of your three links share a bus") after two failures. Explicit loss:
timed rescue expires with systems dark → "Ship cold. Retry?" with role
rotation offered every mission. Disconnect of a clue owner: server re-deals
that clue family to a connected owner within one snapshot, announced as
"Rerouted: links sheet now with Ann"; private sheets never appear in
spectator, report or public projections (`view()` split per seat). Reconnect
by seat token restores the private sheet.

**Camera, controls, HUD [new].** Fixed inspectable 3D station: orbit around
the repair module only, no free-roam FPS. Repair controls are real
interactive components (breaker toggles, link cables), never a picture of a
dashboard. Keyboard keeps the current clue/control focused; phone layouts keep
clue visible while the send button stays reachable. HUD: mission progress
(3-system meter) + remaining time only; active instrument bottom-edge;
communication panel (text + ping palette: "confirm / deny / try rhythm 2 /
need legend") collapsible at the side. Voice-panel placement differs from
golf: the call sits adjacent, since the call is central.

**Visual direction [new].** Saturated midnight-blue hull, coral panels, amber
power traces, mint success pulses, legible light labels, compact tangible
instruments. Licensed space props dress the scene; repair interfaces are
original geometry.

**Asset shopping list [ref + new].** Kenney Space Kit (verified 14 Oct: CC0,
150 files) — select only: small hull sections, 1 antenna, interior panel
props, crate/cable dressing. Repair station, breakers, terminals and symbols
are original authored meshes (no kit dependency for anything the player
touches). Critical manifest: station + terminal geometry; optional: exterior
ship dressing.

**At most two refinements [new].** (1) Rhythm tap-along: pilot can tap a
button to echo a rhythm as text ("short-short-long") into the shared log for
the engineer. (2) Ping palette per module: three module-specific pings so
silent crews stay at parity with voice crews.

**Risk experiment (G1 exit) [new].** Two first-time players, text-only (voice
muted), complete the teaching attempt. If they solve it by one player reading
both screens aloud from a single screenshot, the information split has failed
and the module must be re-authored, not patched with more rules.

## 4. Game C — Bomb Garden (third, 2–8 players)

Short arena rounds: move, plant timed bombs, clear cover, escape predictable
chains. Overhead camera keeps every dangerous route visible; explosions are
never hidden by scenery. One readable arena, one bomb type, no progression or
pickup catalogue [new].

**First minute [new].** Spawns in corners/edges with two free tiles of escape
space each. One-time hint: "Bombs tick, then bloom in four arms. Don't stand
in the glowing line." First round starts within 15 s of arena reveal; the
first bomb a player plants shows its full fuse + arm preview so the lesson is
free. Round target 45 s, best of 3, survivor takes the round.

**Deterministic rules (server owns all) [new].** Grid occupancy authoritative;
characters animate smoothly between cells but logic is discrete — Rapier is
not applied to bomb rules. Fuse 2.5 s from plant. Blast arms extend up to 3
cells orthogonally, blocked by walls, stopped (not passed through) by cover
which is then destroyed. Chains resolve in plant order; a bomb caught in a
blast detonates immediately with its own arms. Simultaneous final deaths draw
the round. Planted-bomb cells stay walkable for the planter until they leave
the cell (re-entry forbidden afterwards); this rule is shown once in the
hint, not discovered by death. Disconnect: the avatar freezes as a harmless
ghost (no body-blocking, no bomb absorption) and the seat resumes by token.
Safe spawns guaranteed: generation rejects any seed without a 2-tile escape
path before the first plant; no random seed may create unavoidable death.
Results wait for the last explosion's visual settle before the verdict shows.
Dead players follow friends and ready up for the next round without affecting
survival outcomes. Eliminated-player waiting is measured; if it frequently
exceeds 30 s or humans stop rematching, the mode is revised before release —
no silent ghost mechanic is added.

**Local vs authoritative input [new].** Movement shows immediate local
acknowledgement (step preview) marked provisional until the server confirms;
bomb plants show "placing…" until authoritative accept/reject. A rejected
plant (cell occupied, cooldown) snaps back with a reason. The client never
renders an escape the server will reverse into death: provisional positions
are drawn distinctly from confirmed ones.

**Camera, controls, HUD [new].** Fixed overhead-tilt camera, no rotation
during play. Keyboard (arrows/WASD + Space) and touch (stick or tap-step +
plant button) both work through blocked UI, multi-touch (move + plant
together), cancellation on blur, and modal dismissal. Minimal HUD:
lives/round score top-left, one round timer, fuse/danger as in-world cues
(glowing arms, wick burn), one-time controls hint only.

**Visual direction [new].** Bright landscaped arena, cobalt walls, lime
ground, tangerine bomb glow and fuse, animated mascot characters with
readable outlines. The bomb is a proper modelled silhouette with a wick, not
an orb. No screen-filling bloom or boxed HTML board.

**Asset shopping list [ref + new].** Kenney Platformer Kit (verified 14 Oct:
CC0, 150 files, animated characters) — select only: 2–3 mascot rigs with
walk/celebrate clips, ground/wall block set. Bomb, wick, fuse FX and blast
arms are original authored meshes. Critical manifest: 1 character rig,
wall/ground tiles, bomb model; optional: decorative flora. Per-file
rigs/pivots/byte costs still to inspect (gap, see status). Movement-fun
check precedes art polish: if grid stepping feels bad in greybox, no art is
commissioned.

**At most two refinements [new].** (1) Arm-preview toggle: holding plant
shows arms before committing (default on for round 1, then collapses to the
hint). (2) Rematch-first results: results screen leads with Rematch, then
scores — optimised for the measured rematch rate.

**Risk experiment (G1 exit) [new].** Four players, greybox boxes, one arena:
every death is unanimously described as "my fault" in the post-round ask,
and no player reports a rendered escape reversed into death. Any disputed
death fails G1 for the input-presentation contract, not for balance.

## 5. Cross-game recovery and edge coverage

Normal join/setup/play/results/rematch/change/end/leave, late watcher,
reconnect, host migration, kick, stale/duplicate input, old timers,
focus/blur/modal, hidden/offscreen readiness, pending/rejected sends,
ties/zero-scores, viewport/orientation/safe-area/keyboard, media panel,
context loss and asset failure are covered per game in [qa-cases.json](qa-cases.json).
Shared platform behaviour (seat tokens, host migration, instance/window
guards, calibrated clock) is inherited from ARCHITECTURE.md and not
re-specified here.

## 6. Reference / inference / original-design ledger

| Element | Source | Standing |
|---|---|---|
| Simultaneous putting, no ball collision, patterned ball identity, deadline + recap | ROOT_BRIEF §A | Requirement, followed exactly |
| Bank-shot teaching hole; windmill/funnel deferred until slice is fun | ROOT_BRIEF §A | Requirement, followed exactly |
| Rest/cup server authority, Rapier for golf contacts, 60 Hz-class sim | ROOT_BRIEF §A + common architecture | Requirement; thresholds are [new] starting values |
| Golf Party aim gesture / score flow; Golf With Your Friends silhouettes | REFERENCES.md | [ref] principles only; no hands-on play claimed, no level/model copying |
| Kenney Minigolf Kit CC0, 125 files; Space Kit CC0, 150 files; Platformer Kit CC0, 150 files, animated | kenney.nl pages, fetched 14 Oct 2026 | [ref] verified at page level; per-file contents uninspected (gap) |
| Repair information split, text/ping parity, role rotation, 6-player proof | ROOT_BRIEF §B | Requirement, followed exactly |
| Spaceteam communication pressure; calm teaching module instead of shouting | REFERENCES.md + [new] | [ref] pattern; calm-first structure is [new] |
| Bombergrounds readability/anticipation; 45 s best-of-3, chain/disconnect rules | REFERENCES.md + ROOT_BRIEF §C | [ref] readability only; rules are [new] per brief |
| Smash Karts palette/camera hierarchy; Marble Blast fixed-step/loading/input discipline | REFERENCES.md | [ref] principles; Marble Blast custom renderer is explicitly not a rewrite mandate |
| Three.js docs, Rapier determinism conditions (identical state/version/order/inputs; not a network protocol) | REFERENCES.md engineering sources | [ref]; discrete bomb logic follows from the Rapier caveat |
| Rocket Room module puzzles, all three arenas/holes, HUD copy, timers, thresholds | This packet | [new] original design, no proprietary copying |
| Oct 6 sequential-shot golf and Parcel Panic co-op-carry (older-game-ideas.md) | context/older-game-ideas.md | Superseded by current brief; Parcel Panic not in scope |

No gameplay reference was played hands-on in this task; no reference art,
model, sound or text is copied. Statements about what references teach are
[inf] design inferences.

## 7. Open questions for parent and reviewer

1. Rest/cup numbers (§2) are untested starting values — accept as G1
   greybox inputs, or set different ones before the prototype?
2. Bomb Garden arm-preview default-on in round 1 teaches openly but shows
   information a skilled player would hide — keep, or make it a room setting?
3. Rocket Room co-pilot at 5–6 has no secret text and may feel thin — accept
   for the first demonstration, or cut 5–6 support until a second module exists?
4. Kit landing pages confirm CC0 and file counts only; per-file GLB/pivot/rig
   inspection is deferred to G1 — acceptable, or fetch the packs now (no code,
   just inspection)?
5. GPT reviewer: simultaneous-golf fairness under 300 ms jitter (whose putt
   "happened first" near a shared deadline) and bomb-chain ordering under
   reconnect are specified server-side but unproven — flag anything
   under-specified before G1.
