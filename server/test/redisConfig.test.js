const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { getRedisOptions } = require("../src/config/redisOptions");

test("rediss URLs verify TLS certificates by default", () => {
  const originalRedisUrl = process.env.REDIS_URL;
  const originalRejectUnauthorized = process.env.REDIS_TLS_REJECT_UNAUTHORIZED;

  process.env.REDIS_URL = "rediss://redis.example.com:6379";
  delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED;

  try {
    const [, options] = getRedisOptions();

    assert.equal(options.tls.rejectUnauthorized, true);
  } finally {
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
    if (originalRejectUnauthorized === undefined) delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED;
    else process.env.REDIS_TLS_REJECT_UNAUTHORIZED = originalRejectUnauthorized;
  }
});

test("rediss TLS certificate verification can be disabled only explicitly", () => {
  const originalRedisUrl = process.env.REDIS_URL;
  const originalRejectUnauthorized = process.env.REDIS_TLS_REJECT_UNAUTHORIZED;

  process.env.REDIS_URL = "rediss://redis.example.com:6379";
  process.env.REDIS_TLS_REJECT_UNAUTHORIZED = "false";

  try {
    const [, options] = getRedisOptions();

    assert.equal(options.tls.rejectUnauthorized, false);
  } finally {
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
    if (originalRejectUnauthorized === undefined) delete process.env.REDIS_TLS_REJECT_UNAUTHORIZED;
    else process.env.REDIS_TLS_REJECT_UNAUTHORIZED = originalRejectUnauthorized;
  }
});

test("Redis TLS certificate override is documented as an exceptional deployment escape hatch", () => {
  const deploymentDoc = fs.readFileSync(
    path.join(__dirname, "../../DEPLOYMENT.md"),
    "utf8"
  );
  const envExample = fs.readFileSync(path.join(__dirname, "../.env.example"), "utf8");

  assert.match(deploymentDoc, /REDIS_TLS_REJECT_UNAUTHORIZED=false/);
  assert.match(deploymentDoc, /self-signed Redis TLS certificate/i);
  assert.match(envExample, /REDIS_TLS_REJECT_UNAUTHORIZED=false/);
  assert.match(envExample, /Only set this for self-signed Redis TLS certificates/i);
});
