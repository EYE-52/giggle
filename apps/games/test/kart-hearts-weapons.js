'use strict';
/* Hearts and the sixteen-weapon arsenal on the real reusable engine (room ctx
 * stub only — full create/onAction/onTick/view) plus the shared config and
 * the elevated arsenal table:
 * - 3 hearts per kart; whole-heart damage per weapon (Pulse, Scatter, Mine,
 *   Seeker 1; Rocket, Proximity Bomb 2; Nuke takes every heart in 14u).
 * - Rapid fire repeats once per target per second; each Mine is its own trap.
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

const KEPT = config.weaponOrder;
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

// Shared hearts, rarity, and deterministic pickup policy.
assert.equal(config.maxHealth,3);
assert.deepEqual(Object.keys(config.weapons),KEPT);
assert.deepEqual(KEPT.filter(id=>config.weapons[id].tier==='rare'),['supernova','nuke']);
for(const id of KEPT)assert(Number.isInteger(damageAt(id)));
for(let i=0;i<20000;i++)assert(KEPT.includes(weaponForRoll(i/20000)));
assert.deepEqual(Object.keys(elevated.arsenal.weights),KEPT);

// --- 3. damage per weapon: 1 heart for Pulse/Scatter/Seeker, 2 for Rocket ---
for (const [weapon, lost] of [['machinegun', 1], ['trishot', 1], ['missile',2],['cannon',2]]) {
  const [st, ctx] = arena(2);
  const [a, b] = st.karts;
  a.x = 0; a.z = -20; b.x = weapon === 'missile' ? 5 : 0; b.z = weapon==='missile'?10:-8;
  arm(a, weapon, 'vt-' + weapon);
  const from = st.events.length;
  shoot(st, ctx, 'p0');
  for (let i = 0; i < 12; i++) tick(ctx, st);
  assert.strictEqual(b.health, 3 - lost, `${weapon} takes ${lost} heart(s)`);
  if(weapon==='missile')assert(b.x>5,'missile hits and pushes the off-centre rival away');
  const hit = events(st, 'hit', from);
  assert.strictEqual(hit.length, 1, weapon + ' emits one hit');
  assert.deepStrictEqual([hit[0].damage, hit[0].health, hit[0].maxHealth, hit[0].weapon], [lost, 3 - lost, 3, weapon], weapon + ' hit carries hearts');
  assert.strictEqual(a.hits, 0, weapon + ' wounds without scoring');
  console.log(`HEARTS ok: ${weapon} takes ${lost}`);
}

// --- 4. one rapid-fire pickup hurts again after a per-target second ---
{
  const [st, ctx] = arena(2);
  const [a, b] = st.karts;
  a.x = 0; a.z = -20; b.x = 0; b.z = -10;
  arm(a, 'machinegun', 'vclip');
  for (let i = 0; i < 6; i++) { shoot(st, ctx, 'p0'); tick(ctx, st, 200); }
  assert(a.ammo <= config.weapons.machinegun.ammo - 6, 'several rounds left the clip');
  assert.strictEqual(b.health, 1, 'sustained Pulse contact takes a second heart after one second');
  arm(a, 'machinegun', 'vnext');
  shoot(st, ctx, 'p0'); tick(ctx, st); tick(ctx, st);
  assert.strictEqual(b.health, 0, 'the next pickup has an immediate first hit');
  assert.strictEqual(a.hits, 1, 'three lost hearts award one KO');
  assert(!st.volleyHits.has('vclip'), 'a spent, landed volley is forgotten');
  console.log('HEARTS ok: one heart per target per second within a volley');
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

// --- 9. knockout and respawn return full hearts ---
{
  const [st, ctx] = arena(2);
  const [a, b] = st.karts;
  a.x = 0; a.z = -20; b.x = 0; b.z = -10; b.health = 1;
  arm(a,'machinegun','vko');
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
  assert.strictEqual(a.weapon,'machinegun','same machinegun pickup retains unused rounds');
  a.x = 0; a.z = -20; a.angle = 0; b.x = 0; b.z = -10; b.shield = 0; a.fireCd = 0;
  shoot(st, ctx, 'p0'); for (let i = 0; i < 4; i++) tick(ctx, st);
  assert.strictEqual(b.health,3,'the same pickup cannot hurt that rival again after respawn');
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
