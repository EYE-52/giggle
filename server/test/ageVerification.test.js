const assert = require("node:assert/strict");
const test = require("node:test");

const { setMyAge, computeAge, parseBirthDate } = require("../src/controllers/authController");
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
    saved: false,
    async save() {
      this.saved = true;
    },
    ...overrides,
  };
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
    assert.equal(user.ageConfirmed, true);
    assert.equal(user.isAdult, true);
    assert.equal(user.ageVerified, false); // reserved — never set here
    assert.ok(user.birthDate instanceof Date);
  });
});

test("POST /api/me/age: minor DOB sets isAdult false but still confirmed", async () => {
  const user = fakeUser();
  await withMockedFindById(user, async () => {
    const req = { user: { userId: "u1" }, body: { birthDate: isoYearsAgo(15) } };
    const res = createMockResponse();
    await setMyAge(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.isAdult, false);
    assert.equal(res.body.data.ageConfirmed, true);
    assert.equal(user.isAdult, false);
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

test("POST /api/me/age: set-once returns 409 when already confirmed", async () => {
  const user = fakeUser({ ageConfirmed: true, isAdult: true });
  await withMockedFindById(user, async () => {
    const req = { user: { userId: "u1" }, body: { birthDate: isoYearsAgo(40) } };
    const res = createMockResponse();
    await setMyAge(req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.code, "AGE_ALREADY_CONFIRMED");
    assert.equal(user.saved, false);
  });
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
