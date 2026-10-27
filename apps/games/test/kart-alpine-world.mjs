import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFile} from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createKartWorld} from '../public/js/engines/kart-world.mjs';
import maps from '../games/engines/kart-maps.js';

// Clip actual projected triangles against the legal field plus the scenery
// setback. Testing centres or just vertices misses diagonal edge crossings.
function intersectsField(points, limit) {
  let polygon=points;
  for(const [axis,sign] of [[0,1],[0,-1],[1,1],[1,-1]]) {
    const next=[];
    for(let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length];
      const da=limit-sign*a[axis],db=limit-sign*b[axis];
      if(da>0)next.push(a);
      if((da>0)!==(db>0)) {
        const t=da/(da-db);next.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);
      }
    }
    polygon=next;if(!polygon.length)return false;
  }
  return polygon.length>0;
}

const v=new THREE.Vector3(),instance=new THREE.Matrix4(),matrix=new THREE.Matrix4();
function verifyOutside(root,limit,tag) {
  root.traverse(o=>{
    if(!o.isMesh)return;
    const geometry=o.geometry,position=geometry.attributes.position,index=geometry.index;
    if(!geometry.boundingBox)geometry.computeBoundingBox();
    for(let n=0;n<(o.isInstancedMesh?o.count:1);n++) {
      if(o.isInstancedMesh){o.getMatrixAt(n,instance);matrix.multiplyMatrices(o.matrixWorld,instance);}
      else matrix.copy(o.matrixWorld);
      const box=geometry.boundingBox.clone().applyMatrix4(matrix);
      if(box.min.x>=limit||box.max.x<=-limit||box.min.z>=limit||box.max.z<=-limit)continue;
      const count=index?index.count:position.count;
      for(let i=0;i<count;i+=3) {
        const triangle=[];
        for(let j=0;j<3;j++) {
          v.fromBufferAttribute(position,index?index.getX(i+j):i+j).applyMatrix4(matrix);
          assert(Number.isFinite(v.x+v.y+v.z),tag+' finite vertex');triangle.push([v.x,v.z]);
        }
        assert(!intersectsField(triangle,limit),`${tag} ${o.name} instance ${n} triangle ${i/3} stays outside field`);
      }
    }
  });
}

const reports=[];
for(const id of ['ring','blocks','garden','frost','neon']) {
  const map={id,...maps.mapDef(id)};
  for(const palette of ['Daybreak','Sunset','Starlight']) {
    const world=createKartWorld(THREE,{scene:new THREE.Scene(),map,palette});world.syncMap(map);world.group.updateMatrixWorld(true);
    assert.deepEqual(world.layout.blocks,map.blocks,id+' exact server blocks');
    assert.deepEqual(world.layout.pads,map.pads,id+' exact server pads');
    assert.deepEqual(world.layout.surfaces,map.surfaces,id+' exact server grip');
    for(const name of ['alpine-fir-canopies','alpine-fir-trunks','alpine-limestone-outcrops','ridge-near','ridge-far','ridge-summit','arena-landmark-'+id,'neon-city','neon-city-roofs']) {
      const root=world.group.getObjectByName(name);if(root)verifyOutside(root,map.half+2,id+'/'+palette+'/'+name);
    }
    const fir=world.group.getObjectByName('alpine-fir-canopies');
    if(id!=='neon') {
      assert(fir.isInstancedMesh && fir.count>10,id+' forest batched');
      assert(fir.geometry.attributes.position.count>=300,id+' detailed six-tier canopy');
      assert(world.group.getObjectByName('ridge-summit'),id+' third mountain layer');
    }
    if(id==='garden') {
      const meadow=world.group.getObjectByName('garden-meadow-grass'),flower=world.group.getObjectByName('garden-meadow-daisies');
      assert(meadow.isInstancedMesh && meadow.count>300 && meadow.count<700,'bounded two-draw meadow detail');
      assert(flower.isInstancedMesh && flower.count>40 && flower.count<160,'bounded small daisy clusters');
      for(let i=0;i<meadow.count;i++) {
        meadow.getMatrixAt(i,instance);matrix.multiplyMatrices(meadow.matrixWorld,instance);
        meadow.geometry.computeBoundingBox();const box=meadow.geometry.boundingBox.clone().applyMatrix4(matrix);
        const ground=world.groundAt(matrix.elements[12],matrix.elements[14]);
        assert(box.max.y-ground<.75 && box.min.y-ground>=.04,'soft meadow stays below local kart silhouette');
        for(const b of map.blocks)assert(box.max.x<b.x-b.hw-2.05||box.min.x>b.x+b.hw+2.05||box.max.z<b.z-b.hd-2.05||box.min.z>b.z+b.hd+2.05,'meadow never conceals cover contact');
      }
      const roof=world.group.getObjectByName('alpine-cabin-roofs');
      assert(roof.count===4,'four original chalets form the tower village');
      assert(roof.geometry.attributes.normal.getY(0)>0,'gable roof fronts face the sky');
      const markings=world.group.getObjectByName('garden-lane-paint');
      assert(markings.isMesh && !markings.isInstancedMesh,'centre dashes use one static geometry batch');
      assert.equal(markings.material.map,null,'lane paint does not magnify a blurry atlas');
      const paintGeometry=markings.geometry,paintPosition=paintGeometry.attributes.position;
      assert(paintGeometry.index.count/3>300 && paintGeometry.index.count/3<4000,'all three routes retain bounded geometry dashes');
      for(let i=0;i<paintPosition.count;i++) {
        assert(Math.abs(paintPosition.getY(i)-world.groundAt(paintPosition.getX(i),paintPosition.getZ(i))-.038)<2e-6,'road marks follow exact terrain support');
        assert(paintGeometry.attributes.normal.getY(i)>.87,'road paint follows traversable ground normals');
        assert(Math.abs(paintPosition.getX(i))<47 && Math.abs(paintPosition.getZ(i))<47,'road paint stays inside the legal field');
      }
      paintGeometry.computeBoundingBox();
      assert(paintGeometry.boundingBox.max.x-paintGeometry.boundingBox.min.x>91 && paintGeometry.boundingBox.max.z-paintGeometry.boundingBox.min.z>91,'paint covers connected perimeter and cuts');
    }
    const stats=world.stats();assert(stats.drawCalls<200,id+' bounded world draw calls');
    assert(stats.triangles<85000,id+' bounded world triangles including conforming terrain roads');
    const before=[];world.group.traverse(o=>before.push(o));
    for(let frame=0;frame<180;frame++){world.syncMap(map);world.animate(1/60,frame/60,frame/180);}
    const after=[];world.group.traverse(o=>after.push(o));assert.deepEqual(after,before,id+' unchanged snapshots do not rebuild scenery');
    if(palette==='Daybreak')reports.push({id,landmark:world.layout.landmark,draws:stats.drawCalls,triangles:stats.triangles});
  }
}
assert.equal(new Set(reports.map(r=>r.landmark.identity)).size,5,'five retained map identities');

