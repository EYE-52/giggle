import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
import {KART_PHYSICS_CONFIG as C} from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {createKartModel, animateKartModel} from '../public/js/engines/kart-model.mjs';

// Actual shipping GLB hubs against real raycast-wheel poses. This catches the
// old fixed authored hub heights even on level ground, and incorrect parent
// transforms/steering when the body tilts or suspension extends in the air.
await RAPIER.init();
await MeshoptDecoder.ready;
const bytes = await fs.readFile(new URL('../public/assets/karts/giggle-kart.meshopt.glb', import.meta.url));
const template = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  .parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
const model = createKartModel(THREE, {assets:{kart:template}});
const physics = createKartPhysics(RAPIER, C);
physics.addStatic({id:'floor',shape:'box',position:{x:0,y:-.5,z:0},half:{x:30,y:.5,z:30}});
physics.addKart('driver', {position:{x:0,y:.75,z:0},rotation:{x:0,y:0,z:0,w:1}});
let checks=0;
function checkPose(pose, label, flat=false) {
  model.position.copy(pose.position);
  model.quaternion.copy(pose.rotation);
  model.userData.kart.inner.position.y=C.chassis.modelOriginY;
  animateKartModel(model,{physicalPose:pose,speed:pose.speed,steer:1,dt:1/60});
  model.updateWorldMatrix(true,true);
  for(const wheel of model.userData.kart.wheels) {
    const real=pose.wheels[wheel.index],anchor=C.wheels[wheel.index];
    const expected=new THREE.Vector3(anchor.x,anchor.y-real.length,anchor.z)
      .applyQuaternion(model.quaternion).add(model.position);
    const actual=wheel.node.getWorldPosition(new THREE.Vector3());
    assert(actual.distanceTo(expected)<1e-6,`${label}: ${wheel.key} rendered hub matches physical suspension`);checks++;
    assert.equal(wheel.node.rotation.x,real.rotation,`${label}: physical tyre rotation`);checks++;
    if(anchor.front) {
      assert.equal(wheel.node.parent.rotation.y,real.steering,`${label}: actual steering angle`);checks++;
    }
    if(flat&&real.contact) {
      const tire=wheel.node.getObjectByName('WheelMesh_'+wheel.key);
      const box=new THREE.Box3().setFromObject(tire);
      assert(box.min.y>-.025&&box.min.y<.035,`${label}: ${wheel.key} tread meets ground, minY=${box.min.y}`);checks++;
    }
  }
  assert.equal(model.userData.kart.body.rotation.x,0,`${label}: no second chassis pitch`);checks++;
  assert.equal(model.userData.kart.body.rotation.z,0,`${label}: no second chassis roll`);checks++;
}
try {
  for(let i=0;i<60;i++)physics.step();
  checkPose(physics.pose('driver'),'settled flat',true);
  physics.applyIntent('driver',{throttle:1,steer:.65,brake:0});
  for(let i=0;i<36;i++)physics.step();
  // A raycast wheel approximates a round contact patch; chassis camber can
  // compress the outer tread during a turn. Hub/steer/spin still match the
  // real controller; static tread clearance is checked while settled.
  checkPose(physics.pose('driver'),'steered flat');
  const rotation=new THREE.Quaternion().setFromEuler(new THREE.Euler(.18,.6,-.12));
  physics.resetKart('driver',{position:{x:0,y:4,z:0},rotation});
  for(let i=0;i<6;i++)physics.step();
  const flying=physics.pose('driver');
  assert.equal(flying.grounded,false,'airborne setup uses actual disconnected wheel rays');checks++;
  checkPose(flying,'tilted airborne');
  for(let i=0;i<90;i++)physics.step();
  checkPose(physics.pose('driver'),'landed flat',true);
  const centres=model.userData.kart.wheels.map(w=>w.centreY);
  animateKartModel(model,{dt:1/60});
  for(const wheel of model.userData.kart.wheels) {
    assert.equal(wheel.node.position.y,wheel.baseY,'nonphysical/KO model restores authored hub');checks++;
  }
  assert.deepEqual(model.userData.kart.wheels.map(w=>w.centreY),centres,'authored hub calibration remains immutable');checks++;
} finally {physics.dispose();}
console.log(JSON.stringify({pass:true,checks,scope:'Actual Meshopt GLB and Rapier suspension; no browser, frame-rate or device claim'}));
