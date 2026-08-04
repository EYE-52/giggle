const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = () => readFileSync(path.join(__dirname, "../app/(app)/profile.tsx"), "utf8");
const identityAccountPath = path.join(__dirname, "../components/IdentityOnlyAccount.tsx");

test("mobile identity-only account surface keeps support, export, delete, and sign out", () => {
  assert.equal(existsSync(identityAccountPath), true);
  const account = readFileSync(identityAccountPath, "utf8");

  assert.match(account, /api\.exportAccount\(\)/);
  assert.match(account, /api\.deleteAccount\(\)/);
  assert.match(account, /gigglemeet\.com\/support/);
  assert.match(account, /session\.signOut\(\)/);
  assert.match(account, /onReturnToVerification/);
  assert.match(account, /Return to age verification/);
  assert.doesNotMatch(account, /updateMyProfile|listBlockedUsers|connectSocket|billing/);
});

test("mobile profile shares explicit JSON export and handles cancellation and errors visibly", () => {
  const page = source();

  assert.match(page, /import \{[^}]*Share[^}]*\} from 'react-native'/);
  assert.match(page, /await api\.exportAccount\(\)/);
  assert.match(page, /await Share\.share\(\{[\s\S]*JSON\.stringify\(data, null, 2\)/);
  assert.match(page, /Share\.dismissedAction/);
  assert.match(page, /Sharing cancelled\./);
  assert.match(page, /Couldn't export your data\. Please try again\./);
});

test("mobile profile uses native two-step deletion confirmation and signs out only after staging", () => {
  const page = source();

  assert.match(page, /Alert\.alert\('Delete account\?'/);
  assert.match(page, /Alert\.alert\('Delete permanently\?'/);
  assert.match(page, /may finish in the background/i);
  assert.match(page, /await api\.deleteAccount\(\)[\s\S]*session\.signOut\(\)[\s\S]*router\.replace\('\/'\)/);
  assert.match(page, /Couldn't start account deletion\. Please try again\./);
});
