import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createKartWorld} from '../public/js/engines/kart-world.mjs';
import {createRoadTerrain} from '../public/js/engines/kart-road-terrain.mjs';
import {grenadePose} from '../public/js/engines/kart-flight.mjs';
import {createKartFeedback} from '../public/js/engines/kart-feedback.mjs';
import maps from '../games/engines/kart-maps.js';

// Count graphics constructors exposed to the production renderer. Animation
// must reuse its existing vectors/colors/materials/buffers across sky phases.
let constructions=0;
const measuredThree={...THREE};
for(const [key,value]of Object.entries(THREE))if(typeof value==='function'&&/^[A-Z]/.test(key))
  measuredThree[key]=new Proxy(value,{construct(target,args){constructions++;return Reflect.construct(target,args);}});
const reports=[];
for(const id of ['ring','blocks','garden','frost','neon']) {
  const map={id,...maps.mapDef(id)},terrain=createRoadTerrain(map);
  assert(terrain,id+' has shared real driving terrain');
  const world=createKartWorld(measuredThree,{scene:new THREE.Scene(),map});world.syncMap(map);
  const ground=world.group.getObjectByName(id+'-driving-terrain');
  assert.deepEqual(ground.geometry.attributes.position.array,terrain.vertices,id+' visual and collider vertices agree exactly');
  assert.deepEqual(ground.geometry.index.array,terrain.indices,id+' visual and collider topology agree exactly');
  assert.equal(ground.rotation.x,0,id+' terrain remains in physics XYZ space');
  let samples=0,maxRoadHeight=0,nonflat=0;
  for(const [name,lift]of [[id+'-road-road',.03],[id+'-road-shoulder',.018],[id+'-road-curbs',.055],[id+'-lane-paint',.038]]) {
    const mesh=world.group.getObjectByName(name);assert(mesh?.isMesh,name+' actual geometry');
    const positions=mesh.geometry.attributes.position;
    assert(positions.count>0,name+' nonempty route layer');
    for(let i=0;i<positions.count;i+=3) {
      // Vertices alone miss a ribbon bridge cutting through its terrain.
      // Interior barycentric samples prove each drawn face shares a plane.
      for(const weights of [[1,0,0],[0,1,0],[0,0,1],[1/3,1/3,1/3],[.15,.35,.5]]) {
        let x=0,y=0,z=0;
        for(let j=0;j<3;j++){x+=positions.getX(i+j)*weights[j];y+=positions.getY(i+j)*weights[j];z+=positions.getZ(i+j)*weights[j];}
        assert(Math.abs(y-terrain.heightAt(x,z)-lift)<6e-6,name+' face neither tunnels nor bridges over support');
        assert(mesh.geometry.attributes.normal.getY(i)>.86,name+' faces up on traversable grades');
        maxRoadHeight=Math.max(maxRoadHeight,y);if(y>.2)nonflat++;samples++;
      }
    }
  }
  const curbSides=world.group.getObjectByName(id+'-road-curbSides').geometry.attributes.position;
  assert(curbSides.count>500,id+' curbs have real raised side faces');
  for(let i=0;i<curbSides.count;i++) {
    const lift=curbSides.getY(i)-terrain.heightAt(curbSides.getX(i),curbSides.getZ(i));
    assert(Math.abs(lift-.018)<6e-6||Math.abs(lift-.055)<6e-6,id+' curb lip begins/ends on supported shoulders');
  }
  const fence=world.group.getObjectByName(id+'-catch-fence');
  assert.equal(fence.userData.boundaryHeight,terrain.wallHeight,id+' visible catch fence matches collision height');
  fence.geometry.computeBoundingBox();assert(Math.abs(fence.geometry.boundingBox.max.y-terrain.wallHeight)<1e-6,id+' fence reaches exact collision top');
  // Roads leave every original cover island clear, including the Frost
  // crosscut that bends between the broad rink and the edge rock pockets.
  const road=world.group.getObjectByName(id+'-road-road').geometry.attributes.position;
  for(let i=0;i<road.count;i++)for(const b of map.blocks)
    assert(!(Math.abs(road.getX(i)-b.x)<b.hw&&Math.abs(road.getZ(i)-b.z)<b.hd),id+' road avoids solid cover hull');
  assert(maxRoadHeight>(map.half===30?.5:2),id+' roads climb and descend inside playable arena');
  assert(nonflat>100,id+' actual elevated road faces');
  // Flat authored footprints stay authoritative: textures/props cannot
  // make a pad or grip region hover over raised driving geometry.
  for(const rect of [...map.blocks,...map.pads,...map.surfaces])for(const u of [-1,0,1])for(const v of [-1,0,1])
    assert.equal(terrain.heightAt(rect.x+u*rect.hw,rect.z+v*rect.hd),0,id+' original rectangle foundation is level');
  const stats=world.stats();assert(stats.triangles<85000&&stats.drawCalls<160,id+' bounded full fallback world');
  const nodes=[],resources=[];world.group.traverse(o=>{nodes.push(o);if(o.isMesh)resources.push([o.geometry,o.material,o.geometry.attributes.position.array]);});
  const beforeConstructions=constructions;
  for(let i=0;i<180;i++){world.syncMap(map);world.animate(1/60,i/60,i/180);}
  assert.equal(constructions,beforeConstructions,id+' unchanged animation allocates no Three objects');
  const after=[],afterResources=[];world.group.traverse(o=>{after.push(o);if(o.isMesh)afterResources.push([o.geometry,o.material,o.geometry.attributes.position.array]);});
  assert.deepEqual(after,nodes,id+' world remains static across unchanged snapshots/sunset');
  assert.equal(afterResources.length,resources.length);
  for(let i=0;i<resources.length;i++)for(let j=0;j<3;j++)assert.strictEqual(afterResources[i][j],resources[i][j],id+' animation preserves each geometry/material/buffer identity');
  reports.push({id,samples,maxRoadHeight,world:stats});
}
const map={id:'garden',...maps.mapDef('garden')},terrain=createRoadTerrain(map);
const mineHeight=terrain.heightAt(38,-35),g={physical:true,x:38,y:mineHeight,z:-35,vx:0,vy:-10,vz:100,fuse:2};
const flight=grenadePose(g,{simAt:1000,map},1100);
assert.equal(flight.z,g.z,'physical grenade lead never ghosts through an unseen hill');
assert.equal(flight.y,g.y,'physical grenade uses accepted ground-relative XYZ');
const feedback=createKartFeedback(),base={instanceId:'hill-fx',phase:'drive',simAt:1000,map,karts:[{pid:'a',x:38,z:-35,angle:0},{pid:'b',x:38,z:-34,angle:0}],events:[]};
feedback.ingest(base,1000);
const position={x:38,y:mineHeight+1,z:-35};
feedback.ingest({...base,simAt:1050,events:[{id:'emp-height',type:'fire',weapon:'emp',pid:'a',position},{id:'ko-height',type:'ko',pid:'a',other:'b',position}]},1050);
assert(feedback.current(1050).filter(e=>['ko','emp'].includes(e.kind)).every(e=>e.position.y===position.y),'accepted EMP and KO effects retain hill height');
console.log(JSON.stringify({pass:true,reports,scope:'Actual Three geometry/support plane/ownership checks; native visuals and frame pacing tested separately.'}));
