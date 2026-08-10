const assert = require("node:assert/strict");
const test = require("node:test");

test("queue admission sends metadata and sorted-set writes in one pipeline", async (t) => {
  const commands = [];
  let pipelineError = null;
  const pipeline = {
    hset: (...args) => { commands.push(["hset", ...args]); return pipeline; },
    zadd: (...args) => { commands.push(["zadd", ...args]); return pipeline; },
    exec: async () => {
      commands.push(["exec"]);
      return pipelineError ? [[pipelineError, null], [null, 1]] : [[null, 1], [null, 1]];
    },
  };
  const redis = {
    pipeline: () => pipeline,
    zrem: async (...args) => { commands.push(["zrem", ...args]); },
    del: async (...args) => { commands.push(["del", ...args]); },
  };
  const redisPath = require.resolve("../src/config/redisConfig");
  const servicePath = require.resolve("../src/services/queueService");
  const previousRedis = require.cache[redisPath];
  const previousService = require.cache[servicePath];
  const originalNow = Date.now;
  require.cache[redisPath] = { exports: { redis } };
  delete require.cache[servicePath];
  Date.now = () => 1234;
  t.after(() => {
    Date.now = originalNow;
    if (previousRedis) require.cache[redisPath] = previousRedis;
    else delete require.cache[redisPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });

  const queueService = require(servicePath);
  await queueService.addToQueue("squad-a", 3, "global", ["music"], 90);

  assert.deepEqual(commands, [
    ["hset", "squad_meta:squad-a", {
      squadId: "squad-a",
      size: 3,
      region: "global",
      tags: "music",
      reputationScore: 90,
      queuedAt: 1234,
    }],
    ["zadd", "matchmaking_queue:global", 1234, "squad-a"],
    ["exec"],
  ]);

  pipelineError = new Error("Redis queue write failed");
  await assert.rejects(
    queueService.addToQueue("squad-b", 2, "global"),
    /Redis queue write failed/
  );
  assert.deepEqual(commands.slice(-2), [
    ["zrem", "matchmaking_queue:global", "squad-b"],
    ["del", "squad_meta:squad-b"],
  ]);
});
