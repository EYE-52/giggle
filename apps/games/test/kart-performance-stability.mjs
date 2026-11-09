import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {loadSceneryAssets} from './helpers/kart-headless-world.mjs';
import {warmKartRenderer} from '../public/js/engines/kart-render-warmup.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {parseHTML} from 'linkedom';
import {instanceRepeats} from '../public/js/engines/kart-instancing.mjs';
import {createKartPickupPool} from '../public/js/engines/kart-pickup-pool.mjs';
import {setKartText,setKartAttribute,setKartFlag} from '../public/js/engines/kart-hud-write.mjs';
import {createKartWorld} from '../public/js/engines/kart-world.mjs';
import {createKartCombatArt} from '../public/js/engines/kart-combat-art.mjs';
import {prepareGroundProp,placeGroundProp} from '../public/js/engines/kart-ground-markers.mjs';
import maps from '../games/engines/kart-maps.js';
import {createKartLod} from '../public/js/engines/kart-lod.mjs';
import {createKartElevatedWorld} from '../public/js/engines/kart-elevated-world.mjs';
import {elevatedMap,elevatedMapIds} from '../public/js/engines/kart-elevated-maps.mjs';

// A repeated mesh can itself own a unique roof/sign. Hiding it while batching
// only its body makes that roof vanish, even with a perfectly valid sphere.
const root=new THREE.Group(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial(),parents=[];
for(let i=0;i<3;i++){
 const body=new THREE.Mesh(geometry,material),roof=new THREE.Mesh(new THREE.ConeGeometry(1,1,i+3),material);
 body.position.set(i*20-20,0,0);roof.position.y=2;body.add(roof);root.add(body);parents.push(body);
}
const before=[];root.traverseVisible(o=>{if(o.isMesh)before.push(o);});
instanceRepeats(THREE,root);const after=[];root.traverseVisible(o=>{if(o.isMesh)after.push(o);});
assert(before.filter(o=>!parents.includes(o)).every(o=>after.includes(o)),'every unique roof remains visible');
assert.equal(after.find(o=>o.isInstancedMesh)?.count,3,'all parent bodies remain drawn in the batch');
root.updateMatrixWorld(true);
for(let i=0;i<parents.length;i++){const roof=before[i*2+1];assert(Math.abs(roof.getWorldPosition(new THREE.Vector3()).x-(i*20-20))<1e-6,'roof retains its parent transform');}
const moving=new THREE.Group();moving.userData.dynamic=true;root.add(moving);
for(let i=0;i<3;i++)moving.add(new THREE.Mesh(geometry,material));
const layers=new THREE.Group();root.add(layers);
for(let layer=0;layer<2;layer++)for(let i=0;i<3;i++){const mesh=new THREE.Mesh(geometry,material);mesh.layers.set(layer);layers.add(mesh);}
const groups=instanceRepeats(THREE,root);
assert(moving.children.every(o=>o.visible),'dynamic parents exclude their entire subtree');
assert.deepEqual(groups.map(g=>g.mesh.layers.mask).sort(),[1,2],'colour and shadow layers never mix');
const hookRoot=new THREE.Group();for(let i=0;i<3;i++){const m=new THREE.Mesh(geometry,material);m.onAfterRender=()=>{};hookRoot.add(m);}
assert.equal(instanceRepeats(THREE,hookRoot).length,0,'render hooks retain their own draw');

// Hundreds of collections/respawns (new ids) reuse the exact same model trees.
let allocations=0;const pool=createKartPickupPool(()=>{allocations++;const group=new THREE.Group();group.add(new THREE.Mesh(geometry,material));return group;},32);
const reserved=allocations,known=new Set(pool.objects),scene=new THREE.Scene();
for(let cycle=0;cycle<300;cycle++){
 const active=Array.from({length:32},()=>pool.take());assert(active.every(o=>known.has(o)&&o.visible));
 assert.equal(pool.take(),null,'over-capacity snapshots do not allocate or throw in the render loop');
 for(const o of active){scene.add(o);pool.release(o);assert(!o.parent&&!o.visible);}
}
assert.equal(allocations,reserved,'no model allocation after preparation');

const {document}=parseHTML('<div id="hud"></div>'),hud=document.getElementById('hud');
setKartText(hud,'3:00');setKartAttribute(hud,'aria-label','180 seconds remaining');const text=hud.firstChild;
for(let i=0;i<600;i++){setKartText(hud,'3:00');setKartAttribute(hud,'aria-label','180 seconds remaining');}
assert.equal(hud.firstChild,text,'unchanged HUD text keeps the exact same text node');
setKartFlag(hud,'hidden',true);assert(hud.hidden);setKartFlag(hud,'hidden',false);assert(!hud.hidden);
setKartText(hud,0);setKartAttribute(hud,'aria-label','Round complete');assert.equal(hud.textContent,'0');assert.equal(hud.getAttribute('aria-label'),'Round complete');

// Reusing the LOD result must clear dead/near entries; never leave a proxy
// silhouette behind after a knockout or a return to the eight-driver tier.
const lod=createKartLod(THREE,{fullDetail:8,keepNear:3,far:0}),camera=new THREE.PerspectiveCamera(),entries=[];
for(let i=0;i<12;i++){const mesh=new THREE.Mesh(geometry,material);mesh.position.x=i;entries.push({mesh,color:0xffcc88,visible:true});}
const proxied=lod.update(camera,entries);assert.equal(proxied.size,9);assert.equal(lod.object.count,9);
for(const e of entries)e.mesh.visible=true;
assert.equal(lod.update(camera,entries.slice(0,8),8),proxied);assert.equal(proxied.size,0);assert.equal(lod.object.count,0);lod.dispose();

// The combined world bounds must contain every transformed instance, at every
// camera heading, before/after the distance batches compact their matrices.
const assets=await loadSceneryAssets();
const alpineBytes=await fs.readFile(new URL('../public/assets/karts/environment/stylized-alpine.glb',import.meta.url));
assets.stylized=(await new GLTFLoader().parseAsync(alpineBytes.buffer.slice(alpineBytes.byteOffset,alpineBytes.byteOffset+alpineBytes.byteLength),'')).scene;
const bounds=new THREE.Sphere(),matrix=new THREE.Matrix4();let audited=0;
for(const id of elevatedMapIds){
 const world=createKartElevatedWorld(THREE,{scene:new THREE.Scene(),map:elevatedMap(id),assets});
 for(let step=0;step<16;step++){
  const angle=step*Math.PI/8;camera.position.set(Math.sin(angle)*75,8,Math.cos(angle)*75);camera.lookAt(0,3,0);camera.updateMatrixWorld();world.updateDetail(camera,.3);
  world.group.traverseVisible(o=>{if(!o.isInstancedMesh||!o.frustumCulled||!o.count)return;if(!o.boundingSphere)o.computeBoundingSphere();if(!o.geometry.boundingSphere)o.geometry.computeBoundingSphere();
   for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);bounds.copy(o.geometry.boundingSphere).applyMatrix4(matrix);assert(o.boundingSphere.center.distanceTo(bounds.center)+bounds.radius<=o.boundingSphere.radius+.02,id+' correct instance bounds: '+o.name);audited++;}
  });
 }
 world.dispose();
}
// Deduplicating exact ordinary bindings leaves capacity for rare weapons in
// the same preparation budget. Per-instance buffers and distinct flags/materials
// must still be submitted, including both shadow quality modes.
{
 const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
 for(let i=0;i<8;i++)scene.add(new THREE.Mesh(geometry,material));
 const receives=new THREE.Mesh(geometry,material);receives.receiveShadow=true;scene.add(receives);
 const distinct=new THREE.Mesh(geometry,material.clone());scene.add(distinct);
 const a=new THREE.InstancedMesh(geometry,material,8),b=new THREE.InstancedMesh(geometry,material,8);scene.add(a,b);
 const compiled=[];
 const renderer={shadowMap:{enabled:true},async compileAsync(object){compiled.push({object,shadows:this.shadowMap.enabled});},render(){}};
 await warmKartRenderer(THREE,renderer,scene,new THREE.PerspectiveCamera(),{yieldTask:async()=>{}});
 assert.equal(compiled.length,10,'five exact bindings, with both shadow modes');
 for(const object of [receives,distinct,a,b])assert.equal(compiled.filter(c=>c.object===object).length,2,'each distinct material/receive flag/instance buffer warms separately');
 geometry.dispose();material.dispose();distinct.material.dispose();a.dispose();b.dispose();
}

