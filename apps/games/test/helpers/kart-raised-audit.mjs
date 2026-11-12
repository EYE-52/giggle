import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {KART_ASSETS,KART_DRIVERS,MeshoptDecoder,buildKartDriverVariants} from '../../public/js/engines/kart-assets.mjs';
import {createKartModel,createCrateModel} from '../../public/js/engines/kart-model.mjs';
import {createKartArenaFeatures} from '../../public/js/engines/kart-arena-features-art.mjs';
import {createKartElevatedWorld} from '../../public/js/engines/kart-elevated-world.mjs';
import {createRaisedPickups} from '../../public/js/engines/kart-raised-pickups.mjs';
import {createRaisedShadows,disableRaisedStaticShadows} from '../../public/js/engines/kart-raised-shadows.mjs';
import {createKartLod} from '../../public/js/engines/kart-lod.mjs';
import C from '../../public/js/engines/kart-physics-config.mjs';

export async function auditAssets(){
  globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});await MeshoptDecoder.ready;
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),assets={},load=async file=>{const b=await readFile(new URL('../../public/assets/karts/'+file+'.glb',import.meta.url));return(await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;};
  for(const key of['kart','crate','pickupGear'])assets[key]=await load(KART_ASSETS[key]);
  const drivers=[];for(const name of KART_DRIVERS)drivers.push(await load('drivers/'+name));
  assets.kartVariants=buildKartDriverVariants(THREE,assets.kart,drivers,mergeGeometries);return assets;
}
// Conservative geometry census: no frustum culling, all loaded props visible,
// actual animal models, portals, pickups, and one shadow pass. Not renderer.info.
export function census(scene,shadows=true){
  const colorLayer=new THREE.Layers(),shadowLayer=new THREE.Layers();shadowLayer.enable(1);
  let draws=0,triangles=0,colorDraws=0,shadowDraws=0;
  scene.traverseVisible(o=>{if(!o.isMesh||o.isInstancedMesh&&!o.count)return;const n=o.isInstancedMesh?o.count:1,g=o.geometry,t=(g.index?.count??g.attributes.position.count)/3*n;
    const materials=[].concat(o.material),d=Array.isArray(o.material)?g.groups.length:1;
    if(o.layers.test(colorLayer)){const multiplier=materials[0]?.transparent&&materials[0].side===THREE.DoubleSide&&!materials[0].forceSinglePass?2:1;draws+=d*multiplier;colorDraws+=d*multiplier;triangles+=t*multiplier;}
    if(shadows&&o.castShadow&&o.layers.test(shadowLayer)){draws+=d;shadowDraws+=d;triangles+=t;}
  });return{draws,colorDraws,shadowDraws,triangles};
}
export function auditRaised({id,assets,tier='high',players=2,legacy=false,factory=createKartElevatedWorld}){
  const scene=new THREE.Scene(),world=factory(THREE,{scene,map:id,quality:()=>tier}),map=world.layout;
  const features=createKartArenaFeatures(THREE,scene);features.sync(map);
  const shadow=createRaisedShadows(THREE,{sun:world.lighting.sun,quality:()=>tier});
  if(!legacy){disableRaisedStaticShadows(world.group);disableRaisedStaticShadows(features.root);shadow.update();}
  const entries=[],models=[];
  for(let i=0;i<players;i++){const k=createKartModel(THREE,{assets,driver:KART_DRIVERS[i%4],color:0x43acc4}),p=map.spawns[i%map.spawns.length];k.position.set(p.x,p.y+.645,p.z);scene.add(k);models.push(k);if(!legacy)shadow.add(k);if(i)entries.push({mesh:k,color:0x43acc4,visible:true});}
  const boxes=map.sockets.slice(0,map.complex?(players>8?12:9):6).map(p=>({position:{x:p.x,y:p.y+.6,z:p.z},available:true}));let pickups,lod;
  if(legacy)for(const box of boxes){const model=createCrateModel(THREE,assets);model.position.copy(box.position);model.position.y-=.6;scene.add(model);}
  else{pickups=createRaisedPickups(THREE,scene,48,assets.pickupGear.getObjectByName('PickupCrateLOD'));pickups.update(boxes,0);lod=createKartLod(THREE,{fullDetail:1,keepNear:1,far:0,originY:.55+C.chassis.modelOriginY});scene.add(lod.object);lod.update({position:models[0].position},entries,tier==='low'?0:1);lod.object.visible=lod.object.count>0;}
  world.animate(0,0);const stats=census(scene,legacy||tier!=='low');
  return{scene,world,features,models,stats,dispose(){pickups?.dispose();lod?.dispose();shadow.dispose();features.dispose();world.dispose();}};
}
