import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;
/* Load the shipped GLBs with the real Three.js loader, then validate the
 * runtime contract: embedded assets, bounded geometry, ground origin,
 * wheel pivots and +Z nose. Browser screenshots cover texture appearance. */
import assert from 'node:assert/strict';
import {KART_R} from '../public/js/engines/kart-pose.mjs';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {batchKartBody} from '../public/js/engines/kart-batching.mjs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {KART_ASSETS} from '../public/js/engines/kart-assets.mjs';
import {createKartWorld,resolveHalf,resolveBound} from '../public/js/engines/kart-world.mjs';
import {createKartLighting,resolveLightingHalf} from '../public/js/engines/kart-lighting.mjs';
import kartMaps from '../games/engines/kart-maps.js';
import {createKartModel,animateKartModel,createStarModel,createCrateModel} from '../public/js/engines/kart-model.mjs';
// Node has no image decoder; keep actual loader/geometry/material parsing.
// Embedded PNGs are decoded and visually checked by the browser playtest.
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({width:1,height:1,close(){}});
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), assets={};
let totalBytes=0, totalTriangles=0;
for (const [key,name] of Object.entries(KART_ASSETS)) {
 const bytes=await fs.readFile(new URL('../public/assets/karts/'+name+'.glb',import.meta.url));
 assert.equal(bytes.readUInt32LE(0),0x46546c67,name+' GLB header');
 assert.equal(bytes.readUInt32LE(4),2,name+' GLB version');
 assert.equal(bytes.readUInt32LE(8),bytes.length,name+' complete GLB');
 const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
 assert(!(json.buffers||[]).some(b=>b.uri),name+' self contained buffers');
 assert(!(json.images||[]).some(b=>b.uri && !b.uri.startsWith('data:')),name+' embedded textures');
 const data=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 assets[key]=(await loader.parseAsync(data,'')).scene;
 assets[key].updateMatrixWorld(true);
 totalBytes+=bytes.length;
 assets[key].traverse(o=>{if(o.isMesh)totalTriangles+=(o.geometry.index?.count || o.geometry.attributes.position.count)/3;});
}
totalBytes+=(await fs.stat(new URL('../public/vendor/three/libs/meshopt_decoder.mjs',import.meta.url))).size;
assert(totalBytes<1_000_000,'all preload art plus Meshopt decoder under 1MB');
const originalBounds=new THREE.Box3().setFromObject(assets.kart);
const countDraws=object=>{let n=0;object.traverseVisible(o=>{if(o.isMesh)n++;});return n;};
const originalDraws=countDraws(assets.kart);
batchKartBody(THREE,assets.kart,mergeGeometries);
assert(countDraws(assets.kart)<originalDraws*.65,'batch reduces kart draw calls');
const bounds=new THREE.Box3().setFromObject(assets.kart), size=bounds.getSize(new THREE.Vector3());
assert(bounds.min.distanceTo(originalBounds.min)<.001 && bounds.max.distanceTo(originalBounds.max)<.001,'batch preserves kart silhouette');
assert(Math.abs(bounds.min.y)<0.1,'wheel ground origin');
assert(size.x<3.5 && size.z<4.5 && size.y<3.5,'kart silhouette stays compact');
const nose=assets.kart.getObjectByName('NoseMark');
assert(nose && nose.getWorldPosition(new THREE.Vector3()).z>1,'nose faces +Z');
for(const n of ['FrontSteer_L','FrontSteer_R','WheelSpin_FL','WheelSpin_FR','WheelSpin_RL','WheelSpin_RR'])assert(assets.kart.getObjectByName(n),'animation pivot '+n);
const a=createKartModel(THREE,{assets,color:0xed526d}), b=createKartModel(THREE,{assets,color:0x59cabb});
let paintA,paintB;
a.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m?.name==='KartPaint')paintA=m;});
b.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material]))if(m?.name==='KartPaint')paintB=m;});
assert(paintA && paintB && paintA!==paintB,'paint independent per driver');
assert.notEqual(paintA.color.getHex(),paintB.color.getHex(),'driver colors distinct');
a.rotation.y=1.2;const spin=a.getObjectByName('WheelSpin_FL');const before=spin.rotation.x;
animateKartModel(a,{speed:12,steer:.5,boost:1,shield:1,dt:.016,reducedMotion:false});
assert.equal(a.rotation.y,1.2,'cosmetics preserve authoritative yaw');
assert.notEqual(spin.rotation.x,before,'wheels roll');
// Every actual vertex, including steered wheels/body lean, must fit the
// shared collider. A loose bounding box never proved the old 1.1 radius safe.
for(const steer of [-1,0,1])for(const speed of [-5,0,22.4]){
 a.rotation.y=0;animateKartModel(a,{speed,steer,dt:.05,reducedMotion:false});a.updateMatrixWorld(true);
 let radius=0;const v=new THREE.Vector3();
 a.traverse(o=>{if(!o.isMesh||o.name==='ShieldBubble'||o.name==='BoostFlame'||o.material?.transparent)return;
  const points=o.geometry.attributes.position;for(let i=0;i<points.count;i++){v.fromBufferAttribute(points,i).applyMatrix4(o.matrixWorld);radius=Math.max(radius,Math.hypot(v.x,v.z));}});
 assert(radius<=KART_R,`animated hull radius ${radius.toFixed(3)} fits shared ${KART_R} collider`);
}
assert(createStarModel(THREE,assets).isObject3D && createCrateModel(THREE,assets).isObject3D,'pickup templates clone');
const palettes=[];
for(const palette of ['Daybreak','Sunset','Starlight']){
 const scene=new THREE.Scene(), world=createKartWorld(THREE,{scene,palette,assets});
 const blocks=[{x:8,z:-4,hw:2,hd:3}];world.syncMap({id:'blocks',blocks});
 assert.deepEqual(world.layout.blocks,blocks,'obstacle layout follows server');
 const count=world.group.children.length;for(let i=0;i<120;i++)world.animate(.016,i*.016);
 assert.equal(world.group.children.length,count,'animation keeps bounded scene');
 world.syncMap({id:'ring',blocks:[]});assert.equal(world.stats().obstacles,0,'ring clears old map');
 assert(world.stats().triangles<150_000,'world triangle budget');
 palettes.push(world.palette.track);
}
assert.equal(new Set(palettes).size,3,'distinct track palettes');
for(const id of ['garden','frost','neon']) {
 const map=kartMaps.mapDef(id);
 for(const palette of ['Daybreak','Sunset','Starlight']) {
  const scene=new THREE.Scene(), world=createKartWorld(THREE,{scene,palette,assets,map});
  world.syncMap(map);
  assert.equal(world.theme,id,'map-specific art');
  assert.deepEqual(world.layout.blocks,map.blocks,'exact block contract');
  assert.deepEqual(world.layout.pads,map.pads,'exact turbo strips');
  assert.deepEqual(world.layout.surfaces,map.surfaces,'exact grip zones');
  assert(world.stats().triangles<150_000,id+' triangle budget');
  const children=world.group.children.slice(), objects=[];
  world.group.traverse(o=>objects.push(o));
  for(let i=0;i<120;i++) {world.syncMap(map);world.animate(.016,i*.016);}
  const after=[];world.group.traverse(o=>after.push(o));
  assert.deepEqual(after,objects,id+' unchanged snapshots reuse all scene objects');
  assert.deepEqual(world.group.children,children,id+' bounded animation');
  world.syncMap({...map,blocks:[],pads:[],surfaces:[]});
  assert.equal(world.stats().obstacles,0,'clear all solids');
  assert.equal(world.stats().pads,0,'clear all pads');
  assert.equal(world.stats().surfaces,0,'clear all surfaces');
 }
}
/* ---- large arenas (half=60): walls/scenery derive from half ---- */
assert.equal(resolveHalf(null),30,'missing map defaults to legacy half');
assert.equal(resolveHalf({}),30,'empty map defaults to legacy half');
assert.equal(resolveHalf({half:60}),60,'map.half honored');
assert.equal(resolveHalf({bound:58}),60,'map.bound+2 derives half');
assert.equal(resolveHalf({half:'nope'}),30,'corrupt half falls back');
assert.equal(resolveBound({bound:58},60),58,'authoritative bound kept');
assert.equal(resolveBound({},60),58,'bound defaults to half-2');
assert.equal(resolveLightingHalf(),30,'lighting defaults to legacy');
assert.equal(resolveLightingHalf({half:{arena:60}}),60,'lighting reads {half:bounds}');
assert.equal(resolveLightingHalf({arena:60,half:60,bound:58}),60,'lighting reads bounds directly');

