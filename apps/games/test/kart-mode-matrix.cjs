'use strict';

// Use Pocket Karts itself so a picker option cannot pass by starting a different ruleset.
const assert = require('node:assert/strict');
const game = require('../games/pocket-karts/server');
const { createKartGame } = require('../games/engines/kart-engine');
const { validateSettings } = require('../games/_validate');

// A teammate directly in the firing line must neither take damage nor block the shot.
function classicTeamShot() {
  const rules = createKartGame({ id: 'squad-arena', name: 'Squad Arena', teams: true });
  const drivers = ['a', 'b', 'c', 'd'].map(id => ({ id }));
  let now = 100000;
  const awards = {};
  const ctx = {
    now: () => now, allPlayers: () => drivers, players: () => drivers,
    settings: () => ({ mode: 'Team Battle', winRule: 'Score target', targetHits: 1 }),
    broadcast() {}, award(id, points) { assert(!Object.hasOwn(awards, id)); awards[id] = points; },
  };
  const state = rules.create(ctx);
  try {
    now += 3000;
    rules.onTick(state, ctx);
    const [shooter, enemy, ally, bystander] = state.karts;
    assert.equal(rules.view(state, 'c').teamByPlayer.c, rules.view(state, 'a').teamByPlayer.a);
    for (const kart of [shooter, enemy, ally, bystander]) {
      kart.x = 0; kart.angle = 0; kart.speed = 0; kart.shield = 0;
    }
    shooter.z = -8; ally.z = 0; enemy.z = 8; enemy.health = 1; bystander.x = -25;
    state.zaps.push({ id: 'squad-shot', owner: 'a', kind: 'machinegun', x: 0, z: -6, angle: 0, ttl: .4 });
    now += 200;
    rules.onTick(state, ctx);
    const result = rules.view(state, 'c').result;
    assert.equal(ally.health, 100);
    assert.equal(shooter.hits, 1);
    assert.equal(result.endReason, 'goal');
    assert.deepEqual(new Set(result.winners), new Set(['a', 'c']));
    assert.deepEqual(awards, { a: 300, b: 200, c: 300, d: 200 });
    rules.onTick(state, ctx);
  } finally {
    rules.dispose(state);
  }
}

async function main() {
  classicTeamShot();
  await game.initialize();
  const options = key => game.manifest.settings.find(setting => setting.key === key).options;
  const modes = ['Zap Battle', 'Team Battle', 'Capture the Flag', 'Star Rush', 'Garage Battle'];
  assert.deepEqual(new Set(options('mode')), new Set(modes));
  assert.equal(new Set(options('map')).size, 18);
  let matches = 0;
  for (const map of options('map')) {
    for (const mode of modes) {
      for (const count of [2, 5, 32]) {
        const label = map + ' / ' + mode + ' / ' + count;
        const drivers = Array.from({ length: count }, (_, i) => ({ id: 'driver' + i, name: 'Driver ' + i }));
        const settings = { map, mode, roundSeconds: 60, winRule: 'Time limit' };
        const wallet = {}, points = new Map();
        let now = 100000;
        const ctx = {
          instanceId: 'arena-' + matches, now: () => now, settings: () => settings,
          allPlayers: () => drivers, players: () => drivers, session: () => wallet, broadcast() {},
          award(id, score) { assert(!points.has(id), label + ' paid twice'); points.set(id, score); },
        };
        assert.equal(validateSettings(game, settings).ok, true, label + ' settings');
        assert.equal(game.preflight(settings).ok, true, label + ' preflight');
        let state;
        try { state = game.create(ctx); } catch (error) { throw new Error(label, { cause: error }); }
        try {
          now += 3010;
          game.onTick(state, ctx);
          const driver = game.view(state, drivers[0].id);
          const watcher = game.view(state, 'watcher');
          assert.equal(driver.phase, driver.profile ? 'live' : 'drive', label);
          assert.equal(driver.map.label, map, label);
          assert.equal(driver.modeLabel, mode, label);
          assert.equal(driver.karts.length, count, label);
          assert.equal(driver.youDrive, true);
          assert.equal(watcher.youDrive, false);
          assert.equal(driver.garage, mode === 'Garage Battle', label);
          if (mode === 'Star Rush') {
            assert(driver.stars.length > 0, label + ' stars missing');
            assert(!(driver.crates || []).length, label + ' battle loot in Star Rush');
          }
          if (mode === 'Team Battle' || mode === 'Capture the Flag') {
            assert.equal(Object.keys(driver.teamByPlayer).length, count, label);
            assert.equal(driver.teams.length, 2, label);
            assert(Math.abs(driver.teams[0].members.length - driver.teams[1].members.length) <= 1, label);
            assert.deepEqual(watcher.teams, driver.teams, label);
            if (mode === 'Capture the Flag') {
              assert.equal(driver.flags.length, 2, label);
              assert.equal(driver.bases.length, 2, label);
              for (const { position } of driver.bases) assert(Object.values(position).every(Number.isFinite), label);
            }
          }
          now += 60010;
          game.onTick(state, ctx);
          const end = game.view(state, drivers[0].id);
          assert.equal(end.phase, 'done', label);
          assert.equal(end.result.endReason, 'timeout', label);
          assert.equal(end.result.standings.length, count, label);
          assert.equal(end.result.standings.reduce((total, entry) => total + entry.points, 0),
            [...points.values()].reduce((total, value) => total + value, 0), label);
          game.onTick(state, ctx);
          matches++;
        } finally {
          game.dispose(state);
        }
      }
    }
  }
  console.log('KART_MODE_MATRIX_PASS', matches, 'authoritative matches across 18 maps, 5 modes and 3 player counts');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
