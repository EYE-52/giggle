const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { setMyAge, computeAge, parseBirthDate } = require("../src/controllers/authController");
const {
  startAgeVerification,
  getAgeVerificationStatus,
} = require("../src/controllers/ageVerificationController");
const User = require("../src/models/User");
const { classifyVibe, tagsAreMature, firstBlockedTag } = require("../src/utils/moderation");

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

// A fake user doc with a save() that records the persisted state.
function fakeUser(overrides = {}) {
  return {
    _id: "u1",
    birthDate: null,
    isAdult: false,
    ageConfirmed: false,
    ageVerified: false,
    ageVerification: undefined,
    saved: false,
    async save() {
      this.saved = true;
    },
    ...overrides,
  };
}

const YOTI_ENV = {
  YOTI_AGE_API_KEY: "server-api-secret",
  YOTI_AGE_SDK_ID: "sdk-id-for-tests-123",
  AGE_VERIFICATION_CALLBACK_URL: "https://giggle.example.com/age-verification",
};
const SESSION_ID = "14010f56-3f04-4f1f-84e7-a43ff723ef86";
const REFERENCE_ID = "7f9779fd-75e3-47c4-8bd4-c3185b59d42c";
const EVIDENCE_ID = "4786ecb7-c10c-4037-9947-aaa6507e7414";

async function withEnvironment(values, fn) {
  const original = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withFetch(fetchImpl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function withMockedFindById(user, fn) {
  const original = User.findById;
  User.findById = async () => user;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      User.findById = original;
    });
}

const isoYearsAgo = (years) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

test("parseBirthDate rejects malformed and impossible dates", () => {
  assert.equal(parseBirthDate("2001-02-30"), null);
  assert.equal(parseBirthDate("2001-13-01"), null);
  assert.equal(parseBirthDate("not-a-date"), null);
  assert.equal(parseBirthDate("2001-1-1"), null);
  assert.notEqual(parseBirthDate("2000-06-15"), null);
});

test("computeAge counts full years relative to birthday", () => {
  const now = new Date(Date.UTC(2026, 6, 23));
  assert.equal(computeAge(new Date(Date.UTC(2000, 6, 23)), now), 26);
  assert.equal(computeAge(new Date(Date.UTC(2000, 6, 24)), now), 25); // birthday tomorrow
});

test("POST /api/me/age: adult DOB sets isAdult true", async () => {
  const user = fakeUser();
  await withMockedFindById(user, async () => {
    const req = { user: { userId: "u1" }, body: { birthDate: isoYearsAgo(30) } };
    const res = createMockResponse();
    await setMyAge(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.isAdult, true);
    assert.equal(res.body.data.ageConfirmed, true);
    assert.equal(res.body.data.ageVerified, false);
    assert.equal(user.ageConfirmed, true);
    assert.equal(user.isAdult, true);
    assert.equal(user.ageVerified, false); // reserved — never set here
    assert.ok(user.birthDate instanceof Date);
  });
});

test("POST /api/me/age: minor DOB is stored once and denied with AGE_RESTRICTED", async () => {
  const user = fakeUser();
  await withMockedFindById(user, async () => {
    const req = { user: { userId: "u1" }, body: { birthDate: isoYearsAgo(15) } };
    const res = createMockResponse();
    await setMyAge(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "AGE_RESTRICTED");
    assert.equal(user.isAdult, false);
    assert.equal(user.ageConfirmed, true);
    assert.equal(user.ageVerified, false);
    assert.equal(user.saved, true);
  });
});

test("POST /api/me/age: under-13 is rejected with 400", async () => {
  const user = fakeUser();
  await withMockedFindById(user, async () => {
    const req = { user: { userId: "u1" }, body: { birthDate: isoYearsAgo(10) } };
    const res = createMockResponse();
    await setMyAge(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, "INVALID_AGE");
    assert.equal(user.saved, false);
  });
});

