const assert = require("node:assert/strict");
const test = require("node:test");

test("queue admission sends metadata and sorted-set writes in one pipeline", async (t) => {
  const commands = [];
  let pipelineError = null;
  const pipeline = {
    hset: (...args) => { commands.push(["hset", ...args]); return pipeline; },
    zadd: (...args) => { commands.push(["zadd", ...args]); return pipeline; },
    del: (...args) => { commands.push(["del", ...args]); return pipeline; },
    exec: async () => {
      commands.push(["exec"]);
      return pipelineError ? [[pipelineError, null], [null, 1]] : [[null, 1], [null, 1]];
    },
  };
  const redis = {
    pipeline: () => pipeline,
    zrem: async (...args) => { commands.push(["zrem", ...args]); },
    del: async (...args) => { commands.push(["del", ...args]); },
    eval: async (...args) => { commands.push(["eval", ...args]); return 1; },
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

  const firstAdmissionId = commands[0][2].admissionId;
  assert.match(firstAdmissionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(commands, [
    ["hset", "squad_meta:squad-a", {
      squadId: "squad-a",
      size: 3,
      region: "global",
      tags: "music",
      reputationScore: 90,
      queuedAt: 1234,
      admissionId: firstAdmissionId,
    }],
    ["zadd", "matchmaking_queue:global", 1234, "squad-a"],
    ["zadd", "matchmaking_regions", 0, "global"],
    ["del", "matchmaking_cursor:squad-a"],
    ["exec"],
  ]);

  commands.length = 0;
  await queueService.addToQueue("squad-a", 3, "global", ["music"], 90);
  assert.notEqual(commands[0][2].admissionId, firstAdmissionId, "same-millisecond admissions have distinct owners");

  pipelineError = new Error("Redis queue write failed");
  await assert.rejects(
    queueService.addToQueue("squad-b", 2, "global"),
    /Redis queue write failed/
  );
  const cleanup = commands.at(-1);
  assert.equal(cleanup[0], "eval");
  assert.deepEqual(cleanup.slice(2, 6), [2, "squad_meta:squad-b", "matchmaking_cursor:squad-b", "squad-b"]);
  assert.match(cleanup[6], /^[0-9a-f-]{36}$/);
  assert.equal(cleanup[7], "matchmaking_queue:");
});
