import {MeshoptDecoder} from '/public/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;
import * as THREE from 'three';
import { GLTFLoader } from '/public/vendor/three/loaders/GLTFLoader.js';
import { initializePhysics, runPhysicsChecks, RAPIER, CONFIG, ADAPTER } from '/test/kart-elevation-physics.mjs';
import { PROTOTYPE_SOLIDS, PROTOTYPE_SCENES } from './layout.mjs';
import { elevatedMap } from '/public/js/engines/kart-elevated-maps.mjs';

const $ = id => document.getElementById(id), canvas = $('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.setClearColor(0xc6d5de);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, 1, 0.1, 280);
scene.add(new THREE.HemisphereLight(0xffffff, 0x70808a, 2.8));
const sun = new THREE.DirectionalLight(0xfff2df, 3); sun.position.set(-30, 50, -15); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 130 }); scene.add(sun);
const geometryGroup = new THREE.Group(); scene.add(geometryGroup);
const materialColors = { floor: 0x648f79, ramp: 0xe2c497, deck: 0xdba967, stone: 0xd2c4af, slate: 0x718796, steel: 0x83a2ac, ice: 0xa9dfe6, asphalt: 0x779184, hedge: 0x429572, fountain: 0x83bec5, barrier: 0x526e7d, 'cargo-teal': 0x2d939c, 'cargo-orange': 0xe78e49 };
let physics, template, liveModels = new Map(), paused = false, overview = false, retired = false, animationId = 0, last = performance.now(), accumulator = 0, frameCount = 0;
let evidence = [], actions = [], maxY = 0, minVy = 0, wasAirborne = false, landed = false, layoutName = 'Diagnostic arena';
const keys = new Set(), pointers = new Map();
const q = new THREE.Quaternion(), forward = new THREE.Vector3(), offset = new THREE.Vector3(), desired = new THREE.Vector3();
function clearInput() { keys.clear(); pointers.clear(); for (const b of document.querySelectorAll('[data-control]')) b.classList.remove('active'); if (physics) physics.applyIntent('driver', { steer: 0, throttle: 0, brake: 0 }); }
const controls = () => {
  const held = new Set([...pointers.values()]);
  const has = (name, ...codes) => held.has(name) || codes.some(c => keys.has(c));
  return { steer: Number(has('right', 'KeyD', 'ArrowRight')) - Number(has('left', 'KeyA', 'ArrowLeft')), throttle: Number(has('forward', 'KeyW', 'ArrowUp')) - Number(has('reverse', 'KeyS', 'ArrowDown')), brake: Number(has('brake', 'Space')) };
};
function record(type, extra = {}) {
  if (!physics) return;
  const entry = { type, at: performance.now(), tick: physics.stats().tick, ...extra, pose: physics.pose('driver') }; evidence.push(entry);
  if (evidence.length > 600) evidence.shift();
  if (type !== 'sample') { actions.push(entry); if (actions.length > 200) actions.shift(); }
}
for (const button of document.querySelectorAll('[data-control]')) {
  button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); pointers.set(e.pointerId, button.dataset.control); button.classList.add('active'); record('pointer down', { control: button.dataset.control, trusted: e.isTrusted }); });
  const release = e => { if (!pointers.delete(e.pointerId)) return; button.classList.remove('active'); record('pointer release', { control: button.dataset.control, trusted: e.isTrusted, event: e.type }); };
  button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
}
addEventListener('keydown', e => {
  if (/INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY/.test(e.target.tagName) || !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) return;
  e.preventDefault(); if (!keys.has(e.code)) record('key down', { code: e.code, trusted: e.isTrusted }); keys.add(e.code);
});
addEventListener('keyup', e => { if (keys.delete(e.code)) { e.preventDefault(); record('key release', { code: e.code, trusted: e.isTrusted }); } });
addEventListener('blur', () => { clearInput(); record('blur input release'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));

function solidMesh(d) {
  let geometry;
  if (d.shape === 'wedge') {
    const points = ADAPTER.wedgeVertices(d.half), triangles = [0, 2, 4, 1, 5, 3, 0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 0, 4, 5, 0, 5, 1];
    const vertices = triangles.flatMap(i => [...points.subarray(i * 3, i * 3 + 3)]);
    geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
  } else geometry = new THREE.BoxGeometry(d.half.x * 2, d.half.y * 2, d.half.z * 2);
  const color = materialColors[d.material] || (d.id === 'floor' ? materialColors.floor : d.shape === 'wedge' ? materialColors.ramp : d.shape === 'deck' ? materialColors.deck : materialColors.barrier);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.82 })); mesh.position.copy(d.position);
  if (d.rotation) mesh.quaternion.set(d.rotation.x, d.rotation.y, d.rotation.z, d.rotation.w).normalize();
  mesh.castShadow = d.id !== 'floor'; mesh.receiveShadow = true; geometryGroup.add(mesh);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 15), new THREE.LineBasicMaterial({ color: 0x274652, transparent: true, opacity: 0.2 })); mesh.add(edges);
}
function clearGeometry() {
  geometryGroup.traverse(o => { o.geometry?.dispose(); if (o.material) o.material.dispose(); }); geometryGroup.clear();
}
function model(id, color) {
  const group = new THREE.Group(), glb = template.clone(true); group.add(glb);
  glb.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material?.name === 'KartPaint') { o.material = o.material.clone(); o.material.color.set(color); o.userData.ownedPaint = true; } } });
  const wheels = ['FL', 'FR', 'RL', 'RR'].map(key => glb.getObjectByName('WheelSpin_' + key));
  liveModels.set(id, { group, glb, wheels, steers: [glb.getObjectByName('FrontSteer_L'), glb.getObjectByName('FrontSteer_R')] }); scene.add(group);
}
function reset() {
  clearInput(); physics?.dispose(); physics = ADAPTER.createKartPhysics(RAPIER, CONFIG); clearGeometry();
  for (const { group, glb } of liveModels.values()) { scene.remove(group); glb.traverse(o => { if (o.userData.ownedPaint) o.material.dispose(); }); } liveModels.clear();
  const selection = $('map').value, diagnostic = selection === 'diagnostic'; $('scenario').hidden = !diagnostic;
  let primary, secondary, primaryRotation, secondaryRotation, solids;
  if (diagnostic) {
    const s = PROTOTYPE_SCENES[$('scenario').value]; ({ primary, secondary, primaryRotation, secondaryRotation } = s); solids = PROTOTYPE_SOLIDS; layoutName = s.label;
  } else {
    const map = elevatedMap(selection); solids = map.colliders; layoutName = map.name;
    const [a, b] = map.spawns; primary = { x: a.x, y: a.y + 1, z: a.z }; secondary = { x: b.x, y: b.y + 1, z: b.z };
    primaryRotation = { x: 0, y: Math.sin(a.angle / 2), z: 0, w: Math.cos(a.angle / 2) }; secondaryRotation = { x: 0, y: Math.sin(b.angle / 2), z: 0, w: Math.cos(b.angle / 2) };
  }
  for (const d of solids) { physics.addStatic(d); solidMesh(d); }
  physics.addKart('driver', { position: primary, rotation: primaryRotation }); physics.addKart('rival', { position: secondary, rotation: secondaryRotation });
  for (let i = 0; i < 90; i++) physics.step();
  model('driver', 0xf5a029); model('rival', 0x4298df); accumulator = 0; evidence = []; actions = []; maxY = 0; minVy = 0; wasAirborne = false; landed = false;
  record('reset', { selection, scene: $('scenario').value, layoutName }); camera.position.set(primary.x, primary.y + 6, primary.z - 10);
}
function draw() {
  if (retired) return;
  const now = performance.now(), dt = Math.min(0.1, Math.max(0, (now - last) / 1000)); last = now;
  if (physics && !paused && !document.hidden) {
    accumulator = Math.min(0.25, accumulator + dt); physics.applyIntent('driver', controls()); physics.applyIntent('rival', { steer: 0, throttle: $('rival').checked ? 1 : 0 });
    while (accumulator >= CONFIG.fixedDt) { physics.step(); accumulator -= CONFIG.fixedDt; }
  }
  if (physics) {
    const poses = physics.poses();
    for (const p of poses) {
      const m = liveModels.get(p.id); m.group.position.copy(p.position); m.group.quaternion.set(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w);
      m.glb.position.y = CONFIG.chassis.modelOriginY;
      for (let i = 0; i < 4; i++) {
        const anchor = CONFIG.wheels[i], y = anchor.y - p.wheels[i].length - CONFIG.chassis.modelOriginY;
        const node = anchor.front ? m.steers[i] : m.wheels[i]; if (node) node.position.y = y;
        if (m.wheels[i]) m.wheels[i].rotation.x = p.wheels[i].rotation;
        if (anchor.front && m.steers[i]) m.steers[i].rotation.y = p.wheels[i].steering;
      }
    }
    const p = poses[0]; maxY = Math.max(maxY, p.position.y); minVy = Math.min(minVy, p.linearVelocity.y); if (!p.grounded) wasAirborne = true; if (wasAirborne && p.grounded) landed = true;
    $('telemetry').textContent = `y ${p.position.y.toFixed(2)} · ${p.speed.toFixed(1)} u/s\n${p.grounded ? 'Grounded' : 'Airborne'} ${p.wheels.filter(w => w.contact).length}/4 · tick ${p.tick}`;
    if (overview) { camera.position.set(68, 85, -72); camera.lookAt(0, 0, 0); }
    else {
      q.set(p.rotation.x, p.rotation.y, p.rotation.z, p.rotation.w); forward.set(0, 0, 1).applyQuaternion(q); forward.y = 0; forward.normalize();
      offset.copy(forward).multiplyScalar(-11); offset.y = 6; desired.copy(p.position).add(offset);
      camera.position.lerp(desired, Math.min(1, dt * 8)); camera.lookAt(p.position.x + forward.x * 4, p.position.y + 0.8, p.position.z + forward.z * 4);
    }
    if (++frameCount % 12 === 0) record('sample');
  }
  renderer.render(scene, camera); animationId = requestAnimationFrame(draw);
}
function geometry() {
  const boxes = [...document.querySelectorAll('button,select,summary')].filter(e => e.getClientRects().length).map(e => ({ label: e.getAttribute('aria-label') || e.textContent.trim(), ...Object.fromEntries(['x', 'y', 'width', 'height', 'bottom', 'right'].map(k => [k, e.getBoundingClientRect()[k]])) }));
  return { viewport: { width: innerWidth, height: innerHeight }, document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }, controls: boxes, canvas: { width: canvas.clientWidth, height: canvas.clientHeight } };
}
async function save(data) { await fetch('/evidence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); }
function showResults(text) { $('results').replaceChildren(); const close = document.createElement('button'); close.textContent = 'Close'; close.className = 'result-close'; close.onclick = () => $('results').replaceChildren(); const pre = document.createElement('pre'); pre.textContent = text; $('results').append(close, pre); }
$('reset').onclick = () => { reset(); canvas.focus({ preventScroll: true }); };
$('map').onchange = reset; $('scenario').onchange = reset;
$('view').onclick = () => { overview = !overview; $('view').textContent = overview ? 'Chase view' : 'Overview'; };
$('pause').onclick = () => { paused = !paused; clearInput(); $('pause').textContent = paused ? 'Resume' : 'Pause'; record(paused ? 'pause' : 'resume'); };
$('run').onclick = async () => {
  $('run').disabled = true; clearInput();
  try { const report = await runPhysicsChecks(); await save({ type: 'finite checks', ...report, geometry: geometry() }); showResults(`PASS ${report.checks} actual Rapier checks\n${JSON.stringify(report.measurements, null, 2)}`); }
  catch (e) { showResults('FAIL ' + e.message); } finally { $('run').disabled = false; }
};
$('save').onclick = async () => { record('evidence save'); const report = { type: 'native live evidence', layoutName, geometry: geometry(), observed: { maxY, minVy, wasAirborne, landed }, actions, evidence }; await save(report); showResults(`Saved actual live telemetry · ${layoutName}\n${JSON.stringify(report.observed, null, 2)}\n${evidence.length} recorded events/samples`); };
addEventListener('message', async e => { if (e.origin !== location.origin || e.data.type !== 'geometry') return; const g = geometry(); await save({ type: 'geometry', layoutName, geometry: g }); parent.postMessage({ type: 'geometry', summary: `${innerWidth}×${innerHeight}; document ${g.document.width}×${g.document.height}; canvas ${canvas.clientWidth}×${canvas.clientHeight}` }, location.origin); });
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }; addEventListener('resize', resize); resize();
try {
  await initializePhysics(); const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('/public/assets/karts/giggle-kart.meshopt.glb'); if (!retired) { template = gltf.scene; reset(); animationId = requestAnimationFrame(draw); }
} catch (e) { $('telemetry').textContent = 'Failed: ' + e.message; throw e; }
addEventListener('pagehide', () => {
  retired = true; cancelAnimationFrame(animationId); clearInput(); physics?.dispose(); clearGeometry();
  for (const { glb } of liveModels.values()) glb.traverse(o => { if (o.userData.ownedPaint) o.material.dispose(); }); liveModels.clear();
  const resources = new Set(); template?.traverse(o => { if (o.geometry) resources.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) { resources.add(m); for (const v of Object.values(m)) if (v?.isTexture) resources.add(v); } }); for (const r of resources) r.dispose();
  renderer.dispose(); navigator.sendBeacon('/evidence', JSON.stringify({ type: 'pagehide cleanup', layoutName, physics: physics?.stats(), animationRetired: retired, models: liveModels.size, solids: geometryGroup.children.length }));
});
