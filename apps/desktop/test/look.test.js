const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

/* lib/look.ts is TypeScript; transpile it on the fly and run it in a sandbox
   with fake browser globals so validation/migration logic is tested for real
   (the "use client" directive and react import are stubbed out). Fakes stay
   installed until restore() runs, because the module's functions read
   window/localStorage lazily at call time. */
const source = readFileSync(path.join(__dirname, "../lib/look.ts"), "utf8");

function loadLook({ storage = new Map(), matchMedia } = {}) {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const requireStub = (id) => {
    if (id === "react") return { useSyncExternalStore: () => { throw new Error("useLook is not exercised in unit tests"); } };
    if (id === "@/components/phosphorPaths") return {};
    throw new Error(`unexpected require: ${id}`);
  };
  const saved = {
    localStorage: global.localStorage,
    document: global.document,
    window: global.window,
    MutationObserver: global.MutationObserver,
  };
  global.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  if (matchMedia) global.window = { matchMedia: (q) => matchMedia(q) };
  const restore = () => Object.assign(global, saved);
  new Function("require", "module", "exports", js)(requireStub, module, module.exports);
  return { look: module.exports, restore };
}

test("skin and palette registries match the approved design META lines", () => {
  const { look, restore } = loadLook();
  try {
    assert.deepEqual(
      look.SKINS.map((s) => [s.id, s.name, s.iconWeight, s.defaultPalette]),
      [
        ["soft", "Soft Depth", "bold", "honey"],
        ["play", "Bold Play", "bold", "raspberry"],
        ["paper", "Doodle", "bold", "honey"],
        ["clay", "Clay", "fill", "grape"],
        ["scrap", "Scrapbook", "bold", "lagoon"],
      ],
    );
    assert.deepEqual(look.PALETTES.map((p) => p.id), ["raspberry", "grape", "lagoon", "moss", "honey", "petrol"]);
    assert.deepEqual(look.DEFAULT_LOOK, { skin: "soft", palette: "honey", mode: "auto" });
  } finally {
    restore();
  }
});

test("parseLook accepts full and partial looks and rejects junk", () => {
  const { look, restore } = loadLook();
  try {
    assert.deepEqual(look.parseLook({ skin: "paper", palette: "grape", mode: "dark" }), { skin: "paper", palette: "grape", mode: "dark" });
    assert.deepEqual(look.parseLook('{"skin":"clay","palette":"petrol","mode":"auto"}'), { skin: "clay", palette: "petrol", mode: "auto" });
    assert.deepEqual(look.parseLook({ skin: "play" }), { skin: "play" });
    assert.deepEqual(look.parseLook({ skin: "bogus", palette: "nope", mode: "blue" }), null);
    assert.deepEqual(look.parseLook("not json"), null);
    assert.deepEqual(look.parseLook(null), null);
    assert.deepEqual(look.parseLook(["soft"]), null);
    assert.deepEqual(look.parseLook({}), null);
  } finally {
    restore();
  }
});

test("legacy giggle.theme values migrate to modes", () => {
  const { look, restore } = loadLook();
  try {
    assert.deepEqual(look.migrateTheme("dark"), { mode: "dark" });
    assert.deepEqual(look.migrateTheme("light"), { mode: "light" });
    assert.deepEqual(look.migrateTheme("together"), null);
    assert.deepEqual(look.migrateTheme("tangerine"), null);
    assert.deepEqual(look.migrateTheme(undefined), null);
  } finally {
    restore();
  }
});

