// Planar-mutating unit fixtures use an explicit generic variant, not physical Pocket.
'use strict';
/* Regression tests execute the real reusable kart engine and accepted fire
 * actions. Fixtures set valid poses so exact collision paths are repeatable.
 * All battle modes run pulse 110 / scatter 95 / rocket 85 / rail 160.
 * Hits KO instead of tagging; fixtures verify time-ordered sweeps. */
const assert = require('node:assert/strict');
const game = require('./fixtures/kart-planar-variant.cjs');

function setup(n = 2, map = 'Rookie Ring') {
  let now = 1000000;
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const ctx = {
    now: () => now, settings: () => ({ mode: 'Zap Battle', map }),
    players: () => players, allPlayers: () => players,
    broadcast() {}, award() {}, later: () => () => {},
  };
  const state = game.create(ctx);
  now += 3000; game.onTick(state, ctx);
  const step = (ms) => { now += ms; game.onTick(state, ctx); };
  for (const kart of state.karts) {
    kart.x = 0; kart.z = 0; kart.angle = 0; kart.speed = 0;
    kart.input = { steer: 0, throttle: 0, boost: false };
    kart.shield = 0; // fixtures test hits, not spawn protection
    kart.health = 1; // Wounded sweep/KO contract; default100 health is tested in kart-health.
  }
  state.karts[0].weapon = 'pulse';
  state.karts[0].ammo = 3;
  const fire = () => game.onAction(state, ctx, 'p0', { input: { steer: 0, throttle: 0, boost: true } });
  return { state, ctx, step, fire };
}

function expectHit(state, pid = 'p1') {
  assert.equal(state.karts[0].hits, 1);
  assert.equal(state.scores.p0, 1);
  assert(state.karts.find((k) => k.pid === pid).respawn > 0, 'victim knocked out');
  assert.equal(state.zaps.length, 0, 'an impact consumes the projectile');
}

