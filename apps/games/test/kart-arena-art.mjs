// Arena feature dressing: bounded shared meshes per map, effects from
// accepted events only, the faller's sink, and clean disposal.
// Run: node test/kart-arena-art.mjs
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createKartArenaFeatures,drawArenaFeatures2d} from '../public/js/engines/kart-arena-features-art.mjs';
import {ARENA_CUES,CUE_NAMES} from '../public/js/engines/kart-audio.mjs';
import maps from '../games/engines/kart-maps.js';
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
const scene=new THREE.Scene(),art=createKartArenaFeatures(THREE,scene,{groundAt:()=>0});
const counts={};
for(const id of ['ring','blocks','garden','frost','neon']){
 const m=maps.mapDef(id);art.sync({id,theme:m.theme,features:m.features});
 let meshes=0;const geometries=new Set(),materials=new Set();
 art.root.traverseVisible(o=>{if(o.isMesh&&!(o.isInstancedMesh&&o.count===0)){meshes++;geometries.add(o.geometry);materials.add(o.material);}});
 const st=art.stats();
 ok(st.cannons===m.features.cannons.length&&st.portals===2&&st.falls===1,id+': every feature is dressed');
 ok(meshes<=48,id+': a bounded number of draws ('+meshes+')');
 ok(geometries.size<=26&&materials.size<=26,id+': geometry and materials are shared ('+geometries.size+'/'+materials.size+')');
 ok(art.root.getObjectByName('arena-cannon-0')&&art.root.getObjectByName('arena-landing-0'),id+': cannon and its landing target');
 ok(art.root.getObjectByName('arena-portal-0-0')&&art.root.getObjectByName('arena-portal-0-1'),id+': both portal rings');
 counts[id]=meshes;
}
// Re-syncing the same map rebuilds nothing.
const before=art.root.children.length;art.sync({id:'neon',theme:'neon',features:maps.mapDef('neon').features});
ok(art.root.children.length===before,'same map does not rebuild');
// Effects: history is quiet, fresh events spawn bounded particles.
const garden=maps.mapDef('garden');art.sync({id:'garden',theme:'garden',features:garden.features});
const fx=art.root.getObjectByName('arena-feature-fx');
art.ingest([{id:'f1',type:'launch',pid:'a',cannon:0}],[]);art.animate(1/60,1,{karts:[]},new Map());
ok(fx.count===0,'events already in the first snapshot stay quiet');
const zone=garden.features.falls[0];
art.ingest([{id:'f1',type:'launch',pid:'a',cannon:0},{id:'f2',type:'land',pid:'a',cannon:0},{id:'f3',type:'warp',pid:'a',from:garden.features.portals[0][0],to:garden.features.portals[0][1]},
 {id:'f4',type:'fell',pid:'b',kind:'water',x:zone.x,y:.7,z:zone.z,angle:0}],[{pid:'b',spawnSeq:0}]);
art.animate(1/60,1.02,{karts:[]},new Map());
ok(fx.count>0&&fx.count<=160,'launch, landing, warp and splash spawn pooled particles');
for(let i=0;i<120;i++)art.animate(1/60,1.02+i/60,{karts:[]},new Map());
ok(fx.count===0,'effects expire');
// The faller sinks at the hazard, then hides until respawn.
const mesh=new THREE.Group();mesh.visible=false;
art.animate(0,10,{karts:[]},new Map());art.ingest([{id:'f5',type:'fell',pid:'c',kind:'water',x:zone.x,y:.7,z:zone.z,angle:1}],[]);
art.animate(0,10.3,{karts:[]},new Map());
ok(art.dressKart({pid:'c',fell:true,respawn:1.5},mesh)&&mesh.visible&&mesh.position.y<0&&Math.abs(mesh.position.x-zone.x)<1e-6,'faller sinks into the hazard');
art.animate(0,11.5,{karts:[]},new Map());
ok(art.dressKart({pid:'c',fell:true,respawn:.5},mesh)&&!mesh.visible,'faller hides after the sink');
ok(!art.dressKart({pid:'c',fell:false,respawn:0},mesh),'a live kart is left alone');
// 2D fallback symbols draw without throwing.
let fills=0;const ctx=new Proxy({},{get:(t,k)=>k==='fillRect'?()=>fills++:typeof k==='string'&&!['fillStyle','strokeStyle','lineWidth'].includes(k)?()=>{}:t[k],set:(t,k,v)=>{t[k]=v;return true;}});
drawArenaFeatures2d(ctx,{features:garden.features},x=>x,z=>z,2);ok(fills===1,'2D fallback draws the fall zone');
// Audio: arena cues are synthesized sweeps, not new samples or cue names.
ok(['launch','land','warp','fell'].every(n=>ARENA_CUES[n]?.length>=2&&!CUE_NAMES.includes(n)),'arena cues are separate synthesized sweeps');
art.dispose();ok(!scene.getObjectByName('arena-features'),'dispose removes the dressing');
console.log(JSON.stringify({pass:true,checks,meshes:counts}));
