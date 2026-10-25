'use strict';
// Public Room envelopes must expose the same host authority that Next uses.
const assert = require('node:assert/strict');
const { Room } = require('../server/room');

for (const id of ['emoji-story', 'five-second']) {
  const game = require('../games/' + id + '/server');
  const pack = require('../locales/en/' + id + '.json');
  const room = new Room('HOST', { [id]: pack });
  const sockets = Array.from({ length: 3 }, () => ({
    readyState: 1, bufferedAmount: 0, messages: [],
    send(raw) { this.messages.push(JSON.parse(raw)); }, close() {},
  }));
  try {
    const players = sockets.map((socket, index) => room.addPlayer('Host test ' + index, socket).player);
    // Deterministic legal shuffle: the first storyteller/performer is seat1,
    // while the ordinary first-created seat remains host. No phase seeding.
    const random = Math.random;
    try {
      Math.random = () => 0;
      assert(room.startGame(game, { settings: { rounds: 1, pace: 'Quick' } }, players[0].id).ok);
    } finally { Math.random = random; }
    const projection = index => sockets[index].messages.filter(message => message.t === 'state').at(-1);
    const action = (index, value) => {
      const snapshot = projection(index);
      room.onAction(sockets[index], value, { i: snapshot.instanceId, w: snapshot.w });
    };
    const actor = id === 'emoji-story' ? room.game.state.director : room.game.state.performer;
    const actorIndex = players.findIndex(player => player.id === actor);
    assert.notEqual(actor, room.hostId, id + ' fixture needs a non-role host');
    assert.equal(projection(0).hostId, room.hostId, id + ' public host metadata');
    if (id === 'emoji-story') {
      action(actorIndex, { emoji: '🍕🎉' });
      for (let i = 0; i < players.length; i++) if (i !== actorIndex) action(i, { guess: room.game.state.phrase });
    } else {
      action(actorIndex, { answers: 'apple, banana, cherry' });
      for (let i = 0; i < players.length; i++) if (i !== actorIndex) action(i, { vote: 'pass' });
    }
    assert.equal(room.game.state.phase, 'reveal', id + ' ordinary actions reveal the round');
    assert.equal(projection(0).hostId, players[0].id, id + ' reveal exposes the non-role host');
    const totals = { ...room.totals }, instance = room.game.instanceId;
    const unauthorized = players.findIndex((player, index) => index !== 0 && player.id !== actor);
    const scores = { ...room.game.state.scores };
    action(unauthorized, { next: true });
    assert.equal(room.game.state.phase, 'reveal', id + ' non-role guest cannot advance');
    assert.deepEqual(room.game.state.scores, scores, id + ' rejected Next preserves match scores');
    assert.deepEqual(room.totals, totals, id + ' rejected Next preserves party totals');
    action(0, { next: true });
    assert.equal(room.game.state.phase, 'done', id + ' non-role host Next is accepted');
    assert(Object.values(room.game.state.scores).some(score => score > 0), id + ' points retained');
    assert(room.startGame(game, { settings: { rounds: 1, pace: 'Quick' } }, players[0].id).ok);
    assert.notEqual(room.game.instanceId, instance, id + ' fresh rematch identity');
    assert.deepEqual(room.game.state.scores, {}, id + ' fresh match points');
    assert.deepEqual(room.totals, totals, id + ' party totals retained');
    room.disconnect(sockets[0]);
    assert.equal(room.hostId, players[1].id, id + ' host migrates to the next connected player');
    assert.notEqual(room.hostId, players[0].id, id + ' disconnected host is replaced');
    assert.equal(projection(1).hostId, room.hostId, id + ' public host follows ordinary host migration');
    console.log('PASS ' + id + ' public host, non-role Next, natural score, rematch and migration');
  } finally { room.destroy(); }
}
