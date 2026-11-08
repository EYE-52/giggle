import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import * as THREE from 'three';
import {createKartElevatedWorld} from '../public/js/engines/kart-elevated-world.mjs';
import {createKartWorld} from '../public/js/engines/kart-world.mjs';
import {createKartFestiveLights,festiveTheme,kartLightTier} from '../public/js/engines/kart-festive-lights.mjs';
import {buildClassicArena,countDraws} from './helpers/kart-headless-world.mjs';
import {reviewSpawnLights} from './helpers/kart-light-review.mjs';

const reports=[],spawnReview=[];
function checkWorld(world,id,mode){
  const f=world.festive,tag=mode+'/'+id;
  assert(f,tag+' shipping world owns the shared decoration');
  assert.equal(f.layout.theme,festiveTheme(id));
  assert.equal(f.group.children.length,3,tag+' exactly three batches');
  assert(f.group.children.every(o=>o.isInstancedMesh&&!o.castShadow&&!o.receiveShadow));
  assert(f.bulbs.count>=60,tag+' visible bulb population');
  assert(f.bars.count>0,tag+' wires/tubes batch exists');
  assert.equal(f.bulbs.geometry.index.count,6,tag+' two-triangle round bulb impostors');
  assert.equal(f.bulbs.material.type,'ShaderMaterial');
  assert.equal(f.bulbs.material.toneMapped,false,tag+' clean unlit colour');
  assert.equal(f.bulbs.material.transparent,false,tag+' opaque depth-tested bulb cores');
  assert.equal(f.bulbs.material.depthTest,true);
  assert.equal(f.halos.material.blending,THREE.AdditiveBlending,tag+' cheap additive glow');
  assert(f.halos.material.transparent&&!f.halos.material.depthWrite&&f.halos.material.depthTest,tag+' glow is occluded by solids without writing depth');
  assert.equal(f.halos.geometry,f.bulbs.geometry,tag+' glow shares the static core geometry');
  assert.equal(f.halos.instanceMatrix,f.bulbs.instanceMatrix,tag+' glow shares the static GPU matrix buffer');
  assert.equal(f.halos.count,f.bulbs.count);
  assert(f.uniforms.uHaloScale.value>=4,tag+' glow footprint is at least four times core diameter');
  assert(f.layout.bulbs.every(b=>b.size>=.3&&b.size<=.35),tag+' chunky physical cores');
  assert(f.layout.runs.filter(r=>r.a).every(r=>r.spacing<=.8),tag+' dense local strings');
  if(id==='neon')assert(f.layout.bars.filter(b=>b.phase>=0).every(b=>b.width>=.24&&b.width<=.36),tag+' thick neon tubes');
  assert.equal(f.bulbs.material.lights,false,tag+' no light evaluation in bulb shader');
  let lights=0;f.group.traverse(o=>{if(o.isLight)lights++;});assert.equal(lights,0);
  const total=countDraws(world.group);f.group.visible=false;
  assert.equal(total-countDraws(world.group),3,tag+' complete world gains only three draws');f.group.visible=true;
  const stats=f.stats();assert(stats.triangles<=(mode==='raised'&&['skyport','foundry'].includes(id)?11000:mode==='raised'&&id==='harbor'?7000:5000),tag+' bounded geometry allowance');
  if(mode==='classic'&&id==='frost')assert(world.stats().triangles<85000,'Frost stays under its existing 85k budget');
  for(const entry of[...f.layout.bulbs,...f.layout.bars]){
    for(const p of entry.p?[entry.p]:[entry.a,entry.b])assert(p.every(Number.isFinite),tag+' finite placement');
  }
  assert(f.layout.runs.some(r=>/lane/.test(r.name)),tag+' nearby lane arches');
  assert(f.layout.runs.some(r=>r.name.includes('ramp')),tag+' ramp edge has light markers');
  assert(f.layout.runs.some(r=>r.name.includes('cannon'))&&f.layout.runs.some(r=>r.name.includes('portal')),tag+' existing shortcut rims decorated');
  if(mode==='raised')assert(f.layout.runs.some(r=>r.name.endsWith(' edge')&&!r.name.includes('ramp')),tag+' upper driving deck edge decorated');
  if(id==='neon')assert(f.layout.runs.some(r=>r.neon)&&f.uniforms.uChase.value===1,tag+' neon outlines chase');
  if(id==='frost')assert(new Set(f.layout.bulbs.map(b=>b.color)).size>=5&&f.uniforms.uChase.value===0,tag+' five Christmas colours twinkle');
  if(id==='garden')assert(f.layout.runs.some(r=>r.sag>0)&&f.uniforms.uChase.value===0,tag+' warm hanging festoons');
  const buffers=f.group.children.map(o=>[o.instanceMatrix,o.instanceMatrix.version,o.geometry.attributes.festiveColor,o.geometry.attributes.festiveColor.version]);
  const objects=[];f.group.traverse(o=>objects.push(o));
  for(let i=0;i<600;i++)world.animate(1/60,i/60,.2);
  assert.equal(f.uniforms.uTime.value,599/60,tag+' shader receives the animation clock');
  assert.deepEqual(f.stats(),stats,tag+' animation never grows batches');
  for(const[buffer,version,colors,colorVersion]of buffers){assert.equal(buffer.version,version,tag+' no CPU matrix uploads');assert.equal(colors.version,colorVersion,tag+' no CPU colour uploads');}
  const after=[];f.group.traverse(o=>after.push(o));assert.deepEqual(after,objects,tag+' stable objects');
  const resources=new Set(f.group.children.flatMap(o=>[o,o.geometry,o.material])),disposed=new Map();
  for(const r of resources){disposed.set(r,0);r.addEventListener('dispose',()=>disposed.set(r,disposed.get(r)+1));}
  reports.push({map:tag,...stats,worldDraws:total});
  return()=>{
    f.dispose();f.dispose();f.animate(20);
    assert.equal(f.group.parent,null);assert.equal(f.group.children.length,0);
    assert([...disposed.values()].every(n=>n===1),tag+' instance buffers, materials and geometry released once');
    world.dispose();
  };
}
function checkSpawnViews(world,map,structures,mode){
  const high=reviewSpawnLights(THREE,{world,map,structures}),low=reviewSpawnLights(THREE,{world,map,structures,low:true});
  assert.equal(high.length,map.spawns.length);
  for(const[i,entry]of high.entries()){
    assert(entry.visibleBulbs>=10,mode+'/'+map.id+'/'+entry.spawn+' has at least ten nearby unoccluded bulb cores >=5px and halos >=20px in the driving view');
    assert(low[i].visibleBulbs>=3,mode+'/'+map.id+'/'+entry.spawn+' retains at least three visible bulbs on low detail');
  }
  if(map.id==='neon')assert(new Set(world.festive.layout.bulbs.filter((_,i)=>i%4===0).map(b=>b.color)).size>=4,'low-tier neon keeps all four saturated colours');
  spawnReview.push({map:mode+'/'+map.id,name:map.name||map.label,...world.festive.stats(),lowBulbs:Math.ceil(world.festive.bulbs.count/4),spawns:high.map((p,i)=>({...p,lowVisibleBulbs:low[i].visibleBulbs,fixtures:p.fixtures.slice(0,3)}))});
}
for(const id of['ring','blocks','garden','frost','neon']){
  const a=buildClassicArena(id),finish=checkWorld(a.world,id,'classic');
  const low=createKartWorld(THREE,{scene:new THREE.Scene(),map:a.map,quality:'low'});
  assert.equal(low.festive.bulbs.count,Math.ceil(a.world.festive.bulbs.count/4),id+' classic low tier reduces bulbs');low.dispose();
  // Public classic snapshots omit spawn data; decoration must still match.
  const publicMap={...a.map};delete publicMap.spawns;delete publicMap.spots;
  const shipping=createKartWorld(THREE,{scene:new THREE.Scene(),map:publicMap});
  assert.deepEqual(shipping.festive.layout,a.world.festive.layout,id+' real public snapshot gets identical decoration');shipping.dispose();
  checkSpawnViews(a.world,a.map,a.structures,'classic');
  finish();a.features.dispose();a.structures.dispose();
}
for(const id of['garden','frost','neon','harbor','skyport','foundry']){
  const world=createKartElevatedWorld(THREE,{scene:new THREE.Scene(),map:id}),low=createKartElevatedWorld(THREE,{scene:new THREE.Scene(),map:id,quality:'low'});
  assert.equal(low.festive.bulbs.count,Math.ceil(world.festive.bulbs.count/4),id+' raised low tier reduces bulbs');low.dispose();
  const finish=checkWorld(world,id,'raised');checkSpawnViews(world,world.layout,null,'raised');finish();
}

