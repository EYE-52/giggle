const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = readFileSync(path.join(__dirname, "../src/session.ts"), "utf8");

function block(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

test("session exposes read-only verified adult access", () => {
  assert.match(source, /get ageVerified\(\)\s*{/);
  assert.match(source, /get hasAdultAccess\(\)\s*{/);
  assert.equal(source.includes("set ageVerified("), false);
  assert.equal(source.includes("setAgeVerified"), false);
});

test("only a successful live sync grants adult access", () => {
  const sync = block("async syncAgeFromServer()", "  signOut()");

  assert.match(sync, /invalidateAdultAccess\(\);/);
  assert.match(sync, /ageAccessSynced = true;/);
  assert.match(sync, /return session\.hasAdultAccess;/);
  assert.match(sync, /catch \{\s*return false;\s*\}/);
});

test("a stale sync cannot restore access after session state changes", () => {
  const sync = block("async syncAgeFromServer()", "  signOut()");

  assert.match(source, /ageAccessVersion \+= 1;/);
  assert.match(sync, /const syncVersion = ageAccessVersion;/);
  assert.match(sync, /if \(syncVersion !== ageAccessVersion \|\| !token \|\| !user\) return false;/);
  assert.match(block("get hasAdultAccess()", "  },"), /!!token/);
});

test("identity and DOB changes invalidate cached adult access", () => {
  assert.match(block("async signIn(", "  /**\n   * Dev/local sign-in"), /invalidateAdultAccess\(\);/);
  assert.match(block("setTokenFromOAuth(", "  /** True once"), /invalidateAdultAccess\(\);/);
  assert.match(block("async setAge(", "  /**\n   * Reconcile the age gates"), /invalidateAdultAccess\(\);/);
  assert.match(block("signOut()", "\n};"), /invalidateAdultAccess\(\);/);
});

test("legacy AGE_ALREADY_CONFIRMED still advances past DOB without granting access", () => {
  const setAge = block("async setAge(", "  /**\n   * Reconcile the age gates");

  assert.match(setAge, /AGE_ALREADY_CONFIRMED/);
  assert.match(setAge, /await session\.syncAgeFromServer\(\);/);
  assert.match(setAge, /if \(!session\.ageConfirmed\) throw error;/);
  assert.match(setAge, /ageVerified: session\.ageVerified/);
});
