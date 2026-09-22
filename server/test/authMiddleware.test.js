const assert = require("node:assert/strict");
const test = require("node:test");
const jwt = require("jsonwebtoken");

const User = require("../src/models/User");
const {
  requireApiAuth,
  requireIdentityAuth,
} = require("../src/middlewares/authMiddleware");

const USER_ID = "64b7f3c9a1b2c3d4e5f67890";

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

async function withAuthEnvironment(run) {
  const originals = {
    JWT_SECRET: process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    AGE_VERIFICATION_BYPASS: process.env.AGE_VERIFICATION_BYPASS,
  };
  process.env.JWT_SECRET = "test-secret";
  process.env.NODE_ENV = "production";
  process.env.AGE_VERIFICATION_BYPASS = "true";

  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withLiveUser(user, run) {
  const originalFindById = User.findById;
  User.findById = () => ({
    select: () => ({
      lean: async () => {
        if (user instanceof Error) throw user;
        return user;
      },
    }),
  });

  try {
    return await run();
  } finally {
    User.findById = originalFindById;
  }
}

function signedRequest(claims = {}) {
  const token = jwt.sign(
    { userId: USER_ID, email: "person@example.com", ...claims },
    process.env.JWT_SECRET
  );
  return { headers: { authorization: `Bearer ${token}` } };
}

test("requireIdentityAuth rejects signed tokens with malformed user ids", async () => {
  await withAuthEnvironment(() => {
    const req = signedRequest({ userId: "not-a-mongo-id" });
    const res = createResponse();
    let nextCalled = false;

    requireIdentityAuth(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error.code, "INVALID_TOKEN");
  });
});

test("requireIdentityAuth preserves both legacy identity request keys", async () => {
  await withAuthEnvironment(() => {
    const req = signedRequest();
    const res = createResponse();

    requireIdentityAuth(req, res, () => {});

    assert.equal(req.user.userId, USER_ID);
    assert.equal(req.giggleIdentity.userId, USER_ID);
    assert.equal(res.body, null);
  });
});

test("requireApiAuth denies forged adult JWT claims when the live user is pending", async () => {
  await withAuthEnvironment(() =>
    withLiveUser(
      { ageConfirmed: true, isAdult: true, ageVerified: false },
      async () => {
        const req = signedRequest({ isAdult: true, ageVerified: true });
        const res = createResponse();
        let nextCalled = false;

        await requireApiAuth(req, res, () => {
          nextCalled = true;
        });

        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.error.code, "AGE_VERIFICATION_REQUIRED");
      }
    )
  );
});

test("requireApiAuth allows a verified adult and attaches the live user", async () => {
  const liveUser = { ageConfirmed: true, isAdult: true, ageVerified: true };

  await withAuthEnvironment(() =>
    withLiveUser(liveUser, async () => {
      const req = signedRequest();
      const res = createResponse();
      let nextCalled = false;

      await requireApiAuth(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true);
      assert.equal(req.user.userId, USER_ID);
      assert.equal(req.giggleIdentity.userId, USER_ID);
      assert.equal(req.userRecord, liveUser);
      assert.equal(res.body, null);
    })
  );
});

test("requireApiAuth returns AGE_RESTRICTED for a declared minor", async () => {
  await withAuthEnvironment(() =>
    withLiveUser(
      { ageConfirmed: true, isAdult: false, ageVerified: false },
      async () => {
        const req = signedRequest();
        const res = createResponse();

        await requireApiAuth(req, res, () => assert.fail("minor was authorized"));

        assert.equal(res.statusCode, 403);
        assert.equal(res.body.error.code, "AGE_RESTRICTED");
      }
    )
  );
});

test("requireApiAuth hides moderation details behind ACCOUNT_UNAVAILABLE", async () => {
  const adult = { ageConfirmed: true, isAdult: true, ageVerified: true };

  await withAuthEnvironment(async () => {
    for (const unavailable of [
      { ...adult, isSuspended: true },
      { ...adult, isShadowBanned: true },
      { ...adult, deletionStatus: "pending" },
    ]) {
      await withLiveUser(unavailable, async () => {
        const req = signedRequest();
        const res = createResponse();

        await requireApiAuth(req, res, () => assert.fail("unavailable account was authorized"));

        assert.equal(res.statusCode, 403);
        assert.deepEqual(res.body.error, {
          code: "ACCOUNT_UNAVAILABLE",
          message: "This account is unavailable",
        });
      });
    }
  });
});

test("requireApiAuth rejects tokens for missing users", async () => {
  await withAuthEnvironment(() =>
    withLiveUser(null, async () => {
      const req = signedRequest();
      const res = createResponse();
      let nextCalled = false;

      await requireApiAuth(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.error.code, "INVALID_TOKEN");
    })
  );
});

test("requireApiAuth fails closed when live authorization is unavailable", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withAuthEnvironment(() =>
      withLiveUser(new Error("database unavailable"), async () => {
        const req = signedRequest();
        const res = createResponse();
        let nextCalled = false;

        await requireApiAuth(req, res, () => {
          nextCalled = true;
        });

        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.error.code, "AUTHORIZATION_UNAVAILABLE");
      })
    );
  } finally {
    console.error = originalConsoleError;
  }
});
