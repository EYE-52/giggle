import assert from "node:assert/strict";
import RAPIER from "@dimforge/rapier3d-compat";
import {
  createTeamRules,
  arrangeTeamSpawns,
  TEAM_RULES,
} from "../games/engines/kart-team-rules.js";
import maps from "../games/engines/kart-maps.js";
import {
  elevatedMap,
  elevatedMapIds,
  launchArenaIds,
} from "../public/js/engines/kart-elevated-maps.mjs";
import { selectArenaVariant } from "../public/js/engines/kart-arena-policy.mjs";
import { createKartPhysics } from "../public/js/engines/kart-physics-core.mjs";
import { classicStatics } from "../public/js/engines/kart-classic-motion.mjs";
import { elevatedStatics } from "../public/js/engines/kart-feature-solids.mjs";
import { createRoadTerrain } from "../public/js/engines/kart-road-terrain.mjs";
import config from "../public/js/engines/kart-physics-config.mjs";

let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};
const equal = (a, b, message) => {
  assert.deepEqual(a, b, message);
  checks++;
};
const flat = {
  id: "test",
  half: 40,
  spawns: [
    { id: "left", x: -20, y: 0, z: 0 },
    { id: "right", x: 20, y: 0, z: 0 },
  ],
};
const make = (extra = {}) =>
  createTeamRules({ mode: "ctf", map: flat, seats: ["a", "b"], ...extra });
const base = (rules, id) =>
  rules.snapshot().bases.find((b) => b.teamId === id).position;
const flag = (rules, id) => rules.snapshot().flags.find((f) => f.teamId === id);
function kart(pid, p, extra = {}, raised = false) {
  return raised
    ? {
        id: pid,
        pose: { position: { ...p, y: p.y + 0.65 }, grounded: true },
        alive: true,
        connected: true,
        spawnSeq: 0,
        ...extra,
      }
    : {
        pid,
        x: p.x,
        z: p.z,
        physicalPose: { position: { ...p, y: p.y + 0.65 }, grounded: true },
        respawn: 0,
        connected: true,
        spawnSeq: 0,
        ...extra,
      };
}

// Seat order and disconnects never reshuffle a team; odd rooms differ by one.
for (let count = 2; count <= 32; count++) {
  const seats = Array.from({ length: count }, (_, i) => ({ id: "seat-" + i }));
  const a = createTeamRules({ mode: "teambattle", seats }),
    b = createTeamRules({ mode: "Team Battle", seats: [...seats].reverse() });
  equal(
    a.snapshot().teamByPlayer,
    b.snapshot().teamByPlayer,
    "stable membership is independent of adapter seat order",
  );
  const [blue, coral] = a.snapshot().teams;
  check(
    Math.abs(blue.members.length - coral.members.length) <= 1,
    "balanced teams at " + count + " seats",
  );
  check(
    !a.canDamage(blue.members[0], blue.members.at(-1)),
    "friendly fire is rejected",
  );
  check(
    a.canDamage(blue.members[0], coral.members[0]),
    "opponents remain valid targets",
  );
  check(
    !a.canDamage("unknown", blue.members[0]) &&
      !a.canDamage(blue.members[0], blue.members[0]),
    "unknown and self targets are rejected",
  );
}
assert.throws(() => make({ roundMs: 900001 }), RangeError);
checks++;
assert.throws(() => make({ roundMs: 999 }), RangeError);
checks++;
assert.throws(() => make({ seats: ["same", "same"] }), TypeError);
checks++;
assert.throws(() => make({ targetScore: 11 }), RangeError);
checks++;
check(!make({ roundMs: 900000 }).done(), "fifteen-minute endpoint is accepted");

