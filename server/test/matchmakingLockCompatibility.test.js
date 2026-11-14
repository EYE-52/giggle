const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function loadConfig(socket, scoped) {
  const filename = path.join(__dirname, '../src/config/redisConfig.js');
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    process: { pid: process.pid, env: { ...process.env, MEET_SCOPED_MATCHMAKING_LOCKS: scoped ? 'true' : 'false' } },
    console: { log() {}, error() {} },
    require(id) {
      if (id === './redisOptions') return { getRedisOptions: (options = {}) => [socket, options] };
      return realRequire(id);
    },
  }, { filename });
  return module.exports;
}

test('real Redis locks support staged rollout and parallel scoped pairs', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-lock-compat-'));
  const socket = path.join(directory, 'redis.sock');
  const child = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  t.after(async () => {
    if (child.exitCode === null && !spawnError) {
      const ended = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM');
      await ended;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !fs.existsSync(socket) && !spawnError; i++) await new Promise(resolve => setTimeout(resolve, 10));
  if (spawnError?.code === 'ENOENT') return t.skip('redis-server is not installed');
  assert.equal(spawnError, undefined);
  assert.ok(fs.existsSync(socket));

  const compat = loadConfig(socket, false);
  const scoped = loadConfig(socket, true);
  t.after(() => {
    for (const config of [compat, scoped]) {
      config.redis.disconnect();
      config.pubClient.disconnect();
      config.subClient.disconnect();
    }
  });
  await Promise.all([compat.redis.ping(), scoped.redis.ping()]);
  const busy = error => error.name === 'ExecutionError';

  await t.test('a legacy global lease blocks the new compatibility mode', async () => {
    const legacy = await compat.redlock.acquire(['lock:matchmaking'], 5000, { retryCount: 0 });
    let entered = false;
    try {
      await assert.rejects(compat.withMatchmakingLock(async () => { entered = true; }, { squadIds: ['a', 'b'], retryCount: 0 }), busy);
      assert.equal(entered, false);
    } finally { await legacy.release(); }
    await compat.withMatchmakingLock(async () => { entered = true; }, { squadIds: ['a', 'b'], retryCount: 0 });
    assert.equal(entered, true);
  });

  await t.test('compatibility mode blocks both legacy and newly scoped replicas', async () => {
    const entered = deferred(), release = deferred();
    const owner = compat.withMatchmakingLock(async () => { entered.resolve(); await release.promise; }, { squadIds: ['a', 'b'], retryCount: 0 });
    await entered.promise;
    try {
      await assert.rejects(scoped.withMatchmakingLock(async () => assert.fail('scoped operation entered'), { squadIds: ['c', 'd'], retryCount: 0 }), busy);
      await assert.rejects(scoped.redlock.acquire(['lock:matchmaking'], 5000, { retryCount: 0 }), busy);
    } finally { release.resolve(); await owner; }
    await scoped.withMatchmakingLock(async () => {}, { squadIds: ['c', 'd'], retryCount: 0 });
  });

  await t.test('100 disjoint pair scopes can be active at the same time', async () => {
    const byStripe = new Map();
    for (let index = 0; byStripe.size < 200 && index < 10000; index++) {
      const id = `parallel-${index}`;
      byStripe.set(scoped.matchmakingStripeResource(id), id);
    }
    assert.equal(byStripe.size, 200);
    const ids = [...byStripe.values()];
    const entered = deferred(), release = deferred();
    let active = 0, peak = 0;
    const owners = Array.from({ length: 100 }, (_, index) => scoped.withMatchmakingLock(async () => {
      active++;
      peak = Math.max(peak, active);
      if (active === 100) entered.resolve();
      await release.promise;
      active--;
    }, { squadIds: ids.slice(index * 2, index * 2 + 2), retryCount: 0 }));
    let timer;
    try {
      await Promise.race([
        entered.promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('independent pairs did not enter together')), 2000); }),
        Promise.all(owners),
      ]);
      assert.equal(peak, 100);
    } finally {
      clearTimeout(timer);
      release.resolve();
      await Promise.all(owners);
    }
    assert.equal(active, 0);
  });

  await t.test('the same pair serializes even when squad order is reversed', async () => {
    const entered = deferred(), release = deferred(), order = [];
    const first = scoped.withMatchmakingLock(async () => {
      order.push('first-start');
      entered.resolve();
      await release.promise;
      order.push('first-end');
    }, { squadIds: ['same-a', 'same-b'], retryCount: 0 });
    await entered.promise;
    try {
      await assert.rejects(scoped.withMatchmakingLock(async () => order.push('overlap'), { squadIds: ['same-b', 'same-a'], retryCount: 0 }), busy);
    } finally { release.resolve(); await first; }
    await scoped.withMatchmakingLock(async () => order.push('second-start'), { squadIds: ['same-b', 'same-a'], retryCount: 0 });
    assert.deepEqual(order, ['first-start', 'first-end', 'second-start']);
  });
});
