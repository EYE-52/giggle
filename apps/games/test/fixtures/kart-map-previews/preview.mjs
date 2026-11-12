import {MeshoptDecoder} from '/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/three/loaders/GLTFLoader.js';
import { loadKartAssets, closeKartAssetBitmaps, KART_ELEVATED_FILES } from '/js/engines/kart-assets.mjs';
import { createKartWorld } from '/js/engines/kart-world.mjs';
import { createKartLighting } from '/js/engines/kart-lighting.mjs';
import { createKartElevatedWorld } from '/js/engines/kart-elevated-world.mjs';
import { elevatedMap } from '/js/engines/kart-elevated-maps.mjs';

const $ = id => document.getElementById(id), canvas = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(960, 540, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
let scene, world, lighting, maps, busy = false, retired = false, captures = 0;

function status(value) {
  $('message').textContent = value.state === 'ready' ? `Ready: ${value.label}`
    : value.state === 'error' ? `Error: ${value.error}` : 'Loading actual arena assets…';
  $('status').textContent = JSON.stringify(value, null, 2);
  canvas.dataset.state = value.state;
}
function cleanup() {
  lighting?.(); lighting = null;
  world?.dispose?.(); world = null;
  if (!scene) return;
  closeKartAssetBitmaps(scene);
  const resources = new Set();
  scene.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
    if (object.isLight) object.dispose?.();
  });
  for (const resource of resources) resource.dispose();
  scene.clear(); scene = null; renderer.renderLists.dispose();
}
async function capture() {
  if (busy || retired) return;
  busy = true; $('load').disabled = $('map').disabled = $('palette').disabled = true;
  const choice = maps.find(m => m.key === $('map').value), palette = $('palette').value;
  status({ state: 'loading', label: choice.label });
  cleanup(); scene = new THREE.Scene();
  try {
    let loadedAssets;
    const map = choice.profile === 'elevated' ? elevatedMap(choice.id) : choice.map;
    if (choice.profile === 'elevated') {
      const assets = {}, library = new THREE.Group(); library.visible = false; scene.add(library);
      // This is exactly the environment library used by kart-elevated-view.
      const files = [...KART_ELEVATED_FILES];
      if (map.environment === 'alpine') files.push(['stylized', 'environment/stylized-alpine', '9426a0ed'], ['fountain', 'environment/alpine-fountain', '7a687cd3']);
      const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
      const loaded = await Promise.allSettled(files.map(async ([key, file, version]) => {
        const gltf = await loader.loadAsync(`/assets/karts/${file}.glb?v=${version}`);
        assets[key] = gltf.scene; library.add(gltf.scene);
      }));
      const failed = loaded.find((r, i) => r.status === 'rejected' && files[i][0] !== 'fountain');
      if (failed) throw failed.reason;
      if (assets.stylized) for (const name of ['PineA', 'PineB', 'TreeA', 'GrassA', 'FlowersA', 'RockA', 'RockB', 'CottageA'])
        if (!assets.stylized.getObjectByName(name)) throw new Error(`Missing shipped Alpine asset: ${name}`);
      loadedAssets = files.filter((_, i) => loaded[i].status === 'fulfilled').map(f => f[1]);
      world = createKartElevatedWorld(THREE, { scene, map, palette, assets });
      scene.fog = new THREE.Fog(world.lighting.fogColor, world.lighting.fogNear, world.lighting.fogFar);
      renderer.toneMappingExposure = world.lighting.exposure;
      world.animate(0, 0, undefined);
    } else {
      const assets = await loadKartAssets(THREE, scene);
      loadedAssets = Object.keys(assets);
      world = createKartWorld(THREE, { scene, map, palette, assets });
      world.syncMap(map);
      world.group.getObjectByName('obstacles')?.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = true; });
      scene.background = new THREE.Color(world.palette.horizon);
      scene.fog = new THREE.Fog(world.palette.horizon, ...world.palette.fog);
      lighting = createKartLighting(THREE, renderer, scene, world.palette, { half: map.half });
      world.animate(0, 0, undefined); lighting.update(world.palette);
    }
    if (retired) throw new Error('Capture page retired');
    // The game fog is tuned for a chase camera. At overview distance it hides
    // the arena. Capture lighting reveals the authored geometry at menu size.
    scene.fog = null;
    if (choice.key.startsWith('arena-')) {
      // The chase-camera sky/horizon surrounds the arena, not its footprint.
      // Keep it outside the menu overview so it cannot cover the far edges.
      const scenery = world.group.getObjectByName('outside-arena-scenery');
      if (scenery) scenery.visible = false;
      scene.background = new THREE.Color(0xdceaf1);
    }
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c8d7, 1.8));
    renderer.toneMappingExposure = 1.15;
    const top = Math.max(8, ...(map.colliders || []).map(c => c.position.y + c.half.y));
    const target = new THREE.Vector3(0, top / 3, 0);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 1600);
    camera.position.copy(target).add(new THREE.Vector3(1.35, 1.8, -1.7).normalize().multiplyScalar(map.half * 5));
    camera.lookAt(target); camera.updateMatrixWorld();
    const points = [];
    const launch = choice.key.startsWith('arena-');
    if (launch) {
      // Fit the actual visible slabs, ramps, guards and on-track landmarks.
      // The square authority half-extent includes large empty corners.
      world.group.updateMatrixWorld(true);
      for (const child of world.group.children) if (child.name !== 'outside-arena-scenery') child.traverseVisible(mesh => {
        const vertices = mesh.geometry?.attributes.position;
        if (!mesh.isMesh || !vertices || mesh.userData.cameraCollider) return;
        const matrix = new THREE.Matrix4(), instance = new THREE.Matrix4();
        for (let i = 0; i < (mesh.isInstancedMesh ? mesh.count : 1); i++) {
          if (mesh.isInstancedMesh) { mesh.getMatrixAt(i, instance); matrix.multiplyMatrices(mesh.matrixWorld, instance); }
          else matrix.copy(mesh.matrixWorld);
          for (let v = 0; v < vertices.count; v++) points.push(new THREE.Vector3().fromBufferAttribute(vertices, v).applyMatrix4(matrix).applyMatrix4(camera.matrixWorldInverse));
        }
      });
    } else {
      // Keep the existing clear full-footprint view for the older maps.
      for (const x of [-map.half - 3, map.half + 3]) for (const z of [-map.half - 3, map.half + 3]) for (const y of [-2, top + 2])
        points.push(new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse));
    }
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for (const p of points) { minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y); }
    const centerX=launch?(minX+maxX)/2:0,centerY=launch?(minY+maxY)/2:0;
    const extentX=Math.max(maxX-centerX,centerX-minX),extentY=Math.max(maxY-centerY,centerY-minY);
    const span = Math.max(extentY, extentX / (16 / 9)) * 1.06;
    camera.left=centerX-span*16/9;camera.right=centerX+span*16/9;camera.top=centerY+span;camera.bottom=centerY-span;
    camera.updateProjectionMatrix();
    const footprint=[[minX,minY],[maxX,maxY]].map(([x,y])=>new THREE.Vector3(x,y,0).applyMatrix4(camera.projectionMatrix).toArray());
    world.updateDetail?.(camera, .5);
    renderer.render(scene, camera);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (retired) return;
    status({ state: 'ready', label: choice.label, key: choice.key, profile: choice.profile,
      mapId: choice.id, revision: map.revision || 'shipped-flat-map', half: map.half, palette,
      loadedAssets, captures: ++captures, canvas: { x: 16, y: 62, width: 960, height: 540 },
      camera: { type: 'orthographic', position: camera.position.toArray(), target: target.toArray(), span, footprint, vertices: points.length, framingSource: launch ? 'visible on-track mesh vertices' : 'full map bounds' },
      renderer: { contexts: 1, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures } });
  } catch (error) {
    cleanup(); if (!retired) status({ state: 'error', label: choice.label, error: error.message });
  } finally {
    busy = false;
    if (retired) { cleanup(); renderer.dispose(); renderer.forceContextLoss(); }
    else $('load').disabled = $('map').disabled = $('palette').disabled = false;
  }
}
$('load').addEventListener('click', capture);
canvas.addEventListener('webglcontextlost', () => status({ state: 'error', error: 'WebGL context lost; reload this capture page.' }));
addEventListener('pagehide', () => {
  retired = true;
  // Pending asset requests finish before releasing their scene-owned resources.
  if (!busy) { cleanup(); renderer.dispose(); renderer.forceContextLoss(); }
});
try {
  const response = await fetch('/maps'); if (!response.ok) throw new Error('Map list unavailable');
  maps = await response.json();
  for (const choice of maps) $('map').add(new Option(choice.label, choice.key));
  const query = new URLSearchParams(location.search), requested = query.get('map');
  const selected = maps.find(m => m.key === requested || m.label === requested);
  $('map').value = selected?.key || 'elevated-garden';
  if (['Daybreak', 'Sunset', 'Starlight'].includes(query.get('palette'))) $('palette').value = query.get('palette');
  await capture();
} catch (error) { status({ state: 'error', error: error.message }); }
