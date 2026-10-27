#!/usr/bin/env node
'use strict';
/* Game Kit CLI: inspect the kit and scaffold games from its templates.
 * Works from the repo (node sdk/cli.js …) and from the packed kit
 * (npx game-kit … after `npm install <kit.tgz>`, or node <kit>/sdk/cli.js).
 *
 * Commands:
 *   list                        templates + engines + toolkit factories
 *   inspect <name>              one template/engine/toolkit piece in detail
 *   create <id> [--root <dir>] [--template <name>] [--renderer3d]
 *   check <id> [--root <dir>]   run the kit's check-game on a scaffold
 *   version | --version         kit version
 *   help | --help               this text
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { KIT_VERSION, TEMPLATES, generate, titleCase } = require('./scaffold');

const KIT_ROOT = path.join(__dirname, '..');

const TEMPLATE_INFO = {
  frame: 'Game-owned HTML home and browser document. Bring any browser engine, bundler or style; subscribe/send uses the platform room.',
  starter: 'DOM starter (answer -> vote -> reveal). Server: phases, hidden votes, validated settings + packs. Client: mount/update/dispose.',
  '3d': 'Three.js starter on the shared GL helper + 2D fallback. Server sim, validated intents, 10 Hz tick; renderer: 3d.',
  kart: 'Thin kart-arena config on the shared kart engine (no copied sim/view). Configures modes, maps, goals, palette.',
  camera: 'Thin camera-party config on the shared camera engine + shared renderer. The video call is the playfield; nothing is recorded.',
};

const ENGINE_INFO = {
  'kart-engine': 'createKartGame(config): 10 Hz kinematic arena sim, countdown/drive/done, Star Rush + Zap Battle rules, ties share the win.',
  'kart-maps': 'mapDef/normalizeMapId: arena layouts, collision blocks, spawn spots. Snapshots carry {map:{id,blocks}}.',
  'camera-party': 'createCameraParty({id, mode}): spotlight/gallery perform -> vote -> reveal loop, secret ballots, server deadlines.',
  'build-battle': 'createBuildBattle(config): declarative build-and-battle arena rules from plain config data.',
  'block-siege': 'createBlockSiege(config): finite block-card hands, support/collapse, Crown survival, swept siege shots and round wins for 2–4 castles.',
  'chain-reaction': 'createChainReaction(config) + geometry/resolveCascade/legalMoves: orb-burst capture rules.',
  'english-dictionary': 'createWordValidator/normalizeWord/isSubset: offline word checks over the bundled SCOWL-derived list.',
  'semantic-guess': 'createSemanticGuess/createEmbeddingProvider/cosine: similarity-guess rules over caller-supplied embeddings.',
  'word-hints': 'maskWord/hiddenLetters/revealLetter: pure hidden-word hint math.',
};

const TOOLKIT_INFO = {
  canvas: 'createCanvasView: DPR-aware 2D canvas lifecycle + rAF loop + full disposal.',
  input: 'createInput: keyboard/pointer intents with focus guards and guaranteed release.',
  audio: 'createSoundBank: gesture-unlocked WebAudio cues (click/turn/tick/join/win/lose/error).',
  voice: 'createVoiceClient: voice-over-parent-call facade. The game never captures media.',
  arena: 'createArenaControls: game-owned orbit camera, hover picking, tap/drag separation and wheel/pinch zoom; provide your own scene and HUD.',
  three: 'createThreeView: pinned local Three.js GL lifecycle only; {fallback:true} for 2D same-snapshot views.',
  session: 'createSessionToolkit: opt-in composer that builds several pieces and disposes them together.',
};

function usage() {
  return [
    `game-kit ${KIT_VERSION}: portable local Game Kit (not published to npm)`,
    '',
    'Usage:',
    '  game-kit list',
    '  game-kit inspect <template|engine|toolkit name>',
    '  game-kit create <safe-id> [--root <dir>] [--template <name>] [--renderer3d]',
    '  game-kit check <safe-id> [--root <dir>]',
    '  game-kit version | help',
    '',
    `Templates: ${TEMPLATES.join(', ')}`,
    'Safe ids: 2-40 chars, lowercase letters/digits/dashes. Never overwrites.',
  ].join('\n');
}

function fail(msg) {
  console.error('game-kit: ' + msg);
  process.exit(1);
}

function cmdList() {
  console.log(`game-kit ${KIT_VERSION}`);
  console.log('');
  console.log('Templates:');
  for (const t of TEMPLATES) console.log(`  ${t} — ${TEMPLATE_INFO[t]}`);
  console.log('');
  console.log('Server engines (require via giggle-game-kit/server):');
  for (const k of Object.keys(ENGINE_INFO)) console.log(`  ${k} — ${ENGINE_INFO[k]}`);
  console.log('');
  console.log('Browser toolkit (import via giggle-game-kit/browser):');
  for (const k of Object.keys(TOOLKIT_INFO)) console.log(`  ${k} — ${TOOLKIT_INFO[k]}`);
  console.log('');
  console.log('Scaffold: game-kit create my-game --root ./my-party --template camera');
}

function cmdInspect(name) {
  if (!name) fail('usage: game-kit inspect <name> (try: game-kit list)');
  if (TEMPLATE_INFO[name]) {
    console.log(`${name} (template): ${TEMPLATE_INFO[name]}`);
    console.log(`create: game-kit create <safe-id> --template ${name}`);
    return;
  }
  if (ENGINE_INFO[name]) {
    console.log(`${name} (server engine): ${ENGINE_INFO[name]}`);
    console.log('import: const kit = require(\'giggle-game-kit/server\');');
    return;
  }
  if (TOOLKIT_INFO[name]) {
    console.log(`${name} (browser toolkit): ${TOOLKIT_INFO[name]}`);
    console.log('import: import {...} from \'giggle-game-kit/browser\';');
    return;
  }
  const known = [...TEMPLATES, ...Object.keys(ENGINE_INFO), ...Object.keys(TOOLKIT_INFO)];
  fail(`unknown "${name}" (want one of: ${known.join(', ')})`);
}

function cmdCreate(args) {
  let root = process.cwd();
  let id = null;
  let template = 'starter';
  let renderer3d = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') {
      root = args[++i] || '';
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
  if (!id) fail('usage: game-kit create <safe-id> [--root <dir>] [--template <name>]');
  if (renderer3d && template !== 'starter') fail('use only one of --renderer3d and --template');
  if (renderer3d) template = '3d';
  let res;
  try {
    res = generate(id, { root, template, kitRoot: KIT_ROOT });
  } catch (e) {
    fail(e.message);
  }
  console.log(`game-kit: created ${res.id} (template: ${res.template})`);
  for (const rel of res.files) console.log('  ' + rel);
  console.log(`next: game-kit check ${res.id} --root ${res.root}`);
  console.log('game: ' + titleCase(res.id));
}

function cmdCheck(args) {
  let root = process.cwd();
  let id = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root') {
      root = args[++i] || '';
      if (!root) fail('missing value for --root');
    } else if (!id) {
      id = args[i];
    } else {
      fail(`unexpected argument "${args[i]}"`);
    }
  }
  if (!id) fail('usage: game-kit check <safe-id> [--root <dir>]');
  const checker = path.join(KIT_ROOT, 'scripts', 'check-game.js');
  const r = spawnSync('node', [checker, id, '--root', path.resolve(root)], { stdio: 'inherit' });
  if (r.error) fail(`cannot run the bundled checker: ${r.error.message}`);
  process.exit(r.status === null ? 1 : r.status);
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const cmd = args[0];
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(usage());
    return;
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-V') {
    console.log(KIT_VERSION);
    return;
  }
  if (cmd === 'list') {
    if (args.length > 1) fail('usage: game-kit list');
    cmdList();
    return;
  }
  if (cmd === 'inspect') {
    if (args.length > 2) fail('usage: game-kit inspect <name>');
    cmdInspect(args[1]);
    return;
  }
  if (cmd === 'create') {
    cmdCreate(args.slice(1));
    return;
  }
  if (cmd === 'check') {
    cmdCheck(args.slice(1));
    return;
  }
  fail(`unknown command "${cmd}" (try: game-kit help)`);
}

if (require.main === module) main();

module.exports = { KIT_VERSION, KIT_ROOT };
