// Real Three production paths. --measure prints old-code witnesses.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import {createKartCombatArt,projectileContactInset} from '../public/js/engines/kart-combat-art.mjs';
import {createProjectilePlayback,grenadePose} from '../public/js/engines/kart-flight.mjs';
import {createKartImpactFX} from '../public/js/engines/kart-impact-fx.mjs';
import {createArsenalFX} from '../public/js/engines/kart-arsenal-fx.mjs';
import {createKartDrivingFX} from '../public/js/engines/kart-driving-fx.mjs';
import {WEAPON_IDS} from '../public/js/engines/kart-weapon-contract.mjs';
globalThis.self=globalThis;
globalThis.createImageBitmap=async blob=>{const b=Buffer.from(await blob.arrayBuffer());return {width:b.readUInt32BE(16),height:b.readUInt32BE(20),close(){}};};
const measuring=process.argv.includes('--measure'),results=[];
function bound(name,ms,max=150){results.push({name,ms});if(!measuring)assert(ms<=max,`${name}: ${ms}ms > ${max}ms`);}
function lastVisible(frame,visible,max=1200){let last=0;for(let ms=0;ms<=max;ms+=10){frame(ms);if(visible())last=ms;}return last;}
import {rig,base} from './helpers/kart-view-fixture.mjs';
const source=fs.readFileSync(new URL('../public/js/engines/kart-view.js',import.meta.url),'utf8');
const freshness=source.slice(source.indexOf('function ordnanceFresh('),source.indexOf('/* Calibrated server time'));
const preparation=source.slice(source.indexOf('function prepareShotContact('),source.indexOf('const cueBounds='));
const placement=source.slice(source.indexOf('liveZ.clear();'),source.indexOf('for (const [zid, mesh] of zaps)'));
assert(placement.length>100,'production projectile placement was found');
const kinds=['machinegun','trishot','missile','cannon','boomerang'];
for(const kind of kinds){
 const scene=new THREE.Scene(),art=createKartCombatArt(THREE),fx=createKartImpactFX(THREE,scene),shotPlayback=createProjectilePlayback();shotPlayback.setDelay(350);
 const shot={id:'shot',kind,physical:true,x:0,y:1,z:0,vx:0,vy:0,vz:50,angle:0,ttl:2};for(let at=1000;at<=1600;at+=100)shotPlayback.ingest([{...shot,z:(at-1000)*.05}],at);
 const pooled=art.projectile(kind);pooled.userData.flight={direction:{}};
 const c=vm.createContext({liveZ:new Set(),liveG:new Set(),THREE,S:{phase:'drive',simAt:1600,zaps:[shot]},lastSnapshotArrival:1600,clock:1600,nowMs:()=>c.clock,serverNow:()=>c.clock,apiRef:{context:()=>({connected:true})},shotContactInsets:new Map(),projectileContactInset,zaps:new Map(),shotPools:new Map([[kind,[pooled]]]),combat:art,scene,shotPlayback,impactFX:fx,shotDirection:new THREE.Vector3(),shotForward:new THREE.Vector3(0,0,1),tmpV:new THREE.Vector3(),dt:.01,t:1,rm:false});
 vm.runInContext(freshness+preparation+';globalThis.render=()=>{'+placement+'};',c);
 bound('classic dropped '+kind,lastVisible(ms=>{c.clock=1600+ms;c.render();fx.update(.01);},()=>[...c.zaps.values()].some(o=>o.visible)));
 c.clock=3000;c.lastSnapshotArrival=3000;c.S={phase:'drive',simAt:3000,zaps:[]};shotPlayback.ingest([],3000);c.render();bound('classic explicit removal '+kind,[...c.zaps.values()].some(o=>o.visible)?Infinity:0);
 art.dispose();fx.dispose();
}
// Classic thrown bodies and their separately pooled warning rings use the
// same production freshness/return path as the live renderer.
const thrown=source.slice(source.indexOf('liveG.clear();'),source.indexOf('liveM.clear();'));
for(const kind of ['nuke','frost']){
 const scene=new THREE.Scene(),art=createKartCombatArt(THREE),fx=createKartImpactFX(THREE,scene),group=new THREE.Group();
 group.userData.body=art.projectile(kind);group.userData.poolKey=kind;group.add(group.userData.body);
 const grenade={id:'g',kind,physical:true,x:0,y:1,z:3,vx:0,vy:0,vz:0,fuse:2,warning:true};
 const c=vm.createContext({liveZ:new Set(),liveG:new Set(),S:{phase:'drive',simAt:1000,grenades:[grenade]},lastSnapshotArrival:1000,clock:1000,nowMs:()=>c.clock,serverNow:()=>c.clock,apiRef:{context:()=>({connected:true})},grenades:new Map(),grenadePools:new Map([[kind,[group]]]),combat:art,scene,impactFX:fx,grenadePose,dt:.01,t:1,rm:false,groundAt:()=>0,takeMarker:()=>{const ring=new THREE.Group();scene.add(ring);return ring;},returnMarker:o=>{o.visible=false;o.removeFromParent();},placeGroundMarker:(o,x,z)=>o.position.set(x,0,z)});
 vm.runInContext(freshness+';globalThis.render=()=>{'+thrown+'};',c);c.render();assert(group.visible,kind+' starts live');
 bound('classic dropped grenade '+kind,lastVisible(ms=>{c.clock=1000+ms;c.render();fx.update(.01);},()=>group.visible||!!group.userData.ring?.visible));
 c.S.grenades=[];c.lastSnapshotArrival=c.clock;c.render();assert(!group.visible&&!group.userData.ring,'body and warning return together');art.dispose();fx.dispose();
}
// The legacy classic KO/blast batch must also clear its draw count, even
// though its buffers retain old transforms for reuse.
{
 const pops=new THREE.InstancedMesh(new THREE.BoxGeometry(.1,.1,.1),new THREE.MeshBasicMaterial(),64),c=vm.createContext({t:1,popSites:[{x:0,y:1,z:0,t:1,kind:'blast'}],pops,sparkMatrix:new THREE.Matrix4()});
 const batch=source.slice(source.indexOf('let popCount=0;'),source.indexOf('for (const [pid, mesh] of karts)',source.indexOf('let popCount=0;')));
 vm.runInContext('globalThis.render=()=>{'+batch+'};',c);c.render();assert.equal(pops.count,8);c.t=1.151;c.render();assert.equal(pops.count,0,'classic expired batch has zero draw instances');pops.geometry.dispose();pops.material.dispose();
}
const r=rig({graphics:true});let s=base();s.simAt=1000;r.render(s);const gl=await r.settle();r.frame();
const liveBodies=()=>gl.built.scene.children.filter(o=>o.visible&&o.userData.poolKey&&/^(shot|grenade|warning|mine):/.test(o.userData.poolKey));
for(const kind of [...kinds,'nuke','frost','mine','oil']){
 const prefix=['nuke','frost'].includes(kind)?'grenades':['mine','oil'].includes(kind)?'mines':'projectiles';s=structuredClone(s);s.simTick++;s.simAt+=1000;
 const item={id:'same-slot',weapon:kind,owner:'a',position:{x:0,y:1,z:3},velocity:{x:0,y:0,z:50},ttl:2,fuse:2,warning:true};s.projectiles=[];s.grenades=[];s.mines=[];s[prefix]=[item];
 s.simAt=r.api.now();r.render(s);r.advance(100);r.frame();const started=r.allocations();
 bound('raised dropped '+kind,100+lastVisible(ms=>{if(ms)r.advance(10);r.frame(.01);},()=>liveBodies().length>0));
 s=structuredClone(s);s.simTick++;s.simAt=r.api.now();r.render(s);r.frame();r.advance(100);r.frame();assert(liveBodies().length,kind+' reuse becomes visible');
 s=structuredClone(s);s.simTick++;s.simAt=r.api.now();s[prefix]=[];r.render(s);r.frame();bound('raised explicit removal '+kind,liveBodies().length?Infinity:0);
 assert.equal(r.allocations().projectiles,started.projectiles,'pool reuse allocates no projectile');
}
for(const weapon of WEAPON_IDS){
 const scene=new THREE.Scene(),art=createKartCombatArt(THREE),fx=createKartImpactFX(THREE,scene),arsenal=createArsenalFX(THREE,scene);
 const e={id:weapon,type:'impact',weapon,position:{x:0,y:1,z:2},from:{x:0,y:1,z:1.99},direction:{x:0,y:0,z:1}};fx.emit(e);arsenal.event({...e,type:'blast'});
 bound('impact/blast '+weapon,lastVisible(()=>{fx.update(.01);arsenal.update(.01);},()=>scene.getObjectByName('KartImpactFX').children.some(o=>o.visible)||arsenal.active()));
 fx.reset();arsenal.reset();fx.emit({...e,id:'fire',type:'fire'});arsenal.event({...e,type:'fire'});
 bound('unacknowledged local fire '+weapon,lastVisible(()=>{fx.update(.01);arsenal.update(.01);},()=>scene.getObjectByName('KartImpactFX').children.some(o=>o.visible)||arsenal.active()));
 const body=art.projectile(weapon);scene.add(body);body.visible=true;fx.trail(body,.03);body.visible=false;
 bound('removed trail '+weapon,lastVisible(()=>fx.update(.01),()=>scene.getObjectByName('KartImpactFX').children.some(o=>o.visible)));
 fx.reset();arsenal.reset();fx.emit(e);arsenal.event({...e,type:'blast'});fx.update(30);arsenal.update(30);assert(!arsenal.active()&&scene.getObjectByName('KartImpactFX').children.every(o=>!o.visible),'hidden tab retires '+weapon);
 art.dispose();fx.dispose();arsenal.dispose();
}
// Releasing one pooled body clears only that body's GPU slots.
{
 const scene=new THREE.Scene(),art=createKartCombatArt(THREE),fx=createKartImpactFX(THREE,scene),a=art.projectile('missile'),b=art.projectile('missile');a.visible=b.visible=true;a.position.z=3;b.position.z=9;
 fx.trail(a,.03);fx.trail(b,.03);fx.retire(a);const root=scene.getObjectByName('KartImpactFX');
 const life=root.children[1].geometry.attributes.fxLife.array,origin=root.children[1].geometry.attributes.fxOrigin.array;
 assert.equal(life[1],0,'returned shot zeros its smoke slot');assert(life[5]>0&&origin[5]===9,'other shot smoke remains');fx.retire(b);assert(root.children.every(o=>!o.visible),'last returned shot leaves no live GPU slot');
 fx.emit({type:'fire',weapon:'machinegun',position:{x:0,y:1,z:0}},.12);fx.update(.031);assert(root.children.every(o=>!o.visible),'delayed predicted fire has only its remaining budget');
 const arsenal=createArsenalFX(THREE,scene);arsenal.event({type:'blast',weapon:'thunder',position:{x:0,y:1,z:0}},.12);arsenal.update(.031);assert(!arsenal.active(),'queued bolt/ring/shards keep original event age');const model=new THREE.Group();arsenal.warmStatus(model);arsenal.reset();arsenal.status(model,{bladesT:6,supernovaT:3,rammingT:3,frostT:2},{elapsed:.151});const status=model.userData.arsenalStatus;assert(!status.blades.visible&&!status.nova.visible&&!status.ram.visible&&!status.frost.visible,'stale status snapshot cannot preserve weapon attachments');arsenal.dispose();fx.dispose();art.dispose();
}
const driveScene=new THREE.Scene(),drive=createKartDrivingFX(THREE,driveScene,new THREE.PerspectiveCamera());drive.track('a',0,1,0,0,10,true,2,{kind:'grass',dust:0xffffff});drive.update(30);bound('hidden driving particles',drive.stats().live?30000:0);drive.dispose();// A packet arriving late must not receive a new lease just because its tick advanced.
s=structuredClone(s);s.simTick++;s.simAt=r.api.now();s.projectiles=[{id:'late',weapon:'missile',position:{x:0,y:1,z:3},velocity:{x:0,y:0,z:50},ttl:2}];r.render(s);r.frame();
r.advance(1000);s=structuredClone(s);s.simTick++;s.simAt+=50;r.render(s);r.frame();bound('raised late snapshot',liveBodies().length?Infinity:0);
// Repeated metadata packets and older ticks cannot resurrect a retired mesh.
for(let i=0;i<10;i++){r.advance(20);r.render(structuredClone(s));r.frame();assert.equal(liveBodies().length,0);}
const old=structuredClone(s);old.simTick--;old.simAt-=50;r.render(old);r.frame();assert.equal(liveBodies().length,0);
// Keep receiving events with no render frames while the tab is hidden.
for(const weapon of WEAPON_IDS){
 r.document.hidden=true;r.document.dispatch('visibilitychange');s=structuredClone(s);s.simTick++;s.simAt=r.api.now();s.projectiles=[];s.events=[{id:'hidden-'+weapon,type:'impact',weapon,tick:s.simTick,position:{x:0,y:1,z:2},from:{x:0,y:1,z:1.99}}];r.render(s);r.advance(30000);r.document.hidden=false;r.document.dispatch('visibilitychange');r.frame(.1);
 assert(gl.built.scene.getObjectByName('KartImpactFX').children.every(o=>!o.visible),'hidden event queue does not replay '+weapon);
 assert(gl.built.scene.children.filter(o=>o.name==='CombatConfirmedShot'||o.name==='CombatMuzzleFlash'||o.name==='RaisedCombatParticles').every(o=>!o.visible),'all raised cues/batches retire '+weapon);
}
// Preparation pauses simulation time; starting play establishes a fresh
// clock baseline instead of treating loading time as delayed network traffic.
s=structuredClone(s);s.phase='countdown';s.simTick++;s.simAt=r.api.now();s.events=[];r.render(s);r.frame();r.advance(5000);
s=structuredClone(s);s.phase='live';s.simTick++;s.simAt+=50;s.projectiles=[{id:'after-preparation',weapon:'missile',position:{x:0,y:1,z:3},velocity:{x:0,y:0,z:50},ttl:2}];r.render(s);r.frame();r.advance(100);r.frame();assert(liveBodies().length,'phase change resets the paused simulation clock');
{
 const c=vm.createContext({liveZ:new Set(),liveG:new Set(),S:{phase:'drive',simAt:50},clock:10000,lastSnapshotArrival:10000,nowMs:()=>c.clock,serverNow:()=>10000,apiRef:{context:()=>({connected:true})}});vm.runInContext(freshness+';globalThis.clockForShots=ordnanceNow;',c);assert.equal(c.clockForShots(),50,'classic shot clock resumes from accepted simAt');c.clock+=100;assert.equal(c.clockForShots(),150,'classic shot clock advances with receipt age');
}
r.view.dispose();
console.log(JSON.stringify({pass:!measuring,results,scope:'real Three classic placement, full raised frame, every weapon FX; 10ms resolution'}));
