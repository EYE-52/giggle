const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CHAT_DEDUP_TTL_SECONDS,
  buildChatDedupKey,
  claimOrGetChatMessage,
} = require('../src/services/chatDeliveryService');

const fakeRedis = () => {
  const values = new Map();
  const calls = [];
  return {
    calls,
    async set(key, value, ...args) {
      calls.push(['set', key, value, ...args]);
      if (values.has(key)) return null;
      values.set(key, value);
      return 'OK';
    },
    async get(key) {
      calls.push(['get', key]);
      return values.get(key) || null;
    },
    expire(key) {
      values.delete(key);
    },
  };
};

const message = (id, text = 'hello') => ({
  id,
  text,
  senderId: 'user-a',
  clientMessageId: 'client-1',
});

test('claims once and returns the same message from a fresh service instance', async () => {
  const redis = fakeRedis();
  const first = await claimOrGetChatMessage({
    senderId: 'user-a', room: 'squad_sq-a', clientMessageId: 'client-1', message: message('first'), redis,
  });
  const retry = await claimOrGetChatMessage({
    senderId: 'user-a', room: 'squad_sq-a', clientMessageId: 'client-1', message: message('second'), redis,
  });

  assert.equal(first.claimed, true);
  assert.deepEqual(retry, { claimed: false, message: message('first') });
  assert.equal(redis.calls.filter(([command]) => command === 'set').length, 2);
  assert.equal(redis.calls[0][3], 'EX');
  assert.equal(redis.calls[0][4], CHAT_DEDUP_TTL_SECONDS);
  assert.equal(redis.calls[0][5], 'NX');
});

test('atomic claim allows only one winner under concurrent retries', async () => {
  const redis = fakeRedis();
  const results = await Promise.all([
    claimOrGetChatMessage({ senderId: 'user-a', room: 'room-a', clientMessageId: 'same', message: message('one'), redis }),
    claimOrGetChatMessage({ senderId: 'user-a', room: 'room-a', clientMessageId: 'same', message: message('two'), redis }),
  ]);

  assert.equal(results.filter((result) => result.claimed).length, 1);
  assert.deepEqual(results[0].message, results[1].message);
});

test('sender and room are part of the dedupe scope', async () => {
  const redis = fakeRedis();
  const first = await claimOrGetChatMessage({ senderId: 'user-a', room: 'room-a', clientMessageId: 'same', message: message('a'), redis });
  const otherUser = await claimOrGetChatMessage({ senderId: 'user-b', room: 'room-a', clientMessageId: 'same', message: message('b'), redis });
  const otherRoom = await claimOrGetChatMessage({ senderId: 'user-a', room: 'room-b', clientMessageId: 'same', message: message('c'), redis });

  assert.equal(first.claimed, true);
  assert.equal(otherUser.claimed, true);
  assert.equal(otherRoom.claimed, true);
  assert.notEqual(buildChatDedupKey({ senderId: 'user-a', room: 'room-a', clientMessageId: 'same' }), buildChatDedupKey({ senderId: 'user-b', room: 'room-a', clientMessageId: 'same' }));
});

test('redis errors are surfaced instead of using a local fallback', async () => {
  const redis = { set: async () => { throw new Error('redis down'); }, get: async () => null };
  await assert.rejects(
    claimOrGetChatMessage({ senderId: 'user-a', room: 'room-a', clientMessageId: 'same', message: message('a'), redis }),
    /redis down/
  );
});

test('a missing value after a lost claim is retryable', async () => {
  const redis = { set: async () => null, get: async () => null };
  await assert.rejects(
    claimOrGetChatMessage({ senderId: 'user-a', room: 'room-a', clientMessageId: 'same', message: message('a'), redis }),
    (error) => error.code === 'CHAT_DEDUP_UNAVAILABLE'
  );
});
