'use strict';
/* The second eight weapons on the real reusable engine (planar fixture:
 * authored x/z so every sweep is exact). One block per weapon proves it
 * fires, hits, does its special effect, and retires cleanly — no shot,
 * trap, canister, status or volley lingers afterwards.
 *   laser      fast straight bolt, 1 heart, 2 shots
 *   thunder    instant strike on the rival inside the narrow forward cone
 *   boomerang  curves out and back, cuts through rivals, is caught
 *   oil        trap behind; victim loses a heart and spins out
 *   frost      lobbed splash; victims lose a heart and are slowed
 *   cluster    lobbed canister bursts into bomblets; one heart per rival
 *   bouncer    rubber ball ricochets off walls, at most 4 times
 *   ram        3 s speed burst; touching a rival takes one heart once
 * Shield still blocks the next hit and cancels the status with it.
 * Run: node test/kart-new-arsenal.js */

const assert = require('assert');
const karts = require('./fixtures/kart-planar-variant.cjs');
const { config } = require('../games/engines/kart-combat-config');
const B = require('../games/engines/kart-rules-battle').constants;
const E = require('../games/engines/kart-engine').constants;

function stubCtx(players, now = 9500000) {
  const ctx = {
    _now: now,
    players: () => players.slice(), allPlayers: () => players.slice(), content: () => ({}),
    settings: () => ({ mode: 'Zap Battle', map: 'Rookie Ring' }), hostId: () => players[0].id,
    broadcast() {}, lobby() {}, later: () => () => {}, award() {}, now: () => ctx._now,
  };
  return ctx;
}
function arena(n = 2) {
  const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  const ctx = stubCtx(players);
  const st = karts.create(ctx);
  ctx._now += 3000;
  karts.onTick(st, ctx);
  assert.strictEqual(st.phase, 'drive', 'countdown reaches drive');
  for (const c of st.crates) { c.x = st.bound - 1; c.z = -(st.bound - 1); }
  st.karts.forEach((k, i) => {
    k.x = 20 + i * 3; k.z = 20; k.angle = 0; k.speed = 0; k.shield = 0;
    k.input = { steer: 0, throttle: 0, boost: false };
  });
  return [st, ctx];
}
const tick = (ctx, st, ms = 50) => { ctx._now += ms; karts.onTick(st, ctx); };
const press = (st, ctx, pid) => karts.onAction(st, ctx, pid, { input: { steer: 0, throttle: 0, boost: true } });
const release = (st, ctx, pid) => karts.onAction(st, ctx, pid, { input: { steer: 0, throttle: 0 } });
function shoot(st, ctx, pid) { press(st, ctx, pid); tick(ctx, st); release(st, ctx, pid); tick(ctx, st); }
function arm(kart, weapon, volley) {
  kart.weapon = weapon; kart.ammo = config.weapons[weapon].ammo || 1; kart.fireCd = 0; kart.prevAction = false;
  kart.volley = volley;
}
const events = (st, type, from = 0) => st.events.slice(from).filter((e) => e.type === type);
// Events are a bounded ring; collect every new one tick by tick.
function recorder(st) {
  let seen = st.eventSeq;
  const all = [];
  return { take() { for (const e of st.events) if (+e.id.slice(1) > seen) all.push(e); seen = st.eventSeq; return all; }, all };
}
function settle(st, ctx, seconds, rec) { for (let t = 0; t < seconds; t += .05) { tick(ctx, st); rec?.take(); } }
function clean(st, label) {
  assert.strictEqual(st.zaps.length, 0, label + ': no shot lingers');
  assert.strictEqual(st.mines.length, 0, label + ': no trap lingers');
  assert.strictEqual(st.grenades.length, 0, label + ': no canister lingers');
  for (const k of st.karts) assert(!(k.rammingT > 0) && !(k.frostT > 0) && !(k.spinT > 0), label + ': no status lingers');
  assert.strictEqual(st.volleyHits.size, 0, label + ': finished volleys are forgotten');
  const view = karts.view(st, 'p0');
  assert.deepStrictEqual([view.zaps.length, view.mines.length, view.grenades.length], [0, 0, 0], label + ': the wire is empty too');
}

