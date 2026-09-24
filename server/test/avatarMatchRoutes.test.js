const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");
const jwt = require("jsonwebtoken");
const { after, before, test } = require("node:test");

const User = require("../src/models/User");
const avatarMatchRoutes = require("../src/routes/avatarMatchRoutes");
const avatarMatchService = require("../src/services/avatarMatchService");

const USER_ID = "507f1f77bcf86cd799439011";
const TEST_JWT_SECRET = "avatar-match-route-test-secret";

// The route tests stub the account lookup behind requireApiAuth; nothing here
// touches Mongo, Redis or the network.
const originalFindById = User.findById;
const originalEnv = {
  JWT_SECRET: process.env.JWT_SECRET,
  SELFIE_MATCHING_ENABLED: process.env.SELFIE_MATCHING_ENABLED,
  AVATAR_MATCH_API_KEY: process.env.AVATAR_MATCH_API_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
};
const originalService = {
  suggestAvatar: avatarMatchService.suggestAvatar,
  getSuggestStatus: avatarMatchService.getSuggestStatus,
};

before(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  // requireApiAuth chains findById().select().lean() synchronously.
  User.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: USER_ID,
        ageConfirmed: true,
        isAdult: true,
        ageVerified: true,
        isSuspended: false,
        isShadowBanned: false,
        deletionStatus: null,
      }),
    }),
  });
});

after(() => {
  User.findById = originalFindById;
  avatarMatchService.suggestAvatar = originalService.suggestAvatar;
  avatarMatchService.getSuggestStatus = originalService.getSuggestStatus;
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "3mb" }));
  app.use("/api", avatarMatchRoutes);
  return app;
}

async function fetchFromApp(app, requestPath, init) {
  const testServer = http.createServer(app);
  await new Promise((resolve, reject) => {
    testServer.once("error", reject);
    testServer.listen(0, "127.0.0.1", resolve);
  });
  const { port } = testServer.address();
  try {
    return await fetch(`http://127.0.0.1:${port}${requestPath}`, init);
  } finally {
    await new Promise((resolve, reject) => {
      testServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

const authedInit = (payload, body) => ({
  method: "POST",
  headers: {
    Authorization: `Bearer ${jwt.sign({ userId: USER_ID }, TEST_JWT_SECRET)}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body ?? {}),
  ...payload,
});

const withFlagOff = (run) => async () => {
  delete process.env.SELFIE_MATCHING_ENABLED;
  try {
    await run();
  } finally {
    if (originalEnv.SELFIE_MATCHING_ENABLED === undefined) delete process.env.SELFIE_MATCHING_ENABLED;
    else process.env.SELFIE_MATCHING_ENABLED = originalEnv.SELFIE_MATCHING_ENABLED;
  }
};

test("both avatar suggest routes require a bearer token", async () => {
  const app = buildApp();
  const post = await fetchFromApp(app, "/api/me/avatar/suggest", { method: "POST" });
  assert.equal(post.status, 401);
  assert.equal((await post.json()).error.code, "UNAUTHORIZED");
  const status = await fetchFromApp(app, "/api/me/avatar/suggest/status");
  assert.equal(status.status, 401);
  assert.equal((await status.json()).error.code, "UNAUTHORIZED");
});

test(
  "flag off: POST returns 404 FEATURE_DISABLED and status reports enabled:false",
  withFlagOff(async () => {
    const app = buildApp();
    const post = await fetchFromApp(app, "/api/me/avatar/suggest", authedInit());
    assert.equal(post.status, 404);
    const postBody = await post.json();
    assert.equal(postBody.ok, false);
    assert.equal(postBody.error.code, "FEATURE_DISABLED");

    const status = await fetchFromApp(app, "/api/me/avatar/suggest/status", {
      headers: { Authorization: `Bearer ${jwt.sign({ userId: USER_ID }, TEST_JWT_SECRET)}` },
    });
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), {
      ok: true,
      enabled: false,
      remainingToday: null,
      remainingMonth: null,
    });
  })
);

test(
  "missing provider key keeps the feature disabled even with the flag on",
  withFlagOff(async () => {
    process.env.SELFIE_MATCHING_ENABLED = "true";
    delete process.env.AVATAR_MATCH_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    const app = buildApp();
    const post = await fetchFromApp(app, "/api/me/avatar/suggest", authedInit());
    assert.equal(post.status, 404);
    assert.equal((await post.json()).error.code, "FEATURE_DISABLED");
    const status = await fetchFromApp(app, "/api/me/avatar/suggest/status", {
      headers: { Authorization: `Bearer ${jwt.sign({ userId: USER_ID }, TEST_JWT_SECRET)}` },
    });
    assert.equal((await status.json()).enabled, false);
  })
);

test("authenticated happy path relays the service envelope and payload", async () => {
  process.env.SELFIE_MATCHING_ENABLED = "true";
  let captured = null;
  avatarMatchService.suggestAvatar = async ({ userId, body }) => {
    captured = { userId, body };
    return {
      httpStatus: 200,
      body: {
        ok: true,
        status: "match",
        configs: [{ hair: "long" }, { hair: "long" }, { hair: "long" }],
        model: "qwen/qwen3.7-flash",
        promptVersion: "match-v2",
      },
    };
  };
  try {
    const app = buildApp();
    const request = {
      requestId: "9f1c3ab2-7d34-4c15-9e8f-a1b2c3d4e5f6",
      image: "data:image/jpeg;base64,AAAA",
      base: { hair: "bob" },
    };
    const response = await fetchFromApp(app, "/api/me/avatar/suggest", authedInit(null, request));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.status, "match");
    assert.equal(payload.configs.length, 3);
    assert.equal(payload.promptVersion, "match-v2");
    assert.equal(captured.userId, USER_ID);
    assert.deepEqual(captured.body, request);
  } finally {
    avatarMatchService.suggestAvatar = originalService.suggestAvatar;
    if (originalEnv.SELFIE_MATCHING_ENABLED === undefined) delete process.env.SELFIE_MATCHING_ENABLED;
    else process.env.SELFIE_MATCHING_ENABLED = originalEnv.SELFIE_MATCHING_ENABLED;
  }
});

test("service error results map to their HTTP status, headers included", async () => {
  avatarMatchService.suggestAvatar = async () => ({
    httpStatus: 409,
    body: { ok: false, error: { code: "IN_PROGRESS", message: "A match request is already running" } },
  });
  try {
    const app = buildApp();
    const conflict = await fetchFromApp(app, "/api/me/avatar/suggest", authedInit());
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error.code, "IN_PROGRESS");

    avatarMatchService.suggestAvatar = async () => ({
      httpStatus: 429,
      headers: { "Retry-After": "60" },
      body: {
        ok: false,
        error: { code: "RATE_LIMITED", message: "slow down", retryAfterSeconds: 60 },
      },
    });
    const limited = await fetchFromApp(app, "/api/me/avatar/suggest", authedInit());
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.equal((await limited.json()).error.retryAfterSeconds, 60);
  } finally {
    avatarMatchService.suggestAvatar = originalService.suggestAvatar;
  }
});

test("GET on the suggest endpoint is not routed as a match request", async () => {
  const app = buildApp();
  const response = await fetchFromApp(app, "/api/me/avatar/suggest", {
    headers: { Authorization: `Bearer ${jwt.sign({ userId: USER_ID }, TEST_JWT_SECRET)}` },
  });
  assert.equal(response.status, 404);
});
