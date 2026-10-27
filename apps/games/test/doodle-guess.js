'use strict';
const assert = require('node:assert/strict');
const { Room, SLOW_SOCKET_BYTES } = require('../server/room');
const game = require('../games/doodle-guess/server');
const pack = require('../locales/en/doodle-guess.json');
const roster = ['a', 'b', 'c'].map(id => ({ id, name: id }));
function run(rounds = 2, content = pack) {
  const ctx = { time: 1000, timers: [], awards: {}, allPlayers: () => roster,
    players: () => roster, settings: () => ({ rounds, roundSeconds: 30 }), content: () => content,
    now() { return this.time; }, later(ms, fn) { this.timers.push({ at: this.time + ms, fn }); },
    award(pid, points) { this.awards[pid] = (this.awards[pid] || 0) + points; }, broadcast() {} };
  const s = game.create(ctx);
  const act = (pid, a) => game.onAction(s, ctx, pid, a);
  const choose = () => act(s.drawer, { choose: game.view(s, s.drawer).choices[0] });
  const meta = (id = 1, chunk = 0) => ({ inkNonce: game.view(s, s.drawer).inkNonce, inkRevision: s.inkRevision, gestureId: id, chunk });
  return { s, ctx, act, choose, meta };
}
const ink = { pts: [[.1, .2], [.4, .2]], color: '#111111', size: 7, tool: 'pen' };
let checks = 0;
{
  const { s, act, choose, meta, ctx } = run(); choose();
  const drawer = s.drawer, guesser = roster.find(p => p.id !== drawer).id;
  const token = meta();
  act(drawer, { stroke: ink, finished: true });
  assert.equal(s.strokes.length, 0, 'metadata-free stale client cannot draw');
  assert.match(game.view(s, drawer).myInkFeedback, /Reload/);
  act(guesser, { stroke: ink, ...token, finished: true });
  act('outsider', { stroke: ink, ...token, finished: true });
  act(drawer, { stroke: ink, ...token, inkNonce: 'old', finished: true });
  assert.equal(s.strokes.length, 0, 'ownership and nonce are enforced'); checks += 3;
  act(drawer, { preview: ink, ...token, sample: 1 });
  const newer = { ...ink, pts: [[.1, .2], [.6, .2]] };
  act(drawer, { preview: newer, ...token, sample: 3 });
  act(drawer, { preview: ink, ...token, sample: 2 });
  assert.deepEqual(s.preview.pts, newer.pts, 'older preview cannot shrink current ink');
  act(drawer, { stroke: newer, ...token, finished: true });
  act(drawer, { stroke: newer, ...token, finished: true });
  act(drawer, { preview: ink, ...token, sample: 4 });
  assert.equal(s.strokes.length, 1, 'duplicate completed chunks are rejected');
  assert.equal(s.preview, null, 'late preview cannot repeat committed ink'); checks += 3;
  act(drawer, { clear: true, ...meta() });
  act(drawer, { stroke: newer, ...token, finished: true });
  act(drawer, { preview: newer, ...token, sample: 5 });
  assert.equal(s.strokes.length, 0, 'queued commit after Clear is rejected');
  assert.equal(s.preview, null, 'queued preview after Clear is rejected'); checks += 2;
  const long = { ...ink, pts: Array.from({ length: 200 }, (_, i) => [i / 200, .2]) };
  const gesture = meta(2);
  act(drawer, { stroke: long, ...gesture, finished: false });
  act(drawer, { stroke: long, ...gesture, finished: false });
  act(drawer, { stroke: ink, ...gesture, chunk: 2, finished: true });
  assert.equal(s.strokes.length, 1, 'duplicates and out-of-order chunks are rejected');
  act(drawer, { preview: ink, ...gesture, chunk: 1, sample: 1 });
  act(drawer, { stroke: ink, ...gesture, chunk: 1, finished: true });
  assert.equal(s.strokes.length, 2, 'one gesture can span 200-point chunks');
  act(drawer, { undo: true, ...meta() });
  assert.equal(s.strokes.length, 0, 'Undo removes the entire gesture');
  act(drawer, { stroke: ink, ...gesture, chunk: 1, finished: true });
  assert.equal(s.strokes.length, 0, 'late chunks cannot restore an undone gesture'); checks += 4;
  const before = s.inkRevision;
  const undo = { undo: true, ...meta() };
  act(drawer, undo); act(drawer, undo);
  assert.equal(s.inkRevision, before + 1, 'duplicate Undo consumes one revision'); checks++;
  act(drawer, { preview: ink, ...meta(3), sample: 1 });
  act(drawer, { stroke: ink, ...meta(4), finished: true });
  assert.equal(s.strokes.length, 2, 'reconnected artist retains prior partial gesture');
  act(drawer, { preview: ink, ...meta(3), sample: 2 });
  assert.equal(s.preview, null, 'old gesture cannot resume after a newer gesture'); checks += 2;
  act(guesser, { guess: 'wrong' });
  act(guesser, { guess: s.word.toUpperCase() + '  ' });
  const publicView = game.view(s, 'watcher');
  assert.equal(publicView.guesses.at(-1).text, undefined, 'correct answer text is omitted');
  assert(!JSON.stringify(publicView.guesses).toLowerCase().includes(s.word.toLowerCase()), 'public feed does not contain the answer');
  assert.equal(publicView.inkNonce, undefined, 'only artist receives mutation nonce');
  assert.equal(publicView.lastGestureId, undefined, 'private drawing counters are omitted');
  assert.equal(game.view(s, drawer).myFeedback, null, 'guess feedback is private'); checks += 5;
  const score = s.scores[guesser]; act(guesser, { guess: s.word });
  assert.equal(s.scores[guesser], score, 'duplicate guess does not score twice'); checks++;
  for (const p of roster) if (p.id !== drawer) act(p.id, { guess: s.word });
  assert.equal(s.phase, 'reveal');
  const oldNonce = token.inkNonce;
  act(drawer, { next: true }); choose();
  act(s.drawer, { stroke: ink, ...meta(), inkNonce: oldNonce, finished: true });
  assert.equal(s.strokes.length, 0, 'previous turn nonce cannot draw in a new turn'); checks += 2;
  ctx.time = s.endsAt;
  act(s.drawer, { preview: ink, ...meta(), sample: 1 });
  assert.equal(s.phase, 'reveal', 'deadline rejects further drawing'); checks++;
}
{
  const { s, act, choose, meta, ctx } = run(1); choose();
  const eraser = { ...ink, color: '#000', tool: 'eraser' };
  act(s.drawer, { stroke: eraser, ...meta(), finished: true });
  assert.equal(s.strokes[0].color, '#ffffff', 'eraser deterministically replays as canvas white');
  const before = s.strokes.length;
  for (const patch of [{ gestureId: 1e9 + 1 }, { gestureId: 'g1' }, { chunk: 400 }, { chunk: -1 }, { finished: null }])
    act(s.drawer, { stroke: ink, ...meta(2), finished: true, ...patch });
  for (const bad of [{ ...ink, color: 'url(secret)' }, { ...ink, tool: 'destination-out' }, { ...ink, pts: [[NaN, 0], [1, 1]] }])
    act(s.drawer, { stroke: bad, ...meta(2), finished: true });
  assert.equal(s.strokes.length, before, 'malformed boundaries reject atomically'); checks += 2;
  act(s.drawer, { preview: ink, ...meta(2), sample: 1 });
  ctx.time = s.endsAt; act(s.drawer, { stroke: ink, ...meta(2), finished: true });
  assert.equal(s.strokes.length, 2, 'deadline freezes latest preview once');
  const drawer = s.drawer;
  act(drawer, { next: true }); act(drawer, { next: true });
  assert.equal(s.phase, 'done');
  assert.equal(s.endsAt, 0); checks += 3;
}
// Real Room routing: three active sockets, a watcher and a reclaimed artist seat.
{
  const room = new Room('DQA', { [game.id]: pack });
  const socket = () => ({ readyState: 1, bufferedAmount: 0, frames: [], send(text) { this.frames.push(JSON.parse(text)); }, close() {} });
  const sockets = [socket(), socket(), socket()];
  const players = sockets.map((ws, i) => room.addPlayer('Artist ' + i, ws).player);
  try {
    assert(room.startGame(game, { settings: { rounds: 1, roundSeconds: 30 } }, players[0].id).ok);
    const s = room.game.state, artistIndex = players.findIndex(p => p.id === s.drawer), artist = sockets[artistIndex];
    room.onAction(artist, { choose: s.choices[0] });
    const watcher = socket(); room.addPlayer('Watcher', watcher); room.broadcastState();
    const latest = ws => ws.frames.filter(f => f.t === 'state').at(-1);
    const meta = () => ({ inkNonce: latest(artist).inkNonce, inkRevision: latest(artist).inkRevision, gestureId: 1, chunk: 0 });
    const a = { preview: ink, ...meta(), sample: 1 };
    sockets.forEach(ws => { ws.frames = []; });
    room.onAction(artist, a); room.onAction(artist, { ...a, sample: 2 });
    assert(sockets.every(ws => ws.frames.length === 0), 'previews are coalesced');
    sockets[(artistIndex + 1) % 3].bufferedAmount = SLOW_SOCKET_BYTES + 1;
    room.onTick();
    assert.equal(sockets[(artistIndex + 1) % 3].frames.length, 0);
    assert.equal(sockets[(artistIndex + 2) % 3].frames.length, 1); checks += 3;
    room.onAction(artist, { stroke: ink, ...a, preview: undefined, finished: true });
    const slow = sockets[(artistIndex + 1) % 3];
    assert.equal(latest(slow).strokes.length, 1, 'commits reach a socket that skipped live ink');
    room.onAction(watcher, { stroke: ink, ...a, finished: true });
    assert.equal(s.strokes.length, 1, 'watcher cannot mutate the drawing'); checks += 2;
    const resumed = socket(); room.disconnect(artist);
    room.addPlayer(players[artistIndex].name, resumed, players[artistIndex].token); room.broadcastState();
    assert.equal(latest(resumed).strokes.length, 1, 'reclaimed artist receives saved canvas');
    assert.equal(latest(resumed).inkNonce, s.inkNonce, 'reclaimed artist receives current drawing contract');
    assert.equal(latest(watcher).word, undefined, 'watcher does not receive secret'); checks += 3;
    for (let i = 0; i < 3; i++) if (i !== artistIndex) room.onAction(sockets[i], { guess: s.word });
    assert.equal(s.phase, 'reveal');
    room.onAction(resumed, { next: true });
    assert.equal(s.phase, 'done');
    const priorInstance = room.game.instanceId;
    assert(room.startGame(game, { settings: { rounds: 1 } }, room.hostId).ok);
    assert.notEqual(room.game.instanceId, priorInstance, 'rematch mints fresh instance');
    const next = room.game.state;
    const nextArtist = next.drawer === players[artistIndex].id ? resumed : sockets[players.findIndex(p => p.id === next.drawer)];
    room.onAction(nextArtist, { choose: next.choices[0] });
    room.onAction(nextArtist, { stroke: ink, ...a, finished: true }, { i: priorInstance });
    assert.equal(next.strokes.length, 0, 'Room drops stale rematch action'); checks += 4;
  } finally { room.destroy(); }
}
{
  const word='a'.repeat(60);
  const {s,act,choose}=run(1,{words:Array(10).fill(word)});choose();
  const guesser=roster.find(p=>p.id!==s.drawer).id;
  act(guesser,{guess:word+'x'});
  assert.equal(s.guessed[guesser],undefined,'overlength guess cannot score by truncated prefix');
  assert.equal(s.guesses.length,0,'overlength guess is not copied into the public feed');
  act(guesser,{guess:word});
  assert(s.guessed[guesser],'valid60-character custom word still scores');checks+=3;
}
// The optional timed mode reveals only a few letters and cannot disclose a word.
for (const hints of [true, false]) {
  const ctx = { time: 1000, allPlayers: () => roster, players: () => roster,
    settings: () => ({ rounds: 1, roundSeconds: 30, hints }),
    content: () => ({ words: Array(10).fill('watermelon') }), now() { return this.time; }, later() {}, award() {}, broadcast() {} };
  const state = game.create(ctx);
  game.onAction(state, ctx, state.drawer, { choose: state.choices[0] });
  const started = ctx.time;
  for (const [fraction, count] of [[.49, 0], [.5, 1], [.69, 1], [.7, 2], [.85, 3], [.99, 3]]) {
    ctx.time = started + fraction * state.roundMs; game.onTick(state, ctx); game.onTick(state, ctx);
    assert.equal(Array.from(state.masked).filter(c => c !== '_').length, hints ? count : 0, 'hint clock and repeated ticks respect the budget');
    assert.equal(game.view(state, 'watcher').word, undefined, 'hint mode never exposes private word'); checks += 2;
  }
}
{
  const ctx = { time: 1000, allPlayers: () => roster, players: () => roster,
    settings: () => ({ rounds: 1, roundSeconds: 30, hints: true }),
    content: () => ({ words: Array(10).fill('hi') }), now() { return this.time; }, later() {}, award() {}, broadcast() {} };
  const state = game.create(ctx); game.onAction(state, ctx, state.drawer, { choose: state.choices[0] });
  ctx.time += state.roundMs * .9; game.onTick(state, ctx);
  assert(state.masked.includes('_'), 'short custom word remains a guess after all hints');
  assert.equal(state.hintsUsed, 3, 'late tick catches up once without an unbounded timer'); checks += 2;
}
// Rules standard: per-round awards on the 100-point scale, paced timers,
// host/artist Next, End game mid-round and players who leave.
{
  const { paced } = require('../games/_sdk');
  assert.equal(game.guessPoints(30000, 30000, 0), 200, 'fastest first guess is 100 + 100 extras');
  assert.equal(game.guessPoints(0, 30000, 5), 100, 'a correct guess at the bell is 100');
  assert.equal(game.artistPoints(0, 2), 0, 'no correct guess, no artist points');
  assert.equal(game.artistPoints(1, 2), 75);
  assert.equal(game.artistPoints(2, 2), 100, 'everyone guessed: artist gets 100'); checks += 5;
  const settings = game.manifest.settings.map((x) => x.key);
  assert.deepEqual(settings.slice(0, 2), ['rounds', 'pace'], 'Rounds and Pace come first'); checks++;
  for (const [pace, pick, reveal] of [['Relaxed', 23, 9], ['Normal', 15, 6], ['Quick', 10, 4]]) {
    const timers = [];
    const ctx = { time: 0, allPlayers: () => roster, players: () => roster, settings: () => ({ rounds: 2, roundSeconds: 30, pace }),
      content: () => pack, now() { return this.time; }, later(ms, fn) { timers.push(ms); }, award() {}, broadcast() {} };
    const s = game.create(ctx);
    assert.equal(s.endsAt, pick * 1000, `${pace} word choice is paced`);
    assert.equal(pick, paced({ pace }, 15));
    game.onAction(s, ctx, s.drawer, { choose: s.choices[0] });
    for (const p of roster) if (p.id !== s.drawer) game.onAction(s, ctx, p.id, { guess: s.word });
    assert.equal(s.phase, 'reveal');
    assert.equal(s.endsAt, reveal * 1000, `${pace} reveal is paced`); checks += 4;
  }
  // Points are awarded when each round ends, not only at the end.
  const { s, ctx, act, choose } = run(2);
  const host = roster[0].id;
  ctx.hostId = () => host;
  choose();
  const drawer = s.drawer, [g1, g2] = roster.filter((p) => p.id !== drawer).map((p) => p.id);
  act(g1, { guess: s.word });
  assert.deepEqual(ctx.awards, {}, 'nothing is awarded mid-round');
  act(g2, { guess: s.word });
  assert.equal(s.phase, 'reveal');
  assert.equal(ctx.awards[g1], s.guessed[g1]);
  assert.equal(ctx.awards[g2], s.guessed[g2]);
  assert.equal(ctx.awards[drawer], 100, 'artist share awarded at the end of the round');
  assert.equal(s.scores[drawer], 100);
  assert(ctx.awards[g1] <= 200 && ctx.awards[g1] >= 100, 'standard scale');
  assert.deepEqual(game.view(s, 'watcher').lastRound.points, { [g1]: s.guessed[g1], [g2]: s.guessed[g2], [drawer]: 100 }); checks += 7;
  // The host may press Next during the reveal, even when not the artist.
  const other = roster.find((p) => p.id !== drawer && p.id !== host);
  if (host !== drawer) { act(other.id, { next: true }); assert.equal(s.phase, 'reveal', 'a guesser cannot skip'); act(host, { next: true }); }
  else act(drawer, { next: true });
  assert.equal(s.phase, 'pick', 'Next moves on'); checks++;
  // End game mid-round settles the round so far and shows the final screen.
  choose();
  const d2 = s.drawer, guesser = roster.find((p) => p.id !== d2).id;
  const before = { ...ctx.awards };
  act(guesser, { guess: s.word });
  game.onEnd(s, ctx, { reason: 'host' });
  assert.equal(s.phase, 'done');
  assert.equal(ctx.awards[guesser] - (before[guesser] || 0), s.guessed[guesser], 'mid-round guess is kept');
  assert.equal(ctx.awards[d2] - (before[d2] || 0), 75, 'artist share for 1 of 2 guessers');
  for (const p of roster) assert.equal(s.scores[p.id], ctx.awards[p.id] || 0, 'scoreboard matches the awards'); checks += 6;
}
{
  // The artist leaves while drawing: the turn ends; a guesser leaves: not waited for.
  const { s, ctx, act, choose } = run(3);
  choose();
  const drawer = s.drawer;
  game.onPlayerGone(s, ctx, drawer, 'left');
  assert.equal(s.phase, 'reveal', 'gone artist ends the turn');
  assert.match(s.lastRound.reason, /left/);
  const host = roster.find((p) => p.id !== drawer).id;
  ctx.hostId = () => host;
  act(host, { next: true });
  // Only two players remain, so the next artist must not be the gone one.
  assert.notEqual(s.drawer, drawer, 'gone artist is skipped');
  choose();
  const guesser = roster.find((p) => p.id !== s.drawer && p.id !== drawer).id;
  act(guesser, { guess: s.word });
  assert.equal(s.phase, 'reveal', 'the remaining guesser is the whole room'); checks += 4;
}
{
  // A guesser leaves while the rest already guessed.
  const { s, ctx, act, choose } = run(1);
  choose();
  const [g1, g2] = roster.filter((p) => p.id !== s.drawer).map((p) => p.id);
  act(g1, { guess: s.word });
  assert.equal(s.phase, 'draw');
  game.onPlayerGone(s, ctx, g2, 'away');
  assert.equal(s.phase, 'reveal', 'stop waiting for a gone guesser');
  assert.equal(ctx.awards[s.drawer], 100, 'a gone guesser does not lower the artist share'); checks += 3;
}
console.log(`DOODLE_GUESS_PASS: ${checks} authority, privacy, gesture race, Room reconnect/rematch checks`);
