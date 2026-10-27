# Three browser-3D games — design proposal (G0)

Date: 14 October 2026. State: design packet for parent review, **not** a ship
decision. No code was written, no browser QA was run, no assets were downloaded.
Every QA case in [qa-cases.json](qa-cases.json) is `PLANNED`. Parent chooses
product, visual direction and release status; a separate reviewer challenges
networking, fun and evidence quality. Nothing here approves its own follow-up
work: each gate below names the evidence that must exist before advancing.

Release context (wins over older copies): release 0.1.36 has 42 active games,
Castle removed, tower defence deferred. Source of truth for platform behaviour
is `../../RELEASE_REPORT.md`, `../../ARCHITECTURE.md`, `../../GAME_KIT_GUIDE.md`
and `../../GAME_UI_GUIDE.md` in this workspace.

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

**Simulation boundary [new, constrained by brief, corrected per review].**
Each game proposes its own `def.tickInterval(state)` on the existing Room
heartbeat (kart precedent: 50 ms): 50 ms for golf and bombs, event-driven
puzzle authority for repairs. Golf integrates ball physics inside the tick on
a 1/60 s accumulator — normally 3 steps per 50 ms tick. Bounded catch-up may
exceed nominal work up to a 12-step maximum; remaining debt is retained, and
an explicit excessive-lag/interruption policy names the outcome (a stated
interruption reason, never a silent time-drop followed by a positional snap).
The 10 Hz snapshot projection stays separate from simulation: clients render
interpolated positions only and never judge rest, cup entry, explosion outcome
or repair success. Simulated-time versus elapsed-time is a G1 test at nominal
and late ticks. Exact step tuning remains G1; no new timer helper API is
invented — games use the existing `onTick` / `ctx.later` / generation-guard
surface only.

**Non-idempotent intents [new, corrected per review].** The Room provides
instance/window guards, not generic action-ID dedup or ACK. Each game owns a
bounded per-player action sequence with its result echoed in that player's
private projection: every shot, plant and repair-toggle intent carries the
next sequence number, validated inside the game; the same sequence can never
reapply an effect, and sequences reset with each new instance. Clients await
the actual sequence/result/state — never an arbitrary broadcast or a sleep.
Genuinely idempotent operations (camera follow target, ready flag) use the
simpler last-write rule instead.

**Countdown and readiness [ref].** Countdown starts after required assets,
physics and the first rendered frame; preload and warm effects so the first
shot/explosion does not freeze. Readiness expiry recovers to lobby with a
named reason, never overlapping countdown text. Offscreen clients skip the
decorative paint wait (release-36 Safari lesson) while keeping CSS, fonts,
decode, renderer-readiness and replay settlement mandatory. Background and
offscreen states are four distinct things — skipped decorative paint, loaded
critical resources, actual renderer warm-up, fully suspended browser — and
the slice never claims frozen JavaScript keeps running.

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

**Quality gates.** G0 spec/reference/asset plan for root/user design review (this packet); not completed visual approval. G1 two
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

**Scoring, win, ties [new, corrected per review].** Lowest total strokes
across the course wins; equal totals share the rank (no tiebreak putt in this
slice). Stroke cap 8 per hole, and the eighth putt always finishes: a ball
that holes out on stroke 8 records 8; a ball still unholed when it
settles or resets after stroke 8 records cap + 1 (9) and spectates.
Out-of-bounds adds one penalty within the same stroke budget. If a settled/reset unholed ball reaches score8 (for example stroke7 plus an out-of-bounds penalty), it caps at9 without permitting another shot. An eighth accepted shot still resolves normally and records8 if holed; capped scores clamp to9. Otherwise reset to the last safe rest position. The shared hole
deadline closes new-shot acceptance using authoritative receipt time; balls
already rolling at the deadline get a bounded 4 s resolution grace shown as
"Finishing shots…" (not a second overlapping timer), after which remaining
unholed balls settle to the cap penalty. Same-step precedence: a cup capture
processed in the same simulation step as the deadline counts as holed. The
hole ends early, with a named goal reason, once every roster ball has settled
holed or capped.

