const assert = require("node:assert/strict");
const test = require("node:test");

const { buildAllowedOrigins } = require("../src/config/corsOrigins");

test("local development origins include desktop and Expo web ports", () => {
  const origins = buildAllowedOrigins("");

  assert.ok(origins.includes("http://localhost:4000"));
  assert.ok(origins.includes("http://localhost:4011"));
  assert.ok(origins.includes("http://127.0.0.1:4011"));
});

test("configured frontend origins are trimmed, deduped, and slash-normalized", () => {
  const origins = buildAllowedOrigins(" https://app.example.com/, http://localhost:4011 ");

  assert.equal(origins.filter((origin) => origin === "http://localhost:4011").length, 1);
  assert.ok(origins.includes("https://app.example.com"));
});

test("production origins include only configured frontend origins", () => {
  const origins = buildAllowedOrigins(" https://app.example.com/, https://www.example.com/ ", {
    nodeEnv: "production",
  });

  assert.deepEqual(origins, ["https://app.example.com", "https://www.example.com"]);
  assert.equal(origins.includes("http://localhost:4000"), false);
});