for (const raised of [false, true]) {
  // Team score and placement are shared by all teammates, independent of size.
  const rules = createTeamRules({
    mode: "teambattle",
    seats: ["a", "b", "c", "d", "e", "f"],
    targetScore: 2,
    startAt: 100,
  });
  check(!rules.scoreKO("a", "b", "early", 99), "no countdown scoring");
  check(!rules.scoreKO("a", "c", "friendly", 100), "allied KO cannot score");
  check(rules.scoreKO("a", "b", "first", 100), "enemy KO scores once");
  check(
    !rules.scoreKO("a", "b", "first", 100),
    "same accepted KO never scores twice",
  );
  check(
    rules.scoreKO("c", "d", "second", 101),
    "a teammate can reach the shared target",
  );
  const result = rules.result();
  equal(result.winningTeams, ["blue"], "team winner");
  equal(result.winners, ["a", "c", "e"], "all active winning teammates win");
  check(
    result.standings
      .filter((r) => ["b", "d", "f"].includes(r.pid))
      .every((r) => r.rank === 2 && r.points === 200),
    "every second-place teammate gets second-place points",
  );
  check(
    result.standings
      .filter((r) => ["a", "c", "e"].includes(r.pid))
      .every((r) => r.rank === 1 && r.points === 300),
    "every winning teammate gets first-place points",
  );
  equal(
    [result.reason, result.endReason],
    ["target", "goal"],
    "target reason has common wire vocabulary",
  );
  equal(
    rules.finish(20000, "deadline"),
    result,
    "finish is idempotent after a target",
  );
  result.standings[0].points = -99;
  check(
    rules.result().standings[0].points === 300,
    "public result cannot mutate the authority",
  );

  const timed = createTeamRules({
    mode: "teambattle",
    seats: ["a", "b", "c", "d"],
    targetScore: 1,
    roundMs: 1000,
    winRule: "Time limit",
  });
  timed.scoreKO("a", "b", "one", 0);
  check(!timed.done(), "time-limit mode ignores score target");
  timed.scoreKO("b", "a", "two", 10);
  timed.update(
    1000,
    ["a", "b", "c", "d"].map((pid) =>
      kart(pid, { x: 0, y: 0, z: 0 }, {}, raised),
    ),
  );
  check(
    timed.result().draw &&
      timed.result().standings.every((r) => r.points === 150),
    "equal teams share a timed draw",
  );
  equal(
    [timed.result().reason, timed.result().endReason, timed.result().endedAt],
    ["deadline", "timeout", 1000],
    "deadline is exact",
  );

  const left = createTeamRules({
    mode: "teambattle",
    seats: ["a", "b", "c", "d"],
    winRule: "Time limit",
  });
  left.scoreKO("b", "a", "red-leads", 0);
  left.update(
    10,
    ["a", "b", "c", "d"].map((pid) =>
      kart(
        pid,
        { x: 0, y: 0, z: 0 },
        { connected: !["b", "d"].includes(pid) },
        raised,
      ),
    ),
  );
  check(!left.done(), "temporary team disconnect does not end a round");
  left.update(
    11,
    ["a", "b", "c", "d"].map((pid) =>
      kart(
        pid,
        { x: 0, y: 0, z: 0 },
        { out: ["b", "d"].includes(pid) },
        raised,
      ),
    ),
  );
  equal(
    [left.result().winningTeams, left.result().draw, left.result().endReason],
    [["blue"], false, "players-left"],
    "permanent team abandonment awards the remaining team",
  );
  check(
    left
      .result()
      .standings.filter((r) => r.out)
      .every((r) => r.points === 0),
    "abandoned seats earn no award",
  );

  // Normal theft/carry/capture and exactly-once scoring in both kart schemas.
  const ctf = make({ targetScore: 3 }),
    blue = base(ctf, "blue"),
    coral = base(ctf, "coral");
  ctf.update(0, [kart("a", blue, {}, raised), kart("b", coral, {}, raised)]);
  for (let score = 1; score <= 3; score++) {
    ctf.update(score * 100, [
      kart("a", coral, {}, raised),
      kart("b", coral, {}, raised),
    ]);
    equal(
      [flag(ctf, "coral").state, flag(ctf, "coral").carrierId],
      ["carried", "a"],
      "approaching the opposing flag picks it up",
    );
    ctf.update(score * 100 + 1, [
      kart("a", blue, {}, raised),
      kart("b", coral, {}, raised),
    ]);
    equal(
      ctf.snapshot().teams[0].score,
      score,
      "capture adds exactly one point",
    );
    equal(
      flag(ctf, "coral").state,
      "home",
      "capture returns the opponent flag home",
    );
  }
  equal(
    ctf.result().standings.find((r) => r.pid === "a").captures,
    3,
    "personal captures are recorded separately from team score",
  );
  equal(
    ctf.snapshot().capturesByPlayer,
    { a: 3, b: 0 },
    "public personal capture counts",
  );
  const frozen = ctf.snapshot();
  ctf.update(9999, [kart("a", coral, {}, raised)]);
  equal(ctf.snapshot(), frozen, "completed objectives never continue updating");

  // A player born on an enemy flag must leave and approach it, also after respawn.
  const camper = make(),
    homeBlue = base(camper, "blue"),
    homeCoral = base(camper, "coral"),
    away = { ...homeCoral, z: homeCoral.z + 8 };
  camper.update(0, [
    kart("a", homeCoral, {}, raised),
    kart("b", homeBlue, {}, raised),
  ]);
  equal(
    camper.snapshot().flags.map((f) => f.state),
    ["home", "home"],
    "stationary starts on enemy flags cannot steal",
  );
  camper.update(1, [
    kart("a", away, {}, raised),
    kart("b", homeCoral, {}, raised),
  ]);
  camper.update(2, [
    kart("a", homeCoral, {}, raised),
    kart("b", homeCoral, {}, raised),
  ]);
  equal(
    flag(camper, "coral").carrierId,
    "a",
    "leaving then approaching arms a pickup",
  );
  camper.scoreKO("b", "a", "carrier-ko", 3);
  camper.update(3, [
    kart("a", homeCoral, { respawn: 2, alive: false, spawnSeq: 1 }, raised),
    kart("b", homeCoral, {}, raised),
  ]);
  equal(
    flag(camper, "coral").state,
    "home",
    "defender touch returns the dropped flag",
  );
  camper.update(4, [
    kart("a", homeCoral, { spawnSeq: 1 }, raised),
    kart("b", homeCoral, {}, raised),
  ]);
  equal(
    flag(camper, "coral").state,
    "home",
    "respawned camper cannot steal without an approach",
  );
  camper.update(5, [
    kart("a", away, { spawnSeq: 1 }, raised),
    kart("b", homeCoral, {}, raised),
  ]);
  camper.update(6, [
    kart("a", homeCoral, { spawnSeq: 1 }, raised),
    kart("b", homeCoral, {}, raised),
  ]);
  equal(
    flag(camper, "coral").carrierId,
    "a",
    "new-life approach works normally",
  );

  const dropped = make(),
    db = base(dropped, "blue"),
    dc = base(dropped, "coral"),
    far = { ...dc, z: 12 };
  dropped.update(0, [kart("a", db, {}, raised), kart("b", far, {}, raised)]);
  dropped.update(1, [kart("a", dc, {}, raised), kart("b", far, {}, raised)]);
  dropped.update(2, [
    kart("a", dc, { connected: false }, raised),
    kart("b", far, {}, raised),
  ]);
  equal(
    [
      flag(dropped, "coral").state,
      flag(dropped, "coral").carrierId,
      flag(dropped, "coral").returnAt,
    ],
    ["dropped", null, 2 + TEAM_RULES.returnMs],
    "disconnect drops once on an authority timer",
  );
  const eventCount = dropped.snapshot().objectiveEvents.length;
  dropped.update(3, [
    kart("a", dc, { connected: false }, raised),
    kart("b", far, {}, raised),
  ]);
  equal(
    dropped.snapshot().objectiveEvents.length,
    eventCount,
    "idle disconnected carrier emits no duplicate drop",
  );
  dropped.update(2 + TEAM_RULES.returnMs, [
    kart("a", db, { connected: false }, raised),
    kart("b", far, {}, raised),
  ]);
  equal(
    flag(dropped, "coral").state,
    "home",
    "unclaimed flag returns exactly on timeout",
  );

  const contested = make(),
    cb = base(contested, "blue"),
    cc = base(contested, "coral");
  contested.update(0, [kart("a", cb, {}, raised), kart("b", cc, {}, raised)]);
  contested.update(1, [kart("a", cc, {}, raised), kart("b", cb, {}, raised)]);
  contested.update(2, [kart("a", cb, {}, raised), kart("b", cb, {}, raised)]);
  equal(
    contested.snapshot().teams.map((t) => t.score),
    [0, 0],
    "carriers cannot score while their own flag is away",
  );
  contested.update(3, [
    kart("a", cb, {}, raised),
    kart("b", cb, { alive: false, respawn: 2 }, raised),
  ]);
  equal(
    contested.snapshot().teams[0].score,
    1,
    "teammate return at home unlocks the capture",
  );
  check(
    contested.snapshot().flags.every((f) => f.state === "home"),
    "completed return/capture leaves both flags at home",
  );
}

