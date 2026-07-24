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