// Warm-up's one-instance draw must never cache a first-house-only sphere.
// Simulate Three's lazy bounds evaluation during that exact temporary draw.
{
 const scene=new THREE.Scene(),instances=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),2),matrix=new THREE.Matrix4();
 instances.setMatrixAt(0,matrix.makeTranslation(-80,0,0));instances.setMatrixAt(1,matrix.makeTranslation(80,0,0));scene.add(instances);
 const renderer={async compileAsync(){},render(s){s.traverseVisible(o=>{if(o.isInstancedMesh&&!o.boundingSphere)o.computeBoundingSphere();});}};
 await warmKartRenderer(THREE,renderer,scene,new THREE.PerspectiveCamera(),{yieldTask:async()=>{}});
 assert.equal(instances.count,2);assert(instances.boundingSphere.containsPoint(new THREE.Vector3(80,0,0))&&instances.boundingSphere.containsPoint(new THREE.Vector3(-80,0,0)),'both remote buildings retain full batch bounds after warm-up');
 instances.geometry.dispose();instances.material.dispose();instances.dispose();
}

// The final, short upload batch also gets a fence before readiness.
{
 const scene=new THREE.Scene(),geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial();
 for(let i=0;i<19;i++)scene.add(new THREE.InstancedMesh(geometry,material,1));
 let uploads=0;const fenced=[];
 const gl={SYNC_GPU_COMMANDS_COMPLETE:1,TIMEOUT_EXPIRED:2,fenceSync(){fenced.push(uploads);return{};},flush(){},clientWaitSync:()=>3,deleteSync(){}};
 const renderer={async compileAsync(){},render(){uploads++;},getContext:()=>gl};
 await warmKartRenderer(THREE,renderer,scene,new THREE.PerspectiveCamera(),{yieldTask:async()=>{}});
 assert.deepEqual(fenced,[16,19],'the final fence covers every submitted instance buffer');
 for(const child of scene.children)child.dispose();geometry.dispose();material.dispose();
}

