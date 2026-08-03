const assert = require("node:assert/strict");
const test = require("node:test");

test("concurrent member session updates preserve sibling fields", async (t) => {
  const state = {};
  let reads = 0;
  let releaseReads;
  const bothReadsStarted = new Promise((resolve) => { releaseReads = resolve; });
  const redis = {
    hget: async (_key, field) => {
      reads += 1;
      if (reads === 2) releaseReads();
      await bothReadsStarted;
      return state[field];
    },
    hset: async (_key, field, value) => { state[field] = value; },
    hgetall: async () => state,
    expire: async () => {},
  };

  const redisPath = require.resolve("../src/config/redisConfig");
  const servicePath = require.resolve("../src/services/sessionService");
  const previousRedis = require.cache[redisPath];
  const previousService = require.cache[servicePath];
  require.cache[redisPath] = { exports: { redis } };
  delete require.cache[servicePath];
  t.after(() => {
    if (previousRedis) require.cache[redisPath] = previousRedis;
    else delete require.cache[redisPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });

  const sessionService = require(servicePath);
  await Promise.all([
    sessionService.setSessionField("squad-a", "member-a", "ready", true),
    sessionService.setSessionField("squad-a", "member-a", "inLobbyVideo", true),
  ]);

  assert.deepEqual(await sessionService.getSquadSession("squad-a"), {
    "member-a": { ready: true, inLobbyVideo: true },
  });
});
