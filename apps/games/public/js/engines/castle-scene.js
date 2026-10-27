/* Castle Clash 3D sunset-valley battlefield (Three.js view over snapshots).
 *
 * A self-contained low-poly arena with its own visual language — no Giggle
 * card UI here: two slate fort foundations (Emberhold coral/red north,
 * Frostgate teal south) nestled in a natural valley at sunset, split by a
 * turquoise river + walnut bridge + grass banks, ringed by faceted
 * slate/lavender mountain ridges, evergreen pines, and cotton clouds under
 * a plum-to-peach gradient sky with a visible setting sun. Every mesh is
 * code-native (no external assets/CDNs); geometries and materials are
 * shared, effects are pooled and capped, and DPR comes from the shared
 * GL helper.
 *
 * Contract: state/simulation stays server-authoritative. update(S, sel)
 * derives meshes from S.grids, animates NEW S.log hit/destroy/corefall
 * entries as arcing projectiles from the firing team's core, renders the
 * host-derived selection.supplies chests ([{id,team,x,y}], max 2), and
 * asks selection.canTarget(x, y, team) for hover/target coloring — the
 * scene never decides gameplay validity itself. Camera drag/orbit +
 * bounded wheel/pinch zoom run through the reusable arena-controls
 * helper; only true taps (slop-gated) reach onCell, so rotating never
 * builds/fires.
 *
 * EXACT integration API:
 *   export async function createCastleScene(mountEl, { onCell, onHover,
 *     onUnavailable } = {}) -> { fallback, reason?, update(S, selection),
 *     focus(team), resetCamera(), zoom(direction), dispose() }
 * Zoom steps the orbit distance in/out (one stop per call) while keeping
 * target/yaw/pitch; direction 'in'|1|'+' zooms in, 'out'|-1|'-' zooms
 * out. Bounded by the existing min/max distance via controls.focus.
 */

import { createThreeView } from '../renderers/three-view.js';
import { createArenaControls } from '../renderers/arena-controls.mjs';

const CELL = 2;
const FOV = 50;
const SKY_DUSK = 0x3a3260; // clear color behind the gradient dome (rarely seen)
const FOG_COLOR = 0xd9a08e; // thin dusty-rose atmosphere
const FOG_NEAR = 58; // targets sit well inside: fog never washes gameplay
const FOG_FAR = 215;
const SUN_DIR = { x: -0.3206, y: 0.0301, z: -0.9467 }; // normalized NNW sunset, low in the north notch
const PLAT_TOP = 0.92; // fort grass-inlay surface
const PAD_H = 0.12;
const Y0 = PLAT_TOP + PAD_H; // structure base height
const MIN_DIST = 8;
const MAX_DIST = 60;
const MIN_PITCH = 0.35;
const MAX_PITCH = 1.25;
const MAX_PROJ = 8;
const MAX_DEBRIS = 48;
const MAX_FLASH = 6;
const MAX_ANIM_PER_UPDATE = 4;

const TEAM_MAIN = { red: 0xe4574d, blue: 0x2fa39a };
const TEAM_DARK = { red: 0xb23a33, blue: 0x1f7a74 };
const TEAM_FLAG = { red: 0xff6b5e, blue: 0x3fd0c2 };

const DEFAULT_ARENA = {
  cols: 8,
  rows: 8,
  zones: {
    red: { x0: 0, y0: 0, x1: 7, y1: 2 },
    blue: { x0: 0, y0: 5, x1: 7, y1: 7 },
  },
};

function foeOf(team) {
  return team === 'red' ? 'blue' : 'red';
}

function arenaKeyOf(arena) {
  try {
    const z = arena.zones || {};
    const zs = ['red', 'blue'].map((t) => {
      const q = z[t] || {};
      return `${t}:${q.x0},${q.y0},${q.x1},${q.y1}`;
    }).join('|');
    return `${arena.cols}x${arena.rows}|${zs}`;
  } catch {
    return 'default';
  }
}

function zoneOf(arena, team) {
  const z = arena && arena.zones && arena.zones[team];
  if (z && [z.x0, z.y0, z.x1, z.y1].every((n) => Number.isInteger(n))) return z;
  return DEFAULT_ARENA.zones[team];
}

/* Grid (x,y) -> world. y=0 sits north (-z, Emberhold), y=max south (+z). */
function cellToWorld(arena, x, y) {
  const cols = (arena && arena.cols) || 8;
  const rows = (arena && arena.rows) || 8;
  return { x: (x - (cols - 1) / 2) * CELL, z: (y - (rows - 1) / 2) * CELL };
}

function zoneCenterWorld(arena, team) {
  const z = zoneOf(arena, team);
  const a = cellToWorld(arena, z.x0, z.y0);
  const b = cellToWorld(arena, z.x1, z.y1);
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

function gridsToList(g) {
  if (Array.isArray(g)) return g;
  if (g && typeof g === 'object') return Object.values(g);
  return [];
}

function validCell(c) {
  return !!c && Number.isInteger(c.x) && Number.isInteger(c.y) && typeof c.piece === 'string';
}

/* Cheap structural signature so 500ms cooldown updates skip remeshing. */
function gridSignature(S) {
  try {
    const parts = [];
    for (const t of ['red', 'blue']) {
      const cells = gridsToList(S.grids && S.grids[t])
        .filter(validCell)
        .map((c) => `${c.x},${c.y}:${c.piece}@${c.level || 1}:${c.hp}/${c.maxHp}`)
        .sort();
      parts.push(`${t}[${cells.join(';')}]`);
    }
    return parts.join('|');
  } catch {
    return 'err:' + Math.random();
  }
}

function hpBandOf(hp, maxHp) {
  const r = maxHp > 0 ? hp / maxHp : 0;
  if (r > 0.6) return 'full';
  if (r > 0.3) return 'hurt';
  return 'crit';
}

/* Stable dedupe key: server monotonic id when present, composite fallback. */
function logKey(e, idx) {
  if (!e || typeof e !== 'object') return 'bad:' + idx;
  if (e.id !== undefined && e.id !== null) return 'id:' + e.id;
  return `k:${e.kind}|${e.by}|${e.weapon}|${e.x},${e.y}|${e.dealt}|${e.when}|${e.at}`;
}

/* Aspect-aware preset distance: narrow phones pull back so forts fit. */
function fitDist(base, aspect) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return Math.min(MAX_DIST, base / Math.min(1, a / 1.12));
}

function camPreset(arena, team, aspect) {
  if (team === 'red' || team === 'blue') {
    const c = zoneCenterWorld(arena, team);
    return {
      name: team,
      target: { x: c.x, y: 1.3, z: c.z },
      yaw: team === 'red' ? Math.PI + 0.12 : 0.12, // approach each fort from its outer edge
      pitch: 0.40, // low enough to frame ridges + sunset above the fort
      distance: fitDist(18, aspect),
    };
  }
  const r = zoneCenterWorld(arena, 'red');
  const b = zoneCenterWorld(arena, 'blue');
  return {
    name: 'overview',
    target: { x: (r.x + b.x) / 2, y: 1.0, z: (r.z + b.z) / 2 + 0.5 },
    yaw: 0,
    pitch: 0.48,
    distance: fitDist(38, aspect),
  };
}

