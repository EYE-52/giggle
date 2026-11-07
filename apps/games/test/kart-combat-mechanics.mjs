import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;
// New elevated mechanics use actual crates and Rapier driving; no grant or
// target-pose mutation hooks are exposed by the production authority.
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import {createKartCombatArt} from '../public/js/engines/kart-combat-art.mjs';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
await RAPIER.init();
let serial=0,checks=0;
const check=(message,value)=>{assert.ok(value,message);checks++;};
const point=(id,x,z,angle=0)=>({id,x,y:0,z,angle,surface:'floor'});
const map=(spawns=[point('a',0,0),point('b',0,12)],cover=[])=>({id:'mechanics',revision:'1',half:60,colliders:[{id:'floor',shape:'box',position:{x:0,y:-1,z:0},half:{x:60,y:1,z:60}},...cover],spawns,sockets:[point('s0',-.7,0),point('s1',.7,0)]});
const step=(w,n=1,each)=>{for(let i=0;i<n;i++){each?.(i);w.advance(w.snapshot().serverAt+CONFIG.fixedDt*1000);}};
const kart=(w,id='a')=>w.snapshot().karts.find(k=>k.id===id);
const send=(w,id='a',intent={})=>{const s=w.snapshot(id),p=s.you;return w.input(id,{instance:s.instance,seq:p.receivedSeq+1,life:p.life,controlEpoch:p.controlEpoch,steer:0,throttle:0,brake:0,nitro:false,use:false,...intent},s.serverAt);};
const fire=(w,id='a')=>{assert.ok(send(w,id,{use:true}).ok);assert.ok(send(w,id,{use:false}).ok);step(w);};
function armed(kind,m=map(),opts={}) {
 for(let seed=0;seed<1024;seed++) {
  const w=COMBAT.createElevatedCombat(RAPIER,CONFIG,m,m.spawns.map(s=>({id:s.id})),{instance:'mechanic-'+(++serial),seed,countdownMs:0,roundMs:15000,crates:1,...opts});step(w);
  if(kart(w).weapon===kind){step(w,160);return w;}w.dispose();
 }
 throw Error('real pickup search failed: '+kind);
}
{
 const w=armed('machinegun',map([point('a',0,0),point('b',30,30)]));try {
  check('machine gun crate grants twelve rounds',kart(w).ammo===24);
  send(w,'a',{use:true});step(w);const shot=w.snapshot().projectiles[0];
  check('machine gun fires fast visible swept bullet',Math.abs(Math.hypot(shot.velocity.x-kart(w).pose.linearVelocity.x,shot.velocity.y-kart(w).pose.linearVelocity.y,shot.velocity.z-kart(w).pose.linearVelocity.z)-140)<.01);
  check('machine gun static sweep encloses its visible body',shot.radius===.22&&shot.radius===COMBAT.staticSweepRadii.machinegun);
  step(w,30,i=>{if(i%8===0)send(w,'a',{use:true});});
  const spent=24-kart(w).ammo;check('held machine gun fires at bounded eight rounds per second',spent>=6&&spent<=8);
  send(w);step(w,130);check('release lets the accepted full twelve-round payload finish',w.snapshot().events.filter(e=>e.type==='fire'&&e.weapon==='machinegun').length===24&&!kart(w).firing);
  check('a new actual pickup is not auto-activated after release',kart(w).weapon!==null&&kart(w).ammo>0);const nextItem={weapon:kart(w).weapon,ammo:kart(w).ammo};step(w,60);
  check('completed activation cannot reuse its input for the next pickup',kart(w).weapon===nextItem.weapon&&kart(w).ammo===nextItem.ammo&&!kart(w).firing);
 }finally{w.dispose();}
 const cut=armed('machinegun',map([point('a',0,0),point('b',30,30)]));try {
  fire(cut);step(cut,5);check('disconnect fixture has an accepted incomplete payload',kart(cut).firing&&kart(cut).ammo===22);cut.setConnected('a',false);step(cut,60);
  check('disconnect discards committed remaining rounds',!kart(cut).firing&&kart(cut).ammo===0&&kart(cut).weapon===null);cut.setConnected('a',true);step(cut,30);
  check('reconnect never resumes the cancelled sequence',!kart(cut).firing&&cut.snapshot().events.filter(e=>e.type==='fire').length===2);
 }finally{cut.dispose();}
 const full=armed('machinegun',map([point('a',0,0),point('b',30,30)]));try {
  send(full,'a',{use:true});step(full,185,i=>{if(i%8===0)send(full,'a',{use:true});});
  check('one held burst cannot fire a newly collected item',full.snapshot().events.filter(e=>e.type==='fire').length===24);
 }finally{full.dispose();}
}
{
 const w=armed('mine',map([point('a',0,0),point('b',0,-10)]));try {
  fire(w);check('Mine activation starts with one drop and two committed remaining',w.snapshot().mines.length===1&&kart(w).ammo===2&&kart(w).firing);step(w,32);const mines=w.snapshot().mines;check('mine layer sequentially drops three supported traps per pickup',mines.length===3&&mines.every(m=>m.surfaceId==='floor'&&!m.armed)&&new Set(mines.map(m=>m.id)).size===3);
  check('stationary Mine trail uses three separated rear positions',Math.max(...mines.map(m=>m.position.z))-Math.min(...mines.map(m=>m.position.z))>2.3&&mines.every(m=>m.position.z<kart(w).pose.position.z)&&Math.max(...mines.map(m=>m.position.x))-Math.min(...mines.map(m=>m.position.x))<.01);
  step(w,760);check('all untriggered mines expire within bounded lifetime',w.snapshot().mines.length===0);
 }finally{w.dispose();}
}
{
 const w=armed('nuke',map([point('a',0,0),point('b',-6,16),point('c',6,16)]));try {
  fire(w);check('nuke has delayed larger physical warhead',w.snapshot().grenades[0].weapon==='nuke'&&w.snapshot().grenades[0].radius===.5&&w.snapshot().grenades[0].fuse>3.4);
  step(w,110);check('nuke cannot detonate early',kart(w).hits===0&&w.snapshot().grenades.length===1);
  step(w,105);check('nuke creates one large blast that takes every heart from each kart in range',kart(w).hits===2&&['b','c'].every(id=>kart(w,id).health===0&&!kart(w,id).alive)&&w.snapshot().events.filter(e=>e.type==='hit'&&e.weapon==='nuke').every(e=>e.damage===3)&&w.snapshot().events.filter(e=>e.type==='blast'&&e.weapon==='nuke').length===1&&kart(w).alive);
 }finally{w.dispose();}
}
const art=createKartCombatArt(THREE);
try {
 for(const kind of Object.keys(COMBAT.arsenal.weights)) {const rig=art.weapon(kind);check(kind+' rig keeps semantic identity and valid mount',rig.userData.combat.kind===kind&&rig.userData.combat.mount.every(Number.isFinite));}
 for(const kind of ['nuke','proximity']){const p=art.projectile(kind);check(kind+' shot keeps semantic identity and finite silhouette',p.userData.combat.kind===kind&&new THREE.Box3().setFromObject(p).getSize(new THREE.Vector3()).length()>0);}
 check('retired deployables have no art factories',!('sentry'in art)&&!('spikes'in art));
} finally {art.dispose();}
// The regression runs real factory animation, including loaded source props.
// Only the image decode is stubbed because Node has no browser image bitmap.
globalThis.self=globalThis;
globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
const libraries=await Promise.all(['combat/combat.meshopt','combat/pulse-mounted.meshopt','combat/arsenal-mounted.meshopt'].map(async name=>{
 const b=await readFile(new URL('../public/assets/karts/'+name+'.glb',import.meta.url));
 return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;
}));
const materialState=m=>JSON.stringify({version:m.version,color:m.color?.getHex(),emissive:m.emissive?.getHex(),opacity:m.opacity,roughness:m.roughness,metalness:m.metalness,emissiveIntensity:m.emissiveIntensity,map:m.map?.uuid});
const borrowed=new Set();
for(const root of libraries)root.traverse(o=>{if(o.geometry)borrowed.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)borrowed.add(m);});
let borrowedDisposed=0;for(const r of borrowed)r.addEventListener('dispose',()=>borrowedDisposed++);
for(const loaded of [false,true]) {
 const factory=createKartCombatArt(THREE,loaded?{assets:{get:name=>libraries.map(root=>root.getObjectByName(name)).find(Boolean)}}:undefined);
 const label=loaded?'loaded':'fallback',charge=factory.projectile('proximity'),c=charge.userData.combat,body=c.inner.children[0];
 charge.position.set(4,.32,-2);charge.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),.7);charge.updateMatrixWorld(true);
 c.landed=true;const bodyTransform=body.matrixWorld.clone(),outerTransform=charge.matrixWorld.clone();
 const lampStates=new Set(),materialSnapshot=new Map();
 charge.traverse(o=>{if(o.material)materialSnapshot.set(o.material,materialState(o.material));});
 for(let i=0;i<60;i++) {c.armed=i>=15;factory.animate(charge,1/60,i/60,false);charge.updateMatrixWorld(true);assert.ok(body.matrixWorld.equals(bodyTransform));assert.ok(charge.matrixWorld.equals(outerTransform));if(i<15)assert.equal(c.tail.visible,false);else {assert.equal(c.tail.visible,true);lampStates.add(c.tail.scale.x);}}
 check(label+' proximity body and support transform stay planted for sixty frames',true);
 check(label+' landed proximity lamp alone gently changes only after arming',lampStates.size>2&&[...lampStates].every(scale=>scale>=.96&&scale<=1.04));
 factory.animate(charge,1/60,2,true);check(label+' reduced-motion lamp remains steady and body remains fixed',c.tail.visible&&c.tail.scale.x===1&&c.inner.rotation.toArray().slice(0,3).every(v=>v===0));
 c.armed=false;factory.animate(charge,1/60,3,true);check(label+' disarmed recycled charge hides its lamp',!c.tail.visible);
 for(const [m,saved] of materialSnapshot)check(label+' animation never mutates shared materials',materialState(m)===saved);
 const nuke=factory.projectile('nuke');
 for(let i=0;i<60;i++)factory.animate(nuke,1/60,i/60,false);
 check(label+' rigid nuke has no arbitrary body spin',nuke.userData.combat.inner.rotation.toArray().slice(0,3).every(v=>v===0));
 const owned=new Set();for(const object of [charge,nuke])object.traverse(o=>{if(o.geometry&&!o.isSprite&&!borrowed.has(o.geometry))owned.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m&&!borrowed.has(m))owned.add(m);});
 const disposals=new Map();for(const r of owned)r.addEventListener('dispose',()=>disposals.set(r,(disposals.get(r)||0)+1));
 factory.dispose();factory.dispose();check(label+' factory resources dispose once',owned.size>0&&[...owned].every(r=>disposals.get(r)===1));
}
check('new art factories never dispose borrowed GLB resources',borrowedDisposed===0);
console.log('kart-combat-mechanics: '+checks+' real-authority and art checks passed');