function wallCounts(world,half) {
  let kerb=0,rail=0;
  const face=resolveBound({half},half)+KART_R;
  const assertOutside=o=>{
    const box=new THREE.Box3().setFromObject(o),x=Math.abs(o.position.x)>Math.abs(o.position.z);
    const inner=x?(o.position.x>0?box.min.x:-box.max.x):(o.position.z>0?box.min.z:-box.max.z);
    assert(inner>=face-0.00001,'outer wall never intersects the furthest legal kart hull');
  };
  world.group.traverse(o=>{
    if(o.name==='arena-wall-accent')assertOutside(o);
    if(!o.isMesh||!o.geometry||o.geometry.type!=='BoxGeometry')return;
    const p=o.geometry.parameters||{};
    if(Math.abs(p.height-0.5)<1e-6&&
      ((Math.abs(p.width-(half*2+1.6))<0.01&&Math.abs(p.depth-1)<1e-6)||
       (Math.abs(p.depth-(half*2+1.6))<0.01&&Math.abs(p.width-1)<1e-6))) {
      kerb++;
      assertOutside(o);
    }
    if(Math.abs(p.height-0.12)<1e-6&&(Math.abs(p.width-half*2)<0.01||Math.abs(p.depth-half*2)<0.01)){rail++;assertOutside(o);}
  });
  return {kerb,rail};
}
for(const half of [30,60]){
 for(const templates of [assets,{}]){
  const map={id:'ring',half,bound:half-2,blocks:[],pads:[],surfaces:[]};
  const world=createKartWorld(THREE,{scene:new THREE.Scene(),map,assets:templates});
  assert.deepEqual(wallCounts(world,half),{kerb:4,rail:4},'real/fallback boundary solids clear legal hulls in both arena sizes');
 }
}
function assertSceneryOutside(layout,half,tag) {
  const min=half+2-1; // 1u tolerance for jitter/origin recentering
  for(const key of ['trees','rocks','bushes','flowers','structures','ridgePines','clusters','cargo']) {
    for(const e of layout[key]||[]) {
      const c=Math.max(Math.abs(e.x),Math.abs(e.z));
      assert(c>=min,`${tag} ${key} outside half+2 (saw ${c.toFixed(1)})`);
    }
  }
}
function assertSolidsInside(world,blocks,tag) {
  const obs=world.group.getObjectByName('obstacles');
  const box=new THREE.Box3();
  for(const child of obs.children) {
    if(child.isMesh&&child.geometry&&child.geometry.type==='PlaneGeometry')continue; // paint ring
    box.setFromObject(child);
    if(box.isEmpty())continue;
    const ok=blocks.some(b=>
      box.min.x>=b.x-b.hw-0.12&&box.max.x<=b.x+b.hw+0.12&&
      box.min.z>=b.z-b.hd-0.12&&box.max.z<=b.z+b.hd+0.12);
    assert(ok,`${tag} solid stays inside its block footprint`);
  }
}
const hexChan=(h,s)=>(h>>s)&255;
const hexLum=(h)=>{const r=hexChan(h,16)/255,g=hexChan(h,8)/255,b=hexChan(h,0)/255;return 0.2126*r+0.7152*g+0.0722*b;};
function assertFinitePalette(p,tag) {
  for(const k of ['sky','skyMid','horizon','sun','sunIntensity','sunDisc','sunSize','haze','hazeOpacity','hemiSky','hemiGround','hemiIntensity','exposure','ground','track']) {
    assert(Number.isFinite(p[k]),`${tag} palette.${k} finite`);
  }
  for(const v of [...p.sunDir,...p.fog])assert(Number.isFinite(v),`${tag} palette vector finite`);
}
function domeArray(world) {
  return world.group.getObjectByName('sky-dome').geometry.attributes.color.array;
}

