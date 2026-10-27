'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskWord, hiddenLetters, revealLetter } = require('../games/engines/word-hints');
const tq = require('../games/twenty-questions/server');
const doodle = require('../games/doodle-guess/server');
const charades = require('../games/charades/server');
const memory = require('../games/memory-tray/server');
const { validateManifest, validateSettings } = require('../games/_validate');
const { actionWindow } = require('../games/_sdk');
const { Rooms } = require('../server/room');

function context(settings = {}, word = 'birthday cake') {
  return {
    time: 1000, timers: [], awards: {},
    allPlayers: () => ['a', 'b', 'c'].map((id) => ({ id, name: id })),
    players() { return this.allPlayers(); },
    hostId() { return 'a'; },
    content: () => ({ words: [word] }), settings: () => settings,
    now() { return this.time; }, broadcast() {},
    later(ms, fn) { this.timers.push({ ms, fn }); },
    award(pid, points) { this.awards[pid] = (this.awards[pid] || 0) + points; },
  };
}
const guesser = (s) => ['a', 'b', 'c'].find((id) => id !== s.answerer);
function answerQuestions(s, ctx, count) {
  for (let i = 0; i < count; i++) {
    tq.onAction(s, ctx, guesser(s), { question: 'Question ' + i });
    tq.onAction(s, ctx, s.answerer, { answer: 'yes', qi: i });
  }
}

assert.equal(maskWord('ice cream'), '___ _____');
assert.equal(maskWord('猫 🚀'), '_ _');
assert.equal(revealLetter('a', '_', () => 0), '_', 'one-letter secrets never become a full hint');
assert.equal(revealLetter('ab', '__', () => 0), 'a_');
assert.equal(revealLetter('ab', 'a_', () => 0), 'a_', 'the final character stays concealed');
assert.equal(hiddenLetters('猫 🚀', '_ _'), 2, 'Unicode code points are counted together');
assert(validateManifest(tq).ok && validateManifest(doodle).ok);
for (const maxQuestions of [10, 20, 30, 35, 50]) assert(validateSettings(tq, { maxQuestions }).ok);
for (const maxQuestions of [9, 51, 20.5, '30', null, Infinity]) assert(!validateSettings(tq, { maxQuestions }).ok);
assert(!validateSettings(tq, { hints: 'true' }).ok);
assert(validateSettings(tq, { hints: true }).ok && validateSettings(doodle, { hints: false }).ok);

for (const maxQ of [20, 30]) {
  const ctx = context({ maxQuestions: maxQ });
  const s = tq.create(ctx);
  assert.equal(s.maxQ, maxQ);
  answerQuestions(s, ctx, maxQ - 1);
  assert.equal(s.phase, 'play', `${maxQ - 1} answers do not end a ${maxQ}-question round`);
  tq.onAction(s, ctx, guesser(s), { question: 'Last question' });
  tq.onAction(s, ctx, guesser(s), { question: 'Cannot exceed the queue cap' });
  assert.equal(s.questions.length, maxQ);
  tq.onAction(s, ctx, s.answerer, { answer: 'sometimes', qi: maxQ - 1 });
  assert.equal(s.phase, 'reveal');
  assert.equal(s.last.reason, 'questions');
  assert.equal(s.last.answered, maxQ);
  assert.equal(s.endsAt, 0);
  assert.equal(tq.view(s, guesser(s)).word, s.word, 'reveal is public');
}

{
  const ctx = context();
  const s = tq.create(ctx);
  const before = JSON.stringify(tq.view(s, guesser(s)));
  assert.equal(s.maxQ, 20);
  assert.equal(s.hints, false);
  tq.onAction(s, ctx, guesser(s), { hint: true });
  assert.equal(JSON.stringify(tq.view(s, guesser(s))), before, 'disabled hints cannot reveal letters');
  assert(!Object.hasOwn(tq.view(s, guesser(s)), 'word'));
  assert(!Object.hasOwn(tq.view(s, 'watcher'), 'wordShown'));
  tq.onAction(s, ctx, guesser(s), { question: 'First' });
  tq.onAction(s, ctx, guesser(s), { question: 'Duplicate pending' });
  assert.equal(s.questions.length, 1, 'only one pending question per guesser');
  tq.onAction(s, ctx, 'watcher', { question: 'Not a player' });
  assert.equal(s.questions.length, 1);
}

