const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function load(hooks, window) {
  const source = readFileSync(path.join(__dirname, "../components/useViewport.ts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "window", js)(() => hooks, module, module.exports, window);
  return module.exports;
}

test("chat takeover matches phone CSS and avoids three squeezed tablet columns", () => {
  const { chatUsesStage } = load({});
  for (const width of [320, 390, 641, 699]) assert.equal(chatUsesStage(width, 844, false), true);
  assert.equal(chatUsesStage(700, 844, false), false);
  assert.equal(chatUsesStage(720, 844, false, true), true);
  assert.equal(chatUsesStage(721, 844, false, true), false);
  assert.equal(chatUsesStage(844, 390, false), true, "short phone landscape matches call CSS");
  assert.equal(chatUsesStage(950, 500, false), true);
  assert.equal(chatUsesStage(951, 500, false), false);
  for (const lobby of [false, true]) {
    for (const width of [768, 820, 1024, 1179]) assert.equal(chatUsesStage(width, 768, true, lobby), true);
    assert.equal(chatUsesStage(1180, 768, true, lobby), false, "wide screens retain simultaneous game, video and chat");
  }
});

test("visual keyboard inset reserves only obscured space and leaves pinch zoom alone", () => {
  const { visualViewportInset } = load({});
  assert.equal(visualViewportInset(844, null), 0);
  assert.equal(visualViewportInset(844, { height: 510, offsetTop: 0, scale: 1 }), 334);
  assert.equal(visualViewportInset(844, { height: 510, offsetTop: 64, scale: 1 }), 270);
  assert.equal(visualViewportInset(844, { height: 422, offsetTop: 0, scale: 2 }), 0);
  assert.equal(visualViewportInset(844, { height: 900, offsetTop: 0, scale: 1 }), 0);
  assert.equal(visualViewportInset(844, { height: NaN, offsetTop: 0, scale: 1 }), 0);
});

test("the production viewport hook handles iframe-keyboard resize, offset changes and cleanup", () => {
  const emitter = fields => Object.assign(fields, { listeners: new Map(), addEventListener(type, fn) { this.listeners.set(type, fn); }, removeEventListener(type, fn) { if (this.listeners.get(type) === fn) this.listeners.delete(type); }, fire(type) { this.listeners.get(type)?.(); } });
  const visualViewport = emitter({ height: 844, offsetTop: 0, scale: 1 });
  const window = emitter({ innerWidth: 390, innerHeight: 844, visualViewport });
  const states = []; let cursor = 0, effect;
  const hooks = { useState(initial) { const index = cursor++; if (states[index] === undefined) states[index] = initial; return [states[index], value => { states[index] = value; }]; }, useEffect(fn) { effect = fn; } };
  const { useViewport } = load(hooks, window);
  const render = () => { cursor = 0; return useViewport(); };
  assert.equal(render().viewportInset, 0, "SSR starts without a browser-derived inset");
  const cleanup = effect();
  assert.equal(render().width, 390);
  visualViewport.height = 510; visualViewport.fire("resize");
  assert.equal(render().viewportInset, 334, "game iframe focus needs no parent chat-open flag");
  visualViewport.offsetTop = 20; visualViewport.fire("scroll");
  assert.equal(render().viewportInset, 314);
  visualViewport.height = 700; visualViewport.offsetTop = 0; window.innerWidth = 1024; window.innerHeight = 700; window.fire("resize");
  assert.equal(render().width, 1024);
  assert.equal(render().viewportInset, 0);
  cleanup();
  assert.equal(window.listeners.size, 0);
  assert.equal(visualViewport.listeners.size, 0);
});
