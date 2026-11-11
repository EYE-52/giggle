// Doodle's existing rt1 delta must reconstruct the exact private JSON view.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { decodeFrame } from '../public/js/toolkit/realtime/client.mjs';
import { decodeFrameBytes } from '../public/js/toolkit/realtime/codec.mjs';
const require = createRequire(import.meta.url);
const { Room, SLOW_SOCKET_BYTES } = require('../server/room');
const game = require('../games/doodle-guess/server');
const pack = require('../locales/en/doodle-guess.json');
let checks = 0;
const eq = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const sink = () => ({ realtime: 'rt1', readyState: 1, bufferedAmount: 0, frames: [],
  send(frame) { this.frames.push(frame); }, close() {} });
const room = new Room('DRT1', { 'doodle-guess': pack });
const seats = ['Ada', 'Bo', 'Cam'].map(name => {
  const socket = sink(), player = room.addPlayer(name, socket).player;
  return { socket, player, decoder: decodeFrame(), state: null, bytes: 0 };
});
let now = Date.now();
const realNow = Date.now;
Date.now = () => now;
function drain() {
  for (const seat of seats) for (const frame of seat.socket.frames.splice(0)) {
    if (typeof frame === 'string') continue;
    seat.bytes = frame.byteLength;
    const state = seat.decoder.apply(frame);
    ok(state, 'ordered binary frame decodes');
    seat.state = state;
  }
}
function compare(label) {
  drain();
  // Same authority, same recipient and same clock: no hand-built expected view.
  for (const seat of seats) seat.socket.realtime = undefined;
  room.broadcastState();
  for (const seat of seats) {
    const expected = seat.socket.frames.splice(0).map(frame => JSON.parse(frame)).findLast(frame => frame.t === 'state');
    eq(seat.state, expected, label + ': decoded view equals complete legacy JSON');
    seat.socket.realtime = 'rt1';
  }
}
function act(seat, action) {
  now += 1;
  room.onAction(seat.socket, action, { i: room.game.instanceId, w: room._actionToken() });
}
const ink = { pts: [[.1, .2], [.7, .6]], color: '#112233', size: 7, tool: 'pen' };
try {
  ok(!room.startGame(game, { settings: { rounds: 2, roundSeconds: 600, hints: false } }, seats[0].player.id).error, 'start');
  compare('initial pick keyframes');
  const artist = seats.find(seat => seat.player.id === room.game.state.drawer);
  const guessers = seats.filter(seat => seat !== artist);
  const meta = (gestureId, chunk = 0) => ({ inkNonce: room.game.state.inkNonce,
    inkRevision: room.game.state.inkRevision, gestureId, chunk });
  act(artist, { choose: room.game.state.choices[0] });
  compare('draw transition');
  const secret = room.game.state.word;
  for (const seat of guessers) {
    eq(seat.state.word, undefined, 'guesser never receives the answer');
    eq(seat.state.choices, undefined, 'guesser never receives choices');
    eq(seat.state.inkNonce, undefined, 'guesser never receives artist nonce');
  }
  const shared = game.realtime(room.game.state).publicView(room.game.state, room.ctx());
  eq(Object.keys(shared).sort(), ['guesses', 'preview', 'strokes'], 'only explicit spectator-projected fields enter shared history');
  act(artist, { preview: { ...ink, id: 'client-chosen' }, ...meta(1), sample: 1 });
  room.onTick(); compare('live preview');
  eq(guessers[0].state.preview.id, '1:0', 'public chunk ID is a string derived by the authority');
  act(artist, { stroke: ink, ...meta(1), finished: false }); compare('first committed chunk');
  eq(guessers[0].state.strokes[0].id, '1:0', 'committing a preview preserves its public ID');
  act(artist, { stroke: ink, ...meta(1, 1), finished: true }); compare('final committed chunk');
  eq(guessers[0].state.strokes.map(stroke => stroke.id), ['1:0', '1:1'], 'chunks within one gesture have distinct stable keys');
  act(artist, { undo: true, ...meta(1) }); compare('undo removes the whole gesture');
  eq(guessers[0].state.strokes.length, 0, 'undo reconstructs an empty canvas');
  for (let gesture = 2; gesture < 42; gesture++) {
    const pts = Array.from({ length: 64 }, (_, i) => [i / 64, (gesture % 10) / 10]);
    act(artist, { stroke: { ...ink, pts }, ...meta(gesture), finished: true });
  }
  compare('accumulated mutable ink history');
  const jsonBytes = Buffer.byteLength(JSON.stringify(guessers[0].state));
  act(guessers[0], { guess: 'Not the answer' });
  compare('independent guess with unchanged ink');
  ok(guessers[0].bytes < jsonBytes / 10, 'one guess sends a small delta rather than replaying the canvas');
  eq(guessers[1].state.myFeedback, null, 'private feedback does not leak to another guesser');
  // Hidden solves cannot alter public counters, IDs, or bounded-history eviction.
  for (let i = 0; i < 82; i++) act(guessers[0], { guess: 'zqxv public ' + i });
  compare('bounded public guess history');
  const publicBeforeSolve = structuredClone(guessers[1].state.guesses);
  eq(publicBeforeSolve.length, 80, 'public guess history remains bounded');
  act(guessers[0], { guess: secret }); compare('private successful guess');
  for (const seat of seats) eq(seat.state.guessSerial, undefined, 'internal guess counter is absent in rt1 and matching JSON');
  eq(guessers[1].state.guesses, publicBeforeSolve, 'private solve changes neither public IDs nor bounded history');
  act(guessers[0], { guess: 'zqxv solver chat' }); compare('public solver chat after private solve');
  const visible = guessers[1].state.guesses;
  eq(visible.at(-1).id, publicBeforeSolve.at(-1).id + 1, 'private solve consumes no public guess ID');
  eq(visible.slice(0, -1), publicBeforeSolve.slice(1), 'retained public messages keep stable IDs after eviction');
  eq(guessers[1].state.guessed, {}, 'other player cannot see the solver');
  ok(!JSON.stringify(game.realtime(room.game.state).publicView(room.game.state, room.ctx())).includes(secret), 'shared feed does not reveal the correct answer');

  // A fresh socket/decoder must receive a complete baseline, not an old delta.
  const old = guessers[1], fresh = sink();
  const resumed = room.addPlayer(old.player.name, fresh, old.player.token);
  eq(resumed.player.id, old.player.id, 'reconnect resumes the same private seat');
  old.socket = fresh; old.decoder = decodeFrame();
  room.broadcastState();
  compare('reconnect keyframe with retained ink');
  old.decoder.reset();
  room.broadcastState();
  const lostBase = old.socket.frames.findLast(frame => typeof frame !== 'string');
  ok(old.decoder.apply(lostBase) === null, 'missing base fails closed');
  old.socket.frames = [];
  room.realtimeResync(old.socket); room.broadcastState();
  const keyframe = old.socket.frames.findLast(frame => typeof frame !== 'string');
  ok(decodeFrameBytes(keyframe).keyframe, 'explicit resync sends a keyframe');
  compare('resync restores the exact full canvas');

  act(artist, { clear: true, ...meta(42) }); compare('clear increments revision and removes retained ink');
  eq(guessers[0].state.strokes, [], 'clear reconstructs no strokes');
  old.socket.bufferedAmount = SLOW_SOCKET_BYTES + 1;
  for (let sample = 1; sample <= 6; sample++) {
    act(artist, { preview: ink, ...meta(43), sample });
    room.onTick();
  }
  drain();
  act(guessers[1], { guess: secret }); compare('reveal preserves final unfinished ink');
  eq(guessers[1].state.word, secret, 'reveal publishes the answer');
  eq(guessers[1].state.strokes.length, 1, 'final preview was committed before reveal');
  eq(guessers[1].state.strokes[0].id, '43:0', 'final unfinished preview retains its key at reveal');
  old.socket.bufferedAmount = 0;
  act(artist, { next: true }); compare('next round removes old private fields and canvas');
  eq(guessers[1].state.strokes.length, 0, 'next round starts with a clear canvas');
  const nextArtist = seats.find(seat => seat.player.id === room.game.state.drawer);
  for (const seat of seats.filter(seat => seat !== nextArtist)) {
    eq(seat.state.wordShown, undefined, 'former artist does not retain wordShown');
    eq(seat.state.inkNonce, undefined, 'former artist does not retain inkNonce');
    eq(seat.state.choices, undefined, 'only the new artist sees choices');
  }
  act(nextArtist, { choose: room.game.state.choices[0] }); compare('next turn can reuse gesture IDs on a new canvas');
  const chunkInk = { ...ink, pts: Array.from({ length: 64 }, (_, i) => [i / 64, (i % 10) / 10]) };
  const strokeNode = seat => decodeFrameBytes(seat.socket.frames.findLast(frame => typeof frame !== 'string')).json.p.o?.strokes;
  const commit = (gesture, chunk = 0, finished = true) => act(nextArtist, { stroke: chunkInk, ...meta(gesture, chunk), finished });
  const commitBytes = [];
  for (let gesture = 1; gesture <= 401; gesture++) {
    commit(gesture);
    if ([80, 400, 401].includes(gesture)) {
      const node = strokeNode(guessers[0]);
      eq(node.k, 'id', 'committed strokes use existing keyed-array patches');
      eq(node.a, [`${gesture}:0`], 'one commit appends only its new public key');
      eq(Object.keys(node.u), [`${gesture}:0`], 'one commit carries only the new chunk');
      eq(node.x || [], gesture === 401 ? ['1:0'] : [], 'rollover evicts only the oldest chunk key');
      eq(node.$, undefined, 'one commit never replaces the full retained canvas');
      const frame = guessers[0].socket.frames.findLast(frame => typeof frame !== 'string');
      commitBytes.push(frame.byteLength);
      ok(frame.byteLength < 4096, 'commit payload remains small at 80 and 400 retained chunks');
      compare(`keyed commit ${gesture}`);
    } else drain();
  }
  ok(Math.max(...commitBytes) - Math.min(...commitBytes) < 128, 'commit bytes do not grow with retained ink');
  eq(guessers[0].state.strokes.length, 400, 'rollover keeps the bounded canvas');
  eq(new Set(guessers[0].state.strokes.map(stroke => stroke.id)).size, 400, 'all retained chunk keys are unique');
  ok(guessers[0].state.strokes.every(stroke => typeof stroke.id === 'string'), 'chunk key type stays stable');

  act(nextArtist, { clear: true, ...meta(402) }); compare('clear removes every keyed chunk');
  act(nextArtist, { preview: chunkInk, ...meta(402), sample: 1 }); room.onTick(); compare('resumable keyed preview');
  const resumedArtistSocket = sink();
  room.addPlayer(nextArtist.player.name, resumedArtistSocket, nextArtist.player.token);
  nextArtist.socket = resumedArtistSocket; nextArtist.decoder = decodeFrame();
  room.broadcastState(); compare('artist reconnect retains its unfinished chunk ID');
  commit(403); compare('new gesture commits the resumed fragment once');
  eq(guessers[0].state.strokes.map(stroke => stroke.id), ['402:0', '403:0'], 'resumed preview and new gesture keep distinct keys');
  act(nextArtist, { undo: true, ...meta(403) }); compare('undo removes only the resumed artist latest gesture');
  eq(guessers[0].state.strokes.map(stroke => stroke.id), ['402:0'], 'undo retains the earlier resumed fragment');
  act(nextArtist, { clear: true, ...meta(404) }); compare('clear after resumed drawing');

  commit(404, 0, false); drain();
  commit(404, 1, true); drain();
  for (let gesture = 405; gesture <= 802; gesture++) { commit(gesture); drain(); }
  eq(guessers[0].state.strokes.length, 400, 'multi-chunk gesture reaches the canvas bound');
  commit(803);
  const trimmed = strokeNode(guessers[0]);
  eq(trimmed.x, ['404:0', '404:1'], 'trimming removes every chunk of the oldest whole gesture');
  eq(trimmed.a, ['803:0'], 'whole-gesture trim appends only the new chunk');
  eq(Object.keys(trimmed.u), ['803:0'], 'whole-gesture trim replays no retained chunks');
  compare('multi-chunk whole-gesture trim');
  eq(guessers[0].state.strokes.length, 399, 'whole-gesture trim preserves existing canvas rules');
  console.log(`DRAWING_REALTIME_PASS: ${checks} exact JSON equivalence, privacy, keyed commit/eviction, undo/clear/final draw, reconnect/resync and round-change assertions`);
} finally { room.destroy(); Date.now = realNow; }
