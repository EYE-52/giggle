'use strict';
// Actual server/WebSocket contract. Private custom lists deliberately keep the
// same public item count, so a lobby snapshot cannot prove that a save worked.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const path = require('node:path');
const WebSocket = require('ws');
const ROOT = path.join(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; };
async function until(predicate, label, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (predicate()) return; await sleep(15); }
  throw new Error(label);
}
const send = (ws, msg) => ws.send(JSON.stringify(msg));
const latest = (ws, type) => ws.messages.findLast(msg => msg.t === type);
const room = ws => latest(ws, 'room').room;

async function main() {
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; });
  const sockets = [];
  try {
    await until(() => output.includes('PartyBox on') || child.exitCode !== null, 'server did not start');
    check(child.exitCode === null, 'isolated server started on an available localhost port');
    async function connect(hello) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.messages = []; ws.on('message', data => ws.messages.push(JSON.parse(data)));
      sockets.push(ws); await once(ws, 'open'); send(ws, hello);
      await until(() => latest(ws, 'hello') && latest(ws, 'room'), 'seat did not join');
      return ws;
    }
    // Application-level barrier: games is handled after preceding messages on
    // this socket, so assertions do not guess a mutation/ack delay with sleeps.
    async function flush(ws) {
      const start = ws.messages.length; send(ws, { t: 'games' });
      await until(() => ws.messages.slice(start).some(msg => msg.t === 'games'), 'message barrier was not handled');
    }
    const host = await connect({ t: 'create', name: 'Save Host' });
    const code = latest(host, 'hello').code;
    const guest = await connect({ t: 'join', name: 'Observer', code });
    const third = await connect({ t: 'join', name: 'Actor', code });
    const other = await connect({ t: 'create', name: 'Other Room' });
    const first = Array.from({ length: 12 }, (_, i) => `ack-private-old-${i}`);
    const changed = Array.from({ length: 12 }, (_, i) => `ack-private-new-${i}`);
    const privateMarker = /ack-private-(old|new)/;
    const acks = (ws, start = 0) => ws.messages.slice(start).filter(msg => msg.t === 'configured');
    async function save(payload, requestId, expectedGame = 'charades') {
      const start = host.messages.length;
      send(host, { t: 'configure', game: expectedGame, ...payload, requestId }); await flush(host);
      const frames = host.messages.slice(start), ack = frames.find(msg => msg.t === 'configured');
      equal(acks(host, start), [{ t: 'configured', game: expectedGame, requestId }], 'successful save acknowledges exactly the request and game');
      const broadcast = frames.findIndex(msg => msg.t === 'room');
      check(broadcast >= 0 && broadcast < frames.indexOf(ack), 'lobby mutation broadcasts before requester acknowledgement');
      return ack;
    }
    await save({ settings: { rounds: 2 }, pack: { words: first } }, 'save-first');
    await save({ settings: { map: 'Alpine Courtyard', mode: 'Zap Battle', winRule: 'Time limit', roundSeconds: 180, targetStars: 15, targetHits: 10, palette: 'Daybreak', lightCycle: 'Live sunset' } }, 'save-kart-alpine', 'pocket-karts');
    equal(room(host).config['pocket-karts'].settings.map, 'Alpine Courtyard', 'confirmed Pocket Karts save retains the chosen elevated arena');
    const publicFirst = structuredClone(room(host).config.charades);
    const guestStart = guest.messages.length, otherStart = other.messages.length;
    await save({ settings: { rounds: 2 }, pack: { words: changed } }, 'save-same-count');
    equal(room(host).config.charades, publicFirst, 'same-count list edit has identical public metadata');
    await flush(guest); await flush(third); await flush(other);
    equal(acks(guest, guestStart), [], 'successful host saves never acknowledge to another player');
    equal(acks(other, otherStart), [], 'successful saves never acknowledge into another room');
    check(!room(other).config.charades, 'room configuration remains isolated');
    const gameStart = host.messages.length;
    send(host, { t: 'start', game: 'charades' }); await flush(host); await flush(guest); await flush(third);
    const actorState = [host, guest, third].map(ws => latest(ws, 'state')).find(state => typeof state?.word === 'string');
    check(actorState && changed.includes(actorState.word) && !first.includes(actorState.word), 'real game uses replaced private contents despite unchanged count');
    check(host.messages.slice(gameStart).some(msg => msg.t === 'state' && msg.game === 'charades'), 'content proof starts the actual configured game');
    send(host, { t: 'lobby' }); await flush(host);

    const unchanged = structuredClone(room(host).config.charades);
    await save({ settings: { rounds: 2 } }, 'save-no-change');
    equal(room(host).config.charades, unchanged, 'unchanged settings still receive explicit acknowledgement');
    await save({ settings: { rounds: 2 } }, 'x'.repeat(80));

    for (const [requestId, payload, reason] of [
      ['bad-setting', { settings: { rounds: 99 }, pack: { words: first } }, 'settings'],
      ['bad-pack', { settings: { rounds: 3 }, pack: { words: [...changed.slice(0, 11), 'z'.repeat(61)] } }, 'pack length'],
    ]) {
      const start = host.messages.length; send(host, { t: 'configure', game: 'charades', requestId, ...payload }); await flush(host);
      const frames = host.messages.slice(start), error = frames.find(msg => msg.t === 'error');
      check(error && error.game === 'charades' && error.requestId === requestId, 'validation error echoes valid request identity: ' + reason);
      equal(acks(host, start), [], 'invalid configure cannot claim success: ' + reason);
      equal(room(host).config.charades, unchanged, 'invalid configure cannot partially mutate: ' + reason);
    }
    for (const requestId of ['x'.repeat(81), '', 'contains spaces', 'bad/id', 123, { fake: 'id' }]) {
      const start = host.messages.length;
      send(host, { t: 'configure', game: 'charades', requestId, settings: { rounds: 3 } }); await flush(host);
      const rejection = host.messages.slice(start).find(msg => msg.t === 'error');
      check(rejection, 'malformed or oversized request identity is rejected');
      check(!Object.hasOwn(rejection, 'requestId'), 'rejected malformed identity is never reflected in a response');
      equal(acks(host, start), [], 'malformed identity never receives a success acknowledgement');
      equal(room(host).config.charades, unchanged, 'malformed identity cannot mutate valid room settings');
    }
    send(host, { t: 'start', game: 'charades' }); await flush(host); await flush(guest); await flush(third);
    const afterRefusals = [host, guest, third].map(ws => latest(ws, 'state')).find(state => typeof state?.word === 'string');
    check(afterRefusals && changed.includes(afterRefusals.word), 'rejected requests preserve actual private pack contents as well as public settings');
    send(host, { t: 'lobby' }); await flush(host);
    const refusalStart = guest.messages.length, hostBeforeRefusal = host.messages.length;
    send(guest, { t: 'configure', game: 'charades', requestId: 'save-no-change', settings: { rounds: 3 } }); await flush(guest); await flush(host);
    const refusal = guest.messages.slice(refusalStart).find(msg => msg.t === 'error');
    check(refusal && /host/i.test(refusal.msg) && refusal.game === 'charades' && refusal.requestId === 'save-no-change', 'nonhost refusal identifies its own game/request');
    equal(acks(guest, refusalStart), [], 'nonhost configure never receives success');
    equal(acks(host, hostBeforeRefusal), [], 'another player cannot manufacture the host pending acknowledgement');
    equal(room(host).config.charades, unchanged, 'nonhost configure cannot mutate settings');

    const parallelStart = host.messages.length;
    send(host, { t: 'configure', game: 'charades', requestId: 'parallel-charades', settings: { rounds: 2 } });
    send(host, { t: 'configure', game: 'draw-phone', requestId: 'parallel-draw', settings: { writeSeconds: 15 } });
    send(host, { t: 'configure', game: 'charades', requestId: 'parallel-rejected', settings: { rounds: 99 } });
    send(other, { t: 'configure', game: 'charades', requestId: 'parallel-charades', settings: { rounds: 3 } });
    await flush(host); await flush(other);
    equal(acks(host, parallelStart), [
      { t: 'configured', game: 'charades', requestId: 'parallel-charades' },
      { t: 'configured', game: 'draw-phone', requestId: 'parallel-draw' },
    ], 'concurrent game requests retain their own acknowledgement identities');
    check(host.messages.slice(parallelStart).some(msg => msg.t === 'error' && msg.requestId === 'parallel-rejected' && msg.game === 'charades'), 'parallel rejected request remains an error');
    check(acks(other).some(msg => msg.requestId === 'parallel-charades' && msg.game === 'charades'), 'same identifier in another room is acknowledged independently');
    equal(room(host).config.charades.settings.rounds, 2, 'parallel request in another room cannot change this room');
    equal(room(other).config.charades.settings.rounds, 3, 'other room retains its independent mutation');

    await save({ reset: true }, 'reset-config');
    check(!room(host).config.charades, 'reset clears configured settings/list metadata');
    await save({ reset: true }, 'reset-already-default');
    check(!room(host).config.charades, 'already-default reset still acknowledges without adding configuration');
    const legacyStart = host.messages.length, legacyGuestStart = guest.messages.length;
    send(host, { t: 'configure', game: 'charades', settings: { rounds: 3 } }); await flush(host); await flush(guest);
    equal(room(host).config.charades.settings.rounds, 3, 'legacy request without an identifier still mutates settings');
    check(host.messages.slice(legacyStart).some(msg => msg.t === 'room') && guest.messages.slice(legacyGuestStart).some(msg => msg.t === 'room'), 'legacy clients retain ordinary lobby broadcasts');
    equal(acks(host, legacyStart), [], 'legacy request does not invent a correlation identifier');
    for (const ws of sockets) {
      for (const msg of ws.messages.filter(msg => ['configured', 'room', 'games', 'error'].includes(msg.t))) {
        check(!privateMarker.test(JSON.stringify(msg)), 'acknowledgements/public frames never echo private list contents');
        if (msg.t === 'configured') equal(Object.keys(msg).sort(), ['game', 'requestId', 't'], 'acknowledgement contains no settings, list or private game state');
      }
    }
    console.log('configure-ack: ' + checks + ' real WebSocket checks passed');
  } catch (error) {
    error.message += '\nIsolated server output:\n' + output.slice(-4000); throw error;
  } finally {
    for (const ws of sockets) ws.terminate();
    if (child.exitCode === null) {
      const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit;
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