{
  const ctx = context({ hints: true, maxQuestions: 30, rounds: 2 });
  const s = tq.create(ctx);
  const pid = guesser(s);
  const initial = s.masked;
  for (const who of [s.answerer, 'watcher', 'unknown']) tq.onAction(s, ctx, who, { hint: true });
  assert.equal(s.masked, initial, 'answerer and spectators cannot request hints');
  assert.equal(tq.view(s, 'watcher').hintAvailable, false);
  assert.equal(tq.view(s, s.answerer).hintAvailable, false);
  tq.onAction(s, ctx, pid, { hint: true });
  assert.equal(s.hintsUsed, 1);
  assert.equal(hiddenLetters(s.word, s.masked), 11);
  assert.equal(tq.view(s, pid).masked, tq.view(s, 'watcher').masked, 'hints are shared');
  tq.onAction(s, ctx, pid, { hint: true });
  const capped = s.masked;
  tq.onAction(s, ctx, pid, { hint: true });
  assert.equal(s.hintsUsed, 2);
  assert.equal(s.masked, capped);
  assert.equal(tq.view(s, pid).hintAvailable, false);
  assert.notEqual(s.masked, s.word);
  const v = tq.view(s, pid);
  v.scores[pid] = 9999;
  v.order.length = 0;
  v.questions.push({ text: 'Mutated projection' });
  assert.equal(s.questions.length, 0, 'projected state cannot change server questions');
  assert.equal(s.order.length, 3);
  s.scores[pid] = 55;
  answerQuestions(s, ctx, 15);
  tq.onAction(s, ctx, pid, { guess: s.word });
  assert.equal(ctx.awards[pid], 50, 'normalized reward (100 + 50 speed) minus two 50-point hints');
  assert.equal(s.scores[pid], 105, 'cost affects this reward, not prior totals');
  assert.equal(s.last.reason, 'guessed');
  assert.equal(s.phase, 'reveal', 'a correct guess legitimately ends the round early');
  assert.equal(s.endsAt, 0);
  tq.onAction(s, ctx, pid, { guess: s.word, hint: true });
  assert.equal(ctx.awards[pid], 50, 'a finished round cannot award again');
  const outsider = ['a', 'b', 'c'].find((id) => id !== s.answerer && id !== 'a');
  tq.onAction(s, ctx, outsider, { next: true });
  assert.equal(s.round, 1, 'only the answerer or the host advances');
  tq.onAction(s, ctx, s.answerer, { next: true });
  assert.equal(s.round, 2);
  assert.equal(s.hintsUsed, 0);
  assert.equal(s.masked, initial, 'new round resets all shared hint letters');
}

for (const maxQuestions of [20, 30, 50]) {
  const ctx = context({ maxQuestions, rounds: 1 });
  const s = tq.create(ctx);
  tq.onAction(s, ctx, guesser(s), { guess: s.word });
  assert.equal(ctx.awards[guesser(s)], 200, 'initial maximum (100 + 100 speed) is consistent across question limits');
  tq.onAction(s, ctx, s.answerer, { next: true });
  assert.equal(s.phase, 'done');
  assert.equal(s.endsAt, 0);
}
{
  const ctx = context({ hints: true }, 'a');
  const s = tq.create(ctx);
  tq.onAction(s, ctx, guesser(s), { hint: true });
  assert.equal(s.hintsUsed, 0);
  assert.equal(s.masked, '_');
  assert.equal(tq.view(s, guesser(s)).hintAvailable, false);
}