test("POST /api/me/age: invalid date string rejected with 400", async () => {
  const user = fakeUser();
  await withMockedFindById(user, async () => {
    const req = { user: { userId: "u1" }, body: { birthDate: "2001-02-30" } };
    const res = createMockResponse();
    await setMyAge(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, "INVALID_REQUEST");
  });
});

test("POST /api/me/age: repeated submissions return the persisted age gates", async () => {
  const originalBirthDate = new Date(Date.UTC(1996, 4, 10));
  const user = fakeUser({ birthDate: originalBirthDate, ageConfirmed: true, isAdult: true });
  await withMockedFindById(user, async () => {
    const req = { user: { userId: "u1" }, body: { birthDate: isoYearsAgo(40) } };
    const res = createMockResponse();
    await setMyAge(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, {
      isAdult: true,
      ageConfirmed: true,
      ageVerified: false,
    });
    assert.equal(user.birthDate, originalBirthDate);
    assert.equal(user.saved, false);
  });
});

test("POST /api/me/age: a persisted minor remains AGE_RESTRICTED", async () => {
  const user = fakeUser({ birthDate: new Date(), ageConfirmed: true, isAdult: false });
  await withMockedFindById(user, async () => {
    const req = { user: { userId: "u1" }, body: { birthDate: isoYearsAgo(30) } };
    const res = createMockResponse();
    await setMyAge(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "AGE_RESTRICTED");
    assert.equal(user.saved, false);
  });
});

test("verification session requires a declared adult", async () => {
  for (const [user, code] of [
    [fakeUser(), "AGE_DECLARATION_REQUIRED"],
    [fakeUser({ ageConfirmed: true, isAdult: false }), "AGE_RESTRICTED"],
  ]) {
    await withMockedFindById(user, async () => {
      await withFetch(async () => assert.fail("Yoti should not be called"), async () => {
        const res = createMockResponse();
        await startAgeVerification({ user: { userId: "u1" } }, res);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.error.code, code);
        assert.equal(user.saved, false);
      });
    });
  }
});

test("verification session stores only an opaque pending binding", async () => {
  const user = fakeUser({ ageConfirmed: true, isAdult: true });
  await withEnvironment(YOTI_ENV, () =>
    withMockedFindById(user, () =>
      withFetch(
        async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            id: SESSION_ID,
            expires_at: "2026-08-04T12:15:00Z",
            status: "PENDING",
            selfie: "must-not-be-stored",
          }),
        }),
        async () => {
          const res = createMockResponse();
          await startAgeVerification({ user: { userId: "u1" } }, res);
          assert.equal(res.statusCode, 200);
          assert.equal(res.body.data.status, "pending");
          assert.equal(res.body.data.ageVerified, false);
          assert.equal(res.body.data.url.includes(`sessionId=${SESSION_ID}`), true);
          assert.equal(user.ageVerification.provider, "yoti");
          assert.equal(user.ageVerification.status, "pending");
          assert.equal(user.ageVerification.sessionId, SESSION_ID);
          assert.match(user.ageVerification.referenceId, /^[0-9a-f-]{36}$/);
          assert.ok(user.ageVerification.requestedAt instanceof Date);
          assert.equal(JSON.stringify(user.ageVerification).includes("must-not-be-stored"), false);
          assert.equal(user.ageVerified, false);
          assert.equal(user.saved, true);
        }
      )
    )
  );
});

