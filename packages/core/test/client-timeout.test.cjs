const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");

function loadClient(fetch) {
  const source = fs.readFileSync(path.join(__dirname, "../src/client.ts"), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, AbortController, fetch, setTimeout, clearTimeout,
    require: name => {
      assert.equal(name, "./config");
      return { BACKEND_URL: "http://localhost:1" };
    },
  });
  return module.exports;
}

test("request deadline covers a body stalled after successful headers", async () => {
  let release;
  const client = loadClient(async (_url, { signal }) => ({
    ok: true, status: 200,
    json: () => new Promise((resolve, reject) => {
      release = () => resolve({ ok: true, data: "too late" });
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
  }));
  const pending = client.backendRequest("/slow-body", { timeoutMs: 20 });
  const fallback = setTimeout(() => release?.(), 200);
  try {
    await assert.rejects(pending, error => error instanceof client.ApiError
      && error.code === "network_error" && error.status === 0 && /timed out/.test(error.message));
  } finally {
    clearTimeout(fallback);
    release?.();
  }
});

test("request deadline covers headers and preserves normal error envelopes", async () => {
  const timeout = loadClient((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  await assert.rejects(timeout.backendRequest("/slow-headers", { timeoutMs: 20 }), /timed out/);
  const denied = loadClient(async () => ({ ok: false, status: 403,
    json: async () => ({ ok: false, error: { code: "adult_required", message: "Confirm your age." } }),
  }));
  await assert.rejects(denied.backendRequest("/protected"), error =>
    error.code === "adult_required" && error.status === 403 && error.message === "Confirm your age.");
});

test("ordinary body consumption preserves data and non-JSON HTTP handling", async () => {
  const success = loadClient(async () => ({ ok: true, status: 200,
    json: async () => ({ ok: true, data: { state: "ready" } }),
  }));
  assert.equal((await success.backendRequest("/ready")).state, "ready");
  const nonJson = loadClient(async () => ({ ok: false, status: 502,
    json: async () => { throw new SyntaxError("Upstream returned HTML"); },
  }));
  await assert.rejects(nonJson.backendRequest("/upstream"), error =>
    error.code === "http_error" && error.status === 502);
});
