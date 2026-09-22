const assert = require("node:assert/strict");
const test = require("node:test");

const {
  allUsersHaveAdultAccess,
  hasAdultAccess,
} = require("../src/services/ageAccessService");

const production = { NODE_ENV: "production", AGE_VERIFICATION_BYPASS: "true" };

test("hasAdultAccess requires a confirmed, adult, verified user in production", () => {
  assert.equal(hasAdultAccess(null, production), false);
  assert.equal(hasAdultAccess({}, production), false);
  assert.equal(
    hasAdultAccess({ ageConfirmed: false, isAdult: true, ageVerified: true }, production),
    false
  );
  assert.equal(
    hasAdultAccess({ ageConfirmed: true, isAdult: false, ageVerified: true }, production),
    false
  );
  assert.equal(
    hasAdultAccess({ ageConfirmed: true, isAdult: true, ageVerified: false }, production),
    false
  );
  assert.equal(
    hasAdultAccess({ ageConfirmed: true, isAdult: true, ageVerified: true }, production),
    true
  );
});

test("hasAdultAccess allows the bypass only in development", () => {
  const selfAttestedAdult = { ageConfirmed: true, isAdult: true, ageVerified: false };

  assert.equal(hasAdultAccess(selfAttestedAdult, { NODE_ENV: "development" }), false);
  assert.equal(
    hasAdultAccess(selfAttestedAdult, {
      NODE_ENV: "development",
      AGE_VERIFICATION_BYPASS: "true",
    }),
    true
  );
  assert.equal(
    hasAdultAccess(selfAttestedAdult, { AGE_VERIFICATION_BYPASS: "true" }),
    false
  );
  assert.equal(
    hasAdultAccess(selfAttestedAdult, {
      NODE_ENV: "staging",
      AGE_VERIFICATION_BYPASS: "true",
    }),
    false
  );
  assert.equal(
    hasAdultAccess(selfAttestedAdult, {
      NODE_ENV: "unknown",
      AGE_VERIFICATION_BYPASS: "true",
    }),
    false
  );
  assert.equal(hasAdultAccess(selfAttestedAdult, production), false);
});

test("hasAdultAccess rejects moderated or pending-deletion accounts", () => {
  const adult = { ageConfirmed: true, isAdult: true, ageVerified: true };

  assert.equal(hasAdultAccess({ ...adult, isSuspended: true }, production), false);
  assert.equal(hasAdultAccess({ ...adult, isShadowBanned: true }, production), false);
  assert.equal(hasAdultAccess({ ...adult, deletionStatus: "pending" }, production), false);
  assert.equal(hasAdultAccess({ ...adult, deletionStatus: "active" }, production), true);
});

function fakeUserModel(users, observed = {}) {
  return {
    find(filter) {
      observed.filter = filter;
      return {
        select(fields) {
          observed.fields = fields;
          return Promise.resolve(users);
        },
      };
    },
  };
}

test("allUsersHaveAdultAccess deduplicates ids and selects only age fields", async () => {
  const observed = {};
  const User = fakeUserModel(
    [
      { _id: "u1", ageConfirmed: true, isAdult: true, ageVerified: true },
      { _id: "u2", ageConfirmed: true, isAdult: true, ageVerified: true },
    ],
    observed
  );

  assert.equal(
    await allUsersHaveAdultAccess(["u1", "u1", "u2"], { User, env: production }),
    true
  );
  assert.deepEqual(observed.filter, { _id: { $in: ["u1", "u2"] } });
  assert.equal(
    observed.fields,
    "ageConfirmed isAdult ageVerified isSuspended isShadowBanned deletionStatus"
  );
});

test("allUsersHaveAdultAccess fails when a roster user is missing or ineligible", async () => {
  const verifiedUser = {
    _id: "u1",
    ageConfirmed: true,
    isAdult: true,
    ageVerified: true,
  };

  assert.equal(
    await allUsersHaveAdultAccess(["u1", "u2"], {
      User: fakeUserModel([verifiedUser]),
      env: production,
    }),
    false
  );
  assert.equal(
    await allUsersHaveAdultAccess(["u1", "u2"], {
      User: fakeUserModel([
        verifiedUser,
        { _id: "u2", ageConfirmed: true, isAdult: true, ageVerified: false },
      ]),
      env: production,
    }),
    false
  );
  assert.equal(
    await allUsersHaveAdultAccess(["u1", null], {
      User: fakeUserModel([verifiedUser]),
      env: production,
    }),
    false
  );
});


test("temporary declaration access is reversible and preserves account restrictions", () => {
  const adult = { ageConfirmed: true, isAdult: true, ageVerified: false };
  const temporary = { NODE_ENV: "production", SELF_DECLARED_AGE_ACCESS: "true" };
  assert.equal(hasAdultAccess(adult, temporary), true);
  assert.equal(hasAdultAccess(adult, production), false);
  assert.equal(adult.ageVerified, false);
  for (const override of [{ ageConfirmed: false }, { isAdult: false },
    { isSuspended: true }, { isShadowBanned: true }, { deletionStatus: "pending" }]) {
    assert.equal(hasAdultAccess({ ...adult, ...override }, temporary), false);
  }
});
