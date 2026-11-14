const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = name => readFileSync(path.join(__dirname, name), "utf8");
const css = read("../app/skins/palettes.css");
const sourceCss = read("../../../design/skins/base.css");
const swatches = read("../lib/look.ts");
const paletteIds = ["raspberry", "grape", "lagoon", "moss", "honey", "petrol"];

function paletteTokens(source, palette, mode) {
  const marker = `[data-palette="${palette}"][data-mode="${mode}"]`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${palette} ${mode} is defined`);
  const body = source.slice(source.indexOf("{", start) + 1, source.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[\da-f]+)/gi)].map(match => [match[1], match[2]]));
}

function luminance(hex) {
  const digits = hex.slice(1);
  const full = digits.length === 3 ? [...digits].map(char => char + char).join("") : digits;
  const channels = full.match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels.reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

for (const palette of paletteIds) {
  for (const mode of ["light", "dark"]) {
    test(`${palette} ${mode} enabled primary text passes 4.5:1 at rest and on hover`, () => {
      const tokens = paletteTokens(css, palette, mode);
      for (const state of ["--brand", "--brand-deep"]) {
        const ratio = contrast(tokens[state], tokens["--on-brand"]);
        assert.ok(ratio >= 4.5, `${state} ${tokens[state]} / ${tokens["--on-brand"]}: ${ratio.toFixed(3)}:1`);
      }
      // Native disabled controls are exempt from the text contrast floor;
      // opacity-dimmed disabled paint must not drive enabled palette colors.
      const approved = paletteTokens(sourceCss, palette, mode);
      for (const token of ["--brand", "--brand-deep", "--on-brand"]) assert.equal(tokens[token], approved[token]);
    });
  }
}

test("Appearance swatches use the same light and dark primary colors as CSS", () => {
  for (const palette of paletteIds) {
    const entry = swatches.match(new RegExp(`\\{ id: "${palette}",[^\\n]+brandLight: "(#[\\da-f]+)", brandDark: "(#[\\da-f]+)"`, "i"));
    assert.ok(entry, `${palette} swatches are defined`);
    assert.equal(entry[1], paletteTokens(css, palette, "light")["--brand"]);
    assert.equal(entry[2], paletteTokens(css, palette, "dark")["--brand"]);
  }
});

test("legacy Honey and Lagoon primary corrections remain readable when applied", () => {
  const overrides = read("../app/skins/port-overrides.css");
  for (const palette of ["honey", "lagoon"]) {
    const block = overrides.match(new RegExp(`html:not\\(\\[data-skin="paper"\\]\\)\\[data-palette="${palette}"\\]\\[data-mode="light"\\] \\.btn-primary \\{[^}]+background: (#[\\da-f]+);`, "i"));
    assert.ok(block, `${palette} legacy correction is still scoped to light primaries`);
    assert.ok(contrast(block[1], paletteTokens(css, palette, "light")["--on-brand"]) >= 4.5);
  }
});
