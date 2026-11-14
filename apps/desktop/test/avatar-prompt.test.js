const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../app/(app)/layout.tsx"), "utf8");
const syntax = ts.createSourceFile("layout.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isFunctionExpression(node) && node.name?.text === "syncAvatarPrompt") effect = node.getText(syntax);
  ts.forEachChild(node, visit);
}
visit(syntax);
assert.ok(effect);
const code = ts.transpileModule(effect, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function fixture({ pathname = "/home", search = "", hash = "", prompted = false, selected = false } = {}) {
  let visible = false;
  let dialog = null;
  let pending;
  let synced = 0;
  const storage = new Map(prompted ? [["giggle.avatarPrompted", "1"]] : []);
  const window = {
    location: { search, hash },
    requestAnimationFrame(callback) { pending = callback; return 1; },
    cancelAnimationFrame() { pending = null; },
  };
  const run = new Function("window", "document", "localStorage", "reconcileMyAvatar", "setAvatarPrompt", "pathname", `
    const authReady=true,hasAdultAccess=true,session={user:{avatar:${selected ? '"chosen"' : "null"}}};
    const AVATAR_PROMPTED_KEY="giggle.avatarPrompted";
    ${code}
    return syncAvatarPrompt();
  `);
  const cleanup = run(window, { querySelector: () => dialog }, { getItem: key => storage.get(key) },
    () => { synced++; return !selected; }, value => { visible = value; }, pathname);
  return {
    cleanup, storage,
    flush() { const callback = pending; pending = null; callback?.(); },
    openDialog() { dialog = {}; },
    visible: () => visible,
    synced: () => synced,
  };
}

test("optional avatar setup does not interrupt create, join, game or call intent", () => {
  for (const options of [
    { search: "?create=1&match=1" }, { search: "?game=chess" },
    { search: "?games=1" }, { hash: "#invite=private" },
    ...["/lobby", "/encounter", "/matchmaking", "/match", "/groups/new", "/friends"].map(pathname => ({ pathname })),
  ]) {
    const f = fixture(options);
    f.flush();
    assert.equal(f.visible(), false, JSON.stringify(options));
    assert.equal(f.synced(), 1, "avatar sync still runs on intent routes");
    assert.equal(f.storage.has("giggle.avatarPrompted"), false, "deferring does not dismiss the prompt");
  }
});

test("plain Home/profile can show the first picker without covering another dialog", () => {
  for (const pathname of ["/home", "/profile"]) {
    const f = fixture({ pathname });
    assert.equal(f.visible(), false, "page dialogs get the first frame");
    f.flush();
    assert.equal(f.visible(), true);
    const occupied = fixture({ pathname });
    occupied.openDialog();
    occupied.flush();
    assert.equal(occupied.visible(), false);
  }
});

test("saved dismissal, selected avatar, and route cleanup prevent another prompt", () => {
  for (const options of [{ prompted: true }, { selected: true }]) {
    const f = fixture(options);
    f.flush();
    assert.equal(f.visible(), false);
  }
  const cancelled = fixture();
  cancelled.cleanup();
  cancelled.flush();
  assert.equal(cancelled.visible(), false);
});