**Rest and cup authority (proposal for server, renderer never decides) [new,
corrected per review].** Rest is a tunable G1 criterion, not a fixed number:
supported contact plus low linear velocity, low angular velocity and stable
positional drift over a hold window, each expressed relative to final model
units and ball radius — and proven against a sloped-ball fixture (a visibly
creeping ball must never read as ready). No untested velocity number becomes
release fact. Cup capture needs concrete geometry/contact/sweep semantics in
the final model scale (capture volume, contact arc, per-step sweep so fast
balls cannot tunnel through the cup); a centre-speed predicate alone is not
the contract. A ball faster than the tuned capture envelope lips out with a
visible rim bounce and stays live.

**Roster [new, corrected per review].** 2–8 active seats; seats beyond 8 are
watchers. At 7–8 the tee pads stagger in two rows and rival-ball labels
shrink to pattern chips so aim stays readable. The active roster is fixed for
the match: mid-match joiners stay spectators until the next start (new
instance), not the next hole.

**Initial level: "Banker's Garden", par 2 [new, root-normalized].**
One complete hole with a real ramped bank/contoured surface, a safe two-shot
route and a possible one-shot risky bank. Missing long leaves a recoverable
return. Fixed geometry and no ball-to-ball collision in the slice. Remove the
non-colliding decorative sweeper: anything presented as an obstacle must have
matching collision. The later windmill and downhill funnel are separate
mechanical holes, authored after this slice passes human and contact review.

**Camera and controls [new].** Orbit-follow hybrid: tee overview at hole
start, smooth follow of the local ball after release, free pan gated to
non-aiming moments, one-tap reset to ball. Touch: single drag aims; camera
uses a separate two-finger or edge-pan gesture so aiming never fights the
camera. Inverse-power and cancel-on-release-outside-arena are specified, not
assumed.

**HUD [new].** Desktop: top-left chip (Hole 1/1 · Par 2 · your strokes),
top-right compact standings (collapsed to top 3 + you), one small deadline
bar under the top edge, power meter floating by the ball only while aiming.
Portrait phone: strokes chip top-left, deadline as a 3 px line, standings
behind a Room-style disclosure. Embed: strokes + deadline only; standings via
compact Scores disclosure below the playfield. Playfield centre stays clear.

**Asset shopping list [ref + new].** Kenney Minigolf Kit (verified 14 Oct:
CC0, 125 files) — select only: 2 straight turf tiles, 1 corner, 1 bank-board
wall piece, 1 ramp wedge, 1 flag + cup set,  border
edging. Per-file format/dimensions/materials still to inspect at G1 (gap, see
coordination.json). Balls: original patterned-ring designs (stripes, dots, chevrons in
player colour) so identity survives colour-blindness; palette pass to emerald
turf, turquoise edges, warm-yellow flags, coral accents, matte balls, soft
contact shadows, consistent bevels. Critical manifest: tiles, walls, cup,
local-ball model. Optional: surrounding landscaping dressing (streams in
after first frame).

**Why it should be fun in minute one [new].** Simultaneous aiming reduces turn queues; rest/early-finisher waiting still needs measurement, the bank shot is visible from the tee so the risky
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

**Initial module: "Crossover Box" (original) [new, corrected per review].**
Five terminals (triangle, wave, cross, ring, fork — shape plus text label,
never colour alone), each flashing one of three pulse rhythms, wired across
three buses (Bus A/B/C). The crew must complete three legal links restoring
the ship systems in the seed-specific startup order known to the Order role.
Public visuals show actual restored systems, not the whole secret order. Success predicate: a link counts
only when it carries a certified rhythm, an approved compatible route, a
within-budget power feed, a non-isolated bus, and the currently declared
target system.

**Six responsibility atoms [new, corrected per review].** Every atom pairs
useful private information with a necessary control or decision — nobody owns
a clue fragment without an action:

1. **Wiring** — private: terminal/bay layout map. Control: places and moves
   link cables. First-minute action: seat the first cable.
2. **Signal** — private: rhythm legend (flash pattern → rhythm name). Decision:
   certifies a terminal's live rhythm; uncertified links never count.
   First-minute action: certify the first terminal.
3. **Routing** — private: shape-pair compatibility matrix plus one bus
   exclusion ("ring may not share a bus with fork"). Decision: approves or
   rejects each proposed route. First-minute action: rule on the first
   proposal.
