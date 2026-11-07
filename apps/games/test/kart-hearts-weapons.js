'use strict';
/* Hearts and the sixteen-weapon arsenal on the real reusable engine (room ctx
 * stub only — full create/onAction/onTick/view) plus the shared config and
 * the elevated arsenal table:
 * - 3 hearts per kart; whole-heart damage per weapon (Pulse, Scatter, Mine,
 *   Seeker 1; Rocket, Proximity Bomb 2; Nuke takes every heart in 14u).
 * - One pickup hurts a rival at most once; each Mine is its own trap.
 * - Shield blocks the next hit, then breaks; respawn refills the hearts.
 * - Pickups roll 52/43/5 by tier and the retired weapons never spawn.
 * - The second eight (laser, thunder, boomerang, oil, frost, cluster,
 *   bouncer, ram) are covered in depth by test/kart-new-arsenal.js.
 * Run: node test/kart-hearts-weapons.js */

const assert = require('assert');
const karts = require('./fixtures/kart-planar-variant.cjs');
const battle = require('../games/engines/kart-rules-battle');
const { config, damageAt, weaponForRoll } = require('../games/engines/kart-combat-config');
const elevated = require('../games/engines/kart-elevated-combat');

const KEPT = ['pulse', 'scatter', 'mine', 'rocket', 'seeker', 'proximity', 'shield', 'nuke',
  'laser', 'thunder', 'boomerang', 'oil', 'frost', 'cluster', 'bouncer', 'ram'];
const RETIRED = ['rail', 'sentry', 'spikes', 'emp', 'bomb', 'grenade'];

function stubCtx(players, now = 9500000) {
  const ctx = {
    _now: now,
    players: () => players.slice(), allPlayers: () => players.slice(), content: () => ({}),
    settings: () => ({ mode: 'Zap Battle', map: 'Rookie Ring' }), hostId: () => players[0].id,
    broadcast() {}, lobby() {}, later: () => () => {}, award() {}, now: () => ctx._now,
  };
  return ctx;
}
function arena(n = 3) {
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const ctx = stubCtx(players);
  const st = karts.create(ctx);
  ctx._now += 3000;
  karts.onTick(st, ctx);
  assert.strictEqual(st.phase, 'drive', 'countdown reaches drive');
  for (const c of st.crates) { c.x = st.bound - 1; c.z = -(st.bound - 1); }
  const c = st.bound - 4;
  st.karts.forEach((k, i) => {
    k.x = i % 2 ? c : -c; k.z = i < 2 ? c : -c; k.angle = 0; k.speed = 0; k.shield = 0;
    k.input = { steer: 0, throttle: 0, boost: false };
  });
  return [st, ctx];
}
const tick = (ctx, st, ms = 100) => { ctx._now += ms; karts.onTick(st, ctx); };
const press = (st, ctx, pid) => karts.onAction(st, ctx, pid, { input: { steer: 0, throttle: 0, boost: true } });
const release = (st, ctx, pid) => karts.onAction(st, ctx, pid, { input: { steer: 0, throttle: 0 } });
function shoot(st, ctx, pid) { press(st, ctx, pid); tick(ctx, st); release(st, ctx, pid); tick(ctx, st); }
function arm(kart, weapon, volley) {
  kart.weapon = weapon; kart.ammo = config.weapons[weapon].ammo || 1; kart.fireCd = 0; kart.prevAction = false;
  kart.volley = volley;
}
const hearts = (st) => st.karts.map((k) => k.health);
const events = (st, type, from = 0) => st.events.slice(from).filter((e) => e.type === type);

