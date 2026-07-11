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

test("catalog sells only subscriptions and token packs (no backend priority, no $-cosmetics)", async () => {
  installLocalStorage();
  const { PRODUCTS, TOKEN_PERKS } = await import("../src/billing.ts");

  const ids = TOKEN_PERKS.map((perk) => perk.id);
  assert.equal(ids.includes("fast_pass"), false);
  assert.equal(ids.includes("squad_boost"), false);

  // No backend-priority products, and no dollar-priced cosmetic duplicates.
  assert.equal("fast_pass_5" in PRODUCTS, false);
  assert.equal("squad_boost_1h" in PRODUCTS, false);
  assert.equal("vibe_pack" in PRODUCTS, false);
  assert.equal("squad_themes" in PRODUCTS, false);

  for (const product of Object.values(PRODUCTS)) {
    assert.ok(product.type === "subscription" || product.type === "token_pack");
    assert.equal(product.description.includes("unlimited priority"), false);
    assert.equal(product.description.includes("match priority"), false);
  }
});

test("tokens are the only spend currency; Giggle+ does NOT auto-unlock cosmetics", async () => {
  installLocalStorage();
  const { billing } = await import(`../src/billing.ts?no-autounlock=${Date.now()}`);

  // A premium member with no tokens spent has unlocked nothing.
  await billing.purchase("premium_monthly"); // grants premium + 200 stipend
  assert.equal(billing.isPremium(), true);
  assert.equal(billing.hasPerk("cover_themes"), false);
  assert.equal(billing.hasPerk("vibe_pack"), false);

  // Spending tokens unlocks the perk.
  assert.equal(billing.spendOnCoverThemes(), true); // 120 of 200 tokens
  assert.equal(billing.hasPerk("cover_themes"), true);
  assert.equal(billing.getTokenBalance(), 80);
});

test("Giggle+ members get a bonus on token packs", async () => {
  installLocalStorage();
  const { billing, PREMIUM_PACK_BONUS_RATE } = await import(`../src/billing.ts?pack-bonus=${Date.now()}`);

  await billing.purchase("premium_monthly"); // premium + 200 stipend
  const before = billing.getTokenBalance();
  await billing.purchase("tokens_pro"); // 1200 + 200 bonus + 15% of 1200 member bonus
  const gained = billing.getTokenBalance() - before;
  assert.equal(gained, 1200 + 200 + Math.floor(1200 * PREMIUM_PACK_BONUS_RATE));
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
