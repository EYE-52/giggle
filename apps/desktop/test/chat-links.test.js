const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const moduleSource = ts.transpileModule(readFileSync(path.join(__dirname, "../lib/chatLinks.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
new Function("module", "exports", moduleSource)(loaded, loaded.exports);
const { chatTextParts } = loaded.exports;

test("chat links preserve message text and punctuation", () => {
  for (const text of ["hi 👋", "", "Play https://skribbl.io/?vUC2qvRO, then https://example.com/a?x=1&y=2!", "(https://example.com/wiki/Hello_(world))"]) {
    assert.equal(chatTextParts(text).map(part => part.text).join(""), text);
  }
  assert.deepEqual(chatTextParts("(https://example.com/wiki/Hello_(world))"), [
    { text: "(" }, { text: "https://example.com/wiki/Hello_(world)", href: "https://example.com/wiki/Hello_(world)" }, { text: ")" },
  ]);
});
test("chat links do not activate unsafe protocols, credentials or markup", () => {
  for (const text of ["javascript:alert(1)", "data:text/html,<script>oops</script>", "https://user:secret@example.com", "https://", "<img src=x onerror=alert(1)>"]) {
    assert.equal(chatTextParts(text).some(part => part.href), false);
  }
  assert.equal(chatTextParts("HTTPS://example.com")[0].href, "HTTPS://example.com");
});