function run() {
  {
    const { state, fire, step } = setup();
    state.karts[1].z = 2.5; // muzzle z=2 is already inside radius 1.7
    fire(); step(100);
    expectHit(state);
  }
  {
    const { state, ctx, fire, step } = setup();
    const [shooter, target] = state.karts;
    shooter.z = -6.65; target.z = 4; target.angle = Math.PI; target.speed = 14;
    game.onAction(state, ctx, 'p1', { input: { steer: 0, throttle: 1 } });
    fire(); step(30);
    assert.equal(shooter.hits, 0);
    assert(Math.abs(state.zaps[0].z - (-1.35)) < 1e-9);
    const accel=require('../games/engines/kart-engine').constants.ACCEL;
    assert(Math.abs(target.z - (4-(14+accel*.03)*.03)) < 1e-9,'moving target advances with current acceleration');
    // Next sampled positions miss, but the paths cross during this tick.
    step(100); expectHit(state);
    assert.equal(target.speed, 0);
  }
  {
    const { state, fire, step } = setup();
    state.karts[0].z = -3.3; state.karts[1].x = 1.5;
    // Stationary grazing chord: endpoints (z=-1.3,+2.1) miss radius 1.7,
    // but the segment's closest distance is 1.5, so this is a real hit.
    fire(); step(100); expectHit(state);
  }
  for (const ms of [250, 1000]) {
    const { state, fire, step } = setup();
    state.karts[0].z = -5.25;
    // Engine clamps a hitch to .25s: the projectile goes -3.25 to 5.25.
    fire(); step(ms); expectHit(state);
  }
  console.log('PROJECTILES ok: spawn overlap, moving head-on, grazing, 250ms and clamped hitches');

  {
    const { state, fire, step } = setup();
    const victim = state.karts[1];
    victim.z = 3;
    victim.slip = 3; victim.turbo = 1; victim.boost = 1;
    victim.drifting = true; victim.driftCharge = 1;
    victim.weapon = 'pulse'; victim.ammo = 2;
    fire(); step(100); expectHit(state);
    for (const key of ['speed', 'slip', 'turbo', 'boost', 'driftCharge', 'ammo']) {
      assert.equal(victim[key], 0, 'KO clears ' + key);
    }
    assert.equal(victim.weapon, null, 'KO clears the loaded item');
    assert.equal(victim.drifting, false, 'KO cancels charged drift');
    assert.equal(victim.deaths, 1, 'KO records the death');
  }

  {
    const { state, fire, step } = setup(3);
    // The farther victim is earlier in roster order. Only the first hull
    // reached may consume the shot, independently of array iteration.
    state.karts[1].z = 8; state.karts[2].z = 5;
    fire(); step(250); expectHit(state, 'p2');
    assert.equal(state.karts[1].shield, 0);
  }
  {
    const { state, fire, step } = setup(3);
    state.karts[1].z = 8; state.karts[2].z = 5; state.karts[2].shield = 2;
    fire(); step(250);
    assert.equal(state.karts[0].hits, 0, 'a nearer shield consumes the shot before a farther hull');
    assert.equal(state.karts[1].shield, 0); assert.equal(state.zaps.length, 0);
  }
  {
    const { state, fire, step } = setup(2, 'Bumper Blocks');
    state.karts[0].x = state.karts[1].x = 16;
    state.karts[0].z = 11; state.karts[1].z = 20;
    // Segment 13→21.5 jumps entirely across the block [13.5,18.5].
    fire(); step(250);
    assert.equal(state.karts[0].hits, 0); assert.equal(state.zaps.length, 0);
  }
  {
    const { state, fire, step } = setup(2, 'Bumper Blocks');
    state.karts[0].x = state.karts[1].x = 16;
    state.karts[0].z = 7.5; state.karts[1].z = 12;
    // The end point lies inside a block, but this hull is hit BEFORE it.
    fire(); step(250); expectHit(state);
  }
  {
    const { state, fire, step } = setup(2, 'Bumper Blocks');
    const [shooter, target] = state.karts;
    shooter.angle = Math.PI / 4;
    shooter.x = 12 - Math.SQRT2; shooter.z = 15 - Math.SQRT2;
    target.x = 17.5; target.z = 20.5;
    // Diagonal segment (12,15)→(18,21) clips the block even though
    // neither end is inside.
    fire(); step(250);
    assert.equal(shooter.hits, 0); assert.equal(state.zaps.length, 0);
  }
  {
    const { state, fire, step } = setup();
    state.karts[0].z = 23; state.karts[1].z = 28;
    // A hull at the edge is reached before the end point exits the world.
    fire(); step(250); expectHit(state);
  }
  {
    const { state, fire, step } = setup();
    const [shooter, target] = state.karts;
    shooter.x = 27; shooter.angle = Math.PI / 2; target.x = 28;
    // A muzzle outside the world cannot hit an overlapping edge hull.
    fire(); step(100);
    assert.equal(shooter.hits, 0); assert.equal(state.zaps.length, 0);
  }
  console.log('PROJECTILES ok: nearest hull/shield, swept axial+diagonal blocks, hull-before-block, world ordering');

  for (const [ttl, expected] of [[0.05, 0], [0.2, 1]]) {
    const { state, step } = setup();
    state.karts[0].z = 0; state.karts[1].z = 10;
    // At speed110 the hull is reached at .057s. A .05s fuse expires
    // first; a .2s fuse survives. The same ordering applies on hitches.
    state.zaps.push({ id: 'fixture', owner: 'p0', kind: 'pulse', x: 0, z: 2, angle: 0, ttl });
    step(250);
    assert.equal(state.karts[0].hits, expected, 'expiry and hull impacts follow time order');
    assert.equal(state.zaps.length, 0);
  }
  {
    const { state, fire, step } = setup();
    state.karts[0].z = -3.3; state.karts[1].x = 2; // entire chord outside hull
    fire(); step(100);
    assert.equal(state.karts[0].hits, 0); assert.equal(state.zaps.length, 1, 'a near miss keeps flying');
  }
  console.log('PROJECTILES_PASS: expiry ordering and genuine near misses');
}

if (require.main === module) run();
module.exports = { run };
