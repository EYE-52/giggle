const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function harness() {
  const effects = [];
  const document = {
    body: { style: { overflow: "clip" } }, activeElement: null,
    querySelector: () => null,
  };
  const emitter = target => Object.assign(target, {
    listeners: new Set(),
    addEventListener(type, fn) { this.listeners.add(fn); },
    removeEventListener(type, fn) { this.listeners.delete(fn); },
    fire(event) { for (const fn of this.listeners) fn(event); },
  });
  emitter(document);
  const window = emitter({});
  let nextRef;
  const hooks = {
    useEffect: fn => effects.push(fn), useId: () => "dialog-title",
    useRef: () => ({ current: nextRef }), useState: fn => [fn()],
  };
  const source = readFileSync(path.join(__dirname, "../components/Modal.tsx"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const module = { exports: {} };
  const requireStub = id => id === "react" ? hooks : id === "react-dom" ? { createPortal: node => node } :
    id === "./Icons" ? { Icon: { close: () => null } } : require(id);
  new Function("require", "module", "exports", "document", "window", "getComputedStyle", js)(
    requireStub, module, module.exports, document, window, el => ({ visibility: el.visibility || "visible" }),
  );
  const flush = () => effects.splice(0).map(fn => fn());
  const element = (extra = {}) => ({
    tabIndex: 0, isConnected: true,
    matches() { return !!this.disabled; }, closest() { return this.hidden || this.inert ? this : null; },
    getClientRects() { return this.noLayout ? [] : [{}]; },
    focus() { document.activeElement = this; },
    ...extra,
  });
  const container = (nodes = []) => element({
    nodes, querySelectorAll() { return this.nodes; },
    contains(node) { return node === this || this.nodes.includes(node); },
  });
  const key = (key, shiftKey = false) => ({ key, shiftKey, prevented: false, preventDefault() { this.prevented = true; } });
  const modal = (card, onClose) => { nextRef = card; const tree = module.exports.Modal({ onClose, children: "content" }); return { tree, cleanup: flush() }; };
  return { ...module.exports, document, window, flush, element, container, key, modal };
}

test("dialog entry skips hidden, inert, disabled and non-tabbable controls", () => {
  const h = harness();
  const unavailable = [{ hidden: true }, { inert: true }, { disabled: true }, { noLayout: true }, { visibility: "hidden" }, { tabIndex: -1 }].map(h.element);
  const first = h.element(); const last = h.element(); const card = h.container([...unavailable, first, last]);
  h.useFocusTrap({ current: card }, true, { current: unavailable[0] }); const [cleanup] = h.flush();
  assert.equal(h.document.activeElement, first);
  card.focus(); const backwards = h.key("Tab", true); h.document.fire(backwards);
  assert.equal(backwards.prevented, true); assert.equal(h.document.activeElement, last);
  const forwards = h.key("Tab"); h.document.fire(forwards);
  assert.equal(forwards.prevented, true); assert.equal(h.document.activeElement, first);
  cleanup();
});

test("empty dialogs contain Tab and explicit headings can receive initial focus", () => {
  const h = harness(); const heading = h.element({ tabIndex: -1 }); const card = h.container([heading]);
  h.useFocusTrap({ current: card }, true, { current: heading }); const [cleanup] = h.flush();
  assert.equal(h.document.activeElement, heading);
  const event = h.key("Tab"); h.document.fire(event);
  assert.equal(event.prevented, true); assert.equal(h.document.activeElement, card);
  cleanup();
});

test("only the top dialog traps Tab and closing it restores the parent control", () => {
  const h = harness(); const launch = h.element(); launch.focus();
  const parentButton = h.element(); const parent = h.container([parentButton]);
  h.useFocusTrap({ current: parent }); const [closeParent] = h.flush();
  const childButton = h.element(); const child = h.container([childButton]);
  h.useFocusTrap({ current: child }); const [closeChild] = h.flush();
  const tab = h.key("Tab"); h.document.fire(tab);
  assert.equal(h.document.activeElement, childButton);
  closeChild(); assert.equal(h.document.activeElement, parentButton);
  closeParent(); assert.equal(h.document.activeElement, launch);
});

test("removing a covered dialog does not steal focus or release the scroll lock", () => {
  const h = harness(); const parent = h.container([h.element()]); const childButton = h.element(); const child = h.container([childButton]);
  h.useBodyScrollLock(); h.useFocusTrap({ current: parent }); const parentCleanup = h.flush();
  h.useBodyScrollLock(); h.useFocusTrap({ current: child }); const childCleanup = h.flush();
  parentCleanup.forEach(fn => fn());
  assert.equal(h.document.activeElement, childButton); assert.equal(h.document.body.style.overflow, "hidden");
  parent.nodes[0].isConnected = false;
  childCleanup.forEach(fn => fn()); assert.equal(h.document.body.style.overflow, "clip");
  h.useBodyScrollLock(); const [cleanup] = h.flush(); cleanup();
  h.useBodyScrollLock(); const [replayCleanup] = h.flush();
  assert.equal(h.document.body.style.overflow, "hidden"); replayCleanup();
  assert.equal(h.document.body.style.overflow, "clip", "effect replay retains the original body style");
});

test("Escape and backdrop clicks close only the topmost shared Modal", () => {
  const h = harness(); let parentCloses = 0; let childCloses = 0;
  const parent = h.modal(h.container([h.element()]), () => parentCloses++);
  const child = h.modal(h.container([h.element()]), () => childCloses++);
  h.window.fire(h.key("Escape"));
  assert.equal(parentCloses, 0); assert.equal(childCloses, 1);
  const backdrop = tree => tree.props.onClick({ target: tree, currentTarget: tree });
  backdrop(parent.tree); assert.equal(parentCloses, 0);
  backdrop(child.tree); assert.equal(childCloses, 2);
  child.cleanup.forEach(fn => fn()); h.window.fire(h.key("Escape"));
  assert.equal(parentCloses, 1);
  parent.cleanup.forEach(fn => fn()); assert.equal(h.document.body.style.overflow, "clip");
});
