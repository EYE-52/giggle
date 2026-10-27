import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
import {createRoadTerrain} from '../public/js/engines/kart-road-terrain.mjs';
import {createKartWorld} from '../public/js/engines/kart-world.mjs';
import POCKET from '../games/pocket-karts/server.js';
import {createGroundMarker,placeGroundMarker,disposeGroundMarker,placeGroundProp} from '../public/js/engines/kart-ground-markers.mjs';
import {createKartCombatArt} from '../public/js/engines/kart-combat-art.mjs';
import maps from '../games/engines/kart-maps.js';

// Inspect actual rendered triangle/line interiors, not only fitted endpoints.
// CPU object-graph and geometry checks; this is not native browser acceptance.
await MeshoptDecoder.ready;
globalThis.self=globalThis;
globalThis.createImageBitmap=async blob=>{const png=Buffer.from(await blob.arrayBuffer());return{width:png.readUInt32BE(16),height:png.readUInt32BE(20),close(){}};};
const bytes=await fs.readFile(new URL('../public/assets/karts/combat/arsenal-mounted.meshopt.glb',import.meta.url));
const library=(await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  .parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'')).scene;
const sourceResources=new Map();
library.traverse(o=>{if(o.isMesh&&!sourceResources.has(o.geometry)){
  const attribute=o.geometry.attributes.position;
  sourceResources.set(o.geometry,{attribute,buffer:attribute.array,vertices:attribute.array.slice()});
}});
let borrowedDisposals=0;
for(const resource of sourceResources.keys())resource.addEventListener('dispose',()=>borrowedDisposals++);
const art=createKartCombatArt(THREE,{assets:library});
const trap=art.mine(true),prop=new THREE.Group();prop.add(trap);
assert.equal(trap.userData.combat.inner.children[0].name,'MineTrap','actual shipping independently grounded MineTrap');
const cone=[];
for(let i=0;i<16;i++){const a=-.55+i/16*1.1,b=-.55+(i+1)/16*1.1;cone.push(Math.sin(a)*12,.12,Math.cos(a)*12,Math.sin(b)*12,.12,Math.cos(b)*12);}
for(const a of [-.55,0,.55])cone.push(0,.12,0,Math.sin(a)*12,.12,Math.cos(a)*12);
const types=[
  ['pickup',new THREE.RingGeometry(2.22,2.4,36),true,false],
  ['warning',new THREE.RingGeometry(3.8,4,32),true,false],
  ['ko',new THREE.RingGeometry(3.3,4,32),true,false],
  ['emp',new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(cone,3)),false,true],
];
const material=new THREE.MeshBasicMaterial(),markers=[],sourceMarkers=new Map(),sourceBufferIdentities=new Map();
let clonedDisposals=0,materialDisposals=0;
material.addEventListener('dispose',()=>materialDisposals++);
for(const [kind,geometry,horizontal,lines]of types){
  sourceMarkers.set(geometry,geometry.attributes.position.array.slice());
  sourceBufferIdentities.set(geometry,{attribute:geometry.attributes.position,buffer:geometry.attributes.position.array});
  const marker=createGroundMarker(THREE,geometry,material,horizontal,lines);
  assert.notEqual(marker.geometry,geometry,kind+' owns cloned geometry');
  assert.notEqual(marker.geometry.attributes.position.array,geometry.attributes.position.array,kind+' owns position buffer');
  marker.geometry.addEventListener('dispose',()=>clonedDisposals++);
  assert.ok(marker.geometry.boundingSphere,'pool factory allocates bounding sphere before a live effect frame');
  markers.push({kind,marker});
}
const weights=[[1/3,1/3,1/3],[.5,.5,0],[0,.5,.5],[.5,0,.5],[.25,.25,.5],[.25,.5,.25],[.5,.25,.25]];
const point=new THREE.Vector3(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
const metrics=[],failures=[];
function measureGeometry(object,groundAt,lines=false){
  object.updateWorldMatrix(true,true);
  let minimum=Infinity,worst;
  object.traverse(mesh=>{
    if(!mesh.isMesh&&!mesh.isLineSegments)return;
    const p=mesh.geometry.attributes.position,ix=mesh.geometry.index;
    function check(v,element,sample){const clearance=v.y-groundAt(v.x,v.z);if(clearance<minimum){minimum=clearance;worst={point:v.toArray(),element,sample};}}
    for(let i=0;i<p.count;i++)check(point.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld),i,'vertex');
    if(lines){
      for(let i=0;i<p.count;i+=2){a.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,i+1).applyMatrix4(mesh.matrixWorld);
        for(const t of [.125,.25,.375,.5,.625,.75,.875])check(point.copy(a).lerp(b,t),i/2,t);}
    }else{
      const count=ix?.count??p.count;
      for(let i=0;i<count;i+=3){
        a.fromBufferAttribute(p,ix?ix.getX(i):i).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(p,ix?ix.getX(i+1):i+1).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(p,ix?ix.getX(i+2):i+2).applyMatrix4(mesh.matrixWorld);
        for(const w of weights)check(point.copy(a).multiplyScalar(w[0]).addScaledVector(b,w[1]).addScaledVector(c,w[2]),i/3,w);
      }
    }
  });
  return{minimum,worst};
}
for(const id of maps.mapIds()){
  const map={id,...maps.mapDef(id)},terrain=createRoadTerrain(map),ground=terrain.heightAt;
  const step=map.half===30?3:6,sites=[];
  for(let z=-map.half+6;z<map.half-6;z+=step)for(let x=-map.half+6;x<map.half-6;x+=step)
    if(ground(x,z)>.01||Math.abs(x)+Math.abs(z)<1)sites.push({x,z});
  // Include reproducible terrain-mask/triangle seams, not just hill crests.
  sites.push(...({ring:[[21,12]],blocks:[[3,18]],garden:[[48,39]],frost:[[42,15]],neon:[[-42,-33]]}[id]).map(([x,z])=>({x,z})));
  const markerMinimum={};
  for(const {kind,marker}of markers){
    let minimum=Infinity,worst;
    const geometry=marker.geometry,position=geometry.attributes.position,buffer=position.array,base=marker.userData.ground.base,sphereAtReadiness=geometry.boundingSphere;
    for(const site of sites)for(const scale of [.2,.6,1])for(const yaw of [0,.47,1.4]){
      marker.scale.setScalar(scale);marker.rotation.y=yaw;placeGroundMarker(marker,site.x,site.z,ground);
      const measured=measureGeometry(marker,ground,kind==='emp');
      if(measured.minimum<minimum){minimum=measured.minimum;worst={...site,scale,yaw,...measured.worst};}
      assert.equal(marker.geometry,geometry,kind+' animation does not replace geometry');
      assert.equal(geometry.attributes.position,position,kind+' animation does not replace BufferAttribute');
      assert.equal(position.array,buffer,kind+' animation does not replace position buffer');
      assert.equal(marker.userData.ground.base,base,kind+' immutable calibration buffer identity');
      assert.equal(geometry.boundingSphere,sphereAtReadiness,kind+' animated fitting reuses the readiness-allocated bounding sphere');
    }
    markerMinimum[kind]={minimum,worst};
    if(minimum<.05599)failures.push({id,kind,minimum,worst});
    const version=position.version,matrix=marker.position.toArray(),array=position.array.slice(),sphere=geometry.boundingSphere;
    let samples=0;const counted=(x,z)=>{samples++;return ground(x,z);};
    for(let frame=0;frame<120;frame++)placeGroundMarker(marker,marker.position.x,marker.position.z,counted);
    assert.equal(samples,0,kind+' stationary frames perform no ground sampling');
    assert.equal(position.version,version,kind+' stationary frames upload no positions');
    assert.equal(geometry.boundingSphere,sphere,kind+' stationary frames allocate no bounding sphere');
    assert.deepEqual(position.array,array,kind+' stationary buffer unchanged');
    assert.deepEqual(marker.position.toArray(),matrix,kind+' stationary placement unchanged');
  }
  let minimumProp=Infinity,worstProp;
  const constructorCounts={};
  const countedTHREE={...THREE};
  for(const name of ['Box3','Vector3','BufferGeometry','Float32BufferAttribute'])countedTHREE[name]=new Proxy(THREE[name],{
    construct(target,args){constructorCounts[name]=(constructorCounts[name]||0)+1;return Reflect.construct(target,args);}});
  placeGroundProp(countedTHREE,prop,0,0,0,ground);
  const warmedCounts={...constructorCounts};
  for(const site of sites){
    placeGroundProp(countedTHREE,prop,site.x,ground(site.x,site.z),site.z,ground);
    art.animate(trap,1/60,site.x*.1,false);
    const measured=measureGeometry(prop,ground);
    if(measured.minimum<minimumProp){minimumProp=measured.minimum;worstProp={...site,...measured.worst};}
  }
  assert.deepEqual(constructorCounts,warmedCounts,id+' moving prop placement constructs no objects after footprint calibration');
  if(minimumProp<.02999)failures.push({id,kind:'MineTrap',minimum:minimumProp,worst:worstProp});
  const counts={...constructorCounts},data=prop.userData.groundProp,feet=data.feet;
  for(let frame=0;frame<120;frame++)placeGroundProp(countedTHREE,prop,prop.position.x,data.y,prop.position.z,ground);
  assert.deepEqual(constructorCounts,counts,id+' stationary prop placement constructs no objects');
  assert.equal(prop.userData.groundProp,data);assert.equal(data.feet,feet);
  placeGroundProp(countedTHREE,prop,0,0,0,ground);prop.updateWorldMatrix(true,true);
  const flat=measureGeometry(prop,ground);
  assert.ok(Math.abs(flat.minimum-.035)<1e-6,id+' near-level MineTrap base rests exactly .035m above source ground');
  const world=createKartWorld(countedTHREE,{scene:new THREE.Scene(),map});world.syncMap(map);
  const visibleGround=world.propGroundAt,skinSites=[...sites,{x:0,z:0}];
  // Independent oracle: cast only against the ACTUAL drawn floor meshes.
  // This catches skin geometry/height changes without changing the helper.
  const floorMeshes=[],floorCases=[{x:0,z:0},{x:-map.half+2,z:-map.half+2},...sites.slice(0,4)];
  const roadNames=[id+'-road-road',id+'-road-shoulder',id+'-road-curbs',id+'-lane-paint'];
  for(const name of [id+'-driving-terrain',...roadNames,'boost-pads','grip-surfaces']){
    const object=world.group.getObjectByName(name);assert(object,name+' actual drawn floor exists');
    object.traverse(child=>{if(child.isMesh)floorMeshes.push(child);});
    if(!roadNames.includes(name))continue;
    const p=object.geometry.attributes.position,index=object.geometry.index,triangles=(index?.count??p.count)/3;
    for(let n=0;n<8;n++){
      const face=Math.floor(n*(triangles-1)/7)*3;let x=0,z=0;
      for(let j=0;j<3;j++){const vertex=index?index.getX(face+j):face+j;x+=p.getX(vertex)/3;z+=p.getZ(vertex)/3;}
      floorCases.push({x,z});
    }
  }
  for(const r of [...map.pads,...map.surfaces])floorCases.push(
    {x:r.x,z:r.z},{x:r.x+r.hw-.01,z:r.z},{x:r.x,z:r.z+r.hd-.01},
    {x:r.x+r.hw+.01,z:r.z},{x:r.x,z:r.z+r.hd+.01});
  assert(floorCases.length<=100,id+' independent casts stay bounded');
  world.group.updateWorldMatrix(true,true);
  const ray=new THREE.Raycaster(),rayOrigin=new THREE.Vector3(),down=new THREE.Vector3(0,-1,0),normal=new THREE.Vector3(),hits=[];
  let maximumFloorError=0;
  for(const site of floorCases){
    rayOrigin.set(site.x,64,site.z);ray.set(rayOrigin,down);ray.far=128;hits.length=0;
    ray.intersectObjects(floorMeshes,false,hits);assert(hits.length,id+' floor cast finds actual support');
    normal.copy(hits[0].face.normal).transformDirection(hits[0].object.matrixWorld);
    assert(normal.y>.85,id+' downward front-face cast hits an actual upward floor');
    const error=Math.abs(hits[0].point.y-visibleGround(site.x,site.z));maximumFloorError=Math.max(maximumFloorError,error);
    assert(error<6e-6,id+' helper agrees with highest actual drawn floor at '+JSON.stringify(site)+', error '+error);
  }
  for(const r of [...map.pads,...map.surfaces]){
    // The real base footprint crosses each skin edge at different widths;
    // measure all model vertices and triangle interiors, not nine lift feet.
    skinSites.push({x:r.x,z:r.z});
    for(const side of [-1,1])for(const delta of [-.3,-.1,0,.1,.3]){
      skinSites.push({x:r.x+side*(r.hw+delta),z:r.z},{x:r.x,z:r.z+side*(r.hd+delta)});
    }
  }
  let minimumVisibleProp=Infinity,worstVisibleProp;
  placeGroundProp(countedTHREE,prop,0,0,0,ground,visibleGround);
  const skinCounts={...constructorCounts};
  for(const site of skinSites){
    // Use a fresh centre to defeat the placement cache between support
    // callbacks; production uses one fixed callback for the scene lifetime.
    placeGroundProp(countedTHREE,prop,site.x+.001,ground(site.x+.001,site.z),site.z,ground,visibleGround);
    placeGroundProp(countedTHREE,prop,site.x,ground(site.x,site.z),site.z,ground,visibleGround);
    const measured=measureGeometry(prop,visibleGround);
    if(measured.minimum<minimumVisibleProp){minimumVisibleProp=measured.minimum;worstVisibleProp={...site,...measured.worst};}
  }
  assert.deepEqual(constructorCounts,skinCounts,id+' visible-floor fitting constructs no Three objects after readiness');
  if(minimumVisibleProp<.03499)failures.push({id,kind:'MineTrap-visible-skins',minimum:minimumVisibleProp,worst:worstVisibleProp});
  if(id==='neon')assert.equal(visibleGround(18,18),.065,'actual Neon pad chevron floor');
  for(const r of map.surfaces)assert(visibleGround(r.x,r.z)>=.045,'Frost ice is included in visible support');
  const soil=-map.half+2;
  assert.equal(visibleGround(soil,soil),ground(soil,soil),id+' neighbouring bare ground receives no skin lift');
  placeGroundProp(countedTHREE,prop,soil,ground(soil,soil),soil,ground,visibleGround);
  assert(Math.abs(measureGeometry(prop,ground).minimum-.035)<1e-6,id+' bare ground keeps exact original separation');
  const another=new THREE.Group();another.add(art.mine(false));
  const beforeClone={...constructorCounts};
  placeGroundProp(countedTHREE,another,0,0,0,ground,visibleGround);
  assert.equal(another.userData.groundProp.feet,prop.userData.groundProp.feet,id+' shared authored geometry reuses readiness-calibrated footprint');
  assert.equal(constructorCounts.Box3,beforeClone.Box3,id+' subsequent trap performs no model bounds calibration');
  assert(another.userData.groundProp.feet instanceof Float32Array,'trap footprint is shared numeric data');
  metrics.push({id,sites:sites.length,markerMinimum,minimumProp,worstProp,skinSites:skinSites.length,minimumVisibleProp,worstVisibleProp,floorCasts:floorCases.length,maximumFloorError});
}
// Legally dropped fixtures use the real initialized authority and shipping
// MineTrap. No inventory/authority/physical-floor change is needed to fit skins.
await POCKET.initialize();
const acceptedMines=[];
for(const [id,x,z] of [['neon',18,18],['frost',maps.mapDef('frost').surfaces[0].x,maps.mapDef('frost').surfaces[0].z]]){
  let now=9000000;const players=[{id:'mine-a',name:'A'},{id:'mine-b',name:'B'}];
  const ctx={instanceId:'mine-skin-'+id,now:()=>now,settings:()=>({map:maps.mapDef(id).label,mode:'Zap Battle',roundSeconds:60,winRule:'Time limit'}),players:()=>players,allPlayers:()=>players,broadcast(){},award(){},later:()=>()=>{}};
  const state=POCKET.create(ctx);
  try{
    now+=3000;POCKET.onTick(state,ctx);const driver=state.karts[0];
    Object.assign(driver,{x,z:z+2,angle:0,spawnSeq:1,weapon:'mine',ammo:1,shield:0,input:{steer:0,throttle:0,boost:false}});
    POCKET.onTick(state,ctx);const ack=POCKET.view(state,driver.pid).inputAck;
    POCKET.onAction(state,ctx,driver.pid,{seq:1,life:ack.life,controlEpoch:ack.controlEpoch,input:{steer:0,throttle:0,boost:true}});POCKET.onTick(state,ctx);
    const mine=state.mines[0];assert(mine?.physical&&mine.x===x&&mine.z===z,'real accepted mine on '+id+' skin');
    const map={id,...maps.mapDef(id)},world=createKartWorld(THREE,{scene:new THREE.Scene(),map});world.syncMap(map);
    prop.userData.groundProp.x=NaN;placeGroundProp(THREE,prop,mine.x,mine.y,mine.z,world.groundAt,world.propGroundAt);
    const measured=measureGeometry(prop,world.propGroundAt);
    assert(measured.minimum>=.03499,id+' real mine footprint interiors clear actual visible floor by existing .035 separation');
    assert(prop.quaternion.angleTo(new THREE.Quaternion())<1e-6,id+' thin skin never tilts a flat trap');
    acceptedMines.push({id,position:{x:mine.x,y:mine.y,z:mine.z},visibleFloor:world.propGroundAt(x,z),visualBase:new THREE.Box3().setFromObject(prop).min.y,minimum:measured.minimum});
  }finally{POCKET.dispose(state);}
}
// Tilted/yawed physical projectile tip receives the accepted flight position.
const shot=art.projectile('rocket'),nose=new THREE.Vector3(0,0,shot.userData.combat.tipZ),forward=new THREE.Vector3(0,0,1);
shot.updateWorldMatrix(true,true);
assert.ok(Math.abs(new THREE.Box3().setFromObject(shot).max.z-shot.userData.combat.tipZ)<1e-6,'actual assembled RocketShot nose bound matches tip calibration');
for(const direction of [new THREE.Vector3(.3,.4,.866).normalize(),new THREE.Vector3(-.6,-.5,.624).normalize()]){
  shot.quaternion.setFromUnitVectors(forward,direction);shot.position.set(12,6,-8).addScaledVector(direction,-shot.userData.combat.tipZ);
  shot.updateWorldMatrix(true,true);assert.ok(shot.localToWorld(nose.clone()).distanceTo(new THREE.Vector3(12,6,-8))<1e-6,'physical projectile tip matches authoritative flight position at yaw/pitch');
}
for(const [geometry,before]of sourceMarkers){
  assert.deepEqual(geometry.attributes.position.array,before,'borrowed marker template never mutated');
  assert.equal(geometry.attributes.position,sourceBufferIdentities.get(geometry).attribute,'borrowed template BufferAttribute identity preserved');
  assert.equal(geometry.attributes.position.array,sourceBufferIdentities.get(geometry).buffer,'borrowed template source buffer identity preserved');
}
for(const [geometry,before]of sourceResources){
  assert.deepEqual(geometry.attributes.position.array,before.vertices,'borrowed MineTrap/arsenal source vertices never mutated');
  assert.equal(geometry.attributes.position,before.attribute,'borrowed MineTrap/arsenal BufferAttribute identity preserved');
  assert.equal(geometry.attributes.position.array,before.buffer,'borrowed MineTrap/arsenal position buffer identity preserved');
}
for(const {marker}of markers)disposeGroundMarker(marker);
assert.equal(clonedDisposals,markers.length,'every owned indicator clone disposed once');
assert.equal(materialDisposals,0,'marker disposal never releases shared material');
art.dispose();assert.equal(borrowedDisposals,0,'combat factory never disposes root-owned GLB source geometry');
console.log(JSON.stringify({pass:failures.length===0,scope:'actual terrain/visible floor triangles and legally dropped shipping MineTrap; no browser/GPU timing claim',metrics,acceptedMines,failures},null,2));
assert.equal(failures.length,0,'all marker/prop vertices and interiors clear rendered asphalt/curbs');
