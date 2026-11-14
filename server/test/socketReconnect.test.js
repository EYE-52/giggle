const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');
const Redis = require('ioredis');

function loadQueue(redis) {
  const filename = path.join(__dirname, '../src/services/queueService.js');
  const realRequire = createRequire(filename), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports,
    require: id => id === '../config/redisConfig' ? { redis } : realRequire(id),
    Date, console, process,
  }, { filename });
  return module.exports;
}

function harness(redis) {
  const filename = path.join(__dirname, '../src/services/socketService.js');
  const realRequire = createRequire(filename);
  const queue = loadQueue(redis);
  const state = { squad: { squadId: 'squad', status: 'searching', currentEncounterId: null, __v: 0,
    searchQueuedAt: new Date(1000), members: [{ userId: 'user', memberId: 'member' }] },
    beforeLease: null, beforeUpdate: null, beforeEnd: null, ended: 0, locked: false, writes: 0 };
  const copy = squad => squad && ({ ...squad, members: squad.members.map(member => ({ ...member })) });
  const equal = (a, b) => a instanceof Date || b instanceof Date ? new Date(a).getTime() === new Date(b).getTime() : (a ?? null) === (b ?? null);
  const matches = (squad, filter) => squad && Object.entries(filter).every(([key, expected]) =>
    key === 'members.userId' ? squad.members.some(member => member.userId === expected) :
      expected?.$in ? expected.$in.includes(squad[key]) : equal(squad[key], expected));
  const Squad = {
    find: async filter => matches(state.squad, filter) ? [copy(state.squad)] : [],
    findOne: async filter => matches(state.squad, filter) ? copy(state.squad) : null,
    updateOne: async (filter, update) => {
      assert.equal(state.locked, true);
      await state.beforeUpdate?.();
      if (!matches(state.squad, filter)) return { matchedCount: 0 };
      Object.assign(state.squad, update.$set);
      state.squad.__v += update.$inc?.__v || 0;
      state.writes++;
      return { matchedCount: 1 };
    },
  };
  const encounter = { encounterId: 'encounter', status: 'active', squadAId: 'squad', squadBId: 'other' };
  const matchmaking = {
    getEncounterById: async () => encounter,
    endEncounterAsymmetric: async ({ shouldEnd }) => {
      await state.beforeEnd?.();
      state.locked = true;
      try {
        if (!await shouldEnd({ encounter, disconnectingSquad: copy(state.squad) })) return false;
        state.ended++;
        return true;
      } finally { state.locked = false; }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer, process, setTimeout, setInterval, clearInterval,
    console: { log() {}, error() {} },
    require(id) {
      if (id === '../models/Squad') return { Squad };
      if (id === './matchmakingService') return matchmaking;
      if (id === './queueService') return queue;
      if (id === '../config/redisConfig') return { redis,
        withMatchmakingLock: async (routine, options) => {
          assert.equal(JSON.stringify(options.squadIds), '["squad"]');
          await state.beforeLease?.();
          state.locked = true;
          try { return await routine({ aborted: false }); }
          finally { state.locked = false; }
        },
      };
      return realRequire(id);
    },
  }, { filename });
  return { state, service: module.exports, observed: () => copy(state.squad) };
}

async function admit(redis, queuedAt = '1000', admissionId = 'old') {
  await redis.hset('squad_meta:squad', { squadId: 'squad', region: 'global', queuedAt, admissionId });
  await redis.zadd('matchmaking_queue:global', queuedAt, 'squad');
}
async function online(redis) {
  await redis.sadd('presence:user:user', 'replacement');
  await redis.set('presence:socket:replacement', 'user');
}

