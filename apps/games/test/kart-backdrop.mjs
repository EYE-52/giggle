import assert from 'node:assert/strict';
import * as THREE from 'three';
import classic from '../games/engines/kart-maps.js';
import adapter from '../games/engines/kart-elevated-adapter.js';
import {elevatedMapIds} from '../public/js/engines/kart-elevated-maps.mjs';
import {createKartWorld,resolveMapTheme,WORLD_THEMES} from '../public/js/engines/kart-world.mjs';
import {createKartElevatedWorld} from '../public/js/engines/kart-elevated-world.mjs';
import {BACKDROP_THEMES,CLOUD_FILES,createKartBackdrop,createKartClouds} from '../public/js/engines/kart-backdrop.mjs';

const themes=new Set([...WORLD_THEMES,...classic.mapIds().map(id=>resolveMapTheme(classic.mapDef(id))),
  ...elevatedMapIds,...Object.values(adapter.MAP_LABELS)]);
assert.deepEqual(Object.keys(BACKDROP_THEMES).sort(),[...themes].sort(),'Every rendered classic and elevated theme has a panorama');
for(const entry of Object.values(BACKDROP_THEMES))assert(entry.file.endsWith('.webp')&&entry.aspect>0&&entry.aspect<1);

function releaseClassic(world){
  world.dispose();
  const owned=new Set();world.group.traverse(o=>{
    if(o.geometry&&!o.isSprite)owned.add(o.geometry); // Sprite geometry belongs to Three, shared across worlds.
    for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){owned.add(m);if(m.map)owned.add(m.map);}
  });
  for(const resource of owned)resource.dispose();world.group.removeFromParent();
}
const originalDocument=globalThis.document;
const requests=[];
const testThree={...THREE,TextureLoader:class{load(url,onLoad,progress,onError){requests.push({url,onLoad,onError});}}};
const freshTexture=()=>new THREE.Texture({width:64,height:32});
const succeed=request=>{const tex=freshTexture();request.onLoad(tex);return tex;};
function cloudsInView(layer,elevated=false){
  const camera=new THREE.PerspectiveCamera(elevated?52:60,16/9,.1,elevated?650:400);
  camera.position.set(0,elevated?5.05:3.2,elevated?-8.5:-8.8);camera.lookAt(0,elevated?2.05:1.6,elevated?4:5);camera.updateMatrixWorld(true);
  return layer.children.some(s=>{
    const corners=[[-1,-1],[-1,1],[1,1],[1,-1]].map(([x,y])=>new THREE.Vector3(x*s.scale.x/2,y*s.scale.y/2,0).applyQuaternion(camera.quaternion).add(s.position).project(camera));
    return Math.max(...corners.map(p=>p.x))>=-1&&Math.min(...corners.map(p=>p.x))<=1&&Math.max(...corners.map(p=>p.y))>=-1&&Math.min(...corners.map(p=>p.y))<=1&&corners.some(p=>p.z>-1&&p.z<1);
  });
}
try{
  delete globalThis.document;
  for(const id of classic.mapIds()){
    const world=createKartWorld(testThree,{scene:new THREE.Scene(),map:{id,...classic.mapDef(id)}});
    assert(!world.group.getObjectByName('mountain-backdrop'));
    const clouds=world.group.children.filter(o=>o.name==='cloud');
    assert(clouds.length>=3&&clouds.every(c=>c.children.length===3&&c.children.every(p=>p.visible&&p.isMesh)),'Headless classic keeps sphere clouds');
    if(id!=='neon')assert(world.group.getObjectByName('ridge-summit').visible,'Headless classic keeps ridges');
    releaseClassic(world);
  }
  for(const id of elevatedMapIds){
    const world=createKartElevatedWorld(testThree,{scene:new THREE.Scene(),map:id});
    assert(!world.group.getObjectByName('mountain-backdrop'));
    if(id==='garden'||id==='frost')assert(world.group.getObjectByName('alpine-distant-ridges').visible);
    world.dispose();
  }
  const styled=createKartElevatedWorld(testThree,{scene:new THREE.Scene(),map:'garden',assets:{stylized:new THREE.Group()}});
  assert(styled.group.getObjectByName('stylized-soft-clouds').visible,'Headless elevated keeps its instanced sphere clouds');
  assert(styled.group.getObjectByName('stylized-snow-peak-5').visible);
  styled.dispose();assert.equal(requests.length,0,'Headless worlds never construct an image loader');

  const scene=new THREE.Scene(),parent=new THREE.Group(),ridge=new THREE.Group(),sphere=new THREE.Group();scene.add(parent);parent.add(ridge,sphere);
  globalThis.document={};
  createKartBackdrop(testThree,{parent,theme:'frost',radius:255,ridges:[ridge]});
  createKartClouds(testThree,{parent,radius:255,peakHeight:90,color:new THREE.Color(),fallback:[sphere]});
  assert.equal(requests.length,0,'A partial document without createElementNS is also headless');
  globalThis.document={createElementNS(){assert.fail('The simulated loader handles images');},createElement(){return{getContext:()=>null};}};
  createKartBackdrop(testThree,{parent,theme:'frost',radius:255,ridges:[ridge]});
  requests.shift().onError(new Error('missing panorama'));
  assert(ridge.visible&&!parent.getObjectByName('mountain-backdrop'),'A missing panorama keeps the ridges');
  createKartClouds(testThree,{parent,radius:255,peakHeight:90,color:new THREE.Color(),fallback:[sphere]});
  const partial=succeed(requests.shift());let released=0;partial.addEventListener('dispose',()=>released++);
  requests.shift().onError(new Error('missing cloud'));
  const late=freshTexture();late.addEventListener('dispose',()=>released++);requests.shift().onLoad(late);
  assert(sphere.visible&&!parent.getObjectByName('painted-clouds')&&released===2,'Cloud failure releases partial images and keeps every sphere');

  for(const palette of ['Daybreak','Sunset','Starlight']){
    const world=createKartWorld(testThree,{scene:new THREE.Scene(),map:{id:'garden',...classic.mapDef('garden')},palette});
    const pending=requests.splice(0),puffs=world.group.children.filter(o=>o.name==='cloud').flatMap(o=>o.children);
    const panoramaTexture=succeed(pending.find(r=>r.url.includes('/backdrops/'))),panorama=world.group.getObjectByName('mountain-backdrop');
    assert(!world.group.getObjectByName('ridge-summit').visible&&panorama.material.fog&&panorama.material.side===THREE.BackSide);
    assert.equal(panoramaTexture.colorSpace,THREE.SRGBColorSpace);assert.equal(panoramaTexture.wrapS,THREE.RepeatWrapping);
    assert.deepEqual(panoramaTexture.repeat.toArray(),[4,1]);
    assert.equal(panorama.geometry.parameters.height,2*Math.PI*255/4*BACKDROP_THEMES.garden.aspect*1.6);
    const cloudRequests=pending.filter(r=>r.url.includes('/clouds/'));
    assert.deepEqual(cloudRequests.map(r=>r.url.split('/').at(-1)),CLOUD_FILES);
    succeed(cloudRequests[0]);succeed(cloudRequests[1]);assert(puffs.every(p=>p.visible),'Keep spheres until the whole cloud set loads');
    succeed(cloudRequests[2]);const layer=world.group.getObjectByName('painted-clouds');
    assert.equal(layer.children.length,8);assert(puffs.every(p=>!p.visible));
    assert.equal(new Set(layer.children.map(s=>s.material)).size,3);assert.equal(new Set(layer.children.map(s=>s.geometry)).size,1);
    assert(layer.children.every(s=>s.isSprite&&s.material.color===puffs[0].material.color&&!s.material.depthWrite));
    assert(layer.children.every(s=>Math.hypot(s.position.x,s.position.z)>255&&s.position.y-s.scale.y/2>panorama.position.y+panorama.geometry.parameters.height/2),'Clouds remain above and beyond the peaks');
    assert(cloudsInView(layer),'High clouds remain in the normal classic chase frame');
    assert.equal(layer.visible,palette!=='Starlight','Async cloud load respects the current night visibility');
    const dayTint=panorama.material.color.clone(),position=layer.children[0].position.clone(),stats=world.stats(),nodes=[];
    world.group.traverse(o=>nodes.push(o));
    for(let frame=0;frame<180;frame++)world.animate(1/60,frame/60,frame/179);
    const after=[];world.group.traverse(o=>after.push(o));assert.deepEqual(after,nodes);assert.deepEqual(world.stats(),stats);
    assert(!position.equals(layer.children[0].position),'Loaded billboards drift without adding resources');
    assert.equal(layer.visible,world.group.children.find(o=>o.name==='cloud').visible,'Sprites follow the exact existing day-cycle visibility');
    world.animate(0,0,null);assert(panorama.material.color.equals(dayTint),'Returning to a fixed palette resets panorama tint');
    releaseClassic(world);
  }
  // Quarry exception and the classic city's existing cloud visibility remain intact.
  for(const id of ['blocks','neon']){
    const world=createKartWorld(testThree,{scene:new THREE.Scene(),map:{id,...classic.mapDef(id)}}),pending=requests.splice(0);
    assert.equal(pending.some(r=>r.url.includes('/backdrops/')),id!=='blocks');
    for(const request of pending)succeed(request);
    if(id==='neon')assert(!world.group.getObjectByName('painted-clouds').visible);
    releaseClassic(world);
  }
  for(const id of elevatedMapIds){
    for(const stylized of id==='garden'?[false,true]:[false]){
      const world=createKartElevatedWorld(testThree,{scene:new THREE.Scene(),map:id,assets:stylized?{stylized:new THREE.Group()}:{}});
      const mountains=world.scenery.children.filter(o=>/ridge|foothill|summit|stylized-(snow-peak|valley-hill)/.test(o.name));
      const pending=requests.splice(0),backdropRequest=pending.find(r=>r.url.includes('/backdrops/'));
      assert.equal(backdropRequest.url,'/assets/karts/backdrops/'+BACKDROP_THEMES[id].file,'Elevated map id selects the painting, including both harbor variants');
      const resources=pending.map(succeed),disposals=new Map(resources.map(t=>[t,0]));
      for(const resource of resources)resource.addEventListener('dispose',()=>disposals.set(resource,disposals.get(resource)+1));
      assert(mountains.every(m=>!m.visible),'Loaded elevated panorama hides both mountain styles');
      const panorama=world.group.getObjectByName('mountain-backdrop'),day=panorama.material.color.clone();
      world.animate(1/60,3,1);assert(!panorama.material.color.equals(day),'Elevated night cycle tints the shared panorama');
      if(stylized){
        const clouds=world.group.getObjectByName('painted-clouds'),fallback=world.group.getObjectByName('stylized-soft-clouds');
        assert.equal(clouds.children.length,8);assert(!fallback.visible&&clouds.children[0].material.color===fallback.material.color);
        assert(cloudsInView(clouds,true),'High clouds remain in the narrower elevated chase frame');
      }
      world.dispose();world.dispose();assert([...disposals.values()].every(n=>n===1),'Elevated world owns and disposes loaded textures once');
    }
  }
  for(const elevated of [false,true]){
    const world=elevated?createKartElevatedWorld(testThree,{scene:new THREE.Scene(),map:'garden',assets:{stylized:new THREE.Group()}})
      :createKartWorld(testThree,{scene:new THREE.Scene(),map:{id:'garden',...classic.mapDef('garden')}});
    const pending=requests.splice(0);world.dispose();let retired=0;
    for(const request of pending){const tex=freshTexture();tex.addEventListener('dispose',()=>retired++);request.onLoad(tex);}
    assert.equal(retired,pending.length,'Late image callbacks release textures after world teardown');
    assert(!world.group.getObjectByName('mountain-backdrop')&&!world.group.getObjectByName('painted-clouds'));
    if(!elevated)releaseClassic(world);
  }
}finally{
  if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;
}
console.log('KART_BACKDROP_PASS: all map themes, headless/missing-image fallback, shared billboards, tint/visibility, bounded drift and late-load disposal');
