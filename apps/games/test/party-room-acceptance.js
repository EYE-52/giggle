'use strict';
// Local acceptance: actual Room authority and real localhost WebSockets, with
// production clients mounted on the existing DOM stub. Engine timers use a
// controlled clock. This proves transport/role/phase behavior, not browser
// geometry, native input, CSS/font readiness, or physical-device behavior.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { WebSocket, WebSocketServer } = require('ws');
const { Room } = require('../server/room');
const { makeDocument, surface } = require('./party-mobile');
const { settingsFor } = require('./game-playability');
const root = path.resolve(__dirname, '..');
const ids = ['would-you-rather','never-ever','most-likely','rank-it','pick-one','rapid-polls','hot-takes','two-truths','funny-answer','bluff','story-builder','emoji-story','compliment-battle','roast-toast','truth-dare','five-second','dare-roulette','trivia','scattergories','word-chain','countdown-word','lyric-fill','twenty-questions','warm-words','memory-tray','typing-race','reaction-tap','number-hunt'];
const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const util = data(fs.readFileSync(path.join(root, 'public/js/util.js'), 'utf8'));
const capabilities = data(fs.readFileSync(path.join(root, 'public/js/toolkit/input-capabilities.mjs'), 'utf8'));
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(condition, label) {
  const end = Date.now() + 3000;
  while (!condition()) { assert(Date.now() < end, label + ' timed out'); await tick(); }
}
async function acknowledgement(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(label + ' transport acknowledgement timed out')), 3000);
    })]);
  } finally { clearTimeout(timer); }
}
class Clock {
  constructor() { this.time = Date.now(); this.timers = []; }
  later(ms, fn) { const timer = { at: this.time + ms, fn, dead: false }; this.timers.push(timer); return () => { timer.dead = true; }; }
  fire() {
    const timer = this.timers.filter(t => !t.dead).sort((a,b) => a.at - b.at)[0];
    assert(timer, 'expected an engine deadline'); timer.dead = true;
    this.time = Math.max(this.time, timer.at); timer.fn();
  }
}
async function view(id, seat) {
  const source = fs.readFileSync(path.join(root, 'public/js/games', id + '.js'), 'utf8')
    .replace("'../util.js'", JSON.stringify(util)).replace("'../kit.js'", JSON.stringify(require('./_kit-url')(util)))
    .replace("'../toolkit/input-capabilities.mjs'", JSON.stringify(capabilities));
  return (await import(data(source + '\n// isolated client ' + seat))).default;
}

