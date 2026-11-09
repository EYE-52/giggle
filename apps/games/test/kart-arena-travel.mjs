import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {selectArenaVariant} from '../public/js/engines/kart-arena-policy.mjs';
import {createArenaTravelScorer} from '../public/js/engines/kart-arena-travel.mjs';
import {elevatedStatics} from '../public/js/engines/kart-feature-solids.mjs';
await R.init();
for(const [id,players]of[['rookie-ribbons',8],['skyport-split',32]]){
 const map=selectArenaVariant(elevatedMap(id),players),w=createKartPhysics(R,C);elevatedStatics(map).forEach(d=>w.addStatic(d));
 try{const atlas=map.travelAtlas,n=atlas.ids.length;assert.equal(atlas.distances.length,n*n);assert(new Set(atlas.ids).size===n);for(let i=0;i<n;i++){assert.equal(atlas.distances[i*n+i],0);for(let j=0;j<n;j++)assert(Math.abs(atlas.distances[i*n+j]-atlas.distances[j*n+i])<=1);}
  const travel=createArenaTravelScorer(w,map);assert(travel);const enemy=map.spawnCandidates[0],p={x:enemy.x,y:enemy.y+.65,z:enemy.z};travel.prepare([p]);assert.equal(travel.distance(enemy),0);
  if(id==='rookie-ribbons'){const upper=map.spawnCandidates[12],direct=Math.hypot(upper.x-p.x,upper.y+.65-p.y,upper.z-p.z);assert(travel.distance(upper)>direct*2,'stacked decks use real climb distance');}
  travel.prepare([]);assert.equal(travel.distance(enemy),Infinity);assert.equal(createArenaTravelScorer(w,{...map,travelAtlas:null}),null);
 }finally{w.dispose();}
}
console.log('PASS offline road-distance atlases, supported enemy attachment, stacked-floor respawn distance and safe legacy fallback');
