const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

// Run the production component's hooks, message handler and rendered Retry.
// The frame models identity only; this does not exercise browser layout or RTC.
function mountPanel() {
  const slots = [], effects = [], timers = new Map(), listeners = new Map(), posted = [];
  let cursor = 0, dirty = false, tree, frame = null, timerId = 0, unavailable = false;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const i = cursor++;
      slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, value => {
        slots[i].value = typeof value === "function" ? value(slots[i].value) : value;
        dirty = true;
      }];
    },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { value: fn(), deps };
      return slots[i].value;
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = cursor++;
      if (!same(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: fn() };
      });
    },
  };
  const window = {
    location: { origin: "https://meet.example" },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
  };
  const api = { gameToken: async () => {
    if (unavailable) throw { status: 503 };
    return { gameUrl: "https://games.example", ticket: "test-ticket" };
  } };
  const jsx = (type, props, key) => ({ type, props, key });
  const clock = (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; };
  function load(file, requireStub) {
    const source = readFileSync(path.join(__dirname, file), "utf8");
    const js = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const module = { exports: {} };
    new Function("require", "module", "exports", "window", "process", "setTimeout", "clearTimeout", "setInterval", "clearInterval", js)(
      requireStub, module, module.exports, window,
      { env: { NODE_ENV: "production", NEXT_PUBLIC_GAMES_URL: "https://games.example" } },
      clock, id => timers.delete(id), clock, id => timers.delete(id),
    );
    return module.exports;
  }
  const bridge = load("../lib/gameBridge.ts", name => { throw Error(name); });
  const { GamePanel } = load("../components/GamePanel.tsx", name => {
    if (name === "react") return hooks;
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name === "@giggle/core") return { api };
    if (name === "@/lib/gameBridge") return bridge;
    if (name.endsWith("useTheme")) return { useTheme: () => "light" };
    if (name.endsWith("Button")) return { Button: "button" };
    if (name.endsWith(".css")) return { default: {} };
    throw Error(name);
  });
  const all = node => !node || typeof node !== "object" ? [] :
    [node, ...[].concat(node.props?.children ?? []).flatMap(all)];
  function render() {
    cursor = 0; dirty = false;
    tree = GamePanel({ squadId: "squad", onClose() {} });
    const next = all(tree).find(node => node.type === "iframe");
    if (!next || frame?.key !== next.key) {
      if (frame) frame.ref.current = null;
      frame = next ? { key: next.key, ref: next.props.ref, contentWindow: { postMessage: msg => posted.push(msg) } } : null;
    }
    if (frame) next.props.ref.current = frame;
    for (const effect of effects.splice(0)) effect();
  }
  async function settle() {
    for (let i = 0; i < 12; i++) { if (dirty) render(); await Promise.resolve(); }
    if (dirty) render();
  }
  render();
  return {
    settle, timers, listeners,
    get status() { return tree.props["data-status"]; },
    get frameKey() { return frame?.key; },
    set unavailable(value) { unavailable = value; },
    message(data) { listeners.get("message")({ source: frame?.contentWindow, origin: "https://games.example", data }); },
    ack() { const auth = posted.filter(msg => msg.t === "auth").at(-1); assert.ok(auth); this.message({ v: 1, t: "authed", n: auth.n }); },
    retry() { const button = all(tree).find(node => node.type === "button" && node.props.children === "Retry"); assert.ok(button); button.props.onClick(); },
    timer(ms) { const timer = [...timers.values()].find(item => item.ms === ms); assert.ok(timer); timer.fn(); },
    failFrame() { all(tree).find(node => node.type === "iframe").props.onError(); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("Retry reloads a blank replacement after an unavailable renewal retires the live frame", async () => {
  const panel = mountPanel();
  await panel.settle();
  panel.message({ v: 1, t: "ready" }); await panel.settle();
  panel.ack(); await panel.settle();
  assert.equal(panel.status, "live");
  panel.unavailable = true;
  panel.timer(60_000); await panel.settle();
  assert.equal(panel.status, "unavailable");
  assert.equal(panel.frameKey, undefined, "the previously heard iframe was retired");
  panel.unavailable = false;
  panel.retry(); await panel.settle();
  const blankKey = panel.frameKey;
  panel.timer(20_000); await panel.settle();
  assert.equal(panel.status, "error");
  panel.retry(); await panel.settle();
  assert.equal(panel.frameKey, blankKey + 1, "the never-answered replacement must reload");
  panel.unmount();
});

test("Retry preserves a heard live frame, and unmount removes auth timers and message listeners", async () => {
  const panel = mountPanel();
  await panel.settle();
  panel.message({ v: 1, t: "ready" }); await panel.settle();
  panel.ack(); await panel.settle();
  const liveKey = panel.frameKey;
  panel.failFrame(); await panel.settle();
  panel.retry(); await panel.settle();
  assert.equal(panel.frameKey, liveKey);
  panel.ack(); await panel.settle();
  assert.equal(panel.status, "live");
  panel.unmount();
  assert.equal(panel.timers.size, 0);
  assert.equal(panel.listeners.size, 0);
});