for(const id of ['garden','frost','neon']) {
  const map=kartMaps.mapDef(id);
  const large={...map,id,half:60,bound:58};
  for(const palette of ['Daybreak','Sunset','Starlight']) {
    const scene=new THREE.Scene(), world=createKartWorld(THREE,{scene,palette,assets,map:large});
    world.syncMap(large);
    assert.equal(world.half,60,id+' large half');
    assert.equal(world.bounds.arena,60,id+' wall half');
    assert.equal(world.bounds.sceneryMin,62,id+' scenery starts outside half+2');
    assert.equal(world.bounds.hillMin,105,id+' hills pushed out');
    assert.equal(world.theme,id,id+' large art');
    assert.deepEqual(world.layout.blocks,large.blocks,id+' large exact blocks');
    assert.deepEqual(world.layout.pads,large.pads,id+' large exact pads');
    assert.deepEqual(world.layout.surfaces,large.surfaces,id+' large exact surfaces');
    const st=world.stats();
    assert(st.triangles<150_000,id+' large triangle budget');
    assert(st.drawCalls<350,id+' large draw budget, saw '+st.drawCalls);
    assert(st.nearProps<150,id+' bounded dressing, saw '+st.nearProps);
    const walls=wallCounts(world,60);
    assert.equal(walls.kerb,4,id+' four kerbs at +-60');
    assert.equal(walls.rail,4,id+' four rails at +-60');
    assertSceneryOutside(world.layout,60,id+' '+palette);
    assertSolidsInside(world,large.blocks,id+' '+palette);
    assertFinitePalette(world.palette,id+' fixed');
    // skyPhase never rebuilds geometry: same objects across phases.
    const before=[];world.group.traverse(o=>before.push(o));
    const kids=world.group.children.length;
    for(let i=0;i<40;i++)world.animate(.016,i*.016,0);
    for(let i=0;i<40;i++)world.animate(.016,i*.016,.6);
    for(let i=0;i<40;i++)world.animate(.016,i*.016,1);
    const after=[];world.group.traverse(o=>after.push(o));
    assert.deepEqual(after,before,id+' '+palette+' phases reuse all scene objects');
    assert.equal(world.group.children.length,kids,id+' bounded phased animation');
    assertFinitePalette(world.palette,id+' phased');
    for(const v of domeArray(world))assert(Number.isFinite(v),id+' dome colors finite');
    const sun=world.group.getObjectByName('sun-disk');
    assert(Number.isFinite(sun.position.x+sun.position.y+sun.position.z),id+' sun position finite');
    assert(sun.position.y>0,id+' sun/moon stays above the horizon');
  }
}

