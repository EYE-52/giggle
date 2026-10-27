'use strict';
/* Real licensed dictionary, actual word games, legal rounds and race guards.
 * Run: node test/word-dictionary.js */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createWordValidator, normalizeWord, isSubset, wordCount } = require('../games/engines/english-dictionary');
const countdown = require('../games/countdown-word/server');
const chain = require('../games/word-chain/server');
const info = require('../games/engines/english-words-info.json');
const { Rooms } = require('../server/room');
const { actionWindow } = require('../games/_sdk');
const players = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id.toUpperCase() }));
class Clock {
  constructor(pack = {}, settings = {}) { this.pack = pack; this.config = settings; this.time = 1700000000000; this.timers = []; this.awards = {}; }
  content() { return this.pack; }
  settings() { return this.config; }
  allPlayers() { return players; }
  players() { return players; }
  hostId() { return 'a'; }
  now() { return this.time; }
  later(ms, fn) { const timer = { at: this.time + ms, fn, canceled: false }; this.timers.push(timer); return () => { timer.canceled = true; }; }
  broadcast() {}
  award(pid, amount) { this.awards[pid] = (this.awards[pid] || 0) + amount; }
  fireNext() {
    const timer = this.timers.filter(timer => !timer.canceled).sort((a, b) => a.at - b.at)[0];
    assert(timer, 'pending timer exists'); timer.canceled = true; this.time = Math.max(this.time, timer.at); timer.fn();
  }
}
const tray = { letters: 'CHOCOLATE'.split(''), best: 'chocolate' };
const act = (game, state, ctx, pid, action) => game.onAction(state, ctx, pid, action);
function privateView(game, state, pid) {
  const view = game.view(state, pid);
  for (const key of ['validator', 'feedback', 'cancelTimer', 'deal', 'roster']) assert(!(key in view), `${key} private`);
  return view;
}
function dictionaryTests() {
  const file = name => fs.readFileSync(path.join(__dirname, '..', 'games/engines', name));
  const hash = name => crypto.createHash('sha256').update(file(name)).digest('hex');
  assert.strictEqual(info.sha256, hash('english-words.txt'));
  assert.strictEqual(info.copyrightSha256, hash('SCOWL_COPYRIGHT.txt'));
  assert.strictEqual(info.wordCount, wordCount);
  assert(wordCount > 50000 && info.sources.length > 20);
  assert.strictEqual(info.release, '2020.12.07'); assert.strictEqual(info.size, 60);
  assert(file('SCOWL_COPYRIGHT.txt').includes('Copyright 2000-2018 by Kevin Atkinson'));
  const validator = createWordValidator();
  for (const word of ['cat', 'cats', 'guitar', 'chocolate', 'cocoa', 'alpha', 'bravo', 'gamma', 'color', 'colour', 'theatre', 'theater']) assert(validator.validate(word).ok, `${word} is supported English`);
  for (const word of ['zzz', 'qzxqzx', 'oletchoca', 'abc123', 'cat!', 'cat dog', 'z'.repeat(25)]) assert(!validator.validate(word).ok, `${word} rejected`);
  assert.strictEqual(normalizeWord(' CAT '), 'cat'); assert.strictEqual(normalizeWord('cat1'), null);
  assert(isSubset('cocoa', tray.letters)); assert(!isSubset('cocoon', tray.letters));
  assert.strictEqual(validator.validate('ab', { minLength: 3 }).code, 'short');
  const extra = createWordValidator(['zzzorg']);
  assert(extra.validate('ZZZORG').ok && extra.validate('chocolate').ok, 'custom list is additive, not a reduced dictionary');
  assert(!extra.validate('zzz').ok, 'custom allows only explicitly listed spelling');
  console.log('DICTIONARY real SCOWL data, attribution/digests, US/UK, invalid strings and additive custom words PASS');
}
function countdownTests() {
  const ctx = new Clock({ sets: [tray] }, { rounds: 2 });
  const state = countdown.create(ctx), deadline = state.endsAt;
  const view = privateView(countdown, state, 'a'); assert.strictEqual(view.best, null); assert.deepStrictEqual(view.answers, {});
  for (const word of ['zzz', 'oletchoca', 'cocoa!', 'ab', 'cocoon']) {
    act(countdown, state, ctx, 'a', { word, lock: true });
    assert(!state.answers.a && !state.locked.a, 'invalid word cannot score or lock');
    assert(privateView(countdown, state, 'a').myFeedback?.ok === false);
    assert.strictEqual(privateView(countdown, state, 'b').myFeedback, null, 'feedback stays private');
    assert.strictEqual(state.endsAt, deadline, 'retry does not extend clock');
  }
  act(countdown, state, ctx, 'a', { word: 'cocoa' });
  act(countdown, state, ctx, 'a', { word: 'oletchoca', lock: true });
  assert.strictEqual(state.answers.a, 'cocoa'); assert(!state.locked.a, 'invalid replacement cannot silently lock old answer');
  act(countdown, state, ctx, 'a', { word: ' CHOCOLATE ', lock: true });
  act(countdown, state, ctx, 'b', { word: 'chocolate', lock: true });
  act(countdown, state, ctx, 'c', { word: 'cocoa', lock: true });
  act(countdown, state, ctx, 'd', { pass: true });
  assert.strictEqual(state.phase, 'reveal');
  assert.deepStrictEqual(state.last.points, { a: 190, b: 190, c: 100, d: 0 }, 'valid word 50 + 10 per letter, longest +50');
  assert.strictEqual(state.last.longest, 9);
  const timers = ctx.timers.slice();
  act(countdown, state, ctx, 'b', { next: true }); assert.strictEqual(state.round, 1);
  act(countdown, state, ctx, 'a', { next: true }); assert.strictEqual(state.round, 2);
  timers.forEach(timer => timer.fn()); assert.strictEqual(state.phase, 'make'); assert.strictEqual(state.round, 2);
  ctx.time = state.endsAt;
  act(countdown, state, ctx, 'a', { word: 'chocolate', lock: true });
  assert.strictEqual(state.phase, 'reveal'); assert.strictEqual(state.last.points.a, 0, 'late answer rejected before scoring');
  ctx.fireNext(); assert.strictEqual(state.phase, 'done'); assert.strictEqual(state.endsAt, 0);
  assert.deepStrictEqual(state.scores, { a: 190, b: 190, c: 100, d: 0 }, 'match scores retain earlier rounds after zero-point timeout');
  assert.deepStrictEqual(privateView(countdown, state, 'watch').scores, state.scores, 'spectators receive authoritative match scores');
  const fresh = countdown.create(ctx); assert.deepStrictEqual(fresh.scores, {}, 'rematch starts fresh despite existing night awards'); countdown.dispose(fresh);
  const awards = { ...ctx.awards }; ctx.timers.forEach(timer => timer.fn()); assert.deepStrictEqual(ctx.awards, awards);
  countdown.dispose(state);
  // No locale pack: all generated trays remain solvable for a full max-length match.
  const generatedCtx = new Clock({}, { rounds: 8 }); const generated = countdown.create(generatedCtx);
  for (let round = 1; round <= 8; round++) {
    assert.strictEqual(generated.letters.length, 9);
    assert(generated.validator.validate(generated.best, { minLength: 3, maxLength: 9, letters: generated.letters }).ok);
    for (const player of players) act(countdown, generated, generatedCtx, player.id, { word: generated.best, lock: true }); // PEEK: knowledgeable solver
    assert.strictEqual(generated.phase, 'reveal');
    act(countdown, generated, generatedCtx, 'a', { next: true });
  }
  assert.strictEqual(generated.phase, 'done'); countdown.dispose(generated);
  // Inspect the entire fallback deal deterministically, including the authored
  // lightbulb exception, then submit each solution through the actual game.
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const probe = countdown.create(new Clock());
    const fallbackSets = [{ letters: probe.letters, best: probe.best }];
    for (let i = 1; i < 32; i++) fallbackSets.push(probe.deal());
    assert.strictEqual(new Set(fallbackSets.map(set => set.best)).size, 32);
    assert(fallbackSets.some(set => set.best === 'lightbulb'));
    assert(!createWordValidator().has('lightbulb'), 'the canonical exception is game-owned');
    countdown.dispose(probe);
    for (const set of fallbackSets) {
      const ctx = new Clock({ sets: [set] }, { rounds: 1 });
      const state = countdown.create(ctx);
      assert.strictEqual(state.contentNote, '', `fallback tray ${set.best} is accepted`);
      for (const player of players) act(countdown, state, ctx, player.id, { word: set.best, lock: true });
      assert.strictEqual(state.phase, 'reveal', `fallback solution ${set.best} locks successfully`);
      assert.strictEqual(state.last.valid.a, true);
      if (set.best === 'lightbulb') assert.strictEqual(state.last.points.a, 190);
      countdown.dispose(state);
    }
  } finally { Math.random = originalRandom; }
  // The entire authored locale is checked, including repeated-letter trays.
  const locale = require('../locales/en/countdown-word.json');
  const localeValidator = createWordValidator(locale.words);
  for (const set of locale.sets) assert(localeValidator.validate(set.best, { minLength: 3, maxLength: 9, letters: set.letters }).ok, `authored tray ${set.best} is solvable`);
  // Extra accepted words must not retire the canonical lightbulb tray.
  for (const set of locale.sets) {
    const ctx = new Clock({ sets: [set], words: ['rainbows'] }, { rounds: 1 });
    const state = countdown.create(ctx);
    assert.strictEqual(state.contentNote, '', `custom extras retain authored tray ${set.best}`);
    assert.strictEqual(state.best, set.best, 'the original tray remains playable, not a generated substitute');
    countdown.dispose(state);
  }
  const bulb = locale.sets.find(set => set.best === 'lightbulb');
  const bulbCtx = new Clock({ sets: [bulb], words: ['rainbows'] }, { rounds: 1 });
  const bulbState = countdown.create(bulbCtx);
  assert(!bulbState.validator.validate('lightbulb', { letters: 'LIGHTBULA'.split('') }).ok, 'both B tiles are required');
  act(countdown, bulbState, bulbCtx, 'a', { word: 'qzxqzx', lock: true });
  assert(!bulbState.answers.a && !bulbState.locked.a, 'supplement does not admit unrelated invalid words');
  act(countdown, bulbState, bulbCtx, 'a', { word: 'lightbulb' });
  assert.strictEqual(privateView(countdown, bulbState, 'a').mine, 'lightbulb');
  assert.deepStrictEqual(privateView(countdown, bulbState, 'b').answers, {}, 'saved bulb word stays private');
  assert.strictEqual(privateView(countdown, bulbState, 'watch').mine, '', 'watcher receives no private save');
  act(countdown, bulbState, bulbCtx, 'a', { lock: true });
  for (const pid of ['b', 'c', 'd']) act(countdown, bulbState, bulbCtx, pid, { pass: true });
  assert.deepStrictEqual(bulbState.last.points, { a: 190, b: 0, c: 0, d: 0 }, 'nine letters plus longest bonus');
  assert.deepStrictEqual(bulbState.scores, { a: 190, b: 0, c: 0, d: 0 });
  assert.deepStrictEqual(bulbCtx.awards, { a: 190 });
  countdown.dispose(bulbState);
  const brokenCtx = new Clock({ sets: [{ letters: ['Z'], best: 'zzz' }, { letters: Array(9).fill('Z'), best: 'zzz' }] });
  const repaired = countdown.create(brokenCtx);
  assert(repaired.contentNote && repaired.validator.validate(repaired.best, { letters: repaired.letters }).ok); countdown.dispose(repaired);
  const customCtx = new Clock({ words: ['zzz'], sets: [{ letters: 'ZZZAEINRT'.split(''), best: 'zzz' }] }, { rounds: 1 });
  const custom = countdown.create(customCtx);
  act(countdown, custom, customCtx, 'a', { word: 'zzz', lock: true });
  for (const pid of ['b', 'c', 'd']) act(countdown, custom, customCtx, pid, { pass: true });
  assert.strictEqual(custom.last.points.a, 130, 'explicit host custom word scores'); countdown.dispose(custom);
  console.log('DICTIONARY Countdown valid English/ties/pass, anagram/format/subset errors, custom packs, deadlines, solvable generated/authored trays PASS');
}
function chainTests() {
  const ctx = new Clock({ starters: ['apple'] }, { turnSeconds: 5 }); const state = chain.create(ctx);
  const turnNo = state.turnNo, deadline = state.endsAt;
  for (const word of ['zzz', 'qzxqzx', 'pear1', 'pear!', 'pear tree']) {
    act(chain, state, ctx, 'a', { word });
    assert.strictEqual(state.turnPid, 'a'); assert.strictEqual(state.turnNo, turnNo); assert.strictEqual(state.endsAt, deadline);
    assert.strictEqual(state.used.length, 1);
    assert(privateView(chain, state, 'a').myFeedback?.ok === false);
    assert.strictEqual(privateView(chain, state, 'b').myFeedback, null);
  }
  act(chain, state, ctx, 'a', { word: ' PEAR ' });
  assert.strictEqual(state.current, 'pear'); assert.strictEqual(state.turnPid, 'b');
  const liveDeadline = state.endsAt, liveTurn = state.turnNo;
  for (const pid of ['b', 'c', 'd']) act(chain, state, ctx, pid, { challenge: true });
  assert(!state.alive.includes('a') && state.lastOut.reason === 'challenged');
  assert.strictEqual(state.turnPid, 'b'); assert.strictEqual(state.turnNo, liveTurn); assert.strictEqual(state.endsAt, liveDeadline, 'challenge does not buy extra time');
  act(chain, state, ctx, 'b', { word: 'apple' }); assert(!state.alive.includes('b') && state.lastOut.reason === 'repeat');
  act(chain, state, ctx, 'c', { word: '' }); assert.strictEqual(state.phase, 'done'); assert.strictEqual(state.winner, 'd'); assert.strictEqual(ctx.awards.d, 300);
  ctx.timers.forEach(timer => timer.fn()); assert.strictEqual(ctx.awards.d, 300, 'stale callbacks cannot award twice'); chain.dispose(state);
  const timeoutCtx = new Clock({ starters: ['apple'] }, { turnSeconds: 5 }); const timeout = chain.create(timeoutCtx);
  timeoutCtx.time = timeout.endsAt; act(chain, timeout, timeoutCtx, 'a', { word: 'pear' });
  assert.strictEqual(timeout.lastOut.reason, 'timeout'); assert(!timeout.used.includes('pear')); chain.dispose(timeout);
  const rotateCtx = new Clock({ starters: ['apple'] }); const rotate = chain.create(rotateCtx), oldTimer = rotateCtx.timers[0];
  for (const word of ['pear', 'fruit', 'banana', 'orange']) act(chain, rotate, rotateCtx, rotate.turnPid, { word });
  assert.strictEqual(rotate.turnPid, 'a'); oldTimer.fn(); assert(rotate.alive.includes('a'), 'old same-player timer cannot fire on later own turn'); chain.dispose(rotate);
  const customCtx = new Clock({ starters: ['myfriend'], words: ['zzzorg'] }); const custom = chain.create(customCtx);
  act(chain, custom, customCtx, 'a', { word: 'zzzorg' }); assert.strictEqual(custom.current, 'zzzorg');
  act(chain, custom, customCtx, 'b', { word: 'zzz', words: ['zzz'] }); assert.strictEqual(custom.turnPid, 'b', 'client cannot approve its own word');
  assert(custom.feedback.b?.ok === false); chain.dispose(custom);
  console.log('DICTIONARY Chain retry/private feedback, strict spelling, custom words, repeat/blank/challenge, deadlines and stale-turn timers PASS');
}
async function roomTests() {
  const realSet = setTimeout, realClear = clearTimeout; const timers = new Map(); let sequence = 0;
  global.setTimeout = fn => { const id = ++sequence; timers.set(id, fn); return id; };
  global.clearTimeout = id => timers.delete(id);
  const socket = () => ({ readyState: 1, bufferedAmount: 0, send() {}, close() { this.readyState = 3; } });
  const drain = () => new Promise(resolve => setImmediate(resolve));
  try {
    for (const game of [countdown, chain]) {
      const rooms = new Rooms({ [game.id]: game === countdown ? { sets: [tray] } : { starters: ['apple'] } });
      const room = rooms.create(); const sockets = players.map(() => socket());
      const seats = sockets.map((sock, i) => room.addPlayer(players[i].name, sock).player);
      assert(room.startGame(game, { settings: game === countdown ? { rounds: 2 } : { turnSeconds: 5 }, pack: { words: ['zzzorg'] } }, seats[0].id).ok);
      await drain();
      const meta = () => ({ i: room.game.instanceId, w: actionWindow(room.game.state) });
      const first = meta();
      if (game === countdown) {
        room.onAction(sockets[0], { word: 'chocolate', lock: true }, meta());
        for (let i = 1; i < 4; i++) room.onAction(sockets[i], { pass: true }, meta());
        room.onAction(sockets[0], { next: true }, meta()); await drain();
        room.onAction(sockets[1], { word: 'chocolate', lock: true }, first);
        assert(!room.game.state.answers[seats[1].id], 'stale countdown round dropped');
      } else {
        room.onAction(sockets[0], { word: 'pear' }, meta()); await drain();
        room.onAction(sockets[1], { word: 'fruit' }, meta()); await drain();
        room.onAction(sockets[2], { word: 'banana' }, meta()); await drain();
        room.onAction(sockets[3], { word: 'orange' }, meta()); await drain();
        room.onAction(sockets[0], { word: 'pear' }, first);
        assert(room.game.state.alive.includes(seats[0].id), 'stale duplicate cannot eliminate returned seat');
      }
      const previousInstance = meta(); assert(room.startGame(game, {}, seats[0].id).ok); await drain();
      room.onAction(sockets[0], { word: game === countdown ? 'chocolate' : 'zzzorg', lock: true }, previousInstance);
      assert(game === countdown ? !Object.keys(room.game.state.answers).length : room.game.state.used.length === 1, 'stale instance cannot submit');
      room.endGameToLobby(seats[0].id); assert.strictEqual(timers.size, 0);
    }
  } finally { global.setTimeout = realSet; global.clearTimeout = realClear; }
  console.log('DICTIONARY real Room custom-pack schema, stale round/turn/instance and timer disposal PASS');
}
async function clientTests() {
  const os = require('os'); const { pathToFileURL } = require('url');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'word-game-views-'));
  fs.mkdirSync(path.join(stage, 'games'));
  fs.copyFileSync(path.join(__dirname, '..', 'public/js/util.js'), path.join(stage, 'util.mjs'));
  fs.writeFileSync(path.join(stage, 'kit.mjs'), fs.readFileSync(path.join(__dirname, '..', 'public/js/kit.js'), 'utf8').replace("'./util.js'", "'./util.mjs'"));
  // Minimal DOM nodes exercise callbacks and same-window partial repainting;
  // actual visual layout is verified separately by root's browser pass.
  class Node {
    constructor() { this.value = ''; this.textContent = ''; this.style = {}; this.children = {}; this.disabled = false; }
    set innerHTML(html) { this.html = html; this.children = html.includes('id="wcCh"') ? { wcCh: new Node() } : {}; }
    get innerHTML() { return this.html || ''; }
    querySelector(selector) { return this.children[selector.slice(1)] || null; }
    focus() { this.focused = true; }
  }
  class Element extends Node {
    set innerHTML(html) {
      this.html = html; this.builds = (this.builds || 0) + 1; this.children = {};
      for (const match of html.matchAll(/<(input|button|p|div)[^>]*\bid="([^"]+)"[^>]*>/g)) {
        const node = new Node();
        node.value = match[0].match(/\bvalue="([^"]*)"/)?.[1] || '';
        node.disabled = /\bdisabled\b/.test(match[0]);
        this.children[match[2]] = node;
      }
    }
    get innerHTML() { return this.html || ''; }
  }
  try {
    const views = {};
    for (const id of ['countdown-word', 'word-chain']) {
      const src = fs.readFileSync(path.join(__dirname, '..', 'public/js/games', id + '.js'), 'utf8').replace("'../util.js'", "'../util.mjs'").replace("'../kit.js'", "'../kit.mjs'");
      const file = path.join(stage, 'games', id + '.mjs'); fs.writeFileSync(file, src);
      views[id] = (await import(pathToFileURL(file).href)).default;
    }
    const sent = []; const api = { send: action => sent.push(action) };
    const countdownEl = new Element();
    const S = { instanceId: 'one', phase: 'make', round: 1, rounds: 2, letters: tray.letters, locked: [], players, hostId: 'a', me: 'a', mine: '', myLocked: false, myFeedback: null };
    views['countdown-word'].render(countdownEl, S, api);
    const input = countdownEl.querySelector('#cwWord'); input.value = 'oletchoca';
    views['countdown-word'].render(countdownEl, { ...S, locked: ['b'], myFeedback: { ok: false, message: 'Try another supported word.' } }, api);
    assert.strictEqual(countdownEl.querySelector('#cwWord'), input, 'peer/feedback updates preserve actual input node');
    assert.strictEqual(input.value, 'oletchoca');
    assert.strictEqual(countdownEl.querySelector('#cwFeedback').textContent, 'Try another supported word.');
    input.onkeydown({ key: 'Enter' }); assert.deepStrictEqual(sent.at(-1), { word: 'oletchoca', lock: true });
    countdownEl.querySelector('#cwPass').onclick(); assert.deepStrictEqual(sent.at(-1), { pass: true });
    views['countdown-word'].render(countdownEl, { ...S, phase: 'done', spectator: true, scores: { a: 140, b: 140, c: 50 }, totals: { a: 9999, b: 8888 }, players: players.map(p => p.id === 'a' ? { ...p, name: '<Long player name & friends>' } : p) }, api);
    assert(countdownEl.innerHTML.includes('Final scores'));
    assert(countdownEl.innerHTML.includes('140') && countdownEl.innerHTML.includes('50'));
    assert(!countdownEl.innerHTML.includes('9999') && countdownEl.innerHTML.includes('&lt;Long player name &amp; friends&gt;'), 'final uses match scores and participant list');
    views['countdown-word'].render(countdownEl, { ...S, phase: 'done', scores: { a: 150 } }, api);
    assert(countdownEl.innerHTML.includes('150'), 'score update invalidates result cache');
    views['countdown-word'].dispose(countdownEl); assert(!countdownEl._key);
    const ctx = new Clock({ starters: ['apple'] }); const state = chain.create(ctx);
    act(chain, state, ctx, 'a', { word: 'pear' });
    const el = new Element();
    const renderChain = () => views['word-chain'].render(el, { ...chain.view(state, 'b'), instanceId: 'two', players, me: 'b' }, api);
    renderChain();
    const chainInput = el.querySelector('#wcWord'); chainInput.value = 'fruit';
    assert(el.querySelector('#wcChallenge').querySelector('#wcCh'), 'current player can vote toward real majority');
    act(chain, state, ctx, 'c', { challenge: true }); renderChain();
    assert.strictEqual(el.querySelector('#wcWord'), chainInput);
    assert(el.querySelector('#wcChallenge').innerHTML.includes('1 vote'), 'peer challenge count updates');
    act(chain, state, ctx, 'b', { word: 'zzz' }); renderChain();
    assert(el.querySelector('#wcFeedback').textContent.includes('offline English dictionary'), 'same-window word error rendered');
    assert.strictEqual(chainInput.value, 'fruit');
    el.querySelector('#wcChallenge').querySelector('#wcCh').onclick(); assert.deepStrictEqual(sent.at(-1), { challenge: true });
    act(chain, state, ctx, 'b', { challenge: true }); act(chain, state, ctx, 'd', { challenge: true }); renderChain();
    assert.strictEqual(el.querySelector('#wcWord').value, 'fruit', 'challenge removal preserves draft on same turn');
    views['word-chain'].dispose(el); assert(!el._key && !el._turnNo); chain.dispose(state);
    console.log('DICTIONARY client callbacks, visible cached-window errors, input preservation, live challenge count/current-player vote and dispose PASS');
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
(async () => { dictionaryTests(); countdownTests(); chainTests(); await roomTests(); await clientTests(); console.log('WORD_DICTIONARY_PASS'); })().catch(error => { console.error('WORD_DICTIONARY_FAIL', error); process.exitCode = 1; });
