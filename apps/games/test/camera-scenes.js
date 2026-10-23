'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Rooms } = require('../server/room');
const charades = require('../games/charades/server');
(async () => {
  const { cameraSceneForState } = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(require.resolve('../public/js/embed.js'), 'utf8')).toString('base64'));
  const rooms = new Rooms({}), room = rooms.getOrCreateGiggle('private-squad');
  const socket = () => ({ readyState: 1, send() {}, close() {} });
  const a = room.addGigglePlayer('user-a', 'Same name', socket()).player;
  const b = room.addGigglePlayer('user-b', 'Same name', socket()).player;
  const scene = { mode: 'spotlight', featured: b.id, caption: 'Act it out' };
  assert.deepEqual(cameraSceneForState({ camera: scene }, room.lobby.players), { ...scene, featured: 'user-b' });
  assert.notEqual(a.id, b.id);
  const anonymous = rooms.create();
  anonymous.addPlayer('Same name', socket());
  assert.equal(cameraSceneForState({ camera: scene }, anonymous.lobby.players), null);
  assert.ok(anonymous.lobby.players.every(p => !('callUserId' in p)));
  for (const camera of [null, [], { ...scene, featured: 'unknown' }, { ...scene, caption: 'x'.repeat(121) }, { ...scene, mode: 'grid' }]) {
    assert.equal(cameraSceneForState({ camera }, room.lobby.players), null);
  }
  assert.deepEqual(cameraSceneForState({ camera: { mode: 'gallery', featured: null, caption: 'Show a book' } }, []), { mode: 'gallery', featured: null, caption: 'Show a book' });
  const people = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const ctx = { content: () => ({ words: ['secret-dragon'] }), settings: () => ({ rounds: 1 }), allPlayers: () => people, now: () => 1000, later: () => () => {}, award() {}, broadcast() {} };
  const state = charades.create(ctx);
  for (const person of people) {
    const view = charades.view(state, person.id);
    assert.equal(view.camera.featured, state.actor);
    assert.ok(!view.camera.caption.includes(state.word));
    if (person.id !== state.actor) assert.ok(!('word' in view) && !('wordShown' in view));
  }
  state.phase = 'done'; state.endsAt = 0;
  assert.equal(charades.view(state, 'b').camera, null);
  console.log('CAMERA SCENES PASS: verified identities, no name matching, anonymous isolation, bounded scenes, Charades private word');
})().catch(error => { console.error(error); process.exitCode = 1; });
