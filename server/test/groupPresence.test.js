const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { spawn } = require("node:child_process"),
  Redis = require("ioredis");
const presence = require("../src/services/groupPresenceService");
test("real Redis group presence counts current principals once, expires, and rejects stale tab cleanup", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "giggle-group-presence-")),
    socket = path.join(dir, "redis.sock");
  const server = spawn(
    "redis-server",
    ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "no"],
    { stdio: "ignore" },
  );
  let error;
  server.on("error", (e) => (error = e));
  t.after(() => {
    server.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (let i = 0; i < 100 && !fs.existsSync(socket) && !error; i++)
    await new Promise((r) => setTimeout(r, 10));
  if (error?.code === "ENOENT") return t.skip("redis-server is not installed");
  assert.equal(error, undefined);
  const redis = new Redis(socket);
  t.after(() => redis.disconnect());
  const first = await presence.begin("room", "a", "tab1", redis, 1000),
    otherTab = await presence.begin("room", "a", "tab2", redis, 1000);
  await presence.begin("room", "b", "tab3", redis, 1000);
  assert.deepEqual(
    [
      ...(await presence.onlineUserIds("room", ["a", "b", "c"], redis, 1001)),
    ].sort(),
    ["a", "b"],
  );
  assert.equal(
    (await presence.onlineUserIds("other", ["a", "b"], redis, 1001)).size,
    0,
  );
  const replacement = await presence.begin("room", "a", "tab1", redis, 2000);
  assert.equal(await presence.end("room", "a", "tab1", first, redis), false);
  assert.equal(
    await presence.update("room", "a", "tab1", first, redis, 3000),
    false,
  );
  assert.equal(await presence.end("room", "a", "tab2", otherTab, redis), true);
  assert.deepEqual(
    [...(await presence.onlineUserIds("room", ["a"], redis, 2001))],
    ["a"],
  );
  assert.equal(
    (await presence.onlineUserIds("room", ["a", "b"], redis, 92000)).size,
    0,
  );
  assert.equal(
    await presence.update("room", "a", "tab1", replacement, redis, 93000),
    true,
  );
  assert.deepEqual(
    [...(await presence.onlineUserIds("room", ["a", "b"], redis, 93001))],
    ["a"],
  );
  assert.equal(
    await presence.end("room", "a", "tab1", replacement, redis),
    true,
  );
  assert.equal(
    (await presence.onlineUserIds("room", ["a", "b"], redis, 93002)).size,
    0,
  );
});