4. **Power** — private: per-bus load table and budget. Control: sets the
   regulator feed per bus; over-budget links fail safely. First-minute
   action: set the first feed.
5. **Safety** — private: per-bus fault lamp. Control: isolates and reconnects
   a bus; an isolated bus carries no link until cleared. First-minute action:
   run the isolation check and report the bus state.
6. **Order** — private: a seed-specific startup order and dependency constraint.
   Decision: selects the legal next system from the private dependency constraint;
   a premature system does not count. The task must require information, not approval of a publicly known order. First-minute action: declare the first target.

**Roster-to-atom bundling [new, corrected per review].**

| Crew | Bundle | Rule |
|---|---|---|
| 2 | Pilot: wiring + signal + order; Engineer: routing + power + safety | Both interpret and act; each bundle keeps one placement, one approval and one state control |
| 3 | Three pairs: (wiring + signal), (routing + power), (safety + order) | Each player owns two atoms end to end |
| 4–5 | Combine useful groups, never fragments: e.g. 4 keeps (wiring + signal), (routing), (power + safety), (order); 5th splits power/safety | Combined atoms stay operable by one player in the first minute |
| 6 | One atom each | Full 6-player version must be demonstrated before content expansion |

**Guaranteed-solvable seeds [new].** The generator builds the solution first:
pick a valid private startup order/dependency, choose three compatible shape pairs
on buses honouring the exclusion, assign rhythms, set loads inside budget with
exactly one safely clearable faulty bus, then deal consistent clue sheets.
The source must validate the witness solution independently in G1; this text
is a proposed construction, not proof of an implemented generator. Every dealt
mission is solvable by construction; solvability is a generator property, not
a playtest hope.

**Failure, recovery, fairness [new, corrected per review].** Wrong breaker:
forgiving buzz, the link flashes amber, no score damage, one bounded hint
("two of your three links share a bus") offered after two failures. Explicit
loss: timed rescue expires with systems dark → "Ship cold. Retry?" with role
rotation offered every mission. Role reassignment is atomic with a role
version: a transferred role stays with its new owner until an explicit safe
reassignment boundary (between attempts, never mid-link); cancel any pending proposal owned by a transferring role before atomic reassignment; a reconnecting
player receives their *current* assigned responsibilities and cannot restore
an old control in parallel; actions from the old owner or an old version are
rejected. Approvals/certifications carry the candidate link revision; changing
cable, rhythm, route, feed, bus or target invalidates affected certifications,
so an old approval cannot silently authorize altered state. When fewer than 2players remain connected, pause the mission, block repair input,
save its remaining duration and give the crew a cumulative20-second reunion
budget per attempt. Rejoining within that budget resumes with an updated
authoritative deadline and current role assignments. Exhausting it produces
a named interrupted attempt with Retry, not a success or a solo-finish claim — private sheets never leak into
spectator, report or public projections (`view()` split per seat), and the
slice never pretends a solo crew can finish the designed co-op module.

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

**Risk experiment (G1 exit) [new, corrected per review].** Two first-time
players, text-only (voice muted), complete the teaching attempt. Pass needs
all of: each screen's information proves useful and complementary, each role's
distinct controls prove necessary (log shows no single-seat solve path),
seeds dealt are solvable, the transcript shows observed communication, both
players stay engaged, and text/ping parity holds. Sharing a screenshot or
reading both clue sheets aloud is legitimate cooperation, never an automatic
failure — and no message-per-link rate is asserted.

## 4. Game C — Bomb Garden (third, 2–8 players)

Short arena rounds: move, plant timed bombs, clear cover, escape predictable
chains. Overhead camera keeps every dangerous route visible; explosions are
never hidden by scenery. One readable arena, one bomb type, no progression or
pickup catalogue [new].

**First minute [new].** Validated spawns in corners/edges (see runtime
validation below). One-time hint: "Bombs tick, then bloom in four arms. Don't
stand in the glowing line." First round starts within 15 s of arena reveal;
the first bomb a player plants shows its full fuse + arm preview so the
lesson is free.

