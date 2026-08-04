const assert = require("node:assert/strict");
const test = require("node:test");

test("concurrent member session updates preserve sibling fields", async (t) => {
  const state = {};
  const pipelines = [];
  let pipelineError = null;
  const redis = {
    pipeline: () => {
      const commands = [];
      const pipeline = {
        hset: (key, field, value) => {
          commands.push(["hset", key, field, value]);
          return pipeline;
        },
        expire: (key, seconds) => {
          commands.push(["expire", key, seconds]);
          return pipeline;
        },
        exec: async () => {
          if (pipelineError) return [[pipelineError, null], [null, 1]];
          for (const [command, , field, value] of commands) {
            if (command === "hset") state[field] = value;
          }
          return commands.map(() => [null, 1]);
        },
      };
      pipelines.push(commands);
      return pipeline;
    },
    hgetall: async () => state,
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
  assert.deepEqual(pipelines.map((commands) => commands.map(([command]) => command)), [
    ["hset", "expire"],
    ["hset", "expire"],
  ]);

  pipelineError = new Error("Redis write failed");
  await assert.rejects(
    sessionService.setSessionField("squad-a", "member-a", "ready", false),
    /Redis write failed/
  );
});
