// Offline authoring. Writes explicit poses after real Rapier footprint and
// continuous 20m departure casts. Never runs in a match or client frame.
import fs from 'node:fs';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {createHash} from 'node:crypto';
const target=process.env.ARENA_MAP||'skyport-split',module=await import('../public/js/engines/kart-'+target+'.mjs'),buildFunction=Object.values(module).find(fn=>typeof fn==='function'&&/Builds$/.test(fn.name)),builds=buildFunction();
import {elevatedStatics} from '../public/js/engines/kart-feature-solids.mjs';
import {spawnLaneOracle,yaw} from '../test/helpers/kart-spawn-lane.mjs';
import {arenaClearanceGraph} from '../test/helpers/kart-arena-audit.mjs';
import {measureArenaArea} from '../test/helpers/kart-arena-audit.mjs';
await R.init();const out={},cache=new Map();
for(const {id,max:seats,homes:homeCounts,starts:startCounts,geometry:m}of builds){
 const signature=createHash('sha256').update(JSON.stringify([3,m.colliders,m.features,m.playBounds,m.noStartMaterials,m.belts])).digest('hex'),cachePath=new URL('../../../artifacts/kart-arenas/'+target+'-'+id+'-author-cache.json',import.meta.url);
 let cached;try{const data=JSON.parse(fs.readFileSync(cachePath));if(data.signature===signature)cached=data;}catch{}
 const legalFloors=[],w=createKartPhysics(R,C);elevatedStatics(m).forEach(d=>w.addStatic(d));const nav=arenaClearanceGraph(w,m),lane=spawnLaneOracle(R,w,m),spawns=[],spawnCandidates=[],sockets=[];
 const features=[...m.features.cannons.flatMap(c=>[c,c.land]),...m.features.portals.flat()],farFromFeatures=p=>features.every(f=>Math.abs(f.y-p.y)>3||Math.hypot(p.x-f.x,p.z-f.z)>=8);
 const departureClear=(a,b)=>{const x=a.x-b.x,z=a.z-b.z,vx=Math.sin(a.angle)-Math.sin(b.angle),vz=Math.cos(a.angle)-Math.cos(b.angle),t=Math.max(0,Math.min(22,-(x*vx+z*vz)/(vx*vx+vz*vz||1)));return Math.hypot(x+vx*t,z+vz*t)>=4.5;};
 const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z),district=p=>(p.x<0?'west':'east')+'-'+(p.z<16?'north':'south')+'-'+p.level;
 const point=(x,y,z)=>{const hit=w.supportAt({x,y:y+.4,z},.8);if(!hit||Math.abs(hit.point.y-y)>.04||hit.normal.y<.65||w.overlapsStatic({x,y:y+.8,z},yaw(0),{x:1.35,y:.3,z:1.7}))return null;const p={x,y,z,angle:0,surface:hit.surfaceId,level:'L'+m.levels.findIndex(l=>l.y===y),profile:y||m.colliders.find(d=>d.id===hit.surfaceId)?.material==='ice'?'exposed':'safe'};p.district=district(p);return p;};
 for(const [li,{y}]of m.levels.entries()){
  const legal=cached?.legalFloors[li]||[];if(!cached)for(let x=-m.playBounds.halfX+4;x<=m.playBounds.halfX-4;x+=4)for(let z=-m.playBounds.halfZ+4;z<=m.playBounds.halfZ-4;z+=4){const p=point(x,y,z);if(!p||!farFromFeatures(p)||(m.noStartMaterials||[]).includes(m.colliders.find(d=>d.id===p.surface)?.material))continue;for(const angle of[0,Math.PI/2,Math.PI,-Math.PI/2,...(m.authorDiagonalStarts?[Math.PI/4,Math.PI*3/4,-Math.PI/4,-Math.PI*3/4]:[])]){const candidate={...p,angle};if((m.belts||[]).every(b=>{if(Math.abs(b.y-y)>.1)return true;return !(Math.abs(x-b.x)<b.halfX+3&&Math.abs(z-b.z)<b.halfZ+8);})&&features.every(f=>{if(Math.abs(f.y-candidate.y)>3)return true;const dx=Math.sin(angle),dz=Math.cos(angle),t=Math.max(0,Math.min(22,(f.x-x)*dx+(f.z-z)*dz));return Math.hypot(x+dx*t-f.x,z+dz*t-f.z)>=8;})&&C.wheels.every(wheel=>{const qx=x+Math.cos(angle)*wheel.x+Math.sin(angle)*wheel.z,qz=z-Math.sin(angle)*wheel.x+Math.cos(angle)*wheel.z,hit=w.supportAt({x:qx,y:y+.4,z:qz},.8);return !(m.noStartMaterials||[]).includes(m.colliders.find(d=>d.id===hit?.surfaceId)?.material);})&&lane(candidate)){legal.push(candidate);if(!m.authorDiagonalStarts)break;}}}
  legalFloors.push(legal);
  const selected=[];while(selected.length<startCounts[li]){const ranked=legal.filter(p=>selected.every(q=>dist(p,q)>=6&&departureClear(p,q))).map(p=>({p,score:selected.length?Math.min(...selected.map(q=>dist(p,q))):Math.hypot(p.x,p.z)})).sort((a,b)=>b.score-a.score);if(!ranked.length)throw new Error(id+' no starts L'+li);const p={...ranked[0].p,id:'start-'+spawns.length};selected.push(p);spawns.push(p);spawnCandidates.push(p);}
  const candidates=spawnCandidates.filter(p=>p.level==='L'+li);while(candidates.length<startCounts[li]*2){const ranked=legal.filter(p=>candidates.every(q=>dist(p,q)>=3.9)).map(p=>({p,score:Math.min(...candidates.map(q=>dist(p,q)))})).sort((a,b)=>b.score-a.score);if(!ranked.length)throw new Error(id+' no reserve starts L'+li);const p={...ranked[0].p,id:'reserve-'+spawnCandidates.length};candidates.push(p);spawnCandidates.push(p);}
  const fields=selected.map(p=>nav.shortest(nav.nearest(p).n.index)),needs=selected.map(()=>0);
  const homes=[];for(let x=-m.playBounds.halfX+3;x<=m.playBounds.halfX-3;x+=3)for(let z=-m.playBounds.halfZ+3;z<=m.playBounds.halfZ-3;z+=3){const p=point(x,y,z);if(!p||!farFromFeatures(p)||spawns.some(s=>s.y===y&&dist(s,p)<8)||w.sweepStatic({x,y:y+.65,z},{x,y:y+.65,z},.45))continue;const near=nav.nearest(p);if(!near)continue;p.distances=fields.map(f=>f.distance[near.n.index]);if(p.distances.every(d=>!Number.isFinite(d)))continue;homes.push(p);}
  const picked=[];while(picked.length<homeCounts[li]){const pending=li===0?Object.entries(m.homeMaterialMinimums||{}).find(([material,min])=>picked.filter(p=>m.colliders.find(d=>d.id===p.surface)?.material===material).length<min):null;const ranked=homes.filter(p=>picked.every(q=>dist(p,q)>=6)&&(!pending||m.colliders.find(d=>d.id===p.surface)?.material===pending[0])).map(p=>({p,score:p.distances.reduce((score,d,i)=>score+(needs[i]<2?Math.max(0,32-d)*(2-needs[i]):0),0)*10+(picked.length?Math.min(...picked.map(q=>dist(p,q))):0)})).sort((a,b)=>b.score-a.score);if(!ranked.length)throw new Error(id+' no homes L'+li+' '+picked.length);const p={...ranked[0].p,id:'home-'+sockets.length};p.distances.forEach((d,i)=>{if(d<=32)needs[i]++;});delete p.distances;picked.push(p);sockets.push(p);}
  if(needs.some(n=>n<2))throw new Error(id+' opening homes missing floor '+li+': '+needs+' starts '+JSON.stringify(selected)+' homes '+JSON.stringify(picked));
 }
 const area=cached?.area||measureArenaArea(w,m);fs.mkdirSync(new URL('../../../artifacts/kart-arenas/',import.meta.url),{recursive:true});fs.writeFileSync(cachePath,JSON.stringify({signature,area,legalFloors}));
 const byFloor=m.levels.map(l=>spawns.filter(s=>s.level===l.id)),used=m.levels.map(()=>0),ordered=[];
 for(let i=0;i<spawns.length;i++){let best=-1,score=-Infinity;for(let f=0;f<byFloor.length;f++){const deficit=(i+1)*startCounts[f]/spawns.length-used[f];if(used[f]<byFloor[f].length&&deficit>score){score=deficit;best=f;}}ordered.push(byFloor[best][used[best]++]);}
 const nearest=spawnCandidates.map(s=>nav.nearest(s).n.index),homeNodes=sockets.map(s=>nav.nearest(s).n.index),atlas=[],homeDistances=[];
 for(const n of nearest){const field=nav.shortest(n);for(const index of nearest){const d=field.distance[index];atlas.push(Number.isFinite(d)?Math.min(65534,Math.round(d*2)):65535);}for(const index of homeNodes){const d=field.distance[index];homeDistances.push(Number.isFinite(d)?Math.min(65534,Math.ceil(d*2)):65535);}}
 out[id]={spawns:ordered,spawnCandidates,sockets,usableArea:area.total,areaAudit:area,travelAtlas:{version:1,scale:.5,ids:spawnCandidates.map(s=>s.id),distances:atlas,homeIds:sockets.map(s=>s.id),homeDistances}};w.dispose();console.log(id,{starts:spawns.length,candidates:spawnCandidates.length,homes:sockets.length,area});
}
const name=target.split('-')[0],exportName=name==='frostbite'?'frostPoses':name==='foundry'?'foundryPoses':name+'Poses';
fs.writeFileSync(new URL('../public/js/engines/kart-'+name+'-poses.mjs',import.meta.url),'// Explicit Rapier-supported poses and road-distance atlas. tools/kart-author-launch.mjs.\nexport const '+exportName+'='+JSON.stringify(out)+';\n');
