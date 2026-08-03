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
  assert.match(component, /chip: \{[^}]*minHeight: 44/);
});

test("native back controls keep accessible 44 point touch targets", () => {
  for (const route of ["app/(app)/discover.tsx", "app/(app)/premium.tsx", "app/(app)/profile.tsx"]) {
    const page = read(route);

    assert.equal(page.includes('accessibilityRole="button"'), true, route);
    assert.equal(page.includes('accessibilityLabel="Go back"'), true, route);
    assert.match(page, /back: \{[^}]*minHeight: 44/, route);
    assert.match(page, /back: \{[^}]*minWidth: 44/, route);
    assert.match(page, /back: \{[^}]*alignSelf: 'flex-start'/, route);
  }
});

test("native discover filters keep accessible 44 point touch targets", () => {
  const page = read("app/(app)/discover.tsx");

  assert.equal(page.includes('accessibilityLabel={`Filter ${f}`}'), true);
  assert.match(page, /filterChip: \{[^}]*minHeight: 44/);
});

test("native profile vibe picker exposes its close action as a button", () => {
  const page = read("app/(app)/profile.tsx");
  const start = page.indexOf("onPress={() => setVibeModalVisible(false)}");
  const closeAction = page.slice(page.lastIndexOf("<TouchableOpacity", start), page.indexOf("</TouchableOpacity>", start));

  assert.equal(closeAction.includes('accessibilityRole="button"'), true);
  assert.equal(closeAction.includes('accessibilityLabel="Close vibe picker"'), true);
});
