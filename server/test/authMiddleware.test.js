const assert = require("node:assert/strict");
const test = require("node:test");
const jwt = require("jsonwebtoken");

const { requireApiAuth } = require("../src/middlewares/authMiddleware");

function createResponse() {
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

test("requireApiAuth rejects signed tokens with malformed user ids", () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-secret";

  try {
    const token = jwt.sign({ userId: "not-a-mongo-id", email: "person@example.com" }, process.env.JWT_SECRET);
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = createResponse();
    let nextCalled = false;

    requireApiAuth(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error.code, "INVALID_TOKEN");
  } finally {
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
  }
});
