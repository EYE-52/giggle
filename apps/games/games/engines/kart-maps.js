'use strict';
/* Kart arena maps (single source for server collision + spawns).
 * The client NEVER duplicates this table: the per-snapshot view carries
 * { map: { id, label, theme, half, bound, blocks, pads, surfaces } } and
 * renders obstacles, turbo strips, and grip zones straight from it.
 * roads: shared fast polylines; offroad: grounded speed/grip factors.
 * barriers: low 0.9m kart walls, separate from tall shot-cover blocks.
 * ramps: wedges rising toward (sin(angle), cos(angle)); hw/hl are half sizes.
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
  [0, 0], [12, 8], [-12, 8], [12, -8], [-12, -8], [20, 0], [-20, 0], [0, 14],
  [0, -14], [20, 16], [-20, 16], [20, -16], [-20, -16], [8, 22], [-8, 22],
  [8, -22], [-8, -22], [24, 8], [-24, 8], [24, -8], [-24, -8], [0, 5],
  [0, -5], [5, 0],
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
  [0, 0], [8, 0], [-8, 0], [0, 8], [0, -12], [8, 8], [-8, 8], [8, -8],
  [-8, -8], [22, 0], [-22, 0], [0, 15], [0, -15], [22, 8], [-22, 8],
  [22, -8], [-22, -8], [0, 18], [0, -4], [24, 24], [24, -24], [9, 19.5],
  [-9, 19.5], [9, -19.5], [-9, -19.5],
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
  [-38, -30], [38, -32], [-44, 28], [38, 32],
  [0, -44], [-4, 46],
]);

const GARDEN_SPOTS = [
  [-48, -48], [-24, -48], [0, -48], [24, -48], [48, -48],
  [-48, -24], [-28, -32], [0, -36], [24, -32], [48, -28],
  [-46, -8], [-16, -12], [8, -16], [36, -8], [52, -8],
  [-46, 8], [-8, 0], [8, 4], [24, 8], [44, 24],
  [-52, 20], [-34, 20], [-12, 16], [12, 18], [36, 34], [52, 36],
  [-48, 44], [-24, 44], [-6, 48], [24, 48], [48, 48],
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
  [-48, -8], [-28, -8], [-8, -16], [0, -12], [28, -14], [52, -20],
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
  [-48, -28], [-24, -36], [0, -24], [24, -36], [48, -32],
  [-48, -8], [-28, -16], [-8, -16], [8, -22], [32, -38], [48, -8],
  [-48, 12], [-28, 4], [-8, 0], [8, 8], [28, 4], [48, 12],
  [-48, 32], [-28, 36], [-8, 32], [8, 48], [28, 36], [48, 36],
  [-12, 48], [18, 28], [36, 48], [0, 0], [20, -4],
  [-40, -20], [40, 20], [40, -4], [20, -30],
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
  // Land on the open cross lane, clear of the new northwest L corner.
  cannons: [cannon(24, -24, { x: -2, z: 0, angle: NW }, 1.3)],
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

// Roads are short polylines shared by grip, prediction and road ribbons.
// Corner points keep the racing line readable without a dense snapshot.
const loop = (e, r, width) => ({points:[[-e+r,-e],[e-r,-e],[e-r*.3,-e+r*.3],[e,-e+r],[e,e-r],[e-r*.3,e-r*.3],[e-r,e],[-e+r,e],[-e+r*.3,e-r*.3],[-e,e-r],[-e,-e+r],[-e+r*.3,-e+r*.3]],width,closed:true,curb:true});
const road = (points,width) => ({points,width,curb:true});
const wall = (x,z,hw,hd) => ({x,z,hw,hd});
const lip = (x,z,angle,hw=2,hl=2.5,h=1.2) => ({x,z,angle,hw,hl,h});

/* Rookie Ring: the oval is the easy racing line, with opposite turbos
 * and two sideways lips. Four low L corners frame an open cross plaza;
 * the cardinal gaps are the fight entrances. Grass is a slower escape. */
const RING_ROADS = [loop(21,11,7),road([[-21,0],[21,0]],7),road([[0,-21],[0,21]],7)];
const RING_BARRIERS = [];
for(const x of [-1,1])for(const z of [-1,1]){
  RING_BARRIERS.push(wall(x*5.6,z*4.2,1.4,.45),wall(x*4.2,z*5.6,.45,1.4));
}
const RING_RAMPS = [lip(0,21,EAST,2,2.5,1),lip(0,-21,WEST,2,2.5,1)];
const RING_PADS = [wall(21,0,1.8,3),wall(-20,-9,1.8,2.5)];

