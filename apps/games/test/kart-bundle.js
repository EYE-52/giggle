'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {build}=require('../scripts/build-kart-runtime');
const result=build(false),output=result.outputFiles.find(file=>file.path.endsWith('kart-runtime.mjs'));
const shipped=fs.readFileSync(path.join(__dirname,'../public/js/engines/kart-runtime.mjs'));
assert.ok(shipped.equals(Buffer.from(output.contents)),
  'Shipped kart runtime differs from the engine sources. Run npm run vendor.');
const imports=result.metafile.outputs['public/js/engines/kart-runtime.mjs'].imports;
for(const file of ['./kart-physics-loader.mjs','./kart-prefetch.mjs'])assert(imports.some(item=>item.path===file&&item.external),'warmup and scene share '+file);
assert(imports.every(item=>item.external),'no unresolved runtime imports');
assert(!Buffer.from(output.contents).includes('AGFzbQEAAAAB0hHc'),'physics Wasm is not embedded in the engine bundle');
console.log('KART_BUNDLE_PASS: current source bytes, shared init/cache and external vendor loading');
