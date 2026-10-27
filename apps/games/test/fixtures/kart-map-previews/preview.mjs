import {MeshoptDecoder} from '/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;
import * as THREE from 'three';
import { GLTFLoader } from '/vendor/three/loaders/GLTFLoader.js';
import { loadKartAssets, closeKartAssetBitmaps } from '/js/engines/kart-assets.mjs';
import { createKartWorld } from '/js/engines/kart-world.mjs';
import { createKartLighting } from '/js/engines/kart-lighting.mjs';
import { createKartElevatedWorld } from '/js/engines/kart-elevated-world.mjs';
import { elevatedMap } from '/js/engines/kart-elevated-maps.mjs';

const $ = id => document.getElementById(id), canvas = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
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
      const files = map.environment === 'alpine'
        ? [['stylized', 'environment/stylized-alpine', '9426a0ed'], ['fountain', 'environment/alpine-fountain', '7a687cd3']] : [];
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
    const camera = new THREE.PerspectiveCamera(52, 960 / 540, .1, 900);
    // An elevated diagonal overview preserves ramps, cover and the lower routes.
    // Scale with the real half extent so every playable corner stays in frame.
    camera.position.set(map.half * 1.60, map.half * 1.85, -map.half * 2.25);
    camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    world.updateDetail?.(camera, .5);
    renderer.render(scene, camera);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (retired) return;
    status({ state: 'ready', label: choice.label, key: choice.key, profile: choice.profile,
      mapId: choice.id, revision: map.revision || 'shipped-flat-map', half: map.half, palette,
      loadedAssets, captures: ++captures, canvas: { x: 16, y: 62, width: 960, height: 540 },
      camera: { position: camera.position.toArray(), target: [0, 0, 0] },
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
