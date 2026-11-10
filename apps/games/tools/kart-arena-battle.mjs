import fs from 'node:fs';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {runArenaBattle} from '../test/helpers/kart-arena-battle.mjs';
await R.init();const reports=[],id=process.env.ARENA_MAP||'rookie-ribbons',players=Number(process.env.ARENA_PLAYERS||8),seconds=Number(process.env.ARENA_SECONDS||180),seeds=Number(process.env.ARENA_SEEDS||20);
for(let seed=0;seed<seeds;seed++){const r=runArenaBattle(R,C,elevatedMap(id),players,{seed,seconds,fire:process.env.ARENA_FIRE!=='0'});reports.push(r);console.log(id,seed,JSON.stringify({pickups:r.pickups,homes:r.visitedHomes.length+'/'+r.homes,levels:r.levelVisits,availability:r.availability,unarmedMs:r.unarmedMs,stuck:r.stuck.length,recoveries:r.recoveries.length}));fs.writeFileSync(new URL('../../../artifacts/kart-arenas/'+id+'-'+players+'-battle.json',import.meta.url),JSON.stringify({scope:'Real authority inputs, box seeking and firing; no pose restoration or item injection.',reports},null,2));}
