import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {selectArenaVariant} from '../public/js/engines/kart-arena-policy.mjs';
import {elevatedStatics} from '../public/js/engines/kart-feature-solids.mjs';
import {driveArenaRoute} from './helpers/kart-arena-driver.mjs';
import {runLaunchGates} from './helpers/kart-launch-gates.mjs';
await R.init();for(const count of[6,8,16]){const map=selectArenaVariant(elevatedMap('frostbite-crescent'),count),w=createKartPhysics(R,C);elevatedStatics(map).forEach(d=>w.addStatic(d));try{const ice=map.colliders.find(d=>d.material==='ice');assert(ice.grip<.5);assert(map.sockets.filter(s=>s.surface===ice.id).length>=6);assert(map.spawns.every(s=>s.surface!==ice.id));assert.equal(w.supportAt({x:0,y:.4,z:-30},.8),null,'the inlet jump is over real water');assert(w.supportAt({x:0,y:.4,z:-40},.8),'ordinary shore bypass');assert(w.supportAt({x:40,y:.4,z:0},.8),'east drop has dry catch ground');
 for(const p of map.spawns)for(const wheel of C.wheels){const x=p.x+Math.cos(p.angle)*wheel.x+Math.sin(p.angle)*wheel.z,z=p.z-Math.sin(p.angle)*wheel.x+Math.cos(p.angle)*wheel.z;assert.notEqual(w.supportAt({x,y:p.y+.4,z},.8).surfaceId,ice.id,'all four starting wheels are dry');}
 const drop=driveArenaRoute(R,C,map,[{x:26,y:8,z:0},{x:32,y:8,z:0},{x:40,y:0,z:0}]);assert(drop.complete);assert.deepEqual(drop.events,[]);
 w.addKart('jump',{position:{x:-20,y:1,z:-30},rotation:{x:0,y:Math.SQRT1_2,z:0,w:Math.SQRT1_2}});for(let i=0;i<90;i++)w.step();w.applyIntent('jump',{throttle:1,steer:0});let air=false,land=false;for(let i=0;i<180;i++){w.step();const p=w.pose('jump');if(Math.abs(p.position.x)<3&&!p.grounded&&p.position.y>1.5)air=true;if(p.position.x>15&&p.grounded){land=true;break;}}assert(air&&land,'real inlet jump clears the missing floor and lands');}finally{w.dispose();}}
await runLaunchGates({id:'frostbite-crescent',players:[6,8,16],colliderBudget:62,drawBudget:58,triangleBudget:40000});
