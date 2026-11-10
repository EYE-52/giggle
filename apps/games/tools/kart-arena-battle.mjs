import fs from 'node:fs';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {launchArenaIds} from '../public/js/engines/kart-launch-arenas.mjs';
import {runArenaBattle} from '../test/helpers/kart-arena-battle.mjs';
await R.init();
const ids=process.env.ARENA_MAP==='all'?launchArenaIds:[process.env.ARENA_MAP||'rookie-ribbons'];
const players=Number(process.env.ARENA_PLAYERS||8),seconds=Number(process.env.ARENA_SECONDS||180),seeds=Number(process.env.ARENA_SEEDS||5);
if(!Number.isInteger(seeds)||seeds<1||!Number.isInteger(seconds)||seconds<1)throw new Error('Positive whole seed count and seconds required');
const dir=new URL('../../../artifacts/kart-arenas/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
const firstSeed=Number(process.env.ARENA_SEED_START||0);
let failed=false;
for(const id of ids){
 const reports=[];
 for(let seed=firstSeed;seed<firstSeed+seeds;seed++){
  const r=runArenaBattle(R,C,elevatedMap(id),players,{seed,seconds,fire:process.env.ARENA_FIRE!=='0'});
  r.gate={medianUnarmed:r.unarmedMs.median!==null&&r.unarmedMs.median<=4000,p95Unarmed:r.unarmedMs.p95!==null&&r.unarmedMs.p95<=8000,availability:r.availability.mean>=.6&&r.availability.median>=.6,floorDry:r.maxDryMs<=3000};
  r.gate.pass=Object.values(r.gate).every(Boolean);failed||=!r.gate.pass;reports.push(r);
  console.log(id,seed,JSON.stringify({gate:r.gate,pickups:r.pickups,homes:r.visitedHomes.length+'/'+r.homes,levels:r.levelVisits,availability:r.availability,unarmedMs:r.unarmedMs,stuck:r.stuck.length,recoveries:r.recoveries.length,maxDryMs:r.maxDryMs}));
  fs.writeFileSync(new URL(id+'-'+players+'-battle.json',dir),JSON.stringify({scope:'Test-only bots drive and fire through real authority inputs; no authority pose resets, grants, private authority-physics access or weapon-rule changes. Steering forecasts use public-pose copies in a separate planning world.',driverVersion:2,targets:{medianUnarmedMs:4000,p95UnarmedMs:8000,meanAvailability:.6,maxFloorDryMs:3000},measurement:'Wall-clock unarmed waits continue through KO/respawn, include round-end waits and never depend on navigation. Alive-only waits are a separate diagnostic. Availability and floor dry time sampled every 50ms.',reports},null,2));
 }
}
if(failed&&process.env.ARENA_ENFORCE!=='0')process.exitCode=1;