// CTF uses the same approved grid, reordered by each stable team side.
for (const count of [2, 3, 8, 16, 32]) {
  const seats = Array.from({ length: count }, (_, index) => ({
    id: "driver-" + index,
  }));
  const grid = Array.from({ length: count }, (_, index) => ({
    id: "bay-" + index,
    x: (index - count / 2) * 8,
    y: 0,
    z: index % 2 ? 8 : -8,
    angle: index * 0.3,
  }));
  const rules = createTeamRules({ mode: "teambattle", seats });
  const membership = rules.snapshot().teamByPlayer;
  const bases = [
    { teamId: "blue", position: { x: -200, y: 0, z: 0 } },
    { teamId: "coral", position: { x: 200, y: 0, z: 0 } },
  ];
  const assigned = arrangeTeamSpawns(seats, grid, membership, bases);
  equal(
    assigned.map((p) => p.id).sort(),
    grid.map((p) => p.id).sort(),
    "same unique approved positions remain at " + count + " seats",
  );
  check(
    assigned.every(
      (p) => p.angle === grid.find((source) => source.id === p.id).angle,
    ),
    "authored headings remain unchanged",
  );
  const blue = assigned.filter(
    (_, index) => membership[seats[index].id] === "blue",
  );
  const coral = assigned.filter(
    (_, index) => membership[seats[index].id] === "coral",
  );
  check(
    Math.max(...blue.map((p) => p.x)) <= Math.min(...coral.map((p) => p.x)),
    "each quota gets its own base side",
  );
  const reverse = arrangeTeamSpawns(
    [...seats].reverse(),
    grid,
    membership,
    bases,
  );
  equal(
    Object.fromEntries(
      seats.map((seat, index) => [seat.id, assigned[index].id]),
    ),
    Object.fromEntries(
      [...seats].reverse().map((seat, index) => [seat.id, reverse[index].id]),
    ),
    "join order cannot swap starting teams",
  );
}