**Match format [new, root-normalized].** Exactly three rounds, each with a
45-second maximum and possible early survivor completion after the full
hazard/chain batch settles. Most round wins takes the match; equal totals
share rank. Multiple or zero survivors at deadline draw; there is no arbitrary
winner or sudden death. Due detonations and active hazards at the deadline
resolve before the verdict. Once terminal, remaining blast motion is visual
settlement only. The between-round connected-roster policy is stated below.

**Deterministic rules (server owns all) [new, root-normalized].**
50 ms authority tick, proposed 200 ms minimum between cardinal cell moves. A
legal move commits the logical destination cell when accepted; the visual
avatar eases there over that interval. Blast vulnerability uses the committed
logical cell, whose presentation/correction must be understandable in G1.
Characters may overlap/pass through each other and do not reserve or block
cells. Walls, cover and planted bombs block entering a destination. Move
intents resolve before plant intents in a step; a plant uses the actor's
committed cell. One live bomb per player, proposed 2.5-second fuse, three-cell
orthogonal reach and one-second post-detonation cooldown. Per-player action
sequence deduplicates intents; a separate unique monotonically increasing
server bomb ID orders bombs across players.

For each authority step, collect all due bombs, recursively expand every bomb
triggered by their rays using ONE immutable start-step wall/cover snapshot,
and union their affected cells. Each bomb expands once in stable server-ID
order. Solid walls block; cover stops a ray and joins the destruction set.
Commit the complete batch's cover destruction and deaths once, after closure;
no chained ray sees cover already removed by another ray from the same batch.
Lingering flame hazards last a proposed0.5 seconds during active play. At round
expiry, apply still-active hazards and the full batch of detonations due by the
deadline (including recursive chains) before choosing survivor/draw. Reject
later input and bombs whose fuse lies after the deadline. Once a terminal
verdict is fixed, lingering flames/remaining cascade presentation are visual
settlement only and cannot cause another death. Early survivor wins similarly
require the complete current batch/hazard step before deciding. Reveal results
only after corresponding visible FX settle; a hidden client settles quietly.

The planter may leave its newly planted bomb's cell, but cannot re-enter that
cell while the bomb remains. Disconnect cancels held/new intents, keeps the
avatar vulnerable and retained bombs ticking; reconnect resumes actual
alive/eliminated state. A GAME-OWNED proposed 10-second continuous-away timer
forfeits an absent player's round eligibility; it does not delete room identity
or revoke a resume token. A returning forfeited player watches the rest of that
round and can rejoin a later round if connected at its start. A player away at
the verdict cannot take a survivor win. Do not assume a per-seat Room grace
expiry: the existing room cleanup applies to wholly empty rooms. When no one
is connected for10 seconds, interrupt the match with no winner; reconnect may
return to that explicit interrupted state before normal room cleanup. Dead
players follow friends and ready for the next round without altering survival.

Match format: exactly three rounds, each with a45second maximum and possible
early survivor completion. At deadline, more than one survivor draws; zero
survivors draws; one eligible connected survivor wins. Most round wins takes
the match; equal totals share rank. No endless sudden death. Measure
eliminated-player waiting; frequent waits beyond30seconds or loss of voluntary
rematches requires revising the mode before expansion.

**Runtime spawn validation [new, corrected per review].** Generation must
prove, per spawn, a reachable safe destination outside the projected 3-cell
blast using actual movement speed, obstacles, turn/plant occupancy and fuse
time; layouts failing validation are rejected before play. Two free tiles is
a sketch, not a proof. A finite seed sweep is reported as sample coverage,
never as proof over every seed.

**Local vs authoritative input [new, corrected per review].** One readable
avatar per player — no duplicate "predicted twin". Local steps render as
bounded prediction: visually distinct from confirmed state, with consistent
presentation time for remote actors and hazards, clear rejection feedback
(plant refused names the reason; a corrected step shows where authority
moved you), and replayable disputed outcomes. The contract is measured, not
promised: correction frequency and distance are logged, and normal-latency
runs must not produce misleading deaths. Interpolation uses a defined delay
buffer with bounded extrapolation and a stated stale-state policy. A client
missing snapshots on an open socket is a presentation gap, not a transport
disconnect — it never invokes the shell's reconnect state by itself.

