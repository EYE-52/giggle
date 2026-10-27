'use strict';
// Accepted custom packs may contain case variants. Recall is insensitive to
// case, so each dealt tray slot must use that same identity for its full bonus.
const assert = require('node:assert/strict');
const { Room } = require('../server/room');
const game = require('../games/memory-tray/server');

async function run() {
  const room = new Room('MEMC', {});
  const sockets = Array.from({ length: 3 }, () => ({ readyState: 1, bufferedAmount: 0, frames: [], send(s) { this.frames.push(JSON.parse(s)); }, close() {} }));
  const players = sockets.map((socket, i) => room.addPlayer('Recall ' + i, socket).player);
  const last = socket => socket.frames.findLast(frame => frame.t === 'state');
  const pack = { items: ['apple', 'key', 'balloon', 'book', 'spoon', 'hat', 'clock', 'fish', 'Apple', 'KEY', 'BALLOON', 'BOOK'] };
  try {
    // Fix the dealer order so the prior implementation reliably dealt Apple
    // and apple into separate slots instead of depending on a random shuffle.
    const random = Math.random;
    try {
      Math.random = () => 0;
      assert(room.startGame(game, { settings: { rounds: 1, memSeconds: 5, recallSeconds: 10 }, pack }, players[0].id).ok);
    } finally { Math.random = random; }
    const tray = last(sockets[0]).items;
    assert.equal(tray.length, 8, 'the eight distinct custom objects fill the tray');
    await new Promise(resolve => setImmediate(resolve));
    const memorize = [...room.timers][0];
    room.game.clockOffset -= 5000;
    memorize.fn();
    room.broadcastState();
    for (const socket of sockets) {
      assert.equal(last(socket).phase, 'recall');
      assert.equal(last(socket).items, undefined, 'the memorized tray is hidden');
    }
    const recall = tray.map(word => ' ' + word.toUpperCase() + ' ').join(',');
    for (const socket of sockets) room.onAction(socket, { recall });
    assert.equal(last(sockets[0]).phase, 'reveal');
    for (const player of players) {
      assert.equal(last(sockets[0]).last.results[player.id].count, 8, 'each distinct object can be recalled');
      assert.equal(last(sockets[0]).scores[player.id], 200, 'complete recall earns the full tray: 150 + 50 (rules standard)');
      assert.equal(room.totals[player.id], 200, 'the session receives the same points exactly once');
    }
    assert.equal(new Set(tray.map(word => word.toLowerCase())).size, 8, 'case variants never occupy separate tray slots');
    room.onAction(sockets[0], { next: true });
    assert.equal(last(sockets[0]).phase, 'done');
    assert(room.startGame(game, { settings: { rounds: 1 } }, players[0].id).ok);
    assert.deepEqual(last(sockets[0]).scores, {}, 'the retained custom pack starts a fresh rematch');
    for (const player of players) assert.equal(room.totals[player.id], 200, 'rematch preserves session totals');
    console.log('MEMORY_CUSTOM_ITEMS_PASS: accepted custom packs, case identity, full recall, privacy, exact awards and rematch');
  } finally { room.destroy(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