// A GPU fence completes on a later task. An immediately resolved scheduler
// yield must not turn its poll into a microtask spin that burns the budget.
{
 const scene=new THREE.Scene();scene.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()));
 let ready=false,polls=0;
 const gl={SYNC_GPU_COMMANDS_COMPLETE:1,TIMEOUT_EXPIRED:2,fenceSync:()=>({}),flush(){setTimeout(()=>{ready=true;},10);},clientWaitSync(){polls++;assert(polls<50,'fence polls give the GPU a real turn');return ready?3:2;},deleteSync(){}};
 const renderer={async compileAsync(){},render(){},getContext:()=>gl};
 const result=await warmKartRenderer(THREE,renderer,scene,new THREE.PerspectiveCamera(),{budgetMs:500,yieldTask:async()=>{}});
 assert(!result.skipped&&polls<10,'a delayed GPU fence completes without skipping preparation');
}

// Real moving trap art on real flat terrain: conservative skin bounds avoid
// rescanning every vertex during a drop, without putting its base in paint.
const queryCounts=[];
for(const id of maps.mapIds()){
 const map={id,...maps.mapDef(id)},world=createKartWorld(THREE,{scene:new THREE.Scene(),map});world.syncMap(map);
 const art=createKartCombatArt(THREE),trap=new THREE.Group();trap.add(art.mine(true));prepareGroundProp(THREE,trap);
 let calls=0,flatCalls=0;const support=(x,z)=>{calls++;return world.propGroundAt(x,z);};
 placeGroundProp(THREE,trap,.001,0,0,world.groundAt,support);const beforeCalls=calls;calls=0;
 support.flatSupport=(...args)=>{flatCalls++;return world.propGroundAt.flatSupport(...args);};
 for(let i=1;i<=60;i++)placeGroundProp(THREE,trap,i*.002,0,0,world.groundAt,support);
 assert.equal(calls,0,id+' flat trap motion performs no per-vertex floor queries');
 assert.equal(flatCalls,60,id+' one bounded patch query per horizontal move');
 const prepared=flatCalls;
 for(let i=1;i<=60;i++)placeGroundProp(THREE,trap,.12,i*.001,0,world.groundAt,support);
 assert.equal(flatCalls,prepared,id+' vertical drop reuses its ground fit');
 assert(trap.position.y>=.035,id+' trap never enters the ground');
 queryCounts.push({id,beforeQueriesPerMove:beforeCalls,afterQueriesPerMove:calls,patchQueriesPerMove:1});
 world.dispose();art.dispose();
}
console.log(JSON.stringify({groundFit:queryCounts}));
const classic=await fs.readFile(new URL('../public/js/engines/kart-view.js',import.meta.url),'utf8');
const live=classic.slice(classic.indexOf('const frame = (dt, t) =>'),classic.indexOf('return { scene, camera, frame'));
assert(!live.includes('createStarModel(')&&!live.includes('combat.pickup('),'classic respawns cannot clone authored pickup trees');
console.log('KART_PERFORMANCE_STABILITY_PASS: nested buildings/layers/hooks, 9600 pickup respawns, HUD node identity, LOD retirement, '+audited+' raised instance bounds');