// Forfeit/drop refresh is live during countdown, while objectives stay idle.
for (const mode of ["ctf", "teambattle"]) {
  const rules = make({ mode, seats: ["a", "b", "c", "d"], startAt: 1000 });
  const position = mode === "ctf" ? base(rules, "coral") : { x: 0, y: 0, z: 0 };
  rules.update(
    100,
    ["a", "b", "c", "d"].map((pid) =>
      kart(pid, position, { connected: false }),
    ),
  );
  check(!rules.done(), "temporary countdown disconnect is not abandonment");
  check(!rules.scoreKO("a", "b", "countdown", 100), "no countdown KO points");
  if (mode === "ctf")
    check(
      rules.snapshot().flags.every((flag) => flag.state === "home"),
      "no countdown flag pickups",
    );
  rules.update(
    200,
    ["a", "b", "c", "d"].map((pid) =>
      kart(pid, position, { out: ["b", "d"].includes(pid) }),
    ),
  );
  equal(
    [
      rules.result().endReason,
      rules.result().endedAt,
      rules.result().winningTeams,
    ],
    ["players-left", 200, ["blue"]],
    "countdown team forfeit ends immediately",
  );
  check(
    rules
      .result()
      .standings.filter((row) => row.out)
      .every((row) => row.points === 0),
    "countdown leavers earn no awards",
  );
  equal(
    rules.finish(5000, "timeout"),
    rules.result(),
    "pre-live finish remains idempotent",
  );
}