async function acceptance(id) {
  const def = require('../games/' + id + '/server');
  const localeFile = path.join(root, 'locales/en', id + '.json');
  const content = fs.existsSync(localeFile) ? JSON.parse(fs.readFileSync(localeFile, 'utf8')) : {};
  const room = new Room('OWNQ', { [id]: content });
  let clock = new Clock();
  const baseCtx = room.ctx.bind(room);
  room.ctx = () => ({ ...baseCtx(), now: () => clock.time, later: (ms, fn) => clock.later(ms, fn) });
  const server = http.createServer(), wss = new WebSocketServer({ server });
  const clients = [], errors = [], phases = new Set();
  let sequence = 0, snapshot = 0, rendered = 0, actions = 0, acknowledgements = 0, preparations = 0;
  const broadcast = room.broadcastState.bind(room);
  room.broadcastState = (...args) => {
    broadcast(...args);
    const version = ++snapshot;
    for (const player of room.connectedPlayers()) room.send(player.socket, { t: 'sync', version });
  };
  wss.on('connection', socket => {
    socket.on('message', raw => {
      try {
        const message = JSON.parse(raw);
        if (message.t === 'join') {
          const joined = room.addPlayer(message.name, socket, message.token);
          assert(joined.player, joined.error);
          socket.send(JSON.stringify({ t: 'joined', id: joined.player.id, token: joined.player.token }));
          room.broadcastLobby(); if (room.game) room.broadcastState();
        } else if (message.t === 'ready') room.onReady(socket, { i: message.i, w: message.w });
        else if (message.t === 'action') {
          const player = room.bySocket(socket);
          const before = JSON.stringify(def.view(room.game.state, player.id));
          room.onAction(socket, message.a, { i: message.i, w: message.w });
          const after = JSON.stringify(def.view(room.game.state, player.id));
          socket.send(JSON.stringify({ t: 'ack', seq: message.seq, changed: before !== after }));
        } else if (message.t === 'start') {
          clock = new Clock();
          const result = room.startGame(def, { ready: true, settings: message.settings, ...(message.pack ? { pack: message.pack } : {}) }, room.bySocket(socket).id);
          assert(result.ok, result.error);
        }
      } catch (error) { errors.push(error); }
    });
    socket.on('close', () => room.disconnect(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = 'ws://127.0.0.1:' + server.address().port;
  const settings = settingsFor(def, { rounds: 2, roundSeconds: 30, voteSeconds: 5, submitSeconds: 15, turnSeconds: 5, memSeconds: 5, recallSeconds: 10, maxQuestions: 20, hints: true });
  const packs = def.manifest?.packs || {};
  const special = {
    'scattergories': { letters: ['A','B','C','D','E'] },
    'word-chain': { starters: ['apple','banana','cherry'], words: ['giggleproof'] },
    'countdown-word': { words: ['chocolate'] },
    'warm-words': { targets: ['kitchen','apple'] },
  };
  const pack = Object.fromEntries(Object.entries(packs).map(([key,schema]) => [key,
    special[id]?.[key] || Array.from({ length: schema.minItems || 3 }, (_,i) => 'QA ' + (i + 1) + ': <lamp> & bell')
  ]));
  async function join(name, token, existing) {
    const client = existing || { name, doc: makeDocument(), pending: new Map(), prepared: new Set(), ui: await view(id, name) };
    if (!existing) { client.el = surface(client.doc); clients.push(client); }
    const socket = client.socket = new WebSocket(address);
    socket.on('message', raw => {
      try {
        const message = JSON.parse(raw);
        if (message.t === 'joined') { client.id = message.id; client.token = message.token; client.joined = true; }
        if (message.t === 'sync') client.version = message.version;
        if (message.t === 'ack') { const resolve = client.pending.get(message.seq); client.pending.delete(message.seq); resolve?.(message); }
        if (message.t === 'state') {
          client.S = { ...message, me: message.you, hostId: room.hostId, strings: content.strings || {} };
          const captured = client.S;
          const api = { now: () => clock.time, send(action) {
            if (client.socket.readyState !== WebSocket.OPEN || client.S.preparing || client.S.instanceId !== captured.instanceId || client.S.w !== captured.w) return false;
            const seq = ++sequence;
            client.lastSend = new Promise(resolve => client.pending.set(seq, resolve));
            client.socket.send(JSON.stringify({ t: 'action', a: action, i: captured.instanceId, w: captured.w, seq }));
            actions++; return true;
          } };
          client.api = api;
          const previous = global.document; global.document = client.doc;
          try { (client.ui.update || client.ui.render).call(client.ui, client.el, client.S, api); }
          finally { global.document = previous; }
          rendered++; phases.add(message.phase);
          if (message.preparing) {
            const key = message.instanceId + ':' + message.w;
            if (!client.prepared.has(key)) {
              preparations++; client.prepared.add(key);
              socket.send(JSON.stringify({ t: 'ready', i: message.instanceId, w: message.w }));
            }
          }
          privacy(client.S);
        }
      } catch (error) { errors.push(error); }
    });
    await new Promise(resolve => socket.once('open', resolve));
    client.joined = false; socket.send(JSON.stringify({ t: 'join', name, token }));
    await until(() => client.joined, id + ' join'); return client;
  }
  function privacy(S) {
    if (['reveal','roundEnd','done'].includes(S.phase)) return;
    if (id === 'twenty-questions' && S.me !== S.answerer) assert(!('word' in S) && !('wordShown' in S));
    if (id === 'emoji-story' && S.me !== S.director) assert(!S.phrase);
    if (id === 'number-hunt') assert(!('secret' in S));
    if (id === 'warm-words') assert(!('target' in S));
    if (id === 'lyric-fill') assert(!('answer' in S.line));
    if (['scattergories','countdown-word','lyric-fill'].includes(id)) assert.deepEqual(S.answers, {});
    if (id === 'memory-tray' && S.phase === 'recall') assert(!S.items?.length);
    if (['vote','verdict'].includes(S.phase) && S.votes) assert.deepEqual(S.votes, {}, id + ' secret votes');
    if (id === 'rank-it' && S.phase === 'rank') assert.deepEqual(S.ranks, {});
    if (['compliment-battle','roast-toast'].includes(id)) {
      assert.deepEqual(S.entries, {}); assert(!('order' in S) && !('rotation' in S));
      for (const option of S.ballot || []) assert(!('author' in option) && !('pid' in option));
    }
    if (id === 'funny-answer') {
      assert.deepEqual(S.answers, {}); for (const option of S.options || []) assert(!('pid' in option));
    }
    if (id === 'bluff') {
      assert(!S.fact.truth); assert.deepEqual(S.fakes, {}); assert.deepEqual(S.picks, {});
      for (const option of S.options || []) assert(!('pid' in option));
    }
    if (id === 'trivia') { assert(!('answer' in S.question)); assert.deepEqual(S.answers, {}); }
    if (id === 'two-truths' && S.phase === 'vote') assert(!('lie' in S));
  }
  async function settle() {
    await until(() => room.game && !room.game.preparing && clients.every(c => c.version === snapshot && c.S && c.S.instanceId === room.game.instanceId && c.S.w === room._actionToken() && !c.S.preparing), id + ' released window');
    assert(!errors.length, errors[0]?.stack);
  }
  async function send(client, interaction) {
    client.lastSend = null;
    const previous = global.document; global.document = client.doc;
    try { interaction(client.el); } finally { global.document = previous; }
    assert(client.lastSend, id + ' ' + client.S.phase + ' mounted control did not send');
    const result = await acknowledgement(client.lastSend, id);
    assert(result.changed, id + ' ' + client.S.phase + ' action was not acknowledged by the authority');
    acknowledgements++; await settle();
  }
  const field = (el, selector, value) => { const input = el.querySelector(selector); assert(input && !input.disabled, id + ' missing writable ' + selector); input.value = value; };
  const click = (el, selector) => { const button = el.querySelector(selector); assert(button && !button.disabled, id + ' missing enabled ' + selector); button.click(); };
  const write = (client, input, button, text) => send(client, el => { field(el, input, text); click(el, button); });
  async function rejected(client, action, meta) {
    const seq = ++sequence;
    const ack = new Promise(resolve => client.pending.set(seq, resolve));
    client.socket.send(JSON.stringify({ t: 'action', seq, a: action, ...meta }));
    const result = await acknowledgement(ack, id); assert(!result.changed, id + ' forbidden action cannot change the match');
  }
  async function drive(deadlines = false) {
    const state = room.game.state, window = room._actionToken(), phase = state.phase;
    if (phase === 'done') return;
    if (deadlines) {
      if (id === 'number-hunt' && phase === 'hunt') { // Hunt starts its deadline after the first finder. PEEK controlled solution.
        await write(clients[0], '#nGuess', '#nSend', String(state.secret)); return;
      }
      clock.fire(); await settle(); return;
    }
    for (const client of clients.slice(0, 3)) {
      if (room._actionToken() !== window) break;
      const S = client.S;
      if (phase === 'reveal') {
        const next = client.el.querySelector('button[id$="Next"],button[data-ww-next]');
        if (next && !next.disabled) { await send(client, () => next.click()); break; }
      } else if (id === 'bluff') {
        if (phase === 'bluff') await write(client, '#bFake', '#bSend', 'A plausible answer from ' + client.name);
        else await send(client, el => click(el, '[data-v]:not([disabled])'));
      } else if (id === 'funny-answer') {
        if (phase === 'answer') await write(client, '#fAns', '#fSend', client.name + ' brought a miniature disco ball.');
        else await send(client, el => click(el, '[data-v]:not([disabled])'));
      } else if (id === 'compliment-battle' || id === 'roast-toast') {
        const prefix = id === 'compliment-battle' ? 'cb' : 'rt';
        if (phase === 'write' && S.me !== S.target) await write(client, '#' + prefix + 'Entry', '#' + prefix + 'Send', client.name + ' makes snack breaks a three-act story.');
        else if (phase === 'vote') {
          const selector = id === 'roast-toast' && S.me === S.target ? '[data-p]:not([disabled])' : '[data-v]:not([disabled])';
          if (client.el.querySelector(selector)) await send(client, el => click(el, selector));
        }
      } else if (id === 'hot-takes') {
        if (phase === 'submit') await write(client, '#hTake', '#hSend', client.name + ' says breakfast belongs at midnight.');
        else if (S.current && !S.current.mine) await send(client, el => click(el, '[data-v]:not([disabled])'));
      } else if (id === 'two-truths') {
        if (phase === 'write' && S.me === S.subject) await send(client, el => {
          ['I make pancakes.','I missed a train.','I have a pet dragon.'].forEach((text,i) => field(el, '#tS' + i, text));
          click(el, 'input[name="tLie"][value="2"]'); click(el, '#tSend');
        });
        else if (phase === 'vote' && S.me !== S.subject) await send(client, el => click(el, '[data-v="2"]'));
      } else if (id === 'emoji-story') {
        if (phase === 'emoji' && S.me === S.director) await write(client, '#eEmoji', '#eSend2', '🌊🐟🎉');
        else if (phase === 'guess' && S.me !== S.director && !S.mySolved) await write(client, '#eGuess', '#eSend', room.game.def.view(state, state.director).phrase);
      } else if (id === 'five-second') {
        if (phase === 'answer' && S.me === S.performer) await write(client, '#fAns', '#fSend', 'one, two, three');
        else if (phase === 'vote' && S.me !== S.performer) await send(client, el => click(el, '[data-v="pass"]'));
      } else if (id === 'truth-dare') {
        if (phase === 'choose' && S.me === S.target) await send(client, el => click(el, '[data-kind="dare"]'));
        else if (phase === 'perform' && S.me === S.target) await send(client, el => click(el, '#tReady'));
        else if (phase === 'vote' && S.me !== S.target) await send(client, el => click(el, '[data-v="yes"]'));
      } else if (id === 'dare-roulette') {
        if (phase === 'spin' && S.me === S.hostId) await send(client, el => click(el, '#drSpin'));
        else if (phase === 'perform' && S.me === S.victim) await send(client, el => click(el, '#drReady'));
        else if (phase === 'verdict' && S.me !== S.victim) await send(client, el => click(el, '[data-v="done"]'));
      } else if (id === 'story-builder') {
        if (phase === 'build' && S.me === S.turn) await write(client, '#sLine', '#sSend', client.name + ' opened the door to a tiny dragon bakery.');
        else if (phase === 'vote') await send(client, el => click(el, '[data-v]:not([disabled])'));
      } else if (id === 'rank-it') {
        await send(client, el => { click(el, '[data-dn="0"]'); click(el, '#rLock'); });
      } else if (id === 'rapid-polls') {
        if (phase === 'pose') await send(client, el => {
          field(el, '#rpQ', 'What makes game night great?');
          ['Stories','Close contests','Snacks','Everyone joining'].forEach((text,i) => field(el, '#rpO' + i, text)); click(el, '#rpAsk');
        });
        else await send(client, el => click(el, '[data-v="3"]'));
      } else if (id === 'trivia') { // PEEK: controlled correct response, never added to active public view.
        await send(client, el => click(el, '[data-p="' + state.question.answer + '"]'));
      } else if (id === 'lyric-fill') { // PEEK: controlled correct response.
        await write(client, '#lfText', '#lfGo', state.line.answer);
      } else if (id === 'most-likely') await send(client, el => click(el, '[data-v]:not([disabled])'));
      else if (id === 'never-ever') await send(client, el => click(el, '[data-v="not"]'));
      else if (id === 'pick-one' || id === 'would-you-rather') await send(client, el => click(el, '[data-v="a"]'));
      else if (id === 'scattergories') await send(client, el => {
        S.categories.forEach((_,i) => field(el, '#sc' + i, S.letter + 'ample')); click(el, '#scLock');
      });
      else if (id === 'countdown-word') await write(client, '#cwWord', '#cwLock', state.best || 'late');
      else if (id === 'memory-tray' && phase === 'recall') await write(client, '#mAns', '#mSend', state.items.slice(0, 4).join(', ')); // Study state retained by controlled player.
      else if (id === 'typing-race' && phase === 'race') {
        clock.time += 250; await send(client, el => { const input = el.querySelector('#tInput'); field(el, '#tInput', S.target); input.oninput(); });
      } else if (id === 'reaction-tap' && phase === 'go') {
        clock.time += 200; await send(client, el => click(el, '#rPad'));
      } else if (id === 'number-hunt' && (phase === 'hunt' || phase === 'overtime') && !(S.finished || []).some(f => f.pid === S.me)) await write(client, '#nGuess', '#nSend', String(state.secret)); // PEEK after checking secret-free projections.
      else if (id === 'warm-words' && phase === 'guess') { // PEEK after checking target-free projections.
        clock.time += 400; await send(client, el => { field(el, '[data-ww-input]', state.target); el.querySelector('[data-ww-form]').onsubmit({ preventDefault() {} }); });
      } else if (id === 'twenty-questions' && phase === 'play' && S.me !== S.answerer) {
        const actor = clients.find(c => c.S.me === S.answerer);
        await write(client, '#tQ', '#tQSend', 'Does it belong inside a home?');
        await send(actor, el => click(el, '#tqSome'));
        await write(client, '#tG', '#tGSend', actor.S.wordShown);
      } else if (id === 'word-chain' && phase === 'play' && S.me === S.turnPid) {
        await write(client, '#wcWord', '#wcGo', state.used.length === 1 ? 'giggleproof' : ''); // Custom dictionary link, then explicit pass/elimination.
      }
    }
    if (room._actionToken() === window) { clock.fire(); await settle(); }
  }
  try {
    for (const name of ['Ada QA','Bo QA','Cam QA']) await join(name);
    for (const [index, client] of clients.entries()) room.totals[client.id] = (index + 1) * 111;
    clients[0].socket.send(JSON.stringify({ t: 'start', settings, ...(Object.keys(pack).length ? { pack } : {}) })); await settle();
    const firstInstance = room.game.instanceId;
    const persistedSettings = structuredClone(room.config[id].settings);
    const persistedPack = structuredClone(room.config[id].pack);
    assert.deepEqual(room.configMeta()[id], { settings: persistedSettings, packs: Object.fromEntries(Object.entries(pack).map(([key, entries]) => [key, entries.length])) }, id + ' public customization contains settings and counts, not private pack contents');
    const watcher = await join('Watch QA'); await settle();
    assert(watcher.S.spectator, id + ' late join is a spectator');
    const beforeSpectator = JSON.stringify(room.game.state);
    await rejected(watcher, { vote: 'a', guess: 42, next: true, typed: 'x' }, { i: watcher.S.instanceId, w: watcher.S.w });
    assert.equal(JSON.stringify(room.game.state), beforeSpectator, id + ' spectator action cannot change the match');
    // Reconnect one real transport seat in the initial window.
    const reconnect = clients[1], identity = reconnect.id;
    await new Promise(resolve => { reconnect.socket.once('close', resolve); reconnect.socket.close(); });
    await join(reconnect.name, reconnect.token, reconnect); await settle();
    assert.equal(reconnect.id, identity); assert(!reconnect.S.spectator);
    for (let n = 0; room.game.state.phase !== 'done' && n < 100; n++) await drive();
    assert.equal(room.game.state.phase, 'done', id + ' completes a player match');
    for (const client of clients) assert(client.el.textContent.trim().length > 5, id + ' renders final player/spectator results');
    const scores = room.game.state.scores;
    if (scores) for (const [index,client] of clients.slice(0,3).entries()) assert.equal(room.totals[client.id] - (index + 1) * 111, scores[client.id] || 0, id + ' authoritative match scores equal this match awards');
    const first = { actions: acknowledgements, rendered, phases: [...phases], points: scores || null };
    // Rematch uses persisted configuration. Disconnect the late spectator
    // before start to keep the same three active seats.
    await new Promise(resolve => { watcher.socket.once('close', resolve); watcher.socket.close(); });
    const previous = global.document; global.document = watcher.doc;
    try { watcher.ui.dispose?.(watcher.el); } finally { global.document = previous; }
    clients.pop();
    clients[0].socket.send(JSON.stringify({ t: 'start' }));
    await until(() => room.game.instanceId !== firstInstance, id + ' rematch starts'); await settle();
    assert.notEqual(room.game.instanceId, firstInstance, id + ' rematch mints a new instance');
    assert.deepEqual(room.config[id].settings, persistedSettings, id + ' rematch preserves validated settings');
    assert.deepEqual(room.config[id].pack, persistedPack, id + ' rematch preserves custom content');
    const old = JSON.stringify(room.game.state);
    await rejected(clients[0], { next: true, vote: 'a', guess: 42 }, { i: firstInstance, w: clients[0].S.w });
    assert.equal(JSON.stringify(room.game.state), old, id + ' retired rematch cannot act');
    for (let n = 0; room.game.state.phase !== 'done' && n < 120; n++) await drive(true);
    assert.equal(room.game.state.phase, 'done', id + ' short/deadline rematch completes');
    assert(preparations > 3, id + ' prepared subsequent action windows');
    const result = { id, pass: true, evidence: 'actual Room + localhost WebSockets + production clients on DOM stub; controlled engine deadlines', first, totalActions: actions, preparations, reconnect: true, lateSpectator: true, deadlineRematch: true, customPacks: Object.keys(pack) };
    console.log('PARTY_ROOM_ACCEPTANCE_PASS ' + id + ' ' + acknowledgements + ' mounted-control acknowledgements, ' + preparations + ' readiness acknowledgements');
    return result;
  } finally {
    for (const client of clients) {
      const previous = global.document; global.document = client.doc;
      try { client.ui.dispose?.(client.el); } finally { global.document = previous; }
      client.socket.terminate();
    }
    room.destroy(); for (const socket of wss.clients) socket.terminate();
    await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve));
  }
}

(async () => {
  const results = [];
  for (const id of (process.argv.slice(2).length ? process.argv.slice(2) : ids)) {
    try { results.push(await acceptance(id)); }
    catch (error) { results.push({ id, pass: false, error: error.stack }); console.error('PARTY_ROOM_ACCEPTANCE_FAIL ' + id + ' ' + error.stack); }
  }
  if (process.env.PARTY_ACCEPTANCE_REPORT) fs.writeFileSync(process.env.PARTY_ACCEPTANCE_REPORT, JSON.stringify({ evidence: 'actual Room/WS; controlled clock; mounted DOM stub, not native browser', results }, null, 2));
  assert(results.every(r => r.pass), 'acceptance cases failed');
})().catch(error => { console.error(error); process.exit(1); });
