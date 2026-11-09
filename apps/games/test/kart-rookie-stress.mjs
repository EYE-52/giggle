import assert from 'node:assert/strict';
import fs from 'node:fs';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {selectArenaVariant} from '../public/js/engines/kart-arena-policy.mjs';
import {driveArenaRoute} from './helpers/kart-arena-driver.mjs';
import {rookieCircuit} from './helpers/kart-rookie-route.mjs';
await RAPIER.init();const reports=[];
for(const players of[2,8])for(let seed=0;seed<20;seed++){
 const map=selectArenaVariant(elevatedMap('rookie-ribbons'),players),points=rookieCircuit(players);if(seed%2)points.reverse();
 const result=driveArenaRoute(RAPIER,CONFIG,map,points,{seed,speed:4+(seed%5)*.5,continuous:true,seconds:180});
 const report={variant:map.variantId,seed,speed:4+(seed%5)*.5,at:result.at,stuck:result.stuck,events:result.events,goal:result.goal,poseSamples:result.poses.length};reports.push(report);
 const dir=new URL('../../../artifacts/kart-arenas/',import.meta.url);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(new URL('rookie-stress.json',dir),JSON.stringify({scope:'40 isolated real-authority route runs; a moving bot and a parked rival. Not eight box-seeking/firing bots.',reports},null,2));
 assert.equal(result.at,180000,JSON.stringify(report));assert.deepEqual(result.events,[],JSON.stringify(report));assert(result.stuck<3000,JSON.stringify(report));
 if(seed%5===4)console.log('PASS stress',map.variantId,'seeds',seed-4,'to',seed);
}
console.log('PASS 40 three-minute route replays, both floors, both directions, 4–6m/s targets, no recovery/teleport/stuck');