// Full approved pool can put both teams on their side even if the old prefix
// holds only western starts, as on a two-seat Harbor Fork round.
for (const count of [2, 3]) {
  const seats = Array.from({ length: count }, (_, index) => ({
    id: String(index),
  }));
  const membership = createTeamRules({ mode: "teambattle", seats }).snapshot()
    .teamByPlayer;
  const pool = [-30, 30].flatMap((x) =>
    [-12, 0, 12].map((z, index) => ({ x, y: 0, z, angle: index + 0.25 })),
  );
  const bases = [
    { teamId: "blue", position: { x: -40, y: 0, z: 0 } },
    { teamId: "coral", position: { x: 40, y: 0, z: 0 } },
  ];
  const starts = arrangeTeamSpawns(seats, pool, membership, bases);
  check(
    starts.every((start, index) =>
      membership[seats[index].id] === "blue" ? start.x < 0 : start.x > 0,
    ),
    "full-pool side selection at " + count + " seats",
  );
}
const crowdSeats = Array.from({ length: 32 }, (_, index) => ({
  id: "crowd-" + index,
}));
const crowdTeams = createTeamRules({
  mode: "teambattle",
  seats: crowdSeats,
}).snapshot().teamByPlayer;
const crowdGrid = [-20, 20].flatMap((x) =>
  Array.from({ length: 16 }, (_, index) => ({
    id: x + ":" + index,
    x,
    y: 0,
    z: (index - 7.5) * 4.1,
    angle: 0,
  })),
);
const crowdBases = [
  { teamId: "blue", position: { x: -35, y: 0, z: 0 } },
  { teamId: "coral", position: { x: 35, y: 0, z: 0 } },
];
const crowded = arrangeTeamSpawns(
  crowdSeats,
  crowdGrid,
  crowdTeams,
  crowdBases,
);
equal(
  crowded.map((p) => p.id).sort(),
  crowdGrid.map((p) => p.id).sort(),
  "stricter preferred spacing never rejects the existing approved32-seat grid",
);

// Cache drop support only for a moved carrier; no idle-roster ray loop.
let supportCalls = 0;
const cheap = make({
    supportAt: (p) => {
      supportCalls++;
      return {
        point: { x: p.x, y: 0, z: p.z },
        normal: { y: 1 },
        surfaceId: "ground",
      };
    },
  }),
  b = base(cheap, "blue"),
  c = base(cheap, "coral");
supportCalls = 0;
for (let now = 0; now < 1000; now++)
  cheap.update(now, [kart("a", b), kart("b", c)]);
equal(supportCalls, 0, "idle flag-free players need zero support rays");
cheap.update(1000, [kart("a", c), kart("b", { ...c, z: 10 })]);
for (let now = 1001; now < 1100; now++)
  cheap.update(now, [kart("a", c), kart("b", { ...c, z: 10 })]);
equal(supportCalls, 1, "stationary carrier support is sampled once");
cheap.update(1100, [kart("a", { ...c, z: 1 }), kart("b", { ...c, z: 10 })]);
equal(supportCalls, 2, "moving carrier gets a fresh safe drop point");
const external = cheap.snapshot();
external.flags[0].position.x = 9999;
check(
  cheap.snapshot().flags[0].position.x !== 9999,
  "public flags never alias objective state",
);