**Camera, controls, HUD [new].** Fixed overhead-tilt camera, no rotation
during play. Keyboard (arrows/WASD + Space) and touch (stick or tap-step +
plant button) both support multi-touch (move + plant
together); blocked UI/modals capture input without moving or planting, and blur/rotation cancel held gestures. Minimal HUD:
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
rigs/pivots/byte costs still to inspect (gap, see coordination.json). Movement-fun
check precedes art polish: if grid stepping feels bad in greybox, no art is
commissioned.

**At most two refinements [new].** (1) Arm-preview toggle: holding plant
shows arms before committing (default on for round 1, then collapses to the
hint). (2) Rematch-first results: results screen leads with Rematch, then
scores — optimised for the measured rematch rate.

**Risk experiment (G1 exit) [new, corrected per review].** Four players,
greybox boxes, one arena. Collect misunderstandings, disputed deaths,
observed fairness and waiting, and voluntary rematches. An unexplained
replay/UI-authority disagreement blocks advancement; ordinary competitive
disappointment is not evidence of a code defect — unanimous "my fault" is
not required.

## 5. Cross-game recovery and edge coverage

Normal join/setup/play/results/rematch/change/end/leave, late watcher,
reconnect, host migration, kick, stale/duplicate input, old timers,
focus/blur/modal, hidden/offscreen readiness, pending/rejected sends,
ties/zero-scores, viewport/orientation/safe-area/keyboard, media panel,
context loss and asset failure are covered per game in [qa-cases.json](qa-cases.json).
Shared platform behaviour (seat tokens, host migration, instance/window
guards, calibrated clock) is inherited from ARCHITECTURE.md and not
re-specified here — and the first slices preserve it unchanged:

- Host End returns the room to lobby, never to results; only natural game
  completion returns results.
- Socket disconnect and ordinary leave promise no immediate seat deletion;
  resume-token, grace and linger behaviour applies, and a refreshed client
  reclaims by token while same-name joins take a suffix.
- Kicking an active player currently ends non-kart games back to lobby;
  kicking a watcher need not. A removed token can never reclaim the kicked
  seat. Active-kick and watcher-kick are tested separately.
- Context recovery never duplicates input or outcomes, but authority may
  legitimately advance and score while a renderer is unavailable — unchanged
  score throughout context loss is not promised.

## 6. Reference / inference / original-design ledger

| Element | Source | Standing |
|---|---|---|
| Simultaneous putting, no ball collision, patterned ball identity, deadline + recap | ROOT_BRIEF §A | Requirement, followed exactly |
| Bank-shot teaching hole; windmill/funnel deferred until slice is fun | ROOT_BRIEF §A | Requirement, followed exactly |
| Rest/cup server authority, Rapier for golf contacts, decoupled sim tick | Review corrections (supersede brief) + common architecture | 50 ms tick, 1/60 s accumulator, 12-step cap, retained debt; rest/cup are G1 criteria, no fixed numbers |
| Non-idempotent intents carry game-owned per-player sequences | Review corrections (supersede brief) | [new]; no common Room ACK invented |
| Host End → lobby; roster fixed; kick/disconnect framework preserved | Review corrections + ARCHITECTURE.md | Framework behaviour, unchanged by slices |
| Eighth putt finishes; deadline + 4 s grace; same-step cup precedence; early settle | Review corrections (supersede brief) | [new] reviewed design, not observed |
| Golf Party aim gesture / score flow; Golf With Your Friends silhouettes | REFERENCES.md | [ref] principles only; no hands-on play claimed, no level/model copying |
| Kenney Minigolf Kit CC0, 125 files; Space Kit CC0, 150 files; Platformer Kit CC0, 150 files, animated | kenney.nl pages, fetched 14 Oct 2026 | [ref] verified at page level; per-file contents uninspected (gap) |
| Six responsibility atoms, bundling table, solvable seeds, versioned roles | Review corrections (supersede brief) | [new]; co-pilot-without-action removed |
| Spaceteam communication pressure; calm teaching module instead of shouting | REFERENCES.md + [new] | [ref] pattern; calm-first structure is [new]; screenshot-sharing is legitimate cooperation |
| Bombergrounds readability/anticipation | REFERENCES.md | [ref] readability only |
| Three rounds of at most 45 seconds, draws, complete-batch blasts, vulnerable disconnect and validated spawns | Review corrections (supersede brief) | [new] reviewed design; best-of-3 sudden-death and ghost framings removed |
| Smash Karts palette/camera hierarchy; Marble Blast fixed-step/loading/input discipline | REFERENCES.md | [ref] principles; Marble Blast custom renderer is explicitly not a rewrite mandate |
| Three.js docs, Rapier determinism conditions (identical state/version/order/inputs; not a network protocol) | REFERENCES.md engineering sources | [ref]; discrete bomb logic follows from the Rapier caveat |
| Rocket Room module puzzles, all three arenas/holes, HUD copy, timers, thresholds | This packet | [new] original design, no proprietary copying |
| Oct 6 sequential-shot golf and Parcel Panic co-op-carry (older-game-ideas.md) | ../NEXT_GAME_IDEAS_20261006.md | Superseded by current brief; Parcel Panic not in scope |

