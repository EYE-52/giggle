const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const source = readFileSync(path.join(__dirname, "../src/session.ts"), "utf8");

function block(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

function backendUser(id, ageVerified = false) {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    isPremium: false,
    isApproved: true,
    ageConfirmed: ageVerified,
    isAdult: ageVerified,
    ageVerified,
  };
}

function loadSession(api) {
  const temp = mkdtempSync(path.join(os.tmpdir(), "giggle-session-"));
  const dependencyKey = `__giggleSessionTest${Date.now()}${Math.random()}`;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis[dependencyKey] = api;

  writeFileSync(path.join(temp, "session.js"), ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText);
  writeFileSync(path.join(temp, "api.js"), `module.exports = { api: globalThis[${JSON.stringify(dependencyKey)}] };`);
  writeFileSync(path.join(temp, "client.js"), "module.exports = { setTokenGetter() {} };");
  writeFileSync(path.join(temp, "names.js"), "module.exports = { randomPlayerName: () => 'Alex' };");
  writeFileSync(path.join(temp, "billing.js"), "module.exports = { syncServerTokens() {} };");
  writeFileSync(path.join(temp, "socket.js"), "module.exports = { disconnectSocket() {}, setAdultAccessGetter() {} };");

  const session = require(path.join(temp, "session.js")).session;
  return {
    session,
    cleanup() {
      delete globalThis[dependencyKey];
      if (previousStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previousStorage;
      rmSync(temp, { recursive: true, force: true });
    },
  };
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
  assert.match(setAge, /!session\.ageConfirmed/);
  assert.match(setAge, /ageVerified: session\.ageVerified/);
});

test("a sign-in commit invalidates an old-identity sync started during exchange", async () => {
  const exchange = deferred();
  const profile = deferred();
  const api = {
    exchange: async () => ({ token: "old-token", user: backendUser("old", true) }),
    getMyProfile: () => profile.promise,
  };
  const runtime = loadSession(api);

  try {
    await runtime.session.signIn({ email: "old@example.com" });
    api.exchange = () => exchange.promise;
    const signingIn = runtime.session.signIn({ email: "new@example.com" });
    const syncing = runtime.session.syncAgeFromServer();

    exchange.resolve({ token: "new-token", user: backendUser("new") });
    await signingIn;
    profile.resolve({ ageConfirmed: true, isAdult: true, ageVerified: true });

    assert.equal(await syncing, false);
    assert.equal(runtime.session.user.id, "new");
    assert.equal(runtime.session.user.ageVerified, false);
    assert.equal(runtime.session.hasAdultAccess, false);
  } finally {
    runtime.cleanup();
  }
});

test("a DOB response cannot mutate a different signed-in session", async () => {
  const age = deferred();
  const api = {
    exchange: async () => ({ token: "old-token", user: backendUser("old") }),
    setAge: () => age.promise,
  };
  const runtime = loadSession(api);

  try {
    await runtime.session.signIn({ email: "old@example.com" });
    const settingAge = runtime.session.setAge("2000-01-01");
    api.exchange = async () => ({ token: "new-token", user: backendUser("new") });
    await runtime.session.signIn({ email: "new@example.com" });
    age.resolve({ ageConfirmed: true, isAdult: true, ageVerified: false });
    await settingAge;

    assert.equal(runtime.session.user.id, "new");
    assert.equal(runtime.session.user.ageConfirmed, false);
    assert.equal(runtime.session.user.isAdult, false);
  } finally {
    runtime.cleanup();
  }
});

test("stale AGE_ALREADY_CONFIRMED does not reconcile the replacement session", async () => {
  const age = deferred();
  let profileReads = 0;
  const api = {
    exchange: async () => ({ token: "old-token", user: backendUser("old") }),
    setAge: () => age.promise,
    getMyProfile: async () => {
      profileReads += 1;
      return { ageConfirmed: true, isAdult: true, ageVerified: true };
    },
  };
  const runtime = loadSession(api);

  try {
    await runtime.session.signIn({ email: "old@example.com" });
    const settingAge = runtime.session.setAge("2000-01-01");
    api.exchange = async () => ({ token: "new-token", user: backendUser("new") });
    await runtime.session.signIn({ email: "new@example.com" });
    age.reject(Object.assign(new Error("Already confirmed"), { code: "AGE_ALREADY_CONFIRMED" }));

    await assert.rejects(settingAge, { code: "AGE_ALREADY_CONFIRMED" });
    assert.equal(profileReads, 0);
    assert.equal(runtime.session.user.id, "new");
  } finally {
    runtime.cleanup();
  }
});