/* Bumper Blocks: the square and wide cross are the safe fast choices.
 * Each quadrant has an L pocket backed by its tall bumper block. A crate
 * rewards entering the mouth; an inward jump lip gives a second way out.
 * The narrow north-lane jump feeds the centre brawl. Sand slows flanks. */
const BLOCKS_ROADS = [loop(25,3.5,4.5),road([[-24,0],[24,0]],10),road([[0,-24],[0,24]],10)];
const BLOCKS_BARRIERS = [], BLOCKS_RAMPS = [lip(0,-20,0,1.4,2.5,1.3)];
for(const x of [-1,1])for(const z of [-1,1]){
  BLOCKS_BARRIERS.push(wall(x*6,z*19,.5,4),wall(x*9.5,z*22.8,3,.5));
  BLOCKS_RAMPS.push(lip(x*9,z*14,z>0?SOUTH:NORTH,1.8,2.5,1));
}
const BLOCKS_PADS = [wall(-9,0,2,1.8),wall(9,0,2,1.8)];

/* Garden Circuit: four turbo straights run outside long inner hedges.
 * Six gates feed both portal lanes, the north corner hill/pond flanks,
 * the south winding cut and a short southeast lane. The east hedge steps
 * around its original spawn. Broad corner gates preserve the hill climbs.
 * Four low L-shaped hedge arcs ring the plaza with four cross-road mouths;
 * two low plaza islands preserve cover and the open centre.
 * Northern grass hills have jump shortcuts; the pond lip is the risky
 * infield crossing, with a crate beyond the water. Cannons feed the cuts. */
const GARDEN_ROADS = [loop(46,14,9),
  road([[16,-46],[16,-40],[11,-35],[11,-28],[8,-21],[0,-12],[0,20],[-12,28],[-16,40],[-16,46]],6),
  road([[-46,0],[-34,0],[-16,-9],[0,0],[18,8],[32,7],[46,0]],7),
  road([[-10,-6],[10,-6],[10,6],[-10,6],[-10,-6]],8),
  road([[-16,-36],[-16,-12],[-6,-6]],6),road([[34,4],[46,0]],7),
  road([[24,46],[24,36],[20,34]],6)];
const GARDEN_BARRIERS = [
  // The NW flank gate also admits the pond ramp's northbound run-up.
  // The winding cut enters through the NE flank and south gate at x=-16.
  wall(0,-40,10,.55),
  wall(-31,40,9,.55),wall(4,40,14,.55),wall(36,40,6,.55),
  // West/east portal gates plus broad northern flank gates at z=-32.
  wall(-40,-11,.55,5),wall(-40,23,.55,17),
  wall(40,-9.5,.55,4.5),wall(40,18,.55,9),
  wall(41,27,1,.55),wall(42,33.5,.55,6.5),
  // Keep the original two pieces of low cover inside the fight floor.
  wall(-4,6,2,.5),wall(6,-6,2,.5),
];
for(const x of [-1,1])for(const z of [-1,1]){
  GARDEN_BARRIERS.push(wall(x*8.5,z*11,2.5,.5),wall(x*11,z*9,.5,2));
}
const GARDEN_RAMPS = [lip(-16,-28,0,2,2.5,1.4),lip(51,28,0,2,3,1.2),lip(-51,35,SOUTH,2,3,1.2)];
GARDEN_PADS.push(wall(0,-46,5,2),wall(0,46,5,2));

/* Frosty Pass: deep snow makes the loop and rink links the life-line.
 * Snowbanks board the rink with four clear cardinal gates. N/S ski jumps
 * enter through those gates; the rink remains fast and slippery. The
 * ice-hole crate is an exposed detour from the west loop. */
const FROST_ROADS = [loop(50,15,8),
  road([[-50,-10],[-34,-10],[-22,-2],[-12,0],[12,2],[32,9],[50,12]],10),
  road([[0,-50],[0,50]],7),
  road([[-47,-34],[-14,-40],[0,-40],[24,-40],[47,-28]],6),
  road([[-47,34],[-24,42],[0,44],[24,42],[47,32]],6)];
const FROST_BARRIERS = [];
for(const x of [-1,1])for(const z of [-1,1]){
  FROST_BARRIERS.push(wall(x*8,z*11,2.5,.5),wall(x*12,z*6,.5,2));
}
const FROST_RAMPS = [lip(0,-23,0,2.3,3,1.3),lip(0,23,SOUTH,2.3,3,1.3)];
FROST_PADS.push(wall(-50,-24,2,4),wall(50,24,2,4));

