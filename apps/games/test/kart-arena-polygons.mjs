import assert from 'node:assert/strict';
import * as THREE from 'three';
import R from '@dimforge/rapier3d-compat';
import C from '../public/js/engines/kart-physics-config.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import {arenaPolygonFloor,arenaPolygonGuards} from '../public/js/engines/kart-arena-polygons.mjs';
import {arenaFinish} from '../public/js/engines/kart-launch-support.mjs';
import {raisedSurfaceHeight} from '../public/js/engines/kart-raised-support.mjs';
import {createKartElevatedWorld} from '../public/js/engines/kart-elevated-world.mjs';
import {createKartCameraCollision} from '../public/js/engines/kart-camera-collision.mjs';
await R.init();const polygon=[[-44,-42],[44,-42],[60,0],[44,42],[-44,42],[-60,0]],floor=arenaPolygonFloor('floor-hexagon',polygon),map=arenaFinish({id:'polygon-fixture',arenaVersion:1,artId:'neon',backdrop:'neon',half:64,levels:[{id:'L0',y:0,color:0xabcabc},{id:'L1',y:7,color:0xcabcab}],colliders:[floor,...arenaPolygonGuards(polygon)],routes:[],landmarks:[],playBounds:{halfX:60,halfZ:42}}),physics=createKartPhysics(R,C);
try{
 map.colliders.forEach(d=>physics.addStatic(d));for(let x=-60;x<=60;x+=2)for(let z=-42;z<=42;z+=2){const y=raisedSurfaceHeight(floor,x,z),hit=physics.supportAt({x,y:.4,z},.8);if(Number.isFinite(y)){assert(hit);assert(Math.abs(hit.point.y)<.01);assert(hit.normal.y>.99);}else assert(!hit||hit.surfaceId!=='floor-hexagon','no invisible rectangle outside the polygon');}
 physics.addKart('seam',{position:{x:-48,y:1,z:0},rotation:{x:0,y:Math.SQRT1_2,z:0,w:Math.SQRT1_2}});for(let i=0;i<90;i++)physics.step();physics.applyIntent('seam',{throttle:1,steer:0});let travel=0;for(let i=0;i<300;i++){physics.step();const p=physics.pose('seam');if(p.position.x>45){travel=p.position.x+48;break;}assert(Math.abs(p.position.y-.645)<.15,'fan triangle seams do not kick or drop a kart');}assert(travel>90);
 const scene=new THREE.Scene(),world=createKartElevatedWorld(THREE,{scene,map}),skin=world.colliderMeshes.get('floor-hexagon');assert.equal(skin.cameraBody.geometry,skin.body.geometry,'camera uses exact finite slab, including underside');assert(skin.body.geometry.attributes.normal&&skin.body.geometry.attributes.uv);
 const camera=createKartCameraCollision(THREE,map.colliders),focus=new THREE.Vector3(0,-2,0),eye=new THREE.Vector3(0,2,0);assert(camera.constrain(eye,focus,.22));assert(eye.y<-1.2);camera.dispose();world.dispose();assert.equal(scene.children.length,0);
 assert.throws(()=>arenaPolygonFloor('bad',[[0,0],[10,0],[3,3],[10,10],[0,10]]),/Convex/);
}finally{physics.dispose();}
console.log('PASS bounded polygon slab: analytic/physics support, normals, tiled UVs, 90m seam drive, finite camera underside and no square fallback');
