'use strict';
/* Build the portable versioned Game Kit archive (local only — never
 * published to npm). Preserves repo-relative paths so every relative
 * require/import inside the kit resolves identically in the repo and in
 * the unpacked kit; no repo or node_modules access is needed to use it.
 *
 * Run: node scripts/package-game-kit.js [--out <path>] [--list]
 *   --out <path>  archive destination
 *                 (default: sdk/dist/giggle-game-kit-<version>.tgz)
 *   --list        print the version + file manifest without building
 *
 * Contents: sdk/* entries + CLI, scripts/check-game.js (unmodified, for
 * `game-kit check`), scripts/templates/*, games/_sdk.js + _validate.js +
 * engines/* with word data, the browser toolkit/renderers/engines/util,
 * camera CSS, and the pinned local Three.js vendor build with its
 * license. chess.js is NOT bundled (pinned npm dep; see README).
 * A generated public/js/package.json ({"type":"module"}) is added so the
 * packed browser graph imports as ESM under plain Node; the kit root —
 * sdk/server.js, sdk/scaffold.js, games/engines/* — stays CommonJS.
 *
 * The archive uses the npm tarball layout (a top-level package/
 * directory), so both `npm install ./giggle-game-kit-<v>.tgz` and plain
 * `tar -xzf` work. Unpacking by hand yields ./package/<kit files>.
 */

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* [repo-relative source, stage-relative destination]. sdk/package.json
 * becomes the kit root package.json; everything else keeps its path. */
function manifest() {
  const files = [
    ['sdk/package.json', 'package.json'],
    ['sdk/server.js', 'sdk/server.js'],
    ['sdk/browser.mjs', 'sdk/browser.mjs'],
    ['sdk/cli.js', 'sdk/cli.js'],
    ['sdk/scaffold.js', 'sdk/scaffold.js'],
    ['scripts/check-game.js', 'scripts/check-game.js'],
    ['games/_sdk.js', 'games/_sdk.js'],
    ['games/_validate.js', 'games/_validate.js'],
    ['public/js/util.js', 'public/js/util.js'],
    ['public/js/game-client.js', 'public/js/game-client.js'],
    ['public/js/game-protocol.mjs', 'public/js/game-protocol.mjs'],
    ['public/css/camera-party.css', 'public/css/camera-party.css'],
    ['public/css/kart-arena.css', 'public/css/kart-arena.css'],
    ['public/vendor/three/three.module.js', 'public/vendor/three/three.module.js'],
    ['public/vendor/three/three.core.js', 'public/vendor/three/three.core.js'],
    ['public/vendor/three/LICENSE', 'public/vendor/three/LICENSE'],
    ['public/vendor/three/VERSION', 'public/vendor/three/VERSION'],
    ['public/vendor/rapier/rapier.mjs','public/vendor/rapier/rapier.mjs'],
    ['public/vendor/rapier/LICENSE','public/vendor/rapier/LICENSE'],
    ['public/vendor/rapier/VERSION','public/vendor/rapier/VERSION'],
    ['public/vendor/rapier/NOTICE.txt','public/vendor/rapier/NOTICE.txt'],
  ];
  // The exported kart result view renders these legacy arena previews.
  for (const arena of ['ring', 'blocks', 'garden', 'frost', 'neon']) {
    const file = `public/assets/karts/previews/legacy-${arena}.webp`;
    files.push([file, file]);
  }
  for (const dir of ['scripts/templates', 'games/engines', 'public/js/toolkit', 'public/js/engines', 'public/js/renderers']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).sort()) {
      if (dir === 'games/engines' && !/\.(js|txt|json)$/.test(f)) continue;
      if (dir !== 'games/engines' && !/\.(js|mjs|tpl|css)$/.test(f)) continue;
      files.push([`${dir}/${f}`, `${dir}/${f}`]);
    }
  }
  for (const dir of ['public/vendor/three/libs', 'public/vendor/three/loaders', 'public/vendor/three/utils', 'public/assets/karts', 'public/assets/karts/combat', 'public/assets/karts/audio', 'public/assets/karts/weapon-thumbnails']) {
    if (!fs.existsSync(path.join(ROOT, dir))) continue;
    for (const f of fs.readdirSync(path.join(ROOT, dir)).sort()) {
      if (!/\.(js|mjs|glb|txt|md|json|wav|mp3|png)$/.test(f)) continue;
      files.push([`${dir}/${f}`, `${dir}/${f}`]);
    }
  }
  return files;
}

