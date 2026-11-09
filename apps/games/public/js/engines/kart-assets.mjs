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

// Character drivers (original Meshy models, see ASSETS.md), normalised to
// 1 m tall with feet at y=0. Each replaces the helmet racer and the kart's
// own steering wheel, which the animals hold, and is seated before static
// batching so it merges and leans with KartBody. Every driver gets its own
// batched kart variant; the view picks one per player.
export const KART_DRIVERS = Object.freeze(['fox', 'bunny', 'panda', 'raccoon']);
export const KART_SEAT = Object.freeze({ scale: 1.55, position: [0, .6, -.37],
  replaces: ['DriverArm_L', 'DriverArm_R', 'DriverHelmet', 'DriverTorso', 'DriverVisor', 'SteeringWheel'] });
const seatedGeometry=new WeakMap();
// Meshy bakes tails into the same textured mesh as the face and ears. Fold
// only the low rear vertices into the seat cushion before static batching.
// Heads/ears, UVs and materials stay authored; runtime clones share the fit.
function tuckSeatedDriver(seated){
  seated.updateMatrixWorld(true);
  const point=seated.position.clone();
  seated.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const source=mesh.geometry;
    if(seatedGeometry.has(source)){mesh.geometry=seatedGeometry.get(source);return;}
    const geometry=source.clone(),p=geometry.attributes.position,changed=new Uint8Array(p.count);let count=0;
    for(let i=0;i<p.count;i++){
      mesh.localToWorld(point.fromBufferAttribute(p,i));seated.worldToLocal(point);
      const weight=Math.max(0,Math.min(1,(-.12-point.z)/.08))*Math.max(0,Math.min(1,(.55-point.y)/.1));
      if(!weight)continue;
      point.z+=(-.12-point.z)*weight;point.x*=1-.6*weight;point.y+=(Math.min(point.y,.12)-point.y)*weight;
      seated.localToWorld(point);mesh.worldToLocal(point);p.setXYZ(i,point.x,point.y,point.z);changed[i]=1;count++;
    }
    if(count){
      const normal=geometry.attributes.normal,normals=normal&&new Float32Array(normal.count*3);
      if(normals)for(let i=0;i<normal.count;i++){normals[i*3]=normal.getX(i);normals[i*3+1]=normal.getY(i);normals[i*3+2]=normal.getZ(i);}
      geometry.computeVertexNormals();
      if(normals)for(let i=0;i<p.count;i++)if(!changed[i])geometry.attributes.normal.setXYZ(i,normals[i*3],normals[i*3+1],normals[i*3+2]);
      geometry.computeBoundingBox();geometry.computeBoundingSphere();mesh.geometry=geometry;
    }else geometry.dispose();
    seatedGeometry.set(source,mesh.geometry);
  });
}
export function seatKartDriver(kart, driver) {
  const body = kart.getObjectByName('KartBody');
  if (!body || !driver) return false;
  for (const name of KART_SEAT.replaces) body.getObjectByName(name)?.removeFromParent();
  const seated = driver.clone(true);
  seated.name = 'KartDriver';
  tuckSeatedDriver(seated);
  seated.scale.setScalar(KART_SEAT.scale);
  seated.position.fromArray(KART_SEAT.position);
  seated.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  body.add(seated);
  return true;
}

export const WEAPON_THUMBNAILS=['machinegun','trishot','missile','cannon','blades','supernova','mine','frost','ram','nuke'];
const thumbnailExtension=kind=>'svg';
const loadedThumbnails=new Set();
let thumbnailLoad;
export function loadKartWeaponThumbnails(){
  if(!thumbnailLoad)thumbnailLoad=Promise.all(WEAPON_THUMBNAILS.map(async kind=>{
    const image=new Image();image.src=`/assets/karts/weapon-thumbnails/${kind}.${thumbnailExtension(kind)}`;
    await image.decode();loadedThumbnails.add(kind);
  })).catch(error=>{thumbnailLoad=null;throw error;});
  return thumbnailLoad;
}
export function weaponThumbnailArt(kind,fallback=''){
  return loadedThumbnails.has(kind)?`<img class="kart-weapon-thumbnail" src="/assets/karts/weapon-thumbnails/${kind}.${thumbnailExtension(kind)}" width="96" height="96" alt="" aria-hidden="true">`:fallback;
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

/* One batched kart per loaded driver, tagged with the driver's id so a
 * player's chosen look finds its own animal even if another failed. */
export function buildKartDriverVariants(THREE, kart, drivers, mergeGeometries, library) {
  const variants = [];
  drivers.forEach((driver, i) => {
    if (!driver) return;
    const variant = kart.clone(true);
    seatKartDriver(variant, driver); batchKartBody(THREE, variant, mergeGeometries);
    variant.userData.driver = KART_DRIVERS[i];
    variants.push(variant); library?.add(variant);
  });
  return variants;
}

export function loadKartDrivers(loader) {
  return Promise.all(KART_DRIVERS.map(name => loader.loadAsync(`/assets/karts/drivers/${name}.glb`).then(g => g.scene, () => null)));
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
  // Drivers are optional: one that fails to load is skipped, and with none
  // the original helmet racer stays.
  const drivers = loadKartDrivers(loader);
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
    if (key === 'kart') {
      const variants = buildKartDriverVariants(THREE, gltf.scene, await drivers, mergeGeometries, library);
      if (variants.length) assets.kartVariants = variants;
      batchKartBody(THREE,gltf.scene,mergeGeometries);
    }
    assets[key] = gltf.scene;
    library.add(gltf.scene);
  }),loadKartWeaponThumbnails()]);
  const failed = results.find(r => r.status === 'rejected');
  if (failed) throw failed.reason;
  return assets;
}