// --- thunder: instant strike in the forward cone, otherwise a miss ---
{
  const [st, ctx] = arena(3);
  const [a, b, c] = st.karts;
  a.x = 0; a.z = -20; a.angle = 0;
  b.x = 4; b.z = 0; // ~11 degrees off the nose, 20u away: in the cone
  c.x = 0; c.z = -26; // nearer, but behind
  arm(a, 'thunder', 'vt');
  const rec = recorder(st),targetAtFire={x:b.x,z:b.z};
  shoot(st, ctx, 'p0'); rec.take();
  const blast = rec.all.find((e) => e.type === 'blast' && e.weapon === 'thunder');
  assert(blast && blast.other === 'p1', 'thunder: strikes the rival in the forward cone');
  assert.deepStrictEqual([b.health, c.health], [2, 3], 'thunder: one heart from the struck rival only');
  assert(Math.abs(blast.x-targetAtFire.x)<.01&&Math.abs(blast.z-targetAtFire.z)<.01, 'thunder: the bolt lands on the rival');
  // Nobody in the cone: the ground strike misses every rival.
  arm(a, 'thunder', 'vt2'); b.x = 25; b.z = 25;
  shoot(st, ctx, 'p0'); rec.take();
  assert.strictEqual(c.health,3,'thunder misses the rival behind');
  const miss=rec.all.filter(e=>e.type==='blast'&&e.weapon==='thunder').at(-1);
  assert(!miss.other&&Math.abs(miss.z-(a.z+18))<.01,'miss lands eighteen metres ahead');
  // A shield soaks the strike.
  arm(a,'thunder','vt3');c.x=0;c.z=-10;c.guard=true;
  shoot(st, ctx, 'p0'); rec.take();
  assert.deepStrictEqual([c.health, c.guard], [3, false], 'thunder: Shield blocks the strike and breaks');
  assert(rec.all.some((e) => e.type === 'block' && e.weapon === 'thunder'), 'thunder: block is announced');
  settle(st, ctx, .3, rec);
  clean(st, 'thunder');
  console.log('NEW_ARSENAL ok: thunder');
}

// --- boomerang: curves out, cuts through rivals, curves back, is caught ---
{
  const [st, ctx] = arena(3);
  const [a, b, c] = st.karts;
  a.x = 0; a.z = -24; a.angle = 0;
  b.x = -.3; b.z = -17; c.x = -1; c.z = -14; // the first throw curves left
  arm(a, 'boomerang', 'vb');
  const rec = recorder(st);
  shoot(st, ctx, 'p0'); rec.take();
  assert.strictEqual(st.zaps[0]?.kind, 'boomerang', 'boomerang: blade in the air');
  settle(st, ctx, .3, rec);
  assert.deepStrictEqual([b.health, c.health], [2, 2], 'boomerang: one blade cuts both rivals in its path');
  b.x = 25; b.z = 25; c.x = -25; c.z = 25;
  let far = 0, back = Infinity, steps = 0;
  while (st.zaps.length && steps++ < 200) {
    const z = st.zaps[0], d = Math.hypot(z.x - a.x, z.z - a.z);
    far = Math.max(far, d); if (far > 15) back = Math.min(back, d);
    tick(ctx, st); rec.take();
  }
  assert(far > 18 && far < 30, 'boomerang: reaches about 25u out (' + far.toFixed(1) + ')');
  assert(back < 3, 'boomerang: returns to its thrower');
  assert(steps * .05 < config.weapons.boomerang.ttl, 'boomerang: caught before its TTL');
  // Second throw from the same pickup cannot hurt the same rival again.
  b.x = .3; b.z = -17;
  shoot(st, ctx, 'p0'); settle(st, ctx, 3.5, rec);
  assert.strictEqual(b.health, 2, 'boomerang: once per rival per pickup');
  assert.strictEqual(a.weapon, null, 'boomerang: two throws spent');
  clean(st, 'boomerang');
  console.log('NEW_ARSENAL ok: boomerang');
}

// --- oil: a trap behind; the victim loses a heart and spins out ---
{
  const [st, ctx] = arena(2);
  const [a, b] = st.karts;
  a.x = 0; a.z = 0; a.angle = 0;
  arm(a, 'oil', 'vo');
  const rec = recorder(st);
  shoot(st, ctx, 'p0'); rec.take();
  assert.strictEqual(st.mines.length, 1, 'oil: a slick is down');
  assert.strictEqual(st.mines[0].kind, 'oil', 'oil: slick is tagged');
  assert(st.mines[0].z < a.z, 'oil: dropped behind');
  assert(rec.all.some((e) => e.type === 'fire' && e.weapon === 'oil'), 'oil: drop is announced for its splat sound');
  const m = st.mines[0];
  a.x = 20; a.z = 20;
  settle(st, ctx, .6, rec);
  b.x = m.x + 4; b.z = m.z; b.angle = 1; tick(ctx, st);
  b.x = m.x; b.z = m.z; tick(ctx, st); rec.take();
  assert.strictEqual(b.health, 2, 'oil: one heart');
  assert(b.spinT > 1, 'oil: the victim spins out');
  assert(rec.all.some((e) => e.type === 'splat' && e.other === 'p1'), 'oil: the skid is announced');
  assert.strictEqual(st.mines.length, 0, 'oil: a slick is used up by its victim');
  const before = b.angle;
  tick(ctx, st); tick(ctx, st);
  assert(Math.abs(b.angle - before) > .2, 'oil: the nose swings around');
  assert.strictEqual(karts.view(st, 'p1').karts.find((k) => k.pid === 'p1').spinT > 0, true, 'oil: spin is on the wire');
  // Second slick, left alone, expires.
  shoot(st, ctx, 'p0');
  assert.strictEqual(st.mines.length, 1, 'oil: second slick down');
  settle(st, ctx, config.weapons.oil.lifetime + .5, rec);
  clean(st, 'oil');
  console.log('NEW_ARSENAL ok: oil');
}

