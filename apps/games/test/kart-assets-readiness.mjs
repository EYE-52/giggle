import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {batchKartBody} from '../public/js/engines/kart-batching.mjs';
import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
await MeshoptDecoder.ready;globalThis.self=globalThis;globalThis.createImageBitmap=async()=>({width:512,height:512,close(){}});
const source=(await fs.readFile(new URL('../public/js/engines/kart-assets.mjs',import.meta.url),'utf8'))
 .replace(/^import .*;$/gm,'').replace(/^export \{MeshoptDecoder\};$/m,'').replaceAll('export ','')
 .replace("await import('../../vendor/three/loaders/GLTFLoader.js')",'({GLTFLoader:Loader})')
 .replace("await import('../../vendor/three/utils/BufferGeometryUtils.js')",'({mergeGeometries:merge})');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const ticks=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function create(ready){const pending=new Map();class Loader extends GLTFLoader{loadAsync(url){const gate=deferred();pending.set(url,gate);return gate.promise;}}
 const Image=class{async decode(){}};
 const api=new Function('MeshoptDecoder','Loader','merge','batchKartBody','Image',source+'\nreturn {loadKartAssets};')({...MeshoptDecoder,ready},Loader,mergeGeometries,batchKartBody,Image);
 return{...api,pending};}
async function finish(gate,url){const b=await fs.readFile(new URL('../public'+url.split('?')[0],import.meta.url));const real=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);gate.resolve(await real.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),''));}
const decoder=deferred(),asset=create(decoder.promise);let settled=false;
const scene=new THREE.Scene();const preparing=asset.loadKartAssets(THREE,scene).then(x=>{settled=true;return x;});
await ticks();assert.equal(asset.pending.size,0,'No GLB request or usable asset before decoder initializes');decoder.resolve();await new Promise(resolve=>setImmediate(resolve));await ticks();assert.equal(asset.pending.size,18,'All declared GLBs start after decoder readiness');
const delayed=[...asset.pending].find(([url])=>url.includes('pulse-mounted'));
await Promise.all([...asset.pending].filter(([url])=>url!==delayed[0]).map(([url,gate])=>finish(gate,url)));
await ticks();assert.equal(settled,false,'An unresolved required compressed weapon blocks loader completion');await finish(delayed[1],delayed[0]);const assets=await preparing;assert(assets.pulse.getObjectByName('Pulse'),'Real mounted weapon exists when prepare resolves');
const failure=create(Promise.resolve()),failed=failure.loadKartAssets(THREE,new THREE.Scene());const expected=assert.rejects(failed,/intentional required asset failure/);await new Promise(resolve=>setImmediate(resolve));await ticks();
await Promise.all([...failure.pending].map(([url,gate])=>url.includes('pulse-mounted')?(gate.reject(Error('intentional required asset failure')),null):finish(gate,url)));await expected;
const retry=create(Promise.resolve()),retried=retry.loadKartAssets(THREE,new THREE.Scene());await new Promise(resolve=>setImmediate(resolve));await ticks();await Promise.all([...retry.pending].map(([url,gate])=>finish(gate,url)));assert((await retried).pulse.getObjectByName('Pulse'),'Fresh preparation succeeds after required compressed asset failure');
const rejected=deferred(),bad=create(rejected.promise);const denied=assert.rejects(bad.loadKartAssets(THREE,new THREE.Scene()),/decoder unavailable/);rejected.reject(Error('decoder unavailable'));await denied;assert.equal(bad.pending.size,0,'Decoder failure does not start assets or report ready');
console.log('KART_ASSET_READINESS_PASS: decoder barrier, delayed real compressed model, required failure, fresh retry');
