// The second eight weapons on the elevated authority: real crate pickups,
// Rapier poses and legal sequenced inputs (no grants or teleports). Each
// weapon fires, hits, applies its special effect and leaves nothing behind.
import assert from 'node:assert/strict';
import RAPIER from '@dimforge/rapier3d-compat';
import CONFIG from '../public/js/engines/kart-physics-config.mjs';
import COMBAT from '../games/engines/kart-elevated-combat.js';
import COMBAT_CONFIG from '../games/engines/kart-combat-config.js';
await RAPIER.init();
const W = COMBAT_CONFIG.config.weapons;
const results = []; let instances = 0;
const check = (label, value) => { assert.ok(value, label); results.push(label); };
const point = (id, x, z, angle = 0, y = 0, surface = 'floor') => ({ id, x, y, z, angle, surface });
const fixture = (colliders = [], spawns = [point('a', 0, 0), point('b', 0, 30)], sockets = [point('s0', -.7, 0), point('s1', .7, 0)]) =>
  ({ id: 'new-arsenal', revision: 'test-1', half: 180, colliders: [{ id: 'floor', shape: 'box', position: { x: 0, y: -1, z: 0 }, half: { x: 180, y: 1, z: 180 } }, ...colliders], spawns, sockets });
const create = (map, options = {}) => COMBAT.createElevatedCombat(RAPIER, CONFIG, map, map.spawns.map(s => ({ id: s.id })),
  { instance: 'new-arsenal-' + (++instances), seed: 0, startAt: 0, countdownMs: 0, roundMs: 30000, crates: 1, ...options });
const kart = (w, id = 'a') => w.snapshot(id).karts.find(k => k.id === id);
function send(w, id = 'a', intent = {}) {
  const v = w.snapshot(id), p = v.you;
  return w.input(id, { instance: v.instance, life: p.life, controlEpoch: p.controlEpoch, seq: p.receivedSeq + 1, steer: 0, throttle: 0, brake: 0, nitro: false, use: false, ...intent }, v.serverAt);
}
// Every event seen, deduplicated across the bounded snapshot ring.
const logs = new WeakMap();
function step(w, n = 1, each) {
  const log = logs.get(w) || new Map(); logs.set(w, log);
  for (let i = 0; i < n; i++) { each?.(i); w.advance(w.snapshot().serverAt + CONFIG.fixedDt * 1000); for (const e of w.snapshot().events) log.set(e.id, e); }
}
const seen = w => [...(logs.get(w)?.values() || [])];
function fire(w, id = 'a', intent = {}) { assert.ok(send(w, id, { ...intent, use: true }).ok); assert.ok(send(w, id, { ...intent, use: false }).ok); step(w); }
// Search seeds for a real crate roll of this weapon, then wait out spawn protection.
function armed(weapon, map, options = {}) {
  for (let seed = 0; seed < 1024; seed++) {
    const w = create(map, { ...options, seed }); step(w);
    if (kart(w).weapon === weapon) { step(w, 160); return w; }
    w.dispose();
  }
  throw new Error('bounded real pickup search failed for ' + weapon);
}
function clean(w, label) {
  const s = w.snapshot();
  check(label + ': nothing lingers (shots, traps, canisters)', s.projectiles.length === 0 && s.mines.length === 0 && s.grenades.length === 0);
  check(label + ': no status lingers', s.karts.every(k => !(k.frostT > 0) && !(k.spinT > 0) && !(k.rammingT > 0)));
  check(label + ': stats agree', w.stats().projectiles === 0 && w.stats().mines === 0 && w.stats().grenades === 0);
}
const hold = (w, id, intent) => i => { if (i % 6 === 0) send(w, id, intent); };