for (const hints of [false, true, undefined]) {
  const ctx = context(hints === undefined ? {} : { hints });
  const s = doodle.create(ctx);
  const pid = ['a', 'b', 'c'].find((id) => id !== s.drawer);
  assert(!Object.hasOwn(doodle.view(s, pid), 'choices'), 'artist choices are private even before selection');
  doodle.onAction(s, ctx, s.drawer, { choose: s.choices[0] });
  const initial = s.masked;
  assert(!Object.hasOwn(doodle.view(s, pid), 'word'));
  assert(!Object.hasOwn(doodle.view(s, pid), 'choices'), 'draw snapshots do not leak the candidate list');
  ctx.time += s.roundMs / 2;
  doodle.onTick(s, ctx);
  assert.equal(s.hints, hints !== false, 'classic automatic hints remain the default');
  assert.equal(hiddenLetters(s.word, s.masked), hints === false ? 12 : 11);
  if (hints === false) assert.equal(s.masked, initial);
  ctx.timers.find((t) => t.ms === s.roundMs).fn();
  assert.equal(doodle.view(s, pid).word, s.word, 'finished drawing reveals the word to guessers');
  doodle.onAction(s, ctx, s.drawer, { next: true });
  assert.equal(s.masked, '', 'picking a new word never exposes the previous mask');
  assert.equal(s.hintAt, 0);
}

for (const n of [40, 41, 60]) {
  for (const def of [charades, doodle]) {
    const ctx = context({}, 'x'.repeat(n));
    const s = def.create(ctx);
    if (def === doodle) def.onAction(s, ctx, s.drawer, { choose: s.choices[0] });
    const role = s.actor || s.drawer;
    const pid = ['a', 'b', 'c'].find((id) => id !== role);
    def.onAction(s, ctx, 'watcher', { guess: s.word });
    assert.equal(s.scores.watcher, undefined, 'direct spectator guesses cannot score');
    def.onAction(s, ctx, pid, { guess: s.word });
    // Instant first correct guess is 200 in both games (rules standard).
    assert.equal(s.guessed[pid], 200, `${def.id} accepts a ${n}-character custom secret`);
  }
}
{
  const ctx = context({}, '猫 🚀');
  assert.equal(charades.create(ctx).masked, '_ _', 'Charades uses the Unicode-safe shared mask');
}
{
  const ctx = context();
  ctx.content = () => ({ items: Array.from({ length: 12 }, (_, i) => String(i).padStart(2, '0') + 'x'.repeat(38)) });
  const s = memory.create(ctx);
  ctx.timers.find((t) => t.ms === s.memMs).fn();
  const recall = s.items.join(', ');
  assert(recall.length > 200 && recall.length < 512, 'eight maximum-length items fit the client recall limit');
  for (const p of ctx.allPlayers()) memory.onAction(s, ctx, p.id, { recall });
  assert.equal(s.phase, 'reveal');
  for (const p of ctx.allPlayers()) assert.equal(s.last.results[p.id].count, 8);
}

