'use strict';
// Actual engine projections. The QA clock controls deadlines; private state
// is used only by this local driver to end rounds, never by active clients.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ids = ['scattergories', 'word-chain', 'countdown-word', 'lyric-fill', 'number-hunt', 'warm-words'];
const alphabetWord = n => ('q' + n.toString(26).split('').map(c => String.fromCharCode(97 + parseInt(c, 26))).join('')).padEnd(24, 'w');

class Clock {
  constructor(id, dense = false) {
    this.id = id; this.time = 1700000000000; this.jobs = []; this.awards = {};
    this.roster = Array.from({ length: dense ? 20 : 3 }, (_, i) => ({ id: 'p' + i, name: dense ? 'AlexandriaWWWW' + String(i).padStart(2, '0') : ['Ada', 'Bo', 'Cam'][i] }));
    this.opts = { rounds: 1, writeSeconds: 60, turnSeconds: 60, roundSeconds: id === 'warm-words' ? 180 : 60, hints: true };
    this.dense = dense;
  }
  now() { return this.time; }
  settings() { return this.opts; }
  hostId() { return this.roster[0].id; }
  allPlayers() { return this.roster; }
  players() { return this.roster; }
  broadcast() {}
  lobby() {}
  award(pid, points) { this.awards[pid] = (this.awards[pid] || 0) + points; }
  later(ms, fn) { const job = { at: this.time + ms, fn, dead: false }; this.jobs.push(job); return () => { job.dead = true; }; }
  fire() { const job = this.jobs.filter(j => !j.dead).sort((a, b) => a.at - b.at)[0]; assert(job, this.id + ' scheduled transition'); job.dead = true; this.time = job.at; job.fn(); }
  content() {
    const file = path.join(__dirname, '../locales/en/' + this.id + '.json');
    let pack = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    if (this.id === 'countdown-word') pack = { sets: [{ letters: 'CHOCOLATE'.split(''), best: 'chocolate' }] };
    if (this.id === 'word-chain') pack = { ...pack, starters: ['apple', 'apple', 'apple'], words: Array.from({ length: 200 }, (_, i) => alphabetWord(i)) };
    if (this.dense && this.id === 'scattergories') pack = { ...pack, categories: ['Things found in an unfamiliar attic space', 'Imaginary festivals held beside the river', 'Objects a travelling explorer would pack', 'Places visited on a quiet autumn weekend', 'Inventions that make everyday life easier'].map(s => s.slice(0, 40)), letters: ['S', 'S', 'S', 'S', 'S'] };
    if (this.dense && this.id === 'word-chain') pack.starters = Array(3).fill('abcdefghijklmnopqrstuvwx');
    if (this.dense && this.id === 'lyric-fill') pack = { lines: [{ before: 'Somewhere beyond the railway bridge, I remembered the melody we hummed on that long journey', after: 'while the rain tapped on every window of the empty carriage', answer: 'together', song: 'An unfamiliar journey', artist: 'The local QA trio' }] };
    return pack;
  }
}