// Load actual shipped GLB geometry (these nature files have no image
// dependency) and verify the batched placements retain authored materials,
// exact baselines and arena clearance rather than exercising only fallbacks.
const assets={},loader=new GLTFLoader();
for(const key of ['tree_detailed','tree_pineTallA','rock_largeA']) {
  const buffer=await readFile(new URL('../public/assets/karts/'+key+'.glb',import.meta.url));
  const gltf=await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'');assets[key]=gltf.scene;
}
for(const id of ['ring','blocks','garden','frost']) {
  const map={id,...maps.mapDef(id)},world=createKartWorld(THREE,{scene:new THREE.Scene(),map,assets});world.syncMap(map);world.group.updateMatrixWorld(true);
  for(const name of ['trackside-glb-forest','trackside-glb-rocks']) {
    const group=world.group.getObjectByName(name);assert(group?.isGroup,id+' uses shipped GLB '+name);
    assert(group.children.length<=3,id+' GLB primitives remain batched');
    verifyOutside(group,map.half+2,id+'/'+name);
    const source=assets[name.endsWith('rocks')?'rock_largeA':id==='ring'?'tree_detailed':'tree_pineTallA'];
    const materials=[];source.traverse(o=>{if(o.isMesh)materials.push(o.material);});
    for(const batch of group.children)assert(materials.includes(batch.material),id+' original asset materials retained');
    // Every GLB primitive is baked against a common normalized root; the
    // union has y=0 at the source baseline, so trunks/rocks sit on ground.
    const box=new THREE.Box3();for(const batch of group.children){batch.geometry.computeBoundingBox();box.union(batch.geometry.boundingBox);}
    assert(Math.abs(box.min.y)<1e-6,id+' GLB root baseline is grounded');
  }
  assert(world.stats().triangles<90000,id+' shipped GLB world stays bounded');
}

// Exercise browser texture allocation without pretending this stand-in
// verifies pixels. Native chase captures verify the painted foreground.
// This guards the memory/repeat tradeoff: sharp lane paint is geometry,
// while low-frequency map color and repeating grain keep bounded textures.
const oldDocument=globalThis.document;
globalThis.document={createElement:()=>{
  const ctx=new Proxy({}, {get:(_,key)=>key==='createPattern'?()=>({}):key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}});
  return {width:0,height:0,getContext:()=>ctx};
}};
try {
  for(const id of ['ring','blocks','garden','frost','neon']) {
    const map={id,...maps.mapDef(id)},world=createKartWorld(THREE,{scene:new THREE.Scene(),map});
    let road;world.group.traverse(o=>{if(o.isMesh && o.material.bumpMap)road=o.material;});
    assert(road?.map && road.bumpMap,'browser road textures allocated');
    const atlas=road.map,grain=road.bumpMap;
    assert(atlas.image.width===128 && atlas.image.height===128,id+' conforming roads use small repeating surfaces');
    assert.equal(atlas.minFilter,THREE.LinearMipmapLinearFilter,'distance mipmaps avoid shimmer');
    assert(atlas.anisotropy>=8 && atlas.anisotropy<=16,'bounded grazing-angle paint sampling');
    assert(grain.image.width<=512 && grain.repeat.x>=1 && grain.repeat.y>=1,'small repeating road grain stays dense at chase distance');
    assert.equal(grain.wrapS,THREE.RepeatWrapping,'road grain repeats without enlarging atlas');
    assert.equal(grain.colorSpace,THREE.NoColorSpace,'bump heights remain linear data');
  }
} finally {
  if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;
}
console.log('Kart alpine world PASS: exact map contracts, full triangle clearance, instance budgets and 180-frame stability');
console.log(JSON.stringify(reports));