async function checkRoomTimers() {
  const timers = [];
  const realSet = global.setTimeout;
  const realClear = global.clearTimeout;
  global.setTimeout = (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; };
  global.clearTimeout = (t) => { if (t) t.dead = true; };
  let room;
  try {
    room = new Rooms({}).create();
    const players = ['A', 'B', 'C'].map((name) => room.addPlayer(name, { readyState: 1, send() {}, close() {} }).player);
    assert(!room.configure(tq.id, tq, { rounds: 2, hints: true, maxQuestions: 30 }).error);
    room.startGame(tq, {}, players[0].id);
    await Promise.resolve();
    const s = room.game.state;
    const meta = () => ({ i: room.game.instanceId, w: actionWindow(s) });
    const g = players.find((p) => p.id !== s.answerer);
    const answerer = players.find((p) => p.id === s.answerer);
    const oldMeta = meta();
    const oldTimer = [...room.timers].find(t => t.window === actionWindow(s)).handle;
    const late = room.addPlayer('Watcher', { readyState: 1, send() {}, close() {} }).player;
    room.onAction(late.socket, { hint: true }, meta());
    assert.equal(s.hintsUsed, 0, 'real room blocks spectator hint actions');
    room.onAction(g.socket, { guess: s.word }, meta());
    assert.equal(s.phase, 'reveal');
    room.onAction(answerer.socket, { next: true }, meta());
    await Promise.resolve();
    assert.equal(s.phase, 'play');
    assert.equal(s.round, 2);
    oldTimer.fn();
    assert.equal(s.phase, 'play', 'old timeout cannot terminate a round started after an early correct guess');
    assert.equal(s.round, 2);
    room.onAction(g.socket, { hint: true }, oldMeta);
    assert.equal(s.hintsUsed, 0, 'old-window hint requests cannot spend next-round points');
    const activeTimer = [...room.timers].filter(t => t.window === actionWindow(s)).at(-1).handle;
    activeTimer.fn();
    assert.equal(s.phase, 'reveal');
    assert.equal(s.last.reason, 'time', 'the current-round timeout still works');
  } finally {
    if (room) room.endGameToLobby(room.hostId);
    global.setTimeout = realSet;
    global.clearTimeout = realClear;
  }
}

async function checkHistory() {
  const dataModule = (s) => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
  const util = dataModule(fs.readFileSync(path.join(__dirname, '../public/js/util.js'), 'utf8'));
  const src = fs.readFileSync(path.join(__dirname, '../public/js/games/twenty-questions.js'), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
  const ui = (await import(dataModule(src))).default;
  const nodes = {};
  for (const id of ['#tqHist', '#tqRHist', '#tqWord', '#tqRole', '#tqBadge', '#tqSpotQ', '#tqSpotMeta', '#tqSpotWait', '#tqQWrap', '#tqQueue', '#tqWrong', '#tqAskState']) {
    nodes[id] = { innerHTML: '', textContent: '', scrollTop: 0, scrollHeight: 100, clientHeight: 100 };
  }
  nodes['.tq-filters'] = { querySelectorAll: () => [] };
  const el = { innerHTML: '', querySelector: (id) => nodes[id] || null };
  const S = { phase: 'play', round: 1, rounds: 2, maxQ: 30, me: 'b', answerer: 'a', players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], questions: [
    { pid: 'b', text: 'Old yes', answer: 'yes' }, { pid: 'b', text: 'Middle no', answer: 'no' }, { pid: 'b', text: 'Newest sometimes', answer: 'sometimes' },
  ], scores: {}, wrong: [] };
  ui.mount();
  ui.update(el, S, { send() {} });
  assert(nodes['#tqHist'].innerHTML.indexOf('Newest sometimes') < nodes['#tqHist'].innerHTML.indexOf('Old yes'));
  const skeleton = el.innerHTML;
  nodes['.tq-filters'].onclick({ target: { closest: () => ({ dataset: { filter: 'yes' } }) } });
  assert(nodes['#tqHist'].innerHTML.includes('Old yes') && !nodes['#tqHist'].innerHTML.includes('Middle no'));
  S.questions.push({ pid: 'b', text: 'Latest yes', answer: 'yes' });
  ui.update(el, S, { send() {} });
  assert.equal(el.innerHTML, skeleton, 'history updates leave input/filter skeleton in place');
  assert.match(nodes['#tqHist'].innerHTML, /^<div class="tq-row"(?:\s[^>]*)?>/, 'filtered history starts with a question row, including semantic attributes');
  assert(nodes['#tqHist'].innerHTML.indexOf('Latest yes') < nodes['#tqHist'].innerHTML.indexOf('Old yes'));
  ui.dispose();
}

