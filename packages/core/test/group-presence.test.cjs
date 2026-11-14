const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  ts = require("typescript");
const flush = () => new Promise((r) => setImmediate(r));
function fixture({ holdBegin = false } = {}) {
  const handlers = new Map(),
    timers = [],
    sent = [],
    pending = [];
  let generation = 0;
  const socket = {
    connected: true,
    active: true,
    on(event, fn) {
      handlers.set(event, fn);
    },
    off(event, fn) {
      if (handlers.get(event) === fn) handlers.delete(event);
    },
    emit() {},
    timeout() {
      return {
        emit(event, input, ack) {
          sent.push({ event, input });
          if (input.action === "begin" && holdBegin)
            pending.push(() =>
              ack(null, { ok: true, generation: "lease-" + ++generation }),
            );
          else
            ack(null, {
              ok: true,
              generation: input.generation || "lease-" + ++generation,
            });
        },
      };
    },
  };
  const document = {
      visibilityState: "hidden",
      addEventListener() {},
      removeEventListener() {},
    },
    module = { exports: {} };
  const js = ts.transpileModule(
    fs.readFileSync(path.join(__dirname, "../src/socket.ts"), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  new Function(
    "require",
    "module",
    "exports",
    "setInterval",
    "clearInterval",
    "document",
    js,
  )(
    (name) =>
      name === "socket.io-client"
        ? { io: () => socket }
        : name === "./config"
          ? { BACKEND_URL: "http://localhost" }
          : name === "./client"
            ? { getAuthToken: () => null }
            : {},
    module,
    module.exports,
    (fn, ms) => {
      const timer = { fn, ms, closed: false };
      timers.push(timer);
      return timer;
    },
    (timer) => {
      timer.closed = true;
    },
    document,
  );
  module.exports.setAdultAccessGetter(() => true);
  return { api: module.exports, sent, timers, pending, handlers };
}
test("an actively mounted background call renews its own90second group lease every25seconds", async () => {
  const f = fixture(),
    stop = f.api.activateGroupPresence("current");
  await flush();
  assert.equal(f.sent[0].input.action, "begin");
  assert.equal(f.timers[0].ms, 25000);
  f.timers[0].fn();
  await flush();
  assert.equal(f.sent[1].input.action, "update");
  assert.equal(f.sent[1].input.generation, "lease-1");
  assert(f.sent.every((row) => row.input.squadId === "current"));
  stop();
  await flush();
  assert.equal(f.sent.at(-1).input.action, "end");
  assert.equal(f.timers[0].closed, true);
  f.timers[0].fn();
  await flush();
  assert.equal(f.sent.at(-1).input.action, "end");
});
test("late start cleanup captures the retired tab lease instead of ending its replacement", async () => {
  const f = fixture({ holdBegin: true }),
    first = f.api.activateGroupPresence("first");
  await flush();
  first();
  const second = f.api.activateGroupPresence("second");
  await flush();
  assert.equal(f.pending.length, 2);
  f.pending[1]();
  await flush();
  f.pending[0]();
  await flush();
  const end = f.sent.find((row) => row.input.action === "end");
  assert.equal(end.input.squadId, "first");
  assert.equal(end.input.generation, "lease-2");
  second();
  await flush();
  assert.equal(f.sent.at(-1).input.squadId, "second");
  assert.equal(f.sent.at(-1).input.generation, "lease-1");
});


test("a late presence acknowledgement cannot reuse the old connection after reconnect", async () => {
  const f = fixture({ holdBegin: true });
  const stop = f.api.activateGroupPresence("current");
  await flush();
  f.handlers.get("connect")();
  f.pending[0]();
  await flush();
  assert.deepEqual(f.sent.map(row => row.input.action), ["begin", "begin"],
    "reconnect must obtain a new lease immediately, not update the old one");
  f.pending[1]();
  await flush();
  f.timers[0].fn();
  await flush();
  assert.equal(f.sent.at(-1).input.generation, "lease-2");
  stop();
  await flush();
  assert.equal(f.sent.at(-1).input.action, "end");
  assert.equal(f.sent.at(-1).input.generation, "lease-2");
});
