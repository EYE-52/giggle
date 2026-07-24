const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");

const { requestLogger } = require("../src/middlewares/requestLogger");

test("requestLogger redacts sensitive query and body fields", () => {
  const originalLog = console.log;
  let loggedSummary;
  let loggedDetails;
  console.log = (_label, summary, details) => {
    loggedSummary = summary;
    loggedDetails = details;
  };

  const req = {
    method: "POST",
    originalUrl: "/api/auth/email/verify?token=secret-token",
    ip: "127.0.0.1",
    headers: {},
    query: {
      token: "secret-token",
      code: "oauth-code",
      id_token: "apple-id-token",
      access_token: "provider-access-token",
      nested: { refreshToken: "nested-secret", keep: "ok" },
    },
    body: {
      accessToken: "body-secret",
      profile: { authorization: "nested-body-secret", keep: "ok" },
    },
    get(name) {
      return name === "user-agent" ? "node-test" : undefined;
    },
  };
  const res = new EventEmitter();
  res.statusCode = 200;

  try {
    requestLogger({ logRequestBody: true })(req, res, () => {});
    res.emit("finish");

    assert.equal(loggedSummary.path, "/api/auth/email/verify");
    assert.equal(JSON.stringify(loggedSummary).includes("secret-token"), false);
    assert.equal(loggedDetails.query.token, "[REDACTED]");
    assert.equal(loggedDetails.query.code, "[REDACTED]");
    assert.equal(loggedDetails.query.id_token, "[REDACTED]");
    assert.equal(loggedDetails.query.access_token, "[REDACTED]");
    assert.equal(loggedDetails.query.nested.refreshToken, "[REDACTED]");
    assert.equal(loggedDetails.query.nested.keep, "ok");
    assert.equal(loggedDetails.body.accessToken, "[REDACTED]");
    assert.equal(loggedDetails.body.profile.authorization, "[REDACTED]");
    assert.equal(loggedDetails.body.profile.keep, "ok");
  } finally {
    console.log = originalLog;
  }
});
