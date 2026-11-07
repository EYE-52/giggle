import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createKartElevatedWorld} from '../public/js/engines/kart-elevated-world.mjs';
import {elevatedMap} from '../public/js/engines/kart-elevated-maps.mjs';

const reference=createKartElevatedWorld(THREE,{map:'harbor'}),limit=reference.stats(),evidence=[];reference.dispose();
for(const id of ['skyport','foundry']){
  const map=elevatedMap(id),world=createKartElevatedWorld(THREE,{map}),meshes=[],textures=new Set(),details=new Map();
  world.group.traverse(o=>{
    if(!o.isMesh||!o.visible)return;meshes.push(o);
    for(const tag of o.userData.detailKinds||[])details.set(tag,(details.get(tag)||0)+o.count);
    for(const m of Array.isArray(o.material)?o.material:[o.material])if(m?.map)textures.add(m.map);
  });
  const surfaces=[...textures].filter(t=>t.name.startsWith('complex-surface-'));
  assert.equal(surfaces.length,3,id+' shares three small surface atlases across all zones');
  for(const t of surfaces){
    assert.equal(t.image.width,256);assert.equal(t.image.height,256);
    assert(t.generateMipmaps&&t.minFilter===THREE.LinearMipmapLinearFilter&&t.anisotropy===2,id+' surface texture filters for distant/oblique phone views');
    const tones=new Set();for(let i=0;i<t.image.data.length;i+=4)tones.add(t.image.data[i]);
    assert(tones.size>12&&Math.max(...tones)-Math.min(...tones)>55,id+' surface has actual seams and grain in its pixels');
  }
  assert.equal(new Set(surfaces.map(t=>Buffer.from(t.image.data).toString('base64'))).size,3,id+' asphalt, floor and facade patterns are distinct');
  const floorMaterials=meshes.filter(o=>o.userData.colliderIds?.some(cid=>/^(west-1|east-1|west-dock|east-dock)$/.test(cid))).map(o=>o.material);
  assert(floorMaterials.length&&floorMaterials.every(m=>m.map.name==='complex-surface-'+(id==='skyport'?'pavers':'steel')&&m.userData.surfaceTileMetres===4),id+' floors use metre-scaled concrete tiles or steel panels');
  const signs=world.group.getObjectByName('complex-wayfinding-signs');
  assert(signs&&signs.geometry.index.count>=120&&signs.material.map.image.width===512,id+' all physical labels share one bounded atlas and mesh');
  for(const required of id==='skyport'?['SKYPORT','G','P1','P2','ROOF']:['DOCK','GANTRY','FURNACE','SERVICE','SLAG'])assert(signs.userData.words.includes(required),id+' has readable '+required+' signs');
  for(const tag of ['deck-fascia-frame','deck-fascia-ribs','deck-edge-lights','deck-panel-joints','bridge-guardrails','guardrail-posts'])assert(details.get(tag)>0,id+' has '+tag);
  const coverCount=map.colliders.filter(d=>d.material==='cover').length;
  for(const tag of id==='skyport'?['parked-van-windows','parked-van-wheels','parked-van-lamps','roof-service-louvres','roof-vent-panels','parking-strip-lights']:['storage-tanks','tank-cage-bars','tank-bands','service-pipework','conveyor-rollers','furnace-glowing-mouths','furnace-mouth-grates'])assert(details.get(tag)>=2,id+' renders '+tag);
  const wheelBatch=meshes.find(o=>o.userData.detailKinds?.includes(id==='skyport'?'parked-van-wheels':'storage-tanks'));
  assert(wheelBatch?.isInstancedMesh&&wheelBatch.count>=coverCount*(id==='skyport'?4:2),id+' large repeated props are instanced');
  if(id==='foundry'){
    // The generic obstacle cap must not hide the new round tank silhouettes.
    world.group.updateMatrixWorld(true);
    const d=map.colliders.find(d=>d.material==='cover'),ray=new THREE.Raycaster(new THREE.Vector3(d.position.x+d.half.x*.45,d.position.y+d.half.y+.4,d.position.z),new THREE.Vector3(0,-1,0),0,2);
    const hit=ray.intersectObjects(meshes,false)[0];assert(hit?.object.userData.detailKinds?.includes('tank-top-ports'),'Storage tank top ports remain visible through the protective cage');
  }
  const counts=world.stats();assert(counts.drawCalls<=limit.drawCalls&&counts.triangles<=limit.triangles&&counts.textureBytes<3*1024*1024,id+' detail remains below Harbor geometry and 3MiB generated textures');
  for(const phase of [0,.65,1]){
    world.animate(1/60,5,phase);
    assert(world.lighting.sun.intensity>=.9&&world.lighting.hemisphere.intensity>=1,id+' day and night retain readable road light');
    if(id==='foundry')assert(world.lighting.sun.color.r>world.lighting.sun.color.b&&world.lighting.hemisphere.color.r>world.lighting.hemisphere.color.b,'Foundry uses warm industrial light throughout the cycle');
  }
  assert.deepEqual(world.stats(),counts,id+' art and lighting do not allocate while animating');evidence.push({id,...counts});world.dispose();
}
console.log('PASS complex surface pixels, per-zone materials, instanced vehicles/machinery, signs, warm lighting and comparable world budgets');
console.log(JSON.stringify(evidence,null,2));
