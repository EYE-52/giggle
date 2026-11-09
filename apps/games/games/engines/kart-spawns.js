'use strict';
/* Crowd spawns: authored spawn pools hold 8-10 poses, so a 32-driver
 * match needs more legal starting poses. Up to the authored pool size the
 * pool is returned unchanged (small matches start exactly as before).
 * Beyond it, candidates come from side-by-side slots next to authored
 * spawns, then the map's pickup spots, then a coarse grid; each must sit
 * inside the fence, clear of every cover block and arena feature, and at least SPACING from
 * every pose already chosen, so no two chassis ever start overlapping. */

const SPACING = 4.6;     // > chassis diagonal (2 x 1.97 m) plus margin
const BLOCK_MARGIN = 2.8; // chassis half-diagonal plus margin
const EDGE_MARGIN = 3;
const FEATURE_CLEAR = 5.5; // cannon pad / landing / portal ring radius plus margin

const faceCenter = (x, z) => (Math.abs(x) < 1e-9 && Math.abs(z) < 1e-9 ? 0 : Math.atan2(-x, -z));

function legal(map, bound, p) {
  if (Math.abs(p.x) > bound - EDGE_MARGIN || Math.abs(p.z) > bound - EDGE_MARGIN) return false;
  const solids = [...(map.blocks || []), ...(map.barriers || []), ...(map.ramps || []).map(r => ({
    x:r.x, z:r.z, hw:Math.abs(Math.cos(r.angle))*r.hw+Math.abs(Math.sin(r.angle))*r.hl,
    hd:Math.abs(Math.sin(r.angle))*r.hw+Math.abs(Math.cos(r.angle))*r.hl,
  }))];
  for (const b of solids) {
    if (Math.abs(p.x - b.x) < b.hw + BLOCK_MARGIN && Math.abs(p.z - b.z) < b.hd + BLOCK_MARGIN) return false;
  }
  // Arena features: never start in a fall zone, on a cannon or portal, or
  // where a cannon lands.
  const f = map.features || {};
  for (const z of f.falls || []) {
    if (Math.abs(p.x - z.x) < z.hw + BLOCK_MARGIN && Math.abs(p.z - z.z) < z.hd + BLOCK_MARGIN) return false;
  }
  const spots = [...(f.cannons || []).flatMap(c => [c, c.land]), ...(f.portals || []).flat()].filter(Boolean);
  if (spots.some(q => Math.hypot(p.x - q.x, p.z - q.z) < FEATURE_CLEAR)) return false;
  return true;
}

function crowdSpawns(map, count) {
  const pool = Array.isArray(map.spawns) ? map.spawns : [];
  if (count <= pool.length) return pool.slice();
  const half = Number(map.half) > 0 ? Number(map.half) : 30, bound = half - 2;
  const chosen = pool.slice();
  const fits = p => legal(map, bound, p) && chosen.every(q => Math.hypot(q.x - p.x, q.z - p.z) >= SPACING);
  const add = p => { if (chosen.length < count && fits(p)) chosen.push(p); };
  // Side-by-side slots keep each authored spawn's facing (a starting grid).
  for (const lane of [1, -1, 2, -2]) {
    for (const s of pool) {
      const off = lane * SPACING;
      add({ x: s.x + Math.cos(s.angle) * off, z: s.z - Math.sin(s.angle) * off, angle: s.angle });
    }
  }
  for (const [x, z] of map.spots || []) add({ x, z, angle: faceCenter(x, z) });
  for (let step = SPACING * 1.5; chosen.length < count && step >= SPACING; step -= 0.5) {
    for (let x = -bound + EDGE_MARGIN; x <= bound - EDGE_MARGIN; x += step) {
      for (let z = -bound + EDGE_MARGIN; z <= bound - EDGE_MARGIN; z += step) add({ x, z, angle: faceCenter(x, z) });
    }
  }
  return chosen;
}

module.exports = { crowdSpawns, SPACING };
