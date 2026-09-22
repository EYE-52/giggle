const assert = require("node:assert/strict");
const test = require("node:test");

const { exchangeAuth, EXCHANGE_SECRET_HEADER } = require("../src/controllers/authController");
const User = require("../src/models/User");

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("production auth exchange rejects untrusted callers before touching user data", async () => {
  const originals = {
    NODE_ENV: process.env.NODE_ENV,
    AUTH_EXCHANGE_SECRET: process.env.AUTH_EXCHANGE_SECRET,
  };

  process.env.NODE_ENV = "production";
  process.env.AUTH_EXCHANGE_SECRET = "server-secret";

  try {
    const req = {
      body: { email: "person@example.com", name: "Person" },
      get: (header) => (header === EXCHANGE_SECRET_HEADER ? "wrong-secret" : undefined),
    };
    const res = createMockResponse();

    await exchangeAuth(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.code, "AUTH_EXCHANGE_FORBIDDEN");
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("auth exchange rejects malformed email identities before touching user data", async () => {
  const originalFindOne = User.findOne;
  const originalCreate = User.create;
  let touchedUserData = false;

  User.findOne = async () => {
    touchedUserData = true;
    return null;
  };
  User.create = async () => {
    touchedUserData = true;
    return null;
  };

  try {
    const req = {
      body: { email: "not-an-email", name: "Person" },
      get: () => undefined,
    };
    const res = createMockResponse();

    await exchangeAuth(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.error.code, "INVALID_REQUEST");
    assert.equal(touchedUserData, false);
  } finally {
    User.findOne = originalFindOne;
    User.create = originalCreate;
  }
});

for (const scenario of [
  { name: 'local dev account opens the app', mode: 'development', enabled: 'true', email: 'browser@dev.giggle.local', fixture: true, verified: true },
  { name: 'dev access stays off without the explicit flag', mode: 'development', enabled: 'false', email: 'browser@dev.giggle.local', fixture: true, verified: false },
  { name: 'ordinary accounts keep the age gate', mode: 'development', enabled: 'true', email: 'person@example.com', fixture: true, verified: false },
  { name: 'OAuth sessions never inherit dev fixture access', mode: 'development', enabled: 'true', email: 'browser@dev.giggle.local', fixture: false, verified: false },
  { name: 'production ignores the dev fixture option', mode: 'production', enabled: 'true', email: 'browser@dev.giggle.local', fixture: true, verified: false },
]) {
  test(scenario.name, async () => {
    const { issueSessionForEmail } = require('../src/controllers/authController');
    const previous = { NODE_ENV: process.env.NODE_ENV, DEV_AUTH_ENABLED: process.env.DEV_AUTH_ENABLED, JWT_SECRET: process.env.JWT_SECRET };
    const originalFindOne = User.findOne;
    const user = {
      _id: '507f1f77bcf86cd799439011', email: scenario.email, name: 'Local tester',
      referralCode: 'LOCAL42', ageConfirmed: false, isAdult: false, ageVerified: false,
      async save() { return this; },
    };
    User.findOne = async () => user;
    process.env.NODE_ENV = scenario.mode;
    process.env.DEV_AUTH_ENABLED = scenario.enabled;
    process.env.JWT_SECRET = 'local-test-only-secret-not-for-deployment';
    try {
      const result = await issueSessionForEmail({ email: scenario.email, devFixture: scenario.fixture });
      assert.equal(result.user.ageVerified, scenario.verified);
      assert.equal(result.user.ageConfirmed, scenario.verified);
      assert.equal(result.user.isAdult, scenario.verified);
      assert.equal(user.ageVerified, scenario.verified);
    } finally {
      User.findOne = originalFindOne;
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
}
