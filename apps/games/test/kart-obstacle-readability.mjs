// Actual texture pixels, per-instance placement, retained buffers and lifetime.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {buildClassicArena,countDraws} from './helpers/kart-headless-world.mjs';
import {OBSTACLE_STYLES,createObstaclePanelTexture,createObstacleContactTexture} from '../public/js/engines/kart-obstacle-style.mjs';
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
const luminance=rgb=>.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
const pixel=(t,x,y)=>t.image.data.slice((y*t.image.width+x)*4,(y*t.image.width+x)*4+3);
for(const [theme,style]of Object.entries(OBSTACLE_STYLES)){
  const t=createObstaclePanelTexture(THREE,style,{hazard:true});
  ok(luminance(pixel(t,4,30))>luminance(pixel(t,70,30))*3,theme+' broad hazard stripes contrast at distance');
  ok(luminance(pixel(t,20,105))>luminance(pixel(t,20,60)),theme+' faces shade towards their base');
  ok(luminance(pixel(t,20,115))>luminance(pixel(t,20,105)),theme+' bright upper face edge');t.dispose();
}
const shadow=createObstacleContactTexture(THREE);
ok(shadow.image.data[3]===0&&shadow.image.data[(32*64+32)*4+3]>150,'soft contact fades to transparent outside');shadow.dispose();
const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
const reports=[];
for(const id of ['ring','blocks','garden','frost','neon']){
  const arena=buildClassicArena(id),{map,world,structures}=arena,snapshot=JSON.stringify(map),bodies=structures.root.getObjectByName('arena-barrier-bodies');
  const caps=structures.root.getObjectByName('arena-barrier-caps'),contacts=structures.root.getObjectByName('arena-barrier-contact');
  ok(bodies.material.map?.isDataTexture&&bodies.material.map===bodies.material.emissiveMap,id+' one shared hazard texture');
  ok(caps.material.isMeshBasicMaterial&&contacts.count===map.barriers.length,id+' unlit caps and one instanced contact batch');
  for(let i=0;i<map.barriers.length;i++){
    const b=map.barriers[i];bodies.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
    ok(Math.abs(position.x-b.x)<1e-5&&Math.abs(position.z-b.z)<1e-5&&Math.abs(scale.x-b.hw*2)<1e-5&&Math.abs(scale.z-b.hd*2)<1e-5,id+' body stays inside authority footprint');
    caps.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
    ok(position.y+scale.y/2<=1.001,id+' low wall still visually clears the existing 1.03m pulse bottom');
    contacts.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);
    ok(position.y<.04&&scale.x>b.hw*2&&scale.y>b.hd*2,id+' contact outline sits below its wall');
  }
  const cover=world.group.getObjectByName('obstacles'),materials=new Set();
  cover.traverseVisible(o=>{if(o.isMesh)materials.add(o.material);});
  if(map.blocks.length){
    ok([...materials].some(m=>m.map?.name==='obstacle-soft-contact'&&m.transparent&&!m.depthWrite),id+' cover has shared contact shading');
    ok([...materials].some(m=>m.map&&(m.map.name==='obstacle-shaded-panels'||id==='neon')),id+' solid cover has detailed vertical faces');
  }
  const resources=new Set();structures.root.traverse(o=>{for(const r of [o.geometry,o.material,o.material?.map,o.material?.emissiveMap])if(r)resources.add(r);});
  const releases=new Map([...resources].map(r=>[r,0]));for(const r of resources)r.addEventListener('dispose',()=>releases.set(r,releases.get(r)+1));
  const nodes=[],buffers=[];arena.scene.traverse(o=>{nodes.push(o);if(o.isMesh)buffers.push(o.instanceMatrix?.array||o.geometry.attributes.position.array);});
  const initial=countDraws(arena.scene);
  for(let i=0;i<180;i++){world.syncMap(map);structures.sync(map);world.animate(1/60,i/60,i/179);structures.animate();}
  const after=[],afterBuffers=[];arena.scene.traverse(o=>{after.push(o);if(o.isMesh)afterBuffers.push(o.instanceMatrix?.array||o.geometry.attributes.position.array);});
  assert.deepEqual(after,nodes);for(let i=0;i<buffers.length;i++)assert.equal(buffers[i],afterBuffers[i]);
  ok(snapshot===JSON.stringify(map),id+' dressing never edits authority data');
  reports.push({id,draws:initial});structures.dispose();structures.dispose();world.dispose();arena.features.dispose();
  ok([...releases.values()].every(n=>n===1),id+' all structure textures, geometry and materials retire exactly once');
}
console.log(JSON.stringify({pass:true,obstacleReadabilityChecks:checks,reports}));
