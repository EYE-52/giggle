// Reproducible, conservative scene census. This is NOT a GPU/FPS benchmark:
// all geometry is counted without culling, including a sun shadow pass.
// node scripts/kart-raised-performance.mjs [baseline Git ref, default 002517e]
import {execFileSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {auditAssets,auditRaised,census} from '../test/helpers/kart-raised-audit.mjs';
import {buildClassicArena,loadSceneryAssets} from '../test/helpers/kart-headless-world.mjs';
import {createKartModel,createCrateModel} from '../public/js/engines/kart-model.mjs';
import {KART_DRIVERS} from '../public/js/engines/kart-assets.mjs';
const baseline=process.argv[2]||'002517e',temp=await mkdtemp('/tmp/codex-raised-baseline-'),root=new URL('../public/js/engines/',import.meta.url);
try{
  for(const file of['kart-complex-world.mjs','kart-elevated-world.mjs']){
    const original=execFileSync('git',['show',baseline+':apps/games/public/js/engines/'+file],{encoding:'utf8'});
    const rewritten=original.replace(/(from\s*['"])(\.[^'"]+)(['"])/g,(_,a,p,b)=>a+(p==='./kart-complex-world.mjs'?pathToFileURL(temp+'/kart-complex-world.mjs').href:new URL(p,root).href)+b);
    await writeFile(temp+'/'+file,rewritten);
  }
  const factory=(await import(pathToFileURL(temp+'/kart-elevated-world.mjs'))).createKartElevatedWorld,assets=await auditAssets(),rows=[];
  for(const id of['foundry','skyport','harbor'])for(const players of[2,8]){
    const old=auditRaised({id,players,assets,legacy:true,factory});rows.push({map:id,players,version:baseline,tier:'high',...old.stats});old.dispose();
    for(const tier of['high','medium','low']){const next=auditRaised({id,players,assets,tier});rows.push({map:id,players,version:'working tree',tier,...next.stats});next.dispose();}
  }
  // Same census rules, real classic scenery, animal karts and item boxes.
  const classic=buildClassicArena('ring',{...await loadSceneryAssets(),...assets});
  for(let i=0;i<2;i++){const model=createKartModel(THREE,{assets,driver:KART_DRIVERS[i],color:0x43acc4});model.position.set(i*8,1,0);classic.scene.add(model);}
  for(let i=0;i<6;i++){const model=createCrateModel(THREE,assets);model.position.set(i*4,1,15);classic.scene.add(model);}
  rows.push({map:'Rookie Ring',players:2,version:'working tree',tier:'high',...census(classic.scene)});
  classic.features.dispose();classic.structures.dispose();classic.world.dispose();
  const result={scope:'Unculled idle scene census with real GLB animals, all item boxes, features, festive lights and shadows. Combat bursts, damaged hearts and mounted weapons excluded. Not renderer.info or measured FPS.',baseline,rows};
  await writeFile('/tmp/codex-raised-performance.json',JSON.stringify(result,null,2)+'\n');console.log(result.scope);console.table(rows);
}finally{await rm(temp,{recursive:true,force:true});}