// --- 1. shared config: hearts, damage table, tiers ---
{
  assert.strictEqual(config.maxHealth, 3, 'three hearts per kart');
  assert.deepStrictEqual(config.weaponOrder.slice().sort(), KEPT.slice().sort(), 'exactly the sixteen kept weapons');
  for (const id of RETIRED) {
    assert.strictEqual(config.weapons[id], undefined, id + ' is retired from the config');
    assert.strictEqual(damageAt(id), 0, id + ' deals nothing');
  }
  assert.deepStrictEqual(KEPT.map(damageAt), [1, 1, 1, 2, 1, 2, 0, 3, 1, 1, 1, 1, 1, 1, 1, 1], 'whole-heart damage table');
  for (const id of KEPT) assert(Number.isInteger(damageAt(id)), id + ' damage is a whole number of hearts');
  const byTier = { common: 0, uncommon: 0, rare: 0 };
  for (const id of KEPT) byTier[config.weapons[id].tier] += config.pickupWeights[id];
  assert(Math.abs(byTier.common - .52) < 1e-9 && Math.abs(byTier.uncommon - .43) < 1e-9 && Math.abs(byTier.rare - .05) < 1e-9, 'tier odds 52/43/5');
  assert.deepStrictEqual(KEPT.filter((id) => config.weapons[id].tier === 'common'), ['pulse', 'scatter', 'mine', 'laser', 'boomerang', 'oil', 'bouncer'], 'common tier');
  assert.deepStrictEqual(KEPT.filter((id) => config.weapons[id].tier === 'uncommon'), ['rocket', 'seeker', 'proximity', 'shield', 'thunder', 'frost', 'cluster', 'ram'], 'uncommon tier');
  // Every weapon shows up often enough to learn, and the Nuke stays the rarest.
  for (const id of KEPT) assert(config.pickupWeights[id] >= .05, id + ' rolls at least 5% of pickups');
  for (const id of KEPT.filter((w) => w !== 'nuke')) assert(config.pickupWeights[id] > config.pickupWeights.nuke, id + ' is commoner than the Nuke');
  assert.deepStrictEqual(KEPT.filter((id) => config.weapons[id].tier === 'rare'), ['nuke'], 'rare tier');
  assert(Object.isFrozen(config) && Object.isFrozen(config.weapons.nuke), 'shared table cannot drift');
  console.log('HEARTS ok: 3 hearts, whole-heart damage, 52/43/5 tiers');
}

// --- 2. retired weapons can never spawn (classic, garage and elevated) ---
{
  const counts = {};
  for (let i = 0; i < 20000; i++) { const w = weaponForRoll(i / 20000); counts[w] = (counts[w] || 0) + 1; }
  assert.deepStrictEqual(Object.keys(counts).sort(), KEPT.slice().sort(), 'a full sweep of rolls lands only on kept weapons');
  assert(Math.abs(counts.nuke / 20000 - .05) < .001, 'nuke share is 5%');
  assert.strictEqual(weaponForRoll(.9999999), 'nuke', 'top of the range stays inside the pool');
  const [st, ctx] = arena(2);
  const a = st.karts[0], seen = new Set();
  for (let i = 0; i < 900; i++) {
    a.weapon = null; a.ammo = 0;
    const crate = st.crates[0]; a.x = crate.x; a.z = crate.z;
    tick(ctx, st, 50);
    if (a.weapon) seen.add(a.weapon);
    assert(a.weapon === null || KEPT.includes(a.weapon), 'crate rolled ' + a.weapon);
    assert(a.weapon === null || /^v\d+$/.test(a.volley), 'each pickup opens a fresh volley');
  }
  for (const id of KEPT) assert(seen.has(id), 'real crate pickups reach ' + id);
  assert.deepStrictEqual(Object.keys(elevated.arsenal.weights).sort(), KEPT.slice().sort(), 'elevated pool holds the same sixteen');
  const total = Object.values(elevated.arsenal.weights).reduce((s, v) => s + v, 0);
  assert(Math.abs(total - 100) < 1e-9 && Math.abs(elevated.arsenal.weights.nuke - 5) < 1e-9, 'elevated tier odds match');
  for (const id of RETIRED) assert.strictEqual(elevated.arsenal[id], undefined, id + ' has no elevated tuning');
  console.log('HEARTS ok: only the sixteen weapons spawn from crates (classic + elevated)');
}

// --- 3. damage per weapon: 1 heart for Pulse/Scatter/Seeker, 2 for Rocket ---
for (const [weapon, lost] of [['pulse', 1], ['scatter', 1], ['rocket', 2], ['seeker', 1]]) {
  const [st, ctx] = arena(2);
  const [a, b] = st.karts;
  a.x = 0; a.z = -20; b.x = weapon === 'seeker' ? 5 : 0; b.z = -8;
  arm(a, weapon, 'vt-' + weapon);
  const from = st.events.length;
  shoot(st, ctx, 'p0');
  for (let i = 0; i < 12; i++) tick(ctx, st);
  assert.strictEqual(b.health, 3 - lost, `${weapon} takes ${lost} heart(s)`);
  if (weapon === 'seeker') assert(Math.abs(b.x / (b.z - a.z)) > .3, 'seeker target sat well off the straight line');
  const hit = events(st, 'hit', from);
  assert.strictEqual(hit.length, 1, weapon + ' emits one hit');
  assert.deepStrictEqual([hit[0].damage, hit[0].health, hit[0].maxHealth, hit[0].weapon], [lost, 3 - lost, 3, weapon], weapon + ' hit carries hearts');
  assert.strictEqual(a.hits, 0, weapon + ' wounds without scoring');
  console.log(`HEARTS ok: ${weapon} takes ${lost}`);
}