// thunder
{
  const w = armed('thunder', fixture([], [point('a', 0, 0), point('b', 4, 20), point('c', 0, -9)]));
  try {
    fire(w);
    const blast = seen(w).find(e => e.type === 'blast' && e.weapon === 'thunder');
    check('thunder: strikes the rival in the forward cone at once', blast?.other === 'b' && kart(w, 'b').health === 2 && kart(w, 'c').health === 3);
    check('thunder: the bolt lands on the rival hull', blast && Math.hypot(blast.position.x - kart(w, 'b').pose.position.x, blast.position.z - kart(w, 'b').pose.position.z) < .5);
    check('thunder: fire then strike, in that order', seen(w).findIndex(e => e.type === 'fire' && e.weapon === 'thunder') < seen(w).indexOf(blast));
    step(w, 10); clean(w, 'thunder');
  } finally { w.dispose(); }
}
// boomerang
{
  const w = armed('boomerang', fixture([], [point('a', 0, 0), point('b', -2.2, 12)]));
  try {
    fire(w);
    const a0 = kart(w).pose.position;
    let far = 0, steps = 0, back = Infinity;
    while (w.snapshot().projectiles.length && steps++ < 240) {
      step(w); const s = w.snapshot().projectiles[0]; if (!s) break;
      const d = Math.hypot(s.position.x - a0.x, s.position.z - a0.z); far = Math.max(far, d); if (far > 15) back = Math.min(back, d);
    }
    check('boomerang: arcs out about 25 m (' + far.toFixed(1) + ')', far > 18 && far < 30);
    check('boomerang: comes back and is caught before its TTL', back < 3 && steps < W.boomerang.ttl * 60);
    check('boomerang: cuts the rival on its path once', kart(w, 'b').health === 2 && seen(w).filter(e => e.type === 'hit' && e.weapon === 'boomerang').length === 1);
    step(w, 220);
    check('boomerang: two throws, once per rival per pickup', kart(w, 'b').health === 2 &&
      seen(w).filter(e => e.type === 'fire' && e.weapon === 'boomerang').length === 2);
    clean(w, 'boomerang');
  } finally { w.dispose(); }
}
// oil
{
  const w = armed('oil', fixture([], [point('a', 0, 0), point('b', 0, -12)]));
  try {
    step(w, 30, hold(w, 'a', { throttle: 1 }));
    fire(w, 'a', { throttle: 1 });
    const slick = w.snapshot().mines[0];
    check('oil: a slick is dropped behind', slick?.weapon === 'oil' && slick.position.z < kart(w).pose.position.z);
    check('oil: the drop is announced for its splat', seen(w).some(e => e.type === 'fire' && e.weapon === 'oil'));
    let spun = 0, yaw = 0;
    step(w, 150, i => { hold(w, 'a', { throttle: 1 })(i); hold(w, 'b', { throttle: 1 })(i); const b = kart(w, 'b'); spun = Math.max(spun, b.spinT); yaw = Math.max(yaw, Math.abs(b.pose.angularVelocity.y)); });
    check('oil: each slick the chasing rival drives over takes its own heart', kart(w, 'b').health === 1 && seen(w).filter(e => e.type === 'splat' && e.other === 'b').length === 2);
    check('oil: and spins out (yaw ' + yaw.toFixed(1) + ' rad/s)', spun > 1 && yaw > 3);
    check('oil: one press drops both slicks', seen(w).filter(e => e.type === 'fire' && e.weapon === 'oil').length === 2);
    step(w, 60 * (W.oil.lifetime + 1));
    clean(w, 'oil');
  } finally { w.dispose(); }
}
// frost
{
  const w = armed('frost', fixture([], [point('a', 0, 0), point('b', 0, 10)]));
  try {
    fire(w);
    check('frost: a bomb is lobbed', w.snapshot().grenades[0]?.weapon === 'frost' && w.snapshot().grenades[0].warning === false);
    step(w, 80);
    check('frost: shatters with one heart', seen(w).some(e => e.type === 'blast' && e.weapon === 'frost') && kart(w, 'b').health === 2);
    check('frost: the victim is chilled', kart(w, 'b').frostT > 0.4);
    let top = 0; step(w, 40, i => { hold(w, 'b', { throttle: 1 })(i); top = Math.max(top, Math.abs(kart(w, 'b').pose.speed)); });
    check('frost: chilled kart stays slow (' + top.toFixed(1) + ' m/s)', top < CONFIG.handling.maxForward * .55 + 1);
    step(w, 120); clean(w, 'frost');
  } finally { w.dispose(); }
}
// ram
{
  const w = armed('ram', fixture([], [point('a', 0, 0), point('b', 30, -30)]));
  try {
    fire(w, 'a', { throttle: 1 });
    check('ram: the burst is on', kart(w).rammingT > 2.9 && seen(w).some(e => e.type === 'fire' && e.weapon === 'ram'));
    let top = 0; step(w, 170, i => { hold(w, 'a', { throttle: 1 })(i); top = Math.max(top, kart(w).pose.speed); });
    check('ram: faster than the normal top speed (' + top.toFixed(1) + ' m/s)', top > CONFIG.handling.maxForward * 1.1);
    step(w, 30); clean(w, 'ram (speed)');
  } finally { w.dispose(); }
  const hit = armed('ram', fixture([], [point('a', 0, 0), point('b', 0, 12)]));
  try {
    fire(hit, 'a', { throttle: 1 });
    step(hit, 150, hold(hit, 'a', { throttle: 1 }));
    check('ram: ramming a rival takes one heart, once per pickup', kart(hit, 'b').health === 2 && seen(hit).filter(e => e.type === 'hit' && e.weapon === 'ram').length === 1);
    step(hit, 60); clean(hit, 'ram');
  } finally { hit.dispose(); }
}
console.log(JSON.stringify({ checks: results.length, results }, null, 1));
console.log('KART_ELEVATED_NEW_ARSENAL_PASS');
