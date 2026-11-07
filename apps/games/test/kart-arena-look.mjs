// Lighting/launch regression with real geometry and shared ballistic math.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder,buildKartDriverVariants,KART_DRIVERS} from '../public/js/engines/kart-assets.mjs';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createKartWorld} from '../public/js/engines/kart-world.mjs';
import {createKartLighting} from '../public/js/engines/kart-lighting.mjs';
import {createKartModel} from '../public/js/engines/kart-model.mjs';
import {createKartArenaFeatures,CANNON_ENTRY_TIME,CANNON_REVEAL_TIME} from '../public/js/engines/kart-arena-features-art.mjs';
import {flightPose,inCannon,CANNON_HALF_LENGTH,CANNON_HALF_WIDTH} from '../public/js/engines/kart-map-features.mjs';
import maps from '../games/engines/kart-maps.js';
let checks=0;const ok=(v,message)=>{assert.ok(v,message);checks++;};
const day=JSON.parse(fs.readFileSync(new URL('./fixtures/kart-arena-look/day-palettes.json',import.meta.url)));
for(const [id,expected]of Object.entries(day)){
 const world=createKartWorld(THREE,{scene:new THREE.Scene(),map:{id,...maps.mapDef(id)},palette:'Daybreak'});
 assert.deepEqual(world.palette,expected.palette,id+' day lighting and surfaces stay unchanged');world.dispose();checks++;
}
for(const palette of ['Daybreak','Sunset','Starlight']){
 const world=createKartWorld(THREE,{scene:new THREE.Scene(),map:{id:'neon',...maps.mapDef('neon')},palette});
 let captures=0,targetDisposals=0;const retired=new Map(),scene=new THREE.Scene();
 const measured={...THREE,PMREMGenerator:class{
  fromScene(source){captures++;source.traverse(o=>{for(const r of [o.geometry,o.material])if(r&&!retired.has(r)){retired.set(r,0);r.addEventListener('dispose',()=>retired.set(r,retired.get(r)+1));}});return{texture:new THREE.Texture(),dispose(){targetDisposals++;}};}
  dispose(){}
 }};
 const renderer={shadowMap:{}},lighting=createKartLighting(measured,renderer,scene,world.palette);
 const fill=scene.getObjectByName('arena-soft-fill');
 ok(fill?.isDirectionalLight&&!fill.castShadow&&fill.intensity>.8,palette+' cheap cool fill lights karts without another shadow pass');
 ok(world.palette.hemiIntensity>=1.5,palette+' readable cool ambient fill');
 ok(scene.environment&&scene.environmentIntensity===.85,palette+' small reflection map is used');
 ok([...retired.values()].every(n=>n===1),'capture geometry/materials retire immediately');
 const lights=scene.children.slice(),environment=scene.environment;
 for(let i=0;i<180;i++){world.animate(1/60,i/60,i/179);lighting.update(world.palette);}
 assert.deepEqual(scene.children,lights);assert.equal(scene.environment,environment);
 ok(captures===1,'day cycle never recaptures the environment');
 lighting();lighting();ok(targetDisposals===1&&scene.children.length===0,'lighting and reflection target retire once');world.dispose();
}
// Browser canvas resource path; this checks material wiring, not pixels.
const savedDocument=globalThis.document;
globalThis.document={createElement(){const ctx=new Proxy({createLinearGradient:()=>({addColorStop(){}}),createRadialGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{}});return{width:0,height:0,getContext:()=>ctx};}};
try{
 const map={id:'neon',...maps.mapDef('neon')},world=createKartWorld(THREE,{scene:new THREE.Scene(),map});world.syncMap(map);
 const materials=new Set();world.group.getObjectByName('obstacles').traverse(o=>{if(o.material)materials.add(o.material);});
 const trims=[...materials].filter(m=>m.emissiveMap);
 ok(trims.length===2&&trims.every(m=>m.map&&m.emissiveMap.image.width===128&&m.emissiveIntensity<1),'two shared panel/edge materials replace glowing slabs');
 const road=world.group.getObjectByName('neon-road-road').material;
 ok(road.roughness<.5&&road.metalness<.2&&road.envMapIntensity<1,'restrained wet asphalt reuses environment without extra passes');world.dispose();
}finally{if(savedDocument===undefined)delete globalThis.document;else globalThis.document=savedDocument;}