test('socket cleanup respects replacement searches and live call owners in real Redis', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-reconnect-'));
  const socket = path.join(directory, 'redis.sock');
  const child = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'], { stdio: 'ignore' });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  t.after(() => { child.kill(); fs.rmSync(directory, { recursive: true, force: true }); });
  for (let i = 0; i < 100 && !fs.existsSync(socket) && !spawnError; i++) await new Promise(resolve => setTimeout(resolve, 10));
  if (spawnError?.code === 'ENOENT') return t.skip('redis-server is not installed');
  assert.equal(spawnError, undefined);
  assert.ok(fs.existsSync(socket));
  const redis = new Redis(socket);
  t.after(() => redis.disconnect());

  await t.test('an offline search is conditionally stopped under its scoped lease', async () => {
    await redis.flushdb();
    await admit(redis);
    const h = harness(redis);
    assert.equal(await h.service.cancelAbandonedSearch(h.observed()), true);
    assert.equal(h.state.squad.status, 'idle');
    assert.equal(await redis.zscore('matchmaking_queue:global', 'squad'), null);
    assert.equal(await redis.exists('squad_meta:squad'), 0);
  });

  await t.test('a matched squad, newer search, or reconnect during lock wait is preserved', async () => {
    for (const change of [
      state => { state.squad.status = 'matched'; state.squad.currentEncounterId = 'new'; },
      state => { state.squad.searchQueuedAt = new Date(2000); },
      () => online(redis),
    ]) {
      await redis.flushdb();
      await admit(redis);
      const h = harness(redis);
      const observed = h.observed();
      h.state.beforeLease = () => change(h.state);
      assert.equal(await h.service.cancelAbandonedSearch(observed), false);
      assert.equal(h.state.writes, 0);
      assert.equal(await redis.zscore('matchmaking_queue:global', 'squad'), '1000');
    }
  });

  await t.test('a failed Mongo state comparison does not remove a queue admission', async () => {
    await redis.flushdb();
    await admit(redis);
    const h = harness(redis);
    h.state.beforeUpdate = () => { h.state.squad.status = 'matched'; };
    assert.equal(await h.service.cancelAbandonedSearch(h.observed()), false);
    assert.equal(await redis.zscore('matchmaking_queue:global', 'squad'), '1000');
  });

  await t.test('a replacement Redis admission after the snapshot cannot be deleted', async () => {
    for (const queuedAt of ['2000', '1000']) {
      await redis.flushdb();
      await admit(redis);
      const h = harness(redis);
      h.state.beforeUpdate = () => admit(redis, queuedAt, 'replacement');
      assert.equal(await h.service.cancelAbandonedSearch(h.observed()), true);
      assert.equal(await redis.zscore('matchmaking_queue:global', 'squad'), queuedAt);
      assert.equal(await redis.hget('squad_meta:squad', 'admissionId'), 'replacement');
    }
  });

  await t.test('an unchanged legacy admission is removed without a broad scan', async () => {
    await redis.flushdb();
    await admit(redis);
    await redis.hdel('squad_meta:squad', 'admissionId');
    const h = harness(redis);
    assert.equal(await h.service.cancelAbandonedSearch(h.observed()), true);
    assert.equal(h.state.squad.status, 'idle');
    assert.equal(await redis.zscore('matchmaking_queue:global', 'squad'), null);
    assert.equal(await redis.exists('squad_meta:squad'), 0);
  });

  await t.test('legacy cleanup preserves a replacement token or changed sorted-set score', async () => {
    for (const replacement of ['token', 'score']) {
      await redis.flushdb();
      await admit(redis);
      await redis.hdel('squad_meta:squad', 'admissionId');
      const h = harness(redis);
      h.state.beforeUpdate = () => replacement === 'token'
        ? admit(redis, '1000', 'replacement')
        : redis.zadd('matchmaking_queue:global', '2000', 'squad');
      assert.equal(await h.service.cancelAbandonedSearch(h.observed()), true);
      assert.equal(await redis.zscore('matchmaking_queue:global', 'squad'), replacement === 'token' ? '1000' : '2000');
      assert.equal(await redis.exists('squad_meta:squad'), 1);
    }
  });

  await t.test('queue admission returns its owner and delayed failure cleanup preserves a replacement', async () => {
    await redis.flushdb();
    const queue = loadQueue(redis);
    const owner = await queue.addToQueue('squad', 2);
    assert.equal((await queue.getQueueAdmission('squad')).admissionId, owner);
    assert.equal(await queue.removeFromQueue('squad', { admissionId: 'wrong-owner' }), false);
    assert.equal(await queue.removeIfAdmission('squad', { admissionId: owner }), true);

    const originalPipeline = redis.pipeline.bind(redis);
    redis.pipeline = (...args) => {
      const pipeline = originalPipeline(...args), exec = pipeline.exec.bind(pipeline);
      pipeline.exec = async () => {
        const results = await exec();
        await admit(redis, '2000', 'replacement');
        results[0] = [Error('delayed admission failure'), null];
        return results;
      };
      return pipeline;
    };
    try {
      await assert.rejects(queue.addToQueue('squad', 2), /delayed admission failure/);
    } finally { redis.pipeline = originalPipeline; }
    assert.equal((await queue.getQueueAdmission('squad')).admissionId, 'replacement');
    assert.equal(await redis.zscore('matchmaking_queue:global', 'squad'), '2000');
  });

  await t.test('video cleanup clears only an offline account without a replacement source', async () => {
    for (const replacement of ['none', 'socket', 'media']) {
      await redis.flushdb();
      const h = harness(redis);
      h.state.squad.status = 'in_encounter';
      h.state.squad.currentEncounterId = 'encounter';
      await redis.hset('squad_session:squad', 'member:inEncounterVideo', 'true', 'member:ready', 'true');
      if (replacement === 'socket') await online(redis);
      if (replacement === 'media') await redis.set('member_media:user', JSON.stringify({ socketId: 'replacement', generation: 'new' }));
      assert.equal(await h.service.clearEncounterVideoPresence('user'), replacement === 'none' ? 1 : 0);
      assert.equal(await redis.hget('squad_session:squad', 'member:inEncounterVideo'), replacement === 'none' ? 'false' : 'true');
      assert.equal(await redis.hget('squad_session:squad', 'member:ready'), 'true');
    }
  });

  await t.test('abandoned-call transition rechecks the live squad and online users inside its lease', async () => {
    for (const change of [null, () => online(redis), state => { state.squad.currentEncounterId = 'replacement'; }]) {
      await redis.flushdb();
      const h = harness(redis);
      h.state.squad.status = 'in_encounter';
      h.state.squad.currentEncounterId = 'encounter';
      h.state.beforeEnd = change && (() => change(h.state));
      assert.equal(await h.service.endAbandonedEncounters('user'), change ? 0 : 1);
      assert.equal(h.state.ended, change ? 0 : 1);
    }
  });
});