/* Generated (not copied from the repo): an ESM package boundary for the
 * packed browser graph. The kit root stays CommonJS (sdk/server.js,
 * sdk/scaffold.js, games/engines/*), while public/js/*.js are
 * ESM-for-browsers; without this boundary plain Node parses them as
 * CommonJS and `import 'giggle-game-kit/browser'` fails. Generated at
 * pack time so the repo tree itself is untouched and no browser source
 * is forked or rewritten. */
const GENERATED_ESM_BOUNDARY = ['public/js/package.json', '{"type":"module"}\n'];

function kitVersionFrom(src, rel) {
  const m = src.match(/KIT_VERSION\s*=\s*'([^']+)'/);
  if (!m) throw new Error(`${rel} has no KIT_VERSION constant.`);
  return m[1];
}

function checkVersions() {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const kitPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'sdk', 'package.json'), 'utf8'));
  const versions = new Map([['package.json (root)', rootPkg.version], ['sdk/package.json', kitPkg.version]]);
  for (const rel of ['sdk/server.js', 'sdk/browser.mjs', 'sdk/scaffold.js']) {
    versions.set(rel, kitVersionFrom(fs.readFileSync(path.join(ROOT, rel), 'utf8'), rel));
  }
  const distinct = new Set(versions.values());
  if (distinct.size !== 1) {
    const detail = [...versions.entries()].map(([k, v]) => `${k}=${v}`).join(', ');
    throw new Error(`version drift (keep every KIT_VERSION + both package.json versions in sync): ${detail}`);
  }
  if (!kitPkg.private) throw new Error('sdk/package.json must stay "private": true (never publish the kit).');
  if (kitPkg.dependencies && Object.keys(kitPkg.dependencies).length) {
    throw new Error('sdk/package.json must keep zero dependencies (the kit is self-contained).');
  }
  return { version: rootPkg.version, kitPkg };
}

function readme(version) {
  return `# giggle-game-kit ${version} (local archive — do not publish)

Portable Game Kit: reusable engine factories, browser toolkit helpers, and a
game scaffolder. No dependencies; no repo access needed to use it.

## Install (pick one)

\`\`\`sh
npm install ./giggle-game-kit-${version}.tgz   # registers the game-kit CLI
# or: tar -xzf giggle-game-kit-${version}.tgz -C kit && node kit/package/sdk/cli.js list
\`\`\`

## Use

\`\`\`js
// Server (Node, CommonJS): engine factories + shared helpers + validation.
const kit = require('giggle-game-kit/server');
const def = kit.kart.createKartGame({ id: 'my-karts', name: 'My Karts' });
const game = kit.camera.createCameraParty({ id: 'my-cam', mode: 'gallery' });
\`\`\`

\`\`\`js
// Browser (ESM): canvas/input/audio/voice/3D factories + view helpers.
import { createCanvasView, createInput, createSoundBank } from 'giggle-game-kit/browser';
// (Bundlers resolve the specifier; without one, serve this directory and
// import sdk/browser.mjs by URL — its imports are all relative.)
\`\`\`

\`\`\`sh
game-kit list                      # templates + engines + toolkit
game-kit inspect camera            # one piece in detail
game-kit create my-game --root ./my-party --template camera
game-kit create my-world --root ./my-party --template frame
game-kit check my-game --root ./my-party
\`\`\`

## Included

sdk/* entries + CLI, scripts/check-game.js, scripts/templates/*,
games/_sdk.js + games/_validate.js + games/engines/* (with the offline
English word list), public/js toolkit/renderers/engines/util,
the optional headless createGameClient room adapter (game-client.js +
game-protocol.mjs), a frame template with game-owned home/browser documents,
public/css/camera-party.css, and the pinned local Three.js vendor build
(public/vendor/three/*, MIT — see its LICENSE; serve the directory at
/vendor/three/ so the shared helper's dynamic import resolves).

## Not included

- chess.js (pinned rules library, 1.4.0): install it yourself if your game
  requires it — the kit never bundles npm packages.
- Bridge secrets, auth tickets, room transport, server internals: the kit
  exports game factories only, never Giggle Meet credentials or plumbing.
- Views stay autonomous: every factory is optional. Ship bespoke
  HTML/CSS/canvas/WebGL/WASM engine exports against the same snapshots.
  Frame documents need no default export or shared styles. The platform
  hosts their assets and mediates rooms and calls through createGameClient.
`;
}