/* ---- gradual sunset: measurable, smooth, stable when fixed ---- */
{
  const scene=new THREE.Scene();
  const world=createKartWorld(THREE,{scene,palette:'Daybreak',assets,map:{...kartMaps.mapDef('garden'),id:'garden',half:60,bound:58}});
  world.syncMap({...kartMaps.mapDef('garden'),id:'garden',half:60,bound:58});
  const pal=world.palette, sunDirRef=pal.sunDir, fogRef=pal.fog;
  world.animate(0,0,0);
  assert.equal(world.palette,pal,'palette object stable');
  assert.equal(world.palette.sunDir,sunDirRef,'sunDir array reused');
  assert.equal(world.palette.fog,fogRef,'fog array reused');
  const sky0=pal.sky,hor0=pal.horizon,y0=pal.sunDir[1];
  const sun0=world.group.getObjectByName('sun-disk').position.clone();
  world.animate(0,0,.6);
  assert.notEqual(pal.sky,sky0,'sunset moves the sky');
  assert.notEqual(pal.horizon,hor0,'sunset moves the horizon');
  assert(pal.sunDir[1]<y0,'sun sinks toward the mountains, saw '+pal.sunDir[1].toFixed(2));
  assert(world.group.getObjectByName('sun-disk').position.distanceTo(sun0)>1,'sun disc travels');
  // Sunset reads orange in the sky while the track stays cool.
  assert(hexChan(pal.horizon,16)>=0xf0&&hexChan(pal.horizon,0)<=0x90,'sunset horizon warm orange');
  assert(hexChan(pal.track,0)>hexChan(pal.track,16),'track stays cool at sunset');
  world.animate(0,0,1);
  assert.equal(pal.stars,true,'stars arrive late');
  assert(world.group.getObjectByName('sun-disk').position.y>0,'moon above horizon');
  assert(pal.hemiIntensity>=0.7&&pal.sunIntensity>=0.7,'night keeps readable light');
  assert(hexLum(pal.ground)>0.12&&hexLum(pal.track)>0.05,'night ground vivid, not black');
  // Clamp + null/NaN handling, no Date.now or local clock.
  world.animate(0,0,-1);const skyNeg=pal.sky;
  world.animate(0,0,0);assert.equal(pal.sky,skyNeg,'phase clamps at 0');
  world.animate(0,0,2);const skyOver=pal.sky;
  world.animate(0,0,1);assert.equal(pal.sky,skyOver,'phase clamps at 1');
  world.animate(0,0,null);const fixed=JSON.stringify({...pal,sunDir:[...pal.sunDir],fog:[...pal.fog]});
  world.animate(.016,9.99,null);world.animate(.016,10.0);
  assert.equal(JSON.stringify({...pal,sunDir:[...pal.sunDir],fog:[...pal.fog]}),fixed,'fixed mode stable');
  world.animate(0,0,NaN);
  assert.equal(JSON.stringify({...pal,sunDir:[...pal.sunDir],fog:[...pal.fog]}),fixed,'NaN phase holds fixed');
}
{
  // Sunset base blends to night; Starlight stays night with a drifting moon.
  const mk=(palette)=>{
    const scene=new THREE.Scene();
    const map={id:'frost',...kartMaps.mapDef('frost'),half:60,bound:58};
    const w=createKartWorld(THREE,{scene,palette,assets,map});w.syncMap(map);return w;
  };
  const dusk=mk('Sunset');
  dusk.animate(0,0,0);const s0=dusk.palette.sky;
  dusk.animate(0,0,1);
  assert.notEqual(dusk.palette.sky,s0,'Sunset base reaches night');
  assert.equal(dusk.palette.stars,true,'Sunset base ends starry');
  const night=mk('Starlight');
  night.animate(0,0,0);
  const nsky=night.palette.sky,nx=night.palette.sunDir[0],nz=night.palette.sunDir[2];
  night.animate(0,0,1);
  assert.equal(night.palette.sky,nsky,'Starlight sky stays night');
  assert.equal(night.palette.stars,true,'Starlight keeps stars');
  assert(Math.hypot(night.palette.sunDir[0]-nx,night.palette.sunDir[2]-nz)>0.01,'moon drifts');
  assert(night.palette.hemiIntensity>=0.7,'night ambient floor holds');
}

