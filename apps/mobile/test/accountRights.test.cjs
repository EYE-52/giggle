const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = () => readFileSync(path.join(__dirname, "../app/(app)/profile.tsx"), "utf8");

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