function fail(msg) {
  console.error('package-game-kit:', msg);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  let out = null;
  let listOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out') {
      out = args[++i] || '';
      if (!out) fail('missing value for --out');
    } else if (args[i] === '--list') {
      listOnly = true;
    } else if (args[i] === '--help' || args[i] === '-h' || args[i] === 'help') {
      console.log('usage: node scripts/package-game-kit.js [--out <path>] [--list]');
      return;
    } else {
      fail(`unexpected argument "${args[i]}"`);
    }
  }
  let version;
  try {
    version = checkVersions().version;
  } catch (e) {
    fail(e.message);
  }
  const files = manifest();
  for (const [src] of files) {
    if (!fs.existsSync(path.join(ROOT, src))) fail(`missing source file ${src}`);
  }
  if (listOnly) {
    console.log(`giggle-game-kit ${version} (${files.length} files + README.md + ${GENERATED_ESM_BOUNDARY[0]} (generated))`);
    for (const [, dest] of files) console.log('  ' + dest);
    console.log('  ' + GENERATED_ESM_BOUNDARY[0] + ' (generated)');
    return;
  }
  const tar = spawnSync('tar', ['--version'], { encoding: 'utf8' });
  if (tar.error || tar.status !== 0) fail('needs a `tar` binary on PATH to write the archive.');
  const dest = out ? path.resolve(out) : path.join(ROOT, 'sdk', 'dist', `giggle-game-kit-${version}.tgz`);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'game-kit-pack-'));
  try {
    for (const [src, rel] of files) {
      const target = path.join(stage, 'package', rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(ROOT, src), target);
    }
    fs.writeFileSync(path.join(stage, 'package', 'README.md'), readme(version));
    const [genRel, genBody] = GENERATED_ESM_BOUNDARY;
    const genTarget = path.join(stage, 'package', genRel);
    fs.mkdirSync(path.dirname(genTarget), { recursive: true });
    fs.writeFileSync(genTarget, genBody);
    try {
      fs.chmodSync(path.join(stage, 'package', 'sdk', 'cli.js'), 0o755);
    } catch { /* best effort; node <path> always works */ }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const r = spawnSync('tar', ['-czf', dest, '-C', stage, 'package'], { encoding: 'utf8' });
    if (r.status !== 0) fail(`tar failed: ${(r.stderr || '').trim()}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  const bytes = fs.statSync(dest).size;
  const sha = crypto.createHash('sha256').update(fs.readFileSync(dest)).digest('hex');
  console.log(`KIT_PACK giggle-game-kit-${version}.tgz (${files.length + 2} files, ${bytes} bytes, sha256 ${sha.slice(0, 16)}…)`);
  console.log('  ' + dest);
}

if (require.main === module) main();

module.exports = { manifest, checkVersions };
