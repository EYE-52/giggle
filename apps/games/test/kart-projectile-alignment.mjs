// Exact shipping/fallback art, production movingItems, actual map colliders,
// and legally collected authority shots through the production packet adapter.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
import {createKartCombatArt,projectileContactInset} from '../public/js/engines/kart-combat-art.mjs';
import {createKartPhysics} from '../public/js/engines/kart-physics-core.mjs';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import {elevatedMap,elevatedMapIds} from '../public/js/engines/kart-elevated-maps.mjs';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import SHARED from '../games/engines/kart-combat-config.js';
import ADAPTER from '../games/engines/kart-elevated-adapter.js';
await Promise.all([RAPIER.init(),MeshoptDecoder.ready]);
const radii=COMBAT.staticSweepRadii,kinds=Object.keys(radii),measurements=[],results=[];
const check=(label,ok)=>{assert.ok(ok,label);results.push(label);};
assert.deepEqual(radii,{pulse:.22,scatter:.25,rocket:.42,seeker:.33,rail:.18,sentry:.18});
assert(Object.isFrozen(radii));
assert.strictEqual(radii,SHARED.config.staticSweepRadii);
// Embedded image dimensions stand in for the decoder; this is geometry QA.
globalThis.self=globalThis;
globalThis.createImageBitmap=async blob=>{const b=Buffer.from(await blob.arrayBuffer());return {width:b.readUInt32BE(16),height:b.readUInt32BE(20),close(){}};};
const libs={};
for(const [key,file]of Object.entries({combat:'combat',pulse:'pulse-mounted',arsenal:'arsenal-mounted',secondary:'arsenal-secondary'})){
 const b=fs.readFileSync(new URL('../public/assets/karts/combat/'+file+'.meshopt.glb',import.meta.url));
 libs[key]=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;
}
const get=name=>libs.pulse.getObjectByName(name)||libs.arsenal.getObjectByName(name)||(name!=='ScatterShot'&&libs.secondary.getObjectByName(name))||libs.combat.getObjectByName(name);
const source=fs.readFileSync(new URL('../public/js/engines/kart-elevated-view.js',import.meta.url),'utf8');
const moving=source.slice(source.indexOf('function movingItems('),source.indexOf("helper.canvas().setAttribute('aria-hidden'"));
const point=new THREE.Vector3();
function vertices(object,visit){object.updateMatrixWorld(true);object.traverse(o=>{if(!o.isMesh)return;const a=o.geometry.attributes.position;for(let i=0;i<a.count;i++)visit(point.fromBufferAttribute(a,i).applyMatrix4(o.matrixWorld));});}
for(const [tag,assets]of [['shipping',{get}],['fallback',null]]){
 const art=createKartCombatArt(THREE,{assets}),shots=new Map(kinds.map(kind=>[kind,art.projectile(kind)]));
 try{
  for(const [kind,object]of shots){object.userData.combat.contactRadius=radii[kind];object.userData.combat.contactInset=projectileContactInset(THREE,object,radii[kind]);}
  for(const [kind,object]of shots){let envelope=0;const initialScale=object.scale.clone(),buffers=[];object.traverse(o=>{if(o.isMesh)buffers.push(o.geometry.attributes.position.array);});
   for(const reduced of [false,true])for(let i=0;i<180;i++){art.animate(object,1/60,i/60,reduced);vertices(object,p=>{envelope=Math.max(envelope,Math.hypot(p.x,p.y));});}
   // Analytic maximum tracer pulse supplements sampled animation extrema.
   const tail=object.userData.combat.tail;if(tail)tail.scale.set(1.12,1.12,1.08);
   vertices(object,p=>{envelope=Math.max(envelope,Math.hypot(p.x,p.y));});
   check(tag+' '+kind+' static radius encloses all rolled vertices with .02m clearance',radii[kind]>=envelope+.02);
   check(tag+' '+kind+' approved asset scale is retained',object.scale.equals(initialScale));
   const after=[];object.traverse(o=>{if(o.isMesh)after.push(o.geometry.attributes.position.array);});assert.deepEqual(after,buffers);
   for(let i=0;i<after.length;i++)assert.strictEqual(after[i],buffers[i],'source vertex buffer identity is retained');
   // Independent geometric proof: the forward hemisphere lies inside the
   // sphere; every trailing vertex fits its lateral cylinder. This implies
   // separation from every approaching half-space, including grazing planes.
   let forwardExcess=-Infinity,trailingExcess=-Infinity;
   vertices(object,p=>{const axial=p.z+radii[kind]-object.userData.combat.tipZ-object.userData.combat.contactInset;
    if(axial>=0)forwardExcess=Math.max(forwardExcess,Math.hypot(p.x,p.y,axial)-radii[kind]);
    else trailingExcess=Math.max(trailingExcess,Math.hypot(p.x,p.y)-radii[kind]);});
   check(tag+' '+kind+' entire forward skin fits authority sphere',forwardExcess<0);
   check(tag+' '+kind+' trailing skin fits lateral authority envelope',trailingExcess<0);
   measurements.push({tag,kind,envelope,radius:radii[kind],inset:object.userData.combat.contactInset,forwardExcess,trailingExcess});
   const invalid=art.projectile(kind);try{assert.throws(()=>projectileContactInset(THREE,invalid,envelope-.001),/exceeds authoritative sweep radius/,'undersized authority radius is a hard failure');}finally{invalid.removeFromParent();}
  }
  for(const mapId of elevatedMapIds){const map=elevatedMap(mapId),physics=createKartPhysics(RAPIER,CONFIG);for(const d of map.colliders)physics.addStatic(d);
   try{const wall=map.colliders.find(d=>d.id==='north-boundary'),face=wall.position.z-wall.half.z;
    for(const [kind,object]of shots){const radius=radii[kind],x=-map.half+6,z=-map.half+6;
     const paths=[{name:'wall',surface:'north-boundary',from:{x:0,y:2,z:face-3},to:{x:0,y:2,z:face+1},axis:new THREE.Vector3(0,0,1),beforeVelocity:{x:15,y:0,z:60},velocity:{x:-15,y:0,z:60}},
      {name:'downward-floor',surface:'floor',from:{x,y:3,z},to:{x,y:-1,z},axis:new THREE.Vector3(0,-1,0),beforeVelocity:{x:15,y:-60,z:0},velocity:{x:-15,y:-60,z:0}},
      {name:'horizontal-floor',surface:'floor',from:{x,y:3,z},to:{x,y:-1,z},axis:new THREE.Vector3(0,-1,0),beforeVelocity:{x:15,y:0,z:60},velocity:{x:-15,y:0,z:60}},
      {name:'grazing-wall',surface:'north-boundary',from:{x:0,y:2,z:face-3},to:{x:0,y:2,z:face+1},axis:new THREE.Vector3(0,0,1),beforeVelocity:{x:60,y:5,z:5},velocity:{x:60,y:-5,z:5}},
      {name:'grazing-floor',surface:'floor',from:{x,y:3,z},to:{x,y:-1,z},axis:new THREE.Vector3(0,-1,0),beforeVelocity:{x:60,y:-5,z:5},velocity:{x:60,y:-5,z:-5}}];
     for(const path of paths){const hit=physics.sweepStatic(path.from,path.to,radius);assert(hit);assert.equal(hit.surfaceId,path.surface);
      const beforePosition=new THREE.Vector3().copy(hit.point).addScaledVector(path.axis,-.2),position=new THREE.Vector3().copy(hit.point).addScaledVector(path.axis,-.005);
      const before={id:'a',weapon:kind,position:beforePosition,velocity:path.beforeVelocity,radius},current={id:'a',weapon:kind,position,velocity:path.velocity,radius};
      const objects=new Map([['shot:a',object]]),context=vm.createContext({objects,direction:new THREE.Vector3(),nose:new THREE.Vector3()});vm.runInContext(moving+';globalThis.move=movingItems;',context);
      for(const alpha of [0,.5,1])for(const reduced of [false,true]){
       context.move([current],'shot:',[before],[current],alpha);art.animate(object,1/60,alpha+2,reduced);
       const center=new THREE.Vector3().lerpVectors(beforePosition,position,alpha),direction=new THREE.Vector3().lerpVectors(path.beforeVelocity,path.velocity,alpha).normalize();
       assert.equal(physics.sweepStatic(path.from,center,radius),null,'accepted pre-impact sphere path stays clear');
       const nose=object.localToWorld(new THREE.Vector3(0,0,object.userData.combat.tipZ));
       check(tag+' '+mapId+' '+kind+' '+path.name+' alpha'+alpha+' reduced'+reduced+' actual nose equals calibrated interpolated sphere front',nose.distanceTo(center.clone().addScaledVector(direction,radius-object.userData.combat.contactInset))<1e-5);
       let limit=-Infinity;vertices(object,p=>{limit=Math.max(limit,path.surface==='north-boundary'?p.z-face:-p.y);});
       check(tag+' '+mapId+' '+kind+' '+path.name+' alpha'+alpha+' reduced'+reduced+' all visible geometry stays outside solid (penetration '+limit+')',limit<=1e-5);
       // Independently cast along the actual interpolated flight heading and
       // render just before THAT Rapier contact, including grazing paths.
       const approach=direction.dot(path.axis);
       if(approach>0){
        const contact=physics.sweepStatic(center.clone().addScaledVector(direction,-.25/approach),center.clone().addScaledVector(direction,.25/approach),radius);
        check(tag+' '+mapId+' '+kind+' '+path.name+' actual flight-heading sweep reaches the intended solid',contact?.surfaceId===path.surface);
        const accepted=new THREE.Vector3().copy(contact.point).addScaledVector(direction,-.005),flight={...current,position:accepted,velocity:direction};
        context.move([flight],'shot:',null,[flight],1);art.animate(object,1/60,alpha+2,reduced);
        let flightLimit=-Infinity;vertices(object,p=>{flightLimit=Math.max(flightLimit,path.surface==='north-boundary'?p.z-face:-p.y);});
        check(tag+' '+mapId+' '+kind+' '+path.name+' alpha'+alpha+' reduced'+reduced+' whole actual-flight mesh clears solid (penetration '+flightLimit+')',flightLimit<=1e-5);
       }
      }
      const packet=JSON.stringify(current);context.move([current],'shot:',null,[current],1);assert.equal(JSON.stringify(current),packet,'presentation never mutates authority packet');
     }
    }
   }finally{physics.dispose();}
  }
  const object=shots.get('rocket'),context=vm.createContext({objects:new Map([['shot:a',object],['grenade:a',object]]),direction:new THREE.Vector3(),nose:new THREE.Vector3()});vm.runInContext(moving+';globalThis.move=movingItems;',context);
  const legacy={id:'a',position:{x:2,y:3,z:4},velocity:{x:0,y:0,z:10}};context.move([legacy],'shot:',null,[legacy],1);object.updateMatrixWorld(true);
  check(tag+' missing radius uses backward-compatible .18 sphere front',Math.abs(object.localToWorld(new THREE.Vector3(0,0,object.userData.combat.tipZ)).z-4.18)<1e-6);
  context.move([legacy],'grenade:',null,[legacy],1);check(tag+' canister center is not shifted by the shot presentation contract',object.position.equals(new THREE.Vector3(2,3,4)));
 }finally{art.dispose();}
}

