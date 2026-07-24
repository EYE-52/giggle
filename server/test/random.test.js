const assert = require("node:assert/strict");
const test = require("node:test");

const { randomBase36, randomChoice, shuffle } = require("../src/utils/random");

test("randomBase36 returns URL-safe lowercase ids", () => {
  assert.match(randomBase36(10), /^[a-z0-9]{10}$/);
});

test("randomChoice returns one item from the provided array", () => {
  const items = ["a", "b", "c"];
  assert.ok(items.includes(randomChoice(items)));
});

test("shuffle returns the same items without mutating input", () => {
  const input = ["a", "b", "c", "d"];
  const output = shuffle(input);

  assert.deepEqual(input, ["a", "b", "c", "d"]);
  assert.deepEqual([...output].sort(), input);
});
