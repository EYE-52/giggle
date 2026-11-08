// Real shipping geometry/materials. Renderer double checks upload coverage;
// the browser fixture separately checks real GL calls and first-use frames.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {MeshoptDecoder,buildKartDriverVariants,KART_DRIVERS} from '../public/js/engines/kart-assets.mjs';
import {createKartCombatArt} from '../public/js/engines/kart-combat-art.mjs';
import {WEAPON_IDS} from '../public/js/engines/kart-weapon-contract.mjs';
import {createArsenalFX} from '../public/js/engines/kart-arsenal-fx.mjs';
import {createKartImpactFX} from '../public/js/engines/kart-impact-fx.mjs';
import {createKartModel,animateKartModel} from '../public/js/engines/kart-model.mjs';
import {createKartWarmupLibrary,warmKartRenderer} from '../public/js/engines/kart-render-warmup.mjs';
import {createKartLod} from '../public/js/engines/kart-lod.mjs';
import {prepareKartPass} from '../public/js/engines/kart-shader-warmup.mjs';
import {createKartLighting} from '../public/js/engines/kart-lighting.mjs';
let checks=0;const ok=(v,m)=>{assert.ok(v,m);checks++;};
globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});await MeshoptDecoder.ready;
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder),assets={};
async function load(file){const b=await fs.readFile(new URL('../public/assets/karts/'+file+'.glb',import.meta.url));return(await loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'')).scene;}
for(const [key,file]of Object.entries({kart:'giggle-kart.meshopt',star:'giggle-star',crate:'giggle-crate.meshopt',combat:'combat/combat.meshopt',pulse:'combat/pulse-mounted.meshopt',arsenal:'combat/arsenal-mounted.meshopt',secondary:'combat/arsenal-secondary.meshopt'}))assets[key]=await load(file);
assets.kartVariants=buildKartDriverVariants(THREE,assets.kart,await Promise.all(KART_DRIVERS.map(id=>load('drivers/'+id))),mergeGeometries);
const get=name=>assets.pulse.getObjectByName(name)||assets.arsenal.getObjectByName(name)||(name!=='ScatterShot'&&assets.secondary.getObjectByName(name))||assets.combat.getObjectByName(name);
const signature=(o,m)=>[m.type,m.customProgramCacheKey(),o.isInstancedMesh===true,!!o.instanceColor,o.isSprite===true,o.receiveShadow,!!o.geometry?.attributes.color].join('|');
function stats(root){let draws=0,triangles=0;root.traverseVisible(o=>{if(!o.isMesh&&!o.isSprite)return;const g=o.geometry,n=o.isInstancedMesh?o.count:g?.isInstancedBufferGeometry?g.instanceCount:1;if(!n||g?.drawRange.count===0)return;draws++;triangles+=(g?(g.index?.count??g.attributes.position?.count??0)/3:2)*n;});return{draws,triangles};}
for(const fallback of [false,true]){
  let materialAllocations=0;const tracked={...THREE};
  for(const name of Object.keys(THREE).filter(n=>n.endsWith('Material')&&typeof THREE[n]==='function'))tracked[name]=class extends THREE[name]{constructor(...a){super(...a);materialAllocations++;}};
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(),combat=createKartCombatArt(tracked,{assets:fallback?null:{get},pickupAsset:fallback?null:assets.crate});
  const fx=createArsenalFX(tracked,scene),impact=createKartImpactFX(tracked,scene),reserve=new THREE.Group();scene.add(reserve);reserve.visible=false;
  const shots=['machinegun','trishot','missile','cannon','nuke','boomerang','frost','cluster','bomblet','proximity'];
  for(const kind of WEAPON_IDS)reserve.add(combat.weapon(kind));
  for(const kind of shots)reserve.add(combat.projectile(kind));
  for(const own of [true,false])reserve.add(combat.mine(own),combat.mine(own,'oil'));
  const model=createKartModel(tracked,{assets,color:0xe06f4d,driver:'fox'});reserve.add(model);fx.warmStatus(model);fx.reset();
  const library=createKartWarmupLibrary(tracked,scene,assets,combat);
  const zero=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),16);zero.count=0;zero.visible=false;scene.add(zero);
  const lod=createKartLod(tracked);scene.add(lod.object);const lodColors=lod.object.instanceColor;
  ok(lodColors?.count===32,'distant-driver colour buffer exists before shader preparation');
  const range=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());range.geometry.setDrawRange(0,0);range.visible=false;reserve.add(range);
  const compiled=new Set(),uploaded=new Set(),buffers=new Set(),textures=new Set();let renders=0,compiles=0,waits=0,deleted=0,viewport=new THREE.Vector4(0,0,800,600),scissor=viewport.clone(),scissorTest=false;
  const renderer={
    initTexture:t=>textures.add(t),getViewport:v=>v.copy(viewport),getScissor:v=>v.copy(scissor),getScissorTest:()=>scissorTest,setViewport:(...a)=>{a.length===1?viewport.copy(a[0]):viewport.set(...a);},setScissor:(...a)=>{a.length===1?scissor.copy(a[0]):scissor.set(...a);},setScissorTest:v=>{scissorTest=v;},
    async compileAsync(s,c){assert.equal(s,scene);assert.equal(c,camera);s.traverse(o=>{for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)compiled.add(signature(o,m));});compiles++;},
    render(s){renders++;ok(viewport.z===16&&viewport.w===16&&scissorTest,'uploads use a tiny viewport with the actual output target/program variants');s.traverseVisible(o=>{if(!o.geometry||o.isInstancedMesh&&o.count===0||o.geometry.drawRange.count===0)return;uploaded.add(o.geometry);if(o.instanceMatrix)buffers.add(o.instanceMatrix);});},
    getContext:()=>({SYNC_GPU_COMMANDS_COMPLETE:1,WAIT_FAILED:2,TIMEOUT_EXPIRED:3,fenceSync:()=>({}),flush(){},clientWaitSync(){return ++waits===1?3:4;},deleteSync(){deleted++;}}),
  };
  const before=stats(scene),nodes=[];scene.traverse(o=>nodes.push([o,o.visible,o.frustumCulled]));
  await warmKartRenderer(tracked,renderer,scene,camera,{roots:[reserve,library,...fx.objects(),scene.getObjectByName('KartImpactFX'),zero,lod.object]});
  ok(compiles===1&&renders===1&&waits===2&&deleted===1,'one compile/upload and completed GPU fence before readiness');
  ok(viewport.z===800&&viewport.w===600&&scissor.z===800&&!scissorTest,'viewport and scissor restored');
  assert.deepEqual(stats(scene),before,'warmup adds no gameplay draws or triangles');checks++;
  for(const [o,visible,culled]of nodes){assert.equal(o.visible,visible);assert.equal(o.frustumCulled,culled);}
  ok(zero.count===0&&buffers.has(zero.instanceMatrix)&&uploaded.has(range.geometry)&&range.geometry.drawRange.count===0,'inactive counts/ranges upload and restore');
  ok(lod.object.instanceColor===lodColors&&buffers.has(lod.object.instanceMatrix),'distant drivers retain prepared colour and matrix buffers');
  function covered(root){root.traverseVisible(o=>{if(!o.geometry)return;ok(uploaded.has(o.geometry),'first use geometry was uploaded: '+o.name);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){ok(compiled.has(signature(o,m)),'first use program variant was compiled: '+o.name);for(const value of Object.values(m))if(value?.isTexture)ok(textures.has(value),'first use texture was initialized: '+o.name);}});}
  const allocated=materialAllocations,clone=THREE.Material.prototype.clone;let materialClones=0;
  THREE.Material.prototype.clone=function(){materialClones++;return clone.call(this);};
  try{
    for(const kind of WEAPON_IDS){
      covered(combat.weapon(kind));if(shots.includes(kind))covered(combat.projectile(kind));
      fx.event({id:kind,type:'fire',weapon:kind,position:{x:0,y:1,z:0},direction:{x:0,y:0,z:1}});
      fx.event({id:kind+'-blast',type:'blast',weapon:kind,position:{x:0,y:1,z:0}});
      impact.emit({id:kind,type:'impact',weapon:kind,pid:'a',position:{x:0,y:1,z:0}});
    }
    covered(combat.pickup());covered(combat.mine(false));covered(combat.mine(true,'oil'));
    fx.status(model,{rammingT:1,frostT:1,spinT:1,bladesT:1,supernovaT:1});
    animateKartModel(model,{boost:true,shield:true,invincible:true,speed:10});covered(model);
    ok(materialAllocations===allocated&&materialClones===0,'first use of every weapon, explosion, status and pickup constructs or clones no Material');
  }finally{THREE.Material.prototype.clone=clone;}
  for(const driver of KART_DRIVERS)covered(createKartModel(tracked,{assets,driver,color:0x75c5da}));
  combat.dispose();fx.dispose();impact.dispose();
}
// Compile the exact internal shadow variants, not just scene materials. Three
// shares its depth material between ordinary and instanced/coloured meshes.
{
  const scene=new THREE.Scene(),camera=new THREE.Camera(),sun=new THREE.DirectionalLight();sun.castShadow=true;scene.add(sun);
  const material=new THREE.MeshStandardMaterial(),depth=new THREE.MeshDepthMaterial();
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),material),instances=new THREE.InstancedMesh(mesh.geometry,material,2);
  instances.setColorAt(0,new THREE.Color());mesh.castShadow=instances.castShadow=true;scene.add(mesh,instances);
  mesh.add(new THREE.Mesh(mesh.geometry,material));
  const children=mesh.children,programs=[],prepared=new Set();let polls=0,draws=0;
  const renderer={shadowMap:{enabled:true,needsUpdate:false},info:{programs},
    compile(object,c,target){
      assert.equal(c,camera);ok(object.children.length===0,'shadow submission compiles only this object');
      ok(object.material===depth&&!target.environment,'exact depth material with an empty shadow scene');
      prepared.add(signature(object,depth));programs.push({reflected:false,isReady:()=>++polls>programs.length,getUniforms(){ok(polls>programs.length,'uniform tables initialize after linking');this.reflected=true;},getAttributes(){ok(this.reflected,'attribute tables initialize during loading');}});
    },
    async compileAsync(){},
    renderBufferDirect(c,s,g,m,o){ok(prepared.has(signature(o,m)),'shadow draw uses an already prepared variant');ok(programs.every(p=>p.reflected),'all shared-material variants and uniform tables finish before drawing');draws++;},
    render(){if(this.shadowMap.enabled)for(const o of [mesh,instances])this.renderBufferDirect(camera,null,o.geometry,depth,o);},
  };
  const direct=renderer.renderBufferDirect;
  await warmKartRenderer(THREE,renderer,scene,camera);
  ok(draws===2&&prepared.size===2,'warm render uploads ordinary and instanced/coloured depth variants');
  ok(mesh.material===material&&mesh.children===children&&renderer.renderBufferDirect===direct,'temporary render method, material and children restore');
  ok(!renderer.shadowMap.needsUpdate&&!sun.shadow.needsUpdate,'shadow update policy restores');
  material.dispose();depth.dispose();mesh.geometry.dispose();
}
// Loading cancellation and thrown compilation must not leave patched methods
// or leak the temporary PMREM target, even before its first real draw.
for(const fail of ['compile','retired']){
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial()),children=mesh.children,material=mesh.material;
  const direct=()=>{},renderer={renderBufferDirect:direct,compile(){if(fail==='compile')throw Error('compile failed');}};
  let retired=0;
  await assert.rejects(prepareKartPass(THREE,renderer,()=>{
    renderer.renderBufferDirect(new THREE.Camera(),null,mesh.geometry,new THREE.MeshDepthMaterial(),mesh);
    return{dispose(){retired++;}};
  },{isAlive:()=>fail!=='retired'}),/compile failed|Retired/);
  ok(renderer.renderBufferDirect===direct&&mesh.material===material&&mesh.children===children,'failed pass restores object and renderer');
  ok(retired===(fail==='retired'?1:0),'cancelled pass releases its staging target');
}
// Reflections are awaited during loading. Capture/blur shaders must be ready
// before the real PMREM pass, and disposal while waiting must prevent that pass.
for(const cancel of [false,true]){
  let passes=0,draws=0,targetsRetired=0,generatorRetired=0;
  const scene=new THREE.Scene(),renderer={shadowMap:{},info:{programs:[{isReady:()=>true}]},
    compile(){},renderBufferDirect(){draws++;},
  };
  const measured={...THREE,PMREMGenerator:class{
    fromScene(capture){passes++;const object=capture.children[0];renderer.renderBufferDirect(new THREE.Camera(),capture,object.geometry,object.material,object);return{texture:new THREE.Texture(),dispose(){targetsRetired++;}};}
    dispose(){generatorRetired++;}
  }};
  const lighting=createKartLighting(measured,renderer,scene,{});
  ok(!scene.environment&&draws===0,'reflection program submission does not draw or expose an unfinished target');
  if(cancel)lighting();await lighting.ready;
  ok(passes===(cancel?1:2)&&draws===(cancel?0:1),'real reflection capture waits and skips retired scenes');
  lighting();ok(targetsRetired===(cancel?1:2)&&generatorRetired===1,'reflection targets and generator retire once');
}
// Failure and retirement must restore all state and never render a stale scene.
for(const fail of ['compile','retired','fence']){
  const scene=new THREE.Scene(),mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),4);scene.add(mesh);mesh.visible=false;mesh.count=0;
  let alive=true,rendered=0;
  const renderer={async compileAsync(){if(fail==='compile')throw Error('compile failed');if(fail==='retired')alive=false;},render(){rendered++;},getContext:()=>({fenceSync:()=>null})};
  await assert.rejects(warmKartRenderer(THREE,renderer,scene,new THREE.Camera(),{roots:[mesh],isAlive:()=>alive}),/failed|Retired/);
  ok(!mesh.visible&&mesh.count===0,'failure restores visibility and capacity: '+fail);
  ok(rendered===(fail==='fence'?1:0),'failed/retired compile never renders');
}
console.log(JSON.stringify({pass:true,checks,scope:'Shipping GLBs and fallback, all 13 weapons, first-use material/texture/geometry coverage, every driver, unchanged draws/triangles and loading lifecycle; real WebGL checked separately.'}));

// Quality switches must select cached, reflected shaders, including materials
// that are not visible until the first weapon/status use.
{
 const scene=new THREE.Scene(),camera=new THREE.Camera(),material=new THREE.MeshStandardMaterial(),mesh=new THREE.Mesh(new THREE.BoxGeometry(),material);scene.add(mesh);
 const modes=[],ready=new Set();let current;const programs=[];
 const renderer={shadowMap:{enabled:true},info:{programs},async compileAsync(){current=this.shadowMap.enabled;const key=String(current);modes.push(current);programs.push({isReady:()=>true,getUniforms(){ready.add(key);},getAttributes(){}});},render(){ok(ready.has(String(this.shadowMap.enabled)),'both quality variants reflect during loading before drawing');}};
 await warmKartRenderer(THREE,renderer,scene,camera);
 assert.deepEqual(modes,[false,true],'no-shadow then normal shader variants prepare before Ready');
 ok(renderer.shadowMap.enabled&&ready.has('false')&&ready.has('true'),'original quality restores and adaptive shader is already cached');
 material.dispose();mesh.geometry.dispose();
}
