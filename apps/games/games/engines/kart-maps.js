'use strict';
/* Kart arena maps (single source for server collision + spawns).
 * The client NEVER duplicates this table: the per-snapshot view carries
 * { map: { id, label, theme, half, bound, blocks, pads, surfaces } } and
 * renders obstacles, turbo strips, and grip zones straight from it.
 * blocks: axis-aligned solid rects { x, z, hw, hd } (center + half extents).
 * pads: automatic turbo strips { x, z, hw, hd } — driving over one at
 *   speed grants a brief turbo (both modes), then a bounded cooldown.
 * surfaces: grip zones { x, z, hw, hd, grip } — grip 1 is normal asphalt,
 *   lower values (Frosty ice ~0.3) slide wider and recover slower.
 * spots: pickup socket pool, guaranteed clear of every block. Battle
 *   SELECTS a random active subset per match via the seeded match RNG;
 *   Star Rush still walks them in order.
 * spawns: legal kart poses { x, z, angle } facing drivable routes. The
 *   engine allocates initial spawns deterministically in pool order and
 *   respawns to the farthest-from-threats legal candidate.
 * half: arena half-extent (playable bound is half-2). Rookie Ring and
 *   Bumper Blocks keep the legacy 60x60 (half=30) geometry; the three
 *   battle arenas are 120x120 (half=60, 4x the area).
 * theme: visual-only environment key consumed by the world renderer. */

const RING_SPOTS = [
  [0, 0], [12, 8], [-12, 8], [12, -8], [-12, -8], [20, 0], [-20, 0], [0, 18],
  [0, -18], [20, 16], [-20, 16], [20, -16], [-20, -16], [8, 22], [-8, 22],
  [8, -22], [-8, -22], [24, 8], [-24, 8], [24, -8], [-24, -8], [5, 5],
  [-5, -5], [5, -5],
];

/* Blocks map: four bumper blocks at (+/-16, +/-16), 5x5. The legacy spawn
 * ring (r=12) and every spot below stay clear: |coord| <= 12 < 13.5, and
 * no spot falls inside a block rect. */
const BLOCKS = [
  { x: 16, z: 16, hw: 2.5, hd: 2.5 },
  { x: -16, z: 16, hw: 2.5, hd: 2.5 },
  { x: 16, z: -16, hw: 2.5, hd: 2.5 },
  { x: -16, z: -16, hw: 2.5, hd: 2.5 },
];

const BLOCKS_SPOTS = [
  [0, 0], [8, 0], [-8, 0], [0, 8], [0, -8], [8, 8], [-8, 8], [8, -8],
  [-8, -8], [22, 0], [-22, 0], [0, 22], [0, -22], [22, 8], [-22, 8],
  [22, -8], [-22, -8], [8, 22], [-8, 22], [8, -22], [-8, -22], [24, 24],
  [-24, 24], [24, -24],
];

/* Legacy 8-seat spawn ring (r=12), the exact historical startPose shape:
 * pose i sits at ring angle a=(i/8)*2PI-PI/2 and faces a+PI/2 (inward-ish).
 * Rookie Ring and Bumper Blocks keep these poses so small-arena behavior
 * is unchanged; only the large arenas use authored pools. */
function legacySpawns() {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    let angle = a + Math.PI / 2;
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    out.push({ x: Math.cos(a) * 12, z: Math.sin(a) * 12, angle });
  }
  return out;
}

/* Face-the-center yaw for an authored spawn: the plaza between the cover
 * pieces is always drivable, so facing it never faces a wall. */
function faceCenter(x, z) {
  if (Math.abs(x) < 1e-9 && Math.abs(z) < 1e-9) return 0;
  return Math.atan2(-x, -z);
}

function pool(list) {
  return list.map(([x, z]) => ({ x, z, angle: faceCenter(x, z) }));
}

/* Garden Circuit (120x120): a wide outer drift loop, two cross-cuts, and
 * an exposed central plaza with three-plus approaches. Six asymmetric
 * landscaped cover pieces (no rows, no center island); the middle
 * |x|<=10 stays a broad passage. Turbo strips sit on the outer
 * straights, clear of every block. */
const GARDEN_BLOCKS = [
  { x: -22, z: 8, hw: 6, hd: 4 },
  { x: 20, z: -10, hw: 4, hd: 7 },
  { x: -4, z: -28, hw: 8, hd: 3 },
  { x: 28, z: 24, hw: 5, hd: 5 },
  { x: -32, z: 32, hw: 4, hd: 5 },
  { x: 8, z: 34, hw: 6, hd: 3 },
];

const GARDEN_PADS = [
  { x: 46, z: 10, hw: 2, hd: 5 },
  { x: -46, z: -12, hw: 2, hd: 5 },
];

const GARDEN_SPAWNS = pool([
  [0, -14], [0, 14], [-14, 0], [14, 0],
  [-38, -30], [38, -32], [-42, 28], [38, 32],
  [0, -44], [-4, 46],
]);