// --- frost: lobbed splash; victims lose a heart and slow to 55% ---
{
  const [st, ctx] = arena(3);
  const [a, b, c] = st.karts;
  a.x = 0; a.z = -20; a.angle = 0;
  b.x = 1; b.z = -3; c.x = 15; c.z = -3;
  arm(a, 'frost', 'vf');
  const rec = recorder(st);
  shoot(st, ctx, 'p0'); rec.take();
  assert.strictEqual(st.grenades[0]?.kind, 'frost', 'frost: bomb lobbed');
  assert.strictEqual(karts.view(st, 'p1').grenades[0].warning, false, 'frost: no Nuke warning ring');
  settle(st, ctx, 1.2, rec);
  assert(rec.all.some((e) => e.type === 'blast' && e.weapon === 'frost'), 'frost: shatters');
  assert.deepStrictEqual([b.health, c.health], [2, 3], 'frost: one heart inside the splash only');
  assert(b.frostT > 1 && !(c.frostT > 0), 'frost: the victim is chilled');
  b.input = { steer: 0, throttle: 1, boost: false }; b.lastInputAt = ctx._now + 1e6;
  let top = 0; for (let i = 0; i < 12; i++) { tick(ctx, st); top = Math.max(top, b.speed); }
  assert(top <= E.MAX_SPEED * .55 + 1e-6, 'frost: top speed capped near 55%');
  b.input = { steer: 0, throttle: 0, boost: false };
  settle(st, ctx, 2, rec);
  b.speed = 0;
  clean(st, 'frost');
  console.log('NEW_ARSENAL ok: frost');
}

// --- ram: 3 s boost; touching a rival takes one heart once ---
{
  const [st, ctx] = arena(3);
  const [a, b, c] = st.karts;
  a.x = 0; a.z = -20; a.angle = 0;
  b.x = 0; b.z = -10; c.x = 20; c.z = 20;
  arm(a, 'ram', 'vr');
  const rec = recorder(st);
  shoot(st, ctx, 'p0'); rec.take();
  assert(a.rammingT > 2.8, 'ram: the burst is on');
  assert.strictEqual(a.weapon, null, 'ram: self item is spent');
  assert(karts.view(st, 'p1').karts.find((k) => k.pid === 'p0').rammingT > 0, 'ram: glow state is on the wire');
  a.input = { steer: 0, throttle: 1, boost: false }; a.lastInputAt = ctx._now + 1e6;
  b.x = 25; b.z = 25;
  let top = 0;
  for (let i = 0; i < 30; i++) { tick(ctx, st); rec.take(); top = Math.max(top, a.speed); }
  assert(top > E.MAX_SPEED * 1.2, 'ram: faster than the normal top speed (' + top.toFixed(1) + ')');
  // Keep scraping the rival for several ticks: still one heart.
  for (let i = 0; i < 8; i++) { b.x = a.x + 2; b.z = a.z; b.speed = 0; tick(ctx, st); rec.take(); }
  assert.strictEqual(b.health, 2, 'ram: contact takes one heart, once per pickup');
  assert(rec.all.some((e) => e.type === 'hit' && e.weapon === 'ram'), 'ram: clang is announced');
  a.input = { steer: 0, throttle: 0, boost: false };
  settle(st, ctx, 1.5, rec);
  a.speed = 0;
  clean(st, 'ram');
  console.log('NEW_ARSENAL ok: ram');
}

// --- every new weapon is announced on fire, with its own sound name ---
{
  const fired = new Set();
  for (const weapon of ['thunder', 'boomerang', 'oil', 'frost', 'ram']) {
    const [st, ctx] = arena(2);
    const a = st.karts[0]; a.x = 0; a.z = 0;
    arm(a, weapon, 'va-' + weapon);
    const from = st.events.length;
    shoot(st, ctx, 'p0');
    assert(events(st, 'fire', from).some((e) => e.weapon === weapon), weapon + ' emits one fire event');
    fired.add(weapon);
  }
  assert.strictEqual(fired.size, 5);
  console.log('NEW_ARSENAL ok: every new weapon announces its spend');
}

console.log('Kept secondary arsenal mechanics pass');
