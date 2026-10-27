'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Exercise the real game handlers while deliberately firing old callbacks.
// A room cancels timers too; game phase/round guards remain independently safe.
class Clock {
  constructor(id) {
    this.id = id; this.time = 1000000; this.timers = []; this.awards = {};
    this.roster = ['a', 'b', 'c'].map(id => ({ id, name: id }));
  }
  settings() { return { rounds: 3 }; }
  content() { return JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en', this.id + '.json'))); }
  now() { return this.time; }
  allPlayers() { return this.roster; }
  players() { return this.roster; }
  hostId() { return 'a'; }
  award(pid, points) { this.awards[pid] = (this.awards[pid] || 0) + points; }
  broadcast() {}
  later(ms, fn) { const t = { at: this.time + ms, fn }; this.timers.push(t); return () => { t.canceled = true; }; }
  fire(t) { this.time = Math.max(this.time, t.at); t.fired = true; t.fn(); }
}

for (const id of ['charades', 'doodle-guess', 'memory-tray', 'scattergories', 'twenty-questions', 'typing-race', 'reaction-tap', 'number-hunt']) {
  const game = require('../games/' + id + '/server'); const ctx = new Clock(id); const state = game.create(ctx);
  const action = (pid, value) => game.onAction(state, ctx, pid, value);
  let old = ctx.timers[0];
  if (id === 'charades') for (const p of ctx.roster) if (p.id !== state.actor) action(p.id, { guess: state.word });
  if (id === 'doodle-guess') {
    action(state.drawer, { choose: state.choices[0] }); old = ctx.timers.at(-1);
    for (const p of ctx.roster) if (p.id !== state.drawer) action(p.id, { guess: state.word });
  }
  if (id === 'memory-tray') {
    ctx.fire(old); old = ctx.timers.at(-1);
    action('a', { recall: state.items[0] });
    const privateView = game.view(state, 'b');
    assert.equal(privateView.items, undefined, 'recall never exposes the tray');
    assert.equal(privateView.submissions, undefined, 'recall never exposes peer answers');
    for (const p of ctx.roster) action(p.id, { recall: state.items[0] });
    assert.equal(game.view(state, 'a').submissions, undefined, 'recalls are private');
  }
  if (id === 'scattergories') action('a', { finish: true });
  if (id === 'twenty-questions') action(ctx.roster.find(p => p.id !== state.answerer).id, { guess: state.word });
  if (id === 'typing-race') for (const p of ctx.roster) action(p.id, { typed: state.target });
  if (id === 'reaction-tap') { ctx.fire(old); old = ctx.timers.at(-1); for (const p of ctx.roster) action(p.id, { tap: true }); }
  if (id === 'number-hunt') { for (const p of ctx.roster) action(p.id, { guess: state.secret }); old = ctx.timers[0]; }
  assert(['reveal', 'roundEnd'].includes(state.phase), id + ' resolves once all players finish');
  assert(state.endsAt === 0 || state.endsAt >= ctx.now(), id + ' reveal clears or resets the gameplay deadline');
  const saved = { ...ctx.awards };
  // Repeated actions cannot award twice during the finished round.
  action('a', { guess: state.word || state.secret, typed: state.target, tap: true, recall: 'apple', finish: true });
  assert.deepEqual(ctx.awards, saved, id + ' no repeated points');
  const gap = ctx.timers.at(-1);
  if (['charades', 'doodle-guess', 'memory-tray', 'scattergories', 'twenty-questions'].includes(id)) {
    action(state.actor || state.drawer || state.answerer || state.hostId, { next: true });
  } else ctx.fire(gap);
  assert.equal(state.round, 2, id + ' next round starts');
  const phase = state.phase;
  old.fn(); gap.fn();
  assert.equal(state.round, 2, id + ' stale callbacks cannot skip a round');
  assert.equal(state.phase, phase, id + ' stale callbacks cannot end the new phase');
  // A fresh instance runs naturally to done, including all automatic gaps.
  const finalCtx = new Clock(id); const final = game.create(finalCtx);
  for (let i = 0; i < 40 && final.phase !== 'done'; i++) {
    if (id === 'number-hunt' && final.phase === 'hunt') {
      for (const p of finalCtx.roster) game.onAction(final, finalCtx, p.id, { guess: final.secret });
    }
    const timer = finalCtx.timers.filter(t => !t.fired && !t.canceled).sort((a, b) => a.at - b.at)[0];
    if (timer) finalCtx.fire(timer); else break;
  }
  assert.equal(final.phase, 'done', id + ' can finish');
  assert.equal(final.endsAt, 0, id + ' stops its clock at done');
}
for (const id of ['charades', 'doodle-guess', 'memory-tray', 'scattergories', 'twenty-questions', 'typing-race', 'reaction-tap', 'draw-phone']) {
  const game = require('../games/' + id + '/server'); const ctx = new Clock(id); const state = game.create(ctx);
  if (id === 'doodle-guess') game.onAction(state, ctx, state.drawer, { choose: state.choices[0] });
  if (id === 'memory-tray' || id === 'reaction-tap') ctx.fire(ctx.timers.at(-1));
  const prior = state.phase; ctx.time = state.endsAt + 1;
  const actor = id === 'charades' || id === 'twenty-questions' ? ctx.roster.find(p => p.id !== (state.actor || state.answerer)).id : 'a';
  game.onAction(state, ctx, actor, { guess: state.word, typed: state.target, tap: true, recall: state.items?.join(','), phrase: 'A late phrase', answers: Array(5).fill('late'), lock: true });
  assert.notEqual(state.phase, prior, id + ' resolves before accepting an expired action');
  assert.deepEqual(ctx.awards, id === 'twenty-questions' ? { [state.answerer]: 100 } : {}, id + ' expired input earns no player reward');
}
// A live gesture has one bounded preview. Committing it replaces the preview,
// and a phase deadline freezes only its latest points. Wrong guesses never score.
{
  const game = require('../games/doodle-guess/server');
  const ctx = new Clock('doodle-guess'); const s = game.create(ctx);
  const act = (pid, value) => game.onAction(s, ctx, pid, value);
  act(s.drawer, { choose: s.choices[0] });
  const guesser = ctx.roster.find(p => p.id !== s.drawer).id;
  const inkMeta = (gestureId=1) => ({inkNonce:game.view(s,s.drawer).inkNonce,inkRevision:s.inkRevision,gestureId,chunk:0,sample:1,finished:true});
  const ink = { pts: [[.1, .2], [.4, .2]], color: '#000000', size: 5 };
  act(guesser, { preview: ink, ...inkMeta() });
  assert.equal(s.preview, null, 'only the artist can preview');
  act(s.drawer, { preview: ink, ...inkMeta() });
  assert.equal(s.strokes.length, 0, 'preview is transient until commitment');
  assert.equal(game.view(s, guesser).preview.pts.length, 2, 'other players receive live ink');
  assert.equal(game.view(s, guesser).word, undefined, 'preview never exposes the answer');
  act(guesser, { guess: s.word + ' wrong' });
  assert.deepEqual(s.guessed, {}, 'a related but wrong word never scores');
  assert.equal(game.view(s, s.drawer).myFeedback, null, 'guess feedback remains private');
  assert.match(game.view(s, guesser).myFeedback.message, /not it/);
  act(s.drawer, { stroke: ink, ...inkMeta() });
  assert.equal(s.strokes.length, 1);
  assert.equal(s.preview, null, 'commit replaces preview instead of duplicating it');
  act(s.drawer, { preview: { ...ink, pts: [[.4, .2], [.8, .2]] }, ...inkMeta(2) });
  ctx.time = s.endsAt;
  act(s.drawer, { stroke: ink, ...inkMeta() });
  assert.equal(s.phase, 'reveal');
  assert.equal(s.strokes.length, 2, 'deadline captures the in-progress gesture once');
  assert.equal(s.preview, null);
  assert.deepEqual(s.strokes[1].pts, [[.4, .2], [.8, .2]]);
}
{
  const game = require('../games/draw-phone/server');
  const ctx = new Clock('draw-phone'); const s = game.create(ctx);
  const act = (pid, value) => game.onAction(s, ctx, pid, value);
  for (const p of ctx.roster) act(p.id, { phrase: 'A private phrase from ' + p.id });
  const ink = { pts: [[.1, .2], [.4, .2]], color: '#000000', size: 5 };
  const inkMeta = (gestureId=1,sample=1) => ({inkNonce:game.view(s,'a').inkNonce,inkRevision:game.view(s,'a').inkRevision,gestureId,chunk:0,sample,finished:true});
  act('outsider', { preview: ink });
  assert.equal(s.drawings.outsider, undefined);
  act('a', { preview: ink, ...inkMeta() });
  assert.equal(s.drawings.a.strokes.length, 0);
  assert.equal(game.view(s, 'b').myStrokes.length, 0, 'a peer cannot inspect the private drawing');
  assert.equal(game.view(s, 'b').drawings, undefined);
  act('a', { stroke: ink, ...inkMeta() });
  assert.equal(s.drawings.a.strokes.length, 1);
  assert.equal(s.drawings.a.preview, null);
  act('a', { preview: { ...ink, pts: [[.4, .2], [.8, .2]] }, ...inkMeta(2) });
  ctx.time = s.endsAt;
  act('a', { stroke: ink, ...inkMeta() });
  assert.equal(s.phase, 'guess');
  assert.equal(s.drawings.a.strokes.length, 2, 'caption phase keeps latest partial gesture');
  const captioner = Object.keys(s.guessAssign).find(pid => s.guessAssign[pid] === 'a');
  assert.equal(game.view(s, captioner).myDrawing.length, 2);
  assert.equal(game.view(s, captioner).myPrompt, undefined, 'captioner cannot see the original phrase');
}
// Real Room routing: several preview actions between heartbeat ticks produce
// one Doodle snapshot and no Draw Phone snapshots. Commit and deadline frames
// remain immediate, including for a socket which skipped a discardable tick.
for (const id of ['doodle-guess', 'draw-phone']) {
  const { Room, SLOW_SOCKET_BYTES } = require('../server/room');
  const game = require('../games/' + id + '/server');
  const pack = JSON.parse(fs.readFileSync(path.join(__dirname, '../locales/en', id + '.json')));
  const room = new Room('INKQ', { [id]: pack });
  const sockets = Array.from({ length: 3 }, () => ({ readyState: 1, bufferedAmount: 0, frames: [], send(text) { this.frames.push(JSON.parse(text)); }, close() {} }));
  const ps = sockets.map((socket, i) => room.addPlayer('Ink player ' + i, socket).player);
  try {
    assert(room.startGame(game, {}, ps[0].id).ok);
    const s = room.game.state;
    let artist;
    if (id === 'doodle-guess') {
      artist = sockets[ps.findIndex(p => p.id === s.drawer)];
      room.onAction(artist, { choose: s.choices[0] });
    } else {
      ps.forEach((p, i) => room.onAction(sockets[i], { phrase: 'A penguin from player ' + i }));
      artist = sockets[0];
    }
    const inkMeta = (gestureId=1,sample=1) => { const v=game.view(s,id==='doodle-guess'?s.drawer:ps[0].id); return {inkNonce:v.inkNonce,inkRevision:v.inkRevision,gestureId,chunk:0,sample,finished:true}; };
    const ink = { pts: [[.1, .2], [.4, .2]], color: '#000000', size: 5 };
    sockets.forEach(socket => { socket.frames = []; });
    for (let i = 0; i < 5; i++) room.onAction(artist, { preview: ink, ...inkMeta(1,i+1) });
    assert(sockets.every(socket => socket.frames.length === 0), id + ' preview does not broadcast immediately');
    if (id === 'doodle-guess') {
      sockets[0].bufferedAmount = SLOW_SOCKET_BYTES + 1;
      room.onTick();
      assert.equal(sockets[0].frames.length, 0, 'slow socket skips discardable live ink');
      assert.equal(sockets[1].frames.length, 1, 'five previews coalesce to one heartbeat snapshot');
      assert.equal(sockets[1].frames[0].preview.pts.length, 2, 'heartbeat delivers latest live ink');
      room.onTick();
      assert.equal(sockets[1].frames.length, 1, 'idle heartbeat sends no repeated preview');
    } else {
      room.onTick();
      assert(sockets.every(socket => socket.frames.length === 0), 'private Draw Phone preview never broadcasts');
    }
    sockets.forEach(socket => { socket.frames = []; });
    room.onAction(artist, { stroke: ink, ...inkMeta() });
    assert(sockets.every(socket => socket.frames.length === 1), id + ' committed stroke broadcasts immediately');
    room.onAction(artist, { preview: ink, ...inkMeta(2) });
    sockets.forEach(socket => { socket.frames = []; });
    s.endsAt = Date.now() - 1;
    room.onAction(artist, { stroke: ink, ...inkMeta() });
    assert(sockets.every(socket => socket.frames.length === 1), id + ' final partial stroke and phase broadcast immediately');
    assert.equal(s.phase, id === 'doodle-guess' ? 'reveal' : 'guess');
    room.onTick();
    assert(sockets.every(socket => socket.frames.length === 1), id + ' completed gesture leaves no dirty tick');
  } finally { room.destroy(); }
}
// Accepted typing progress belongs to the match roster, even across a socket
// loss. Connected finishers may still settle the round without waiting for it.
{
  const { Room } = require('../server/room');
  const game = require('../games/typing-race/server');
  const room = new Room('TYPE', { 'typing-race': { sentences: ['abcdefghij'] } });
  const socket = () => ({ readyState: 1, frames: [], send(text) { this.frames.push(JSON.parse(text)); }, close() {} });
  const sockets = Array.from({ length: 3 }, socket);
  const ps = sockets.map((ws, i) => room.addPlayer('Typer ' + i, ws).player);
  const meta = () => ({ i: room.game.instanceId, w: room._actionToken() });
  const snapshot = ws => ws.frames.findLast(frame => frame.t === 'state');
  const readyAll = () => { for (const p of room.activeRosterPlayers().filter(p => p.connected)) room.onReady(p.socket, meta()); };
  try {
    assert(room.startGame(game, { ready: true, settings: { rounds: 1, raceSeconds: 15 } }, ps[0].id).ok);
    readyAll();
    const race = meta(), deadline = snapshot(sockets[0]).endsAt;
    room.onAction(sockets[1], { typed: 'abcde' }, race);
    assert.equal(snapshot(sockets[0]).progress[ps[1].id], 5, 'peer projection confirms accepted half-progress');
    room.disconnect(sockets[1]);
    // Both finishes land on the same server millisecond (the broadcast in
    // between must not move the clock, or the shared place becomes timing luck).
    const realNow = Date.now, frozen = Date.now();
    Date.now = () => frozen;
    try {
      room.onAction(sockets[0], { typed: 'abcdefghij' }, race);
      assert.equal(snapshot(sockets[0]).phase, 'race', 'another connected racer keeps the deadline open');
      assert.equal(snapshot(sockets[0]).endsAt, deadline, 'disconnect does not reset the deadline');
      room.onAction(sockets[2], { typed: 'abcdefghij' }, race);
    } finally { Date.now = realNow; }
    const settled = snapshot(sockets[0]);
    assert.equal(settled.phase, 'roundEnd', 'disconnected unfinished seat does not hold settlement');
    assert.equal(settled.last.progress[ps[1].id], 5);
    assert.equal(settled.scores[ps[1].id], 25, 'disconnected racer keeps points for accepted half-progress');
    assert.equal(settled.totals[ps[1].id], 25, 'room total includes those partial points exactly once');
    // Both finished at the same server moment: they share first place.
    assert.deepEqual(settled.last.finished.map(f => f.pts), [200, 200], 'simultaneous finishers share the place and its points');
    const resumed = socket();
    assert.equal(room.addPlayer(ps[1].name, resumed, ps[1].token).player.id, ps[1].id);
    const watcher = socket(); room.addPlayer('Late watcher', watcher);
    room.broadcastState(); readyAll();
    assert.equal(snapshot(resumed).scores[ps[1].id], 25, 'resumed seat receives settled partial score');
    assert.equal(snapshot(watcher).scores[ps[1].id], 25, 'late watcher receives the same result');
    assert.equal(snapshot(watcher).spectator, true);
    const totals = { ...room.totals }, token = meta();
    room.onAction(resumed, { typed: 'abcdefghij' }, race);
    room.onAction(resumed, { typed: 'abcdefghij' }, token);
    room.onAction(sockets[0], { typed: 'abcdefghij' }, token);
    assert.deepEqual(room.totals, totals, 'retired and duplicate finish actions cannot score again');
    assert.equal(snapshot(resumed).last.progress[ps[1].id], 5, 'resume cannot rewrite settled progress');
  } finally { room.destroy(); }
}
console.log('SKILL_RACES_PASS: timed phase/round guards, clocks, scoring/privacy; drawing previews commit once and coalesce through real Room; typing disconnect preserves settled partial scores exactly once');