// Every shipped map and every launch size uses real Rapier support/hull
// queries. Bases come from its existing legal bays and remain on connected
// authored routes; no arbitrary ground rectangles are introduced.
await RAPIER.init();
const geometryReports = [];
const cases = [
  ...maps
    .mapIds()
    .map((id) => ({ id, classic: true, map: { id, ...maps.mapDef(id) } })),
  ...elevatedMapIds.map((id) => ({ id, map: elevatedMap(id) })),
  ...launchArenaIds.flatMap((id) => {
    const m = elevatedMap(id);
    return m.variants.map((v) => ({
      id: id + "/" + v.id,
      map: selectArenaVariant(m, v.minPlayers),
    }));
  }),
];
for (const entry of cases) {
  const physics = createKartPhysics(RAPIER, config),
    terrain = entry.classic ? createRoadTerrain(entry.map) : null;
  try {
    (entry.classic
      ? classicStatics(entry.map, terrain)
      : elevatedStatics(entry.map)
    ).forEach((d) => physics.addStatic(d));
    const rules = make({
      map: entry.map,
      supportAt: physics.supportAt,
      groundAt: terrain?.heightAt,
    });
    const bases = rules.snapshot().bases;
    check(
      Math.hypot(
        bases[0].position.x - bases[1].position.x,
        bases[0].position.z - bases[1].position.z,
      ) >= 8,
      entry.id + " bases are separated",
    );
    for (const base of bases) {
      for (const start of entry.map.spawns) {
        if (Math.abs((start.y || 0) - base.position.y) < 2.5)
          check(
            Math.hypot(start.x - base.position.x, start.z - base.position.z) >=
              5.2 - 1e-5,
            entry.id + " flag is clear of parked spawn hulls",
          );
      }
      const approach = Math.ceil(
        Math.hypot(
          base.position.x - base.anchorPosition.x,
          base.position.z - base.anchorPosition.z,
        ),
      );
      for (let sample = 0; sample <= approach; sample++) {
        const fraction = sample / approach;
        const point = {
          x:
            base.anchorPosition.x +
            (base.position.x - base.anchorPosition.x) * fraction,
          y:
            base.anchorPosition.y +
            (base.position.y - base.anchorPosition.y) * fraction,
          z:
            base.anchorPosition.z +
            (base.position.z - base.anchorPosition.z) * fraction,
        };
        const support = physics.supportAt({ ...point, y: point.y + 0.4 }, 0.9);
        check(
          support && Math.abs(support.point.y - point.y) < 0.2,
          entry.id + " shifted flag keeps a continuous supported approach",
        );
        check(
          !physics.overlapsStatic(
            { ...point, y: point.y + 0.8 },
            { x: 0, y: 0, z: 0, w: 1 },
          ),
          entry.id + " flag approach fits the real kart hull",
        );
      }
      const hit = physics.supportAt(
        { ...base.position, y: base.position.y + 0.4 },
        0.9,
      );
      check(
        hit &&
          Math.abs(hit.point.y - base.position.y) < 0.02 &&
          hit.normal.y > 0.65,
        entry.id + " real supported base",
      );
      check(
        !physics.overlapsStatic(
          { ...base.position, y: base.position.y + 0.8 },
          { x: 0, y: 0, z: 0, w: 1 },
        ),
        entry.id + " base has real kart hull clearance",
      );
    }
    const atlas = entry.map.travelAtlas;
    if (atlas) {
      const starts = entry.map.spawnCandidates || entry.map.spawns,
        indices = bases.map((b) =>
          atlas.ids.findIndex((id) => {
            if (id === b.anchorId) return true;
            const p = starts.find((s) => s.id === id);
            return (
              p &&
              Math.hypot(p.x - b.position.x, p.z - b.position.z) < 0.001 &&
              Math.abs(p.y - b.position.y) < 0.2
            );
          }),
        );
      check(
        indices.every((i) => i >= 0),
        entry.id + " bases attach to compiled real-drive graph",
      );
      check(
        atlas.distances[indices[0] * atlas.ids.length + indices[1]] !== 65535 &&
          atlas.distances[indices[1] * atlas.ids.length + indices[0]] !== 65535,
        entry.id + " ordinary driving reaches both directions",
      );
    }
    geometryReports.push({ id: entry.id, bases });
  } finally {
    physics.dispose();
  }
}
console.log(
  JSON.stringify({
    pass: true,
    checks,
    maps: geometryReports.length,
    scope:
      "shared authoritative team/CTF transitions in both kart schemas; real Rapier base support/clearance and authored compiled travel connectivity; no rendered/browser claim",
  }),
);
