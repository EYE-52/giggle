import {createRoadTerrain} from './kart-road-terrain.mjs';
import {buildTerrainRoads} from './kart-road-mesh.mjs';
/* Giggle Grove Circuit — kart arena art module (Three.js, no simulation).
 *
 * Owns ONLY static world dressing for the kart arena: procedural sky dome +
 * sun disk, shared driving terrain, low kerb + fence walls aligned to the playable
 * half-extent, map obstacle dressing (from the authoritative snapshot
 * blocks), boost-pad strips and grip-surface patches (from the snapshot pads
 * and surfaces), and layered scenery outside half+2 with a rolling terrain
 * apron feeding three mountain-ridge rings. Garden's soft meadow detail
 * between lanes remains noncolliding and below the kart silhouette.
 *
 * Contract: createKartWorld(THREE, { scene, palette, assets, map, half }) ->
 *   { syncMap(map), animate(dt, t, skyPhase), stats(), group, layout, bounds,
 *     palette, theme, half, groundAt }.
 * - palette: 'Daybreak' | 'Sunset' | 'Starlight' (string; objects with a
 *   matching .name are tolerated). Picks authored surface colors AND the
 *   base sky/lighting metadata the scene root applies (this module never
 *   touches scene.background / fog / lights itself — the sky dome, sun disk,
 *   and haze are plain meshes under the world root).
 * - assets: Kenney CC0 glTF scenes keyed tree_detailed, tree_pineTallA,
 *   rock_largeA, plant_bush, flower_purpleA, grandStandCoveredRound,
 *   pitsGarage, barrierRed, barrierWhite, flagCheckers, tentRoof. Each may be
 *   an Object3D or { scene }. Missing entries fall back to small procedural
 *   props so the world always builds. Clones are scaled from measured Box3
 *   bounds to intended heights — never from assumed units.
 * - map: { id, label, theme, half, bound, blocks, pads, surfaces } —
 *   authoritative server snapshot. opts.map fixes the world's visual theme
 *   AND playable half-extent for the mount (resolveMapTheme: 'garden' |
 *   'frost' | 'neon', else the classic grove look for 'ring' / 'blocks' /
 *   custom ids; resolveHalf prefers map.half, then map.bound+2, then
 *   opts.half, defaulting to 30). Every classic map's terrain comes from kart-road-terrain.mjs, shared with server/prediction.
 *   The server owns every rectangle. All solids inside the arena stay inside exact block
 *   footprints; original pad/surface footprints remain level. syncMap(map)
 *   redraws blocks/pads/surfaces from snapshot geometry, keyed on the
 *   geometry + half (never the timer or skyPhase), reusing shared
 *   geometries, materials and textures. Missing/empty arrays clear that
 *   layer. Half is fixed at mount like the theme: a half change needs a
 *   world rebuild (root recreates on map change); syncMap still keys on the
 *   incoming half so obstacle dressing refreshes.
 * - animate(dt, t, skyPhase): skyPhase is a nullable 0..1 number computed by
 *   the root from the snapshot skyCycle + calibrated server clock. null (or
 *   omitted/NaN) keeps the fixed chosen palette. Daybreak base blends
 *   Daybreak(0) -> Sunset(0.6) -> Starlight(1); Sunset base blends
 *   Sunset(0) -> Starlight(1); Starlight stays legible night (moon drifts).
 *   No Date.now or local elapsed clock is used here.
 *
 * Budgets: shared geometries/materials/textures only; syncMap rebuilds the
 * map groups alone; animate() allocates nothing and drives bounded motions
 * (balloon bob, cloud drift, pad pulse + chevron march, gradual sky blend).
 * Everything created here is added under one root group on the scene so the
 * owner's traverse-dispose covers it. World stays under 150K triangles.
 */

import {KART_R} from './kart-pose.mjs';

export const WORLD_ID = 'giggle-grove-circuit';
export const WORLD_BOUNDS = 30; // legacy playable half-extent; walls align here
export const WORLD_HALF_DEFAULT = 30; // ring/blocks legacy
export const WORLD_HALF_LARGE = 60; // garden/frost/neon (120x120, 4x area)
export const SCENERY_MIN = 32; // legacy: nothing but paint stands inside this radius
export const HILL_MIN = 75; // legacy: distant terrain starts beyond this

const PALETTES = {
  Daybreak: {
    sky: 0x0877e7, skyMid: 0x2da6ef, horizon: 0xb7def2,
    sun: 0xfff3da, sunIntensity: 2.1,
    sunDir: [0.45, 0.62, 0.64], sunDisc: 0xfff6d8, sunSize: 9,
    haze: 0xd5eaff, hazeOpacity: 0.18,
    hemiSky: 0xd9e6ff, hemiGround: 0x24344b, hemiIntensity: 0.65, fog: [110, 340],
    ground: 0x2fab49, verge: 0x208944, track: 0x344356, trackDark: 0x28364a,
    line: '#f5f8ff', kerbA: '#ff394f', kerbB: '#f5f8ff', rail: 0xff394f,
    path: 0xd9c9a8, dirt: '#9c6b4a',
    ridgeNear: 0x278745, ridgeFar: 0x507cad,
    cloud: 0xffffff, stars: false, asphaltGlow: 0, exposure: 1,
  },
  Sunset: {
    // Surfaces stay green + cool asphalt; warmth comes from sky/sun only.
    sky: 0x3d4a8c, skyMid: 0xd88ab8, horizon: 0xffb37a,
    sun: 0xffd9a8, sunIntensity: 1.5,
    sunDir: [0.55, 0.30, 0.62], sunDisc: 0xffdca0, sunSize: 13,
    haze: 0xffc4a0, hazeOpacity: 0.4,
    hemiSky: 0xf1d2e1, hemiGround: 0x28243d, hemiIntensity: 0.7, fog: [95, 300],
    ground: 0x369c4a, verge: 0x208944, track: 0x344056, trackDark: 0x263046,
    line: '#ffe3b3', kerbA: '#e14b5a', kerbB: '#fff2dc', rail: 0xd84b5a,
    path: 0xd9bfa0, dirt: '#8a5a3c',
    ridgeNear: 0x4d8f5e, ridgeFar: 0xc49ac0,
    cloud: 0xffd9c2, stars: false, asphaltGlow: 0, exposure: 0.96,
  },
  Starlight: {
    // Bright teal/lavender night: readable ground, glowing paint, stars.
    sky: 0x030612, skyMid: 0x0e2340, horizon: 0x2a5a7a,
    sun: 0xbfe0ff, sunIntensity: 0.9,
    sunDir: [-0.4, 0.55, 0.55], sunDisc: 0xe8f2ff, sunSize: 7,
    haze: 0x8fa8d8, hazeOpacity: 0.25,
    hemiSky: 0x9fb8e8, hemiGround: 0x1f6a5e, hemiIntensity: 0.9, fog: [70, 240],
    ground: 0x2f8f72, verge: 0x35a184, track: 0x4a5a7d, trackDark: 0x3f4d6e,
    line: '#ffd9a0', kerbA: '#0e9b8a', kerbB: '#f2ecff', rail: 0x0e9b8a,
    path: 0x5a6a8a, dirt: '#4a3f5e',
    ridgeNear: 0x1d6a5e, ridgeFar: 0x2a3f66,
    cloud: 0x5a7a9a, stars: true, asphaltGlow: 0.55, exposure: 1.08,
  },
};

function paletteName(palette) {
  const name = typeof palette === 'string' ? palette : (palette && palette.name);
  return PALETTES[name] ? name : 'Daybreak';
}

/* Playable half-extent. Prefers the authoritative map.half, then
 * map.bound+2 (bound is half-2 wall inset), then an explicit opts.half /
 * opts.bounds hint, defaulting to the 30 legacy arena. Clamped to a sane
 * dressing range so a corrupt snapshot cannot scatter the world. */
export function resolveHalf(map, opts) {
  const cands = [
    map && map.half,
    map && map.bound != null && Number.isFinite(Number(map.bound))
      ? Number(map.bound) + 2 : undefined,
    opts && opts.half,
    opts && opts.bounds && (opts.bounds.arena ?? opts.bounds.half),
  ];
  for (const c of cands) {
    const h = Number(c);
    if (Number.isFinite(h) && h >= 20 && h <= 80) return h;
  }
  return WORLD_HALF_DEFAULT;
}

export function resolveBound(map, half) {
  const b = map && Number(map.bound);
  if (Number.isFinite(b)) return b;
  return half - 2;
}

/* Integer hex color lerp without allocation (for the gradual sunset). */
function hexLerp(h1, h2, t) {
  const r1 = (h1 >> 16) & 255, g1 = (h1 >> 8) & 255, b1 = h1 & 255;
  const r2 = (h2 >> 16) & 255, g2 = (h2 >> 8) & 255, b2 = h2 & 255;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return (r << 16) | (g << 8) | b;
}

function numLerp(a, b, t) {
  return a + (b - a) * t;
}

function clampPhase(p) {
  if (p == null) return null;
  const n = Number(p);
  if (!Number.isFinite(n)) return null;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/* Visual themes. 'grove' is the classic Rookie Ring / Bumper Blocks look and
 * reads surface colors straight from PALETTES (never duplicated here, so the
 * old world cannot drift). garden/frost/neon override surfaces per palette;
 * sky, sun, haze, hemisphere and fog always come from PALETTES so the three
 * palettes stay visibly distinct on every map. */
export const WORLD_THEMES = ['grove', 'garden', 'frost', 'neon'];

export function resolveMapTheme(map) {
  const t = map && (map.theme || map.id);
  if (t === 'garden' || t === 'frost' || t === 'neon') return t;
  return 'grove'; // ring, blocks, custom ids, missing map: safe default
}

const THEME_SURF = {
  garden: {
    Daybreak: {
      ground: 0x35b84e, verge: 0x289347, track: 0x48535f, trackDark: 0x333e49,
      line: '#f5f8ff', kerbA: '#ff394f', kerbB: '#f5f8ff', rail: 0xff394f,
      path: 0xd9c9a8, dirt: '#7a5230',
      ridgeNear: 0x4b9c78, ridgeFar: 0x689cbb,
      cloud: 0xffffff, glow: 0, glowTrack: 0x3a4a6e, glowGrass: 0x0e3a2a, glowGrassI: 0.5,
    },
    Sunset: {
      ground: 0x32a74b, verge: 0x24883f, track: 0x48535f, trackDark: 0x333e49,
      line: '#ffe9c4', kerbA: '#ff394f', kerbB: '#fff2dc', rail: 0xef324d,
      path: 0xd9bfa0, dirt: '#6a4526',
      ridgeNear: 0x4d8f5e, ridgeFar: 0xc4a8b8,
      cloud: 0xffe4c8, glow: 0, glowTrack: 0x3a4a6e, glowGrass: 0x0e3a2a, glowGrassI: 0.5,
    },
    Starlight: {
      ground: 0x237955, verge: 0x1c7156, track: 0x273849, trackDark: 0x1c293d,
      line: '#ffe4b3', kerbA: '#0e9b8a', kerbB: '#f2ecff', rail: 0x0e9b8a,
      path: 0x5a6a8a, dirt: '#3f3a52',
      ridgeNear: 0x1d6a5e, ridgeFar: 0x2a3f66,
      cloud: 0x5a7a9a, glow: 0.5, glowTrack: 0x3a4a6e, glowGrass: 0x0e3a2a, glowGrassI: 0.5,
    },
  },
  frost: {
    Daybreak: {
      ground: 0xdceaf5, verge: 0xeef5fb, track: 0x596b7d, trackDark: 0x425568,
      line: '#ffffff', kerbA: '#3e9be0', kerbB: '#ffffff', rail: 0x3e9be0,
      path: 0xd8e6f2, dirt: '#b8d0e4',
      ridgeNear: 0xc8dcee, ridgeFar: 0xe8f2fa,
      cloud: 0xffffff, glow: 0, glowTrack: 0x6a8ab8, glowGrass: 0x4a6a8a, glowGrassI: 0.4,
    },
    Sunset: {
      ground: 0xd4c8e2, verge: 0xe8ddf0, track: 0x596b7d, trackDark: 0x425568,
      line: '#ffe9f2', kerbA: '#4a8ed4', kerbB: '#fff2f8', rail: 0x4a8ed4,
      path: 0xd4c8dc, dirt: '#b0a8cc',
      ridgeNear: 0xb8c4dc, ridgeFar: 0xe4c8dc,
      cloud: 0xffd9e8, glow: 0, glowTrack: 0x6a8ab8, glowGrass: 0x4a6a8a, glowGrassI: 0.4,
    },
    Starlight: {
      ground: 0x3a5a7a, verge: 0x46688a, track: 0x3a4e74, trackDark: 0x2f4266,
      line: '#bfe0ff', kerbA: '#2a7a9a', kerbB: '#d8ecff', rail: 0x2a7a9a,
      path: 0x3a4a68, dirt: '#2a3a58',
      ridgeNear: 0x2a4a66, ridgeFar: 0x3a5a8a,
      cloud: 0x4a6a8a, glow: 0.3, glowTrack: 0x6a8ab8, glowGrass: 0x4a6a8a, glowGrassI: 0.4,
    },
  },
  neon: {
    Daybreak: {
      ground: 0x1e3a46, verge: 0x24465a, track: 0x202033, trackDark: 0x10101e,
      line: '#7fd4ff', kerbA: '#ff2fb3', kerbB: '#d8f6ff', rail: 0x18c8d8,
      path: 0x2a3a4a, dirt: '#141c2a',
      ridgeNear: 0x1d3a4e, ridgeFar: 0x4a5a7a,
      cloud: 0xd8ecf8, glow: 0.15, glowTrack: 0x18c8d8, glowGrass: 0x0e4a5a, glowGrassI: 0.5,
    },
    Sunset: {
      ground: 0x24344a, verge: 0x2a3e5a, track: 0x242035, trackDark: 0x171226,
      line: '#ffb3dd', kerbA: '#ff2fb3', kerbB: '#ffe8f8', rail: 0x18c8d8,
      path: 0x302e48, dirt: '#181826',
      ridgeNear: 0x24344e, ridgeFar: 0x6a5a8a,
      cloud: 0xe8c8e0, glow: 0.15, glowTrack: 0x18c8d8, glowGrass: 0x0e4a5a, glowGrassI: 0.5,
    },
    Starlight: {
      ground: 0x0e1e30, verge: 0x14304a, track: 0x151221, trackDark: 0x10101b,
      line: '#8fe8ff', kerbA: '#ff2fb3', kerbB: '#d8f6ff', rail: 0x18c8d8,
      path: 0x1a2a40, dirt: '#0a1424',
      ridgeNear: 0x12283e, ridgeFar: 0x2a3f66,
      cloud: 0x3a5a7a, glow: 0.055, glowTrack: 0x18c8d8, glowGrass: 0x0e4a5a, glowGrassI: 0.12,
    },
  },
};

// Deterministic layout RNG (mulberry32) so every client mounts the same grove.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

/* Canvas texture helper. Returns null without a DOM (Node shape checks fall
 * back to flat materials) so this module never touches the network or UI. */
function canvasTexture(THREE, w, h, draw, opts) {
  if (typeof document === 'undefined') return null;
  const o = opts || {};
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (o.repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(o.repeat[0], o.repeat[1]);
  }
  return tex;
}

function sstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function speckle(ctx, w, h, rnd, n, colors, alpha, smin, smax) {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = alpha * (0.5 + rnd() * 0.5);
    ctx.fillStyle = colors[(rnd() * colors.length) | 0];
    const s = smin + rnd() * (smax - smin);
    ctx.fillRect(rnd() * w, rnd() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

/* ---- procedural fallback props (used only when a GLB template is absent) ---
 * Simple shaded originals sharing the module's fallback materials. Root QA
 * runs with the real Kenney templates; these keep Node checks meaningful. */
function buildFallback(THREE, kind, mats) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, sx, sy, sz, ry) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x || 0, y || 0, z || 0);
    if (sx !== undefined) m.scale.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz);
    if (ry) m.rotation.y = ry;
    g.add(m);
    return m;
  };
  if (kind === 'tree_detailed') {
    add(mats.geo.trunk, mats.trunk, 0, 1.1, 0);
    add(mats.geo.leaf, mats.leaf, 0, 2.9, 0);
    add(mats.geo.leaf, mats.leafLight, 0.7, 2.3, 0.3, 0.6);
  } else if (kind === 'tree_pineTallA') {
    add(mats.geo.trunk, mats.trunk, 0, 0.9, 0, 0.8);
    add(mats.geo.pine, mats.pine, 0, 2.6, 0);
    add(mats.geo.pine, mats.pine, 0, 3.6, 0, 0.7);
  } else if (kind === 'rock_largeA') {
    add(mats.geo.rock, mats.rock, 0, 0.5, 0);
  } else if (kind === 'plant_bush') {
    add(mats.geo.bush, mats.bush, 0, 0.45, 0);
    add(mats.geo.bush, mats.bush, 0.4, 0.3, 0.2, 0.6);
  } else if (kind === 'flower_purpleA') {
    add(mats.geo.stem, mats.bush, 0, 0.25, 0);
    add(mats.geo.bloom, mats.bloom, 0, 0.55, 0);
  } else if (kind === 'grandStandCoveredRound') {
    add(mats.geo.stand, mats.stand, 0, 1.4, 0);
    add(mats.geo.standRoof, mats.cream, 0, 3.0, 0);
  } else if (kind === 'pitsGarage') {
    add(mats.geo.garage, mats.garage, 0, 1.1, 0);
    add(mats.geo.garageRoof, mats.cream, 0, 2.4, 0);
  } else if (kind === 'tentRoof') {
    add(mats.geo.tent, mats.tent, 0, 1.4, 0);
  } else if (kind === 'flagCheckers') {
    add(mats.geo.pole, mats.cream, 0, 1.6, 0);
    add(mats.geo.flag, mats.flag, 0.45, 2.7, 0);
  } else { // barrierRed / barrierWhite
    add(mats.geo.barrier, kind === 'barrierWhite' ? mats.cream : mats.coral, 0, 0.35, 0);
  }
  return g;
}

