import assert from 'node:assert/strict';
import * as THREE from 'three';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';
import {selectArenaVariant} from '../public/js/engines/kart-arena-policy.mjs';
import {createKartElevatedWorld} from '../public/js/engines/kart-elevated-world.mjs';
for(const players of[2,8]){
 const map=selectArenaVariant(elevatedMap('rookie-ribbons'),players),scene=new THREE.Scene(),world=createKartElevatedWorld(THREE,{scene,map});
 const roads=map.colliders.filter(d=>d.id.startsWith('floor')||d.shape==='deck'||d.shape==='wedge');
 for(const d of roads){const {body,cameraBody}=world.colliderMeshes.get(d.id);assert(body.material.map?.generateMipmaps);assert(body.geometry.attributes.uv);assert(cameraBody.userData.cameraCollider);assert.equal(cameraBody.visible,false);}
 assert.equal(map.colliders.filter(d=>d.role==='pillar').length,2);
 assert.equal(map.colliders.filter(d=>d.id.includes('-climb-rail-')).length,4);
 for(const d of map.colliders.filter(d=>d.role==='rail')){const {group}=world.colliderMeshes.get(d.id);assert.equal(group.quaternion.x,d.rotation?.x||0);assert.equal(group.quaternion.w,d.rotation?.w??1);}
 const stats=world.stats();assert(stats.drawCalls<=45&&stats.triangles<=28000&&stats.textureBytes<=12*1024**2);world.dispose();assert.equal(scene.children.length,0);
}
console.log('PASS launch art: tiled roads/decks/ramps, finite camera envelopes, solid slope guards, bridge piers, budgets and disposal');