const GARDEN_SPOTS = [
  [-48, -48], [-24, -48], [0, -48], [24, -48], [48, -48],
  [-48, -32], [-28, -32], [0, -36], [24, -32], [48, -28],
  [-40, -8], [-16, -12], [8, -16], [36, -8], [52, -8],
  [-40, 8], [-8, 0], [8, 4], [24, 8], [44, 24],
  [-52, 20], [-36, 20], [-12, 16], [12, 18], [36, 34], [52, 36],
  [-48, 40], [-24, 44], [-6, 48], [24, 48], [48, 48],
  [-8, -44], [16, -24], [-40, -36], [0, 0], [12, -4],
];

/* Frosty Pass (120x120): two connected loops around rocky cover with a
 * broad low-grip center rink (fast but slidey) and grippy edge routes.
 * Four outlying ice patches mark the shortcuts; two strips reward the
 * fast east-west line across the rink edge. */
const FROST_BLOCKS = [
  { x: -26, z: -18, hw: 5, hd: 3 },
  { x: 24, z: 20, hw: 5, hd: 3 },
  { x: -10, z: 28, hw: 3, hd: 5 },
  { x: 12, z: -28, hw: 3, hd: 5 },
  { x: -40, z: 8, hw: 4, hd: 4 },
  { x: 40, z: -6, hw: 4, hd: 4 },
];

const FROST_PADS = [
  { x: -16, z: 0, hw: 4, hd: 2 },
  { x: 16, z: 0, hw: 4, hd: 2 },
];

const FROST_SURFACES = [
  { x: 0, z: 0, hw: 10, hd: 8, grip: 0.45 },
  { x: 28, z: -28, hw: 6, hd: 6, grip: 0.3 },
  { x: -28, z: -34, hw: 6, hd: 6, grip: 0.3 },
  { x: -28, z: 34, hw: 6, hd: 6, grip: 0.3 },
  { x: 28, z: 32, hw: 6, hd: 6, grip: 0.3 },
];

const FROST_SPAWNS = pool([
  [0, -14], [0, 14], [-14, 0], [14, 0],
  [-38, -38], [38, -38], [-38, 38], [38, 38],
  [0, -46], [0, 46],
]);

const FROST_SPOTS = [
  [-48, -48], [-24, -48], [0, -48], [24, -48], [48, -48],
  [-48, -28], [-24, -40], [0, -40], [24, -40], [48, -28],
  [-48, -8], [-28, -8], [-8, -16], [4, -12], [28, -14], [52, -20],
  [-48, 12], [-28, 16], [-8, 8], [8, 8], [28, 8], [48, 8],
  [-48, 32], [-28, 40], [0, 40], [24, 40], [48, 40],
  [-48, 50], [-24, 52], [0, 54], [24, 52], [48, 50],
  [-8, -32], [8, 28], [-16, -4], [16, 4], [0, 0],
];

/* Neon Yard (120x120): offset wide lanes and rounded cover pockets — two
 * asymmetric container clusters plus a solo stack (six pieces, no neat
 * rows) around an open central carousel floor. Three diagonal shortcut
 * pads thread between the clusters for close pulse fights and
 * medium-range rocket lanes. */
const NEON_BLOCKS = [
  { x: -32, z: 16, hw: 5, hd: 3 },
  { x: -24, z: 24, hw: 3, hd: 4 },
  { x: -38, z: 28, hw: 3, hd: 3 },
  { x: 28, z: -16, hw: 5, hd: 3 },
  { x: 34, z: -24, hw: 3, hd: 4 },
  { x: 8, z: 34, hw: 4, hd: 3 },
];

const NEON_PADS = [
  { x: 18, z: 18, hw: 2.5, hd: 2.5 },
  { x: -18, z: -18, hw: 2.5, hd: 2.5 },
  { x: 0, z: -40, hw: 3, hd: 2 },
];

const NEON_SPAWNS = pool([
  [0, -14], [0, 14], [-14, 0], [14, 0],
  [-40, -36], [40, -40], [-48, 38], [42, 36],
  [0, -48], [0, 48],
]);

const NEON_SPOTS = [
  [-48, -48], [-24, -48], [0, -48], [24, -48], [48, -48],
  [-48, -28], [-24, -36], [0, -28], [24, -36], [48, -32],
  [-48, -8], [-28, -12], [-8, -16], [8, -16], [32, -38], [48, -8],
  [-48, 12], [-28, 4], [-8, 0], [8, 8], [28, 8], [48, 12],
  [-48, 32], [-28, 36], [-8, 32], [8, 48], [28, 36], [48, 36],
  [-12, 48], [12, 24], [36, 48], [0, 0], [20, -4],
  [-40, -20], [40, 20], [40, -4],
];

