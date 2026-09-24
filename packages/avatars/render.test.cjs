const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");

// Use the repository's existing TypeScript compiler; no test transform dependency.
const { outputText } = ts.transpileModule(readFileSync(`${__dirname}/src/index.tsx`, "utf8"), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
});
const compiled = {};
const logo = {};
const logoCode = ts.transpileModule(readFileSync(`${__dirname}/../ui-tokens/src/logo.ts`, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
new Function("exports", logoCode)(logo);
new Function("require", "exports", outputText)((name) => name === "../../ui-tokens/src/logo" ? logo : require(name), compiled);

test("every character variant renders with unique IDs and accessible motion controls", () => {
  const characters = ["crop", "curls", "bob", "swoop"].flatMap((hair) =>
    ["smile", "laugh", "wink", "surprised"].map((expression) =>
      createElement(compiled.GiggleAvatar, { key: `${hair}-${expression}`, hair, expression, animated: false, label: "" }),
    ),
  );
  const html = renderToStaticMarkup(createElement("div", null, characters));
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 16);
  assert.equal(new Set(ids).size, 16);
  assert.equal((html.match(/aria-hidden="true"/g) || []).length, 32); // Decorative avatar and shared shirt emblem.
  assert.equal((html.match(/data-animated="false"/g) || []).length, 16);
  assert.match(html, /prefers-reduced-motion: reduce/);
  const labeled = renderToStaticMarkup(createElement(compiled.GiggleAvatar, { label: "My character" }));
  assert.match(labeled, /role="img"/);
  assert.match(labeled, /<title id="[^"]+">My character<\/title>/);
});

test("proportions stay finite and bounded for imported settings", () => {
  const render = (props) => renderToStaticMarkup(createElement(compiled.GiggleAvatar, { ...props, label: "", animated: false }));
  const lower = render({ faceWidth: -100, eyeSize: -10, noseSize: -5 });
  const bounded = render({ faceWidth: 0, eyeSize: 0, noseSize: 0 });
  const normalizeIds = (html) => html.replace(/_R_[^_]*_/g, "ID");
  assert.equal(normalizeIds(lower), normalizeIds(bounded));
  assert.doesNotMatch(render({ eyeSize: NaN, faceWidth: Infinity, mouthWidth: -Infinity }), /NaN|Infinity/);
  for (const face of ["soft", "round", "angular"]) {
    for (const hair of ["curls", "crop", "bob", "swoop", "buzz", "bald"]) {
      const html = render({ face, hair, glasses: "square", facialHair: "beard", freckles: true, eyeSpacing: 100, eyeSize: 100, faceWidth: 0 });
      assert.doesNotMatch(html, /NaN|undefined/);
      assert.match(html, /<svg/);
    }
  }
});

test("wardrobe renders all clothing, headwear and earring combinations", () => {
  for (const clothing of ["tee", "hoodie", "sweater", "jacket", "collared"]) for (const headwear of ["none", "beanie", "cap"]) for (const earrings of ["none", "studs", "hoops"]) {
    const html = renderToStaticMarkup(createElement(compiled.GiggleAvatar, { clothing, headwear, earrings, hair: "long", animated: false }));
    assert.doesNotMatch(html, /NaN|undefined/);
    for (const path of logo.logoPaths) assert.ok(html.includes(path), "Shared logo stays on every garment");
  }
});
