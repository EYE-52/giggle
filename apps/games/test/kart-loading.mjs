import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as THREE from 'three';
import {matchKartDrivers,loadKartDrivers,matchKartAssetEntries,KART_ELEVATED_FILES} from '../public/js/engines/kart-assets.mjs';
import {createKartModel,kartDriverIndex} from '../public/js/engines/kart-model.mjs';
import {prefetchKartGLB,loadKartGLB} from '../public/js/engines/kart-prefetch.mjs';
import {practiceKartCache} from '../public/js/engines/kart-practice-cache.mjs';
import {fetchKartWasm} from '../public/js/engines/kart-physics-response.mjs';
import {warmPickedKart,warmPracticeKart} from '../public/js/kart-warmup.mjs';
const savedIdle=globalThis.requestIdleCallback;
globalThis.requestIdleCallback=()=>assert.fail('other game warmed karts');
warmPickedKart('chess');warmPickedKart('');globalThis.requestIdleCallback=savedIdle;
const drivers=['fox','bunny','panda','raccoon'];
for(const pid of ['a','b','p1234abcd','seat32'])assert.deepEqual(matchKartDrivers([{pid}],{}),[drivers[kartDriverIndex(pid,4)]]);
assert.deepEqual(matchKartDrivers([{id:'a'},{id:'b'}],{a:{driver:'fox'},b:{driver:'fox'}}),['fox']);
const calls=[];
const loaded=await loadKartDrivers({loadAsync:async url=>{calls.push(url);return {scene:{url}};}},['panda']);
assert.equal(calls.length,1);assert(calls[0].endsWith('/panda.glb'));assert.deepEqual(loaded.map(Boolean),[false,false,true,false]);
const kart=new THREE.Group();kart.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));
const variants=drivers.map((driver,i)=>{const scene=new THREE.Group();scene.add(new THREE.Mesh(new THREE.BoxGeometry(i+1,1,1),new THREE.MeshStandardMaterial()));scene.userData.driver=driver;return scene;});
const firstGeometry=model=>{let geometry;model.traverse(o=>{if(!geometry&&o.isMesh)geometry=o.geometry;});return geometry;};
for(const pid of ['a','b','p1234abcd','seat32']){
 const wanted=variants[kartDriverIndex(pid,4)];
 assert.equal(firstGeometry(createKartModel(THREE,{assets:{kart,kartVariants:[wanted]},driver:pid})),firstGeometry(createKartModel(THREE,{assets:{kart,kartVariants:variants},driver:pid})));
}
assert(matchKartAssetEntries({id:'ring'}).some(([key])=>key==='tree_detailed'));
assert(!matchKartAssetEntries({id:'ring'}).some(([key])=>key==='tree_pineTallA'));
assert(matchKartAssetEntries({id:'garden'}).some(([key])=>key==='tree_pineTallA'));
assert(!matchKartAssetEntries({id:'blocks'}).some(([key])=>key==='rock_largeA'));
const savedFetch=globalThis.fetch;let fetched=0;
try{
 globalThis.fetch=async()=>{fetched++;return new Response(new Uint8Array([1,2,3]));};
 await Promise.all([prefetchKartGLB('/assets/karts/test.glb'),prefetchKartGLB('/assets/karts/test.glb')]);assert.equal(fetched,1);
 const buffers=[],loader={parseAsync:async(data)=>{buffers.push(data);return {scene:{}};},loadAsync:()=>assert.fail('prefetch fetched twice')};
 await loadKartGLB(loader,'/assets/karts/test.glb');await loadKartGLB(loader,'/assets/karts/test.glb');
 assert.notEqual(buffers[0],buffers[1]);assert.deepEqual(new Uint8Array(buffers[1]),new Uint8Array([1,2,3]));
 globalThis.fetch=async()=>{throw Error('offline');};await assert.rejects(prefetchKartGLB('/assets/karts/retry.glb'));
 let retried=0;await loadKartGLB({loadAsync:async()=>{retried++;}},'/assets/karts/retry.glb');assert.equal(retried,1);
}finally{globalThis.fetch=savedFetch;}

// Same-tab practice seats reuse the network response, with private streams.
const previousWindow=globalThis.window,previousLocation=globalThis.location,NativeResponse=globalThis.Response;
try{
 const top={location:{origin:'http://practice.test'},document:{body:{classList:{contains:name=>name==='practice-page'}}}};
 globalThis.location={origin:'http://practice.test'};globalThis.window={top};
 globalThis.Response=class SeatResponse extends NativeResponse {};
 let downloads=0;globalThis.fetch=async()=>{downloads++;return new NativeResponse(new Uint8Array([0,97,115,109]),{headers:{'Content-Type':'application/wasm'}});};
 const [a,b]=await Promise.all([fetchKartWasm('http://practice.test/rapier.wasm'),fetchKartWasm('http://practice.test/rapier.wasm')]);
 assert.equal(downloads,1);assert.notEqual(a,b);assert(a instanceof Response&&b instanceof Response,'wasm responses belong to the consuming seat realm');assert.equal(a.headers.get('Content-Type'),'application/wasm');
 assert.deepEqual(await a.arrayBuffer(),await b.arrayBuffer());
 globalThis.window={get top(){throw Error('cross origin');}};
 assert.equal(practiceKartCache('wasm'),null);
}finally{globalThis.window=previousWindow;globalThis.location=previousLocation;globalThis.fetch=savedFetch;globalThis.Response=NativeResponse;}

// Parent-frame bytes cannot pass GLTFLoader's local instanceof check until copied.
try{
 const foreign=vm.runInNewContext('new Uint8Array([7,8,9]).buffer');
 assert(!(foreign instanceof ArrayBuffer));
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>foreign});
 await prefetchKartGLB('/assets/karts/foreign.glb');
 await loadKartGLB({parseAsync:async data=>{assert(data instanceof ArrayBuffer);assert.deepEqual([...new Uint8Array(data)],[7,8,9]);},loadAsync:()=>assert.fail('foreign bytes caused a duplicate download')},'/assets/karts/foreign.glb');
}finally{globalThis.fetch=savedFetch;}

// A practice seat without explicit settings warms the actual default arena.
const warmUrls=[];
const latestIdle=globalThis.requestIdleCallback;
try{
 globalThis.location={href:'http://practice.test/'};
 globalThis.requestIdleCallback=work=>queueMicrotask(work);
 globalThis.fetch=async url=>{warmUrls.push(String(url));return new Response(new Uint8Array([1,2,3]));};
 warmPracticeKart('pocket-karts');
 const start=Date.now();
 while(!warmUrls.some(url=>url.includes('combat-core'))&&Date.now()-start<3000)await new Promise(resolve=>setTimeout(resolve,10));
 for(const [key,file,version] of KART_ELEVATED_FILES){
   assert(warmUrls.includes(`/assets/karts/${file}.glb?v=${version}`),'default warmup uses the scene URL for '+key);
 }
}finally{
 globalThis.fetch=savedFetch;globalThis.location=previousLocation;globalThis.requestIdleCallback=latestIdle;
}

console.log('KART_LOADING_PASS: scoped warmup, selected drivers, stable visuals, map assets, shared cross-realm bytes and retry');
