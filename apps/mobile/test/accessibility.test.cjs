const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (relativePath) => readFileSync(path.join(__dirname, "..", relativePath), "utf8");

test("shared mobile button exposes accessible button semantics", () => {
  const component = read("components/Button.tsx");

  assert.equal(component.includes('accessibilityRole="button"'), true);
  assert.equal(component.includes("accessibilityLabel={accessibilityLabel ?? label}"), true);
  assert.equal(component.includes("accessibilityState={{ disabled: Boolean(disabled) }}"), true);
});

test("mobile vibe chip exposes selectable button semantics", () => {
  const component = read("components/VibeChip.tsx");

  assert.equal(component.includes('accessibilityRole="button"'), true);
  assert.equal(component.includes("accessibilityLabel={label}"), true);
  assert.equal(component.includes("accessibilityState={{ selected: active }}"), true);
});
