// Kart garage looks: server validation and roster, driver-list parity with
// the asset loader, the view helpers, and chosen-driver model selection.
// Run: node test/kart-looks.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const THREE = await import('three');
import { KART_LOOK_DRIVERS, KART_PAINTS, cleanKartLook, kartPaintHex } from '../public/js/engines/kart-looks.mjs';
import { createKartModel, kartDriverIndex } from '../public/js/engines/kart-model.mjs';

const require = createRequire(import.meta.url);
const { Room } = require('../server/room.js');
let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (v, m) => { assert.ok(v, m); checks++; };

// The look's drivers are the loader's drivers, in the loader's order.
const assetsSource = fs.readFileSync(new URL('../public/js/engines/kart-assets.mjs', import.meta.url), 'utf8');
const loaderDrivers = JSON.parse(assetsSource.match(/KART_DRIVERS = Object\.freeze\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
eq(KART_LOOK_DRIVERS.map(d => d.id), loaderDrivers, 'garage drivers match KART_DRIVERS');
for (const d of loaderDrivers) ok(fs.existsSync(new URL(`../public/assets/karts/drivers/${d}.glb`, import.meta.url)), `${d} model ships`);
eq(new Set(KART_PAINTS.map(p => p.id)).size, KART_PAINTS.length, 'paint ids are unique');
ok(KART_PAINTS.length >= 8, 'at least eight paints');

// Validation keeps known halves and drops everything else.
eq(cleanKartLook({ paint: 'teal', driver: 'panda' }), { paint: 'teal', driver: 'panda' }, 'full look');
eq(cleanKartLook({ paint: 'teal', driver: 'dragon' }), { paint: 'teal' }, 'unknown driver dropped');
eq(cleanKartLook({ paint: '#ff0000', driver: 'fox', extra: 1 }), { driver: 'fox' }, 'raw colours and extras dropped');
for (const bad of [null, 'fox', 7, [], { paint: 'nope' }, { driver: { toString: () => 'fox' } }, { paint: '__proto__' }]) eq(cleanKartLook(bad), null, `rejects ${JSON.stringify(bad)}`);
eq(kartPaintHex('lime'), 0x7eb643, 'paint hex');
eq(kartPaintHex('nope'), null, 'unknown paint has no hex');

// Server: a seat sets its own look; it rides the roster; bad input errors.
const socket = () => ({ readyState: 1, messages: [], send(s) { this.messages.push(JSON.parse(s)); }, close() {} });
const room = new Room('LOOK', {});
const a = socket(), b = socket();
const pa = room.addPlayer('Ann', a).player, pb = room.addPlayer('Bo', b).player;
eq(room.lobby.players.find(p => p.id === pa.id).kart, undefined, 'no look until chosen');
eq(room.setKartLook(a, { paint: 'cherry', driver: 'raccoon' }), { ok: true, changed: true }, 'look accepted');
eq(room.setKartLook(a, { paint: 'cherry', driver: 'raccoon' }).changed, false, 'same look is not a change');
eq(room.lobby.players.find(p => p.id === pa.id).kart, { paint: 'cherry', driver: 'raccoon' }, 'roster carries the look');
eq(room.lobby.players.find(p => p.id === pb.id).kart, undefined, 'only the sender changed');
ok(room.setKartLook(b, { paint: 'gold-plated' }).error, 'invalid look is an error');
ok(room.setKartLook(b, 'fox').error, 'non-object look is an error');
ok(room.setKartLook(socket(), { driver: 'fox' }).error, 'strangers cannot set looks');
eq(room.setKartLook(a, null).ok, true, 'null clears');
eq(room.lobby.players.find(p => p.id === pa.id).kart, undefined, 'cleared look leaves the roster');
room.setKartLook(a, { driver: 'bunny' });
const snapshot = room.lobby.players.find(p => p.id === pa.id).kart;
snapshot.driver = 'fox';
eq(room.lobby.players.find(p => p.id === pa.id).kart, { driver: 'bunny' }, 'roster copies, never shares');

// The server wires the message and broadcasts the roster on change.
const serverSource = fs.readFileSync(new URL('../server/server.js', import.meta.url), 'utf8');
ok(/case 'kart':[\s\S]{0,400}setKartLook\(ws, msg\.look\)[\s\S]{0,200}broadcastLobby/.test(serverSource), 'server handles kart looks');

// Model: a chosen driver id picks its tagged variant; a pid hashes.
const kart = new THREE.Group(); kart.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
const variants = loaderDrivers.map(id => { const v = new THREE.Group(); v.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())); v.userData.driver = id; v.name = id; return v; });
const assets = { kart, kartVariants: variants };
const picked = m => m.getObjectByName('KartInstance');
for (const id of loaderDrivers) eq(createKartModel(THREE, { assets, color: 0xff0000, driver: id }).children[0].name, 'KartInstance', `${id} builds`);
const nameOf = driver => { const m = createKartModel(THREE, { assets, color: 0xff0000, driver }); return variants.find(v => v.children[0].geometry === picked(m).children[0].geometry)?.name; };
for (const id of loaderDrivers) eq(nameOf(id), id, `${id} picks its own variant`);
eq(nameOf('p1234abcd'), loaderDrivers[kartDriverIndex('p1234abcd', loaderDrivers.length)], 'pids keep the hash fallback');
// A failed driver load leaves a gap; the others still find themselves.
const partial = { kart, kartVariants: variants.filter(v => v.name !== 'bunny') };
const partialName = driver => { const m = createKartModel(THREE, { assets: partial, color: 0, driver }); return partial.kartVariants.find(v => v.children[0].geometry === picked(m).children[0].geometry)?.name; };
eq(partialName('panda'), 'panda', 'variants are found by id, not index');

// Views read looks from the host context and keep their old fallbacks.
for (const file of ['kart-view.js', 'kart-elevated-view.js']) {
  const src = fs.readFileSync(new URL(`../public/js/engines/${file}`, import.meta.url), 'utf8');
  ok(/context\?\.\(\)[\s\S]{0,40}looks|hostContext\(\)\.looks/.test(src) && /Object\.hasOwn\(looks, ?pid\)/.test(src), `${file} reads chosen looks`);
}
const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
ok(/looks: kartLooks\(\)/.test(app), 'host context exposes looks');
ok(/send\(\{ t: 'kart', look: loadKartLook\(\) \}\)/.test(app), 'remembered look is sent on join');
console.log(`KART_LOOKS_PASS: ${checks} checks`);