export function createKartWorld(THREE, options) {
  const opts = options || {};
  const scene = opts.scene;
  if (!scene || typeof scene.add !== 'function') {
    throw new Error('createKartWorld: opts.scene (a THREE.Scene) is required');
  }
  const name = paletteName(opts.palette);
  const theme = resolveMapTheme(opts.map);
  // City lighting follows the approved violet/charcoal world, including
  // the same authoritative sunset progress; it never inherits park skies.
  const citySky={
    Daybreak:{sky:0x181a32,skyMid:0x49345f,horizon:0x715275,sunIntensity:1.2,hemiSky:0xaab2d2,hemiGround:0x25243a,hemiIntensity:.8,exposure:.88},
    Sunset:{sky:0x1d1736,skyMid:0x593653,horizon:0x85576c,sunIntensity:1.15,hemiSky:0xcaa0be,hemiGround:0x27203a,hemiIntensity:.8,exposure:.9},
    Starlight:{sky:0x080917,skyMid:0x19142d,horizon:0x392c55,hemiSky:0xabb6df,hemiGround:0x242038,hemiIntensity:.9,exposure:1.02},
  };
  const skyPalette=n=>theme==='neon'?Object.assign({},PALETTES[n],citySky[n]):PALETTES[n];
  const P = skyPalette(name);
  const assets = opts.assets || {};
  const map = opts.map || {};
  const half = resolveHalf(opts.map, opts);
  const terrain=createRoadTerrain({...map,id:map.id||theme,half});
  const groundAt=terrain?.heightAt||(()=>0);
  // Grounded props use the actual drawn floor skins, while wheel motion
  // and prop orientation continue to use the shared physical terrain.
  // Road faces are already clipped to grid cells: query only local faces.
  const propRoadCells=new Map(),propRoadStep=terrain?half*2/terrain.segments:1;
  const propCell=v=>Math.floor((v+half)/propRoadStep);
  function indexPropRoad(data){
    for(let i=0;i<data.length;i+=18){
      const ax=data[i],az=data[i+2],bx=data[i+6],bz=data[i+8],cx=data[i+12],cz=data[i+14];
      for(let z=propCell(Math.min(az,bz,cz));z<=propCell(Math.max(az,bz,cz));z++)for(let x=propCell(Math.min(ax,bx,cx));x<=propCell(Math.max(ax,bx,cx));x++){
        const key=z*(terrain.segments+2)+x;
        if(!propRoadCells.has(key))propRoadCells.set(key,[]);
        propRoadCells.get(key).push({data,i});
      }
    }
  }
  function propGroundAt(x,z){
    let height=groundAt(x,z);
    for(const p of layout.pads||[])if(Math.abs(x-p.x)<=p.hw&&Math.abs(z-p.z)<=p.hd)height=Math.max(height,.065);
    for(const s of layout.surfaces||[])if(Math.abs(x-s.x)<=s.hw&&Math.abs(z-s.z)<=s.hd)height=Math.max(height,.045);
    const faces=propRoadCells.get(propCell(z)*((terrain?.segments||0)+2)+propCell(x));
    if(faces)for(const face of faces){
      const {data:d,i}=face,ax=d[i],az=d[i+2],bx=d[i+6],bz=d[i+8],cx=d[i+12],cz=d[i+14];
      const den=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
      const a=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/den,b=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/den;
      if(a>=-1e-6&&b>=-1e-6&&a+b<=1+1e-6)height=Math.max(height,a*d[i+1]+b*d[i+7]+(1-a-b)*d[i+13]);
    }
    return height;
  }
  const bound = resolveBound(opts.map, half);
  const wallFace = bound + KART_R;
  const wallOffset = wallFace + 0.5;
  const sceneryMin = half + 2;
  const hillMin = half + 45;
  const halfScale = half / WORLD_HALF_DEFAULT;
  const isLarge = half > 40;
  const identity = map.id || theme;
  const quarry = identity === 'blocks';
  // Outdoor arenas use asphalt; surface overrides preserve each map's identity.
  const S = theme === 'grove'
    ? Object.assign({}, P, { track: map.id === 'blocks' ? 0x394353 : P.track, trackDark: map.id === 'blocks' ? 0x2a3342 : P.trackDark, glow: P.asphaltGlow, glowTrack: 0x3a4a6e, glowGrass: 0x0e3a2a, glowGrassI: 0.5 })
    : Object.assign({}, P, THEME_SURF[theme][name]);
  if (quarry) Object.assign(S, {ground: 0x9f9980, verge: 0xa6a38d, path: 0xb8b09b, ridgeNear: 0x9e9d93, ridgeFar: 0xa5b3bf});
  // Night glow targets for the gradual sunset: colors are constant per
  // theme across palettes; only intensity fades with nightness.
  const nightSurf = theme === 'grove'
    ? { glow: PALETTES.Starlight.asphaltGlow, glowTrack: 0x3a4a6e, glowGrass: 0x0e3a2a, glowGrassI: 0.5 }
    : THEME_SURF[theme].Starlight;
  const rnd = mulberry32(20261006);
  // Themed branches draw from their own stream so grove's sequence is fixed.
  const trnd = mulberry32(20261006 + (theme === 'garden' ? 11 : theme === 'frost' ? 23 : theme === 'neon' ? 47 : 0));

  const root = new THREE.Group();
  root.name = WORLD_ID;
  scene.add(root);

  const std = (color, extra) => new THREE.MeshStandardMaterial(
    Object.assign({ color, roughness: 0.9, metalness: 0 }, extra || {}));
  const basic = (color, extra) => new THREE.MeshBasicMaterial(
    Object.assign({ color }, extra || {}));

  // Template cache: measured heights so clones scale by bounds, not guesses.
  const templateHeight = new Map();
  const scratchBox = new THREE.Box3();
  const scratchSize = new THREE.Vector3();
  const scratchCenter = new THREE.Vector3();
  function templateOf(key) {
    const a = assets[key];
    if (a && a.isObject3D) return a;
    if (a && a.scene && a.scene.isObject3D) return a.scene;
    return null;
  }
  function measuredHeight(obj) {
    if (templateHeight.has(obj)) return templateHeight.get(obj);
    scratchBox.setFromObject(obj);
    scratchBox.getSize(scratchSize);
    const h = Math.max(0.001, scratchSize.y);
    templateHeight.set(obj, h);
    return h;
  }
  // Clone a template (or fallback) scaled to `height`, grounded at y=0 and
  // recentered in XZ so template origin offsets never shift placement.
  function instantiate(key, x, z, height, rotY, fallback) {
    const tpl = templateOf(key);
    const obj = tpl ? tpl.clone(true) : fallback();
    const h0 = measuredHeight(tpl || obj);
    const s = height / h0;
    obj.scale.setScalar(s);
    obj.rotation.y = rotY || 0;
    obj.position.set(0, 0, 0);
    obj.updateMatrixWorld(true);
    scratchBox.setFromObject(obj);
    scratchBox.getCenter(scratchCenter);
    const minY = scratchBox.min.y;
    obj.position.set(x - scratchCenter.x, -minY, z - scratchCenter.z);
    obj.updateMatrixWorld(true);
    return obj;
  }
  function faceOrigin(obj, x, z) {
    // Yaw so the object's +z nose points from (x,z) back at the origin.
    obj.rotation.y = Math.atan2(-x, -z);
  }
  // Shrink an obstacle top (bush/rock templates are wider than tall) so its
  // XZ bbox fits maxFoot, then recenter on (cx, cz) and ground on baseY.
  // Runs only on keyed syncMap rebuilds, reusing the scratch box/vectors.
  function fitTop(obj, cx, cz, baseY, maxFoot) {
    obj.updateMatrixWorld(true);
    scratchBox.setFromObject(obj);
    scratchBox.getSize(scratchSize);
    const span = Math.max(scratchSize.x, scratchSize.z);
    if (span > maxFoot && span > 0) obj.scale.multiplyScalar(maxFoot / span);
    obj.updateMatrixWorld(true);
    scratchBox.setFromObject(obj);
    scratchBox.getCenter(scratchCenter);
    obj.position.x += cx - scratchCenter.x;
    obj.position.z += cz - scratchCenter.z;
    obj.position.y += baseY - scratchBox.min.y;
    obj.updateMatrixWorld(true);
    return obj;
  }

  /* ---- fallback materials + shared unit geometries ---- */
  const fallbackMats = {
    trunk: std(0x8a5a2b), leaf: std(0x2e9e5b), leafLight: std(0x55c07a),
    pine: std(0x1f7a4e), rock: std(0x8d99a8), bush: std(0x3fae62),
    bloom: std(0x9a6ee8), stand: std(S.rail), cream: std(0xfff6e8),
    garage: std(0x3e9be0), tent: std(0xffb020), coral: std(0xe14b5a),
    flag: std(0x23202e),
    geo: {
      trunk: new THREE.CylinderGeometry(0.22, 0.34, 2.2, 7),
      leaf: new THREE.IcosahedronGeometry(1.5, 1),
      pine: new THREE.ConeGeometry(1.3, 2.6, 8),
      rock: new THREE.DodecahedronGeometry(0.9, 0),
      bush: new THREE.IcosahedronGeometry(0.55, 1),
      stem: new THREE.CylinderGeometry(0.04, 0.05, 0.5, 5),
      bloom: new THREE.IcosahedronGeometry(0.16, 0),
      stand: new THREE.BoxGeometry(6, 2.8, 4),
      standRoof: new THREE.BoxGeometry(6.6, 0.4, 4.6),
      garage: new THREE.BoxGeometry(4, 2.2, 3.4),
      garageRoof: new THREE.BoxGeometry(4.4, 0.35, 3.8),
      tent: new THREE.ConeGeometry(2.6, 2.2, 4),
      pole: new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6),
      flag: new THREE.BoxGeometry(0.9, 0.6, 0.06),
      barrier: new THREE.BoxGeometry(1.9, 0.7, 0.5),
    },
  };
  const fallbackFor = (key) => () => buildFallback(THREE, key, fallbackMats);

  /* ---- painted ground: verge + circuit plaza (paint only) ---- */
  const grassTex = canvasTexture(THREE, 512, 512, (ctx, w, h) => {
    ctx.fillStyle = hexCss(S.verge);
    ctx.fillRect(0, 0, w, h);
    if (theme === 'frost') {
      // Snow verge: soft drift blobs + sparkle, no mow stripes.
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.beginPath();
        ctx.ellipse(trnd() * w, trnd() * h, 30 + trnd() * 70, 18 + trnd() * 40,
          trnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      speckle(ctx, w, h, trnd, 1500, ['#ffffff', '#b8d0e4', '#e8f2fa'], 0.10, 1, 3);
      speckle(ctx, w, h, trnd, 220, ['#ffffff'], 0.5, 1, 2);
    } else if (theme === 'neon') {
      // Dark paved yard: faint panel grid + fine grain.
      ctx.strokeStyle = 'rgba(127,212,255,0.10)';
      ctx.lineWidth = 2;
      for (let i = 1; i < 8; i++) {
        ctx.beginPath(); ctx.moveTo((i * w) / 8, 0); ctx.lineTo((i * w) / 8, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (i * h) / 8); ctx.lineTo(w, (i * h) / 8); ctx.stroke();
      }
      speckle(ctx, w, h, trnd, 1400, ['#7fd4ff', '#0a1424', '#3a5a7a'], 0.08, 1, 2);
    } else {
      // Mown stripes + speckle: a kept park lawn, not flat color.
      // Grove keeps the original stream; garden draws from its own.
      const R = theme === 'grove' ? rnd : trnd;
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,40,10,0.06)';
        ctx.fillRect(0, (i * h) / 8, w, h / 8);
      }
      speckle(ctx, w, h, R, 2200, ['#ffffff', '#0a3a1a', '#d8f3c8'], 0.07, 1, 3);
    }
  });
  // One authored set of paths drives road paint and sharp geometry dashes.
  // Thin lane marks cannot resolve on a whole-map 117-metre texture atlas.
  const roadRoutes=[];
  // All classic maps use the shared driving mesh. Author real ribbons, not
  // a floor-sized road image; the clipper conforms every face to its cell.
  const sampleRoute=path=>path.getSpacedPoints(Math.ceil(path.getLength()/2));
  function roundedLoop(extent,radius,width) {
    const p=new THREE.Path(),a=extent-radius;
    p.moveTo(-a,-extent);p.lineTo(a,-extent);p.quadraticCurveTo(extent,-extent,extent,-a);
    p.lineTo(extent,a);p.quadraticCurveTo(extent,extent,a,extent);
    p.lineTo(-a,extent);p.quadraticCurveTo(-extent,extent,-extent,a);
    p.lineTo(-extent,-a);p.quadraticCurveTo(-extent,-extent,-a,-extent);
    roadRoutes.push({points:sampleRoute(p),width,curb:true});
  }
  function lane(coords,width) {
    const p=new THREE.Path();p.moveTo(...coords[0]);
    for(const point of coords.slice(1))p.lineTo(...point);
    roadRoutes.push({points:sampleRoute(p),width});
  }
  if(identity==='ring') {
    roundedLoop(21,11,7);
    lane([[-21,0],[21,0]],5.5);lane([[0,-21],[0,21]],5.5);
  } else if(identity==='blocks') {
    roundedLoop(24,3.5,4.5);
    lane([[-24,0],[24,0]],9);lane([[0,-24],[0,24]],9);
  } else if(theme==='frost') {
    roundedLoop(50,15,8);
    const rinkLink=new THREE.Path();rinkLink.moveTo(-50,-10);
    rinkLink.lineTo(-34,-10);rinkLink.quadraticCurveTo(-22,0,-12,0);
    rinkLink.lineTo(12,0);rinkLink.quadraticCurveTo(24,0,32,9);rinkLink.lineTo(50,12);
    roadRoutes.push({points:sampleRoute(rinkLink),width:10});lane([[0,-50],[0,50]],7);
    // These links skirt the rock cover and reach the four flat ice basins.
    lane([[-47,-34],[-14,-40],[0,-40],[24,-40],[47,-28]],6);
    lane([[-47,34],[-24,42],[0,44],[24,42],[47,32]],6);
  } else if(theme==='neon') {
    roundedLoop(48,8,9);
    lane([[-48,-18],[-18,-18],[0,0],[18,18],[48,18]],8);
    lane([[0,-48],[0,-28],[12,-8],[4,16],[-6,38],[0,48]],7);
    lane([[-48,4],[-12,4],[16,-4],[48,-4]],6);
  }
  if(theme==='garden') {
    const perimeter=new THREE.Path();
    perimeter.moveTo(-32,-46);perimeter.lineTo(32,-46);perimeter.quadraticCurveTo(46,-46,46,-32);
    perimeter.lineTo(46,32);perimeter.quadraticCurveTo(46,46,32,46);
    perimeter.lineTo(-32,46);perimeter.quadraticCurveTo(-46,46,-46,32);
    perimeter.lineTo(-46,-32);perimeter.quadraticCurveTo(-46,-46,-32,-46);
    const northSouth=new THREE.Path();northSouth.moveTo(0,-46);northSouth.lineTo(0,-40);
    northSouth.bezierCurveTo(0,-36,11,-35,11,-28);northSouth.bezierCurveTo(11,-20,0,-20,0,-12);
    northSouth.lineTo(0,20);northSouth.bezierCurveTo(0,26,-8,26,-8,32);northSouth.lineTo(-8,40);northSouth.lineTo(0,46);
    const eastWest=new THREE.Path();eastWest.moveTo(-46,-14);
    eastWest.bezierCurveTo(-30,-12,-16,-9,0,0);eastWest.bezierCurveTo(15,9,28,9,46,0);
    const sample=path=>terrain?path.getSpacedPoints(Math.ceil(path.getLength()/2)):path.getPoints(32);
    roadRoutes.push({points:sample(perimeter),width:9,curb:true},
      {points:sample(northSouth),width:6},{points:sample(eastWest),width:7});
  }
  // Paths are authored in the original map dimensions, then scaled with
  // the authoritative arena extent. Custom half sizes retain safe setbacks.
  const routeScale=half/(isLarge?60:30);
  if(routeScale!==1)for(const route of roadRoutes){
    for(const point of route.points)point.multiplyScalar(routeScale);
    route.width*=routeScale;
  }
  const asphaltTex = terrain?canvasTexture(THREE,128,128,(ctx,w,h)=>{
    ctx.fillStyle=hexCss(S.track);ctx.fillRect(0,0,w,h);
    speckle(ctx,w,h,mulberry32(6105),2800,[hexCss(S.trackDark),'#7a8989','#abb4ac'],.12,.5,1.2);
  },{repeat:[1,1]}):canvasTexture(THREE, 1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = hexCss(theme === 'garden' ? S.verge : S.track);
    ctx.fillRect(0, 0, w, h);
    // Grove keeps the original stream; other themes draw from their own.
    const R = theme === 'grove' ? rnd : trnd;
    const grain = theme === 'garden' ? ['#b5c08b','#365e3e','#749457'] : theme === 'frost'
      ? ['#ffffff', '#7fa8cc', hexCss(S.trackDark)]
      : theme === 'neon'
        ? ['#7fd4ff', '#0a1424', hexCss(S.trackDark)]
        : ['#ffffff', '#10141f', hexCss(S.trackDark)];
    speckle(ctx, w, h, R, 5200, grain, 0.08, 1, 3);
    const plazaMeters = half * 2 - 3;
    const u = w / plazaMeters; // px per meter on the plaza
    if (theme === 'frost') {
      // Wind-polished ice: pale glide streaks, no tire scuffs.
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      for (let i = 0; i < 26; i++) {
        ctx.lineWidth = 2 + trnd() * 5;
        ctx.beginPath();
        const sx = trnd() * w, sy = trnd() * h;
        const len = (8 + trnd() * 20) * u, a = (trnd() - 0.5) * 0.6;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
        ctx.stroke();
      }
    } else if (theme === 'neon') {
      // Paved yard: dark paver grid with faint cyan seams.
      ctx.strokeStyle = 'rgba(127,212,255,0.14)';
      ctx.lineWidth = 2;
      for (let i = 1; i < 12; i++) {
        ctx.beginPath(); ctx.moveTo((i * w) / 12, 0); ctx.lineTo((i * w) / 12, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, (i * h) / 12); ctx.lineTo(w, (i * h) / 12); ctx.stroke();
      }
    } else if (theme !== 'garden') {
      // Tire-scuff arcs (faint, worn-in racing surface).
      ctx.strokeStyle = 'rgba(10,12,20,0.08)';
      for (let i = 0; i < 8; i++) {
        ctx.lineWidth = 6 + R() * 10;
        ctx.beginPath();
        const cx = R() * w, cy = R() * h, r = (6 + R() * 14) * u;
        const a0 = R() * Math.PI * 2;
        ctx.arc(cx, cy, r, a0, a0 + 0.5 + R() * 1.1);
        ctx.stroke();
      }
    }
    // Perimeter edging: dark rim + double keyline (paint only).
    ctx.strokeStyle = hexCss(S.trackDark);
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1.4 * u;
    ctx.strokeRect(1.1 * u, 1.1 * u, w - 2.2 * u, h - 2.2 * u);
    ctx.strokeStyle = S.line;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 7;
    ctx.strokeRect(2.6 * u, 2.6 * u, w - 5.2 * u, h - 5.2 * u);
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 3;
    ctx.strokeRect(3.8 * u, 3.8 * u, w - 7.6 * u, h - 7.6 * u);
    ctx.globalAlpha = 1;
    // Arena-specific painted routes. These stay flat: collisions and grip
    // still come exclusively from the map's authored blocks and surfaces.
    ctx.save();
    const loop = (rx, ry, width, color, dash = []) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
      ctx.beginPath(); ctx.ellipse(w / 2, h / 2, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    };
    if (theme === 'garden') {
      // One connected perimeter route and two passing cuts. These are
      // paint on the drivable plaza, never new walls or a changed grip map.
      const tile=document.createElement('canvas');tile.width=tile.height=64;
      const tileCtx=tile.getContext('2d'),roadRandom=mulberry32(6105);
      tileCtx.fillStyle='#606b71';tileCtx.fillRect(0,0,64,64);
      speckle(tileCtx,64,64,roadRandom,900,['#39474c','#89938f','#bcc3b5'],.15,.5,1.2);
      const roadPaint=ctx.createPattern(tile,'repeat');
      const route = ({points,width,curb}) => {
        ctx.beginPath();
        points.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](w/2+p.x*u,h/2+p.y*u));
        ctx.strokeStyle='#374b45';ctx.lineWidth=(width+1.6)*u;ctx.stroke();
        if (curb) {
          ctx.strokeStyle = '#edf0ec'; ctx.lineWidth = (width + 1.25) * u; ctx.stroke();
          ctx.strokeStyle = '#e53c4c'; ctx.setLineDash([2.0 * u, 2.0 * u]); ctx.stroke(); ctx.setLineDash([]);
        }
        else {ctx.strokeStyle='#b2b7a4';ctx.lineWidth=(width+.35)*u;ctx.stroke();}
        ctx.strokeStyle = roadPaint || '#606b71'; ctx.lineWidth = width * u; ctx.stroke();
      };
      const X = x => w / 2 + x * u, Z = z => h / 2 + z * u;
      route(roadRoutes[0]);
      // A small exposed plaza connects the crossing lanes, while meadow
      // between them remains legal drivable space with unchanged grip.
      ctx.fillStyle=roadPaint || '#606b71';ctx.beginPath();ctx.arc(X(0),Z(0),8.5*u,0,Math.PI*2);ctx.fill();
      route(roadRoutes[1]);route(roadRoutes[2]);
      // Physical cover receives its own kerb, so route markings never
      // imply a passage through a server-owned solid rectangle.
      ctx.strokeStyle = '#e9eeeb'; ctx.lineWidth = .5 * u;
      for (const b of map.blocks || []) ctx.strokeRect(X(b.x - b.hw) - .4*u, Z(b.z - b.hd) - .4*u,
        (2*b.hw+.8)*u, (2*b.hd+.8)*u);
      // Restrained rubber scuffs live on the exposed plaza, not grass.
      ctx.strokeStyle='rgba(24,37,42,.16)';ctx.lineWidth=.22*u;
      for(let i=0;i<5;i++){ctx.beginPath();ctx.arc(X((i-2)*1.1),Z((i%2)*1.6), (3.2+i*.5)*u,.4+i*.22,2.1+i*.19);ctx.stroke();}
    } else if (theme === 'frost') {
      // Frozen rink rings and fractured ice, distinct from asphalt lanes.
      loop(w * .34, h * .34, .6 * u, 'rgba(244,253,255,.7)');
      loop(w * .19, h * .19, .35 * u, 'rgba(30,134,168,.45)');
      ctx.strokeStyle='rgba(236,251,255,.48)';ctx.lineWidth=.18*u;
      for(let i=0;i<12;i++){const a=i*Math.PI/6;ctx.beginPath();
        ctx.moveTo(w*.5+Math.sin(a)*8*u,h*.5+Math.cos(a)*8*u);
        ctx.lineTo(w*.5+Math.sin(a+.12)*21*u,h*.5+Math.cos(a+.12)*21*u);
        ctx.lineTo(w*.5+Math.sin(a)*38*u,h*.5+Math.cos(a)*38*u);ctx.stroke();}
    } else if (theme === 'neon') {
      // A cargo yard with diagonal runway paint and loading-bay stencils.
      ctx.strokeStyle='#71d7dc';ctx.lineWidth=.35*u;ctx.globalAlpha=.65;
      for(const x of [.24,.76]){ctx.beginPath();ctx.moveTo(w*x,5*u);ctx.lineTo(w*x,h-5*u);ctx.stroke();}
      ctx.globalAlpha=.8;ctx.strokeStyle='#e863b9';ctx.lineWidth=1.1*u;
      for(let i=0;i<7;i++){const y=h*.29+i*5*u;ctx.beginPath();ctx.moveTo(w*.45,y);ctx.lineTo(w*.5,y+2*u);ctx.lineTo(w*.55,y);ctx.stroke();}
      ctx.globalAlpha=.5;ctx.lineWidth=.3*u;
      for(const b of map?.blocks||[]){const x=w*.5+b.x*u,y=h*.5+b.z*u;ctx.strokeRect(x-(b.hw+2)*u,y-(b.hd+2)*u,(b.hw*2+4)*u,(b.hd*2+4)*u);}
    } else if (map?.id === 'blocks') {
      // Four coloured bumper courts match the four real cover positions.
      const colors=['#edb284','#9fcaba','#c1a5d4','#dfcd80'];
      for(const [i,b]of (map.blocks||[]).entries()){const x=w*.5+b.x*u,y=h*.5+b.z*u;
        ctx.fillStyle=colors[i%4];ctx.globalAlpha=.55;ctx.fillRect(x-5*u,y-5*u,10*u,10*u);
        ctx.strokeStyle='#fff4db';ctx.lineWidth=.25*u;ctx.globalAlpha=.8;ctx.strokeRect(x-5.7*u,y-5.7*u,11.4*u,11.4*u);}
      ctx.globalAlpha=.5;loop(w*.24,h*.24,.35*u,'#fff4db',[1.3*u,1.3*u]);
    } else {
      // Rookie Ring: an unmistakable open racing oval, no cover islands.
      loop(w*.32,h*.32,6*u,'#839eb1');
      loop(w*.32,h*.32,.35*u,'#fff3cf',[1.7*u,1.2*u]);
      loop(w*.38,h*.38,.45*u,'#e8899a');
      loop(w*.26,h*.26,.45*u,'#efc76e');
    }
    ctx.restore();
    // Corner checker pads: small carnival flags laid as paint.
    const pad = (x0, y0) => {
      const n = 4, cell = 0.9 * u;
      for (let ix = 0; ix < n; ix++) {
        for (let iy = 0; iy < n; iy++) {
          ctx.fillStyle = (ix + iy) % 2 ? S.line : 'rgba(20,16,33,0.85)';
          ctx.globalAlpha = 0.7;
          ctx.fillRect(x0 + ix * cell, y0 + iy * cell, cell, cell);
        }
      }
      ctx.globalAlpha = 1;
    };
    const m = 5.6 * u, span = 4 * 0.9 * u;
    pad(m, m); pad(w - m - span, m); pad(m, h - m - span); pad(w - m - span, h - m - span);
    // Starting stripe: a small checkered start/finish band near the south
    // edge — the one loud racing mark on an otherwise quiet surface.
    {
      const cols = 12, rows = 2, cell = 0.9 * u;
      const bw = cols * cell, bh = rows * cell;
      const bx = (w - bw) / 2, by = h - 8.2 * u;
      for (let ix = 0; ix < cols; ix++) {
        for (let iy = 0; iy < rows; iy++) {
          ctx.fillStyle = (ix + iy) % 2 ? '#23202e' : '#fff6e8';
          ctx.globalAlpha = 0.92;
          ctx.fillRect(bx + ix * cell, by + iy * cell, cell, cell);
        }
      }
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = S.line;
      ctx.lineWidth = 4;
      ctx.strokeRect(bx - 4, by - 4, bw + 8, bh + 8);
      ctx.globalAlpha = 1;
    }
    // Sparse edge scatter; the center stays clean.
    const confetti = theme === 'frost'
      ? ['#ffffff', '#d8ecfa', '#b8d4ec']
      : theme === 'neon'
        ? ['#18e0f0', '#ff2fb3', '#7fd4ff', '#d8f6ff']
        : ['#ff7aa8', '#ffd54a', '#7fd4ff', '#fff6e8', '#8fd18a'];
    for (let i = 0; i < (theme === 'garden' ? 0 : 20); i++) {
      ctx.save();
      const edge = R();
      const px = edge < 0.5
        ? (R() < 0.5 ? 3 * u + R() * 9 * u : w - 12 * u + R() * 9 * u)
        : 3 * u + R() * (w - 6 * u);
      const py = edge < 0.5
        ? 3 * u + R() * (h - 6 * u)
        : (R() < 0.5 ? 3 * u + R() * 9 * u : h - 12 * u + R() * 9 * u);
      ctx.translate(px, py);
      ctx.rotate(R() * Math.PI);
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = confetti[(R() * confetti.length) | 0];
      ctx.fillRect(-0.25 * u, -0.07 * u, 0.5 * u, 0.14 * u);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  });
  const dirtTex = terrain ? null : canvasTexture(THREE, 256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const R = theme === 'grove' ? rnd : trnd;
    const g = ctx.createRadialGradient(w / 2, h / 2, 8, w / 2, h / 2, w / 2);
    g.addColorStop(0, S.dirt);
    g.addColorStop(0.72, S.dirt);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    // Irregular patch: several overlapping blobs, soft alpha edge.
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.ellipse(
        w / 2 + (R() - 0.5) * w * 0.4, h / 2 + (R() - 0.5) * h * 0.4,
        w * (0.2 + R() * 0.16), h * (0.16 + R() * 0.14), R() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    const dirtGrain = theme === 'frost'
      ? ['#ffffff', '#9fc4e4']
      : theme === 'neon' ? ['#0a1424', '#3a5a7a'] : ['#5a3a22', '#ffffff'];
    speckle(ctx, w, h, R, 500, dirtGrain, 0.08, 1, 3);
  });

  const outerGroundMat = std(S.ground, { roughness: 1 });
  const outerDetail = canvasTexture(THREE, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    speckle(ctx, w, h, rnd, 1600, ['#c8c8c8', '#ffffff', '#9a9a9a'], 0.16, 1, 3);
  }, { repeat: [40, 40] });
  if (outerDetail) outerGroundMat.map = outerDetail;

  const grassMat = std(0xffffff, { roughness: 1 });
  if (grassTex) grassMat.map = grassTex;
  else grassMat.color.set(S.verge);
  const asphaltMat = std(0xffffff, { roughness: 0.94 });
  if (asphaltTex) asphaltMat.map = asphaltTex;
  else asphaltMat.color.set(S.track);
  const roadBump=canvasTexture(THREE,512,512,(ctx,w,h)=>{
    ctx.fillStyle='#808080';ctx.fillRect(0,0,w,h);
    speckle(ctx,w,h,mulberry32(4891),24000,['#262626','#d8d8d8'],.18,.7,1.6);
  },{repeat:terrain?[1,1]:[32,32]});
  if(roadBump){roadBump.colorSpace=THREE.NoColorSpace;asphaltMat.bumpMap=roadBump;asphaltMat.bumpScale=.018;roadBump.anisotropy=16;}
  if(asphaltTex)asphaltTex.anisotropy=16;
  // Faintly luminous paint so the plaza reads under moonlight (and the
  // neon yard's pavement hums at every palette). Emissive colors are set
  // always (intensity 0 hides them) so the gradual sunset can fade the
  // night glow in without rebuilding materials.
  asphaltMat.emissive = new THREE.Color(nightSurf.glowTrack);
  asphaltMat.emissiveIntensity = S.glow;
  grassMat.emissive = new THREE.Color(nightSurf.glowGrass);
  grassMat.emissiveIntensity = S.glow > 0 ? S.glowGrassI : 0;
  const dirtMat = terrain ? null : std(0xffffff, {
    roughness: 1, transparent: true,
    polygonOffset: true, polygonOffsetFactor: -1,
  });
  if (dirtTex) { dirtMat.map = dirtTex; dirtMat.alphaMap = dirtTex; }
  else if (dirtMat) dirtMat.color.set(S.dirt);

  // Flat under all legal driving space and the paddock, then a rising
  // meadow shelf. The same height function grounds every nature instance.
  const apronHeight = (x, z) => {
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const n = .52 * Math.sin(x * .071 + .7) * Math.cos(z * .083 + 1.2)
      + .27 * Math.sin(x * .18 + z * .14) + .21 * Math.cos(x * .29 - z * .13);
    return sstep(half + 48, half + 90, edge) * (5.0 + n * 3.1);
  };
  const apronSize = 420 + Math.max(0, half - WORLD_HALF_DEFAULT) * 5;
  const apronGeo = new THREE.PlaneGeometry(apronSize, apronSize, 72, 72);
  {
    const pos = apronGeo.attributes.position, colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(S.ground), stone = new THREE.Color(quarry ? 0xc4bea8 : theme === 'frost' ? 0xe5eff4 : 0x989d86);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = -pos.getY(i), y = apronHeight(x, z)-.02;
      pos.setZ(i, y);
      const tint = .06 + .10 * (.5 + .5 * Math.sin(x * .09 + z * .13));
      c.copy(grass).lerp(stone, quarry ? .40 + tint : tint);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    apronGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    apronGeo.computeVertexNormals();
    outerGroundMat.color.setHex(0xffffff); outerGroundMat.vertexColors = true;
  }
  const outerGround = new THREE.Mesh(apronGeo, outerGroundMat);
  outerGround.name = 'terrain-apron';
  outerGround.rotation.x = -Math.PI / 2;
  root.add(outerGround);

  let groundGeometry;
  if(terrain){
    groundGeometry=new THREE.BufferGeometry();
    groundGeometry.setAttribute('position',new THREE.BufferAttribute(terrain.vertices,3));
    groundGeometry.setIndex(new THREE.BufferAttribute(terrain.indices,1));
    const uv=new Float32Array(terrain.vertices.length/3*2);
    for(let i=0;i<uv.length/2;i++){
      uv[i*2]=(terrain.vertices[i*3]+half)/(half*2);
      uv[i*2+1]=1-(terrain.vertices[i*3+2]+half)/(half*2);
    }
    groundGeometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));groundGeometry.computeVertexNormals();
  }else groundGeometry=new THREE.PlaneGeometry(half*2,half*2);
  const arenaGrass = new THREE.Mesh(groundGeometry, grassMat);
  arenaGrass.name=terrain?identity+'-driving-terrain':'arena-grass';
  if(!terrain)arenaGrass.rotation.x = -Math.PI / 2;
  arenaGrass.receiveShadow=true;
  root.add(arenaGrass);

  if(terrain){
    const layers=buildTerrainRoads(terrain,roadRoutes,{
      curbColors:[new THREE.Color(S.kerbA).toArray(),new THREE.Color(S.kerbB).toArray()],
      markingColor:new THREE.Color(S.line).toArray(),
      shoulderColor:new THREE.Color(theme==='frost'?0xaac7db:quarry?0xa69d87:theme==='neon'?0x526170:0x7f8864).toArray(),
    });
    for(const [key,data]of Object.entries(layers)){
      if(key!=='curbSides')indexPropRoad(data);
      const count=data.length/6,positions=new Float32Array(count*3),colors=new Float32Array(count*3),uv=new Float32Array(count*2);
      for(let i=0;i<count;i++){
        positions.set(data.subarray(i*6,i*6+3),i*3);colors.set(data.subarray(i*6+3,i*6+6),i*3);
        uv[i*2]=data[i*6]/3;uv[i*2+1]=data[i*6+2]/3;
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
      geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
      geometry.setIndex(Array.from({length:count},(_,i)=>i));geometry.computeVertexNormals();
      const material=key==='road'?asphaltMat:std(0xffffff,{vertexColors:true,roughness:1});
      const mesh=new THREE.Mesh(geometry,material);mesh.name=key==='markings'?identity+'-lane-paint':identity+'-road-'+key;
      mesh.receiveShadow=true;root.add(mesh);
    }
  }else{
    const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 - 3, half * 2 - 3), asphaltMat);
    asphalt.rotation.x = -Math.PI / 2;asphalt.position.y = 0.02;root.add(asphalt);
  }

  if(roadRoutes.length&&!terrain) {
    // A single static paint mesh stays crisp at chase distance without a
    // 4096 atlas. It has no collider and sits just above the existing road.
    const vertices=[],indices=[];
    for(const {points} of roadRoutes) {
      let paint=true,remaining=2.4;
      for(let i=1;i<points.length;i++) {
        const a=points[i-1],b=points[i],length=a.distanceTo(b);
        if(length<1e-6)continue;
        const tx=(b.x-a.x)/length,tz=(b.y-a.y)/length,px=-tz*.085,pz=tx*.085;
        let offset=0;
        while(offset<length-1e-6) {
          const span=Math.min(length-offset,remaining);
          if(paint && span>1e-6) {
            const x=a.x+tx*offset,z=a.y+tz*offset,bx=x+tx*span,bz=z+tz*span,n=vertices.length/3;
            vertices.push(x-px,.026,z-pz,bx-px,.026,bz-pz,x+px,.026,z+pz,bx+px,.026,bz+pz);
            indices.push(n,n+2,n+1,n+2,n+3,n+1);
          }
          offset+=span;remaining-=span;
          if(remaining<1e-6){paint=!paint;remaining=paint?2.4:2.0;}
        }
      }
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);geo.computeVertexNormals();
    const markings=new THREE.Mesh(geo,std(0xedf1ee,{roughness:1,polygonOffset:true,polygonOffsetFactor:-1}));
    markings.name='garden-lane-paint';markings.receiveShadow=true;root.add(markings);
  }

  const dirtGeo = terrain ? null : new THREE.PlaneGeometry(9, 7);
  const dirtSpots = isLarge
    ? [[11 * halfScale, 19.5 * halfScale, 0.4], [-13.5 * halfScale, -9.5 * halfScale, -0.7],
       [-20, 30, 0.9], [25, -25, -0.3], [0, 35, 1.2], [-30, 10, 2.1]]
    : [[11, 19.5, 0.4], [-13.5, -9.5, -0.7]];
  for (const [dx, dz, ry] of terrain?[]:dirtSpots) {
    const d = new THREE.Mesh(dirtGeo, dirtMat);
    d.rotation.x = -Math.PI / 2;
    d.rotation.z = ry;
    d.position.set(dx, 0.035, dz);
    root.add(d);
  }

  /* Wall solids sit outside the furthest legal hull, rather than centering
   * their thickness on the field edge and clipping a boundary kart. */
  const kerbTex = canvasTexture(THREE, 128, 32, (ctx, w, h) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? S.kerbA : S.kerbB;
      ctx.fillRect((i * w) / 8, 0, w / 8, h);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, h - 6, w, 6);
  }, { repeat: [Math.round(half), 1] });
  const kerbMat = std(0xffffff, { roughness: 0.7 });
  if (kerbTex) kerbMat.map = kerbTex;
  else kerbMat.color.set(S.kerbA);
  const kerbLen = half * 2 + 1.6;
  const kerbGeoX = new THREE.BoxGeometry(kerbLen, 0.5, 1.0);
  const kerbGeoZ = new THREE.BoxGeometry(1.0, 0.5, kerbLen);
  for (const [geo, x, z] of [
    [kerbGeoX, 0, -wallOffset], [kerbGeoX, 0, wallOffset], [kerbGeoZ, -wallOffset, 0], [kerbGeoZ, wallOffset, 0],
  ]) {
    const k = new THREE.Mesh(geo, kerbMat);
    k.position.set(x, 0.25, z);
    root.add(k);
  }

  // One InstancedMesh for every white pole: fence posts + tent, banner,
  // and bunting poles below. Single draw call, per-instance scale.
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 1, 8);
  const poleMat = std(0xf4f1fa, { roughness: 0.6 });
  const poleSpots = []; // [x, z, baseY, height]
  const fenceHeight=terrain?.wallHeight||1.6;
  {
    const nPole = Math.round((half * 2) / 6) + 1;
    for (let i = 0; i < nPole; i++) {
      const off = -half + i * 6;
      poleSpots.push([off, -wallOffset, 0.5, fenceHeight-.5], [off, wallOffset, 0.5, fenceHeight-.5],
        [-wallOffset, off, 0.5, fenceHeight-.5], [wallOffset, off, 0.5, fenceHeight-.5]);
    }
  }
  const railMat = std(S.rail, { roughness: 0.6 });
  // Rail night glow: neon hums always; other themes fade a teal rail glow
  // in with nightness (intensity 0 hides it by day).
  const nightRailColor = theme === 'frost' ? 0x2a7a9a : 0x0e9b8a;
  if (theme === 'neon') {
    // Controlled emissive: the yard rails hum cyan at every palette.
    railMat.emissive = new THREE.Color(0x18c8d8);
    railMat.emissiveIntensity = 0.55;
  } else {
    railMat.emissive = new THREE.Color(nightRailColor);
    railMat.emissiveIntensity = 0;
  }
  const railBaseI = theme === 'neon' ? 0.55 : 0;
  const railNightI = theme === 'neon' ? 0.55 : 0.7;
  const railLen = half * 2;
  const railGeoX = new THREE.BoxGeometry(railLen, 0.12, 0.12);
  const railGeoZ = new THREE.BoxGeometry(0.12, 0.12, railLen);
  for (const [geo, x, z] of [
    [railGeoX, 0, -wallOffset], [railGeoX, 0, wallOffset], [railGeoZ, -wallOffset, 0], [railGeoZ, wallOffset, 0],
  ]) {
    const r = new THREE.Mesh(geo, railMat);
    r.position.set(x, 1.42, z);
    root.add(r);
  }
  if(terrain) {
    // Readable open catch fencing matches the physical wall envelope. Fine
    // wire keeps mountains/GLB scenery visible above the low racing rail.
    const wire=[];
    for(const side of [-1,1]) {
      for(let off=-half;off<=half;off+=3) {
        wire.push(off,.5,side*wallOffset,off,fenceHeight,side*wallOffset,
          side*wallOffset,.5,off,side*wallOffset,fenceHeight,off);
      }
      for(let y=.5;y<fenceHeight;y+=.4)wire.push(-half,y,side*wallOffset,half,y,side*wallOffset,
        side*wallOffset,y,-half,side*wallOffset,y,half);
      wire.push(-half,fenceHeight,side*wallOffset,half,fenceHeight,side*wallOffset,
        side*wallOffset,fenceHeight,-half,side*wallOffset,fenceHeight,half);
    }
    const fence=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(wire,3)),
      new THREE.LineBasicMaterial({color:theme==='neon'?0x668798:0x627d83,transparent:true,opacity:.48}));
    fence.name=identity+'-catch-fence';fence.userData.boundaryHeight=fenceHeight;root.add(fence);
  }
  if (theme === 'neon') {
    // Four emissive wall-top strips (cyan N/S, magenta E/W): the yard's
    // signature accent, readable even at Daybreak. Shared geos/mats.
    const stripGeoX = new THREE.BoxGeometry(railLen, 0.09, 0.2);
    const stripGeoZ = new THREE.BoxGeometry(0.2, 0.09, railLen);
    const stripCyan = std(0x0a2a34, {
      roughness: 0.4, emissive: 0x18e0f0, emissiveIntensity: 1.6,
    });
    const stripMagenta = std(0x2a0a22, {
      roughness: 0.4, emissive: 0xff2fb3, emissiveIntensity: 1.6,
    });
    for (const [geo, mat, x, z] of [
      [stripGeoX, stripCyan, 0, -wallOffset], [stripGeoX, stripCyan, 0, wallOffset],
      [stripGeoZ, stripMagenta, -wallOffset, 0], [stripGeoZ, stripMagenta, wallOffset, 0],
    ]) {
      const s = new THREE.Mesh(geo, mat);
      s.name = 'neon-strip';
      s.position.set(x, 1.62, z);
      root.add(s);
    }
  }

  // Corner checkered flags + mid-side barrier accents (real GLB templates).
  const cornerFlags = [];
  for (const [fx, fz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
    const f = instantiate('flagCheckers', fx, fz, 5.2, Math.atan2(fx, fz) + Math.PI / 4,
      fallbackFor('flagCheckers'));
    root.add(f);
    cornerFlags.push(f);
  }
  const barrierKeys = ['barrierRed', 'barrierWhite', 'barrierWhite', 'barrierRed'];
  const barrierSpots = [
    [-8 * halfScale, -wallOffset, 0], [8 * halfScale, wallOffset, 0],
    [-wallOffset, 8 * halfScale, Math.PI / 2], [wallOffset, -8 * halfScale, Math.PI / 2],
  ];
  barrierSpots.forEach(([bx, bz, ry], i) => {
    const b = instantiate(barrierKeys[i % barrierKeys.length], bx, bz, 1.0, ry,
      fallbackFor(barrierKeys[i % barrierKeys.length]));
    // Actual GLB dimensions vary with normalization. Keep its inner face
    // beyond the legal collider, including procedural fallback dimensions.
    scratchBox.setFromObject(b);
    if (Math.abs(bx) > Math.abs(bz)) b.position.x += Math.sign(bx) * Math.max(0, wallFace - (bx > 0 ? scratchBox.min.x : -scratchBox.max.x));
    else b.position.z += Math.sign(bz) * Math.max(0, wallFace - (bz > 0 ? scratchBox.min.z : -scratchBox.max.z));
    b.name = 'arena-wall-accent';
    b.position.y = 0.5; // sit on top of the kerb
    root.add(b);
  });
  if (theme === 'garden') {
    // Track-side flags ringing the kerb: the garden's trackside signature.
    // They stand on the wall footprint (like the barriers), never in play.
    const gf = 15 * halfScale;
    for (const [fx, fz] of [
      [-gf, -wallOffset], [gf, -wallOffset], [-gf, wallOffset], [gf, wallOffset],
      [-wallOffset, -gf], [-wallOffset, gf], [wallOffset, -gf], [wallOffset, gf],
    ]) {
      const f = instantiate('flagCheckers', fx, fz, 3.2,
        Math.atan2(fx, fz) + Math.PI / 4, fallbackFor('flagCheckers'));
      f.position.y = 0.5;
      f.name = 'garden-flag';
      root.add(f);
      cornerFlags.push(f);
    }
  }

  /* ---- perimeter: gravel path loop + corner tire stacks (all outside) ---- */
  const gravelDraw = (ctx, w, h) => {
    ctx.fillStyle = hexCss(S.path);
    ctx.fillRect(0, 0, w, h);
    const R = theme === 'grove' ? rnd : trnd;
    const grit = theme === 'frost'
      ? ['#ffffff', '#b8d0e4', '#8aa5c4']
      : theme === 'neon' ? ['#7fd4ff', '#0a1424', '#3a5a7a'] : ['#ffffff', '#8a7a5e', '#5a4a38'];
    speckle(ctx, w, h, R, 700, grit, 0.18, 1, 3);
  };
  const pathLen = half * 2 + 8;
  const pathRepeat = Math.max(8, Math.round(pathLen / 4));
  const pathTexX = canvasTexture(THREE, 128, 128, gravelDraw, { repeat: [pathRepeat, 1] });
  const pathTexZ = canvasTexture(THREE, 128, 128, gravelDraw, { repeat: [1, pathRepeat] });
  const pathMatX = std(S.path, { roughness: 1 });
  const pathMatZ = std(S.path, { roughness: 1 });
  if (pathTexX) pathMatX.map = pathTexX;
  if (pathTexZ) pathMatZ.map = pathTexZ;
  const pathOff = half + 3;
  const pathGeoX = new THREE.PlaneGeometry(pathLen, 4);
  const pathGeoZ = new THREE.PlaneGeometry(4, pathLen + 2);
  for (const [geo, mat, x, z, y] of [
    [pathGeoX, pathMatX, 0, -pathOff, 0.015], [pathGeoX, pathMatX, 0, pathOff, 0.015],
    [pathGeoZ, pathMatZ, -pathOff, 0, 0.02], [pathGeoZ, pathMatZ, pathOff, 0, 0.02],
  ]) {
    const p = new THREE.Mesh(geo, mat);
    p.name = 'park-path';
    p.rotation.x = -Math.PI / 2;
    p.position.set(x, y, z);
    root.add(p);
  }
  const trackTireGeo = new THREE.TorusGeometry(0.55, 0.22, 8, 16);
  const trackTireMat = std(0x2b2733, { roughness: 0.95 });
  {
    const to = half + 5;
    for (const [tx, tz] of [[-to, -to], [to, -to], [-to, to], [to, to]]) {
      for (const ty of [0.1, 0.54]) {
        const tire = new THREE.Mesh(trackTireGeo, trackTireMat);
        tire.name = 'trackside-tire';
        tire.rotation.x = Math.PI / 2;
        tire.position.set(tx, ty, tz);
        root.add(tire);
      }
    }
  }

  /* ---- structures: grandstands, garage paddock, carnival tent ---- */
  const layout = { trees: [], rocks: [], bushes: [], flowers: [], structures: [] };
  const standOff = half + 16;
  const garageX = half + 16, garageZ = 10 * halfScale;
  const tentX = -(half + 16), tentZ = -14 * halfScale;
  const bannerX = half + 3.5;
  const keepOut = [ // [x, z, radius] tree/scatter exclusion zones
    [0, -standOff, 11], [0, standOff, 11], [garageX, garageZ, 10], [tentX, tentZ, 10], [bannerX, 0, 9],
  ];
  if(theme==='garden')keepOut.push([20,half+27,18]); // alpine village common
  const clearOf = (x, z, r) => keepOut.every(([kx, kz, kr]) =>
    Math.hypot(x - kx, z - kz) > kr + r);

  function addStructure(key, x, z, height, fbKey) {
    const o = instantiate(key, x, z, height, 0, fallbackFor(fbKey || key));
    faceOrigin(o, x, z);
    if(theme==='neon'&&key!=='pitsGarage')o.visible=false;
    root.add(o);
    layout.structures.push({ key, x, z, height });
    return o;
  }
  // Stand yaw verified from GLB vertices: seat rows rise toward -z (back),
  // glass press box sits at -z, roof mass overhangs +z — so +z is the open
  // seating front and faceOrigin aims the bleachers at the arena. Same +z
  // front holds for the garage (door mass at +z).
  addStructure('grandStandCoveredRound', 0, -standOff, 9); // north stand
  addStructure('grandStandCoveredRound', 0, standOff, 9); // south stand
  addStructure('pitsGarage', garageX, garageZ, 4.5); // east paddock garage
  // West carnival tent: the Kenney piece is a roof shell (open underside, rim
  // at its local base), so it flies on four poles instead of sitting grounded.
  const tent = addStructure('tentRoof', tentX, tentZ, 3.4);
  tent.position.y += 2.6; // fly the rim at pole height; apex reads ~6.0
  for (const [ox, oz] of [[-1.1, -1.1], [1.1, -1.1], [-1.1, 1.1], [1.1, 1.1]]) {
    poleSpots.push([tentX + ox, tentZ + oz, 0, 2.6]);
  }

  // East gate banner: original Giggle signage, a landmark from any heading.
  const bannerTex = canvasTexture(THREE, 512, 128, (ctx, w, h) => {
    ctx.fillStyle = '#0e7a6e';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 32; i++) { // checker hems, top + bottom
      ctx.fillStyle = i % 2 ? '#fff6e8' : '#23202e';
      ctx.fillRect((i * w) / 32, 0, w / 32, 12);
      ctx.fillRect((i * w) / 32, h - 12, w / 32, 12);
    }
    ctx.fillStyle = '#fff6e8';
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const title=theme==='neon'?'NEON YARD':theme==='garden'?'ALPINE CIRCUIT':theme==='frost'?'FROSTY PASS':quarry?'QUARRY BLOCKS':'VILLAGE RING';
    ctx.fillText(title, w / 2, h / 2 + 2);
  });
  poleSpots.push([bannerX, -5.5, 0, 6.4], [bannerX, 5.5, 0, 6.4]);
  const bannerMat = basic(0x0e7a6e, { side: THREE.DoubleSide });
  if (bannerTex) bannerMat.map = bannerTex;
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(11.4, 2.3), bannerMat);
  banner.rotation.y = -Math.PI / 2;
  banner.position.set(bannerX, 5.0, 0);
  root.add(banner);

  // Bunting strings (north + south): restrained carnival trim outside the walls.
  const pennantColors = [0xff7aa8, 0xffd54a, 0x7fd4ff, 0xfff6e8, 0x8fd18a];
  const buntOff = half + 3.5;
  const buntSpan = half * 0.8;
  for (const bz of theme==='neon'?[]:[-buntOff, buntOff]) {
    poleSpots.push([-buntSpan, bz, 0, 4.8], [buntSpan, bz, 0, 4.8]);
    const a = new THREE.Vector3(-buntSpan, 4.7, bz);
    const b = new THREE.Vector3(buntSpan, 4.7, bz);
    const curve = new THREE.QuadraticBezierCurve3(a, new THREE.Vector3(0, 1.3, bz), b);
    const ropeGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
    root.add(new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0xfff6e8 })));
    const nPen = 13;
    const pos = new Float32Array(nPen * 9);
    const col = new Float32Array(nPen * 9);
    const c = new THREE.Color();
    const pt = new THREE.Vector3();
    const tan = new THREE.Vector3();
    for (let i = 0; i < nPen; i++) {
      const t = 0.06 + (0.88 * i) / (nPen - 1);
      curve.getPoint(t, pt);
      curve.getTangent(t, tan);
      const hw = 0.45;
      const ax = pt.x - tan.x * hw, az = pt.z - tan.z * hw;
      const ex = pt.x + tan.x * hw, ez = pt.z + tan.z * hw;
      pos.set([ax, pt.y, az, ex, pt.y, ez, pt.x, pt.y - 1.0, pt.z], i * 9);
      c.set(pennantColors[i % pennantColors.length]);
      for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], i * 9 + k * 3);
    }
    const penGeo = new THREE.BufferGeometry();
    penGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    penGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    penGeo.computeVertexNormals();
    root.add(new THREE.Mesh(penGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide,
    })));
  }

  // All white poles in one instanced draw.
  {
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, poleSpots.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pv = new THREE.Vector3();
    const sv = new THREE.Vector3();
    poleSpots.forEach(([x, z, baseY, ph], i) => {
      pv.set(x, baseY + ph / 2, z);
      sv.set(1, ph, 1);
      m4.compose(pv, q, sv);
      poles.setMatrixAt(i, m4);
    });
    poles.instanceMatrix.needsUpdate = true;
    root.add(poles);
  }

  /* ---- authored alpine nature: clustered firs, limestone and ridges ---- */
  // All instances share geometry/materials. No tree clone creates a new
  // draw call, and the scene never relies on random client-side time.
  const vrnd = mulberry32(7007 + (quarry ? 3 : theme === 'frost' ? 11 : theme === 'neon' ? 17 : isLarge ? 5 : 1));
  const foliagePos = [], foliageCol = [];
  const needle = new THREE.Color(), lightNeedle = new THREE.Color(theme === 'frost' ? 0xe1edf1 : 0x648959);
  const darkNeedle = new THREE.Color(theme === 'frost' ? 0x3a6058 : 0x214b3d);
  for (let tier = 0; tier < 6; tier++) {
    const base = .20 + tier * .117, radius = .205 * (1 - tier * .128);
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2 + tier * .43, b = (i+1) / 18 * Math.PI * 2 + tier * .43;
      const r1 = radius * (i % 2 ? .80 : 1), r2 = radius * (i % 2 ? 1 : .80);
      const y1 = base + .012 * Math.sin(i * 2.3), y2 = base + .012 * Math.sin((i+1) * 2.3);
      const vertices = [[0, base + .27 - tier * .014, 0], [Math.cos(a)*r1, y1, Math.sin(a)*r1], [Math.cos(b)*r2, y2, Math.sin(b)*r2]];
      for (let v = 0; v < 3; v++) {
        foliagePos.push(...vertices[v]);
        const snow = theme === 'frost' && (tier > 1 || i % 5 === 0);
        needle.copy(darkNeedle).lerp(lightNeedle, snow ? .85 : .20 + .35 * ((i+tier)%4)/3 + (v ? .08 : 0));
        foliageCol.push(needle.r,needle.g,needle.b);
      }
    }
  }
  const firGeo = new THREE.BufferGeometry();
  firGeo.setAttribute('position',new THREE.Float32BufferAttribute(foliagePos,3));
  firGeo.setAttribute('color',new THREE.Float32BufferAttribute(foliageCol,3));
  firGeo.computeVertexNormals();
  const firMat = std(0xffffff,{vertexColors:true,roughness:1,side:THREE.DoubleSide});
  const trunkGeo = new THREE.CylinderGeometry(.037,.070,.67,7); trunkGeo.translate(0,.335,0);
  const trunkMat = std(0x6b5543,{roughness:1});
  const rockSource = new THREE.IcosahedronGeometry(1,1);
  const rockGeo = rockSource.index ? rockSource.toNonIndexed() : rockSource;
  const rockPos = rockGeo.attributes.position, rockCols = new Float32Array(rockPos.count*3), rockColor = new THREE.Color();
  for (let i=0;i<rockPos.count;i++) {
    const x=rockPos.getX(i),y=rockPos.getY(i),z=rockPos.getZ(i);
    const noise=1+.12*Math.sin(x*8+z*5)*Math.sin(y*7+1);
    rockPos.setXYZ(i,x*noise,y*.64*noise+.64,z*noise);
    rockColor.setHex(theme==='frost'&&y>.15?0xeaf1f5:quarry?0xbdb7a5:0xaaa999);
    rockColor.multiplyScalar(.83+.14*((Math.floor(i/3)*7)%11)/10);
    rockCols.set([rockColor.r,rockColor.g,rockColor.b],i*3);
  }
  rockGeo.setAttribute('color',new THREE.BufferAttribute(rockCols,3));rockGeo.computeVertexNormals();
  const rockMat=std(0xffffff,{vertexColors:true,roughness:1,flatShading:true});
  const forest=[],outcrops=[];
  layout.clusters=[];layout.ridgePines=[];
  const safe = (x,z,pad=0) => Math.max(Math.abs(x),Math.abs(z)) >= sceneryMin + pad;
  const nClusters = theme==='neon'?0:quarry?4:theme==='garden'?15:theme==='frost'?12:9;
  for(let ci=0;ci<nClusters;ci++) {
    let cx,cz;
    for(let tries=0;tries<60;tries++) {
      const a=ci/nClusters*Math.PI*2+(vrnd()-.5)*.24,r=half+17+vrnd()*16;
      cx=Math.cos(a)*r;cz=Math.sin(a)*r;
      if(safe(cx,cz,8)&&clearOf(cx,cz,5))break;
    }
    if(!safe(cx,cz,8)||!clearOf(cx,cz,5))continue;
    layout.clusters.push({x:cx,z:cz});
    const n=quarry?3:5;
    for(let ti=0;ti<n;ti++) {
      const angle=vrnd()*Math.PI*2,dist=vrnd()*5.2;
      const x=cx+Math.cos(angle)*dist,z=cz+Math.sin(angle)*dist,h=8+vrnd()*7;
      if(!safe(x,z,4))continue;
      const item={x,z,h,ry:vrnd()*Math.PI*2};forest.push(item);layout.trees.push(item);
    }
    for(let ri=0;ri<(quarry?5:1);ri++) {
      const x=cx+(vrnd()-.5)*12,z=cz+(vrnd()-.5)*12;
      const h=1.4+vrnd()*3.0;
      if(!safe(x,z,h*1.25))continue;
      const item={x,z,h,ry:vrnd()*Math.PI*2};outcrops.push(item);layout.rocks.push(item);
    }
  }
  // A second forest shelf creates distance, rather than lonely giant trees
  // on an empty lawn. Chebyshev clearance also holds at diagonal corners.
  for(let i=0;i<(theme==='neon'?0:quarry?12:isLarge?66:36);i++) {
    const a=i/(isLarge?66:36)*Math.PI*2+vrnd()*.18,r=half+42+vrnd()*26;
    const x=Math.cos(a)*r,z=Math.sin(a)*r;
    if(!safe(x,z,9))continue;
    const item={x,z,h:6+vrnd()*9,ry:vrnd()*Math.PI*2};forest.push(item);layout.ridgePines.push(item);
  }
  // Broken limestone shelves are entirely outside the fence and never
  // masquerade as colliders. Their small neighbours soften the cliff edge.
  for(let i=0;i<(theme==='neon'?0:quarry?34:18);i++) {
    const a=i/18*Math.PI*2+vrnd()*.12,r=half+15+vrnd()*19;
    const x=Math.cos(a)*r,z=Math.sin(a)*r,h=quarry?3+vrnd()*5:2+vrnd()*3.2;
    if(!safe(x,z,h*1.25)||!clearOf(x,z,h))continue;
    const item={x,z,h,ry:vrnd()*Math.PI*2};outcrops.push(item);layout.rocks.push(item);
  }
  function instanceNature(geo,mat,items,name,shape) {
    if(!items.length)return;
    const mesh=new THREE.InstancedMesh(geo,mat,items.length),matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),pos=new THREE.Vector3(),scale=new THREE.Vector3();
    mesh.name=name;
    items.forEach((p,i)=>{
      pos.set(p.x,apronHeight(p.x,p.z),p.z);q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,p.ry);
      const wide=shape==='rock'?p.h: p.h*(.88+.16*(i%3)/2);
      scale.set(wide,p.h,wide);matrix.compose(pos,q,scale);mesh.setMatrixAt(i,matrix);
    });
    mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();root.add(mesh);
  }
  // Batch the shipped nature meshes by their original primitive/material.
  // Bake template transforms once, preserving GLB silhouettes and materials
  // while every placement shares the same buffers and costs only one draw.
  function assetNature(key,items,name) {
    const template=templateOf(key);
    if(!template||!items.length)return false;
    template.updateMatrixWorld(true);scratchBox.setFromObject(template);
    scratchBox.getCenter(scratchCenter);
    const h=measuredHeight(template),cx=scratchCenter.x,cz=scratchCenter.z,y=scratchBox.min.y;
    scratchBox.getSize(scratchSize);const radius=Math.hypot(scratchSize.x,scratchSize.z)/(2*h);
    const normalize=new THREE.Matrix4().makeScale(1/h,1/h,1/h);
    normalize.setPosition(-cx/h,-y/h,-cz/h);
    const matrix=new THREE.Matrix4(),transform=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),scale=new THREE.Vector3();
    const batchGroup=new THREE.Group();batchGroup.name=name;
    template.traverse(source=>{
      if(!source.isMesh)return;
      const geometry=source.geometry.clone();transform.multiplyMatrices(normalize,source.matrixWorld);geometry.applyMatrix4(transform);
      const batch=new THREE.InstancedMesh(geometry,source.material,items.length);
      batch.name=name+'-'+batchGroup.children.length;batch.castShadow=true;batch.receiveShadow=true;
      items.forEach((item,i)=>{
        p.set(item.x,apronHeight(item.x,item.z),item.z);q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,item.ry);
        scale.setScalar(Math.min(item.h,(Math.max(Math.abs(item.x),Math.abs(item.z))-sceneryMin-.05)/radius));
        matrix.compose(p,q,scale);batch.setMatrixAt(i,matrix);
      });
      batch.instanceMatrix.needsUpdate=true;batch.computeBoundingSphere();batchGroup.add(batch);
    });
    if(!batchGroup.children.length)return false;
    root.add(batchGroup);return true;
  }
  if(!assetNature(theme==='grove'&&!quarry?'tree_detailed':'tree_pineTallA',forest,'trackside-glb-forest')) {
    instanceNature(firGeo,firMat,forest,'alpine-fir-canopies','fir');
    instanceNature(trunkGeo,trunkMat,forest,'alpine-fir-trunks','fir');
  }
  if(!assetNature('rock_largeA',outcrops,'trackside-glb-rocks'))
    instanceNature(rockGeo,rockMat,outcrops,'alpine-limestone-outcrops','rock');

  // Small soft meadow plants cluster between the Garden roads. Their
  // bases follow the shared ground; they never change collision or grip.
  layout.meadow=[];
  if(theme==='garden') {
    const meadowRandom=mulberry32(9827),grassVerts=[],grassColors=[],grassColor=new THREE.Color();
    for(let blade=0;blade<7;blade++) {
      const a=blade*2.399,baseX=Math.cos(a)*.15,baseZ=Math.sin(a)*.15,height=.32+(blade%4)*.075;
      const sideX=Math.cos(a+Math.PI/2)*.045,sideZ=Math.sin(a+Math.PI/2)*.045;
      const tri=[[baseX-sideX,0,baseZ-sideZ],[baseX+sideX,0,baseZ+sideZ],[baseX+Math.cos(a)*.14,height,baseZ+Math.sin(a)*.14]];
      tri.forEach((p,i)=>{grassVerts.push(...p);grassColor.setHex(i===2?0xa4ad64:0x456a3e);grassColors.push(grassColor.r,grassColor.g,grassColor.b);});
    }
    const tuftGeo=new THREE.BufferGeometry();tuftGeo.setAttribute('position',new THREE.Float32BufferAttribute(grassVerts,3));tuftGeo.setAttribute('color',new THREE.Float32BufferAttribute(grassColors,3));tuftGeo.computeVertexNormals();
    const flowerVerts=[],flowerColors=[],petalColor=new THREE.Color();
    for(let petal=0;petal<5;petal++) {
      const a=petal/5*Math.PI*2;
      for(const [x,y,z,centre]of [[0,.34,0,true],[Math.cos(a-.36)*.10,.315,Math.sin(a-.36)*.10,false],[Math.cos(a+.36)*.10,.315,Math.sin(a+.36)*.10,false]]) {
        flowerVerts.push(x,y,z);petalColor.setHex(centre?0xe4c74a:0xf3efe1);flowerColors.push(petalColor.r,petalColor.g,petalColor.b);
      }
    }
    // Two narrow stem faces avoid a cylinder draw per tiny flower.
    for(const p of [[-.009,0,0],[.009,0,0],[.009,.34,0],[-.009,0,0],[.009,.34,0],[-.009,.34,0]]) {
      flowerVerts.push(...p);petalColor.setHex(0x56763c);flowerColors.push(petalColor.r,petalColor.g,petalColor.b);
    }
    const flowerGeo=new THREE.BufferGeometry();flowerGeo.setAttribute('position',new THREE.Float32BufferAttribute(flowerVerts,3));flowerGeo.setAttribute('color',new THREE.Float32BufferAttribute(flowerColors,3));flowerGeo.computeVertexNormals();
    const meadow=[[-28,-27,6],[-20,-19,4],[29,-28,5],[-26,22,3],[18,27,4],[28,36,3],[36,-25,3],[-35,4,3],[35,12,4],
      [6,-9,1.3],[-6,-12,1.3],[6,15,1.2],[-6,17,1.0]];
    const tufts=[],daisies=[],mapBlocks=map.blocks||[];
    for(const [cx,cz,r]of meadow)for(let i=0;i<48;i++) {
      const angle=meadowRandom()*Math.PI*2,dist=Math.sqrt(meadowRandom())*r,x=cx+Math.cos(angle)*dist,z=cz+Math.sin(angle)*dist;
      if(mapBlocks.some(b=>Math.abs(x-b.x)<b.hw+2.7&&Math.abs(z-b.z)<b.hd+2.7))continue;
      const item={x,z,h:.65+meadowRandom()*.6,ry:meadowRandom()*Math.PI*2};tufts.push(item);layout.meadow.push({x,z});
      if(i%5===0)daisies.push({x:x+.22,z:z+.13,h:.8+meadowRandom()*.3,ry:meadowRandom()*Math.PI*2});
    }
    function plantMeadow(geo,items,name) {
      const mesh=new THREE.InstancedMesh(geo,std(0xffffff,{vertexColors:true,roughness:1,side:THREE.DoubleSide}),items.length),m=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),s=new THREE.Vector3();mesh.name=name;
      items.forEach((item,i)=>{p.set(item.x,groundAt(item.x,item.z)+.045,item.z);q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,item.ry);s.set(item.h,item.h,item.h);m.compose(p,q,s);mesh.setMatrixAt(i,m);});mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();root.add(mesh);
    }
    plantMeadow(tuftGeo,tufts,'garden-meadow-grass');plantMeadow(flowerGeo,daisies,'garden-meadow-daisies');
  }

  // Three rock/snow layers with irregular ledges, gullies and pointed
  // peaks. Vertex colour blends are authored from height and exposure; the
  // mountain geometry is not a flat green ridge ribbon or copied texture.
  function alpineRidge(radius,height,seed,name,far) {
    const N=96,B=7,verts=[],colors=[],indices=[],baseColor=new THREE.Color(far?S.ridgeFar:quarry?0xa5a18f:0x8a958d),snow=new THREE.Color(theme==='frost'?0xf1f5fa:0xe4edf1),foothill=new THREE.Color(S.ground),color=new THREE.Color();
    const peak=t=>.42+.33*Math.pow(.5+.5*Math.sin(t*5+seed),2)+.17*Math.pow(.5+.5*Math.sin(t*13+seed*2.7),3)+.08*Math.sin(t*23+seed);
    for(let i=0;i<=N;i++) {
      const angle=i/N*Math.PI*2,peakH=height*peak(angle);
      for(let j=0;j<=B;j++) {
        const f=j/B,r=radius*(.62+f*.42)+Math.sin(angle*17+seed+j)*3;
        const profile=Math.sin(f*Math.PI),gully=(.55+.45*Math.abs(Math.sin(angle*19+seed+j*.7)));
        const y=-3+peakH*Math.pow(profile,1.18)+(j>1&&j<B?gully*4:0);
        verts.push(Math.cos(angle)*r,y,Math.sin(angle)*r);
        const grain=.84+.14*(.5+.5*Math.sin(angle*37+j*2.5+seed));
        color.copy(baseColor).multiplyScalar(grain);
        if(!far && !quarry && theme!=='frost')color.lerp(foothill,.68*(1-sstep(height*.16,height*.52,y)));
        const snowline=height*(theme==='frost'?.33:.53)+Math.sin(angle*17+seed)*height*.055;
        if(!quarry)color.lerp(snow,sstep(snowline-2,snowline+5,y));
        colors.push(color.r,color.g,color.b);
        if(i<N&&j<B){const a=i*(B+1)+j,b=a+B+1;indices.push(a,b,a+1,a+1,b,b+1);}
      }
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.setIndex(indices);geo.computeVertexNormals();
    const ridge=new THREE.Mesh(geo,std(0xffffff,{vertexColors:true,roughness:1,flatShading:true,side:THREE.DoubleSide}));ridge.name=name;root.add(ridge);
  }
  if(theme!=='neon') {
    alpineRidge(hillMin+46,quarry?25:27,1.31,'ridge-near',false);
    alpineRidge(hillMin+104,quarry?39:49,4.72,'ridge-far',true);
    alpineRidge(hillMin+164,quarry?49:68,7.91,'ridge-summit',true);
  }

  /* ---- original motorsport landmarks and physical set dressing ---- */
  const landmark = new THREE.Group();landmark.name='arena-landmark-'+identity;root.add(landmark);
  const propBox = new THREE.BoxGeometry(1,1,1);
  function parts(name,color,items,extra) {
    if(!items.length)return;
    const batch=new THREE.InstancedMesh(propBox,std(color,extra),items.length),matrix=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),sc=new THREE.Vector3();
    batch.name=name;
    items.forEach(([x,y,z,w,h,d,ry=0],i)=>{v.set(x,y,z);sc.set(w,h,d);q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,ry);matrix.compose(v,q,sc);batch.setMatrixAt(i,matrix);});
    batch.instanceMatrix.needsUpdate=true;batch.computeBoundingSphere();landmark.add(batch);return batch;
  }
  const stoneTex=canvasTexture(THREE,256,256,(ctx,w,h)=>{
    ctx.fillStyle='#aaa99c';ctx.fillRect(0,0,w,h);
    const R=mulberry32(5804);
    for(let row=0;row<8;row++)for(let col=-1;col<5;col++){
      const x=col*64+(row%2)*32,y=row*32;
      ctx.fillStyle=['#bdbbad','#aaa99a','#c7c6b9','#9d9e92'][(R()*4)|0];
      ctx.fillRect(x+2,y+2,60,28);
      ctx.fillStyle='rgba(255,255,255,.12)';ctx.fillRect(x+3,y+3,58,2);
    }
    speckle(ctx,w,h,R,1200,['#ffffff','#737c75'],.10,1,2);
  },{repeat:[2,4]});
  const stoneExtra={roughness:1};if(stoneTex)stoneExtra.map=stoneTex;
  const summitX=theme==='garden'?20:18,summitZ=half+23;
  if(theme==='garden'||theme==='grove'&&!quarry) {
    // Timing/watch tower beside the north bleachers, entirely outside the
    // playfield. A dark slate roof, timber braces and racing pennants make
    // an orienting landmark readable from the chase view.
    parts('summit-stone-tower',0xffffff,[[summitX,8,summitZ,5.4,16,5.4]],stoneExtra);
    parts('summit-balcony',0xd5d7cc,[[summitX,14.5,summitZ,7,.45,7],[summitX,18.6,summitZ,7.6,.5,7.6]]);
    const timber=[];
    for(const x of [-2.8,2.8])for(const z of [-2.8,2.8])timber.push([summitX+x,16.6,summitZ+z,.32,4.0,.32]);
    for(const y of [14.9,15.8]){
      timber.push([summitX,y,summitZ-3.4,7,.15,.15],[summitX,y,summitZ+3.4,7,.15,.15],
        [summitX-3.4,y,summitZ,.15,.15,7],[summitX+3.4,y,summitZ,.15,.15,7]);
    }
    parts('summit-timber-balustrade',0x514d42,timber);
    const roof=new THREE.Mesh(new THREE.ConeGeometry(5.4,3.7,4),std(0x344c61,{roughness:.85}));roof.rotation.y=Math.PI/4;roof.position.set(summitX,20.7,summitZ);roof.name='summit-slate-roof';landmark.add(roof);
    const clockTex=canvasTexture(THREE,256,256,(ctx,w,h)=>{
      ctx.fillStyle='#f1f2df';ctx.fillRect(0,0,w,h);ctx.translate(w/2,h/2);
      ctx.strokeStyle='#254354';ctx.lineWidth=10;ctx.beginPath();ctx.arc(0,0,112,0,Math.PI*2);ctx.stroke();
      for(let i=0;i<12;i++){const a=i*Math.PI/6;ctx.lineWidth=i%3?4:7;ctx.beginPath();ctx.moveTo(Math.sin(a)*93,-Math.cos(a)*93);ctx.lineTo(Math.sin(a)*105,-Math.cos(a)*105);ctx.stroke();}
      ctx.lineCap='round';ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(-43,-29);ctx.moveTo(0,0);ctx.lineTo(54,-47);ctx.stroke();
      ctx.fillStyle='#e54c55';ctx.beginPath();ctx.arc(0,0,9,0,Math.PI*2);ctx.fill();
    });
    const clockMat=basic(0xffffff);if(clockTex)clockMat.map=clockTex;
    const clock=new THREE.Mesh(new THREE.CircleGeometry(1.8,32),clockMat);clock.position.set(summitX,11.2,summitZ-2.72);clock.rotation.y=Math.PI;clock.name='summit-clock-face';landmark.add(clock);
    // Four bright race pennants add scale and identity without overlay UI.
    parts('summit-race-pennants',0xee4858,[[summitX-3.8,17,summitZ-3.4,.7,2.3,.06],[summitX+3.8,17,summitZ-3.4,.7,2.3,.06]]);
    const village=theme==='garden'?[[7,half+24],[32,half+27],[41,half+35],[8,half+40]]:[[-4,half+25],[8,half+31],[31,half+25]];
    const common=new THREE.Mesh(new THREE.PlaneGeometry(theme==='garden'?54:43,30),std(0xc4c6b4,{roughness:1}));
    common.rotation.x=-Math.PI/2;common.position.set(theme==='garden'?20:12,.024,half+28);common.name='alpine-village-common';landmark.add(common);
    // The lane-side common joins the stand, clock tower and chalets. Roofs
    // are original gables, with timber framing, balcony, doors and shutters.
    const huts=village.map(([x,z])=>[x,2.0,z,7,4,5.5]);
    parts('alpine-paddock-cabins',0xd9d9c4,huts);
    const roofVertices=[[-4,0,-3.2],[4,0,-3.2],[4,0,3.2],[-4,0,3.2],[0,2.5,-3.2],[0,2.5,3.2]];
    const roofIndices=[0,3,4,3,5,4,1,4,2,2,4,5,0,4,1,3,2,5];
    const roofGeo=new THREE.BufferGeometry();roofGeo.setAttribute('position',new THREE.Float32BufferAttribute(roofVertices.flat(),3));roofGeo.setIndex(roofIndices);roofGeo.computeVertexNormals();
    const cabinsRoof=new THREE.InstancedMesh(roofGeo,std(0x43566b,{roughness:.85}),huts.length),m=new THREE.Matrix4();
    huts.forEach((h,i)=>{m.makeTranslation(h[0],4.0,h[2]);cabinsRoof.setMatrixAt(i,m);});cabinsRoof.instanceMatrix.needsUpdate=true;cabinsRoof.name='alpine-cabin-roofs';landmark.add(cabinsRoof);
    const wood=[],shutters=[],doors=[],chimneys=[];
    for(const h of huts){
      const [x,,z]=h;
      for(const dx of [-3.45,0,3.45])wood.push([x+dx,2,z-2.78,.20,4,.10]);
      for(const y of [.35,2.05,3.85])wood.push([x,y,z-2.78,7,.22,.12]);
      for(const dx of [-2,2])for(const edge of [-.9,.9])shutters.push([x+dx+edge,2.8,z-2.84,.38,1.3,.10]);
      doors.push([x,1,z-2.82,1.1,2,.10]);wood.push([x,1.85,z-3.15,6.6,.15,.75]);
      chimneys.push([x+2.1,5.7,z+1.3,.65,1.8,.8]);
    }
    parts('alpine-chalet-timber',0x625b48,wood);
    parts('alpine-chalet-shutters',0x66857b,shutters);
    parts('alpine-chalet-doors',0x927554,doors);
    parts('alpine-chalet-chimneys',0xa5a99d,chimneys);
    parts('alpine-paddock-windows',0xa8cad0,huts.flatMap(h=>[-2,2].map(x=>[h[0]+x,2.8,h[2]-2.80,1.35,1.2,.08])),{roughness:.25,metalness:.1});
    parts('alpine-common-planters',0x737b67,[[summitX-5.4,.45,summitZ-4,2.4,.9,1.1],[summitX+5.4,.45,summitZ-4,2.4,.9,1.1]]);
  } else if(theme==='frost') {
    // A lift station and bright red cable cars give the frozen high pass
    // its own silhouette. Cable and cabins remain behind the north fence.
    const cableZ=half+29;
    parts('frost-lift-station',0x3f6379,[[-22,3,cableZ,12,6,8],[22,3,cableZ,12,6,8]]);
    parts('frost-lift-pylons',0x657c8c,[[-22,10,cableZ,1.2,14,1.2],[22,10,cableZ,1.2,14,1.2],[-22,16.7,cableZ,8,.5,2],[22,16.7,cableZ,8,.5,2]]);
    const line=new THREE.QuadraticBezierCurve3(new THREE.Vector3(-25,17,cableZ),new THREE.Vector3(0,12,cableZ),new THREE.Vector3(25,17,cableZ));
    const cable=new THREE.Line(new THREE.BufferGeometry().setFromPoints(line.getPoints(32)),new THREE.LineBasicMaterial({color:0x334955}));cable.name='frost-lift-cable';landmark.add(cable);
    const pods=[[-12,11.8,cableZ,3,3.4,2.8],[12,11.8,cableZ,3,3.4,2.8]];
    parts('frost-red-gondolas',0xd94357,pods);
    parts('frost-gondola-glass',0x9cdae7,pods.map(p=>[p[0],12.4,p[2]-1.44,2.3,1.3,.06]),{roughness:.3,metalness:.15});
    parts('frost-gondola-hangers',0x435b66,pods.map(p=>[p[0],14.3,p[2],.17,2.2,.17]));
  } else {
    // Quarry Blocks and Neon Yard share an economical crane construction,
    // with ochre quarry steel versus teal/pink port equipment.
    const craneX=half+17,craneZ=8;
    parts('yard-crane-pylons',quarry?0xd49e3b:0x227f96,[[craneX-3,9,craneZ,1,18,1],[craneX+3,9,craneZ,1,18,1],
      [craneX,17.5,craneZ,7,1,4],[craneX,20,craneZ,3,4,3],[craneX,23,craneZ,4,1.2,31]]);
    parts('yard-crane-rungs',0x647786,Array.from({length:11},(_,i)=>[craneX,1.5+i*1.4,craneZ-1.1,5.5,.18,.18]));
    parts('yard-crane-cabin-glass',0xa9dfec,[[craneX,20.5,craneZ-1.55,2.1,1.9,.08]],{roughness:.25,metalness:.1});
    parts('yard-crane-cables',0x414f5c,[[craneX,14.5,craneZ+13,.12,16,.12]]);
    parts('yard-loaded-crate',quarry?0xb78451:0xc25488,[[craneX,5.9,craneZ+13,4.5,3.2,4.5]]);
  }
  layout.landmark={identity,kind:quarry?'quarry-crane':theme==='frost'?'ski-lift':theme==='neon'?'port-crane':'summit-watchtower'};

  // Scenery stays outside the authoritative fence. A park lake and a
  // bounded city skyline give the worlds different silhouettes as well as
  // floor paint; neither is an invisible obstacle inside the arena.
  if (theme === 'garden') {
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 32), std(0x51bfc6, { roughness:.35, metalness:.15 }));
    water.name='garden-lake'; water.rotation.x=-Math.PI/2;
    water.scale.set(24, 12, 1); water.position.set(-24,.025,-half-25); root.add(water);
    const bank = new THREE.Mesh(new THREE.RingGeometry(.98,1.07,32),std(0xd7d7ac,{roughness:1}));
    bank.name='garden-lake-bank';bank.rotation.x=-Math.PI/2;bank.scale.set(24,12,1);bank.position.copy(water.position);bank.position.y=.03;root.add(bank);
  }
  if (theme === 'neon') {
    const geo=new THREE.BoxGeometry(1,1,1),mat=std(0x242237,{roughness:.9});
    const blocks=new THREE.InstancedMesh(geo,mat,14),roofs=new THREE.InstancedMesh(geo,mat,14);
    const windows=new THREE.InstancedMesh(geo,basic(0xffffff),252);
    blocks.name='neon-city';roofs.name='neon-city-roofs';windows.name='neon-city-windows';
    const matrix=new THREE.Matrix4(),light=new THREE.Color();let count=0;
    for(let i=0;i<14;i++){const angle=i/14*Math.PI*2,dist=half+25,height=12+(i%4)*8,width=10+(i%3)*3;
      let x=Math.sin(angle)*dist,z=Math.cos(angle)*dist;
      // Keep the whole building footprint beyond the fence, including
      // diagonal buildings whose centre alone would be a misleading test.
      if(Math.abs(x)>=Math.abs(z))x=Math.sign(x)*Math.max(Math.abs(x),sceneryMin+width/2+3);
      else z=Math.sign(z)*Math.max(Math.abs(z),sceneryMin+8);
      matrix.makeScale(width,height,10);matrix.setPosition(x,height/2,z);blocks.setMatrixAt(i,matrix);
      matrix.makeScale(width*.6,4+(i%3)*2,7);matrix.setPosition(x,height+2+(i%3),z);roofs.setMatrixAt(i,matrix);
      const faceX=Math.abs(x)>Math.abs(z),sign=faceX?(x>0?-1:1):(z>0?-1:1);
      for(let row=0;row<9&&row*3+2.5<height-1.5;row++)for(const side of [-1,1]){
        matrix.makeScale(faceX?.08:1.4,.6,faceX?1.4:.08);
        matrix.setPosition(x+(faceX?sign*(width/2+.05):side*2),row*3+2.5,z+(faceX?side*2:sign*5.05));
        windows.setMatrixAt(count,matrix);light.setHex((i+row)%3?0x62dce5:0xdf6bd5);windows.setColorAt(count++,light);
      }
    }
    windows.count=count;for(const m of [blocks,roofs,windows]){m.instanceMatrix.needsUpdate=true;root.add(m);}

  }

  /* ---- sky: procedural gradient dome, sun disk, restrained haze ---- */
  const domeR = 200 + Math.max(0, half - WORLD_HALF_DEFAULT) * 2;
  const sunDist = 185 + Math.max(0, half - WORLD_HALF_DEFAULT) * 2;
  const domeGeo = new THREE.SphereGeometry(domeR, 24, 16);
  const domePos = domeGeo.attributes.position;
  const domeColors = new Float32Array(domePos.count * 3);
  domeGeo.setAttribute('color', new THREE.BufferAttribute(domeColors, 3));
  // Preallocated sky temps: animate() writes the existing color array in
  // place, never allocating geometries, textures, or colors per frame.
  const skyZen = new THREE.Color(P.sky);
  const skyMid = new THREE.Color(P.skyMid);
  const skyHor = new THREE.Color(P.horizon);
  const skyTmp = new THREE.Color();
  const domeColAttr = domeGeo.attributes.color;
  function paintDome() {
    for (let i = 0; i < domePos.count; i++) {
      const t = THREE.MathUtils.clamp(domePos.getY(i) / domeR, -1, 1) * 0.5 + 0.5;
      if (t < 0.5) skyTmp.copy(skyHor).lerp(skyMid, t / 0.5);
      else skyTmp.copy(skyMid).lerp(skyZen, (t - 0.5) / 0.5);
      domeColors[i * 3] = skyTmp.r; domeColors[i * 3 + 1] = skyTmp.g; domeColors[i * 3 + 2] = skyTmp.b;
    }
    domeColAttr.needsUpdate = true;
  }
  paintDome();
  {
    const dome = new THREE.Mesh(domeGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false, toneMapped: false,
    }));
    dome.name = 'sky-dome';
    dome.renderOrder = -2;
    root.add(dome);
  }
  const sunDirV = new THREE.Vector3(P.sunDir[0], P.sunDir[1], P.sunDir[2]).normalize();
  // Unit sun/haze disks scaled to the authored size: identical legacy look
  // (same 32 segments) with a free size blend for the sunset.
  const sunMesh = new THREE.Mesh(
    new THREE.CircleGeometry(1, 32),
    new THREE.MeshBasicMaterial({ color: P.sunDisc, fog: false, depthWrite: false }));
  sunMesh.name = 'sun-disk';
  sunMesh.position.copy(sunDirV).multiplyScalar(sunDist);
  sunMesh.scale.setScalar(P.sunSize);
  sunMesh.lookAt(0, 0, 0);
  sunMesh.renderOrder = -1;
  root.add(sunMesh);
  const hazeTex = canvasTexture(THREE, 128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    if (!ctx.createRadialGradient) return;
    const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    glow.addColorStop(0, 'rgba(255,255,255,0.8)');
    glow.addColorStop(0.3, 'rgba(255,255,255,0.3)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
  });
  const hazeMesh = new THREE.Mesh(
    new THREE.CircleGeometry(1, 32),
    new THREE.MeshBasicMaterial({
      color: P.haze, map: hazeTex, transparent: true, opacity: P.hazeOpacity,
      fog: false, depthWrite: false,
    }));
  hazeMesh.name = 'sun-haze';
  hazeMesh.position.copy(sunDirV).multiplyScalar(sunDist - 1);
  hazeMesh.scale.setScalar(P.sunSize * 2.6);
  hazeMesh.lookAt(0, 0, 0);
  hazeMesh.renderOrder = -1;
  root.add(hazeMesh);

  /* ---- sky life: puffy drifting clouds, night stars, carnival balloon ---- */
  const clouds = [];
  const cloudMat = std(S.cloud, { roughness: 1 });
  const baseCloudHex = S.cloud;
  const nightCloudHex = theme === 'grove' ? PALETTES.Starlight.cloud : THEME_SURF[theme].Starlight.cloud;
  const sunsetCloudHex = theme === 'grove' ? PALETTES.Sunset.cloud : THEME_SURF[theme].Sunset.cloud;
  const cloudGeo = new THREE.IcosahedronGeometry(1, 1);
  const puffOffsets = [
    [0, 0, 0, 1], [0.95, -0.18, 0.3, 0.68], [-0.9, -0.22, -0.28, 0.6],
  ];
  const cloudSpots = isLarge
    ? [[-45 * halfScale, 24, 55 * halfScale, 5.5], [50 * halfScale, 26, 30 * halfScale, 6.5],
       [-10 * halfScale, 23, -70 * halfScale, 5], [60, 25, -90, 5.5]]
    : [[-45, 20, 55, 5.5], [50, 22, 30, 6.5], [-10, 19, -70, 5]];
  for (const [cx, cy, cz, s] of cloudSpots) {
    const grp = new THREE.Group();
    grp.name = 'cloud';
    for (const [ox, oy, oz, f] of puffOffsets) {
      const puff = new THREE.Mesh(cloudGeo, cloudMat);
      puff.position.set(ox * s, oy * s, oz * s);
      puff.scale.set(s * f, s * f * 0.62, s * f * 0.85);
      grp.add(puff);
    }
    grp.position.set(cx, cy, cz);
    grp.visible = theme!=='neon'&&!P.stars;
    root.add(grp);
    clouds.push({ mesh: grp, speed: 1.5 + rnd() * 2, baseX: cx });
  }
  let stars = null;
  {
    const n = 150;
    const starR = Math.min(150 * halfScale, domeR - 15);
    const pts = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const e = 0.2 + rnd() * 1.25;
      pts[i * 3] = Math.cos(a) * Math.cos(e) * starR;
      pts[i * 3 + 1] = Math.sin(e) * starR;
      pts[i * 3 + 2] = Math.sin(a) * Math.cos(e) * starR;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    stars = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xffffff, size: 1.8, sizeAttenuation: false,
      transparent: true, opacity: 0.95, depthWrite: false, fog: false,
    }));
    stars.visible = !!P.stars;
    root.add(stars);
  }
  const balloon = new THREE.Group();
  balloon.name = 'carnival-balloon';balloon.visible=theme!=='neon';
  const balloonTex = canvasTexture(THREE, 256, 128, (ctx, w, h) => {
    const stripes = ['#ff7aa8', '#fff6e8', '#0e9b8a', '#fff6e8', '#ffd54a', '#fff6e8'];
    stripes.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect((i * w) / stripes.length, 0, w / stripes.length + 1, h);
    });
  });
  const balloonMat = std(0xffffff, { roughness: 0.6 });
  if (balloonTex) balloonMat.map = balloonTex;
  else balloonMat.color.set(0xff7aa8);
  const envelope = new THREE.Mesh(new THREE.SphereGeometry(3, 20, 14), balloonMat);
  envelope.position.y = 2.6;
  balloon.add(envelope);
  const basket = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), std(0x8a5a2b));
  basket.position.y = -1.8;
  balloon.add(basket);
  {
    const rp = [];
    for (const [sx, sz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
      rp.push(sx, -1.2, sz, sx * 2.2, 1.2, sz * 2.2);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rp), 3));
    balloon.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x5a3a22 })));
  }
  const BALLOON_BASE = new THREE.Vector3(
    -(half + 28), 27 + Math.max(0, half - WORLD_HALF_DEFAULT) * 0.1, -(half + 22));
  balloon.position.copy(BALLOON_BASE);
  root.add(balloon);

  /* ---- map dressing: obstacles + boost pads + grip surfaces ----
   * Every mesh below follows the authoritative snapshot rects exactly:
   * solids stay inside block footprints; pads/surfaces are flat paint at
   * exact rects. All map meshes share unit geometries; materials/textures
   * are built once and reused across syncMap rebuilds. */
  const obstacleGroup = new THREE.Group();
  obstacleGroup.name = 'obstacles';
  root.add(obstacleGroup);
  const padGroup = new THREE.Group();
  padGroup.name = 'boost-pads';
  root.add(padGroup);
  const surfGroup = new THREE.Group();
  surfGroup.name = 'grip-surfaces';
  root.add(surfGroup);
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitPad = new THREE.PlaneGeometry(1, 1);
  let obstacleRes = null;
  function getObstacleRes() {
    if (obstacleRes) return obstacleRes;
    const hazardTex = canvasTexture(THREE, 128, 128, (ctx, w, h) => {
      const n = 6;
      for (let ix = 0; ix < n; ix++) {
        for (let iy = 0; iy < n; iy++) {
          ctx.fillStyle = (ix + iy) % 2 ? '#2b2733' : '#ffd23e';
          ctx.fillRect((ix * w) / n, (iy * h) / n, w / n, h / n);
        }
      }
    });
    const hazardMat = std(0xffffff, { roughness: 0.6 });
    if (hazardTex) hazardMat.map = hazardTex;
    else hazardMat.color.set(0xffd23e);
    const padTex = canvasTexture(THREE, 128, 128, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = P.dirt;
      ctx.globalAlpha = 0.9;
      const m = 10;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(m, m, w - 2 * m, h - 2 * m, 22);
      else ctx.rect(m, m, w - 2 * m, h - 2 * m);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = P.line;
      ctx.lineWidth = 5;
      ctx.stroke();
      speckle(ctx, w, h, rnd, 350, ['#5a3a22', '#ffffff'], 0.08, 1, 3);
    });
    const padMat = std(0xffffff, {
      roughness: 1, transparent: true,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    if (padTex) padMat.map = padTex;
    else padMat.color.set(P.dirt);
    obstacleRes = {
      tireGeo: new THREE.TorusGeometry(0.62, 0.22, 10, 20),
      baseMat: std(0x1f7a8c, { roughness: 0.75 }),
      hazardMat,
      padMat,
      tireMat: std(0x23202e, { roughness: 0.95 }),
    };
    return obstacleRes;
  }

  // Themed obstacle resources: planted islands (garden), snow-capped ice
  // hulls (frost), cargo cover stacks (neon). Grove keeps getObstacleRes.
  let themeRes = null;
  function flatOr(stdColor, tex) {
    const m = std(stdColor, { roughness: 0.85 });
    if (tex) { m.map = tex; m.color.set(0xffffff); }
    return m;
  }
  function soilPadTexture(fill, border, grain) {
    return canvasTexture(THREE, 128, 128, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = fill;
      ctx.globalAlpha = 0.92;
      const m = 10;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(m, m, w - 2 * m, h - 2 * m, 22);
      else ctx.rect(m, m, w - 2 * m, h - 2 * m);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = border;
      ctx.lineWidth = 5;
      ctx.stroke();
      speckle(ctx, w, h, trnd, 350, grain, 0.08, 1, 3);
    });
  }
  function getThemeRes() {
    if (theme === 'grove') return null;
    if (themeRes) return themeRes;
    if (theme === 'garden') {
      const soilTex = soilPadTexture('#4a3220', '#7a5230', ['#2e1c10', '#8a6a44']);
      const bloomTex = canvasTexture(THREE, 128, 128, (ctx, w, h) => {
        ctx.fillStyle = '#557c4b';
        ctx.fillRect(0, 0, w, h);
        speckle(ctx,w,h,trnd,700,['#365a3d','#829766','#bdd68c'],.3,1,3);
        const blooms = ['#ddc15c', '#f1ece1', '#c3a3dc'];
        for (let i = 0; i < 14; i++) {
          ctx.fillStyle = blooms[(trnd() * blooms.length) | 0];
          ctx.beginPath();
          ctx.arc(8 + trnd() * (w - 16), 8 + trnd() * (h - 16), 1.5 + trnd(), 0, Math.PI * 2);
          ctx.fill();
        }
      });
      const soilMat = std(0xffffff, {
        roughness: 1, transparent: true,
        polygonOffset: true, polygonOffsetFactor: -2,
      });
      if (soilTex) soilMat.map = soilTex;
      else soilMat.color.set(0x4a3220);
      themeRes = {
        padMat: soilMat,
        baseMat: std(stoneTex ? 0xffffff : 0xaaa99c, stoneExtra),
        capMat: flatOr(0x557c4b, bloomTex),
      };
    } else if (theme === 'frost') {
      const frostPadTex = soilPadTexture('#cfe4f4', '#ffffff', ['#ffffff', '#9fc4e4']);
      const iceTex = canvasTexture(THREE, 128, 128, (ctx, w, h) => {
        ctx.fillStyle = '#7fb8dd';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        for (let i = 0; i < 9; i++) {
          ctx.lineWidth = 2 + trnd() * 4;
          ctx.beginPath();
          const sx = trnd() * w, sy = trnd() * h;
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + 30 + trnd() * 60, sy + 10 + trnd() * 30);
          ctx.stroke();
        }
        speckle(ctx, w, h, trnd, 300, ['#ffffff', '#4a8ec4'], 0.12, 1, 3);
      });
      const frostPadMat = std(0xffffff, {
        roughness: 1, transparent: true,
        polygonOffset: true, polygonOffsetFactor: -2,
      });
      if (frostPadTex) frostPadMat.map = frostPadTex;
      else frostPadMat.color.set(0xcfe4f4);
      themeRes = {
        padMat: frostPadMat,
        baseMat: flatOr(0x7fb8dd, iceTex),
        capMat: std(0xf4f9ff, { roughness: 0.9 }), // snow cap
      };
    } else { // neon: cargo cover stacks with emissive trim caps
      const darkPadTex = soilPadTexture('#101828', '#18e0f0', ['#0a1424', '#3a5a7a']);
      const tarpTex = canvasTexture(THREE, 128, 128, (ctx, w, h) => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.16)';
        for (let i = 0; i < 6; i++) ctx.fillRect(0, 8 + i * 21, w, 7);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        for (let i = 0; i < 6; i++) ctx.fillRect(0, 15 + i * 21, w, 3);
      });
      const cargoFor = (color) => {
        const m = std(color, { roughness: 0.8 });
        if (tarpTex) { m.map = tarpTex; }
        return m;
      };
      const darkPadMat = std(0xffffff, {
        roughness: 1, transparent: true,
        polygonOffset: true, polygonOffsetFactor: -2,
      });
      if (darkPadTex) darkPadMat.map = darkPadTex;
      else darkPadMat.color.set(0x101828);
      themeRes = {
        padMat: darkPadMat,
        baseMats: [cargoFor(0x1f7a8c), cargoFor(0x8e2a6a)],
        capMats: [
          std(0x0a2a34, { roughness: 0.4, emissive: 0x18e0f0, emissiveIntensity: 1.2 }),
          std(0x2a0a22, { roughness: 0.4, emissive: 0xff2fb3, emissiveIntensity: 1.2 }),
        ],
      };
    }
    return themeRes;
  }

  // Boost-pad + grip-surface resources. Styling is identical on every map so
  // the mechanics read the same everywhere (and match the 2D fallback hues:
  // mint strips with warm chevrons, ice-blue patches with snow trim).
  let fxRes = null;
  function getFxRes() {
    if (fxRes) return fxRes;
    const chevTex = canvasTexture(THREE, 128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#61e9bf';
      ctx.fillRect(0, 0, w, h);
      ctx.lineCap = 'round';
      for (const cy of [h * 0.25, h * 0.75]) {
        ctx.strokeStyle = '#fff4a6';
        ctx.lineWidth = 17;
        ctx.beginPath();
        ctx.moveTo(14, cy + 26);
        ctx.lineTo(w / 2, cy - 26);
        ctx.lineTo(w - 14, cy + 26);
        ctx.stroke();
      }
    });
    if (chevTex) {
      chevTex.wrapS = THREE.RepeatWrapping;
      chevTex.wrapT = THREE.RepeatWrapping;
    }
    const chevMat = std(0xffffff, {
      roughness: 0.6, emissive: 0xffdf6b, emissiveIntensity: 0.75,
    });
    if (chevTex) { chevMat.map = chevTex; chevMat.emissiveMap = chevTex; }
    else chevMat.color.set(0x61e9bf);
    const padBaseTex = canvasTexture(THREE, 128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#61e9bf';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#0a4a44';
      ctx.lineWidth = 12;
      ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.strokeStyle = 'rgba(255,244,166,0.85)';
      ctx.lineWidth = 3;
      ctx.strokeRect(16, 16, w - 32, h - 32);
    });
    const padBaseMat = std(0xffffff, { roughness: 0.7 });
    if (padBaseTex) padBaseMat.map = padBaseTex;
    else padBaseMat.color.set(0x61e9bf);
    const iceTex = canvasTexture(THREE, 128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#b8f2ff';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < 7; i++) {
        ctx.lineWidth = 3 + trnd() * 5;
        ctx.beginPath();
        const sx = trnd() * w, sy = trnd() * h;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + 40 + trnd() * 50, sy - 20 - trnd() * 20);
        ctx.stroke();
      }
      // Snow trim: bright outer border + cool inner keyline.
      ctx.strokeStyle = '#e8fcff';
      ctx.lineWidth = 14;
      ctx.strokeRect(7, 7, w - 14, h - 14);
      ctx.strokeStyle = '#7fc4dd';
      ctx.lineWidth = 3;
      ctx.strokeRect(18, 18, w - 36, h - 36);
    });
    const iceMat = std(0xffffff, { roughness: 0.5 });
    if (iceTex) iceMat.map = iceTex;
    else iceMat.color.set(0xb8f2ff);
    fxRes = { chevTex, chevMat, padBaseMat, iceMat };
    return fxRes;
  }
  let mapKey = '';
  layout.blocks = [];
  layout.pads = [];
  layout.surfaces = [];
  function cleanRects(list, keepGrip) {
    const out = [];
    if (!Array.isArray(list)) return out;
    for (const b of list) {
      if (!b) continue;
      const x = Number(b.x), z = Number(b.z);
      const hw = Number(b.hw), hd = Number(b.hd);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      if (!Number.isFinite(hw) || !Number.isFinite(hd) || hw <= 0 || hd <= 0) continue;
      const rect = { x, z, hw, hd };
      if (keepGrip) {
        const grip = Number(b.grip);
        if (Number.isFinite(grip)) rect.grip = grip;
      }
      out.push(rect);
    }
    return out;
  }
  const keyRects = (list) => list.map((b) =>
    `${b.x.toFixed(2)},${b.z.toFixed(2)},${b.hw.toFixed(2)},${b.hd.toFixed(2)}`).join(';');

  // Central garden bed: five low flower props (purple + marigold) sharing
  // the fallback stem/bloom geometries and two shared materials. Fixed
  // quincunx, fully deterministic — every bloom stays inside the exact hull
  // and under 0.65 above the 1.5 hedge cap.
  const GARDEN_BED_FLOWERS = [
    { dx: 0, dz: 0, h: 0.55, orange: false, ry: 0.4 },
    { dx: 1, dz: 1, h: 0.42, orange: true, ry: 1.9 },
    { dx: 1, dz: -1, h: 0.62, orange: false, ry: 3.3 },
    { dx: -1, dz: -1, h: 0.38, orange: true, ry: 4.6 },
    { dx: -1, dz: 1, h: 0.50, orange: false, ry: 5.7 },
  ];
  const BED_BLOOM_NATIVE = 0.71; // fallback flower top: stem 0.5 + bloom at 0.55
  let bedOrangeMat = null;
  function dressGardenBed(b) {
    if (!bedOrangeMat) bedOrangeMat = std(0xff9a3c, { roughness: 0.8 });
    const r = Math.min(b.hw, b.hd) * 0.45;
    for (const f of GARDEN_BED_FLOWERS) {
      const mats = f.orange
        ? Object.assign({}, fallbackMats, { bloom: bedOrangeMat })
        : fallbackMats;
      const flower = buildFallback(THREE, 'flower_purpleA', mats);
      flower.scale.setScalar(f.h / BED_BLOOM_NATIVE);
      flower.rotation.y = f.ry;
      flower.position.set(
        b.x + f.dx * r * Math.SQRT1_2, 1.5, b.z + f.dz * r * Math.SQRT1_2);
      obstacleGroup.add(flower);
    }
  }

  // One obstacle, dressed per theme. The pad ring is paint; every SOLID mesh
  // (base, cap, top) stays inside the exact hull. Grove tops read ~2.4;
  // garden hedges top out at 1.5 with low blooms on the central bed only
  // (tall crowns blocked the chase view); frost rocks scale with the
  // footprint, neon crates sit at ~2.4.
  function dressBlock(b, i, centralIdx) {
    const w = b.hw * 2, d = b.hd * 2;
    const minDim = Math.min(w, d);
    if (theme === 'grove') {
      const R = getObstacleRes();
      const pad = new THREE.Mesh(unitPad, R.padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.scale.set(w + 3, d + 3, 1);
      pad.position.set(b.x, 0.04, b.z);
      obstacleGroup.add(pad);
      // Bumper body: teal base + hazard-checker cap, then a tire stack.
      // Every solid mesh stays inside the exact hull; top reads ~2.4.
      const base = new THREE.Mesh(unitBox, R.baseMat);
      base.scale.set(w, 1.3, d);
      base.position.set(b.x, 0.65, b.z);
      obstacleGroup.add(base);
      const cap = new THREE.Mesh(unitBox, R.hazardMat);
      cap.scale.set(Math.max(0.4, w - 0.3), 0.2, Math.max(0.4, d - 0.3));
      cap.position.set(b.x, 1.4, b.z);
      obstacleGroup.add(cap);
      const tireFit = Math.max(0.3, Math.min(1, (w - 0.6) / 1.72, (d - 0.6) / 1.72));
      for (const ty of [1.72, 2.14]) {
        const tire = new THREE.Mesh(R.tireGeo, R.tireMat);
        tire.rotation.x = Math.PI / 2;
        tire.scale.setScalar(tireFit);
        tire.position.set(b.x, 1.5 + (ty - 1.5) * tireFit, b.z);
        obstacleGroup.add(tire);
      }
      return;
    }
    const T = getThemeRes();
    const pad = new THREE.Mesh(unitPad, T.padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.scale.set(w + 3, d + 3, 1);
    pad.position.set(b.x, 0.04, b.z);
    obstacleGroup.add(pad);
    const baseMat = theme === 'neon' ? T.baseMats[i % 2] : T.baseMat;
    const base = new THREE.Mesh(unitBox, baseMat);
    base.scale.set(w, 1.3, d);
    base.position.set(b.x, 0.65, b.z);
    obstacleGroup.add(base);
    const capMat = theme === 'neon' ? T.capMats[i % 2] : T.capMat;
    const cap = new THREE.Mesh(unitBox, capMat);
    cap.scale.set(Math.max(0.4, w - 0.3), 0.2, Math.max(0.4, d - 0.3));
    cap.position.set(b.x, 1.4, b.z);
    obstacleGroup.add(cap);
    if (theme === 'garden') {
      // Limestone retaining island + meadow cap top out at 1.5 — no tall
      // crowns. The central bed alone gets a low flower cluster.
      if (i === centralIdx && minDim >= 4) dressGardenBed(b);
    } else if (theme === 'frost') {
      // Snow-capped hull: an ice rock fitted inside the footprint. On large
      // arenas the top is capped so big cover reads as low snow banks with
      // clear sight lines, never view-blocking towers.
      if (minDim < 1.6) return;
      const rockH = isLarge ? Math.min(minDim * 0.9, 3.2) : minDim * 0.9;
      const rockFoot = isLarge ? Math.min(minDim * 0.9, 4) : minDim * 0.9;
      const rock = instantiate('rock_largeA', b.x, b.z, rockH,
        trnd() * Math.PI * 2, fallbackFor('rock_largeA'));
      obstacleGroup.add(fitTop(rock, b.x, b.z, 1.5, rockFoot));
    } else if (theme === 'neon' && minDim >= 1.4) {
      // Cargo cover stack: a tarped crate inside the footprint. Capped so
      // large pads read as sparse low pods with clear sight lines.
      const s = Math.min(minDim * 0.55, 2.6);
      const crate = new THREE.Mesh(unitBox, T.baseMats[(i + 1) % 2]);
      crate.scale.set(s, 0.9, s);
      crate.position.set(b.x, 1.95, b.z);
      obstacleGroup.add(crate);
    }
  }

  // One boost strip: exact-rect mint base + tiled chevron decals aligned to
  // the long axis, marching outward from the arena center. Tiles share one
  // pulsing material, so long strips cost meshes but no extra textures.
  function dressPad(p) {
    const F = getFxRes();
    const w = p.hw * 2, d = p.hd * 2;
    const base = new THREE.Mesh(unitPad, F.padBaseMat);
    base.rotation.x = -Math.PI / 2;
    base.scale.set(w, d, 1);
    base.position.set(p.x, 0.05, p.z);
    padGroup.add(base);
    const alongX = w >= d;
    const short = alongX ? d : w;
    const long = alongX ? w : d;
    if (short <= 0 || long <= 0) return;
    // Local +y (texture-up) maps to world (0,0,-1) at rz=0; Rz spins it.
    const rz = alongX ? (p.x >= 0 ? -Math.PI / 2 : Math.PI / 2) : (p.z >= 0 ? Math.PI : 0);
    const n = Math.max(1, Math.min(4, Math.round(long / short)));
    const tileLong = long / n;
    for (let i = 0; i < n; i++) {
      const tile = new THREE.Mesh(unitPad, F.chevMat);
      tile.rotation.set(-Math.PI / 2, 0, rz);
      tile.scale.set(short, tileLong, 1);
      const off = -long / 2 + (i + 0.5) * tileLong;
      tile.position.set(alongX ? p.x + off : p.x, 0.065, alongX ? p.z : p.z + off);
      padGroup.add(tile);
    }
  }

  // One grip patch: exact-rect opaque ice with a snow trim border.
  function dressSurface(s) {
    const F = getFxRes();
    const m = new THREE.Mesh(unitPad, F.iceMat);
    m.rotation.x = -Math.PI / 2;
    m.scale.set(s.hw * 2, s.hd * 2, 1);
    m.position.set(s.x, 0.045, s.z);
    surfGroup.add(m);
  }

  function syncMap(map) {
    const id = (map && map.id) || 'ring';
    const blocks = cleanRects(map && map.blocks);
    const pads = cleanRects(map && map.pads);
    const surfs = cleanRects(map && map.surfaces, true);
    // Keyed on geometry + half — a per-frame call with an unchanged snapshot
    // rebuilds nothing, and skyPhase never triggers a rebuild. (Unknown ids
    // still draw exact rects; theme + half are fixed at world creation from
    // opts.map. A half change refreshes obstacle dressing here; the static
    // ground/walls/scenery need a world rebuild via the root.)
    const incomingHalf = resolveHalf(map && map.half != null || (map && map.bound != null) ? map : null, { half });
    const key = id + '|' + incomingHalf.toFixed(1) + '|' + keyRects(blocks) + '|' + keyRects(pads) + '|' + keyRects(surfs);
    if (key === mapKey) return;
    mapKey = key;
    obstacleGroup.clear();
    padGroup.clear();
    surfGroup.clear();
    layout.blocks = blocks;
    layout.pads = pads;
    layout.surfaces = surfs;
    // Garden's central bed (block center nearest the arena middle, ties to
    // the larger) carries the low flower cluster; chicane hedges stay bare.
    // Derived from snapshot geometry, never hardcoded.
    let centralIdx = -1;
    if (theme === 'garden') {
      let bestD = Infinity, bestA = -Infinity;
      blocks.forEach((b, i) => {
        const d = Math.hypot(b.x, b.z);
        const area = b.hw * b.hd;
        if (d < bestD || (d === bestD && area > bestA)) {
          bestD = d; bestA = area; centralIdx = i;
        }
      });
    }
    blocks.forEach((b, i) => dressBlock(b, i, centralIdx));
    surfs.forEach(dressSurface);
    pads.forEach(dressPad);
  }

  /* ---- gradual sunset: stable palette + in-place sky blend ---- */
  // Base palette P is fixed at mount. skyPhase (nullable 0..1, computed by
  // the root from skyCycle + calibrated server time) blends Daybreak(0) ->
  // Sunset(0.6) -> Starlight(1) for a Daybreak base, Sunset(0) ->
  // Starlight(1) for Sunset, and a steady legible night with a drifting
  // moon for Starlight. Surfaces stay baked from the base palette so the
  // track never turns beige; only sky/sun/haze/fog/ambient blend.
  const DAY = skyPalette('Daybreak'), SUN = skyPalette('Sunset'), NIGHT = skyPalette('Starlight');
  const fogScaled = (pal) => [pal.fog[0] + (half - WORLD_HALF_DEFAULT) * 1, pal.fog[1] + (half - WORLD_HALF_DEFAULT) * 2];
  const baseFog = fogScaled(P);
  const dayFog = fogScaled(DAY), sunFog = fogScaled(SUN), nightFog = fogScaled(NIGHT);
  const baseGrassI = S.glow > 0 ? S.glowGrassI : 0;
  const nightGrassI = nightSurf.glowGrassI;
  const livePalette = {
    name,
    sky: P.sky, skyMid: P.skyMid, horizon: P.horizon,
    sun: P.sun, sunIntensity: P.sunIntensity,
    sunDir: [sunDirV.x, sunDirV.y, sunDirV.z],
    sunDisc: P.sunDisc, sunSize: P.sunSize,
    haze: P.haze, hazeOpacity: P.hazeOpacity,
    hemiSky: P.hemiSky, hemiGround: P.hemiGround, hemiIntensity: P.hemiIntensity,
    fog: baseFog.slice(), exposure: P.exposure,
    ground: S.ground, track: S.track,
    stars: P.stars, cloudsVisible: !P.stars,
  };
  let lastPhase = undefined;

  function applySkyPhase(phase) {
    if (phase == null) {
      livePalette.sky = P.sky; livePalette.skyMid = P.skyMid; livePalette.horizon = P.horizon;
      livePalette.sun = P.sun; livePalette.sunIntensity = P.sunIntensity;
      livePalette.sunDisc = P.sunDisc; livePalette.sunSize = P.sunSize;
      livePalette.haze = P.haze; livePalette.hazeOpacity = P.hazeOpacity;
      livePalette.hemiSky = P.hemiSky; livePalette.hemiGround = P.hemiGround;
      livePalette.hemiIntensity = P.hemiIntensity;
      livePalette.fog[0] = baseFog[0]; livePalette.fog[1] = baseFog[1];
      livePalette.exposure = P.exposure;
      livePalette.stars = P.stars; livePalette.cloudsVisible = !P.stars;
      sunDirV.set(P.sunDir[0], P.sunDir[1], P.sunDir[2]).normalize();
      livePalette.sunDir[0] = sunDirV.x; livePalette.sunDir[1] = sunDirV.y; livePalette.sunDir[2] = sunDirV.z;
      skyZen.setHex(P.sky); skyMid.setHex(P.skyMid); skyHor.setHex(P.horizon);
      paintDome();
      sunMesh.position.copy(sunDirV).multiplyScalar(sunDist);
      sunMesh.material.color.setHex(P.sunDisc);
      sunMesh.scale.setScalar(P.sunSize);
      sunMesh.lookAt(0, 0, 0);
      hazeMesh.position.copy(sunDirV).multiplyScalar(sunDist - 1);
      hazeMesh.material.color.setHex(P.haze);
      hazeMesh.material.opacity = P.hazeOpacity;
      hazeMesh.scale.setScalar(P.sunSize * 2.6);
      hazeMesh.lookAt(0, 0, 0);
      stars.visible = !!P.stars;
      stars.material.opacity = 0.95;
      for (let ci = 0; ci < clouds.length; ci++) clouds[ci].mesh.visible = theme!=='neon'&&!P.stars;
      cloudMat.color.setHex(baseCloudHex);
      asphaltMat.emissiveIntensity = S.glow;
      grassMat.emissiveIntensity = baseGrassI;
      railMat.emissiveIntensity = railBaseI;
      return;
    }
    let A, B, t, nightness;
    if (name === 'Daybreak') {
      if (phase <= 0.6) { A = DAY; B = SUN; t = phase / 0.6; nightness = 0; }
      else { A = SUN; B = NIGHT; t = (phase - 0.6) / 0.4; nightness = (phase - 0.6) / 0.4; }
    } else if (name === 'Sunset') {
      A = SUN; B = NIGHT; t = phase; nightness = phase;
    } else { // Starlight: steady night, drifting moon
      A = NIGHT; B = NIGHT; t = 0; nightness = 1;
    }
    livePalette.sky = hexLerp(A.sky, B.sky, t);
    livePalette.skyMid = hexLerp(A.skyMid, B.skyMid, t);
    livePalette.horizon = hexLerp(A.horizon, B.horizon, t);
    livePalette.sun = hexLerp(A.sun, B.sun, t);
    livePalette.sunIntensity = numLerp(A.sunIntensity, B.sunIntensity, t);
    livePalette.sunDisc = hexLerp(A.sunDisc, B.sunDisc, t);
    livePalette.sunSize = numLerp(A.sunSize, B.sunSize, t);
    livePalette.haze = hexLerp(A.haze, B.haze, t);
    livePalette.hazeOpacity = numLerp(A.hazeOpacity, B.hazeOpacity, t);
    livePalette.hemiSky = hexLerp(A.hemiSky, B.hemiSky, t);
    livePalette.hemiGround = hexLerp(A.hemiGround, B.hemiGround, t);
    livePalette.hemiIntensity = numLerp(A.hemiIntensity, B.hemiIntensity, t);
    const fogA = A === DAY ? dayFog : A === SUN ? sunFog : nightFog;
    const fogB = B === DAY ? dayFog : B === SUN ? sunFog : nightFog;
    livePalette.fog[0] = numLerp(fogA[0], fogB[0], t);
    livePalette.fog[1] = numLerp(fogA[1], fogB[1], t);
    livePalette.exposure = numLerp(A.exposure, B.exposure, t);
    let dx = numLerp(A.sunDir[0], B.sunDir[0], t);
    let dy = numLerp(A.sunDir[1], B.sunDir[1], t);
    let dz = numLerp(A.sunDir[2], B.sunDir[2], t);
    if (name === 'Starlight') {
      // Slow moon drift: rotate the night azimuth with phase.
      const ang = phase * 0.5;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const rx = dx * ca + dz * sa;
      const rz = -dx * sa + dz * ca;
      dx = rx; dz = rz;
    }
    const dl = Math.hypot(dx, dy, dz) || 1;
    sunDirV.set(dx / dl, dy / dl, dz / dl);
    // Keep the sun disc above the horizon through the sunset leg.
    if (name !== 'Starlight' && sunDirV.y < 0.08 && phase < 0.92) {
      sunDirV.y = 0.08;
      sunDirV.normalize();
    }
    livePalette.sunDir[0] = sunDirV.x; livePalette.sunDir[1] = sunDirV.y; livePalette.sunDir[2] = sunDirV.z;
    const starOp = name === 'Starlight' ? 0.95 : 0.95 * sstep(0.55, 0.9, phase);
    livePalette.stars = starOp > 0.4;
    livePalette.cloudsVisible = name !== 'Starlight';
    skyZen.setHex(livePalette.sky); skyMid.setHex(livePalette.skyMid); skyHor.setHex(livePalette.horizon);
    paintDome();
    sunMesh.position.copy(sunDirV).multiplyScalar(sunDist);
    sunMesh.material.color.setHex(livePalette.sunDisc);
    sunMesh.scale.setScalar(livePalette.sunSize);
    sunMesh.lookAt(0, 0, 0);
    hazeMesh.position.copy(sunDirV).multiplyScalar(sunDist - 1);
    hazeMesh.material.color.setHex(livePalette.haze);
    hazeMesh.material.opacity = livePalette.hazeOpacity;
    hazeMesh.scale.setScalar(livePalette.sunSize * 2.6);
    hazeMesh.lookAt(0, 0, 0);
    stars.visible = starOp > 0.01;
    stars.material.opacity = starOp;
    if (name === 'Starlight') {
      for (let ci = 0; ci < clouds.length; ci++) clouds[ci].mesh.visible = false;
      cloudMat.color.setHex(nightCloudHex);
    } else {
      for (let ci = 0; ci < clouds.length; ci++) clouds[ci].mesh.visible = true;
      let cloudHex;
      if (name === 'Daybreak') {
        cloudHex = phase <= 0.6
          ? hexLerp(baseCloudHex, sunsetCloudHex, phase / 0.6)
          : hexLerp(sunsetCloudHex, nightCloudHex, (phase - 0.6) / 0.4);
      } else {
        cloudHex = hexLerp(baseCloudHex, nightCloudHex, phase);
      }
      cloudMat.color.setHex(cloudHex);
    }
    asphaltMat.emissiveIntensity = numLerp(S.glow, nightSurf.glow, nightness);
    grassMat.emissiveIntensity = numLerp(baseGrassI, nightGrassI, nightness);
    railMat.emissiveIntensity = numLerp(railBaseI, railNightI, nightness);
  }

  /* ---- bounded animation: balloon, clouds, pad pulse, sky — zero alloc --- */
  const cloudWrapX = half * 2 + 75;
  function animate(dt, t, skyPhase) {
    const step = dt < 0 ? 0 : dt > 0.1 ? 0.1 : dt;
    const time = Number.isFinite(t) ? t : 0;
    const phase = clampPhase(skyPhase);
    if (phase !== lastPhase) {
      applySkyPhase(phase);
      lastPhase = phase;
    }
    balloon.position.y = BALLOON_BASE.y + Math.sin(time * 0.5) * 1.2;
    balloon.rotation.y += step * 0.05;
    if (balloon.rotation.y > Math.PI * 2) balloon.rotation.y -= Math.PI * 2;
    for (let i = 0; i < clouds.length; i++) {
      const cl = clouds[i];
      let x = cl.mesh.position.x + cl.speed * step;
      if (x > cloudWrapX) x = -cloudWrapX;
      cl.mesh.position.x = x;
    }
    // Boost strips breathe warm mint/yellow while chevrons march along the
    // strip direction. Shared material/texture only — bounded, no rebuilds.
    if (fxRes) {
      fxRes.chevMat.emissiveIntensity = 0.75 + 0.4 * Math.sin(time * 4.2);
      if (fxRes.chevTex) fxRes.chevTex.offset.y = -((time * 0.5) % 1);
    }
  }

  function stats() {
    const out = {
      meshes: 0, instanced: 0, lines: 0, points: 0,
      drawCalls: 0, triangles: 0, obstacles: obstacleGroup.children.length,
      pads: padGroup.children.length, surfaces: surfGroup.children.length,
      nearProps: layout.trees.length + layout.rocks.length + layout.bushes.length +
        layout.flowers.length + layout.structures.length + cornerFlags.length + 4,
      planting: layout.bushes.length + layout.flowers.length,
      ridgePines: layout.ridgePines.length,
      clusters: layout.clusters.length,
    };
    root.traverse((obj) => {
      if (obj.isInstancedMesh) {
        out.instanced += 1;
        out.drawCalls += 1;
        const g = obj.geometry;
        const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        out.triangles += Math.round(tris * obj.count);
      } else if (obj.isMesh) {
        out.meshes += 1;
        out.drawCalls += 1;
        const g = obj.geometry;
        if (g) {
          const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
          out.triangles += Math.round(tris);
        }
      } else if (obj.isLineSegments || obj.isLine) {
        out.lines += 1;
        out.drawCalls += 1;
      } else if (obj.isPoints) {
        out.points += 1;
        out.drawCalls += 1;
      }
    });
    return out;
  }

  layout.theme = theme;
  layout.half = half;
  layout.bound = bound;
  return {
    syncMap,
    animate,
    stats,
    group: root,
    layout,
    theme,
    half,
    groundAt,
    propGroundAt,
    bounds: { arena: half, half, bound, sceneryMin, hillMin },
    palette: livePalette,
  };
}