// Load the shipping kart: every visible vertex entering the tube must fit
// inside its actual tapered lining, including the driver and wheels.
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});await MeshoptDecoder.ready;
const bytes=fs.readFileSync(new URL('../public/assets/karts/giggle-kart.meshopt.glb',import.meta.url));
const template=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
const kart=createKartModel(THREE,{assets:{kart:template},color:0xf45367});kart.userData.kart.inner.position.y=-.70;
const scene=new THREE.Scene(),art=createKartArenaFeatures(THREE,scene),map={id:'neon',...maps.mapDef('neon')};art.sync(map);
const c=map.features.cannons[0],tube=art.root.getObjectByName('cannon-open-tube'),body=art.root.getObjectByName('cannon-outer-shell'),rear=art.root.getObjectByName('cannon-open-rear-rim');
ok(body.geometry.parameters.openEnded&&rear.geometry.parameters.innerRadius>0,'rear and muzzle have real holes without end caps');
art.root.updateMatrixWorld(true);
const boreStart=new THREE.Vector3(0,0,-.75).applyMatrix4(tube.matrixWorld),boreEnd=new THREE.Vector3(0,0,.75).applyMatrix4(tube.matrixWorld),boreDraws=[];
art.root.traverseVisible(o=>{if(o.isMesh)boreDraws.push(o);});
const bore=new THREE.Raycaster(boreStart,boreEnd.clone().sub(boreStart).normalize(),0,boreStart.distanceTo(boreEnd));
ok(bore.intersectObjects(boreDraws,false).length===0,'a ray passes through both mouths without hitting any drawn end cap');
const shades=body.geometry.attributes.color.array;
ok(Math.max(...shades)-Math.min(...shades)>.4,'tube has depth shading within its existing draw');
ok(!art.root.getObjectByName('arena-cannon-arcs'),'no floating cannon projectile/arc dots');
const s=Math.sin(c.angle),co=Math.cos(c.angle);
ok(inCannon(c,c.x,c.z)&&inCannon(c,c.x-s*CANNON_HALF_LENGTH,c.z-co*CANNON_HALF_LENGTH),'trigger is in rear mouth');
ok(!inCannon(c,c.x+s*.2,c.z+co*.2)&&!inCannon(c,c.x+co*(CANNON_HALF_WIDTH+.1),c.z-s*(CANNON_HALF_WIDTH+.1)),'tube walls and muzzle do not trigger');
const flight={c:0,t:0,x:c.x-s,z:c.z-co,y:.75,ly:.75,a:c.angle,life:0},k={pid:'tube-test',spawnSeq:0,flight};
art.ingest([],[]);art.ingest([{id:'launch-test',type:'launch',pid:k.pid,cannon:0}],[k]);
let constructions=0;const measured={...THREE};for(const [key,value]of Object.entries(THREE))if(typeof value==='function'&&/^[A-Z]/.test(key))measured[key]=new Proxy(value,{construct(target,args){constructions++;return Reflect.construct(target,args);}});
const allocationArt=createKartArenaFeatures(measured,new THREE.Scene());allocationArt.sync(map);const beforeConstructions=constructions;
const inverse=new THREE.Matrix4(),p=new THREE.Vector3();let checkedVertices=0;
function place(t){flight.t=t;const pose=flightPose(c,flight,t);kart.position.set(pose.position.x,pose.position.y,pose.position.z);kart.quaternion.set(pose.rotation.x,pose.rotation.y,pose.rotation.z,pose.rotation.w);kart.visible=true;return pose;}
for(const t of [.03,.07,.10]){
 place(t);ok(art.dressKart(k,kart)&&kart.visible,'kart travels through rear opening before hiding');art.root.updateMatrixWorld(true);kart.updateMatrixWorld(true);inverse.copy(tube.matrixWorld).invert();
 kart.traverseVisible(o=>{if(!o.isMesh||o.material.transparent)return;const pos=o.geometry.attributes.position;for(let i=0;i<pos.count;i++){
  p.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld).applyMatrix4(inverse);
  if(p.z<-.5||p.z>.5)continue;
  const shape=body.geometry.parameters,radius=(shape.radiusBottom+(shape.radiusTop-shape.radiusBottom)*(p.z+.5))*.94;
  ok(Math.hypot(p.x,p.y)<radius+.015,'visible kart vertex clears tube lining');checkedVertices++;
 }});
}
ok(checkedVertices>1000,'actual shipping kart vertices checked inside opening');
place((CANNON_ENTRY_TIME+CANNON_REVEAL_TIME)/2);ok(art.dressKart(k,kart)&&!kart.visible,'kart hides fully inside tube');
place(.13);ok(art.dressKart({...k,flight:null},kart,flight)&&!kart.visible,'predicted flight hides before authority snapshot arrives');
place(.21);const beforePosition=kart.position.toArray(),beforeRotation=kart.quaternion.toArray();
ok(!art.dressKart(k,kart)&&kart.visible,'kart appears from muzzle');assert.deepEqual(kart.position.toArray(),beforePosition);assert.deepEqual(kart.quaternion.toArray(),beforeRotation);
art.animate(1/60,.21,{karts:[]},new Map());ok(art.root.getObjectByName('arena-feature-fx').count>0,'muzzle puff accompanies reveal');
for(let i=0;i<180;i++){place(.21+i/180);allocationArt.dressKart(k,kart);allocationArt.animate(1/60,i/60,{karts:[]});}
ok(constructions===beforeConstructions,'steady launch animation allocates no Three objects');allocationArt.dispose();art.dispose();
const drivers=[];
for(const id of KART_DRIVERS){
 const bytes=fs.readFileSync(new URL('../public/assets/karts/drivers/'+id+'.glb',import.meta.url));
 drivers.push((await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene);
}
const variants=buildKartDriverVariants(THREE,template,drivers,mergeGeometries),animalArt=createKartArenaFeatures(THREE,new THREE.Scene());
let animalVertices=0,worstAnimalClearance=-Infinity,worstAnimalCase='';
for(const id of maps.mapIds()){
 const map={id,...maps.mapDef(id)};animalArt.sync(map);animalArt.root.updateMatrixWorld(true);
 for(const [index,c]of map.features.cannons.entries()){
  const group=animalArt.root.getObjectByName('arena-cannon-'+index),tube=group.getObjectByName('cannon-open-tube'),shape=group.getObjectByName('cannon-outer-shell').geometry.parameters;
  inverse.copy(tube.matrixWorld).invert();
  for(const variant of variants)for(const side of [-.52,0,.52]){
   const kart=createKartModel(THREE,{assets:{kart:variant},color:0xf45367});kart.userData.kart.inner.position.y=-.7;
   const s=Math.sin(c.angle),co=Math.cos(c.angle),flight={c:index,t:0,x:c.x-s*1.15+co*side,z:c.z-co*1.15-s*side,y:.75,ly:.75,a:c.angle,life:0},k={pid:'animal',spawnSeq:0,flight};
   for(const t of [.03,.07,.1,.19,.22,.25,.3,.4]){
    const pose=flightPose(c,flight,t);kart.position.set(pose.position.x,pose.position.y,pose.position.z);kart.quaternion.set(pose.rotation.x,pose.rotation.y,pose.rotation.z,pose.rotation.w);kart.visible=true;animalArt.dressKart(k,kart);kart.updateMatrixWorld(true);
    kart.traverseVisible(o=>{if(!o.isMesh||o.material.transparent)return;const pos=o.geometry.attributes.position;for(let i=0;i<pos.count;i++){
     p.fromBufferAttribute(pos,i).applyMatrix4(o.matrixWorld).applyMatrix4(inverse);if(p.z<-.5||p.z>.5)continue;
     const radius=(shape.radiusBottom+(shape.radiusTop-shape.radiusBottom)*(p.z+.5))*.94;
     const excess=Math.hypot(p.x,p.y)-radius;
     if(excess>worstAnimalClearance){worstAnimalClearance=excess;worstAnimalCase=`${id}/${variant.userData.driver} t=${t} side=${side}`;}
     animalVertices++;
    }});
   }
  }
 }
}
animalArt.dispose();
ok(worstAnimalClearance<=.015,`${worstAnimalCase}: kart clears tube (${worstAnimalClearance})`);
console.log(JSON.stringify({pass:true,arenaLookChecks:checks,checkedKartVertices:checkedVertices,animalVertices,scope:'Real geometry, palette regression, trigger/flight presentation, lifecycle and allocation checks; pixels checked separately.'}));
