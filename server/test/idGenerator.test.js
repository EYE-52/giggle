const assert = require("node:assert/strict");
const test = require("node:test");

const { generateId, generateSquadCode } = require("../src/utils/idGenerator");

test("generateId does not use predictable Math.random output", () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const id = generateId("sq");
    assert.match(id, /^sq_\d+_[a-z0-9]+$/);
    assert.notEqual(id.endsWith("_"), true);
    assert.notEqual(id, `sq_${Date.now()}_`);
  } finally {
    Math.random = originalRandom;
  }
});

test("generateSquadCode avoids ambiguous zero and one digits", () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const code = generateSquadCode();
    assert.match(code, /^[A-Z]{3}-[2-9]{3}$/);
  } finally {
    Math.random = originalRandom;
  }
});
