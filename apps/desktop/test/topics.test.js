const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { classifyVibe } = require("../../../server/src/utils/moderation");
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../lib/topics.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const moduleExports = {};
new Function("exports", "require", compiled)(moduleExports, () => ({ classifyVibe }));
const { normalizeTopics, popularTopics, SUGGESTED_TOPICS } = moduleExports;

test("topics normalize casing, hashes, duplicates and five-topic limits", () => {
  assert.deepEqual(normalizeTopics(["#Music", " music ", " Gaming", "Art", "Study", "Sports", "Foodies"]), ["Music", "Gaming", "Art", "Study", "Sports"]);
  assert(SUGGESTED_TOPICS.every(t => classifyVibe(t) === "ok"));
});
test("popular topics count each squad once, sort actual counts, and exclude disallowed topics", () => {
  assert.deepEqual(popularTopics([
    { squadId: "a", tags: ["Music", "music", "NSFW"] },
    { squadId: "a", tags: ["Music"] },
    { squadId: "b", tags: ["Gaming", "Music"] },
    { squadId: "c", tags: ["Art", "ｎｓｆｗ"] },
  ]), [
    { key: "music", label: "Music", count: 2 },
    { key: "art", label: "Art", count: 1 },
    { key: "gaming", label: "Gaming", count: 1 },
  ]);
  assert.deepEqual(popularTopics([]), []);
});
