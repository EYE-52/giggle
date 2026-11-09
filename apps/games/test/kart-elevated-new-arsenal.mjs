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

// frost
{
  const w = armed('frost', fixture([], [point('a', 0, 0), point('b', 0, 10)]));
  try {
    fire(w);
    check('frost: a bomb is lobbed', w.snapshot().grenades[0]?.weapon === 'frost' && w.snapshot().grenades[0].warning === false);
    step(w, 80);
    check('frost: shatters with one heart', seen(w).some(e => e.type === 'blast' && e.weapon === 'frost') && kart(w, 'b').health === 55);
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
    check('ram: ramming a rival takes one heart, once per pickup', kart(hit, 'b').deaths===1 && seen(hit).filter(e => e.type === 'hit' && e.weapon === 'ram').length === 1);
    step(hit, 60); clean(hit, 'ram');
  } finally { hit.dispose(); }
}
console.log(JSON.stringify({ checks: results.length, results }, null, 1));
console.log('KART_ELEVATED_NEW_ARSENAL_PASS');
