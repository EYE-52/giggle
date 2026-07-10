const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("resolveBackendUrl uses the local backend by default", async () => {
  const { resolveBackendUrl } = await import("../src/config.ts");

  assert.equal(resolveBackendUrl(undefined, "localhost"), "http://localhost:3001");
});

test("resolveBackendUrl rejects missing backend URL in production", async () => {
  const { resolveBackendUrl } = await import("../src/config.ts");

  assert.throws(
    () => resolveBackendUrl(undefined, "gigglemeet.com", "production"),
    /NEXT_PUBLIC_BACKEND_URL or EXPO_PUBLIC_BACKEND_URL is required in production/
  );
});

test("resolveBackendUrl rewrites LAN backend to localhost for loopback web", async () => {
  const { resolveBackendUrl } = await import("../src/config.ts");

  assert.equal(resolveBackendUrl("http://192.168.1.20:3001", "localhost"), "http://localhost:3001");
});

test("resolveBackendUrl preserves LAN backend for native or non-loopback clients", async () => {
  const { resolveBackendUrl } = await import("../src/config.ts");

  assert.equal(resolveBackendUrl("http://192.168.1.20:3001", "192.168.1.44"), "http://192.168.1.20:3001");
});

test("resolveBackendUrl trims trailing slashes", async () => {
  const { resolveBackendUrl } = await import("../src/config.ts");

  assert.equal(resolveBackendUrl("https://api.gigglemeet.com///", "gigglemeet.com"), "https://api.gigglemeet.com");
});

test("core public API does not export demo fixtures", () => {
  const entrypoint = readFileSync(path.join(__dirname, "../src/index.ts"), "utf8");

  assert.equal(entrypoint.includes("mockSquad"), false);
  assert.equal(entrypoint.includes("mockOpponent"), false);
  assert.equal(entrypoint.includes("mockProfile"), false);
  assert.equal(entrypoint.includes("./fixtures"), false);
});
