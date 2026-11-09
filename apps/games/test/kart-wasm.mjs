import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const source=await fs.readFile(new URL('public/vendor/rapier/rapier.mjs',root),'utf8');
const wasm=await fs.readFile(new URL('public/vendor/rapier/rapier.wasm',root));
const upstream=await fs.readFile(new URL('node_modules/@dimforge/rapier3d-compat/dist/rapier.mjs',root),'utf8');
const original=upstream.match(/oC\.toByteArray\("(AGFzbQ[A-Za-z0-9+/=]+)"\)\.buffer/);
assert.deepEqual(wasm,Buffer.from(original[1],'base64'),'extraction preserves the pinned physics binary exactly');
assert(!source.includes(original[1]));assert(source.length<250000);
assert(WebAssembly.validate(wasm));
const nativeFetch=globalThis.fetch,nativeStreaming=WebAssembly.instantiateStreaming;
try {
  // A fresh module for each wasm-bindgen singleton. Real compilation and a
  // physics step on both streaming and no-streaming fallback paths.
  for(const streaming of [true,false]){
    let streamed=0,downloads=0;
    WebAssembly.instantiateStreaming=streaming?async(...args)=>{streamed++;return nativeStreaming(...args);}:undefined;
    globalThis.fetch=async url=>{
      assert.equal(new URL(url).pathname,new URL('public/vendor/rapier/rapier.wasm',root).pathname);downloads++;
      return new Response(wasm,{headers:{'Content-Type':'application/wasm'}});
    };
    const {default:R}=await import(new URL(`public/vendor/rapier/rapier.mjs?stream=${streaming}`,root));
    await R.init();assert.equal(R.version(),'0.21.0');assert.equal(downloads,1);assert.equal(streamed,streaming?1:0);
    const world=new R.World({x:0,y:-9.81,z:0});const body=world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0,3,0));
    world.createCollider(R.ColliderDesc.ball(.5),body);world.step();assert(body.translation().y<3);world.free();
  }
}finally{globalThis.fetch=nativeFetch;WebAssembly.instantiateStreaming=nativeStreaming;}
const vercel=JSON.parse(await fs.readFile(new URL('vercel.json',root)));
assert(vercel.headers.some(rule=>rule.source.includes('.wasm')&&rule.headers.some(h=>h.key==='Content-Type'&&h.value==='application/wasm')));
console.log('KART_WASM_PASS: exact binary, streaming, fallback and real physics step');