No gameplay reference was played hands-on in this task; no reference art,
model, sound or text is copied. Statements about what references teach are
[inf] design inferences.

## 7. Open questions for parent and reviewer

1. Rest/cup criteria (§2) name the signals but no numbers — accept as G1
   greybox inputs, or instrument the greybox to propose numbers first?
2. Bomb Garden arm-preview default-on in round 1 teaches openly but shows
   information a skilled player would hide — keep, or make it a room setting?
3. Rocket Room 4–5 bundling combines atoms one way in §3 — accept that
   grouping, or prefer a different pairing for the first demonstration?
4. Kit landing pages confirm CC0 and file counts only; per-file GLB/pivot/rig
   inspection is deferred to G1 — acceptable, or fetch the packs now (no code,
   just inspection)?
5. GPT reviewer: receipt-time deadline fairness under 300 ms jitter and the
   two-phase blast batch under reconnect are specified server-side but
   unproven — flag anything under-specified before G1.



## Root normalization — binding precedence

This final spec incorporates the independent revision2 review. It takes
precedence over the preserved Muse attempts and older brief where they differ.
Golf and Bomb may continue bounded authority with one connected player; they
do not inherit Rocket's low-roster pause. Golf uses the existing hole deadline
and cap for away balls; ten seconds with zero connected players interrupts
without a winner. Room tokens/roster/empty-room cleanup remain separate.

Initial remote presentation uses a proposed100ms server-time buffer, bounded
100 ms extrapolation, then a clear stale-state hold rather than unlimited motion.
Actors and hazards use the same presentation timeline; game verdicts remain
authoritative. Tune buffer/correction from recorded150/300 ms profiles before
release. Golf's local aim feedback is immediate; no predicted pose can score.

An over-budget golf accumulator retains debt for bounded catch-up. More than
250 ms outstanding debt interrupts the attempt with a clear reason rather than
scoring an artificially slowed simulation. These numerical values are G1
starting choices. The fixed-step test needs tolerance of one1/60 second step
for fractional debt and cannot infer correctness from average FPS.

All three concepts remain unplayed hypotheses. In particular, six-role repair
engagement,200 ms bomb movement, ball contact tuning, exact selected model
fit and real-device performance need their specified G1–G3 evidence.
No design document approves those gates, a finished game, or a release.

The copied guidance/references and original status.json mentioned by the Muse
draft live in /Users/divyansh/Projects/giggle-3d-planning-20261014, not this
packaged folder. Use coordination.json, MUSE_CAPABILITIES.md and this README
for current packaged status; use the repository sources linked above for API
contracts. Original drafts are preserved under muse-attempt-1/ and
muse-revision-2/ and do not override these normalized rules.

Bomb away forfeiture removes the player from survivor counting immediately;
a faint forfeited presentation cannot obstruct an eligible survivor's early
win. Starting a subsequent round requires at least 2connected match-roster
players. If fewer are available, wait at most20 seconds with a clear waiting
state, then interrupt the incomplete match with no additional awarded rounds
or claim of a completed three-round champion. A returning forfeited roster
member can play a later round when that connected-roster check is satisfied.
