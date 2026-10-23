'use strict';
/* Game Kit tests: the packed kit is portable, versioned, and usable from
 * outside this repo with no implicit repo/node_modules dependency.
 * Packs to a temp dir, unpacks, imports the REAL packed browser entry
 * under plain Node (via the generated public/js ESM boundary — no
 * mirrors, no source rewrites), npm-installs the tarball into a second
 * temp consumer, imports both installed entries there
 * (require('giggle-game-kit/server') + import('giggle-game-kit/browser')),
 * exercises a derived engine + a CLI scaffold, and checks CLI refusals.
 * Run: npm run test:game-kit */

const { spawnSync } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');

function run(nodeArgs, opts) {
  return spawnSync('node', nodeArgs, { encoding: 'utf8', ...(opts || {}) });
}

function makeEmitter() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
    },
  };
}

function stubCtx(content, settings) {
  const players = [{ id: 'pa', name: 'A' }, { id: 'pb', name: 'B' }, { id: 'pc', name: 'C' }];
  return {
    _players: players,
    _now: 1700000000000,
    players() { return players.slice(); },
    allPlayers() { return players.slice(); },
    content() { return content || {}; },
    settings() { return { ...(settings || {}) }; },
    hostId() { return 'pa'; },
    broadcast() {},
    lobby() {},
    later() { return () => {}; },
    award() {},
    now() { return this._now; },
  };
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'partybox-kit-'));
  try {
    // 1. Pack to temp (repo untouched outside the default dist dir).
    const tgz = path.join(tmp, 'giggle-game-kit.tgz');
    let r = run([path.join(ROOT, 'scripts', 'package-game-kit.js'), '--out', tgz]);
    assert.strictEqual(r.status, 0, 'pack failed: ' + r.stderr);
    assert(r.stdout.includes('KIT_PACK'), 'pack must print KIT_PACK');
    assert(fs.existsSync(tgz), 'archive must exist');
    console.log('GK ok: pack');

    // 2. Unpack (npm tarball layout: ./package/<kit>); the kit top
    // level is exactly the portable kit (no server/, no node_modules,
    // no secrets).
    const kit = path.join(tmp, 'kit', 'package');
    fs.mkdirSync(path.join(tmp, 'kit'));
    r = spawnSync('tar', ['-xzf', tgz, '-C', path.join(tmp, 'kit')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, 'unpack failed: ' + (r.stderr || ''));
    const tops = fs.readdirSync(kit).sort();
    assert.deepStrictEqual(tops, ['README.md', 'games', 'package.json', 'public', 'scripts', 'sdk'],
      'unexpected kit top level: ' + tops.join(','));
    const kitPkg = JSON.parse(fs.readFileSync(path.join(kit, 'package.json'), 'utf8'));
    const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.strictEqual(kitPkg.name, 'giggle-game-kit', 'kit name');
    assert.strictEqual(kitPkg.version, rootPkg.version, 'kit version tracks the root');
    assert.strictEqual(kitPkg.private, true, 'kit stays private (never publish)');
    assert(!kitPkg.dependencies || !Object.keys(kitPkg.dependencies).length, 'kit has zero dependencies');
    assert.strictEqual(kitPkg.bin['game-kit'], 'sdk/cli.js', 'kit bin path');
    console.log('GK ok: unpack + manifest');

    const previews = 'public/assets/karts/previews';
    const previewFiles = ['ring', 'blocks', 'garden', 'frost', 'neon'].map(arena => `legacy-${arena}.webp`);
    assert.deepStrictEqual(fs.readdirSync(path.join(kit, previews)).sort(), previewFiles.slice().sort(),
      'kit packs exactly the five legacy arena previews used by the result view');
    for (const file of previewFiles) {
      assert.deepStrictEqual(fs.readFileSync(path.join(kit, previews, file)), fs.readFileSync(path.join(ROOT, previews, file)),
        `${file} packed bytes match source`);
    }
    for (const file of ['meshopt_decoder.mjs', 'LICENSE.meshopt.txt']) {
      const rel = 'public/vendor/three/libs/' + file;
      assert.deepStrictEqual(fs.readFileSync(path.join(kit, rel)), fs.readFileSync(path.join(ROOT, rel)), 'packed Meshopt dependency byte identity: ' + file);
    }
    console.log('GK ok: result arena preview assets and local Meshopt decoder');

    // 3. No implicit repo dependency: nothing in the kit names this repo's
    // absolute path, and the server entry loads with a foreign cwd.
    const packedFiles = [];
    (function walk(dir) {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, f.name);
        if (f.isDirectory()) walk(p);
        else packedFiles.push(p);
      }
    }(kit));
    for (const f of packedFiles) {
      if (/\.(tgz|core\.js|module\.js|txt)$/.test(f)) continue; // vendor/data blobs
      const src = fs.readFileSync(f, 'utf8');
      assert(!src.includes(ROOT), `${path.relative(kit, f)} must not name the repo path`);
    }
    r = run(['-e', `require(${JSON.stringify(path.join(kit, 'sdk', 'server.js'))});console.log('loads')`],
      { cwd: os.tmpdir() });
    assert.strictEqual(r.status, 0, 'server entry must load from a foreign cwd: ' + r.stderr);
    console.log('GK ok: no repo/node_modules coupling');

    // 4. Server entry: explicit versioned exports, no bridge/auth surface.
    const srv = require(path.join(kit, 'sdk', 'server.js'));
    assert.strictEqual(srv.KIT_VERSION, kitPkg.version, 'KIT_VERSION matches the manifest');
    for (const k of ['sdk', 'validate', 'kart', 'camera', 'buildBattle', 'chainReaction',
        'dictionary', 'semantic', 'hints']) {
      assert(srv[k] && typeof srv[k] === 'object', `server exports .${k}`);
    }
    const keyDump = JSON.stringify(Object.keys(srv)).toLowerCase();
    assert(!/bridge|ticket|secret|token|auth/.test(keyDump), 'no bridge/auth export names');
    const srvSrc = fs.readFileSync(path.join(kit, 'sdk', 'server.js'), 'utf8');
    assert(!/require\(['"]\.\.\/server\//.test(srvSrc), 'server entry never reaches server/');
    assert.strictEqual(typeof srv.kart.createKartGame, 'function', 'kart factory');
    assert.strictEqual(typeof srv.camera.createCameraParty, 'function', 'camera factory');
    assert.strictEqual(typeof srv.buildBattle.createBuildBattle, 'function', 'build-battle factory');
    assert.strictEqual(typeof srv.blockSiege.createBlockSiege, 'function', 'block-siege factory');
    for (const count of [2, 3, 4]) {
      const positions = srv.blockSiege.castlePositions(count);
      assert.strictEqual(positions.length, count, 'portable block-siege castle count');
      assert.strictEqual(new Set(positions.map(p => `${p.x},${p.z}`)).size, count, 'portable castle geometry stays distinct');
    }
    assert.strictEqual(typeof srv.chainReaction.createChainReaction, 'function', 'chain factory');
    assert(srv.dictionary.wordCount > 10000, 'bundled word data loads');
    console.log('GK ok: server entry');

    // 5. A derived engine runs on kit imports alone: kart intent -> tick.
    {
      const def = srv.kart.createKartGame({ id: 'kit-karts', name: 'Kit Karts' });
      assert.strictEqual(def.id, 'kit-karts', 'derived def id');
      const ctx = stubCtx({}, {});
      const s = def.create(ctx);
      assert.strictEqual(s.phase, 'countdown', 'starts in countdown');
      assert.strictEqual(s.karts.length, 3, 'one kart per driver');
      assert.strictEqual(def.onAction(s, ctx, 'pa', { input: { steer: 0.5, throttle: 1 } }), false,
        'intents skip broadcast');
      ctx._now += 4000; // past the countdown
      def.onTick(s, ctx);
      assert.strictEqual(s.phase, 'drive', 'countdown advances, saw ' + s.phase);
      // Intents expire after 1.5 s of silence, so drive with a fresh one.
      def.onAction(s, ctx, 'pa', { input: { steer: 0, throttle: 1 } });
      const x0 = s.karts[0].x;
      const z0 = s.karts[0].z;
      ctx._now += 100;
      def.onTick(s, ctx);
      assert(s.karts[0].speed > 0, 'kart gains speed under throttle');
      assert(s.karts[0].x !== x0 || s.karts[0].z !== z0, 'tick integrates intent into position');
      for (const pid of ['pa', 'pb']) {
        const v = def.view(s, pid);
        assert(v && typeof v === 'object' && !Array.isArray(v), `kart view(${pid}) is an object`);
      }
      console.log('GK ok: derived kart engine');
    }

    // 6. Camera engine + dictionary + sdk/validate helpers, all from the kit.
    {
      const game = srv.camera.createCameraParty({ id: 'kit-cam', mode: 'spotlight' });
      const ctx = stubCtx({ prompts: ['Show us something round'] }, {});
      const s = game.create(ctx);
      assert.strictEqual(s.phase, 'perform', 'camera starts performing');
      game.onAction(s, ctx, s.actor, { ready: true });
      assert(s.ready[s.actor], 'actor ready recorded');
      assert(game.view(s, 'pb') && typeof game.view(s, 'pb') === 'object', 'camera view');
      game.dispose(s);
      const v = srv.dictionary.createWordValidator();
      assert.deepStrictEqual(v.validate('hello'), { ok: true, word: 'hello' }, 'dictionary hit');
      assert.strictEqual(v.validate('a'.repeat(25)).ok, false, 'dictionary format bound');
      assert(srv.dictionary.isSubset('hell', ['h', 'e', 'l', 'l', 'o']), 'isSubset');
      assert.deepStrictEqual(srv.sdk.tally({ a: 'x', b: 'x', c: 'y' }).winners, ['x'], 'tally');
      assert(srv.sdk.allIn([{ id: 'a' }], { a: 1 }), 'allIn');
      assert.strictEqual(srv.validate.isValidId('lens-cheer'), true, 'isValidId accept');
      assert.strictEqual(srv.validate.isValidId('Bad ID!'), false, 'isValidId refuse');
      assert.strictEqual(typeof srv.semantic.cosine, 'function', 'semantic export');
      assert.strictEqual(typeof srv.hints.maskWord, 'function', 'hints export');
      console.log('GK ok: camera + dictionary + helpers');
    }

    // 7. Browser entry: import the ACTUAL packed files under plain Node.
    // The kit ships a generated public/js/package.json ESM boundary while
    // the kit root stays CommonJS; no mirrors, no source rewrites.
    {
      const boundaryPath = path.join(kit, 'public/js/package.json');
      assert(fs.existsSync(boundaryPath), 'packed kit must ship public/js/package.json');
      const boundary = JSON.parse(fs.readFileSync(boundaryPath, 'utf8'));
      assert.strictEqual(boundary.type, 'module', 'packed public/js boundary is ESM');
      assert.strictEqual(kitPkg.type, 'commonjs', 'kit root stays CommonJS');
      const b = await import(pathToFileURL(path.join(kit, 'sdk/browser.mjs')).href);
      assert.strictEqual(b.KIT_VERSION, kitPkg.version, 'browser KIT_VERSION');
      for (const name of ['createCanvasView', 'createInput', 'createSoundBank', 'createVoiceClient',
          'createThreeView', 'createArenaControls', 'createCastleScene', 'createBlockSiegeScene', 'createSessionToolkit', 'createKartView', 'renderCameraParty',
          'disposeCameraParty', 'esc', 'countdown', 'forwardOf', 'zoneCells']) {
        assert.strictEqual(typeof b[name], 'function', `browser exports ${name}()`);
      }
      assert.deepStrictEqual(b.forwardOf(0), { x: 0, z: 1 }, 'packed pose math');
      for (const name of ['NITRO_DRAIN', 'NITRO_RECHARGE', 'NITRO_REARM', 'NITRO_SPEED', 'NITRO_PUNCH', 'EMP_TOP_SCALE', 'EMP_ACCEL_SCALE', 'EMP_TURN_SCALE']) {
        assert.strictEqual(b[name], srv.kart.constants[name], `packed movement/server parity ${name}`);
      }
      assert.strictEqual(b.zoneCells({ x0: 0, y0: 0, x1: 1, y1: 0 }).length, 2, 'packed view math');
      const session = b.createSessionToolkit({
        voice: { expectedOrigin: '', postFn: () => {} },
        audio: { autoUnlock: false, createContext: () => null },
        input: { target: makeEmitter(), opts: { window: makeEmitter(), document: makeEmitter() } },
        canvas: { mount: null, hooks: { frame() {} } },
      });
      assert.strictEqual(session.errors.length, 0, 'packed session builds');
      assert(session.canvas && session.canvas.fallback === true, 'packed canvas fallback');
      session.dispose();
      assert(session.disposed(), 'packed session disposes');
      console.log('GK ok: browser entry (packed files, plain Node)');
    }

    // 8. Real npm install of the tarball into a foreign consumer dir.
    {
      const consumer = path.join(tmp, 'consumer');
      fs.mkdirSync(consumer);
      fs.writeFileSync(path.join(consumer, 'package.json'), '{"name":"kit-consumer","version":"1.0.0"}');
      r = spawnSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', '--loglevel=error',
        '--cache', path.join(tmp, 'npm-cache'), tgz],
        { encoding: 'utf8', cwd: consumer });
      assert.strictEqual(r.status, 0, 'npm install <kit.tgz> failed: ' + (r.stderr || ''));
      r = run(['-e', 'const k=require(\'giggle-game-kit/server\');console.log(k.KIT_VERSION)'], { cwd: consumer });
      assert.strictEqual(r.status, 0, 'consumer require failed: ' + r.stderr);
      assert.strictEqual(r.stdout.trim(), kitPkg.version, 'consumer sees the kit version');
      // Plain-Node ESM consumer: the installed specifier imports directly
      // and the session toolkit builds + disposes.
      const probe = path.join(consumer, 'check-browser.mjs');
      fs.writeFileSync(probe, [
        "import assert from 'node:assert';",
        "import { KIT_VERSION, createSessionToolkit, createGameScreen, createMobileStick, normalizeStickVector, forwardOf, zoneCells, NITRO_DRAIN, NITRO_RECHARGE, NITRO_REARM, NITRO_SPEED, NITRO_PUNCH, EMP_TOP_SCALE, EMP_ACCEL_SCALE, EMP_TURN_SCALE } from 'giggle-game-kit/browser';",
        "import server from 'giggle-game-kit/server';",
        'for (const [key,value] of Object.entries({ NITRO_DRAIN, NITRO_RECHARGE, NITRO_REARM, NITRO_SPEED, NITRO_PUNCH, EMP_TOP_SCALE, EMP_ACCEL_SCALE, EMP_TURN_SCALE })) assert.strictEqual(value,server.kart.constants[key], "installed movement/server parity "+key);',
        'assert.strictEqual(typeof createGameScreen, "function", "installed screen helper");',
        'assert.strictEqual(typeof createMobileStick, "function", "installed analog input helper");',
        'assert.deepStrictEqual(normalizeStickVector(60,0,60), {x:1,y:0}, "installed analog vector math");',
        'assert.strictEqual(KIT_VERSION, process.argv[2], "installed KIT_VERSION");',
        'assert.deepStrictEqual(forwardOf(0), { x: 0, z: 1 }, "installed pose math");',
        'assert.strictEqual(zoneCells({ x0: 0, y0: 0, x1: 1, y1: 0 }).length, 2, "installed view math");',
        'function emitter() {',
        '  const listeners = new Map();',
        '  return {',
        '    addEventListener(t, fn) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(fn); },',
        '    removeEventListener(t, fn) { const s = listeners.get(t); if (s) s.delete(fn); },',
        '  };',
        '}',
        'const session = createSessionToolkit({',
        "  voice: { expectedOrigin: '', postFn: () => {} },",
        '  audio: { autoUnlock: false, createContext: () => null },',
        '  input: { target: emitter(), opts: { window: emitter(), document: emitter() } },',
        '  canvas: { mount: null, hooks: { frame() {} } },',
        '});',
        'assert.strictEqual(session.errors.length, 0, "installed session builds");',
        'assert(session.canvas && session.canvas.fallback === true, "installed canvas fallback");',
        'session.dispose();',
        'assert(session.disposed(), "installed session disposes");',
        "console.log('BROWSER_OK ' + KIT_VERSION);",
        '',
      ].join('\n'));
      r = run([probe, kitPkg.version], { cwd: consumer });
      assert.strictEqual(r.status, 0, 'consumer browser import failed: ' + r.stderr);
      assert.strictEqual(r.stdout.trim(), 'BROWSER_OK ' + kitPkg.version, 'consumer browser version');
      r = run([path.join(consumer, 'node_modules', 'giggle-game-kit', 'sdk', 'cli.js'), '--version'],
        { cwd: consumer });
      assert.strictEqual(r.status, 0, 'installed CLI failed: ' + r.stderr);
      assert.strictEqual(r.stdout.trim(), kitPkg.version, 'installed CLI version');
      console.log('GK ok: npm install + consumer import');
    }

    // 9. Scaffold from the kit CLI (foreign cwd, camera template), then check.
    const cli = path.join(kit, 'sdk', 'cli.js');
    const proj = path.join(tmp, 'proj');
    {
      r = run([cli, 'create', 'wobble-kit', '--root', proj, '--template', 'camera'], { cwd: os.tmpdir() });
      assert.strictEqual(r.status, 0, 'kit create failed: ' + r.stderr);
      for (const f of ['games/wobble-kit/server.js', 'public/js/games/wobble-kit.js',
          'locales/en/wobble-kit.json', 'games/engines/camera-party.js',
          'public/js/toolkit/camera-party.js']) {
        assert(fs.existsSync(path.join(proj, f)), 'missing ' + f);
      }
      r = run([cli, 'check', 'wobble-kit', '--root', proj], { cwd: os.tmpdir() });
      assert.strictEqual(r.status, 0, 'kit check failed:\n' + r.stdout + r.stderr);
      assert(r.stdout.includes('CHECK_PASS'), 'expected CHECK_PASS');
      const def = require(path.join(proj, 'games', 'wobble-kit', 'server.js'));
      const locale = JSON.parse(fs.readFileSync(path.join(proj, 'locales', 'en', 'wobble-kit.json'), 'utf8'));
      assert(locale.prompts.length >= 20, 'camera scaffold locale bar');
      const ctx = stubCtx(locale, {});
      const s = def.create(ctx);
      assert.strictEqual(s.phase, 'perform', 'scaffold plays');
      def.onAction(s, ctx, s.actor, { ready: true });
      assert(s.ready[s.actor], 'scaffold ready flow');
      const registry = require(path.join(ROOT, 'games', 'registry'));
      const entry = registry.discover(path.join(proj, 'games')).find((g) => g.id === 'wobble-kit');
      assert(entry && entry.communication === 'video', 'kit scaffold is discoverable');
      console.log('GK ok: kit scaffold + check + discovery');
    }

    // 10. CLI refusals: invalid ids, missing args, bad template, overwrite,
    // traversal — nothing escapes the target root.
    {
      const before = new Set(fs.readdirSync(tmp));
      const bad = [
        ['create'], ['create', 'Bad ID!', '--root', proj], ['create', 'a/b', '--root', proj],
        ['create', '..', '--root', proj], ['create', 'x', '--root', proj],
        ['create', 'ok-again', '--root', proj, '--template', 'nope'],
        ['create', 'wobble-kit', '--root', proj], ['create', 'wobble-kit', '--root', proj, '--template', 'camera'],
        ['check'], ['inspect'], ['inspect', 'nope'], ['frobnicate'], ['create', 'trailing', 'extra', '--root', proj],
      ];
      for (const args of bad) {
        r = run([cli, ...args], { cwd: os.tmpdir() });
        assert.notStrictEqual(r.status, 0, `kit ${args.join(' ')} must fail`);
      }
      assert(!fs.existsSync(path.join(proj, 'games', 'ok-again')), 'failed create must write nothing');
      const after = fs.readdirSync(tmp);
      assert(after.every((f) => before.has(f)), 'refusals must create nothing outside the root');
      r = run([cli, 'list'], { cwd: os.tmpdir() });
      assert.strictEqual(r.status, 0, 'list failed: ' + r.stderr);
      assert(r.stdout.includes('camera') && r.stdout.includes('kart-engine'), 'list covers kit');
      r = run([cli, 'inspect', 'camera'], { cwd: os.tmpdir() });
      assert.strictEqual(r.status, 0, 'inspect failed: ' + r.stderr);
      console.log('GK ok: CLI refusals + list/inspect');
    }

    console.log('GK_PASS');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('GK_FAIL', e && e.stack ? e.stack : e);
  process.exit(1);
});
