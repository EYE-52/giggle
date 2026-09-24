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

test("people without a shared avatar get a stable seeded character", async () => {
  const { parseCharacter, defaultAvatarFor, resolveAvatar } = await import("../src/avatars.ts");

  for (const seed of ["507f1f77bcf86cd799439011", "u2", "Maya Chen", ""]) {
    const avatar = defaultAvatarFor(seed);
    assert.equal(avatar, defaultAvatarFor(seed));
    assert.match(avatar, /^giggle:v1:/);
    assert.ok(parseCharacter(avatar), `${avatar} should parse as a character`);
    assert.equal(resolveAvatar(null, seed), avatar);
    assert.equal(resolveAvatar("not-an-avatar", seed), avatar);
    assert.equal(resolveAvatar("https://lh3.googleusercontent.com/a/photo", seed), avatar);
  }
  assert.ok(parseCharacter(resolveAvatar(null, "x")), "no-avatar fallback is a character");
  assert.equal(resolveAvatar("coral-star", "x"), "coral-star");
  assert.equal(resolveAvatar("mint-bolt", "u2"), "mint-bolt");
});

test("every legacy avatar id maps to a stable, valid character", async () => {
  const { DEFAULT_AVATARS, legacyCharacterFor, validateCharacter } = await import("../src/avatars.ts");

  for (const { id } of DEFAULT_AVATARS) {
    const config = legacyCharacterFor(id);
    assert.ok(config, `${id} should map to a character`);
    assert.deepEqual(config, validateCharacter(config), `${id} should pass validateCharacter`);
    assert.deepEqual(legacyCharacterFor(id), config, `${id} mapping should be stable`);
  }
  assert.equal(legacyCharacterFor("not-a-legacy-id"), null);
});

test("seededCharacterFor is deterministic and valid for 200 random seeds", async () => {
  const { seededCharacterFor, validateCharacter, defaultAvatarFor, parseCharacter } = await import("../src/avatars.ts");
  let state = 987654321;
  const random = () => { state = (state * 1103515245 + 12345) % 2147483648; return state; };

  for (let i = 0; i < 200; i++) {
    const seed = `seed-${random()}`;
    const config = seededCharacterFor(seed);
    assert.deepEqual(seededCharacterFor(seed), config, `${seed} should be deterministic`);
    assert.deepEqual(config, validateCharacter(config), `${seed} should pass validateCharacter`);
    assert.equal(config.animated, true);
    for (const value of [config.faceWidth, config.eyeSize, config.eyeSpacing, config.browTilt, config.noseSize, config.mouthWidth]) {
      assert.ok(value >= 40 && value <= 60, `${seed} proportion ${value} should stay within 40–60`);
    }
  }

  const avatar = defaultAvatarFor("507f1f77bcf86cd799439011");
  assert.match(avatar, /^giggle:v1:/);
  assert.ok(parseCharacter(avatar), "defaultAvatarFor should return a parseable character string");
});

test("all 12 character presets are valid and use only playground palette colors", async () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const { CHARACTER_PRESETS, validateCharacter } = await import("../src/avatars.ts");

  const source = readFileSync(join(__dirname, "../../../apps/desktop/app/avatar-playground/page.tsx"), "utf8");
  const palettes = {};
  for (const key of ["skin", "hairColor", "shirtColor", "accessoryColor", "accent"]) {
    const match = source.match(new RegExp(`${key}: \\[([^\\]]+)\\]`));
    assert.ok(match, `the playground source should define the ${key} palette`);
    palettes[key] = match[1].match(/#[0-9a-f]{6}/gi).map((color) => color.toLowerCase());
  }

  assert.equal(CHARACTER_PRESETS.length, 12);
  assert.equal(CHARACTER_PRESETS.filter((preset) => preset.playground).length, 3, "the playground trio stays marked");
  const seen = { hair: new Set(), face: new Set(), skin: new Set(), clothing: new Set() };
  let withGlasses = 0, withFacialHair = 0, withHeadwearOrEarrings = 0;
  for (const preset of CHARACTER_PRESETS) {
    const config = validateCharacter(preset.config);
    assert.ok(config, `${preset.name} should pass validateCharacter`);
    assert.deepEqual(preset.config, config, `${preset.name} should already be normalized`);
    for (const key of ["skin", "hairColor", "shirtColor", "accessoryColor", "accent"]) {
      assert.ok(palettes[key].includes(config[key]), `${preset.name} ${key} ${config[key]} must come from the ${key} palette`);
    }
    seen.hair.add(config.hair);
    seen.face.add(config.face);
    seen.skin.add(config.skin);
    seen.clothing.add(config.clothing);
    if (config.glasses !== "none") withGlasses += 1;
    if (config.facialHair !== "none") withFacialHair += 1;
    if (config.headwear !== "none" || config.earrings !== "none") withHeadwearOrEarrings += 1;
  }
  assert.equal(seen.hair.size, 8, "presets cover all 8 hairstyles");
  assert.equal(seen.face.size, 3, "presets cover all 3 face shapes");
  assert.equal(seen.skin.size, 8, "presets spread all 8 skin tones");
  assert.equal(seen.clothing.size, 5, "presets cover all 5 outfits");
  assert.ok(withGlasses >= 2, "some presets wear glasses");
  assert.ok(withFacialHair >= 2, "a couple of presets have facial hair");
  assert.ok(withHeadwearOrEarrings >= 2, "a couple of presets wear headwear or earrings");
});