/* ---- Arena features (cannons, portals, fall zones) ----
 * Geometry and rules live in public/js/engines/kart-map-features.mjs.
 * Every placement keeps clear of spawns, crate sockets, cover and strips
 * (test/kart-arena-features.mjs checks it). Cannons fire across the big
 * open spans; portal pairs wrap edge lanes; one water/pit hazard sits near
 * a crate route on each map. Angles: forward = (sin a, cos a). */
const aim = (x, z, tx, tz) => +Math.atan2(tx - x, tz - z).toFixed(4);
const cannon = (x, z, land, flight = 1.4) => ({ x, z, angle: aim(x, z, land.x, land.z), land, flight, apex: 8 });
const EAST = +(Math.PI / 2).toFixed(4), WEST = -EAST, NORTH = 0, SOUTH = +Math.PI.toFixed(4);
const NE = +(Math.PI / 4).toFixed(4), SW = +(-3 * Math.PI / 4).toFixed(4), NW = -NE;

const RING_FEATURES = {
  cannons: [cannon(24, -24, { x: -6, z: 6, angle: NW }, 1.3)],
  portals: [[{ x: -24, z: -24, angle: NE }, { x: 24, z: 24, angle: SW }]],
  falls: [{ x: -26, z: 0, hw: 2, hd: 3.5, kind: 'pit' }],
};

const BLOCKS_FEATURES = {
  cannons: [cannon(-24, -24, { x: 8, z: 4, angle: NE }, 1.3)],
  portals: [[{ x: 16, z: -25, angle: WEST }, { x: -16, z: 25, angle: EAST }]],
  falls: [{ x: 25, z: 14, hw: 2.5, hd: 2, kind: 'pit' }],
};

const GARDEN_FEATURES = {
  cannons: [
    cannon(-16, -52, { x: -6, z: -6, angle: NORTH }, 1.4),
    cannon(16, 53, { x: 34, z: 4, angle: SOUTH }, 1.4),
  ],
  portals: [[{ x: -54, z: 0, angle: EAST }, { x: 55, z: 2, angle: WEST }]],
  falls: [{ x: -14, z: -19, hw: 5, hd: 2.5, kind: 'water' }],
};

const FROST_FEATURES = {
  cannons: [
    cannon(32, -44, { x: 16, z: 8, angle: -0.5 }, 1.5),
    cannon(-36, 48, { x: -20, z: -4, angle: EAST }, 1.5),
  ],
  portals: [[{ x: 24, z: -54, angle: WEST }, { x: -30, z: 52, angle: EAST }]],
  falls: [{ x: -30, z: 23, hw: 3.5, hd: 2, kind: 'ice' }],
};

const NEON_FEATURES = {
  cannons: [
    cannon(-52, 0, { x: -10, z: 4, angle: EAST }, 1.3),
    cannon(32, -52, { x: 44, z: -2, angle: NORTH }, 1.4),
  ],
  portals: [[{ x: -52, z: -55, angle: NE }, { x: 55, z: 52, angle: SW }]],
  falls: [{ x: 12, z: -30, hw: 2, hd: 5, kind: 'goo' }],
};

const MAPS = {
  ring: {
    label: 'Rookie Ring', theme: 'ring', half: 30,
    blocks: [], pads: [], surfaces: [], spots: RING_SPOTS, spawns: legacySpawns(),
    features: RING_FEATURES,
  },
  blocks: {
    label: 'Bumper Blocks', theme: 'blocks', half: 30,
    blocks: BLOCKS, pads: [], surfaces: [], spots: BLOCKS_SPOTS, spawns: legacySpawns(),
    features: BLOCKS_FEATURES,
  },
  garden: {
    label: 'Garden Circuit', theme: 'garden', half: 60,
    blocks: GARDEN_BLOCKS, pads: GARDEN_PADS, surfaces: [],
    spots: GARDEN_SPOTS, spawns: GARDEN_SPAWNS,
    features: GARDEN_FEATURES,
  },
  frost: {
    label: 'Frosty Pass', theme: 'frost', half: 60,
    blocks: FROST_BLOCKS, pads: FROST_PADS, surfaces: FROST_SURFACES,
    spots: FROST_SPOTS, spawns: FROST_SPAWNS,
    features: FROST_FEATURES,
  },
  neon: {
    label: 'Neon Yard', theme: 'neon', half: 60,
    blocks: NEON_BLOCKS, pads: NEON_PADS, surfaces: [],
    spots: NEON_SPOTS, spawns: NEON_SPAWNS,
    features: NEON_FEATURES,
  },
};

function mapIds() {
  return Object.keys(MAPS);
}

function mapDef(id) {
  return MAPS[id] || MAPS.ring;
}

function normalizeMapId(id, allowed) {
  const list = Array.isArray(allowed) && allowed.length ? allowed : mapIds();
  if (list.includes(id)) return id;
  if (MAPS[id]) return id; // configured default outside the offered list
  return list[0] || 'ring';
}

module.exports = { MAPS, mapIds, mapDef, normalizeMapId };
