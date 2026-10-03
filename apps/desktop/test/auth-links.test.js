const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../lib/authLinks.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const moduleExports = {};
new Function("exports", compiled)(moduleExports);
const { referralSignInHref } = moduleExports;

test("landing sign-in preserves and normalizes a referral", () => {
  assert.equal(referralSignInHref("?ref=%20abc123xy%20&next=https://example.com"), "/signin?ref=ABC123XY");
  assert.equal(referralSignInHref(""), "/signin");
  assert.equal(referralSignInHref("?ref=%20%20"), "/signin");
});

test("referral text cannot add another parameter or redirect destination", () => {
  const href = referralSignInHref("?ref=abc%26next%3Dhttps%3A%2F%2Fexample.com");
  const parsed = new URL(href, "https://www.gigglemeet.com");
  assert.equal(parsed.pathname, "/signin");
  assert.equal(parsed.searchParams.get("ref"), "ABC&NEXT=HTTPS://EXAMPLE.COM");
  assert.equal(parsed.searchParams.has("next"), false);
});
