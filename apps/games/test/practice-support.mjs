import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { PRACTICE_MODES, practiceSupport } from '../public/js/practice-support.mjs';

const require = createRequire(import.meta.url);
const registry = require('../games/registry');
const catalog = registry.list();
assert.equal(catalog.length, 57);
assert.equal(PRACTICE_MODES['warm-words'], 'timed', 'Warm Words uses timed guesses, not pretend performance');
assert.equal(PRACTICE_MODES['story-builder'], 'turns');
assert.equal(PRACTICE_MODES['draw-phone'], 'drawing');
assert.match(practiceSupport(catalog.find(game => game.id === 'fleet-duel')).note, /fleet.*firing/);
assert.deepEqual(Object.keys(PRACTICE_MODES).sort(), catalog.map(game => game.id).sort(), 'every owned game needs an explicit practice review');
for (const game of catalog) {
  const support = practiceSupport(game);
  assert.equal(support.minSeats, game.minPlayers, `${game.id}: practice cannot bypass the real minimum`);
  assert(support.maxSeats <= game.maxPlayers && support.maxSeats <= 8);
  if (Number.isInteger(game.seats)) assert(support.maxSeats <= game.seats, 'practice player choices exclude spectator slots');
  assert(support.note && support.mode);
}
for (const id of ['new-game', 'constructor', '__proto__']) assert.equal(practiceSupport({ id, minPlayers: 2, maxPlayers: 8 }), null);
assert.equal(practiceSupport({ id: 'trivia', minPlayers: 1, maxPlayers: 8 }), null);
assert.equal(practiceSupport({ id: 'trivia', minPlayers: 3, maxPlayers: 2 }), null);

const source = fs.readFileSync(new URL('../public/js/util.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const uuid = 'b2385d02-3f53-4e2f-b12f-bcd95e5688a6';
const fakeStore = () => {
  const data = new Map();
  return { data, getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
};
function context(search) {
  const local = fakeStore(), session = fakeStore();
  const globals = { location: { search }, localStorage: local, sessionStorage: session, URLSearchParams };
  vm.runInNewContext(source + '\nthis.result = { store, practiceContext };', globals);
  return { ...globals.result, local, session };
}
const normal = context('');
normal.store.set('pb_name', 'Normal player');
assert.equal(normal.local.getItem('pb_name'), 'Normal player');
assert.equal(normal.session.data.size, 0);
const legacy = context('?seat=2');
legacy.store.set('pb_name', 'Legacy test seat');
assert.equal(legacy.local.getItem('seat2:pb_name'), 'Legacy test seat');
const practice = context(`?practice=${uuid}&seat=2`);
practice.local.setItem('pb_name', 'Keep normal');
practice.local.setItem('seat2:pb_name', 'Keep old test');
practice.session.setItem('unrelated', 'Keep this too');
practice.store.set('pb_name', 'Practice player');
practice.store.set('pb_token_TEST', 'test-only-resume-token');
const prefix = `practice:${uuid}:seat2:`;
assert.equal(practice.session.getItem(prefix + 'pb_name'), 'Practice player');
assert.equal(practice.store.get('pb_token_TEST'), 'test-only-resume-token');
assert.equal(practice.local.getItem('pb_name'), 'Keep normal');
assert.equal(practice.local.getItem('seat2:pb_name'), 'Keep old test');
practice.store.remove('pb_token_TEST');
assert.equal(practice.session.getItem(prefix + 'pb_token_TEST'), null);
assert.equal(practice.session.getItem('unrelated'), 'Keep this too');
practice.store.closePractice();
practice.store.set('late-pagehide-write', 'must not survive cleanup');
assert.equal(practice.session.getItem(prefix + 'late-pagehide-write'), null);
normal.store.closePractice(); normal.store.set('ordinary-write', 'still works');
assert.equal(normal.local.getItem('ordinary-write'), 'still works');
for (const query of ['', '?seat=2', '?practice=wrong&seat=2', `?practice=${uuid}&seat=9`, `?practice=${uuid}&seat=01`, `?practice=${uuid}&seat=2&embed=1`]) assert.equal(practice.practiceContext(query), null);
assert.equal(practice.practiceContext(`?practice=${uuid}&seat=8`).seat, 8);
const themeSource = fs.readFileSync(new URL('../public/js/boot-theme.js', import.meta.url), 'utf8');
practice.local.setItem('seat2:pb_theme', 'night');
practice.session.setItem(prefix + 'pb_theme', 'day');
const themeDocument = { documentElement: { dataset: {} } };
vm.runInNewContext(themeSource, { location: { search: `?practice=${uuid}&seat=2` }, URLSearchParams, localStorage: practice.local, sessionStorage: practice.session, document: themeDocument });
assert.equal(themeDocument.documentElement.dataset.theme, undefined, 'first paint does not leak a legacy seat theme into practice');
practice.session.setItem(prefix + 'pb_theme', 'night');
vm.runInNewContext(themeSource, { location: { search: `?practice=${uuid}&seat=2` }, URLSearchParams, localStorage: practice.local, sessionStorage: practice.session, document: themeDocument });
assert.equal(themeDocument.documentElement.dataset.theme, 'night', 'practice reload restores only its own theme');
console.log(`PRACTICE_SUPPORT_PASS: ${catalog.length} explicit game reviews; real minimums, unknown-game rejection, isolated storage and embed separation`);
