import {runLaunchGates} from './helpers/kart-launch-gates.mjs';
await runLaunchGates({id:'skyport-split',players:[8,16,24,32],colliderBudget:92,drawBudget:65,triangleBudget:43000,cuts:['helix-0','helix-1','east-street-climb','east-roof-climb']});

// Old homes sat exactly on open upper deck edges. A kart could collect and
// then hang its front tyres over the lip while braking/turning for the next box.
import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {selectArenaVariant} from '../public/js/engines/kart-arena-policy.mjs';
import {elevatedStatics} from '../public/js/engines/kart-feature-solids.mjs';
const compact=selectArenaVariant(elevatedMap('skyport-split'),8),query=createKartPhysics(R,C);
try{
 elevatedStatics(compact).forEach(d=>query.addStatic(d));
 for(const id of ['home-21','home-27','home-29','home-32','home-34','home-37','home-39']){
  const home=compact.sockets.find(h=>h.id===id);
  for(let i=0;i<8;i++){
   const a=i*Math.PI/4,s=query.supportAt({x:home.x+Math.cos(a)*3,y:home.y+.4,z:home.z+Math.sin(a)*3},.8);
   assert(s&&Math.abs(s.point.y-home.y)<.04,id+' retains supported 3m approach/turn run-out');
  }
  assert(compact.spawns.filter(s=>s.y===home.y).every(s=>Math.hypot(s.x-home.x,s.z-home.z)>=8),id+' remains outside the opening setback');
 }
}finally{query.dispose();}
console.log('PASS compact Skyport home run-out: seven edge homes set back, eight directions, unchanged opening setback');