// --- 4. one pickup hurts a rival once, however many rounds land ---
{
  const [st, ctx] = arena(2);
  const [a, b] = st.karts;
  a.x = 0; a.z = -20; b.x = 0; b.z = -10;
  arm(a, 'pulse', 'vclip');
  for (let i = 0; i < 6; i++) { shoot(st, ctx, 'p0'); tick(ctx, st, 200); }
  assert(a.ammo <= 6, 'several rounds left the clip');
  assert.strictEqual(b.health, 2, 'a whole Pulse clip still takes one heart');
  arm(a, 'pulse', 'vnext');
  shoot(st, ctx, 'p0'); tick(ctx, st); tick(ctx, st);
  assert.strictEqual(b.health, 1, 'the next pickup hurts again');
  assert(!st.volleyHits.has('vclip'), 'a spent, landed volley is forgotten');
  console.log('HEARTS ok: one heart per pickup per rival');
}

// --- 5. mines: each trap is its own heart ---
{
  const [st, ctx] = arena(2);
  const [a, b] = st.karts;
  a.x = 0; a.z = 0; a.angle = 0;
  arm(a, 'mine', 'vm');
  shoot(st, ctx, 'p0');
  a.z = 6; tick(ctx, st, 240); shoot(st, ctx, 'p0');
  assert.strictEqual(st.mines.length, 2, 'two traps down');
  a.x = 20; a.z = 20;
  for (let i = 0; i < 10; i++) tick(ctx, st);
  for (const m of st.mines.slice()) {
    b.x = m.x + 3; b.z = m.z; tick(ctx, st);
    b.x = m.x; b.z = m.z; tick(ctx, st);
    tick(ctx, st, 700);
  }
  assert.strictEqual(b.health, 1, 'two mines take two hearts');
  assert.strictEqual(st.mines.length, 0, 'triggered traps are consumed');
  console.log('HEARTS ok: each mine takes a heart');
}

// --- 6. proximity bomb: 2 hearts to every rival in the blast ---
{
  const [st, ctx] = arena(3);
  const [a, b, c] = st.karts;
  a.x = 0; a.z = 0; a.angle = 0;
  arm(a, 'proximity', 'vp');
  const from = st.events.length;
  shoot(st, ctx, 'p0');
  assert.strictEqual(st.mines.length, 1, 'charge dropped behind');
  assert.strictEqual(st.mines[0].kind, 'proximity', 'charge is tagged');
  const m = st.mines[0];
  a.x = 20; a.z = 20;
  c.x = m.x - 4.5; c.z = m.z; // inside the 5.5u blast, outside the 3u trigger
  for (let i = 0; i < 10; i++) tick(ctx, st);
  assert.strictEqual(c.health, 3, 'the charge waits for a rival inside 3u');
  b.x = m.x + 2.5; b.z = m.z; tick(ctx, st);
  assert.deepStrictEqual([b.health, c.health], [1, 1], 'one blast takes 2 hearts from each rival nearby');
  assert.strictEqual(events(st, 'blast', from).filter((e) => e.weapon === 'proximity').length, 1, 'one blast event');
  assert.strictEqual(st.mines.length, 0, 'the charge is gone');
  assert.strictEqual(a.health, 3, 'owner is immune');
  console.log('HEARTS ok: proximity bomb takes 2 hearts in its blast');
}

// --- 7. nuke: knocks out everything in its radius, exactly once ---
{
  const [st, ctx] = arena(3);
  const [a, b, c] = st.karts;
  a.x = 0; a.z = -24; a.angle = 0;
  b.x = 2; b.z = -6; c.x = -20; c.z = 20;
  arm(a, 'nuke', 'vn');
  const from = st.events.length;
  shoot(st, ctx, 'p0');
  assert.strictEqual(st.grenades.length, 1, 'one warhead in the air');
  assert.strictEqual(st.grenades[0].kind, 'nuke', 'warhead is tagged nuke');
  const view = karts.view(st, 'p0');
  assert.strictEqual(view.grenades[0].kind, 'nuke', 'view tags the warhead');
  for (let i = 0; i < 30 && st.grenades.length; i++) tick(ctx, st);
  assert.strictEqual(st.grenades.length, 0, 'warhead detonated and is gone');
  assert(b.respawn > 0 && b.health === 0, 'rival in the radius is knocked out from full hearts');
  assert.strictEqual(c.health, 3, 'rival outside the radius is untouched');
  assert.strictEqual(a.hits, 1, 'one knockout scored');
  assert.strictEqual(events(st, 'ko', from).length, 1, 'one KO event');
  assert.strictEqual(events(st, 'blast', from).filter((e) => e.weapon === 'nuke').length, 1, 'one nuke blast');
  console.log('HEARTS ok: nuke knocks out every rival in 14u');
}

