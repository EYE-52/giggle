'use strict';
/* Scaffold a playable Game Kit starter.
 * Run: npm run new-game -- <safe-id> [--root <dir>] [--renderer3d]
 *      npm run new-game -- <safe-id> [--root <dir>] --template kart
 *      npm run new-game -- <safe-id> [--root <dir>] --template camera
 * Writes ONLY games/<id>/server.js, public/js/games/<id>.js,
 * locales/en/<id>.json (+ shared helpers into isolated --root
 * workspaces). Refuses overwrites.
 *
 * Templates: starter (default DOM game), 3d (orb-run style sim/input
 * skeleton), kart (thin declarative config on the shared kart-arena
 * engine — no copied simulation or view source), camera (thin config
 * on the shared camera-party engine + shared renderer — the video
 * call is the playfield, nothing is recorded).
 *
 * Also usable in-process (tests): require('./new-game').generate(id,
 * { root, template }) — throws on failure instead of exiting. The
 * generate/titleCase/TEMPLATES surface lives in ../sdk/scaffold.js so
 * the packed kit CLI scaffolds byte-identical games outside this repo.
 */

const path = require('path');
const { generate, titleCase, TEMPLATES } = require('../sdk/scaffold');

function fail(msg) {
  console.error('new-game:', msg);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  let root = path.join(__dirname, '..');
  let id = null;
  let template = 'starter';
  let renderer3d = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') {
      root = path.resolve(args[++i] || '');
      if (!root) fail('missing value for --root');
    } else if (args[i] === '--renderer3d') {
      renderer3d = true;
    } else if (args[i] === '--template') {
      template = args[++i] || '';
      if (!template) fail('missing value for --template');
    } else if (!id) {
      id = args[i];
    } else {
      fail(`unexpected argument "${args[i]}"`);
    }
  }
  if (!id) fail('usage: npm run new-game -- <safe-id> [--renderer3d] [--template kart]');
  if (renderer3d && template !== 'starter') fail('use only one of --renderer3d and --template');
  if (renderer3d) template = '3d';
  let res;
  try {
    res = generate(id, { root, template });
  } catch (e) {
    fail(e.message);
  }
  console.log(`new-game: created ${res.id} (template: ${res.template})`);
  for (const rel of res.files) console.log('  ' + rel);
  console.log(`next: npm run check-game -- ${res.id}`);
  console.log('preview: npm run dev, open the room URL in two browsers, start ' + titleCase(res.id));
}

if (require.main === module) main();

module.exports = { generate, titleCase, TEMPLATES };
