const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { consumeMagicLinkId, emailStart, verifyAppleIdToken } = require("../src/controllers/oauthController");

test("Apple token exchange errors do not log provider token payloads", () => {
  const controller = readFileSync(path.join(__dirname, "../src/controllers/oauthController.js"), "utf8");

  assert.equal(controller.includes('console.error("Apple token exchange failed:", data);'), false);
  assert.equal(controller.includes("sanitizeAppleTokenError"), true);
  assert.equal(controller.includes("id_token"), true);
  assert.equal(controller.includes("hasIdToken"), true);
});

test("verifyAppleIdToken verifies Apple issuer and configured audience", async () => {
  const originalServiceId = process.env.APPLE_SERVICE_ID;
  process.env.APPLE_SERVICE_ID = "com.giggle.web";

  try {
    let receivedOptions;
    const payload = await verifyAppleIdToken("id-token", "nonce-123", {
      jwks: "jwks",
      jwtVerifyImpl: async (_token, _jwks, options) => {
        receivedOptions = options;
        return {
          payload: {
            email: "person@example.com",
            nonce: "nonce-123",
          },
        };
      },
    });

    assert.deepEqual(receivedOptions, {
      issuer: "https://appleid.apple.com",
      audience: "com.giggle.web",
    });
    assert.equal(payload.email, "person@example.com");
  } finally {
    if (originalServiceId === undefined) delete process.env.APPLE_SERVICE_ID;
    else process.env.APPLE_SERVICE_ID = originalServiceId;
  }
});

test("verifyAppleIdToken rejects Apple tokens with the wrong nonce", async () => {
  const originalServiceId = process.env.APPLE_SERVICE_ID;
  process.env.APPLE_SERVICE_ID = "com.giggle.web";

  try {
    await assert.rejects(
      () => verifyAppleIdToken("id-token", "expected-nonce", {
        jwks: "jwks",
        jwtVerifyImpl: async () => ({
          payload: {
            email: "person@example.com",
            nonce: "attacker-nonce",
          },
        }),
      }),
      /APPLE_BAD_NONCE/
    );
  } finally {
    if (originalServiceId === undefined) delete process.env.APPLE_SERVICE_ID;
    else process.env.APPLE_SERVICE_ID = originalServiceId;
  }
});

test("emailStart never logs magic links in production when email delivery is missing", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalResendApiKey = process.env.RESEND_API_KEY;
  const originalLog = console.log;
  const logs = [];
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  process.env.NODE_ENV = "production";
  process.env.JWT_SECRET = "test-secret";
  delete process.env.RESEND_API_KEY;
  console.log = (...args) => logs.push(args.join(" "));

  try {
    await emailStart({ body: { email: "person@example.com" } }, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.code, "EMAIL_NOT_CONFIGURED");
    assert.equal(logs.length, 0);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalResendApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResendApiKey;
    console.log = originalLog;
  }
});

test("emailStart rejects malformed identities before minting magic links", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalLog = console.log;
  const logs = [];
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  process.env.NODE_ENV = "development";
  process.env.JWT_SECRET = "test-secret";
  console.log = (...args) => logs.push(args.join(" "));

  try {
    await emailStart({ body: { email: "person@localhost" } }, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.code, "INVALID_REQUEST");
    assert.equal(logs.length, 0);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    console.log = originalLog;
  }
});

test("magic link ids are single-use within their ttl", async () => {
  const calls = [];
  const redis = {
    async set(...args) {
      calls.push(args);
      return calls.length === 1 ? "OK" : null;
    },
  };

  assert.equal(await consumeMagicLinkId("link-123", redis), true);
  assert.equal(await consumeMagicLinkId("link-123", redis), false);
  assert.deepEqual(calls[0], ["magic:used:link-123", "1", "EX", 15 * 60, "NX"]);
});

test("missing magic link ids fail closed", async () => {
  const redis = {
    async set() {
      throw new Error("should not touch redis");
    },
  };

  assert.equal(await consumeMagicLinkId("", redis), false);
  assert.equal(await consumeMagicLinkId(null, redis), false);
});

test("email magic links carry and consume a unique jwt id", () => {
  const controller = readFileSync(path.join(__dirname, "../src/controllers/oauthController.js"), "utf8");

  assert.equal(controller.includes("jwtid:"), true);
  assert.equal(controller.includes("consumeMagicLinkId(payload.jti)"), true);
});

test("Apple callback form parser uses explicit safe limits", () => {
  const routes = readFileSync(path.join(__dirname, "../src/routes/authRoutes.js"), "utf8");

  assert.equal(routes.includes('express.urlencoded({ extended: true })'), false);
  assert.equal(routes.includes('limit: "16kb"'), true);
  assert.equal(routes.includes("parameterLimit: 8"), true);
  assert.equal(routes.includes("extended: false"), true);
});
