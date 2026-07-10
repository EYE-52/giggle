const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = () => readFileSync(path.join(__dirname, "../app/premium.tsx"), "utf8");

test("mobile premium does not simulate paid checkout for plans or token packs", () => {
  const page = source();

  assert.equal(page.includes("billing.purchase"), false);
  assert.equal(page.includes("Plan preview"), true);
  assert.equal(page.includes("Token packs are in launch prep"), true);
  assert.equal(page.includes("Add tokens"), false);
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

test("mobile premium boost actions expose named button semantics", () => {
  const page = source();

  assert.equal(page.includes("accessibilityRole=\"button\""), true);
  assert.equal(page.includes("accessibilityLabel={`${b.label}: ${billing.isPremium() ? 'Use' : 'Unlock'}`"), true);
  assert.equal(page.includes("accessibilityState={{ disabled: !canRedeemPerks }}"), true);
});

test("mobile premium disables local-only token redemption in production builds", () => {
  const page = source();

  assert.equal(page.includes("canRedeemTokenPerksLocally"), true);
  assert.equal(page.includes("Perk redemption is in launch prep"), true);
  assert.equal(page.includes("accessibilityState={{ disabled: !canRedeemPerks }}"), true);
});
