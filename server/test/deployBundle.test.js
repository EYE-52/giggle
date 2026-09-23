const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

// The deployed image is built from server/ minus .dockerignore (Railway's
// build honours it too). A require from src/ into an excluded path such as
// scripts/ or test/ works locally but crashes production (this took the API
// down once), so every relative require in src/ must stay inside the image.
const SERVER_ROOT = path.join(__dirname, "..");

function ignoredTopLevelEntries() {
  return readFileSync(path.join(SERVER_ROOT, ".dockerignore"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("!") && !/[*?]/.test(line))
    .map((line) => line.replace(/^\/+|\/+$/g, ""));
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith(".js") ? [full] : [];
  });
}

test("src/ only requires files that ship in the deployed image", () => {
  const ignored = new Set(ignoredTopLevelEntries());
  assert.ok(ignored.has("scripts") && ignored.has("test"), ".dockerignore should exclude scripts/ and test/");

  const violations = [];
  for (const file of sourceFiles(path.join(SERVER_ROOT, "src"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
      const target = path.relative(SERVER_ROOT, path.resolve(path.dirname(file), match[1]));
      const topLevel = target.split(path.sep)[0];
      if (target.startsWith("..") || ignored.has(topLevel)) {
        violations.push(`${path.relative(SERVER_ROOT, file)} requires ${match[1]}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