test("verification session safely reuses a recent pending provider session", async () => {
  const user = fakeUser({
    ageConfirmed: true,
    isAdult: true,
    ageVerification: {
      provider: "yoti",
      status: "pending",
      sessionId: SESSION_ID,
      referenceId: REFERENCE_ID,
      requestedAt: new Date(),
    },
  });
  await withEnvironment(YOTI_ENV, () =>
    withMockedFindById(user, () =>
      withFetch(async () => assert.fail("recent session should be reused"), async () => {
        const res = createMockResponse();
        await startAgeVerification({ user: { userId: "u1" } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.status, "pending");
        assert.equal(res.body.data.url.includes(`sessionId=${SESSION_ID}`), true);
        assert.equal(user.saved, false);
      })
    )
  );
});

test("missing Yoti configuration fails closed without changing pending state", async () => {
  const user = fakeUser({ ageConfirmed: true, isAdult: true });
  await withEnvironment(
    {
      YOTI_AGE_API_KEY: undefined,
      YOTI_AGE_SDK_ID: undefined,
      AGE_VERIFICATION_CALLBACK_URL: undefined,
    },
    () =>
      withMockedFindById(user, async () => {
        const res = createMockResponse();
        await startAgeVerification({ user: { userId: "u1" } }, res);
        assert.equal(res.statusCode, 503);
        assert.equal(res.body.error.code, "AGE_VERIFICATION_UNAVAILABLE");
        assert.equal(user.ageVerified, false);
        assert.equal(user.ageVerification, undefined);
        assert.equal(user.saved, false);
      })
  );
});

function pendingUser() {
  return fakeUser({
    ageConfirmed: true,
    isAdult: true,
    ageVerification: {
      provider: "yoti",
      status: "pending",
      sessionId: SESSION_ID,
      referenceId: REFERENCE_ID,
      requestedAt: new Date(),
    },
  });
}

function providerResult(overrides = {}) {
  return {
    id: SESSION_ID,
    sdk_id: YOTI_ENV.YOTI_AGE_SDK_ID,
    type: "OVER",
    status: "COMPLETE",
    method: "DIGITAL_ID",
    reference_id: REFERENCE_ID,
    evidence_id: EVIDENCE_ID,
    age: 18,
    digital_id: { allowed: true, threshold: 18 },
    actual_age: 42,
    birth_date: "1984-01-01",
    selfie: "raw-selfie",
    biometric: { template: "raw-template" },
    document: { number: "raw-document" },
    ...overrides,
  };
}

test("verification status trusts only the user's stored session and persists a minimal receipt", async () => {
  const user = pendingUser();
  let requestedUrl;
  await withEnvironment(YOTI_ENV, () =>
    withMockedFindById(user, () =>
      withFetch(
        async (url) => {
          requestedUrl = url;
          return { ok: true, status: 200, json: async () => providerResult() };
        },
        async () => {
          const res = createMockResponse();
          await getAgeVerificationStatus(
            { user: { userId: "u1" }, query: { sessionId: "attacker-session" } },
            res
          );
          assert.equal(requestedUrl.includes(SESSION_ID), true);
          assert.equal(requestedUrl.includes("attacker-session"), false);
          assert.equal(res.statusCode, 200);
          assert.deepEqual(res.body.data, { status: "verified", ageVerified: true });
          assert.equal(user.ageVerified, true);
          assert.equal(user.ageVerification.status, "verified");
          assert.equal(user.ageVerification.provider, "yoti");
          assert.equal(user.ageVerification.sessionId, SESSION_ID);
          assert.equal(user.ageVerification.referenceId, REFERENCE_ID);
          assert.equal(user.ageVerification.evidenceId, EVIDENCE_ID);
          assert.equal(user.ageVerification.method, "DIGITAL_ID");
          assert.equal(user.ageVerification.threshold, 18);
          assert.equal(user.ageVerification.policyVersion, "verified-adult-v1");
          assert.ok(user.ageVerification.verifiedAt instanceof Date);
          const stored = JSON.stringify(user.ageVerification);
          for (const forbidden of ["actual_age", "birth_date", "raw-selfie", "raw-template", "raw-document"]) {
            assert.equal(stored.includes(forbidden), false);
          }
        }
      )
    )
  );
});

test("provider errors and result mismatches preserve pending state", async () => {
  for (const fetchImpl of [
    async () => ({ ok: false, status: 503, json: async () => ({}) }),
    async () => ({
      ok: true,
      status: 200,
      json: async () => providerResult({ reference_id: "wrong-reference" }),
    }),
  ]) {
    const user = pendingUser();
    await withEnvironment(YOTI_ENV, () =>
      withMockedFindById(user, () =>
        withFetch(fetchImpl, async () => {
          const res = createMockResponse();
          await getAgeVerificationStatus({ user: { userId: "u1" } }, res);
          assert.equal(res.statusCode, 503);
          assert.equal(res.body.error.code, "AGE_VERIFICATION_UNAVAILABLE");
          assert.equal(user.ageVerified, false);
          assert.equal(user.ageVerification.status, "pending");
          assert.equal(user.saved, false);
        })
      )
    );
  }
});

test("provider pending and rejected results remain blocked and expose only normalized status", async () => {
  for (const [providerStatus, expectedStatus] of [
    ["PENDING", "pending"],
    ["FAIL", "rejected"],
  ]) {
    const user = pendingUser();
    await withEnvironment(YOTI_ENV, () =>
      withMockedFindById(user, () =>
        withFetch(
          async () => ({
            ok: true,
            status: 200,
            json: async () => providerResult({ status: providerStatus }),
          }),
          async () => {
            const res = createMockResponse();
            await getAgeVerificationStatus({ user: { userId: "u1" } }, res);
            assert.equal(res.statusCode, 200);
            assert.equal(res.body.data.status, expectedStatus);
            assert.equal(res.body.data.ageVerified, false);
            assert.equal(user.ageVerified, false);
            assert.equal(user.ageVerification.status, expectedStatus);
            assert.equal(JSON.stringify(res.body).includes("raw-selfie"), false);
          }
        )
      )
    );
  }
});

test("age verification schema contains only normalized provider receipt fields", () => {
  const paths = User.schema.path("ageVerification").schema.paths;
  const expected = [
    "provider",
    "status",
    "sessionId",
    "referenceId",
    "evidenceId",
    "method",
    "threshold",
    "policyVersion",
    "requestedAt",
    "verifiedAt",
  ];
  assert.deepEqual(Object.keys(paths).sort(), expected.sort());
  for (const forbidden of ["age", "birthDate", "selfie", "biometric", "document", "payload"]) {
    assert.equal(Object.hasOwn(paths, forbidden), false);
  }
});

test("age verification endpoints use identity-only authentication", () => {
  const routes = readFileSync(path.join(__dirname, "../src/routes/meRoutes.js"), "utf8");
  assert.equal(
    routes.includes(
      'router.post("/me/age/verification-session", requireIdentityAuth, startAgeVerification);'
    ),
    true
  );
  assert.equal(
    routes.includes(
      'router.get("/me/age/verification-status", requireIdentityAuth, getAgeVerificationStatus);'
    ),
    true
  );
});

test("classifyVibe buckets ok / mature / blocked (incl. leet + spacing)", () => {
  assert.equal(classifyVibe("gaming"), "ok");
  assert.equal(classifyVibe("chill vibes"), "ok");
  assert.equal(classifyVibe("nsfw"), "mature");
  assert.equal(classifyVibe("s3x"), "mature"); // leet normalization
  assert.equal(classifyVibe("s e x"), "mature"); // spacing collapse
  assert.equal(classifyVibe("porn"), "mature");
  assert.equal(classifyVibe("pedo"), "blocked");
  assert.equal(classifyVibe("rape"), "blocked");
  assert.equal(classifyVibe(""), "ok");
});

test("tagsAreMature / firstBlockedTag", () => {
  assert.equal(tagsAreMature(["gaming", "nsfw"]), true);
  assert.equal(tagsAreMature(["gaming", "music"]), false);
  assert.equal(firstBlockedTag(["gaming", "pedo"]), "pedo");
  assert.equal(firstBlockedTag(["gaming", "nsfw"]), null);
});
