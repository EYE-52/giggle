/* Local, licensed GLB assets. One library per renderer lifetime: clones share
 * GPU resources, and the scene's disposal releases templates as well. */

import {MeshoptDecoder} from '../../vendor/three/libs/meshopt_decoder.mjs';
export {MeshoptDecoder};

import {batchKartBody} from './kart-batching.mjs';

export const KART_ASSETS = {
  kart: 'giggle-kart.meshopt', star: 'giggle-star', crate: 'giggle-crate.meshopt',
  tree_detailed: 'tree_detailed', tree_pineTallA: 'tree_pineTallA',
  rock_largeA: 'rock_largeA', plant_bush: 'plant_bush', flower_purpleA: 'flower_purpleA',
  grandStandCoveredRound: 'grandStandCoveredRound.meshopt', pitsGarage: 'pitsGarage',
  barrierRed: 'barrierRed', barrierWhite: 'barrierWhite', flagCheckers: 'flagCheckers', tentRoof: 'tentRoof',
  combat: 'combat/combat.meshopt',
  pulse: 'combat/pulse-mounted.meshopt', arsenal: 'combat/arsenal-mounted.meshopt',
  secondary: 'combat/arsenal-secondary.meshopt',
};

const WEAPON_THUMBNAILS=['pulse','scatter','mine','shield','rocket','rail','grenade','emp','seeker','bomb','proximity','spikes','sentry','nuke'];
const loadedThumbnails=new Set();
let thumbnailLoad;
export function loadKartWeaponThumbnails(){
  if(!thumbnailLoad)thumbnailLoad=Promise.all(WEAPON_THUMBNAILS.map(async kind=>{
    const image=new Image();image.src=`/assets/karts/weapon-thumbnails/${kind}.png`;
    await image.decode();loadedThumbnails.add(kind);
  })).catch(error=>{thumbnailLoad=null;throw error;});
  return thumbnailLoad;
}
export function weaponThumbnailArt(kind,fallback=''){
  return loadedThumbnails.has(kind)?`<img class="kart-weapon-thumbnail" src="/assets/karts/weapon-thumbnails/${kind}.png" width="96" height="96" alt="" aria-hidden="true">`:fallback;
}

// GLTFLoader owns decoded ImageBitmaps as well as GPU textures. Call only
// after a scene-owned library has retired; borrowed meshes must stop first.
export function closeKartAssetBitmaps(library) {
  const images=new Set();
  library?.traverse(object=>{
    const materials=Array.isArray(object.material)?object.material:[object.material];
    for(const material of materials)if(material)for(const value of Object.values(material)){
      if(value?.isTexture&&typeof value.image?.close==='function')images.add(value.image);
    }
  });
  for(const image of images)image.close();
  return images.size;
}

export async function loadKartAssets(THREE, scene) {
  const { GLTFLoader } = await import('../../vendor/three/loaders/GLTFLoader.js');
  const {mergeGeometries} = await import('../../vendor/three/utils/BufferGeometryUtils.js');
  const library = new THREE.Group();
  library.name = 'KartAssetLibrary';
  library.visible = false;
  scene.add(library);
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const assets = {};
  // Wait for every request before failing: assets that finish after a failed
  // build still belong to this scene and can be disposed with it.
  const results = await Promise.allSettled([...Object.entries(KART_ASSETS).map(async ([key, name]) => {
    let gltf;
    try { gltf = await loader.loadAsync(`/assets/karts/${name}.glb${key==='crate'?'?v=question-20261007':''}`); }
    catch(error) {
      // A failed optional prop asset should not discard the whole arena.
      if(key==='combat'){console.warn('Combat models unavailable; using local prop fallback.',error);return;}
      throw error;
    }
    if (key === 'kart') batchKartBody(THREE,gltf.scene,mergeGeometries);
    assets[key] = gltf.scene;
    library.add(gltf.scene);
  }),loadKartWeaponThumbnails()]);
  const failed = results.find(r => r.status === 'rejected');
  if (failed) throw failed.reason;
  return assets;
}
