const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = () => readFileSync(path.join(__dirname, "../app/premium.tsx"), "utf8");

test("mobile wallet omits fake purchase and preview inventory", () => {
  const page = source();

  assert.equal(page.includes("billing.purchase"), false);
  assert.equal(page.includes("Plan preview"), false);
  assert.equal(page.includes("const TOKEN_PACKS"), false);
  assert.equal(page.includes("const BOOSTS"), false);
  assert.equal(page.includes("boostGrid"), false);
  assert.equal(page.includes("yearly"), false);
  assert.equal(page.includes(">Wallet</Text>"), true);
});

test("mobile token boosts do not sell backend priority features", () => {
  const page = source();

  assert.equal(page.includes("id: 'fast_pass'"), false);
  assert.equal(page.includes("id: 'squad_boost'"), false);
  assert.equal(page.includes("Skip the matchmaking queue"), false);
  assert.equal(page.includes("Boost your squad visibility"), false);
  assert.equal(page.includes("Radar Boost"), false);
  assert.equal(page.includes("Get matched 3x faster"), false);
  assert.equal(page.includes("Priority Shield"), false);
  assert.equal(page.includes("AI-powered safety moderation"), false);
});

test("mobile wallet uses the real referral balance and native sharing", () => {
  const page = source();

  assert.equal(page.includes("api.getReferral()"), true);
  assert.equal(page.includes("setReferral(info)"), true);
  assert.equal(page.includes("referral?.tokens ?? session.user?.tokens ?? 0"), true);
  assert.equal(page.includes("Share.share"), true);
  assert.equal(page.includes("setLoadAttempt((attempt) => attempt + 1)"), true);
});

test("mobile wallet presents unavailable perks as a compact truthful list", () => {
  const page = source();

  assert.equal(page.includes("TOKEN_PERKS.map"), true);
  assert.equal(page.includes("Coming soon"), true);
  assert.equal(page.includes("Earn and track tokens for your squad identity."), true);
  assert.equal(page.includes("Earn tokens, then spend them on your squad identity."), false);
  assert.equal(page.includes("canRedeemTokenPerksLocally"), false);
  assert.equal(page.includes("spendOnVibePack"), false);
  assert.equal(page.includes("spendOnCoverThemes"), false);
  assert.equal(page.includes("Icon.palette"), false);
});