// Real collection, receipt-scoped input, fixed steps, public adapter packets
// and unchanged damage. Diagnostic lane setup introduces no grant/hit hooks.
const floor={id:'floor',shape:'box',half:{x:60,y:1,z:60},position:{x:0,y:-1,z:0}};
const seat=(id,x,z,angle=0)=>({id,x,y:0,z,angle,surface:'floor'});
const maps=Object.fromEntries(elevatedMapIds.map(id=>[id,elevatedMap(id)]));
const map={...maps.garden,colliders:[floor],spawns:[seat('a',0,0),seat('b',0,25,Math.PI)],sockets:[seat('s0',-.7,0),seat('s1',.7,0)]};
const step=match=>match.advance(match.snapshot().serverAt+CONFIG.fixedDt*1000);
function send(match,use){const own=match.snapshot('a').you;assert(match.input('a',{instance:match.snapshot().instance,life:own.life,controlEpoch:own.controlEpoch,seq:own.receivedSeq+1,steer:0,throttle:0,brake:0,nitro:false,use},match.snapshot().serverAt).ok);}
for(const kind of kinds){let match,adapter,state;
 for(let seed=0;seed<256;seed++){const candidate=COMBAT.createElevatedCombat(RAPIER,CONFIG,map,[{id:'a'},{id:'b'}],{instance:'radius-'+kind,seed,startAt:0,countdownMs:0,roundMs:20000,crates:1});step(candidate);if(candidate.snapshot().karts[0].weapon===kind){match=candidate;break;}candidate.dispose();}
 assert(match,'bounded real '+kind+' crate acquisition');
 try{for(let i=0;i<160;i++)step(match);send(match,true);send(match,false);step(match);
  // Deployed sentries retain their .4s first-fire delay.
  for(let i=0;i<60&&!match.snapshot().projectiles.some(p=>p.weapon===kind);i++)step(match);
  const raw=match.snapshot(),shot=raw.projectiles.find(p=>p.weapon===kind);assert(shot,kind+' live legitimate launch');assert.equal(shot.radius,radii[kind]);
  adapter=ADAPTER.createElevatedKartAdapter({RAPIER,config:CONFIG,maps:{...maps,garden:map},defaults:{mode:'Zap Battle',winRule:'Time limit',garage:false,map:map.name,roundSeconds:20},createMatch:()=>match});
  state=adapter.create({settings:()=>({}),instanceId:raw.instance,now:()=>raw.serverAt,allPlayers:()=>[{id:'a'},{id:'b'}]});
  const publicView=adapter.viewForTransport(state,'a'),packet=publicView.projectiles.find(p=>p.id===shot.id);check(kind+' public packet preserves exact authoritative static radius',packet.radius===shot.radius&&packet.radius===radii[kind]);assert(Object.isFrozen(packet));
  assert.deepEqual(publicView.projectileRadii,radii);assert(Object.isFrozen(publicView.projectileRadii));
  let impact;for(let i=0;i<120&&!impact;i++){step(match);impact=match.snapshot().events.find(e=>e.type==='impact'&&e.weapon===kind&&e.other==='b');}
  assert(impact,kind+' legitimate first-hull impact');const victim=match.snapshot().karts.find(k=>k.id==='b');
  const health={pulse:90,scatter:91,rocket:0,seeker:0,rail:75,sentry:87};
  check(kind+' larger static envelope retains established target damage',victim.health===health[kind]);
  if(['pulse','scatter','rail','sentry'].includes(kind))check(kind+' confirmed event retains exact sweep endpoints',impact.from&&Object.values(impact.from).every(Number.isFinite)&&Object.values(impact.position).every(Number.isFinite));
 }finally{if(adapter&&state)adapter.dispose(state);else match.dispose();}
}
console.log(JSON.stringify({pass:true,checks:results.length,measurements,scope:'Exact production movingItems and shipping/fallback meshes, real Rapier solids in all four maps, legal authority collection/fire and exact adapter radii. No GPU/phone/FPS claim.'}));
