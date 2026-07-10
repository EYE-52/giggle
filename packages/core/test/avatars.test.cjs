const assert = require("node:assert/strict");
const test = require("node:test");

test("custom avatars only accept safe image data URLs", async () => {
  const { isCustomAvatar } = await import("../src/avatars.ts");

  assert.equal(isCustomAvatar("data:image/png;base64,aaaa"), true);
  assert.equal(isCustomAvatar("data:image/jpeg;base64,aaaa"), true);
  assert.equal(isCustomAvatar("data:image/webp;base64,aaaa"), true);

  assert.equal(isCustomAvatar("data:text/html;base64,PHNjcmlwdA=="), false);
  assert.equal(isCustomAvatar("data:image/svg+xml;base64,PHN2Zy8+"), false);
  assert.equal(isCustomAvatar("javascript:alert(1)"), false);
  assert.equal(isCustomAvatar("violet-blob"), false);
  assert.equal(isCustomAvatar("x".repeat(2_000_001)), false);
});

test("stored avatars ignore legacy unsafe localStorage values", async () => {
  const { DEFAULT_AVATAR_ID, getMyAvatar } = await import("../src/avatars.ts");
  const originalWindow = global.window;
  const store = new Map([["giggle.avatar", "data:text/html;base64,PHNjcmlwdA=="]]);

  global.window = {
    localStorage: {
      getItem: (key) => store.get(key) ?? null,
    },
  };
  global.localStorage = global.window.localStorage;

  try {
    assert.equal(getMyAvatar(), DEFAULT_AVATAR_ID);
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
    delete global.localStorage;
  }
});