async function checkTypingFeedback() {
  const dataModule = (s) => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
  const util = dataModule(fs.readFileSync(path.join(__dirname, '../public/js/util.js'), 'utf8'));
  const capabilities = dataModule(fs.readFileSync(path.join(__dirname, '../public/js/toolkit/input-capabilities.mjs'), 'utf8'));
  const src = fs.readFileSync(path.join(__dirname, '../public/js/games/typing-race.js'), 'utf8')
    .replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util))).replace("'../toolkit/input-capabilities.mjs'", JSON.stringify(capabilities));
  const ui = (await import(dataModule(src))).default;
  const nodes = { '#tTarget': { innerHTML: '' }, '#tInput': { value: '' }, '#tTypingStatus': { textContent: '' }, '.gk-hud-progress': { textContent: '' }, '#tBars': { innerHTML: '' } };
  const el = { innerHTML: '', querySelector: (id) => nodes[id] || null };
  const S = { phase: 'race', round: 1, rounds: 2, me: 'a', target: 'abc', progress: {}, finished: [], players: [{ id: 'a', name: 'A' }] };
  const sent = [];
  ui.render(el, S, { send: (a) => sent.push(a) });
  nodes['#tInput'].value = 'aXc';
  nodes['#tInput'].oninput();
  assert.equal(sent[0].typed, 'aXc');
  assert(nodes['.gk-hud-progress'].textContent.includes('1 of 3 typed'), 'race HUD shows the actual correct prefix');
  assert(nodes['#tTypingStatus'].textContent.includes('Fix character 2: expected “b”'));
  assert(nodes['#tTarget'].innerHTML.includes('typing-wrong'), 'errors have a non-color underline as well as status text');
  S.finished.push({ pid: 'a', ms: 1000 });
  ui.render(el, S, { send() {} });
  assert.equal(nodes['#tInput'].disabled, true);
  assert.equal(nodes['.gk-hud-progress'].textContent, 'Finished', 'race HUD acknowledges the finish');
  assert(!nodes['#tTypingStatus'].textContent.includes('Fix'), 'finished status clears the obsolete correction');
  ui.dispose();
}

async function checkPollTracks() {
  const dataModule = (s) => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
  const util = dataModule(fs.readFileSync(path.join(__dirname, '../public/js/util.js'), 'utf8'));
  const realDocument = global.document;
  global.document = { getElementById: () => null };
  try {
    const votes = Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['p' + i, i < 6 ? 1 : 2]));
    const options = [0, 6, 2].map((n, i) => ({ n, pid: 'p' + i, aid: i, oid: i, text: 'Option ' + i }));
    for (const id of ['bluff', 'funny-answer', 'story-builder', 'two-truths']) {
      const src = fs.readFileSync(path.join(__dirname, '../public/js/games', id + '.js'), 'utf8').replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)));
      const ui = (await import(dataModule(src))).default;
      const el = { innerHTML: '' };
      ui.render(el, { phase: 'reveal', round: 1, rounds: 2, me: 'watcher', hostId: 'host', players: [], last: {
        options, lines: options, votes, winners: [1], prompt: 'Prompt', seed: 'Seed', truth: 'Truth', truthOid: 1,
        statements: options.map((o) => o.text), lie: 1, fooled: 2, subject: 'p0',
      } }, { send() {} });
      const widths = [...el.innerHTML.matchAll(/style="width:([\d.]+)%"/g)].map((m) => Number(m[1]));
      assert.deepEqual(widths, [0, 75, 25], `${id} represents real vote shares, including zero votes`);
      ui.dispose();
    }
  } finally {
    if (realDocument === undefined) delete global.document;
    else global.document = realDocument;
  }
}

(async () => {
  await checkRoomTimers();
  await checkHistory();
  await checkTypingFeedback();
  await checkPollTracks();
  console.log('WORD_HINTS_PASS: masks, limits, permission, cost, privacy, reset, early completion, stale windows, latest-first filters, 60-character secrets, full recall, typing feedback, real vote shares');
})().catch((err) => { console.error(err); process.exitCode = 1; });
