const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function harness() {
  const filename = path.join(__dirname, '../src/services/socketService.js');
  const realRequire = createRequire(filename);
  const sockets = new Map();
  const live = new Map();
  const emissions = [];
  const queries = [];
  let blockRegistration;
  let registrationStarted = false;
  const intervals = new Set();
  let failRoster = false;
  const redis = {
    smembers: async key => [...(sockets.get(key) || [])],
    srem: async (key, ...ids) => ids.forEach(id => sockets.get(key)?.delete(id)),
    del: async key => live.delete(key),
    pipeline() {
      const keys = [];
      return { exists(key) { keys.push(key); return this; }, exec: async () => keys.map(key => [null, Number(live.has(key))]) };
    },
    multi() {
      let userKey, socketId, socketKey, userId;
      return {
        sadd(key, id) { userKey = key; socketId = id; return this; },
        expire() { return this; },
        set(key, id) { socketKey = key; userId = id; return this; },
        async exec() {
          registrationStarted = true;
          if (blockRegistration) await blockRegistration;
          if (!sockets.has(userKey)) sockets.set(userKey, new Set());
          sockets.get(userKey).add(socketId);
          live.set(socketKey, userId);
          return [[null, 1], [null, 1], [null, 'OK']];
        },
      };
    },
  };
  let connect;
  class Server {
    adapter() {}
    use() {}
    on(event, handler) { if (event === 'connection') connect = handler; }
    to(room) { return { emit: (event, payload) => emissions.push({ room, event, payload }) }; }
    close(done) { done(); }
  }
  const Squad = { find(query) {
    queries.push(query);
    if (query.status) return Promise.resolve([]);
    return { select: async () => { if (failRoster) throw Error('roster unavailable'); return [{ squadId: 'current' }]; } };
  } };
  const module = { exports: {} };
  const context = {
    module, exports: module.exports, process, Buffer, clearInterval, setTimeout,
    setInterval(handler, ms) { const timer = setInterval(handler, ms); intervals.add(timer); return timer; },
    console: { log() {}, error() {} },
    require(id) {
      if (id === 'socket.io') return { Server };
      if (id === '@socket.io/redis-adapter') return { createAdapter: () => ({}) };
      if (id === '../config/redisConfig') return { redis, pubClient: {}, subClient: {} };
      if (id === '../models/Squad') return { Squad };
      return realRequire(id);
    },
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  module.exports.init({});
  const open = id => {
    const handlers = {};
    connect({ id, userId: 'user', join() {}, on(event, handler) { handlers[event] = handler; } });
    return { disconnect: () => handlers.disconnect() };
  };
  return { service: module.exports, open, emissions, queries,
    socketIsLive: id => live.has('presence:socket:' + id),
    registrationStarted: () => registrationStarted,
    close: async () => { for (const timer of intervals) clearInterval(timer); await module.exports.close(); },
    holdRegistration: promise => { blockRegistration = promise; },
    failRoster: () => { failRoster = true; } };
}
async function until(check) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(check(), true);
}

test('first connection and last disconnect refresh current squads, but another tab stays online', async t => {
  const h = harness();
  t.after(() => h.close());
  const first = h.open('first');
  await until(() => h.emissions.length === 1);
  const second = h.open('second');
  await until(() => h.socketIsLive('second'));
  assert.equal(h.emissions.length, 1);
  await first.disconnect();
  assert.equal(await h.service.isUserOnline('user'), true);
  assert.equal(h.emissions.length, 1);
  await second.disconnect();
  assert.equal(await h.service.isUserOnline('user'), false);
  assert.equal(h.emissions.length, 2);
  for (const e of h.emissions) {
    assert.equal(e.room, 'squad_current');
    assert.equal(e.event, 'SQUAD_UPDATED');
    assert.equal(Object.keys(e.payload).length, 0);
  }
  await h.service.close();
});

test('fast disconnect waits pending registration and roster errors do not abort cleanup', async t => {
  const h = harness();
  t.after(() => h.close());
  let release;
  h.holdRegistration(new Promise(resolve => { release = resolve; }));
  h.failRoster();
  const socket = h.open('fast');
  let disconnected = false;
  const disconnect = socket.disconnect().then(() => { disconnected = true; });
  await until(() => h.registrationStarted());
  assert.equal(disconnected, false);
  release();
  await disconnect;
  assert.equal(await h.service.isUserOnline('user'), false);
  assert.equal(h.queries.some(query => query.status === 'searching'), true);
  assert.equal(h.emissions.length, 0);
  await h.service.close();
});
