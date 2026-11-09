import assert from 'node:assert/strict';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {selectArenaVariant} from '../public/js/engines/kart-arena-policy.mjs';
import {elevatedStatics} from '../public/js/engines/kart-feature-solids.mjs';
import {applyElevatedBelts} from '../public/js/engines/kart-elevated-surfaces.mjs';
import {runLaunchGates} from './helpers/kart-launch-gates.mjs';
await runLaunchGates({id:'foundry-wheel',players:[8,16,24,32],colliderBudget:96,drawBudget:68,triangleBudget:46000});

for(const players of[8,16,24,32]){const map=selectArenaVariant(elevatedMap('foundry-wheel'),players),world=createKartPhysics(R,C);try{elevatedStatics(map).forEach(d=>world.addStatic(d));
 assert.equal(map.belts.length,3);assert.equal(world.supportAt({x:20*(map.artScale||1),y:.4,z:0},.8),null,'furnace void has no invisible ground');
 for(const b of map.belts){const id=b.id;world.addKart(id,{position:{x:b.x,y:b.y+1,z:b.z}});for(let i=0;i<90;i++)world.step();const p=world.pose(id);assert(p.grounded);assert(p.wheels.some(w=>w.contact&&w.surfaceId===b.surface),b.id+' exact supported belt floor');assert(applyElevatedBelts(world,id,p,map,1/60));const moved=world.pose(id);assert((moved.linearVelocity.x-p.linearVelocity.x)*b.velocity.x+(moved.linearVelocity.z-p.linearVelocity.z)*b.velocity.z>0,'own belt pushes in its authored direction');assert(!applyElevatedBelts(world,id,{...p,grounded:false},map,1/60));assert(!applyElevatedBelts(world,id,{...p,position:{...p.position,y:p.position.y+8}},map,1/60),'no belt leaks to the floor above');}
 for(const p of map.spawns)for(const b of map.belts)if(Math.abs(p.y-b.y)<.1)assert(Math.abs(p.x-b.x)>=b.halfX+3||Math.abs(p.z-b.z)>=b.halfZ+8,'starts are outside belt approaches');
 }finally{world.dispose();}}
