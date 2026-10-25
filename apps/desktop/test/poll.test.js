const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function fixture(fn) {
  let timer, listener, cleared = false;
  const errors = [];
  const document = {
    hidden: false,
    addEventListener(type, callback) { assert.equal(type, "visibilitychange"); listener = callback; },
    removeEventListener(type, callback) { assert.equal(type, "visibilitychange"); assert.equal(listener, callback); listener = null; },
  };
  const source = readFileSync(path.join(__dirname, "../lib/poll.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", "document", "setInterval", "clearInterval", "console", js)(module, module.exports, document,
    callback => { timer = callback; return 1; }, id => { assert.equal(id, 1); cleared = true; }, { error: (...args) => errors.push(args) });
  const stop = module.exports.pollWhileVisible(fn, 1000);
  return { tick: () => timer(), visible: () => listener?.(), document, stop, errors, cleaned: () => cleared && listener === null };
}

test("visible polling never overlaps slow refreshes and stops queued ticks after cleanup", async () => {
  let calls = 0, finish;
  const f = fixture(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  f.document.hidden = true;
  await f.tick(); await f.visible();
  assert.equal(calls, 0);
  f.document.hidden = false;
  const pending = f.visible();
  await f.tick(); await f.visible();
  assert.equal(calls, 1, "interval and visibility events share one in-flight guard");
  finish(); await pending;
  const next = f.tick();
  assert.equal(calls, 2, "polling resumes after settlement");
  f.stop();
  finish(); await next; await f.tick();
  assert.equal(calls, 2);
  assert.equal(f.cleaned(), true);
  assert.deepEqual(f.errors, []);
});

test("rejections and synchronous throws stay observable and release the polling guard", async () => {
  let calls = 0;
  const rejection = new Error("temporary outage");
  const syncFailure = new Error("unexpected refresh failure");
  const f = fixture(() => {
    calls++;
    if (calls === 1) return Promise.reject(rejection);
    if (calls === 2) throw syncFailure;
  });
  await f.tick(); await f.visible(); await f.tick();
  assert.equal(calls, 3);
  assert.deepEqual(f.errors, [["Visible poll failed:", rejection], ["Visible poll failed:", syncFailure]]);
  f.stop();
});
