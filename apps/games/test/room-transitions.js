'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the actual app request code with a delayed/rejected connection.
// The live view must remain intact until the server accepts the transition.
const source = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const code = source.slice(source.indexOf('function send(o) {'), source.indexOf('const api = {'));
function rig({ host = true, connected = true } = {}) {
  const sent = [], messages = [], events = [], stops = [], resets = [], timers = new Map();
  let seq = 0;
  const state = Object.freeze({ phase: 'done', instanceId: 'match-1' });
  const context = {
    pendingRoomAction: null, roomActionTimeout: 0, instanceId: 'match-1', gameId: 'castle-clash', lastState: state,
    ws: { readyState: connected ? 1 : 3, send: value => sent.push(JSON.parse(value)) },
    createGameCuePlayer: () => () => false, sound: {stop:()=>stops.push(true)}, resultPresentation: {reset:()=>resets.push(true)},
    isHost: () => host, toast: value => messages.push(value), renderHostStates() {},
    document: { dispatchEvent: event => events.push(event.type) },
    Event: class { constructor(type) { this.type = type; } },
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.createContext(context);
  vm.runInContext(code + '\nglobalThis.qa = { requestRoomAction, clearRoomAction };', context);
  return { context, sent, messages, events, stops, resets, timers, state, ...context.qa };
}
{
  const r = rig();
  r.requestRoomAction('lobby');
  r.requestRoomAction('lobby');
  assert.deepEqual(r.sent, [{ t: 'lobby' }], 'rapid taps send one request');
  assert.strictEqual(r.context.lastState, r.state, 'request does not clear the completed game');
  assert.equal(r.stops.length,1,'leaving/rematching stops gameplay audio immediately');
  assert.equal(r.resets.length,1,'leaving/rematching retires any pending finale');
  assert.deepEqual(r.events, ['game-screenchange'], 'held inputs are released once');
  assert.equal(r.timers.size, 1);
  r.clearRoomAction();
  assert.equal(r.timers.size, 0, 'acknowledgement/rejection cancels timeout');
  assert.equal(r.context.pendingRoomAction, null);
  r.requestRoomAction('rematch');
  assert.deepEqual(r.sent[1], { t: 'start', game: 'castle-clash', ready: true });
  assert.equal(r.timers.values().next().value.ms, 6000);
  r.timers.values().next().value.fn();
  assert.equal(r.context.pendingRoomAction, null, 'missing acknowledgement permits an explicit retry');
  assert.deepEqual(r.messages, ['No response yet. Try again.']);
  assert.strictEqual(r.context.lastState, r.state, 'timeout retains the real result screen');
}
for (const options of [{ host: false }, { connected: false }]) {
  const r = rig(options);
  r.requestRoomAction('lobby');
  assert.equal(r.sent.length, 0, 'non-host/offline client cannot enqueue a transition');
  assert.equal(r.timers.size, 0);
  assert.equal(r.context.pendingRoomAction, null);
}
console.log('ROOM_TRANSITIONS_PASS: rapid taps, input release, delayed acknowledgement, rejection/cleanup, retry, offline and host gates');
