const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../src/models/User");
const { hasActivePremium } = require("../src/utils/premium");
const { walletView, creditActivity, redeemPlus, PLUS_COST } = require("../src/services/walletService");
const { redeemWalletPerk } = require("../src/controllers/walletController");

test("Plus expires at its boundary and malformed expiry cannot grant access", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");
  assert.equal(hasActivePremium({ isPremium: true, premiumExpiresAt: new Date(now + 1) }, now), true);
  assert.equal(hasActivePremium({ isPremium: true, premiumExpiresAt: new Date(now) }, now), false);
  assert.equal(hasActivePremium({ isPremium: true, premiumExpiresAt: "bad" }, now), false);
  assert.equal(hasActivePremium({ isPremium: false, premiumExpiresAt: new Date(now + 1) }, now), false);
  assert.equal(hasActivePremium({ isPremium: true }, now), true); // existing permanent grants
});
test("earned rewards have a fixed value and require an unclaimed reward in the same atomic update", async () => {
  const original = User.updateOne;
  let calls = 0;
  User.updateOne = async (filter, update) => {
    calls++;
    assert.deepEqual(filter, { _id: "account", earnedRewardIds: { $ne: "first_squad" } });
    assert.deepEqual(update, { $addToSet: { earnedRewardIds: "first_squad" }, $inc: { tokens: 25 } });
    return { modifiedCount: calls === 1 ? 1 : 0 };
  };
  try {
    assert.equal(await creditActivity("account", "arbitrary"), false);
    assert.equal(calls, 0);
    assert.equal(await creditActivity("account", "first_squad"), true);
    assert.equal(await creditActivity("account", "first_squad"), false);
  } finally { User.updateOne = original; }
});
test("Plus spends and grants atomically, and active or unaffordable passes do not spend", async () => {
  const originals = { update: User.findOneAndUpdate, find: User.findById };
  let state = { tokens: 0, isPremium: false }, success = false;
  User.findOneAndUpdate = async (filter, update, options) => {
    assert.deepEqual(filter.tokens, { $gte: PLUS_COST });
    assert.equal(filter._id, "account");
    assert.equal(filter.$or[0].isPremium.$ne, true);
    assert(filter.$or[1].premiumExpiresAt.$lte instanceof Date);
    assert.equal(update.$inc.tokens, -PLUS_COST);
    assert.equal(update.$set.isPremium, true);
    assert.equal(options.new, true);
    return success ? { tokens: 25, isPremium: true, premiumExpiresAt: update.$set.premiumExpiresAt } : null;
  };
  User.findById = async () => state;
  try {
    assert.equal((await redeemPlus("account")).error, "INSUFFICIENT_CREDITS");
    state = { tokens: 500, isPremium: true, premiumExpiresAt: new Date(Date.now() + 86400000) };
    assert.equal((await redeemPlus("account")).error, "PLUS_ACTIVE");
    success = true;
    const result = await redeemPlus("account");
    assert.equal(result.wallet.credits, 25);
    assert.equal(result.wallet.premium, true);
    assert.equal(result.wallet.plus.days, 7);
  } finally { User.findOneAndUpdate = originals.update; User.findById = originals.find; }
});
test("wallet rewards are private display data and unsupported redemption is rejected before database access", async () => {
  const view = walletView({ tokens: 125, earnedRewardIds: ["first_squad"], email: "private@example.com" });
  assert.equal(view.credits, 125);
  assert.equal(view.rewards[0].earned, true);
  assert.equal(Object.hasOwn(view, "email"), false);
  const response = { set() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await redeemWalletPerk({ body: { perkId: "tokens", credits: 9999 } }, response);
  assert.equal(response.code, 400);
  assert.equal(response.body.error.code, "INVALID_PERK");
});