// Detail and accessibility changes do not rebuild or rewrite GPU buffers.
let tier='high',reduce=false;
const parent=new THREE.Group(),map={id:'frost',half:60,barriers:[],ramps:[]};
const f=createKartFestiveLights(THREE,{parent,map,quality:()=>tier,reducedMotion:()=>reduce});
const high=f.stats(),matrix=f.bulbs.instanceMatrix,version=matrix.version;
tier='low';f.animate(10);assert.equal(f.bulbs.count,Math.ceil(high.bulbs/4));assert(f.stats().triangles<high.triangles);
const lowCenters=[];for(let i=0;i<f.bulbs.count;i++){const m=new THREE.Matrix4();f.bulbs.getMatrixAt(i,m);lowCenters.push(new THREE.Vector3().setFromMatrixPosition(m));}
for(const axis of['x','z'])for(const side of[-1,1])assert(lowCenters.some(p=>side*p[axis]>30),'low detail still lights all four corner lanes');
assert.equal(f.halos.count,f.bulbs.count,'low detail glow population follows cores');
tier='medium';f.animate(11);assert.equal(f.bulbs.count,Math.ceil(high.bulbs/2));
tier='high';reduce=true;f.animate(12);assert.equal(f.bulbs.count,high.bulbs);assert.equal(f.uniforms.uMotion.value,0,'reduced motion makes all lights steady');
assert.equal(matrix.version,version,'changing quality never rewrites matrices');f.dispose();
let ratio=1.75;const renderer={getPixelRatio:()=>ratio,shadowMap:{enabled:true}};
for(const[next,shadow,tier]of[[1.75,true,'high'],[1.25,true,'medium'],[1,true,'low'],[.75,true,'low'],[1.75,false,'low']]){
  ratio=next;renderer.shadowMap.enabled=shadow;assert.equal(kartLightTier(renderer),tier,'existing adaptive renderer drives detail');
}
let desktopRatio=1;const desktop={getPixelRatio:()=>desktopRatio,shadowMap:{enabled:true}};
assert.equal(kartLightTier(desktop),'high','fresh 1x Chromium/desktop keeps all bulbs');
desktopRatio=.75;assert.equal(kartLightTier(desktop),'medium','a real resolution drop reduces detail');
desktop.shadowMap.enabled=false;assert.equal(kartLightTier(desktop),'low','the renderer shadow floor selects low detail');

// Both real views pass their live renderer tier and reduced-motion setting.
for(const path of['kart-view.js','kart-elevated-view.js']){
  const source=await readFile(new URL('../public/js/engines/'+path,import.meta.url),'utf8');
  assert.match(source,/quality:\(\)=>kartLightTier\(/,path+' uses adaptive quality');
  assert.match(source,/reducedMotion:\(\)=>helper.reducedMotion\(\)/,path+' uses live reduced motion');
}
await writeFile('/tmp/codex-festive-spawn-review.json',JSON.stringify(spawnReview,null,2)+'\n');
console.log(JSON.stringify({pass:true,scope:'all shipping worlds, three draws, additive glow, shader-only animation, adaptive detail, teardown and projected spawn visibility',reports}));
