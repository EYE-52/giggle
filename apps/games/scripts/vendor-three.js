'use strict';
/* Vendor the pinned Three.js browser build into public/vendor/three/.
 * three@0.186.1's ESM entry (three.module.js) imports its sibling
 * three.core.js by relative path, so BOTH files must be served together —
 * never copy one without the other. Run: npm run vendor
 * (also runs on postinstall so fresh checkouts can play offline).
 * No CDN: play time makes zero network requests for 3D. */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WANT = {
  three: '0.186.1',
  '@dimforge/rapier3d-compat': '0.21.0',
};

function fail(msg) {
  console.error('vendor-three:', msg);
  process.exit(1);
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const [name, ver] of Object.entries(WANT)) {
    const got = (pkg.dependencies && pkg.dependencies[name]) || '';
    if (got !== ver) fail(`${name} must be pinned to exactly ${ver} (saw "${got}")`);
    const installed = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
    if (installed !== ver) fail(`${name} installed ${installed}, want ${ver} — run npm install`);
  }
  const src = path.join(ROOT, 'node_modules', 'three', 'build');
  const dest = path.join(ROOT, 'public', 'vendor', 'three');
  const files = ['three.module.js', 'three.core.js'];
  for (const f of files) {
    if (!fs.existsSync(path.join(src, f))) fail(`node_modules/three/build/${f} missing`);
  }
  // Refuse to serve a lone three.module.js: the ESM entry hard-imports
  // ./three.core.js, so a partial copy would 404 at play time.
  const entry = fs.readFileSync(path.join(src, 'three.module.js'), 'utf8');
  if (!entry.includes('./three.core.js')) fail('three.module.js no longer imports ./three.core.js — update this script');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(src, f), path.join(dest, f));
  // GLB assets use Three's own loader and utilities, from the same pinned build.
  const addons = ['loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js', 'libs/meshopt_decoder.module.js'];
  for (const rel of addons) {
    const input = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', rel);
    const output = path.join(dest, rel === 'libs/meshopt_decoder.module.js' ? 'libs/meshopt_decoder.mjs' : rel);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, fs.readFileSync(input, 'utf8').replace(/from 'three'/g, "from '../three.module.js'"));
  }
  const meshoptLicense = fs.readFileSync(path.join(ROOT, 'node_modules', 'three', 'LICENSE'), 'utf8')
    .replace('Copyright © 2010-2026 three.js authors', 'Copyright (c) 2016-2026 Arseny Kapoulkine');
  fs.writeFileSync(path.join(dest, 'libs', 'LICENSE.meshopt.txt'), meshoptLicense);
  fs.copyFileSync(
    path.join(ROOT, 'node_modules', 'three', 'LICENSE'),
    path.join(dest, 'LICENSE'));
  fs.writeFileSync(path.join(dest, 'VERSION'),
    `three@${WANT.three} vendored from node_modules (MIT, Three.js Authors).\n` +
    `Regenerate: npm run vendor (copies the Three build, GLTFLoader, its utilities and LICENSE).\n`);
  const rapierSrc=path.join(ROOT,'node_modules','@dimforge','rapier3d-compat');
  const rapierDest=path.join(ROOT,'public','vendor','rapier');
  fs.mkdirSync(rapierDest,{recursive:true});
  fs.copyFileSync(path.join(rapierSrc,'dist','rapier.mjs'),path.join(rapierDest,'rapier.mjs'));
  fs.copyFileSync(path.join(rapierSrc,'LICENSE'),path.join(rapierDest,'LICENSE'));
  fs.writeFileSync(path.join(rapierDest,'VERSION'),'@dimforge/rapier3d-compat@0.21.0; regenerate with npm run vendor.\n');
  console.log(`vendor-three: public/vendor/three/three.{module,core}.js @ ${WANT.three}`);
}

main();
