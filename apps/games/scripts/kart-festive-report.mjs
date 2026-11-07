// Run the lighting test first; turn its measured placements into a review list.
import {readFile,writeFile} from 'node:fs/promises';
const reports=JSON.parse(await readFile('/tmp/codex-festive-spawn-review.json','utf8'));
const point=p=>'('+p.map(n=>Number(n.toFixed(2))).join(', ')+')';
const lines=[
  '# Festive lights: driving-camera review','',
  'The revised lights use **0.32–0.34 m bulb cores**, **0.7 m spacing** (or closer at short runs), and **1.28–1.36 m additive glow halos**. Low detail keeps one quarter of the bulbs and slightly larger 1.44–1.53 m halos. Neon tubes are 0.32 m across, with pink/cyan/purple/lime colours and a visible travelling chase. There are three added draws per map, no bulb lights/shadows, no bloom, no new textures and no per-frame instance-buffer updates. Reduced motion makes the lights steady.','',
  'The main change is placement: cover tops, actual safety kerbs, both sides of ramps, and lane gantries **8 m ahead of the raised-map starts**. Nearby starts on the same lane share a gantry. Similar gantries mark the central and corner lanes of classic maps. Cannon/portal rims still carry dense bulbs. Frosty Pass also has Christmas lights on both ski-station roof fronts.','',
  'Counts include bulbs, not the matching halo instances. High / medium / low use 100% / 50% / 25% of the cores and halos. Tubes stay visible at every tier. A fresh 1x desktop gets high detail; the tier falls only when that renderer lowers its initial resolution or disables shadows.','',
  '| Arena | High | Medium | Low | Added triangles (high) |',
  '| --- | ---: | ---: | ---: | ---: |',
];
for(const r of reports)lines.push(`| ${r.name} (${r.map.split('/')[0]}) | ${r.bulbs} | ${Math.ceil(r.bulbs/2)} | ${r.lowBulbs} | ${r.triangles} |`);
lines.push('','## Near every spawn','',
  'Coordinates are **(X, Y, Z)** metres, with +Z north and +X east. The listed points are actual bulbs on the nearest visible fixtures. Spawn numbering is zero-based; it is the seat pool index, not a changing HUD player name.','',
  'Visibility is a geometry test, **not a Chromium screenshot result**: the production spawn cameras and 1280×730 game viewport are used. Raised maps use an 8.5 m trailing eye, 4.4 m above the kart and 52° vertical FOV. Classic maps use their 8.8 m trailing eye, terrain-aware eye height and 60° vertical FOV. Collider raycasts reject hidden lights, and the eye shortens when a solid blocks it. Every spawn has at least ten nearby visible cores projecting >=5 pixels and halos >=20 pixels; low detail retains at least three. The real camera can orbit while driving, so please still check the GPU view.','',
  'To refresh this list, run `node test/kart-festive-lights.mjs` then `node scripts/kart-festive-report.mjs`. The test also writes `/tmp/codex-festive-spawn-review.json`.');
for(const r of reports){
  lines.push('',`## ${r.name} (${r.map})`,'',
    '| Spawn and position | Visible bulbs high / low | Nearby fixtures (distance from spawn) |',
    '| --- | ---: | --- |');
  for(const p of r.spawns){
    const text=p.fixtures.map(f=>`${f.name} at ${point(f.position)} — ${f.distance} m`).join('; ');
    lines.push(`| ${p.spawn}: ${point(p.position)} | ${p.visibleBulbs} / ${p.lowVisibleBulbs} | ${text} |`);
  }
}
await writeFile(new URL('../docs/kart-festive-lights.md',import.meta.url),lines.join('\n')+'\n');
console.log('Updated festive light counts and '+reports.reduce((n,r)=>n+r.spawns.length,0)+' spawn placement lists.');