// --- 8. shield blocks the next hit, then breaks ---
{
  const [st, ctx] = arena(2);
  const [a, b] = st.karts;
  b.x = 20; b.z = 20;
  arm(b, 'shield', 'vs');
  const from = st.events.length;
  shoot(st, ctx, 'p1');
  assert.strictEqual(b.guard, true, 'shield armed');
  assert.strictEqual(b.weapon, null, 'shield pickup spent');
  assert.strictEqual(events(st, 'shield', from).length, 1, 'one shield event');
  assert.strictEqual(karts.view(st, 'p1').karts.find((k) => k.pid === 'p1').guard, true, 'view carries the shield');
  for (let i = 0; i < 80; i++) tick(ctx, st); // it never times out
  assert.strictEqual(b.guard, true, 'shield waits for a hit');
  a.x = 0; a.z = -20; b.x = 0; b.z = -10;
  arm(a, 'rocket', 'vr');
  shoot(st, ctx, 'p0'); for (let i = 0; i < 6; i++) tick(ctx, st);
  assert.strictEqual(b.health, 3, 'shield soaks a 2-heart rocket');
  assert.strictEqual(b.guard, false, 'shield breaks on the hit');
  const block = events(st, 'block', from);
  assert.deepStrictEqual([block.length, block[0]?.pid, block[0]?.other, block[0]?.weapon], [1, 'p0', 'p1', 'rocket'], 'one block event');
  arm(a, 'pulse', 'vafter');
  shoot(st, ctx, 'p0'); for (let i = 0; i < 4; i++) tick(ctx, st);
  assert.strictEqual(b.health, 2, 'the hit after the block lands');
  console.log('HEARTS ok: shield blocks the next hit');
}

// --- 9. knockout and respawn return full hearts ---
{
  const [st, ctx] = arena(2);
  const [a, b] = st.karts;
  a.x = 0; a.z = -20; b.x = 0; b.z = -10; b.health = 1;
  arm(a, 'rocket', 'vko');
  const spawn = b.spawnSeq;
  shoot(st, ctx, 'p0'); for (let i = 0; i < 4; i++) tick(ctx, st);
  assert(b.respawn > 0 && b.health === 0, 'last heart knocks out');
  assert.strictEqual(a.hits, 1, 'knockout scores');
  for (let i = 0; i < 25; i++) tick(ctx, st);
  assert.strictEqual(b.respawn, 0, 'back after two seconds');
  assert.strictEqual(b.spawnSeq, spawn + 1, 'fresh life');
  assert.strictEqual(b.health, 3, 'respawn refills all three hearts');
  assert.strictEqual(b.guard, false, 'a fresh life has no shield pickup');
  assert(b.shield > 0, 'spawn protection is separate and timed');
  const view = karts.view(st, 'p1').karts.find((k) => k.pid === 'p1');
  assert.deepStrictEqual([view.health, view.maxHealth], [3, 3], 'view shows full hearts');
  for (const key of ['ramT', 'spikesT', 'empT', 'slowed']) assert(!(key in view), key + ' is gone from the wire');
  assert.strictEqual(a.weapon, 'rocket', 'the same rocket clip is still loaded');
  a.x = 0; a.z = -20; a.angle = 0; b.x = 0; b.z = -10; b.shield = 0; a.fireCd = 0;
  shoot(st, ctx, 'p0'); for (let i = 0; i < 4; i++) tick(ctx, st);
  assert.strictEqual(b.health, 1, 'the same pickup can hurt the rival again on its new life');
  console.log('HEARTS ok: respawn returns full hearts');
}

// --- 10. a retired id forced into the slot is inert ---
{
  const [st, ctx] = arena(2);
  const a = st.karts[0];
  for (const id of RETIRED) {
    a.weapon = id; a.ammo = 1; a.fireCd = 0; a.prevAction = false;
    const before = [st.zaps.length, st.mines.length, st.grenades.length, st.events.length];
    shoot(st, ctx, 'p0');
    assert.deepStrictEqual([st.zaps.length, st.mines.length, st.grenades.length], before.slice(0, 3), id + ' spawns nothing');
    assert.strictEqual(events(st, 'fire', before[3]).length, 0, id + ' never fires');
  }
  assert.deepStrictEqual(battle.constants.WEAPON_ORDER.slice().sort(), KEPT.slice().sort(), 'rules expose the eight-weapon order');
  console.log('HEARTS ok: retired ids are inert');
}

console.log('KART_HEARTS_WEAPONS_PASS');
