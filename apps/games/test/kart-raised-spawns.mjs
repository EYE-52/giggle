import {elevatedStatics} from '../public/js/engines/kart-feature-solids.mjs';
// The authored heading must work. No alternate heading, steering, recovery,
// or teleport is permitted during a spawn's actual driving check.
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {elevatedMap,elevatedMapIds} from '../public/js/engines/kart-elevated-maps.mjs';
import {spawnLaneOracle,yaw} from './helpers/kart-spawn-lane.mjs';
import {createElevatedCombat} from '../games/engines/kart-elevated-combat.js';
import {MAP_LABELS} from '../games/engines/kart-elevated-adapter.js';
import {selectArenaVariant} from '../public/js/engines/kart-arena-policy.mjs';
await RAPIER.init();let runs=0;
for(const id of elevatedMapIds){const map=elevatedMap(id),w=createKartPhysics(RAPIER,CONFIG);
  try{elevatedStatics(map).forEach(d=>w.addStatic(d));w.addKart('bot',{position:{x:0,y:1,z:0}});const lane=spawnLaneOracle(RAPIER,w,map);
    for(const p of map.spawns){
      assert(lane(p,20),id+'/'+p.id+' complete kart hull clears 20m, with support beneath every corner');
      w.resetKart('bot',{position:{x:p.x,y:p.y+1,z:p.z},rotation:yaw(p.angle)});w.applyIntent('bot',{throttle:0,steer:0});for(let t=0;t<90;t++)w.step();
      w.applyIntent('bot',{throttle:1,steer:0});for(let t=0;t<150;t++)w.step();const pose=w.pose('bot');
      assert(pose.speed>=8,id+'/'+p.id+' is still moving after 2.5 seconds of full throttle');
      assert(Math.hypot(pose.position.x-p.x,pose.position.z-p.z)>15,id+'/'+p.id+' actually drives forward');
      assert(w.supportAt(pose.position,3.5)&&1-2*(pose.rotation.x**2+pose.rotation.z**2)>.75,id+'/'+p.id+' stays upright over a road or connected ramp');runs++;
    }
  }finally{w.dispose();}
}
console.log('PASS '+runs+' authored starts: continuous 20m hull casts, no drop, 2.5s full-throttle drive');

// Check the settled, server-selected starts in a real full match. An empty
// parking spot can still face a wall or the end of a deck.
const seats=Array.from({length:32},(_,i)=>({id:'driver-'+i}));
let extraStarts=0;
for(const id of Object.values(MAP_LABELS)){
  const source=elevatedMap(id);
  const map=source.arenaVersion?selectArenaVariant(source,seats.length):source;
  if(map.spawns.length>=seats.length)continue;
  const match=createElevatedCombat(RAPIER,CONFIG,map,seats,{instance:'crowd',seed:1});
  const world=createKartPhysics(RAPIER,CONFIG);
  try{
    elevatedStatics(map).forEach(d=>world.addStatic(d));
    const lane=spawnLaneOracle(RAPIER,world,map);
    for(const kart of match.snapshot().karts.slice(map.spawns.length)){
      const {position,rotation:q}=kart.pose;
      const ground=world.supportAt(position,2);
      assert(ground && !world.overlapsStatic(position,q),id+' has a clear, supported grid');
      const angle=Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.x*q.x));
      assert(lane({...position,y:ground.point.y,angle},6),id+'/'+kart.id+' can leave the grid');
      extraStarts++;
    }
  }finally{world.dispose();match.dispose();}
}
console.log('PASS '+extraStarts+' overflow starts with six metres of clear track ahead');