export async function createCastleScene(mountEl, { onCell, onHover, onUnavailable } = {}) {
  const noop = () => {};
  const fallbackHandle = (reason) => ({ fallback: true, reason, update: noop, focus: noop, resetCamera: noop, zoom: noop, dispose: noop });
  if (!mountEl) return fallbackHandle('no-mount');

  /* Latest host callbacks (guarded + disposed-checked at every call). */
  const cb = {
    onCell: typeof onCell === 'function' ? onCell : null,
    onHover: typeof onHover === 'function' ? onHover : null,
    onUnavailable: typeof onUnavailable === 'function' ? onUnavailable : null,
  };

  const st = {
    disposed: false,
    ready: false,
    gl: null,
    controls: null,
    THREE: null,
    scene: null,
    camera: null,
    raycaster: null,
    shared: null,
    arena: DEFAULT_ARENA,
    layout: null, // derived per-arena world layout
    staticRoot: null,
    padsRoot: null,
    structRoot: null,
    fxRoot: null,
    supplyRoot: null,
    chests: new Map(), // "team:id" -> { group, baseY, phase }
    pads: new Map(), // "team:x,y" -> { mesh, ring, x, y, team }
    structs: new Map(), // "team:x,y" -> record
    ghosts: new Map(), // piece -> Group (unparented prototypes)
    ghostBox: null,
    hoverRing: null,
    lastHover: null, // {x,y,team} | null
    selection: null,
    lastObjectives: null,
    lastSig: '',
    lastInstance: null,
    lastRound: null,
    baselined: false,
    seenLog: new Set(),
    seenOrder: [],
    projectiles: [],
    debris: [],
    flashes: [],
    pops: [],
    flags: [], // { mesh, phase }
    spinners: [], // { mesh, baseY, phase }
    clouds: [],
    water: null,
    foam: [], // river shimmer streaks (capped, static under reduced motion)
    validPulse: [],
    explicitCam: false,
    autoFramed: false,
    camPreset: 'overview',
    manualZoom: false,
    reduced: false,
    tmpV: null,
  };

  const markSeen = (key) => {
    if (st.seenLog.has(key)) return;
    st.seenLog.add(key);
    st.seenOrder.push(key);
    if (st.seenOrder.length > 240) {
      for (const k of st.seenOrder.splice(0, st.seenOrder.length - 240)) st.seenLog.delete(k);
    }
  };

  /* ---------------- shared geometries + materials (built once) ---------------- */

  function buildShared(THREE) {
    const std = (color, o = {}) => new THREE.MeshStandardMaterial({
      color, roughness: 0.75, metalness: 0.05, flatShading: true, ...o,
    });
    const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });
    const G = {};
    const M = {};

    G.pad = new THREE.BoxGeometry(CELL * 0.92, PAD_H, CELL * 0.92);
    G.chest = new THREE.BoxGeometry(1.0, 0.5, 0.7);
    G.chestLid = new THREE.BoxGeometry(1.0, 0.22, 0.7);
    G.chestBand = new THREE.BoxGeometry(1.04, 0.12, 0.74);
    G.wallBase = new THREE.BoxGeometry(1.7, 0.8, 1.7);
    G.wallMerlon = new THREE.BoxGeometry(0.34, 0.28, 0.34);
    G.wallShield = new THREE.BoxGeometry(0.5, 0.62, 0.1);
    G.wallTrim = new THREE.BoxGeometry(1.8, 0.12, 1.8);
    G.towerBase = new THREE.CylinderGeometry(0.6, 0.74, 1.5, 8);
    G.towerTop = new THREE.CylinderGeometry(0.86, 0.68, 0.35, 8);
    G.towerMerlon = new THREE.BoxGeometry(0.22, 0.26, 0.22);
    G.towerTrim = new THREE.CylinderGeometry(0.72, 0.72, 0.12, 8);
    G.cannonBase = new THREE.BoxGeometry(1.3, 0.35, 1.5);
    G.cannonBarrel = new THREE.CylinderGeometry(0.17, 0.24, 1.6, 10);
    G.cannonBarrel.rotateX(Math.PI / 2);
    G.cannonBand = new THREE.CylinderGeometry(0.27, 0.27, 0.12, 10);
    G.cannonBand.rotateX(Math.PI / 2);
    G.cannonWheel = new THREE.CylinderGeometry(0.3, 0.3, 0.18, 10);
    G.cannonWheel.rotateZ(Math.PI / 2);
    G.cannonTrim = new THREE.BoxGeometry(1.4, 0.1, 0.3);
    G.keepBase = new THREE.BoxGeometry(1.7, 1.0, 1.7);
    G.keepTop = new THREE.BoxGeometry(1.25, 0.7, 1.25);
    G.keepRoof = new THREE.ConeGeometry(1.08, 0.85, 4);
    G.keepRoof.rotateY(Math.PI / 4);
    G.keepDoor = new THREE.BoxGeometry(0.5, 0.7, 0.1);
    G.keepTrim = new THREE.BoxGeometry(1.8, 0.12, 1.8);
    G.pole = new THREE.CylinderGeometry(0.035, 0.045, 1.1, 6);
    G.flag = new THREE.PlaneGeometry(0.55, 0.34);
    G.flagBig = new THREE.PlaneGeometry(0.8, 0.46);
    G.coreBase = new THREE.CylinderGeometry(0.85, 1.02, 0.5, 8);
    G.coreCrystal = new THREE.OctahedronGeometry(0.72);
    G.coreRing = new THREE.TorusGeometry(1.0, 0.09, 8, 22);
    G.coreRing.rotateX(Math.PI / 2);
    G.ring = new THREE.RingGeometry(0.76, 0.81, 22);
    G.ring.rotateX(-Math.PI / 2);
    G.hoverRing = new THREE.RingGeometry(0.95, 1.16, 26);
    G.hoverRing.rotateX(-Math.PI / 2);
    G.ao = new THREE.CircleGeometry(1.0, 18);
    G.ao.rotateX(-Math.PI / 2);
    G.scorch = new THREE.CircleGeometry(0.95, 18);
    G.scorch.rotateX(-Math.PI / 2);
    G.crack = new THREE.PlaneGeometry(0.5, 0.72);
    G.proj = new THREE.SphereGeometry(0.22, 10, 8);
    G.projBig = new THREE.SphereGeometry(0.32, 10, 8);
    G.debris = new THREE.TetrahedronGeometry(0.15);
    G.flash = new THREE.RingGeometry(0.4, 0.62, 22);
    G.flash.rotateX(-Math.PI / 2);
    G.plank = new THREE.BoxGeometry(2.4, 0.14, 0.6);
    G.rail = new THREE.BoxGeometry(0.14, 0.5, 4.4);
    G.post = new THREE.CylinderGeometry(0.09, 0.11, 0.9, 6);
    G.trunk = new THREE.CylinderGeometry(0.12, 0.17, 0.7, 6);
    G.leafLow = new THREE.ConeGeometry(0.6, 1.0, 7);
    G.leafHigh = new THREE.ConeGeometry(0.42, 0.75, 7);
    G.rock = new THREE.DodecahedronGeometry(0.4);
    G.tuft = new THREE.ConeGeometry(0.22, 0.5, 5);
    G.cloud = new THREE.SphereGeometry(1, 10, 8);
    G.bannerPole = new THREE.CylinderGeometry(0.05, 0.06, 2.2, 6);
    G.sky = new THREE.SphereGeometry(230, 24, 12);
    G.sun = new THREE.CircleGeometry(7.5, 24);
    G.sunGlow = new THREE.CircleGeometry(15, 24);
    G.peak = new THREE.ConeGeometry(1, 1, 5);
    G.valley = new THREE.CircleGeometry(210, 40);
    G.valley.rotateX(-Math.PI / 2);
    G.foam = new THREE.BoxGeometry(2.2, 0.03, 0.28);
    G.meadow = new THREE.CircleGeometry(1, 9);
    G.meadow.rotateX(-Math.PI / 2);

    M.grass = std(0x2f9e5f, { roughness: 0.9 }); // rich emerald
    M.grassDark = std(0x1f6b4a, { roughness: 0.95 }); // pine
    M.meadow = std(0x3fae62, { roughness: 0.95 });
    M.dirt = std(0x4a3a30, { roughness: 0.95 });
    M.stone = std(0x9aa3b5, { roughness: 0.8 }); // cool mineral slate
    M.stoneDark = std(0x646d7f, { roughness: 0.85 });
    M.pebble = std(0x7a8494, { roughness: 0.9 });
    M.wood = std(0x8a5a33, { roughness: 0.8 }); // warm walnut
    M.woodDark = std(0x54371f, { roughness: 0.85 });
    M.sand = std(0xe8d29a, { roughness: 0.95 }); // build-dust puffs only
    M.channel = std(0x1f5a66, { roughness: 0.6 });
    M.water = new THREE.MeshStandardMaterial({
      color: 0x2ec8d8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9,
      emissive: 0x0a4a55, emissiveIntensity: 0.35,
    });
    M.foam = basic(0xcff6ff, { transparent: true, opacity: 0.5, depthWrite: false });
    M.ridgeFar = std(0x8b8fb0, { roughness: 0.9 }); // lavender-slate
    M.ridgeNear = std(0x5a6478, { roughness: 0.9 }); // slate
    M.snow = std(0xe8e2f0, { roughness: 0.8 });
    M.valley = std(0x2a5a44, { roughness: 1 });
    M.pine = std(0x2a7a4e, { roughness: 0.9 });
    M.pineDark = std(0x1d5a3a, { roughness: 0.95 });
    M.copper = std(0xa86a35, { roughness: 0.35, metalness: 0.7, flatShading: false });
    M.iron = std(0x3c414c, { roughness: 0.5, metalness: 0.55, flatShading: false });
    M.gold = std(0xd9a441, { roughness: 0.3, metalness: 0.65, flatShading: false });
    M.padRed = std(0xe9c4b8, { roughness: 0.9 });
    M.padBlue = std(0xbfe0d8, { roughness: 0.9 });
    M.teamRed = std(TEAM_MAIN.red, { roughness: 0.6 });
    M.teamBlue = std(TEAM_MAIN.blue, { roughness: 0.6 });
    M.teamDarkRed = std(TEAM_DARK.red, { roughness: 0.65 });
    M.teamDarkBlue = std(TEAM_DARK.blue, { roughness: 0.65 });
    M.flagRed = new THREE.MeshStandardMaterial({
      color: TEAM_FLAG.red, roughness: 0.7, side: THREE.DoubleSide,
    });
    M.flagBlue = new THREE.MeshStandardMaterial({
      color: TEAM_FLAG.blue, roughness: 0.7, side: THREE.DoubleSide,
    });
    M.crystalRed = std(0xff7a6b, { emissive: 0xff3a2f, emissiveIntensity: 0.95, roughness: 0.25 });
    M.crystalBlue = std(0x7ff0d8, { emissive: 0x22e0b0, emissiveIntensity: 0.9, roughness: 0.25 });
    M.ringValid = basic(0xfff0b5, { transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false });
    M.hoverOk = basic(0xf7d774, { transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
    M.hoverBad = basic(0xe4574d, { transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    M.ghostOk = std(0x9fe8a8, { transparent: true, opacity: 0.55, roughness: 0.6, depthWrite: false });
    M.ghostBad = std(0xe4574d, { transparent: true, opacity: 0.45, roughness: 0.6, depthWrite: false });
    M.crack = basic(0x2b2320, { transparent: true, opacity: 0.82, side: THREE.DoubleSide });
    M.scorch = basic(0x3a2d24, { transparent: true, opacity: 0.5, depthWrite: false });
    M.ao = basic(0x2a2540, { transparent: true, opacity: 0.3, depthWrite: false });
    M.hpBg = new THREE.SpriteMaterial({ color: 0x1f2a33, transparent: true, opacity: 0.75, depthWrite: false });
    M.hpFull = new THREE.SpriteMaterial({ color: 0x53d769, depthWrite: false });
    M.hpHurt = new THREE.SpriteMaterial({ color: 0xd9a414, depthWrite: false });
    M.hpCrit = new THREE.SpriteMaterial({ color: 0xd43a52, depthWrite: false });
    M.projRock = std(0x6b6259, { roughness: 0.9 });
    M.projBig = std(0x57504a, { roughness: 0.9 });
    M.projFire = basic(0xff7a2f);
    M.debrisStone = basic(0x8b93a5);
    M.debrisWood = basic(0x8a5a33);
    M.debrisSpark = basic(0xffb020);
    M.flash = basic(0xffd54a, { transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    M.cloud = basic(0xffe0c8, { transparent: true, opacity: 0.85, depthWrite: false, fog: false });
    M.cloudShade = basic(0xc9a8c8, { transparent: true, opacity: 0.7, depthWrite: false, fog: false });
    M.sun = basic(0xffd9a0, { fog: false });
    M.sunGlow = basic(0xff9a5a, {
      transparent: true, opacity: 0.35, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    // Sunset gradient dome: peach/gold horizon -> plum -> indigo zenith,
    // with a warm halo around the sun azimuth. BackSide + raycast-disabled
    // at the mesh; never in the pick list, never intercepts taps.
    M.sky = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x2e2a5e) },
        midColor: { value: new THREE.Color(0x8a4a6e) },
        botColor: { value: new THREE.Color(0xffc07a) },
        sunDir: { value: new THREE.Vector3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z) },
        sunColor: { value: new THREE.Color(0xffd9a0) },
      },
      vertexShader: [
        'varying vec3 vDir;',
        'void main() {',
        '  vDir = position;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 topColor;',
        'uniform vec3 midColor;',
        'uniform vec3 botColor;',
        'uniform vec3 sunDir;',
        'uniform vec3 sunColor;',
        'varying vec3 vDir;',
        'void main() {',
        '  vec3 d = normalize(vDir);',
        '  float h = d.y;',
        '  vec3 col = mix(botColor, midColor, smoothstep(0.02, 0.28, h));',
        '  col = mix(col, topColor, smoothstep(0.22, 0.65, h));',
        '  col = mix(vec3(0.16, 0.13, 0.22), col, smoothstep(-0.25, 0.02, h));',
        '  float s = max(dot(d, normalize(sunDir)), 0.0);',
        '  col += sunColor * (pow(s, 32.0) * 0.6 + pow(s, 6.0) * 0.16);',
        '  gl_FragColor = vec4(col, 1.0);',
        '}',
      ].join('\n'),
    });

    return { G, M };
  }

  function mesh(THREE, geo, mat, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  }

  function teamMat(M, team, kind) {
    if (kind === 'flag') return team === 'red' ? M.flagRed : M.flagBlue;
    if (kind === 'dark') return team === 'red' ? M.teamDarkRed : M.teamDarkBlue;
    if (kind === 'crystal') return team === 'red' ? M.crystalRed : M.crystalBlue;
    return team === 'red' ? M.teamRed : M.teamBlue;
  }

  /* Red (north) faces +z toward the foe; blue faces -z. */
  function facingOf(team) {
    return team === 'red' ? 1 : -1;
  }

  /* ---------------- static toy terrain (per arena) ---------------- */

  function deriveLayout(arena) {
    const a = arena && Number.isInteger(arena.cols) ? arena : DEFAULT_ARENA;
    const red = zoneCenterWorld(a, 'red');
    const blue = zoneCenterWorld(a, 'blue');
    const zr = zoneOf(a, 'red');
    const zb = zoneOf(a, 'blue');
    return {
      arena: a,
      redCenter: red,
      blueCenter: blue,
      redSize: { w: (zr.x1 - zr.x0 + 1) * CELL + 1, d: (zr.y1 - zr.y0 + 1) * CELL + 1.4 },
      blueSize: { w: (zb.x1 - zb.x0 + 1) * CELL + 1, d: (zb.y1 - zb.y0 + 1) * CELL + 1.4 },
      riverZ: (red.z + blue.z) / 2,
      baseW: Math.max(24, a.cols * CELL + 10),
      baseD: Math.max(28, a.rows * CELL + 14),
    };
  }

  function buildFortPlatform(THREE, S, root, team, center, size, facing) {
    const { G, M } = S;
    const g = new THREE.Group();
    const stone = mesh(THREE, new THREE.BoxGeometry(size.w, 0.78, size.d), M.stoneDark, center.x, 0.39, center.z);
    const inlay = mesh(THREE, new THREE.BoxGeometry(size.w - 0.6, 0.14, size.d - 0.6), M.grass, center.x, 0.85, center.z);
    g.add(stone, inlay);
    // Team trim along the front (foe-facing) edge + corner banner poles.
    const trim = mesh(
      THREE, new THREE.BoxGeometry(size.w - 0.4, 0.18, 0.3), teamMat(M, team, 'main'),
      center.x, 0.82, center.z + facing * (size.d / 2 - 0.15),
    );
    g.add(trim);
    for (const sx of [-1, 1]) {
      const px = center.x + sx * (size.w / 2 - 0.5);
      const pz = center.z + facing * (size.d / 2 - 0.5);
      g.add(mesh(THREE, G.bannerPole, M.woodDark, px, 1.9, pz));
      const flag = mesh(THREE, G.flagBig, teamMat(M, team, 'flag'), px + 0.42, 2.75, pz);
      g.add(flag);
      st.flags.push({ mesh: flag, phase: px * 0.7 + pz });
    }
    root.add(g);
  }

  function buildStatic(THREE, S) {
    const { G, M } = S;
    const L = st.layout;
    const root = new THREE.Group();
    const scenery = (m) => { // backdrop meshes never intercept raycasts
      m.raycast = () => {};
      return m;
    };

    // Sunset gradient dome + valley floor: no flat beige void anywhere.
    const sky = scenery(mesh(THREE, G.sky, M.sky, 0, 0, 0));
    sky.frustumCulled = false;
    root.add(sky);
    root.add(scenery(mesh(THREE, G.valley, M.valley, 0, -0.6, 0)));

    // Visible setting sun (NNW) + halo, framed by the north-ridge notch.
    const sun = scenery(mesh(THREE, G.sun, M.sun, SUN_DIR.x * 195, SUN_DIR.y * 195, SUN_DIR.z * 195));
    sun.lookAt(0, 4, 0);
    const glow = scenery(mesh(THREE, G.sunGlow, M.sunGlow, SUN_DIR.x * 193, SUN_DIR.y * 193, SUN_DIR.z * 193));
    glow.lookAt(0, 4, 0);
    root.add(sun, glow);

    // Layered faceted ridges: lavender-slate far layer, slate near layer,
    // snow on the tall crowns. Center notches stay low so the forts and
    // the sun read cleanly against the sky from default views.
    const addPeak = (x, z, radius, height, mat, capped) => {
      const peak = scenery(mesh(THREE, G.peak, mat, x, -1.2 + height / 2, z));
      peak.scale.set(radius, height, radius);
      peak.rotation.y = (Math.abs(x * 13 + z * 7) % 10) / 10 * Math.PI;
      root.add(peak);
      if (capped) {
        const capH = height * 0.36;
        const snow = scenery(mesh(THREE, G.peak, M.snow, x, -1.2 + height - capH * 0.38, z));
        snow.scale.set(radius * 0.4, capH, radius * 0.4);
        snow.rotation.y = peak.rotation.y + 0.5;
        root.add(snow);
      }
    };
    const farPeaks = [
      [-52, -80, 16, 30], [-66, -80, 15, 28], [-6, -80, 15, 28], [18, -83, 17, 32], [42, -79, 15, 29],
      [-56, 81, 15, 29], [-32, 79, 16, 31], [-8, 82, 15, 28], [16, 80, 17, 32], [40, 81, 15, 29],
      [-82, -72, 15, 28], [-80, -18, 14, 26], [-82, 8, 15, 27], [-79, 38, 14, 25], [-81, 66, 15, 28],
      [80, -70, 15, 29], [82, -40, 16, 31], [79, -10, 15, 28], [81, 20, 16, 30], [80, 50, 14, 26],
    ];
    const nearPeaks = [
      [-44, -54, 11, 18], [-38, -50, 10, 16], [0, -55, 8, 12], [24, -51, 11, 19], [46, -55, 10, 16],
      [-46, 55, 10, 16], [-22, 53, 9, 14], [0, 56, 8, 12], [22, 54, 10, 16], [46, 55, 10, 15],
      [-55, -70, 10, 16], [-54, -30, 8, 12], [-55, -2, 9, 13], [-54, 26, 10, 15], [-55, 52, 9, 14],
      [54, -58, 10, 17], [55, -28, 9, 14], [54, 2, 10, 16], [55, 30, 9, 14], [54, 58, 10, 15],
    ];
    for (const [x, z, r, h] of farPeaks) addPeak(x, z, r * 0.9, h * 0.78, M.ridgeFar, true);
    for (const [x, z, r, h] of nearPeaks) addPeak(x, z, r * 0.9, h * 0.7, M.ridgeNear, h >= 18);

    // Meadow patches break up the green (table margins + valley floor).
    for (const [mx, my, mz, mr] of [
      [-10.8, 0.03, -7, 1.6], [10.8, 0.03, 6, 1.9], [-10.5, 0.03, 3, 1.3],
      [10.5, 0.03, -3, 1.4], [-3, 0.03, -11.5, 1.7], [4, 0.03, 11.5, 1.6],
      [-18, -0.57, -16, 5], [19, -0.57, 14, 5.5], [3, -0.57, -24, 4.5],
      [-5, -0.57, 24, 4], [24, -0.57, -6, 4], [-24, -0.57, 8, 4.5],
    ]) {
      const patch = scenery(mesh(THREE, G.meadow, M.meadow, mx, my, mz));
      patch.scale.setScalar(mr);
      root.add(patch);
    }

    // Fort foundations: dirt slab under an emerald table-top.
    root.add(mesh(THREE, new THREE.BoxGeometry(L.baseW + 1, 1.0, L.baseD + 1), M.dirt, 0, -1.7, 0));
    root.add(mesh(THREE, new THREE.BoxGeometry(L.baseW, 1.2, L.baseD), M.grassDark, 0, -0.6, 0));
    root.add(mesh(THREE, new THREE.BoxGeometry(L.baseW - 0.8, 0.12, L.baseD - 0.8), M.grass, 0, -0.04, 0));

    buildFortPlatform(THREE, S, root, 'red', L.redCenter, L.redSize, 1);
    buildFortPlatform(THREE, S, root, 'blue', L.blueCenter, L.blueSize, -1);

    // Turquoise river with grass banks + a thin pebble shoreline.
    const rz = L.riverZ;
    root.add(mesh(THREE, new THREE.BoxGeometry(L.baseW - 1, 0.08, 2.6), M.channel, 0, 0.0, rz));
    st.water = mesh(THREE, new THREE.BoxGeometry(L.baseW - 1, 0.08, 2.2), M.water, 0, 0.06, rz);
    st.water.raycast = () => {};
    root.add(st.water);
    for (const s of [-1, 1]) {
      root.add(mesh(THREE, new THREE.BoxGeometry(L.baseW - 1, 0.1, 1.0), M.grassDark, 0, 0.03, rz + s * 1.9));
      root.add(mesh(THREE, new THREE.BoxGeometry(L.baseW - 1, 0.09, 0.28), M.pebble, 0, 0.03, rz + s * 1.25));
    }
    // Gentle shimmer streaks drifting along the river (capped at two).
    for (const [fx, fz, sp] of [[-6, rz - 0.4, 0.35], [5, rz + 0.45, 0.28]]) {
      const f = scenery(mesh(THREE, G.foam, M.foam, fx, 0.12, fz));
      root.add(f);
      st.foam.push({ mesh: f, speed: sp });
    }

    // Walnut bridge on the cores' column (default x=3 -> wx=-1).
    const bx = coreWorldXFallback();
    const deck = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      deck.add(mesh(THREE, G.plank, i % 2 ? M.wood : M.woodDark, bx, 0.22, rz - 1.55 + i * 0.62));
    }
    for (const s of [-1, 1]) {
      deck.add(mesh(THREE, G.rail, M.woodDark, bx + s * 1.25, 0.55, rz));
      for (const e of [-1.9, 1.9]) deck.add(mesh(THREE, G.post, M.woodDark, bx + s * 1.25, 0.35, rz + e));
    }
    root.add(deck);

    // Deterministic evergreens: a ring on the table + clusters in the valley.
    const treeSpots = [
      [-11, -12], [-8.5, -12.5], [8.5, -12.5], [11, -12], [-11.5, -6], [11.5, -6],
      [-11.5, 6], [11.5, 6], [-11, 12], [-8, 12.5], [8, 12.5], [11, 12],
    ];
    const valleyTreeSpots = [
      [-17, -15], [17.5, -13], [-19, 4], [19, 6], [-15, 16],
      [15, 17], [-7, -22], [8, -21], [-9, 22], [7, 23],
    ];
    const plantTree = (tx, tz, baseY, big) => {
      const tree = new THREE.Group();
      tree.add(mesh(THREE, G.trunk, M.woodDark, 0, 0.35, 0));
      tree.add(mesh(THREE, G.leafLow, M.pineDark, 0, 1.1, 0));
      tree.add(mesh(THREE, G.leafHigh, M.pine, 0, 1.75, 0));
      const s = (big ? 1.2 : 0.85) + ((Math.abs(tx * 7 + tz * 13) % 10) / 10) * 0.5;
      tree.scale.setScalar(s);
      tree.position.set(tx, baseY, tz);
      tree.rotation.y = (tx * 3 + tz) % 6;
      root.add(tree);
    };
    for (const [tx, tz] of treeSpots) {
      if (Math.abs(tx) > L.baseW / 2 - 1 || Math.abs(tz) > L.baseD / 2 - 1) continue;
      plantTree(tx, tz, 0, false);
    }
    for (const [tx, tz] of valleyTreeSpots) plantTree(tx, tz, -0.6, true);
    const rockSpots = [[-6, 2.6], [5.5, -2.7], [-3.5, -2.5], [7, 2.8], [-9, 0.5], [9.5, -0.5]];
    for (const [rx, rz2] of rockSpots) {
      if (Math.abs(rx - bx) < 2.2 && Math.abs(rz2 - rz) < 2.6) continue;
      const rock = mesh(THREE, G.rock, M.stoneDark, rx, 0.25, rz2);
      rock.rotation.set(rx, rz2 * 2, 0.4);
      rock.scale.setScalar(0.7 + ((Math.abs(rx * 5 + rz2 * 11) % 10) / 10) * 0.7);
      root.add(rock);
    }
    for (let i = 0; i < 10; i++) {
      const tx = -10 + i * 2.2;
      const tz = rz + (i % 2 ? 2.9 : -2.9);
      if (Math.abs(tx - bx) < 1.8) continue;
      root.add(mesh(THREE, G.tuft, M.grassDark, tx, 0.22, tz));
    }

    // Low-poly cotton clouds catching the sunset (static under reduced motion).
    const cloudSpots = [[-26, 15, -34], [-8, 18, -48], [12, 14, -38], [28, 17, -30], [-2, 20, -60]];
    cloudSpots.forEach(([cx, cy, cz], i) => {
      const cloud = new THREE.Group();
      cloud.add(mesh(THREE, G.cloud, M.cloud, 0, 0, 0));
      cloud.add(mesh(THREE, G.cloud, M.cloudShade, 1.3, -0.25, 0.3));
      cloud.add(mesh(THREE, G.cloud, M.cloudShade, -1.2, -0.3, -0.2));
      cloud.add(mesh(THREE, G.cloud, M.cloud, 0.3, 0.5, -0.3));
      cloud.traverse((o) => { if (o.isMesh) o.raycast = () => {}; });
      cloud.scale.setScalar(1.2 + i * 0.12);
      cloud.position.set(cx, cy, cz);
      root.add(cloud);
      st.clouds.push({ mesh: cloud, speed: 0.2 + i * 0.08 });
    });
    return root;
  }

  function coreWorldXFallback() {
    try {
      const o = st.lastObjectives;
      const cands = [o && o.red, o && o.blue].filter((c) => c && Number.isInteger(c.x));
      if (cands.length) {
        const w = cellToWorld(st.arena, cands[0].x, 0);
        return w.x;
      }
    } catch { /* default below */ }
    return cellToWorld(st.arena, 3, 0).x;
  }

  /* ---------------- build pads (pickable plots) ---------------- */

  function rebuildPads(THREE, S) {
    const { G, M } = S;
    if (st.padsRoot) {
      st.scene.remove(st.padsRoot);
      st.padsRoot = null;
    }
    st.pads.clear();
    st.validPulse = [];
    const root = new THREE.Group();
    for (const team of ['red', 'blue']) {
      const z = zoneOf(st.arena, team);
      const padMat = team === 'red' ? M.padRed : M.padBlue;
      for (let y = z.y0; y <= z.y1; y++) {
        for (let x = z.x0; x <= z.x1; x++) {
          const w = cellToWorld(st.arena, x, y);
          const pad = mesh(THREE, G.pad, padMat, w.x, PLAT_TOP + PAD_H / 2, w.z);
          pad.userData.cell = { x, y, team };
          const ring = mesh(THREE, G.ring, M.ringValid, w.x, PLAT_TOP + PAD_H + 0.02, w.z);
          ring.visible = false;
          ring.raycast = () => {};
          root.add(pad, ring);
          st.pads.set(`${team}:${x},${y}`, { mesh: pad, ring, x, y, team });
        }
      }
    }
    st.padsRoot = root;
    st.scene.add(root);
  }

  /* ---------------- chunky toy structures (shared geo/mat) ---------------- */

  function addAo(THREE, S, group) {
    const ao = mesh(THREE, S.G.ao, S.M.ao, 0, 0.02, 0);
    ao.raycast = () => {};
    group.add(ao);
  }

  function addFlag(THREE, S, group, team, x, y, z, big, ghost) {
    // Decorative and tall: never intercepts taps (pads + structures own
    // picking), so waving cloth can't steal a neighboring plot's tap.
    const poleH = big ? 1.35 : 1.1;
    group.add(noRaycast(mesh(THREE, S.G.pole, S.M.woodDark, x, y - 0.2, z)));
    const flag = noRaycast(mesh(THREE, big ? S.G.flagBig : S.G.flag, teamMat(S.M, team, 'flag'), x + (big ? 0.45 : 0.32), y + poleH / 2 - 0.25, z));
    group.add(flag);
    if (!ghost) st.flags.push({ mesh: flag, phase: st.flags.length * 1.7 });
    return flag;
  }

  /* Each builder returns { group, topY, face } with base at local y=0. */
  function buildWall(THREE, S, team, ghost) {
    const { G, M } = S;
    const facing = facingOf(team);
    const g = new THREE.Group();
    addAo(THREE, S, g);
    g.add(mesh(THREE, G.wallBase, M.stone, 0, 0.4, 0));
    for (const [mx, mz] of [[-0.62, -0.62], [0.62, -0.62], [-0.62, 0.62], [0.62, 0.62]]) {
      g.add(mesh(THREE, G.wallMerlon, M.stoneDark, mx, 0.94, mz));
    }
    g.add(mesh(THREE, G.wallShield, teamMat(M, team, 'main'), 0, 0.45, facing * 0.88));
    const trim = mesh(THREE, G.wallTrim, M.gold, 0, 0.55, 0);
    trim.visible = false;
    g.add(trim);
    g.userData.trim = trim;
    return { group: g, topY: 1.1, face: { d: 0.86, h: 0.45 } };
  }

  function buildTower(THREE, S, team, ghost) {
    const { G, M } = S;
    const g = new THREE.Group();
    addAo(THREE, S, g);
    g.add(mesh(THREE, G.towerBase, M.stone, 0, 0.75, 0));
    g.add(mesh(THREE, G.towerTop, M.stoneDark, 0, 1.62, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.add(mesh(THREE, G.towerMerlon, M.stone, Math.cos(a) * 0.72, 1.92, Math.sin(a) * 0.72));
    }
    addFlag(THREE, S, g, team, 0, 2.0, 0, false, ghost);
    const trim = mesh(THREE, G.towerTrim, M.gold, 0, 0.9, 0);
    trim.visible = false;
    g.add(trim);
    g.userData.trim = trim;
    return { group: g, topY: 2.9, face: { d: 0.72, h: 0.9 } };
  }

  function buildCannon(THREE, S, team, ghost) {
    const { G, M } = S;
    const facing = facingOf(team);
    const g = new THREE.Group();
    addAo(THREE, S, g);
    g.add(mesh(THREE, G.cannonBase, M.wood, 0, 0.18, 0));
    for (const s of [-1, 1]) {
      g.add(mesh(THREE, G.cannonWheel, M.woodDark, s * 0.72, 0.3, 0));
    }
    const barrel = mesh(THREE, G.cannonBarrel, M.copper, 0, 0.62, facing * 0.25);
    if (facing < 0) barrel.rotation.y = Math.PI; // taper (muzzle) always aims at the foe
    g.add(barrel);
    g.add(mesh(THREE, G.cannonBand, M.iron, 0, 0.62, facing * 0.78));
    g.add(mesh(THREE, G.cannonBand, M.iron, 0, 0.62, facing * -0.12));
    const trim = mesh(THREE, G.cannonTrim, M.gold, 0, 0.4, -facing * 0.5);
    trim.visible = false;
    g.add(trim);
    g.userData.trim = trim;
    return { group: g, topY: 1.0, face: { d: 0.76, h: 0.3 } };
  }

  function buildKeep(THREE, S, team, ghost) {
    const { G, M } = S;
    const facing = facingOf(team);
    const g = new THREE.Group();
    addAo(THREE, S, g);
    g.add(mesh(THREE, G.keepBase, M.stone, 0, 0.5, 0));
    g.add(mesh(THREE, G.keepTop, M.stoneDark, 0, 1.35, 0));
    g.add(mesh(THREE, G.keepRoof, teamMat(M, team, 'dark'), 0, 2.12, 0));
    g.add(mesh(THREE, G.keepDoor, M.woodDark, 0, 0.35, facing * 0.88));
    addFlag(THREE, S, g, team, 0, 2.55, 0, true, ghost);
    const trim = mesh(THREE, G.keepTrim, M.gold, 0, 1.0, 0);
    trim.visible = false;
    g.add(trim);
    g.userData.trim = trim;
    return { group: g, topY: 3.5, face: { d: 0.86, h: 0.9 } };
  }

  function buildCore(THREE, S, team, ghost) {
    const { G, M } = S;
    const facing = facingOf(team);
    const g = new THREE.Group();
    addAo(THREE, S, g);
    g.add(mesh(THREE, G.coreBase, M.stoneDark, 0, 0.25, 0));
    g.add(mesh(THREE, G.coreRing, M.gold, 0, 0.56, 0));
    const crystal = mesh(THREE, G.coreCrystal, teamMat(M, team, 'crystal'), 0, 1.45, 0);
    g.add(crystal);
    if (!ghost) st.spinners.push({ mesh: crystal, baseY: 1.45, phase: st.spinners.length * 2.1 });
    for (const s of [-1, 1]) {
      const px = s * 1.05;
      const pz = -facing * 0.85;
      g.add(noRaycast(mesh(THREE, G.bannerPole, M.woodDark, px, 1.1, pz)));
      const flag = noRaycast(mesh(THREE, G.flagBig, teamMat(M, team, 'flag'), px + 0.45, 1.95, pz));
      g.add(flag);
      if (!ghost) st.flags.push({ mesh: flag, phase: st.flags.length * 1.7 });
    }
    return { group: g, topY: 2.5, face: { d: 0.92, h: 0.6 } };
  }

  const BUILDERS = { wall: buildWall, tower: buildTower, cannon: buildCannon, keep: buildKeep, core: buildCore };

  function kindOf(cell) {
    if (!cell) return 'wall';
    if (cell.objective || cell.piece === 'core') return 'core';
    return BUILDERS[cell.piece] ? cell.piece : 'wall';
  }

  /* ---------------- per-structure HP bars + damage overlays ---------------- */

  function noRaycast(obj) {
    obj.raycast = () => {};
    return obj;
  }

  function ensureHp(THREE, S, rec, frac, band, always) {
    let hp = rec.group.userData.hp;
    if (!hp) {
      const bg = new THREE.Sprite(S.M.hpBg);
      bg.scale.set(1.5, 0.2, 1);
      bg.position.set(0, rec.topY + 0.45, 0);
      noRaycast(bg);
      const fg = new THREE.Sprite(S.M.hpFull);
      fg.scale.set(1.4, 0.13, 1);
      fg.position.set(0, rec.topY + 0.45, 0);
      noRaycast(fg);
      rec.group.add(bg, fg);
      hp = rec.group.userData.hp = { bg, fg };
    }
    const show = always || frac < 0.999;
    hp.bg.visible = show;
    hp.fg.visible = show;
    if (!show) return;
    const w = Math.max(0.01, 1.4 * Math.min(1, Math.max(0, frac)));
    hp.fg.scale.x = w;
    hp.fg.position.x = -(1.4 - w) / 2;
    hp.fg.material = band === 'crit' ? S.M.hpCrit : band === 'hurt' ? S.M.hpHurt : S.M.hpFull;
  }

  function ensureDamage(THREE, S, rec, band, seed) {
    const ud = rec.group.userData;
    if (!ud.cracks) {
      const mk = (side) => {
        const c = mesh(THREE, S.G.crack, S.M.crack, side * 0.25, rec.face.h, rec.facing * (rec.face.d + 0.02));
        if (rec.facing < 0) c.rotation.y = Math.PI;
        c.rotation.z = ((seed % 3) - 1) * 0.45 * (side || 1);
        c.visible = false;
        rec.group.add(c);
        return c;
      };
      const scorch = mesh(THREE, S.G.scorch, S.M.scorch, 0, 0.04, 0);
      noRaycast(scorch);
      scorch.visible = false;
      rec.group.add(scorch);
      ud.cracks = [mk(-1), mk(1)];
      ud.scorch = scorch;
    }
    ud.cracks[0].visible = band !== 'full';
    ud.cracks[1].visible = band === 'crit';
    ud.scorch.visible = band === 'crit';
    if (band === 'crit') {
      rec.group.rotation.z = 0.05;
      rec.group.rotation.x = -0.04 * rec.facing;
    } else {
      rec.group.rotation.z = 0;
      rec.group.rotation.x = 0;
    }
  }

  function paintHealth(THREE, S, rec, cell) {
    const frac = cell.maxHp > 0 ? cell.hp / cell.maxHp : 0;
    const band = hpBandOf(cell.hp, cell.maxHp);
    ensureHp(THREE, S, rec, frac, band, rec.kind === 'core');
    ensureDamage(THREE, S, rec, band, cell.x * 7 + cell.y * 3 + (rec.team === 'red' ? 1 : 5));
    if (rec.group.userData.trim) rec.group.userData.trim.visible = (cell.level || 1) > 1;
  }

  /* ---------------- structure sync (diffed; cooldown ticks skip) ---------------- */

  function addStruct(THREE, S, key, team, cell, instant) {
    const kind = kindOf(cell);
    const built = (BUILDERS[kind] || buildWall)(THREE, S, team, false);
    const w = cellToWorld(st.arena, cell.x, cell.y);
    built.group.position.set(w.x, Y0, w.z);
    built.group.userData.cell = { x: cell.x, y: cell.y, team };
    const rec = {
      key, team, kind, cell: { x: cell.x, y: cell.y },
      group: built.group, topY: built.topY, face: built.face, facing: facingOf(team),
      hp: cell.hp, maxHp: cell.maxHp, level: cell.level || 1,
    };
    st.structs.set(key, rec);
    st.structRoot.add(built.group);
    paintHealth(THREE, S, rec, cell);
    if (!instant && !st.reduced) {
      st.pops.push({ group: built.group, t: 0 });
      if (st.pops.length > 8) {
        const oldest = st.pops.shift();
        if (oldest) oldest.group.scale.setScalar(1);
      }
      spawnFlash(w.x, Y0 + 0.1, w.z, 0.45);
      spawnDebris(w.x, Y0 + 0.5, w.z, 3, 'dust');
    }
    return rec;
  }

  function removeStruct(key, poof) {
    const rec = st.structs.get(key);
    if (!rec) return;
    st.structs.delete(key);
    if (st.structRoot) st.structRoot.remove(rec.group);
    if (poof && !st.reduced) {
      const p = rec.group.position;
      spawnDebris(p.x, Y0 + 0.6, p.z, 5, 'wood');
    }
  }

  function syncGrids(THREE, S, snapshot, instant) {
    const want = new Map();
    for (const t of ['red', 'blue']) {
      for (const c of gridsToList(snapshot.grids && snapshot.grids[t])) {
        if (!validCell(c)) continue;
        want.set(`${t}:${c.x},${c.y}`, { team: t, cell: c });
      }
    }
    for (const key of [...st.structs.keys()]) {
      if (!want.has(key)) removeStruct(key, !instant);
    }
    for (const [key, { team, cell }] of want) {
      const rec = st.structs.get(key);
      if (!rec) {
        addStruct(THREE, S, key, team, cell, instant);
      } else if (rec.kind !== kindOf(cell)) {
        // Same plot, new piece (shouldn't happen live): swap the toy.
        removeStruct(key, false);
        addStruct(THREE, S, key, team, cell, instant);
      } else if (rec.hp !== cell.hp || rec.maxHp !== cell.maxHp || rec.level !== (cell.level || 1)) {
        rec.hp = cell.hp;
        rec.maxHp = cell.maxHp;
        rec.level = cell.level || 1;
        paintHealth(THREE, S, rec, cell);
        if (!instant && !st.reduced) st.pops.push({ group: rec.group, t: 0.25 });
      }
    }
  }

  /* ---------------- supply chests (host-derived, max 2) ---------------- */

  function syncSupplies(instant) {
    const want = new Map();
    const list = st.selection && Array.isArray(st.selection.supplies) ? st.selection.supplies : [];
    for (const c of list.slice(0, 2)) {
      if (!c || typeof c.id !== 'string' || (c.team !== 'red' && c.team !== 'blue')) continue;
      if (!Number.isInteger(c.x) || !Number.isInteger(c.y)) continue;
      want.set(`${c.team}:${c.id}`, c);
    }
    for (const key of [...st.chests.keys()]) {
      if (!want.has(key)) {
        const rec = st.chests.get(key);
        st.chests.delete(key);
        if (rec && st.supplyRoot) st.supplyRoot.remove(rec.group);
      }
    }
    if (!st.supplyRoot || !st.shared || !st.THREE) return;
    for (const [key, c] of want) {
      if (st.chests.has(key)) continue;
      const w = cellToWorld(st.arena, c.x, c.y);
      const g = new st.THREE.Group();
      g.position.set(w.x, Y0 + 0.55, w.z);
      g.add(mesh(st.THREE, st.shared.G.chest, st.shared.M.wood, 0, 0, 0));
      g.add(mesh(st.THREE, st.shared.G.chestLid, st.shared.M.woodDark, 0, 0.36, 0));
      g.add(mesh(st.THREE, st.shared.G.chestBand, st.shared.M.gold, 0, 0.1, 0));
      // Claimed via the HUD button only: chests never intercept plot taps.
      g.traverse((o) => { if (o.isMesh) o.raycast = () => {}; });
      st.supplyRoot.add(g);
      st.chests.set(key, { group: g, baseY: g.position.y, phase: st.chests.size * 1.3 });
      if (!instant && !st.reduced) impactAt(w.x, Y0 + 1.1, w.z, 3);
    }
  }

  /* ---------------- pooled capped effects ---------------- */

  function initPools(THREE, S) {
    for (let i = 0; i < MAX_PROJ; i++) {
      const m = mesh(THREE, S.G.proj, S.M.projRock, 0, -50, 0);
      m.visible = false;
      st.fxRoot.add(m);
      st.projectiles.push({
        mesh: m, active: false, t: 0, dur: 0.75,
        from: new THREE.Vector3(), ctrl: new THREE.Vector3(), to: new THREE.Vector3(), power: 5,
      });
    }
    const dGeo = S.G.debris;
    for (let i = 0; i < MAX_DEBRIS; i++) {
      const m = mesh(THREE, dGeo, S.M.debrisStone, 0, -50, 0);
      m.visible = false;
      st.fxRoot.add(m);
      st.debris.push({ mesh: m, active: false, vel: new THREE.Vector3(), life: 0, maxLife: 1, size: 1 });
    }
    for (let i = 0; i < MAX_FLASH; i++) {
      const m = mesh(THREE, S.G.flash, S.M.flash, 0, -50, 0);
      m.visible = false;
      st.fxRoot.add(m);
      st.flashes.push({ mesh: m, active: false, t: 0, dur: 0.4 });
    }
  }

  const WEAPON_STYLE = {
    catapult: { mat: 'projRock', geo: 'proj', scale: 1, dur: 0.75, apex: 6 },
    firearrow: { mat: 'projFire', geo: 'proj', scale: 0.7, dur: 0.55, apex: 4 },
    trebuchet: { mat: 'projBig', geo: 'projBig', scale: 1, dur: 0.9, apex: 8 },
  };

  function spawnProjectile(from, to, weapon, power) {
    const slot = st.projectiles.find((p) => !p.active);
    if (!slot) {
      impactAt(to.x, to.y, to.z, power); // pool full: resolve instantly, never drop feedback
      return;
    }
    const style = WEAPON_STYLE[weapon] || WEAPON_STYLE.catapult;
    slot.mesh.geometry = st.shared.G[style.geo] || st.shared.G.proj;
    slot.mesh.material = st.shared.M[style.mat] || st.shared.M.projRock;
    slot.mesh.scale.setScalar(style.scale);
    slot.mesh.visible = true;
    slot.active = true;
    slot.t = 0;
    slot.dur = style.dur;
    slot.power = power;
    slot.from.copy(from);
    slot.to.copy(to);
    slot.ctrl.copy(from).add(to).multiplyScalar(0.5);
    slot.ctrl.y = Math.max(from.y, to.y) + style.apex;
  }

  function quadBezier(out, a, c, b, t) {
    const u = 1 - t;
    out.set(
      u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      u * u * a.y + 2 * u * t * c.y + t * t * b.y,
      u * u * a.z + 2 * u * t * c.z + t * t * b.z,
    );
    return out;
  }

  function impactAt(x, y, z, power) {
    spawnFlash(x, Math.max(0.4, y - 0.4), z, power >= 9 ? 0.55 : 0.4);
    if (!st.reduced) spawnDebris(x, y + 0.3, z, power, power >= 9 ? 'burst' : 'hit');
  }

  function spawnFlash(x, y, z, dur) {
    const slot = st.flashes.find((f) => !f.active) || st.flashes[0];
    if (!slot) return;
    slot.active = true;
    slot.t = 0;
    slot.dur = dur || 0.4;
    slot.mesh.visible = true;
    slot.mesh.position.set(x, y, z);
    slot.mesh.scale.set(0.6, 1, 0.6);
  }

  function spawnDebris(x, y, z, n, mix) {
    if (st.reduced && mix !== 'dust') n = Math.min(n, 0);
    let spawned = 0;
    for (const d of st.debris) {
      if (spawned >= n) break;
      if (d.active) continue;
      d.active = true;
      d.mesh.visible = true;
      d.mesh.position.set(x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.5);
      const sp = mix === 'burst' ? 6 : mix === 'dust' ? 2.5 : 4.5;
      d.vel.set((Math.random() - 0.5) * sp * 2, 3 + Math.random() * sp, (Math.random() - 0.5) * sp * 2);
      d.maxLife = 0.55 + Math.random() * 0.35;
      d.life = d.maxLife;
      d.size = (mix === 'dust' ? 0.7 : 0.9) + Math.random() * 0.6;
      d.mesh.scale.setScalar(d.size);
      const r = Math.random();
      d.mesh.material = mix === 'dust'
        ? st.shared.M.sand
        : r < 0.45 ? st.shared.M.debrisStone : r < 0.8 ? st.shared.M.debrisWood : st.shared.M.debrisSpark;
      d.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      spawned += 1;
    }
  }

  /* ---------------- picking, hover ghost, tap ---------------- */

  function pickCell(ndc) {
    if (st.disposed || !st.ready || !ndc) return null;
    try {
      st.raycaster.setFromCamera(ndc, st.camera);
      const hits = st.raycaster.intersectObjects([st.padsRoot, st.structRoot], true);
      for (const h of hits) {
        let o = h.object;
        while (o && !(o.userData && o.userData.cell)) o = o.parent;
        if (o && o.userData.cell) {
          const c = o.userData.cell;
          return { x: c.x, y: c.y, team: c.team };
        }
      }
    } catch { /* raycast must never break the frame loop */ }
    return null;
  }

  function safeCanTarget(x, y, team) {
    const sel = st.selection;
    if (!sel || typeof sel.canTarget !== 'function') return false;
    try {
      return !!sel.canTarget(x, y, team);
    } catch {
      return false;
    }
  }

  function refreshMarkers() {
    st.validPulse = [];
    for (const pad of st.pads.values()) {
      const ok = safeCanTarget(pad.x, pad.y, pad.team);
      pad.ring.visible = ok;
      if (ok) st.validPulse.push(pad.ring);
    }
  }

  function buildGhosts(THREE, S) {
    for (const piece of ['wall', 'tower', 'cannon', 'keep']) {
      const built = (BUILDERS[piece] || buildWall)(THREE, S, 'red', true);
      built.group.traverse((o) => {
        if (o.isMesh) {
          o.material = S.M.ghostOk;
          o.raycast = () => {};
        }
      });
      built.group.visible = false;
      st.ghosts.set(piece, built.group);
      st.ghostBox.add(built.group);
    }
  }

  function showGhost(piece, x, y, ok) {
    for (const [id, g] of st.ghosts) g.visible = id === piece;
    if (!piece || !st.ghosts.has(piece)) {
      st.ghostBox.visible = false;
      return;
    }
    const g = st.ghosts.get(piece);
    const mat = ok ? st.shared.M.ghostOk : st.shared.M.ghostBad;
    g.traverse((o) => {
      if (o.isMesh) o.material = mat;
    });
    const w = cellToWorld(st.arena, x, y);
    st.ghostBox.visible = true;
    st.ghostBox.position.set(w.x, Y0, w.z);
  }

  function applyHoverVisual(cell, notify) {
    st.lastHover = cell;
    if (!st.ready || st.disposed) return;
    if (!cell) {
      st.hoverRing.visible = false;
      showGhost(null);
    } else {
      const w = cellToWorld(st.arena, cell.x, cell.y);
      const ok = safeCanTarget(cell.x, cell.y, cell.team);
      st.hoverRing.visible = true;
      st.hoverRing.position.set(w.x, Y0 + 0.04, w.z);
      st.hoverRing.material = ok ? st.shared.M.hoverOk : st.shared.M.hoverBad;
      const sel = st.selection;
      const occupied = st.structs.has(`${cell.team}:${cell.x},${cell.y}`);
      if (sel && sel.mode === 'build' && !occupied && st.ghosts.has(sel.piece)) {
        showGhost(sel.piece, cell.x, cell.y, ok);
      } else {
        showGhost(null);
      }
    }
    if (notify && cb.onHover) {
      try {
        cb.onHover(cell ? { x: cell.x, y: cell.y, team: cell.team } : null);
      } catch { /* host callback must not break hover */ }
    }
  }

  function tapHit(hit) {
    if (st.disposed || !hit) return;
    if (!cb.onCell) return;
    try {
      cb.onCell({ x: hit.x, y: hit.y, team: hit.team });
    } catch { /* host callback must not break input */ }
  }

  /* ---------------- snapshots -> scene ---------------- */

  function coreMuzzle(team, out) {
    const o = st.lastObjectives && st.lastObjectives[team];
    if (o && Number.isInteger(o.x) && Number.isInteger(o.y)) {
      const w = cellToWorld(st.arena, o.x, o.y);
      return out.set(w.x, Y0 + 2.4, w.z);
    }
    const c = team === 'red' ? st.layout.redCenter : st.layout.blueCenter;
    return out.set(c.x, Y0 + 2.4, c.z);
  }

  function animateLogEntry(e) {
    if (!e || (e.kind !== 'hit' && e.kind !== 'destroy' && e.kind !== 'corefall')) return;
    if (!Number.isInteger(e.x) || !Number.isInteger(e.y)) return;
    if (e.by !== 'red' && e.by !== 'blue') return;
    const w = cellToWorld(st.arena, e.x, e.y);
    const power = e.kind === 'corefall' ? 13 : e.kind === 'destroy' ? 9 : 5;
    if (st.reduced) {
      impactAt(w.x, Y0 + 0.6, w.z, 0); // flash only, no flight or shrapnel
      return;
    }
    const from = coreMuzzle(e.by, st.tmpV).clone();
    spawnProjectile(from, { x: w.x, y: Y0 + 0.6, z: w.z }, e.weapon, power);
  }

  function disposeUniqueGeos(root) {
    if (!root || !st.shared) return;
    const shared = new Set(Object.values(st.shared.G));
    root.traverse((o) => {
      if (o.isMesh && o.geometry && !shared.has(o.geometry)) {
        try {
          o.geometry.dispose();
        } catch { /* best effort */ }
      }
    });
  }

  function rebuildStatic() {
    const old = st.staticRoot;
    if (old) {
      const dead = new Set();
      old.traverse((o) => dead.add(o));
      st.flags = st.flags.filter((f) => !dead.has(f.mesh));
      st.scene.remove(old);
      disposeUniqueGeos(old);
    }
    st.staticRoot = null;
    st.clouds = [];
    st.foam = [];
    st.water = null;
    st.layout = deriveLayout(st.arena);
    st.staticRoot = buildStatic(st.THREE, st.shared);
    st.scene.add(st.staticRoot);
    // Structures reference world Y only, but pads + fort centers moved.
    for (const [key, rec] of st.structs) {
      const w = cellToWorld(st.arena, rec.cell.x, rec.cell.y);
      rec.group.position.set(w.x, Y0, w.z);
      void key;
    }
  }

  function applyUpdate() {
    const S = st.pendingS;
    if (!S || !S.grids || st.disposed || !st.ready) return;
    if (S.arena && Number.isInteger(S.arena.cols) && Number.isInteger(S.arena.rows)) {
      if (arenaKeyOf(S.arena) !== arenaKeyOf(st.arena)) {
        st.arena = S.arena;
        rebuildStatic();
        rebuildPads(st.THREE, st.shared);
      }
    }
    const instance = S.instanceId !== undefined && S.instanceId !== null ? S.instanceId : '__none';
    const round = Number.isInteger(S.round) ? S.round : 1;
    const fresh = !st.baselined || instance !== st.lastInstance || round !== st.lastRound;
    if (fresh) {
      if (instance !== st.lastInstance) { st.seenLog.clear(); st.seenOrder.length = 0; }
      // New battle/round: place the truth instantly, admire nothing.
      for (const key of [...st.structs.keys()]) removeStruct(key, false);
      for (const p of st.projectiles) {
        p.active = false;
        p.mesh.visible = false;
      }
      for (const d of st.debris) {
        d.active = false;
        d.mesh.visible = false;
      }
      for (const f of st.flashes) {
        f.active = false;
        f.mesh.visible = false;
      }
      st.pops.length = 0;
    }
    const sig = gridSignature(S);
    if (fresh || sig !== st.lastSig) {
      syncGrids(st.THREE, st.shared, S, fresh || st.reduced);
      st.lastSig = sig;
    }
    syncSupplies(fresh);
    const entries = Array.isArray(S.log) ? S.log : [];
    if (fresh) {
      entries.forEach((e, i) => markSeen(logKey(e, i))); // baseline: never replay history
    } else {
      const freshEntries = [];
      entries.forEach((e, i) => {
        const k = logKey(e, i);
        if (!st.seenLog.has(k)) {
          markSeen(k);
          freshEntries.push(e);
        }
      });
      for (const e of freshEntries.slice(-MAX_ANIM_PER_UPDATE)) animateLogEntry(e);
    }
    st.lastObjectives = S.objectives || null;
    st.lastInstance = instance;
    st.lastRound = round;
    st.baselined = true;
    refreshMarkers();
    applyHoverVisual(st.lastHover, false); // cooldowns recolor the ghost in place
    if (!st.explicitCam && !st.autoFramed) {
      st.autoFramed = true;
      const team = st.selection && st.selection.team;
      if (S.phase === 'build' && (team === 'red' || team === 'blue')) applyPreset(team, true);
      else if (S.phase === 'siege' && (team === 'red' || team === 'blue')) applyPreset(foeOf(team), true);
      else applyPreset(null, true);
    }
  }

  /* ---------------- camera presets ---------------- */

  function currentAspect() {
    try {
      if (mountEl.clientWidth > 0 && mountEl.clientHeight > 0) {
        return mountEl.clientWidth / mountEl.clientHeight;
      }
    } catch { /* fall through */ }
    return st.camera ? st.camera.aspect || 1 : 1;
  }

  function applyPreset(team, instant) {
    if (!st.controls) return;
    const name = team === 'red' || team === 'blue' ? team : 'overview';
    st.camPreset = name;
    st.manualZoom = false;
    const p = camPreset(st.arena, team, currentAspect());
    st.controls.focus(p.target, {
      distance: p.distance, yaw: p.yaw, pitch: p.pitch, instant: instant || st.reduced,
    });
  }

  /* ---------------- frame loop ---------------- */

  let frameCount = 0;

  function frame(dt, t) {
    if (st.disposed || !st.ready) return;
    frameCount += 1;
    if (frameCount % 120 === 0 && st.gl) {
      try {
        st.reduced = st.gl && st.gl.canvas
          ? !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
          : st.reduced;
      } catch { /* keep last */ }
    }
    st.controls.update(dt);
    // Narrow portrait pulls the camera back into the cloud ring. Keep
    // decorative clouds beyond the fort, including under reduced motion.
    const orbitDistance = st.controls.getState().distance;
    for (const c of st.clouds) {
      c.mesh.visible = c.mesh.position.distanceTo(st.camera.position) - 3 * c.mesh.scale.x > orbitDistance;
    }
    const animate = !st.reduced;
    if (animate) {
      for (const f of st.flags) {
        f.mesh.rotation.y = Math.sin(t * 3 + f.phase) * 0.28;
      }
      for (const s of st.spinners) {
        s.mesh.rotation.y += dt * 0.9;
        s.mesh.position.y = s.baseY + Math.sin(t * 1.6 + s.phase) * 0.1;
      }
      for (const c of st.chests.values()) {
        c.group.position.y = c.baseY + Math.sin(t * 2 + c.phase) * 0.12;
      }
      for (const c of st.clouds) {
        c.mesh.position.x += dt * c.speed;
        if (c.mesh.position.x > 34) c.mesh.position.x = -34;
      }
      if (st.water) {
        st.water.position.y = 0.06 + Math.sin(t * 1.2) * 0.015;
        st.shared.M.water.opacity = 0.88 + Math.sin(t * 1.4) * 0.05;
      }
      for (const f of st.foam) {
        f.mesh.position.x += dt * f.speed;
        if (f.mesh.position.x > 12) f.mesh.position.x = -12;
      }
      const pulse = 1 + Math.sin(t * 2) * 0.018;
      for (const r of st.validPulse) r.scale.set(pulse, 1, pulse);
    }
    // Projectiles ride quadratic beziers, then resolve into capped debris.
    for (const p of st.projectiles) {
      if (!p.active) continue;
      p.t += dt / p.dur;
      if (p.t >= 1) {
        p.active = false;
        p.mesh.visible = false;
        impactAt(p.to.x, p.to.y, p.to.z, p.power);
      } else {
        quadBezier(p.mesh.position, p.from, p.ctrl, p.to, p.t);
        if (animate) p.mesh.rotation.x += dt * 7;
      }
    }
    for (const d of st.debris) {
      if (!d.active) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      d.vel.y -= 14 * dt;
      d.mesh.position.x += d.vel.x * dt;
      d.mesh.position.y += d.vel.y * dt;
      d.mesh.position.z += d.vel.z * dt;
      if (d.mesh.position.y < 0.05) {
        d.mesh.position.y = 0.05;
        d.vel.set(d.vel.x * 0.4, 0, d.vel.z * 0.4);
      }
      d.mesh.scale.setScalar(Math.max(0.01, d.size * (d.life / d.maxLife)));
    }
    for (const f of st.flashes) {
      if (!f.active) continue;
      f.t += dt / f.dur;
      if (f.t >= 1) {
        f.active = false;
        f.mesh.visible = false;
      } else {
        const s = 0.6 + f.t * 2.4;
        f.mesh.scale.set(s, 1, s);
      }
    }
    if (st.pops.length) {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      for (let i = st.pops.length - 1; i >= 0; i--) {
        const pop = st.pops[i];
        pop.t += dt / 0.35;
        if (pop.t >= 1 || !animate) {
          pop.group.scale.setScalar(1);
          st.pops.splice(i, 1);
        } else {
          const x = pop.t - 1;
          pop.group.scale.setScalar(Math.max(0.05, 1 + c3 * x * x * x + c1 * x * x));
        }
      }
    }
  }

  /* ---------------- GL assembly (shared lifecycle owns the canvas) ---------------- */

  function buildScene(THREE, helper) {
    st.THREE = THREE;
    st.reduced = helper.reducedMotion();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY_DUSK);
    scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
    const camera = new THREE.PerspectiveCamera(FOV, 4 / 3, 0.1, 500);
    scene.add(new THREE.HemisphereLight(0xdce5ff, 0x89b591, 2.4)); // readable golden-hour ambient
    const sun = new THREE.DirectionalLight(0xffd0a3, 2.6); // warm low sunset
    sun.position.set(-26, 13, -30);
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0xc3d7ff, 1.15); // cool eastern fill
    fill.position.set(30, 14, 18);
    scene.add(fill);

    st.scene = scene;
    st.camera = camera;
    st.shared = buildShared(THREE);
    st.layout = deriveLayout(st.arena);
    st.staticRoot = buildStatic(THREE, st.shared);
    scene.add(st.staticRoot);
    rebuildPads(THREE, st.shared);
    st.structRoot = new THREE.Group();
    scene.add(st.structRoot);
    st.fxRoot = new THREE.Group();
    scene.add(st.fxRoot);
    st.supplyRoot = new THREE.Group();
    scene.add(st.supplyRoot);
    st.ghostBox = new THREE.Group();
    st.ghostBox.visible = false;
    scene.add(st.ghostBox);
    buildGhosts(THREE, st.shared);
    st.hoverRing = mesh(THREE, st.shared.G.hoverRing, st.shared.M.hoverOk, 0, Y0 + 0.04, 0);
    noRaycast(st.hoverRing);
    st.hoverRing.visible = false;
    scene.add(st.hoverRing);
    initPools(THREE, st.shared);
    st.raycaster = new THREE.Raycaster();
    st.tmpV = new THREE.Vector3();

    const home = camPreset(st.arena, null, currentAspect());
    camera.position.set(home.target.x, 18, 24);
    camera.lookAt(home.target.x, home.target.y, home.target.z);
    st.controls = createArenaControls({
      element: helper.canvas(),
      camera,
      target: home.target,
      yaw: home.yaw,
      pitch: home.pitch,
      distance: home.distance,
      minDistance: MIN_DIST,
      maxDistance: MAX_DIST,
      minPitch: MIN_PITCH,
      maxPitch: MAX_PITCH,
      pick: (ndc) => pickCell(ndc),
      onTap: (hit) => tapHit(hit),
      onHover: (hit) => applyHoverVisual(hit, true),
      reducedMotion: () => st.reduced,
    });

    st.ready = true;
    if (st.pendingS) applyUpdate();
    return {
      scene,
      camera,
      frame,
      resize(w, h) {
        if (st.disposed || !st.camera) return;
        if (w > 0 && h > 0) {
          st.camera.aspect = w / h;
          st.camera.updateProjectionMatrix();
        }
        // Narrow-window refit only while the player hasn't taken the camera.
        try {
          if (st.controls) {
            const c = st.controls.getState();
            if (!c.userMoved && !st.manualZoom) applyPreset(st.camPreset === 'overview' ? null : st.camPreset, true);
            else if (!st.manualZoom && w / h < 1) st.controls.focus(c.target, { distance: Math.max(c.distance, fitDist(st.camPreset === 'overview' ? 38 : 18, w / h)), yaw: c.yaw, pitch: c.pitch, instant: true });
          }
        } catch { /* resize must never break rendering */ }
      },
    };
  }

  let handle = null;
  try {
    handle = await createThreeView(mountEl, {
      build: (THREE, helper) => buildScene(THREE, helper),
      onContextLost: () => {
        if (!st.disposed && cb.onUnavailable) {
          try {
            cb.onUnavailable();
          } catch { /* host callback must not throw */ }
        }
      },
    });
  } catch {
    return fallbackHandle('webgl-unavailable');
  }
  if (!handle || handle.fallback) {
    st.disposed = true;
    return fallbackHandle((handle && handle.reason) || 'webgl-unavailable');
  }
  st.gl = handle;
  if (typeof mountEl.isConnected === 'boolean' && !mountEl.isConnected) {
    // Unmounted while the async init was in flight: leave no canvas behind.
    disposeAll();
    return fallbackHandle('unmounted');
  }
  if (!st.controls) {
    try {
      handle.dispose();
    } catch { /* best effort */ }
    st.disposed = true;
    return fallbackHandle('build-failed');
  }

  function disposeAll() {
    if (st.disposed) return;
    st.disposed = true;
    st.ready = false;
    st.selection = null;
    st.pendingS = null;
    cb.onCell = null;
    cb.onHover = null;
    cb.onUnavailable = null;
    try {
      if (st.controls) st.controls.dispose();
    } catch { /* best effort */ }
    st.controls = null;
    try {
      if (st.gl) st.gl.dispose();
    } catch { /* best effort */ }
    st.gl = null;
    st.pads.clear();
    st.structs.clear();
    st.chests.clear();
    st.ghosts.clear();
    st.projectiles.length = 0;
    st.debris.length = 0;
    st.flashes.length = 0;
    st.pops.length = 0;
    st.flags.length = 0;
    st.spinners.length = 0;
    st.clouds.length = 0;
    st.foam.length = 0;
    st.validPulse.length = 0;
    st.seenLog.clear();
    st.seenOrder.length = 0;
  }

  return {
    fallback: false,
    update(S, selection) {
      if (st.disposed) return;
      if (selection !== undefined) st.selection = selection;
      if (S !== undefined) st.pendingS = S;
      if (st.ready) applyUpdate();
    },
    focus(team) {
      if (st.disposed || !st.ready) return;
      st.explicitCam = true;
      applyPreset(team, false);
    },
    resetCamera() {
      if (st.disposed || !st.ready) return;
      st.explicitCam = true;
      applyPreset(null, false);
    },
    zoom(direction) {
      if (st.disposed || !st.ready || !st.controls) return;
      let step = 0; // -1 zooms in (closer), +1 zooms out (farther)
      if (direction === 'in' || direction === '+' || direction === 'plus') step = -1;
      else if (direction === 'out' || direction === '-' || direction === 'minus') step = 1;
      else if (Number.isFinite(Number(direction))) {
        const n = Number(direction);
        if (n > 0) step = -1;
        else if (n < 0) step = 1;
        else return;
      } else return;
      let cur;
      try {
        cur = st.controls.getState();
      } catch {
        return;
      }
      if (!cur || !cur.goal) return;
      const base = Number(cur.goal.distance);
      if (!Number.isFinite(base)) return;
      const next = step < 0 ? base / 1.25 : base * 1.25;
      st.manualZoom = true;
      st.explicitCam = true;
      try {
        // controls.focus clamps to the existing min/max distance and
        // keeps the current fitting rules; target/yaw/pitch preserved.
        st.controls.focus(cur.goal.target, {
          distance: next,
          yaw: cur.goal.yaw,
          pitch: cur.goal.pitch,
        });
      } catch { /* zoom is a hint; orbit stays user-owned */ }
    },
    dispose() {
      disposeAll();
    },
  };
}
