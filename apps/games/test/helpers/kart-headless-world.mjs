// Same real GLB loader and image-dimension shim used by kart-art.mjs.
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {KART_ASSETS,MeshoptDecoder} from '../../public/js/engines/kart-assets.mjs';
import {createKartWorld} from '../../public/js/engines/kart-world.mjs';
import {createKartArenaStructures} from '../../public/js/engines/kart-arena-structure-art.mjs';
import {createKartArenaFeatures} from '../../public/js/engines/kart-arena-features-art.mjs';
import maps from '../../games/engines/kart-maps.js';

export async function loadSceneryAssets() {
  globalThis.self=globalThis;
  globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
  await MeshoptDecoder.ready;
  const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),assets={};
  for(const [key,name] of Object.entries(KART_ASSETS)) {
    if(['kart','star','crate','combat','pulse','arsenal','secondary'].includes(key))continue;
    const bytes=await readFile(new URL('../../public/assets/karts/'+name+'.glb',import.meta.url));
    assets[key]=(await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
  }
  return assets;
}

export function buildClassicArena(id,assets={},palette='Daybreak') {
  const map={id,...maps.mapDef(id)},scene=new THREE.Scene();
  const world=createKartWorld(THREE,{scene,map,assets,palette});world.syncMap(map);
  const structures=createKartArenaStructures(THREE,scene,{groundAt:world.groundAt});structures.sync(map);
  const features=createKartArenaFeatures(THREE,scene,{groundAt:world.groundAt});features.sync(map);
  return {scene,map,world,structures,features};
}

export function countDraws(root) {
  let draws=0;
  root.traverseVisible(o=>{
    if(o.isInstancedMesh){if(o.count>0)draws++;}
    else if(o.isMesh)draws+=Array.isArray(o.material)?o.material.length:1;
    else if(o.isLine||o.isPoints||o.isSprite)draws++;
  });
  return draws;
}

export function drawSources({world,structures,features}) {
  const sources={};
  const add=(key,n)=>{sources[key]=(sources[key]||0)+n;};
  for(const child of world.group.children){
    const name=child.name,p=child.geometry?.parameters;
    let stand=false;child.traverse(o=>{if(o.name.includes('grandStandCoveredRound'))stand=true;});
    // Old worlds left the boundary pieces unnamed; parameters also identify
    // them when this script is used to measure a pre-batching checkout.
    const boundary=name.startsWith('boundary-')||p&&((p.height===.5||p.height===.12)&&Math.max(p.width||0,p.depth||0)>50);
    const source=name==='obstacles'?'cover':name==='boost-pads'?'boost pads':name==='grip-surfaces'?'grip patches':
      name.startsWith('arena-landmark-')?'landmarks':/road-|lane-paint/.test(name)?'roads and kerbs':
      boundary?'boundary kerbs and rails':stand?'grandstands':
      name==='arena-wall-accent'||/barrierRed|barrierWhite/.test(name)?'barrier accents':
      name.startsWith('park-path')?'perimeter paths':
      name==='carnival-balloon'||name==='cloud'||/sky|sun-|cloud|star/.test(name)?'sky and moving scenery':'other world scenery';
    add(source,countDraws(child));
  }
  add('barriers and ramps',countDraws(structures.root));
  add('cannons, portals and falls',countDraws(features.root));
  return sources;
}
