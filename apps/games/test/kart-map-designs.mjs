// Level-design contracts use shipping geometry, real snapshots and all seats.
import assert from 'node:assert/strict';
import maps from '../games/engines/kart-maps.js';
import spawns from '../games/engines/kart-spawns.js';
import POCKET from '../games/pocket-karts/server.js';
import RAPIER from '@dimforge/rapier3d-compat';
import {createClassicPrediction} from '../public/js/engines/kart-classic-prediction.mjs';
import {classicStatics} from '../public/js/engines/kart-classic-motion.mjs';
import {createSurfaceIndex,surfaceTuning} from '../public/js/engines/kart-surface.mjs';
import {buildClassicArena,countDraws,loadSceneryAssets} from './helpers/kart-headless-world.mjs';
const distance=(r,p)=>Math.hypot(Math.max(0,Math.abs(p.x-r.x)-r.hw),Math.max(0,Math.abs(p.z-r.z)-r.hd));
const rampHull=r=>({x:r.x,z:r.z,hw:Math.abs(Math.cos(r.angle))*r.hw+Math.abs(Math.sin(r.angle))*r.hl,hd:Math.abs(Math.sin(r.angle))*r.hw+Math.abs(Math.cos(r.angle))*r.hl});
let revisionSnapshot;
const ceilings={ring:97,blocks:98,garden:117,frost:108,neon:91},reports=[];
await POCKET.initialize();
const assets=await loadSceneryAssets();
for(const id of maps.mapIds()){
 const map={id,...maps.mapDef(id)},solids=[...map.blocks,...map.barriers,...map.ramps.map(rampHull)];
 assert.match(map.revision,new RegExp('^'+id+'-.*-20261109-\\d+$'));
 // The exact same 32 poses must be safe at every room size, including low walls.
 let minSpacing=Infinity;
 for(const count of [2,8,16,32]){
  const starts=spawns.crowdSpawns(map,count).slice(0,count);assert.equal(starts.length,count,id+' has every requested seat');
  for(let i=0;i<starts.length;i++){
   const p=starts[i];assert(Math.max(Math.abs(p.x),Math.abs(p.z))<=map.half-5,id+' fence setback');
   assert(solids.every(r=>distance(r,p)>=2.8-1e-6),id+' chassis clears cover, walls and ramp feet');
   assert(map.features.falls.every(r=>distance(r,p)>=2.8),id+' no hazard start');
   for(const q of starts.slice(i+1)){const d=Math.hypot(p.x-q.x,p.z-q.z);minSpacing=Math.min(minSpacing,d);assert(d>=spawns.SPACING-1e-6,id+' separated chassis');}
  }
 }
 const players=Array.from({length:32},(_,i)=>({id:'p'+i,name:'Driver '+i}));
 let now=1000000;const ctx={now:()=>now,players:()=>players,allPlayers:()=>players,settings:()=>({map:map.label,mode:'Zap Battle'}),broadcast(){},award(){},later:()=>()=>{}};
 const state=POCKET.create(ctx);
 try{const view=POCKET.view(state,'p0');if(id==='ring')revisionSnapshot={...structuredClone(view),you:'p0',instanceId:'map-revision'};assert.equal(view.map.revision,map.revision);for(const key of ['roads','barriers','ramps','blocks','pads','surfaces','features'])assert.deepEqual(view.map[key],map[key],id+' shared '+key);assert.equal(view.karts.length,32);}
 finally{POCKET.dispose(state);}
 const arena=buildClassicArena(id,assets);let peak=countDraws(arena.scene);for(let i=0;i<3;i++){arena.world.animate(1/60,i,i/2);peak=Math.max(peak,countDraws(arena.scene));}
 assert(peak<=ceilings[id],id+' retains existing full-scene draw ceiling');
 reports.push({id,revision:map.revision,pickups:map.spots.length,minSpawnSpacing:+minSpacing.toFixed(2),draws:peak,triangles:arena.world.stats().triangles});
 arena.features.dispose();arena.structures.dispose();arena.world.dispose();
}
let worlds=0;
const counted={...RAPIER,World:new Proxy(RAPIER.World,{construct(Target,args){worlds++;return Reflect.construct(Target,args);}})};
const prediction=createClassicPrediction(counted);
try{
 prediction.ingest(revisionSnapshot,1000000);
 prediction.ingest(structuredClone(revisionSnapshot),1000000);
 assert.equal(worlds,1,'unchanged map revision reuses the physics world');
 prediction.ingest({...revisionSnapshot,map:{...revisionSnapshot.map,revision:'ring-bowtie-20261109-2'}},1000000);
 assert.equal(worlds,2,'new revision rebuilds client colliders even with unchanged map id');
}finally{prediction.dispose();}
const {ring,blocks,garden,frost,neon}=maps.MAPS;
assert(ring.roads.slice(0,2).every(r=>r.points[0][0]===0&&r.points[0][1]===0),'bow tie lobes share the crossover');
assert(ring.roads[0].points.some(p=>p[1]<-20)&&ring.roads[1].points.some(p=>p[1]>20),'opposite turning lobes');
assert(blocks.blocks.filter(b=>b.hw>=9).length===2&&blocks.blocks.some(b=>b.hd>b.hw),'maze has long lane cover and central turn blockers');
assert(garden.blocks.some(b=>b.x===0&&b.z===0&&b.hw===4&&b.hd===4),'solid central fountain island');
assert.equal(classicStatics({id:'garden',...garden}).filter(d=>d.id.startsWith('cover-piece-')).length,3,'fountain stone parts have matching colliders; water stays cosmetic');
assert(!garden.spots.some(([x,z])=>Math.abs(x)<6.5&&Math.abs(z)<6.5),'no pickup hidden in fountain');
const ice=createSurfaceIndex(frost);
assert(surfaceTuning(ice,0,-19).traction<.5&&surfaceTuning(ice,0,19).traction<.5,'two low-grip lake halves');
assert.equal(surfaceTuning(ice,0,0).traction,1,'grippy frozen bridge between lake halves');
assert(frost.surfaces.reduce((a,r)=>a+r.hw*r.hd*4,0)>=1600,'lake is a real gameplay region');
assert(neon.blocks.every(b=>Math.abs(b.x)>=20)&&neon.blocks.length===6,'city blocks leave a central plaza and offset alleys');
// Compare normalized road footprints: changing colour cannot satisfy this.
function footprint(m){const out=new Set();for(let z=-25;z<=25;z++)for(let x=-25;x<=25;x++){
 const px=x*m.half/30,pz=z*m.half/30;
 for(const r of m.roads){let found=false;for(let i=0;i<r.points.length-(r.closed?0:1);i++){
  const a=r.points[i],b=r.points[(i+1)%r.points.length],dx=b[0]-a[0],dz=b[1]-a[1],len=dx*dx+dz*dz,t=len?Math.max(0,Math.min(1,((px-a[0])*dx+(pz-a[1])*dz)/len)):0;
  if(Math.hypot(px-a[0]-t*dx,pz-a[1]-t*dz)<r.width/2){found=true;break;}
 }if(found){out.add(x+','+z);break;}}
 }return out;}
const shapes=maps.mapIds().map(id=>[id,footprint(maps.mapDef(id))]),overlaps=[];
for(let i=0;i<shapes.length;i++)for(let j=i+1;j<shapes.length;j++){const [a,A]=shapes[i],[b,B]=shapes[j],common=[...A].filter(p=>B.has(p)).length,similarity=common/(A.size+B.size-common);assert(similarity<.65,a+'/'+b+' distinct route silhouettes');overlaps.push({pair:a+'/'+b,similarity:+similarity.toFixed(3)});}
console.log(JSON.stringify({pass:true,reports,overlaps}));