/* ---- lighting follows the palette without per-frame rebuilds ---- */
{
  const scene=new THREE.Scene();
  const map={id:'neon',...kartMaps.mapDef('neon'),half:60,bound:58};
  const world=createKartWorld(THREE,{scene,palette:'Daybreak',assets,map});
  world.syncMap(map);
  world.animate(0,0,0);
  const lscene=new THREE.Scene();
  lscene.background=new THREE.Color(0x000000);
  lscene.fog=new THREE.Fog(0x000000,1,2);
  const renderer={shadowMap:{},toneMapping:null,toneMappingExposure:0};
  const dispose=createKartLighting(THREE,renderer,lscene,world.palette,{half:world.bounds});
  assert.equal(typeof dispose,'function','lighting stays callable');
  assert.equal(typeof dispose.update,'function','lighting exposes update');
  assert.equal(typeof dispose.setBounds,'function','lighting exposes setBounds');
  assert.equal(dispose.half(),60,'lighting frames the large arena');
  const cam=lscene.children.map(o=>o.shadow&&o.shadow.camera).find(Boolean);
  assert(cam.left===-68&&cam.right===68&&cam.far===165,'large shadow frustum');
  world.animate(0,0,.6);dispose.update(world.palette);
  assert.equal(lscene.fog.color.getHex(),world.palette.horizon,'fog follows the horizon');
  assert.equal(lscene.background.getHex(),world.palette.horizon,'background follows');
  assert.equal(lscene.fog.near,world.palette.fog[0],'fog near follows');
  assert(dispose.setBounds(30)===30,'setBounds accepts a half');
  assert(cam.left===-38&&cam.far===105,'legacy frustum restored');
  assert(dispose.setBounds({arena:60})===60,'setBounds accepts bounds');
  const hemiCount=lscene.children.length;
  dispose.update(world.palette); // no rebuild, no extra nodes
  assert.equal(lscene.children.length,hemiCount,'update adds no nodes');
  dispose();dispose(); // idempotent
  dispose.update(world.palette); // safe no-op after dispose
  assert.equal(lscene.environment,null,'cleanup clears the environment');
  const legacy=createKartLighting(THREE,{shadowMap:{}},new THREE.Scene(),world.palette);
  assert.equal(legacy.half(),30,'lighting default is legacy');
  legacy();
}
console.log('Kart art PASS: '+Math.round(totalBytes/1024)+'KB, '+Math.round(totalTriangles)+' asset triangles, real GLB load, pivots, recolor, animation and all worlds');

await import('./kart-meshopt.mjs');
await import('./kart-assets-readiness.mjs');