function build(id, dense = false) {
  const ctx = new Clock(id, dense), game = require('../games/' + id + '/server'), state = game.create(ctx), fixtures = [];
  const act = (pid, action) => game.onAction(state, ctx, pid, action);
  const snap = (label, pid = 'p0') => {
    const projection = JSON.parse(JSON.stringify(game.view(state, pid)));
    if (['scattergories', 'countdown-word', 'lyric-fill'].includes(id) && ['write', 'make', 'fill'].includes(state.phase)) assert.deepEqual(projection.answers, {}, id + ' peer answers private');
    if (id === 'number-hunt' && ['hunt', 'overtime'].includes(state.phase)) assert(!('secret' in projection), 'number secret private');
    if (id === 'warm-words' && state.phase === 'guess') assert(!('target' in projection), 'word target private');
    if (id === 'lyric-fill' && state.phase === 'fill') assert(!('answer' in projection.line), 'lyric answer private');
    fixtures.push({ label, state: { ...projection, players: ctx.roster, me: pid, you: pid, hostId: 'p0', instanceId: 'words-' + id + (dense ? '-dense' : ''), spectator: pid === 'watcher', serverNow: ctx.now(), strings: projection.strings || {} } });
  };
  snap(dense ? 'Maximum content' : 'Play'); snap('Watcher', 'watcher');
  if (id === 'scattergories') {
    const answers = Array(5).fill(dense ? 'S' + 'a'.repeat(39) : 'seal');
    act('p0', { answers }); snap('Saved; still editable');
    act('p1', { answers: Array(5).fill('PRIVATE_PEER_ANSWER') }); snap('Peer saved; still private');
    act('p0', { answers, lock: true }); snap('Locked');
    for (const p of ctx.roster.slice(1)) act(p.id, { answers, lock: true });
    snap('Reveal'); snap('Reveal watcher', 'watcher'); act('p0', { next: true });
  } else if (id === 'countdown-word') {
    act('p0', { word: 'late' }); snap('Saved; still editable');
    act('p1', { word: 'chocolate' }); snap('Peer saved; still private');
    act('p0', { word: 'zzzz', lock: true }); snap('Dictionary rejection');
    act('p0', { word: dense ? 'chocolate' : 'late', lock: true }); snap('Locked');
    for (const p of ctx.roster.slice(1)) act(p.id, { pass: true });
    snap('Reveal'); snap('Reveal watcher', 'watcher'); act('p0', { next: true });
  } else if (id === 'lyric-fill') {
    act('p1', { text: 'PRIVATE_PEER_ANSWER' }); snap('Peer filled; still private');
    act('p0', { text: dense ? 'An unfamiliar lyric with an exceptionally long answer phrase'.slice(0, 60) : 'a melody' }); snap('Locked');
    for (const p of ctx.roster.slice(2)) act(p.id, { text: dense ? 'A'.repeat(60) : state.line.answer });
    snap('Reveal'); snap('Reveal watcher', 'watcher'); act('p0', { next: true });
  } else if (id === 'number-hunt') {
    act('p0', { guess: state.secret === 42 ? 43 : 42 }); snap('First public direction');
    act('p0', { guess: state.secret === 64 ? 65 : 64 }); snap('Own temperature comparison');
    if (dense) {
      for (let i = 0; i < 210; i++) act(ctx.roster[i % 20].id, { guess: state.secret === 50 ? 49 : 50 });
      for (let i = 0; i < 210; i++) act('p0', { guess: state.secret === 50 ? 49 : 50 });
      snap('200 public hints; long own guess list');
    }
    act('p1', { guess: state.secret }); snap('Overtime'); snap('Overtime watcher', 'watcher');
    act('p0', { guess: state.secret }); snap('Found; disabled input');
    for (const p of ctx.roster.slice(2)) act(p.id, { guess: state.secret });
    snap('Reveal'); snap('Reveal watcher', 'watcher'); ctx.fire();
  } else if (id === 'warm-words') {
    act('p0', { guess: 'zzzzzz' }); snap('Vocabulary rejection'); ctx.time += 400;
    act('p0', { guess: state.target === 'kitchen' ? 'spoon' : 'kitchen' }); snap('Public similarity and rank'); ctx.time += 400;
    act('p0', { hint: true }); snap('Hint costs 50'); ctx.time += 400;
    if (dense) {
      const words = require('../games/warm-words/embeddings.json').words;
      for (const word of words.filter(w => w !== state.target).slice(0, 210)) { ctx.time += 400; act('p1', { guess: word }); }
      snap('200 discoveries');
    }
    act('p0', { guess: state.target }); snap('Reveal'); snap('Reveal watcher', 'watcher'); act('p0', { next: true });
  } else if (id === 'word-chain') {
    const deadline = state.endsAt;
    act(state.turnPid, { word: 'zzzzzz' }); snap('Spelling rejection; same clock', state.turnPid); assert.equal(state.endsAt, deadline);
    act(state.turnPid, { word: 'fruit' }); snap('Accepted link', state.turnPid);
    act('p1', { challenge: true }); snap('Challenge vote', state.turnPid);
    if (!dense) { act('p2', { challenge: true }); snap('Challenge rollback; same clock', state.turnPid); }
    if (dense) { for (let i = 0; i < 150; i++) act(state.turnPid, { word: alphabetWord(i) }); snap('Long route; 50 per archive page', state.turnPid); }
    act(state.turnPid, { word: '' }); snap('Eliminated', state.lastOut.pid);
    while (state.phase !== 'done') act(state.turnPid, { word: '' });
  }
  assert.equal(state.phase, 'done', id + ' driver finishes'); snap('Done'); snap('Done watcher', 'watcher');
  return fixtures;
}
const fixtures = Object.fromEntries(ids.map(id => [id, build(id)]));
const denseFixtures = Object.fromEntries(ids.map(id => [id, build(id, true)]));
module.exports = { ids, fixtures, denseFixtures, Clock };
if (require.main === module) console.log(JSON.stringify(ids.map(id => ({ id, normal: fixtures[id].length, maximum: denseFixtures[id].length, phases: [...new Set(fixtures[id].map(f => f.state.phase))] })), null, 2));
