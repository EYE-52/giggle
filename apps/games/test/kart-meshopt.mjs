import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from '../public/vendor/three/libs/meshopt_decoder.mjs';
import {KART_ASSETS} from '../public/js/engines/kart-assets.mjs';
globalThis.self=globalThis;
globalThis.createImageBitmap=async()=>({width:512,height:512,close(){}});
await MeshoptDecoder.ready;
const files=['combat/combat','combat/pulse-mounted','combat/arsenal-mounted','combat/arsenal-secondary','giggle-kart','giggle-crate','grandStandCoveredRound'];
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
function json(bytes){return JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());}
function pictures(bytes){const j=json(bytes),bin=bytes.subarray(28+bytes.readUInt32LE(12));return (j.images||[]).map(i=>{const v=j.bufferViews[i.bufferView];return bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength).toString('base64');}).sort();}
function material(m){const result={};for(const key of ['name','type','side','transparent','opacity','alphaTest','metalness','roughness','emissiveIntensity','depthWrite'])result[key]=m[key];for(const key of ['color','emissive'])result[key]=m[key]?.toArray();return result;}
function shape(scene){const nodes=[];scene.updateMatrixWorld(true);scene.traverse(o=>{
 const entry={name:o.name,transform:o.matrix.toArray(),extras:o.userData,mesh:o.isMesh===true};
 if(o.isMesh){const g=o.geometry,keys=Object.keys(g.attributes).sort(),vertices=[];
  const count=g.index?.count??g.attributes.position.count;
  for(let i=0;i<count;i++){const id=g.index?g.index.getX(i):i;vertices.push(JSON.stringify(keys.map(k=>{const a=g.attributes[k];return[k,a.itemSize,Array.from({length:a.itemSize},(_,c)=>a.isInterleavedBufferAttribute?a.data.array[id*a.data.stride+a.offset+c]:a.array[id*a.itemSize+c])];})));}
  entry.triangles=[];for(let i=0;i<count;i+=3){const t=vertices.slice(i,i+3);entry.triangles.push([t.join('|'),[t[1],t[2],t[0]].join('|'),[t[2],t[0],t[1]].join('|')].sort()[0]);}
  entry.material=(Array.isArray(o.material)?o.material:[o.material]).map(material);
 }
 nodes.push(entry);
});return nodes;}
for(const file of files){
 const original=await fs.readFile(new URL('../public/assets/karts/'+file+'.glb',import.meta.url));
 const compressed=await fs.readFile(new URL('../public/assets/karts/'+file+'.meshopt.glb',import.meta.url));
 const j=json(compressed);assert(j.extensionsRequired.includes('EXT_meshopt_compression'),file+' requires the shipped decoder');assert(!j.extensionsUsed?.includes('KHR_mesh_quantization'),file+' has no quantization');
 for(const v of j.bufferViews){const e=v.extensions?.EXT_meshopt_compression;if(e)assert(!e.filter||e.filter==='NONE',file+' uses only lossless NONE filter');}
 assert.deepEqual(pictures(compressed),pictures(original),file+' preserves embedded image bytes');
 const load=b=>loader.parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
 assert.deepEqual(shape((await load(compressed)).scene),shape((await load(original)).scene),file+' preserves decoded triangle attributes, winding, nodes, transforms, extras, materials and draw count');
 // A missing decoder rejects instead of exposing a partial unstyled/unready asset.
 await assert.rejects(new GLTFLoader().parseAsync(compressed.buffer.slice(compressed.byteOffset,compressed.byteOffset+compressed.byteLength),''),/MeshoptDecoder/);
 assert((await load(compressed)).scene.isObject3D,file+' can retry with a ready decoder after failed decode');
}
let total=(await fs.stat(new URL('../public/vendor/three/libs/meshopt_decoder.mjs',import.meta.url))).size;
for(const name of Object.values(KART_ASSETS))total+=(await fs.stat(new URL('../public/assets/karts/'+name+'.glb',import.meta.url))).size;
assert(total<1_000_000,'all declared preload models plus decoder remain under 1MB');
console.log('KART_MESHOPT_PASS: seven exact decoded models, loading failure/retry, unchanged draw counts; '+total+' bytes including decoder');