/* Neon Yard: long jersey dividers line the runway and the inside of the
 * outer cargo corridors. Wide gaps keep every junction and feature lane
 * open around the carousel and original container cover. Dark neutral
 * gravel makes the brighter teal racing lanes easy to follow. The south
 * hill flank keeps a wider opening between the outer dividers. Chained
 * diagonal turbos reward a committed runway. The east-facing goo lip and
 * its exposed crate offer a shorter, risky route across the channel. */
const NEON_ROADS = [loop(48,8,9),
  road([[-48,-18],[-18,-18],[0,0],[18,18],[48,18]],8),
  road([[0,-48],[0,-28],[12,-8],[4,16],[-6,38],[0,48]],7),
  road([[-48,4],[-12,4],[16,-4],[48,-4]],6),
  road([[-48,-40],[48,-40]],7),road([[-44,-40],[-44,36]],6),road([[44,-40],[44,36]],6),
  road([[-12,-8],[12,-8],[12,10],[-12,10],[-12,-8]],8),road([[0,-30],[24,-30]],6)];
const NEON_BARRIERS = [wall(-12,-28,.55,6),wall(12,28,.55,6),wall(-26,-10,8,.55),wall(28,10,8,.55),
  wall(-8,16,3,.55),wall(8,-16,3,.55),
  // Runway approach walls, with a broad open carousel in the middle.
  wall(-33,-24,4,.55),wall(-16,-8,2,.55),wall(16,8,2,.55),wall(29,24,8,.55),
  wall(-11,-22,2.5,.55),wall(-22,-11,.55,2.5),wall(11,22,2.5,.55),wall(22,11,.55,2.5),
  // Inner edges of the outer corridors; junctions remain full-width.
  wall(-38,-28,.55,4),wall(-38,-7,.55,4),wall(-38,10.5,.55,1.5),
  wall(38,-12,.55,4),wall(38,9,.55,5),wall(38,29,.55,3),
  wall(-33,-32.8,4,.55),wall(-15,-32.8,6,.55),wall(29.5,-32.8,7.5,.55),
  wall(-32,42,4,.55),wall(25,42,12,.55)];
const NEON_RAMPS = [lip(5,-30,EAST,2,3,1.4)];
NEON_PADS.push(wall(30,18,2.5,2.5),wall(-30,-18,2.5,2.5));

const MAPS = {
  ring: {
    label: 'Rookie Ring', theme: 'ring', half: 30,
    blocks: [], pads: RING_PADS, roads: RING_ROADS, offroad: {kind:'grass',top:.72,traction:.78}, barriers: RING_BARRIERS, ramps: RING_RAMPS, surfaces: [], spots: RING_SPOTS, spawns: legacySpawns(),
    features: RING_FEATURES,
  },
  blocks: {
    label: 'Bumper Blocks', theme: 'blocks', half: 30,
    blocks: BLOCKS, pads: BLOCKS_PADS, roads: BLOCKS_ROADS, offroad: {kind:'sand',top:.7,traction:.58}, barriers: BLOCKS_BARRIERS, ramps: BLOCKS_RAMPS, surfaces: [], spots: BLOCKS_SPOTS, spawns: legacySpawns(),
    features: BLOCKS_FEATURES,
  },
  garden: {
    label: 'Garden Circuit', theme: 'garden', half: 60,
    blocks: GARDEN_BLOCKS, pads: GARDEN_PADS, roads: GARDEN_ROADS, offroad: {kind:'grass',top:0.72,traction:0.78}, barriers: GARDEN_BARRIERS, ramps: GARDEN_RAMPS, surfaces: [],
    spots: GARDEN_SPOTS, spawns: GARDEN_SPAWNS,
    features: GARDEN_FEATURES,
  },
  frost: {
    label: 'Frosty Pass', theme: 'frost', half: 60,
    blocks: FROST_BLOCKS, pads: FROST_PADS, roads: FROST_ROADS, offroad: {kind:'snow',top:0.66,traction:0.48}, barriers: FROST_BARRIERS, ramps: FROST_RAMPS, surfaces: FROST_SURFACES,
    spots: FROST_SPOTS, spawns: FROST_SPAWNS,
    features: FROST_FEATURES,
  },
  neon: {
    label: 'Neon Yard', theme: 'neon', half: 60,
    blocks: NEON_BLOCKS, pads: NEON_PADS, roads: NEON_ROADS, offroad: {kind:'gravel',top:0.74,traction:0.67}, barriers: NEON_BARRIERS, ramps: NEON_RAMPS, surfaces: [],
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
