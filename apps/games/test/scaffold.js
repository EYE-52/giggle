'use strict';
/* Scaffold tests: new-game refuses bad input and overwrites, generates a
 * playable starter in an ISOLATED temp workspace (repo untouched), and
 * the starter passes check-game and is discovered by the registry.
 * Run: npm run test:scaffold */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

function run(script, args) {
  return spawnSync('node', [path.join(ROOT, script), ...args], { encoding: 'utf8' });
}

function main() {
  // Refusals leave the repo alone.
  let r = run('scripts/new-game.js', ['Bad ID!']);
  assert.notStrictEqual(r.status, 0, 'bad id must fail');
  assert(!fs.existsSync(path.join(ROOT, 'games', 'Bad ID!')), 'bad id must create nothing');
  r = run('scripts/new-game.js', ['trivia']);
  assert.notStrictEqual(r.status, 0, 'existing id must fail (no overwrite)');
  console.log('SCAF ok: refusals');

  // Isolated workspace.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'partybox-scaf-'));
  try {
    r = run('scripts/new-game.js', ['wobble-debate', '--root', tmp]);
    assert.strictEqual(r.status, 0, 'new-game failed: ' + r.stderr);
    for (const f of ['games/wobble-debate/server.js', 'public/js/games/wobble-debate.js', 'locales/en/wobble-debate.json']) {
      assert(fs.existsSync(path.join(tmp, f)), 'missing ' + f);
    }
    assert(!fs.existsSync(path.join(ROOT, 'games', 'wobble-debate')), 'repo games/ must stay clean');
    console.log('SCAF ok: isolated generation');

    r = run('scripts/new-game.js', ['wobble-debate', '--root', tmp]);
    assert.notStrictEqual(r.status, 0, 'overwrite in temp root must fail');
    console.log('SCAF ok: overwrite refused');

    r = run('scripts/check-game.js', ['wobble-debate', '--root', tmp]);
    assert.strictEqual(r.status, 0, 'check-game failed:\n' + r.stdout + r.stderr);
    assert(r.stdout.includes('CHECK_PASS'), 'expected CHECK_PASS');
    console.log('SCAF ok: starter passes check-game');

    // Registry discovery without editing registry code.
    const registry = require('../games/registry');
    const found = registry.discover(path.join(tmp, 'games'));
    const entry = found.find((g) => g.id === 'wobble-debate');
    assert(entry, 'discover() must find the scaffolded game');
    assert(entry.customizable, 'scaffold manifest must mark the game customizable');
    assert.strictEqual(entry.players, '3–12', 'display counts derive from the manifest');
    assert(entry.schema.settings.length > 0 && entry.schema.packs.length > 0, 'schema carries settings + packs');
    console.log('SCAF ok: registry discovery');

    // --renderer3d: a usable 3D lifecycle starter (sim boundaries, shared
    // Three helper, no CDN) that passes check-game and is discoverable.
    r = run('scripts/new-game.js', ['orb-run', '--renderer3d', '--root', tmp]);
    assert.strictEqual(r.status, 0, '3d new-game failed: ' + r.stderr);
    for (const f of ['games/orb-run/server.js', 'public/js/games/orb-run.js', 'locales/en/orb-run.json',
        'public/js/renderers/three-view.js']) {
      assert(fs.existsSync(path.join(tmp, f)), 'missing ' + f);
    }
    r = run('scripts/check-game.js', ['orb-run', '--root', tmp]);
    assert.strictEqual(r.status, 0, '3d check-game failed:\n' + r.stdout + r.stderr);
    assert(r.stdout.includes('CHECK_PASS'), 'expected CHECK_PASS for orb-run');
    const found3d = registry.discover(path.join(tmp, 'games')).find((g) => g.id === 'orb-run');
    assert(found3d, 'discover() must find the 3D scaffold');
    assert.strictEqual(found3d.renderer, '3d', '3d scaffold renderer');
    assert.strictEqual(found3d.realtime, true, '3d scaffold realtime');
    const client3d = fs.readFileSync(path.join(tmp, 'public/js/games/orb-run.js'), 'utf8');
    assert(client3d.includes('../renderers/three-view.js'), '3d client uses the shared helper');
    assert(!client3d.includes('https://') && !client3d.includes('http://'), '3d client has no remote imports');
    assert(!/from\s+['"]three['"]/.test(client3d), '3d client has no bare three import');
    assert(/export\s+default/.test(client3d) && client3d.includes('dispose'), '3d client lifecycle');
    // The 3D starter simulates: intents integrate on tick, dots collect.
    const def3d = require(path.join(tmp, 'games', 'orb-run', 'server.js'));
    let now3d = Date.now();
    const players3d = [{ id: 'pa', name: 'A' }, { id: 'pb', name: 'B' }, { id: 'pc', name: 'C' }];
    const ctx3d = {
      players: () => players3d.slice(),
      allPlayers: () => players3d.slice(),
      content: () => ({}),
      settings: () => ({}),
      hostId: () => 'pa',
      broadcast: () => {},
      lobby: () => {},
      later: () => () => {},
      award: () => {},
      now: () => now3d,
    };
    const st3d = def3d.create(ctx3d);
    assert.strictEqual(st3d.orbs.length, 3, 'one orb per driver');
    const oz = st3d.orbs[0].z; // orb 0 faces +z, so throttle moves z
    assert.strictEqual(def3d.onAction(st3d, ctx3d, 'pa', { input: { steer: 0, throttle: 1 } }), false,
      'starter intents skip broadcast');
    now3d += 100;
    def3d.onTick(st3d, ctx3d);
    assert(st3d.orbs[0].speed > 0, 'orb gains speed under throttle');
    assert(st3d.orbs[0].z !== oz, 'tick integrates intent into position');
    console.log('SCAF ok: 3d starter (scaffold, check, discovery, helper, sim)');

    // --template camera: a thin config on the shared camera-party engine
    // + shared renderer (no copied rules or markup) that passes
    // check-game, is discoverable, and plays perform -> vote -> reveal
    // with secret ballots.
    r = run('scripts/new-game.js', ['lens-cheer', '--template', 'camera', '--root', tmp]);
    assert.strictEqual(r.status, 0, 'camera new-game failed: ' + r.stderr);
    for (const f of ['games/lens-cheer/server.js', 'public/js/games/lens-cheer.js', 'locales/en/lens-cheer.json',
        'games/engines/camera-party.js', 'public/js/toolkit/camera-party.js',
        'public/css/camera-party.css']) {
      assert(fs.existsSync(path.join(tmp, f)), 'missing ' + f);
    }
    r = run('scripts/check-game.js', ['lens-cheer', '--root', tmp]);
    assert.strictEqual(r.status, 0, 'camera check-game failed:\n' + r.stdout + r.stderr);
    assert(r.stdout.includes('CHECK_PASS'), 'expected CHECK_PASS for lens-cheer');
    const foundCam = registry.discover(path.join(tmp, 'games')).find((g) => g.id === 'lens-cheer');
    assert(foundCam, 'discover() must find the camera scaffold');
    assert.strictEqual(foundCam.communication, 'video', 'camera scaffold communication');
    const srvCam = fs.readFileSync(path.join(tmp, 'games', 'lens-cheer', 'server.js'), 'utf8');
    assert(srvCam.includes('../engines/camera-party') && srvCam.includes('createCameraParty'),
      'camera server uses the engine factory');
    assert(srvCam.length < 3000, 'camera server stays a thin config');
    const clientCam = fs.readFileSync(path.join(tmp, 'public/js/games/lens-cheer.js'), 'utf8');
    assert(clientCam.includes('../toolkit/camera-party.js'), 'camera client uses the shared renderer');
    assert(/export\s+default/.test(clientCam) && clientCam.includes('ownsTimer'), 'camera client lifecycle');
    const defCam = require(path.join(tmp, 'games', 'lens-cheer', 'server.js'));
    const localeCam = JSON.parse(fs.readFileSync(path.join(tmp, 'locales', 'en', 'lens-cheer.json'), 'utf8'));
    assert(localeCam.prompts.length >= 20, 'camera scaffold locale bar');
    let nowCam = Date.now();
    const playersCam = [{ id: 'pa', name: 'A' }, { id: 'pb', name: 'B' }, { id: 'pc', name: 'C' }];
    const ctxCam = {
      players: () => playersCam.slice(),
      allPlayers: () => playersCam.slice(),
      content: () => localeCam,
      settings: () => ({}),
      hostId: () => 'pa',
      broadcast: () => {},
      lobby: () => {},
      later: () => () => {},
      award: () => {},
      now: () => nowCam,
    };
    const stCam = defCam.create(ctxCam);
    assert.strictEqual(stCam.phase, 'perform', 'camera starts performing');
    defCam.onAction(stCam, ctxCam, stCam.actor, { ready: true });
    assert(stCam.ready[stCam.actor], 'actor ready recorded');
    nowCam = stCam.endsAt + 1; // expire the perform window
    defCam.onAction(stCam, ctxCam, 'pb', { vote: stCam.actor, approve: true });
    assert.strictEqual(stCam.phase, 'vote', 'expiry advances to vote, saw ' + stCam.phase);
    assert.deepStrictEqual(defCam.view(stCam, 'pb').votes, {}, 'ballots stay secret while voting');
    for (const p of playersCam) {
      if (p.id !== stCam.actor) defCam.onAction(stCam, ctxCam, p.id, { vote: stCam.actor, approve: true });
    }
    assert.strictEqual(stCam.phase, 'reveal', 'all-in ballots advance to reveal, saw ' + stCam.phase);
    defCam.dispose(stCam);
    console.log('SCAF ok: camera starter (scaffold, check, discovery, factory, secret ballots, reveal)');

    // The starter actually plays: create -> answer -> vote -> reveal.
    const def = require(path.join(tmp, 'games', 'wobble-debate', 'server.js'));
    const locale = JSON.parse(fs.readFileSync(path.join(tmp, 'locales', 'en', 'wobble-debate.json'), 'utf8'));
    const players = [{ id: 'pa', name: 'A' }, { id: 'pb', name: 'B' }, { id: 'pc', name: 'C' }];
    const ctx = {
      players: () => players.slice(),
      allPlayers: () => players.slice(),
      content: () => locale,
      settings: () => ({ rounds: 1 }),
      hostId: () => 'pa',
      broadcast: () => {},
      lobby: () => {},
      later: () => () => {},
      award: () => {},
      now: () => Date.now(),
    };
    const state = def.create(ctx);
    assert.strictEqual(state.rounds, 1, 'starter honors settings');
    for (const p of players) def.onAction(state, ctx, p.id, { answer: 'text from ' + p.id });
    assert.strictEqual(state.phase, 'vote', 'all-in answers advance to vote, saw ' + state.phase);
    // Votes must be anonymous in the vote-phase view.
    const vv = def.view(state, 'pa');
    assert(vv.options.every((o) => !('pid' in o)), 'vote options must hide authors');
    def.onAction(state, ctx, 'pa', { vote: state.options.find((o) => o.pid !== 'pa').aid });
    def.onAction(state, ctx, 'pb', { vote: state.options.find((o) => o.pid !== 'pb').aid });
    def.onAction(state, ctx, 'pc', { vote: state.options.find((o) => o.pid !== 'pc').aid });
    assert.strictEqual(state.phase, 'reveal', 'all-in votes advance to reveal, saw ' + state.phase);
    console.log('SCAF ok: starter is playable end to end');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // Shared-dependency allowlist is per DEPENDENCY, not per game id: a
  // second board-game id using the approved pinned chess.js passes without
  // any checker special case, while an arbitrary require still fails.
  {
    const sharedRoot = path.join(ROOT, 'test', 'fixtures', 'shared-dep-root');
    r = run('scripts/check-game.js', ['alt-board', '--root', sharedRoot]);
    assert.strictEqual(r.status, 0, 'alt-board check-game failed:\n' + r.stdout + r.stderr);
    assert(r.stdout.includes('CHECK_PASS'), 'expected CHECK_PASS for alt-board');
    const badRoot = path.join(ROOT, 'test', 'fixtures', 'bad-dep-root');
    r = run('scripts/check-game.js', ['greedy-game', '--root', badRoot]);
    assert.notStrictEqual(r.status, 0, 'arbitrary require must fail check-game');
    assert((r.stdout + r.stderr).includes('CHECK_FAIL'), 'expected CHECK_FAIL for greedy-game');
    assert((r.stdout + r.stderr).includes('only ../_sdk, ../_validate, node stdlib'),
      'failure must name the dependency rule');
    // Fixture ids are authoring-only: never discovered as real games.
    const registry = require('../games/registry');
    assert(!registry.list().some((g) => g.id === 'alt-board' || g.id === 'greedy-game'),
      'fixtures must not leak into the registry');
    console.log('SCAF ok: shared-dep allowlist (alt-board passes, greedy-game fails)');
  }
  console.log('SCAF_PASS');
}

main();
