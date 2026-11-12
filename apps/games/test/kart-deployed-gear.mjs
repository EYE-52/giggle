import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
import {createKartCombatArt,projectileContactInset} from '../public/js/engines/kart-combat-art.mjs';
import {prepareGroundProp,placeGroundProp} from '../public/js/engines/kart-ground-markers.mjs';
import {WEAPONS} from '../public/js/engines/kart-weapon-contract.mjs';

// Load the exact shared library. No synthetic replacement geometry: every
// animated vertex is checked against the independent authority envelope.
await MeshoptDecoder.ready;
const bytes=await fs.readFile(new URL('../public/assets/karts/combat/pickup-gear.glb',import.meta.url));
const library=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
const snapshots=new Map();let borrowedDisposals=0;
library.traverse(o=>{if(o.isMesh&&!snapshots.has(o.geometry)){
  const positions=o.geometry.attributes.position;
  snapshots.set(o.geometry,{positions,buffer:positions.array,copy:positions.array.slice()});
  o.geometry.addEventListener('dispose',()=>borrowedDisposals++);
  o.material.addEventListener('dispose',()=>borrowedDisposals++);
}});
const art=createKartCombatArt(THREE,{assets:library}),point=new THREE.Vector3(),measurements=[];
function vertices(object,visit){object.updateWorldMatrix(true,true);object.traverse(o=>{if(!o.isMesh||o.userData.groundDecoration)return;
  const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++)visit(point.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld));
});}
function borrowed(object,source){const mesh=object.getObjectByName(source.name);assert(mesh,source.name+' visible in deployed instance');assert.equal(mesh.geometry,source.geometry,'borrow geometry');assert.equal(mesh.material,source.material,'borrow material');}
for(const kind of ['missile','frost','nuke']){
  const shot=art.projectile(kind),source=library.getObjectByName('Gear_'+kind),c=shot.userData.combat;
  borrowed(shot,source);
  assert(kind==='missile'?c.tail:c.halo,kind+' keeps pooled firing glow/exhaust');
  let maximum=0;
  for(const reduced of [false,true])for(let frame=0;frame<180;frame++){
    art.animate(shot,1/60,frame/60,reduced);
    vertices(shot,p=>maximum=Math.max(maximum,kind==='missile'?Math.hypot(p.x,p.y):p.length()));
  }
  assert(maximum<=(kind==='missile'?.40:.43)+1e-6,kind+' solid fits real flight envelope: '+maximum);
  if(kind==='missile')assert(Number.isFinite(projectileContactInset(THREE,shot,.42)),'homing nose calibrates to real sweep');
  measurements.push({kind,maximum});
}
for(const kind of ['mine','proximity'])for(const own of [false,true]){
  const object=art.mine(own,kind),c=object.userData.combat;
  const source=library.getObjectByName(kind==='mine'?'Mine0':'Gear_proximity');borrowed(object,source);
  assert(c.warning,'warning ring retained');assert.equal(c.own,own);
  let radius=0,minimum=Infinity;
  for(let frame=0;frame<180;frame++){
    c.armed=frame>30;art.animate(object,1/60,frame/60,frame%2===0);
    vertices(object,p=>{radius=Math.max(radius,Math.hypot(p.x,p.z));minimum=Math.min(minimum,p.y);});
  }
  assert(radius<=WEAPONS[kind].bodyRadius-.02+1e-6,kind+' fitted footprint');
  assert(Math.abs(minimum)<1e-6,kind+' lowest solid vertex starts at ground, independent of stowed offsets');
  const prop=new THREE.Group();prop.add(object);prepareGroundProp(THREE,prop);
  for(const ground of [(x,z)=>0,(x,z)=>x*.12+z*.08]){
    placeGroundProp(THREE,prop,2,0,3,ground);
    let clearance=Infinity;vertices(object,p=>clearance=Math.min(clearance,p.y-ground(p.x,p.z)));
    assert(clearance>=-.001&&clearance<.08,kind+' planted without sinking or floating: '+clearance);
  }
  measurements.push({kind,own,radius,minimum});
}
// Missing optional library still has functioning, animated fallback props.
const fallback=createKartCombatArt(THREE);
for(const kind of ['missile','frost','nuke']){const object=fallback.projectile(kind);assert(object.userData.combat.inner.children.length);fallback.animate(object,.016,1,false);}
for(const kind of ['mine','proximity'])assert(fallback.mine(true,kind).userData.combat.inner.children.length);
fallback.dispose();art.dispose();assert.equal(borrowedDisposals,0,'borrowed GLB resources remain library-owned');
for(const [geometry,s]of snapshots){assert.equal(geometry.attributes.position,s.positions);assert.equal(s.positions.array,s.buffer);assert.deepEqual(s.positions.array,s.copy,'shared vertices never mutated');}
console.log('deployed generated gear: '+JSON.stringify(measurements));
