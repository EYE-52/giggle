const assert = require("node:assert/strict");
const test = require("node:test");

function installLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
  return store;
}

test("token perk catalog does not sell backend priority features", async () => {
  installLocalStorage();
  const { PRODUCTS, TOKEN_PERKS } = await import("../src/billing.ts");

  const ids = TOKEN_PERKS.map((perk) => perk.id);

  assert.equal(ids.includes("fast_pass"), false);
  assert.equal(ids.includes("squad_boost"), false);

  assert.equal("fast_pass_5" in PRODUCTS, false);
  assert.equal("squad_boost_1h" in PRODUCTS, false);

  for (const product of Object.values(PRODUCTS)) {
    assert.equal(product.description.includes("unlimited priority"), false);
    assert.equal(product.description.includes("match priority"), false);
  }
});

test("legacy fast pass APIs are inert while priority matching is not sold", async () => {
  const store = installLocalStorage();
  const { billing } = await import("../src/billing.ts");

  billing.addTokens(100);

  assert.equal(billing.boostCount("fast_pass_5"), 0);
  assert.equal(billing.spendOnFastPass(), false);
  assert.equal(billing.consumeBoost("fast_pass_5"), false);
  assert.equal(billing.hasPerk("fast_pass"), false);
  assert.equal(store.get("giggle.tokens"), "100");
});

test("production builds do not redeem token perks from local-only storage", async () => {
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const store = installLocalStorage();
  try {
    const { billing } = await import(`../src/billing.ts?prod-redemption=${Date.now()}`);

    billing.addTokens(200);

    assert.equal(billing.spendOnVibePack(), false);
    assert.equal(billing.spendOnCoverThemes(), false);
    assert.equal(billing.spendOnBoost(), false);
    assert.equal(billing.hasPerk("vibe_pack"), false);
    assert.equal(billing.hasPerk("cover_themes"), false);
    assert.equal(store.get("giggle.tokens"), "200");
  } finally {
    if (originalEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalEnv;
    }
  }
});
