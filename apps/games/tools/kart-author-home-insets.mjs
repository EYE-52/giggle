// Offline, deterministic repair of compact Skyport homes on open deck edges.
// Keep IDs, starts, geometry, profiles and candidate distances unchanged.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {skyportPoses} from '../public/js/engines/kart-skyport-poses.mjs';
import {skyportGeometry} from '../public/js/engines/kart-skyport-split.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {elevatedStatics} from '../public/js/engines/kart-feature-solids.mjs';
import {arenaClearanceGraph} from '../test/helpers/kart-arena-audit.mjs';
await R.init();
const out=structuredClone(skyportPoses),data=out.compact,map=skyportGeometry(true,.75),world=createKartPhysics(R,C),changes=[];
const expected={'home-21':[31.5,28.5],'home-27':[-40.5,28.5],'home-29':[-19.5,28.5],'home-32':[-28.5,1.5],'home-34':[10.5,-16.5],'home-37':[-25.5,28.5],'home-39':[40.5,1.5]};
const inset={'home-21':[28.5,24],'home-27':[-36,24],'home-29':[-22.5,24],'home-32':[-27,6],'home-34':[10.5,-13.5],'home-37':[-25.5,24],'home-39':[37.5,6]};
try{
 elevatedStatics(map).forEach(d=>world.addStatic(d));
 for(const [id,[x,z]]of Object.entries(inset)){
  const home=data.sockets.find(h=>h.id===id),before={x:home.x,y:home.y,z:home.z};assert((home.x===x&&home.z===z)||(home.x===expected[id][0]&&home.z===expected[id][1]),id+' layout changed; re-audit before applying this migration');Object.assign(home,{x,z});
  const support=world.supportAt({x,y:home.y+.4,z},.8);assert(support&&Math.abs(support.point.y-home.y)<.04);home.surface=support.surfaceId;
  for(let i=0;i<8;i++){const a=i*Math.PI/4,s=world.supportAt({x:x+Math.cos(a)*3,y:home.y+.4,z:z+Math.sin(a)*3},.8);assert(s&&Math.abs(s.point.y-home.y)<.04,id+' has 3m supported run-out');}
  assert(data.spawns.filter(s=>s.y===home.y).every(s=>Math.hypot(s.x-x,s.z-z)>=8),id+' retains the opening setback');
  if(before.x!==x||before.z!==z)changes.push({id,before,after:{x,y:home.y,z}});
 }
 const nav=arenaClearanceGraph(world,map),homeNodes=data.sockets.map(h=>nav.nearest(h)?.n.index);assert(homeNodes.every(Number.isInteger));
 data.travelAtlas.homeDistances=[];
 for(const spawn of data.spawnCandidates){const start=nav.nearest(spawn);assert(start);const field=nav.shortest(start.n.index);for(const i of homeNodes){const d=field.distance[i];data.travelAtlas.homeDistances.push(Number.isFinite(d)?Math.min(65534,Math.ceil(d*2)):65535);}}
 fs.writeFileSync(new URL('../public/js/engines/kart-skyport-poses.mjs',import.meta.url),'// Explicit Rapier-supported poses and road-distance atlas. tools/kart-author-launch.mjs; home insets: tools/kart-author-home-insets.mjs.\nexport const skyportPoses='+JSON.stringify(out)+';\n');
 if(changes.length)fs.writeFileSync(new URL('../../../artifacts/kart-arenas/skyport-home-insets.json',import.meta.url),JSON.stringify({scope:'Seven compact upper homes moved inboard; IDs, profiles, starts and geometry unchanged. Home road-distance columns rebuilt offline.',changes},null,2));
 console.log('PASS compact Skyport: seven supported home insets and rebuilt road-distance columns');
}finally{world.dispose();}