test("readLook defaults, reads, migrates and repairs", () => {
  const cases = [
    [new Map(), { skin: "soft", palette: "honey", mode: "auto" }],
    [new Map([["giggle.look", JSON.stringify({ skin: "scrap", palette: "moss", mode: "dark" })]]), { skin: "scrap", palette: "moss", mode: "dark" }],
    // Legacy giggle.theme migrates when no look is stored.
    [new Map([["giggle.theme", "dark"]]), { skin: "soft", palette: "honey", mode: "dark" }],
    // A broken stored look falls back to the legacy migration…
    [new Map([["giggle.look", "{oops"], ["giggle.theme", "light"]]), { skin: "soft", palette: "honey", mode: "light" }],
    // …and retired legacy values fall back to the defaults.
    [new Map([["giggle.look", JSON.stringify({ skin: "junk", palette: "junk", mode: "junk" })], ["giggle.theme", "together"]]), { skin: "soft", palette: "honey", mode: "auto" }],
    // Partial stored looks keep their valid fields.
    [new Map([["giggle.look", JSON.stringify({ palette: "lagoon" })]]), { skin: "soft", palette: "lagoon", mode: "auto" }],
  ];
  for (const [storage, expected] of cases) {
    const { look, restore } = loadLook({ storage });
    try {
      assert.deepEqual(look.readLook(), expected);
    } finally {
      restore();
    }
  }
});

test("resolveMode passes light/dark through and resolves auto from the system", () => {
  const plain = loadLook();
  try {
    assert.equal(plain.look.resolveMode("light"), "light");
    assert.equal(plain.look.resolveMode("dark"), "dark");
    // No window (SSR) → auto resolves to light.
    assert.equal(plain.look.resolveMode("auto"), "light");
  } finally {
    plain.restore();
  }
  const darkSystem = loadLook({ matchMedia: () => ({ matches: true }) });
  try {
    assert.equal(darkSystem.look.resolveMode("auto"), "dark");
  } finally {
    darkSystem.restore();
  }
  const lightSystem = loadLook({ matchMedia: () => ({ matches: false }) });
  try {
    assert.equal(lightSystem.look.resolveMode("auto"), "light");
  } finally {
    lightSystem.restore();
  }
});

test("applyLook writes attributes, storage and the legacy data-theme bridge", () => {
  const storage = new Map();
  const { look, restore } = loadLook({ storage, matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }) });
  const attrs = new Map();
  const previousDocument = global.document;
  global.document = { documentElement: { setAttribute: (k, v) => attrs.set(k, v) } };
  try {
    const resolved = look.applyLook({ skin: "clay", palette: "grape", mode: "auto" });
    assert.equal(resolved, "dark");
    assert.equal(attrs.get("data-skin"), "clay");
    assert.equal(attrs.get("data-palette"), "grape");
    assert.equal(attrs.get("data-mode"), "dark");
    assert.equal(attrs.get("data-theme"), "dark");
    assert.equal(storage.get("giggle.look"), JSON.stringify({ skin: "clay", palette: "grape", mode: "auto" }));

    // An invalid look falls back to the stored one instead of breaking.
    const fallback = look.applyLook({ skin: "nope", palette: "nope", mode: "nope" });
    assert.equal(fallback, "dark");
    assert.equal(storage.get("giggle.look"), JSON.stringify({ skin: "clay", palette: "grape", mode: "auto" }));
  } finally {
    global.document = previousDocument;
    restore();
  }
});

test("public/theme-init.js mirrors look.ts validation and migration pre-paint", () => {
  const { look, restore } = loadLook();
  try {
    const init = readFileSync(path.join(__dirname, "../public/theme-init.js"), "utf8");

    // Same registries + default as lib/look.ts…
    for (const skin of look.SKINS) assert.ok(init.includes(`"${skin.id}"`), `theme-init knows skin ${skin.id}`);
    for (const palette of look.PALETTES) assert.ok(init.includes(`"${palette.id}"`), `theme-init knows palette ${palette.id}`);
    assert.match(init, /DEFAULT_LOOK = \{ skin: "soft", palette: "honey", mode: "auto" \}/);

    // …sets every attribute applyLook sets, including the legacy data-theme…
    for (const attr of ["data-skin", "data-palette", "data-mode", "data-theme"]) {
      assert.ok(init.includes(`setAttribute("${attr}"`), `theme-init sets ${attr}`);
    }
    // …migrates giggle.theme dark/light and ignores the retired themes…
    assert.match(init, /localStorage\.getItem\("giggle\.theme"\)/);
    assert.match(init, /legacy === "dark" \|\| legacy === "light"/);
    // …resolves auto against prefers-color-scheme and keeps it live.
    assert.match(init, /prefers-color-scheme: dark/);
    assert.match(init, /addEventListener\("change", apply\)/);
  } finally {
    restore();
  }
});
