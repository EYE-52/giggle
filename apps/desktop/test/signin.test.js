const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

function fixture({ search = "", production = false, fetch = async () => ({ ok: true }) } = {}) {
  const states = [], assigned = [], pushed = [], refs = [], timers = new Map(), storage = new Map();
  let cursor = 0, effects = [], timerId = 0, devCalls = 0, stateWrites = 0;
  const hooks = {
    useState(initial) { const index = cursor++; if (states[index] === undefined) states[index] = initial; return [states[index], value => { states[index] = value; stateWrites++; }]; },
    useRef(initial) { const index = cursor++; if (states[index] === undefined) states[index] = { current: initial }; return states[index]; },
    useEffect(callback) { effects.push(callback); },
    useCallback(callback) { return callback; },
  };
  const window = {
    location: { search, origin: "https://meet.example", assign: value => assigned.push(value) },
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const icon = () => null;
  const imports = {
    react: hooks,
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": "a",
    "next/navigation": { useRouter: () => ({ push: value => pushed.push(value) }) },
    "@/components/Brand": { Logomark: icon },
    "@/components/Icons": { Icon: new Proxy({}, { get: () => icon }) },
    "@giggle/core": { session: { async devSignIn() { devCalls++; } }, setPendingReferral: value => refs.push(value), getPendingReferral: () => null, BACKEND_URL: "https://api.example" },
    "./signin.module.css": new Proxy({}, { get: (_, key) => String(key) }),
  };
  const source = readFileSync(path.join(__dirname, "../app/signin/page.tsx"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "window", "sessionStorage", "process", "fetch", js)(name => imports[name], module, module.exports, window, { setItem: (key, value) => storage.set(key, value) }, { env: { NODE_ENV: production ? "production" : "development" } }, fetch);
  return {
    render() { cursor = 0; effects = []; return module.exports.default(); },
    runEffects: () => effects.map(callback => callback()),
    assigned, pushed, refs, timers, storage, devCalls: () => devCalls, stateWrites: () => stateWrites,
  };
}

function nodes(element) {
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (!element || typeof element !== "object") return [];
  return [element, ...nodes(element.props?.children)];
}
function text(element) {
  if (Array.isArray(element)) return element.map(text).join("");
  return typeof element === "object" && element ? text(element.props?.children) : typeof element === "string" ? element : "";
}
const button = (tree, name) => nodes(tree).find(node => node.type === "button" && text(node).includes(name));
const alert = tree => nodes(tree).find(node => node.props?.role === "alert");
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const redirect = { ok: false, status: 302, type: "opaqueredirect" };

test("sign-in keeps Google as the only live provider and omits development access in production", () => {
  const tree = fixture({ production: true }).render();
  assert.ok(button(tree, "Continue with Google"));
  assert.equal(button(tree, "Apple"), undefined);
  assert.equal(button(tree, "Use dev account"), undefined);
  assert.equal(nodes(tree).find(node => node.type === "h1").props.id, "signin-title");
  assert.equal(button(tree, "Google").props["aria-describedby"], "signin-profile-note");
});

test("real OAuth handoff keeps the referral and locks the provider until navigation", async () => {
  const calls = [];
  const f = fixture({ search: "?ref=%20crew42%20&next=%2Fdiscover", fetch: async (url, options) => { calls.push({ url, options }); return { ok: false, status: 302, type: "opaqueredirect" }; } });
  f.render(); f.runEffects();
  await button(f.render(), "Continue with Google").props.onClick();
  const tree = f.render();
  assert.deepEqual(f.refs, ["CREW42"]);
  assert.equal(calls[0].url, "https://meet.example/api/auth/google?ref=CREW42");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.signal.aborted, false);
  assert.deepEqual(f.assigned, [calls[0].url]);
  assert.equal(f.timers.size, 0);
  assert.equal(button(tree, "Opening Google").props.disabled, true);
  assert.equal(nodes(tree).find(node => node.type === "section").props["aria-busy"], true);
  assert.ok(nodes(tree).find(node => node.props?.role === "status"));
});

test("failed OAuth remains on the form with a readable retry and no navigation", async () => {
  let release;
  const f = fixture({ production: true, fetch: () => new Promise(resolve => { release = resolve; }) });
  const request = button(f.render(), "Continue with Google").props.onClick();
  assert.equal(button(f.render(), "Opening Google").props.disabled, true);
  release({ ok: false, status: 503, json: async () => ({ error: { code: "PROVIDER_NOT_CONFIGURED" } }) });
  await request;
  let tree = f.render();
  assert.match(text(nodes(tree).find(node => node.props?.role === "alert")), /Google sign-in is unavailable/);
  assert.deepEqual(f.assigned, []);
  assert.equal(f.timers.size, 0);
  assert.equal(button(tree, "Continue with Google").props.disabled, false);
  button(tree, "Try again").props.onClick();
  tree = f.render();
  assert.equal(nodes(tree).find(node => node.props?.role === "alert"), undefined);
});

test("a stuck OAuth request is cancelled before the watchdog unlocks the form", async () => {
  const pending = deferred();
  let signal;
  const f = fixture({ fetch: (_, options) => { signal = options.signal; return pending.promise; } });
  f.render(); const cleanups = f.runEffects();
  const request = button(f.render(), "Continue with Google").props.onClick();
  const timer = [...f.timers.values()][0];
  assert.equal(timer.delay, 8000);
  timer.callback();
  const tree = f.render();
  assert.equal(button(tree, "Continue with Google").props.disabled, false);
  assert.match(text(nodes(tree).find(node => node.props?.role === "alert")), /Taking longer than expected/);
  assert.equal(signal.aborted, true);
  assert.equal(f.timers.size, 0);
  pending.resolve(redirect); // Simulate a network implementation ignoring abort.
  await request;
  assert.deepEqual(f.assigned, []);
  cleanups.filter(Boolean).forEach(cleanup => cleanup());
  assert.equal(f.timers.size, 0);
});

test("a late redirect from the timed-out first attempt cannot navigate or unlock its retry", async () => {
  const first = deferred(), second = deferred(), calls = [];
  const f = fixture({ fetch: (_, options) => { calls.push(options); return calls.length === 1 ? first.promise : second.promise; } });
  const oldRequest = button(f.render(), "Continue with Google").props.onClick();
  [...f.timers.values()][0].callback();
  const currentRequest = button(f.render(), "Continue with Google").props.onClick();
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(calls[1].signal.aborted, false);
  assert.equal(f.timers.size, 1);
  const writes = f.stateWrites();
  first.resolve(redirect);
  await oldRequest;
  assert.deepEqual(f.assigned, []);
  assert.equal(f.stateWrites(), writes);
  assert.equal(button(f.render(), "Opening Google").props.disabled, true);
  assert.equal(alert(f.render()), undefined);
  second.resolve(redirect);
  await currentRequest;
  assert.deepEqual(f.assigned, ["https://meet.example/api/auth/google"]);
  assert.equal(f.timers.size, 0);
});

test("an old provider error body cannot replace the pending retry after a timeout", async () => {
  const body = deferred(), retry = deferred();
  let calls = 0, readingBody = false;
  const f = fixture({ fetch: async () => ++calls === 1
    ? { ok: false, status: 503, json: () => { readingBody = true; return body.promise; } }
    : retry.promise });
  const oldRequest = button(f.render(), "Continue with Google").props.onClick();
  await Promise.resolve();
  assert.equal(readingBody, true);
  [...f.timers.values()][0].callback();
  const currentRequest = button(f.render(), "Continue with Google").props.onClick();
  const writes = f.stateWrites();
  body.resolve({ error: { code: "PROVIDER_NOT_CONFIGURED" } });
  await oldRequest;
  assert.equal(f.stateWrites(), writes);
  assert.equal(alert(f.render()), undefined);
  assert.equal(button(f.render(), "Opening Google").props.disabled, true);
  retry.resolve(redirect);
  await currentRequest;
  assert.equal(f.assigned.length, 1);
});

test("a late network rejection from a retired attempt does not change the retry", async () => {
  const first = deferred(), second = deferred();
  let calls = 0;
  const f = fixture({ fetch: () => ++calls === 1 ? first.promise : second.promise });
  const oldRequest = button(f.render(), "Continue with Google").props.onClick();
  [...f.timers.values()][0].callback();
  const currentRequest = button(f.render(), "Continue with Google").props.onClick();
  const writes = f.stateWrites();
  first.reject(new Error("late network failure"));
  await oldRequest;
  assert.equal(f.stateWrites(), writes);
  assert.equal(alert(f.render()), undefined);
  assert.equal(button(f.render(), "Opening Google").props.disabled, true);
  second.resolve(redirect);
  await currentRequest;
  assert.equal(f.assigned.length, 1);
});

test("unmount aborts OAuth and removes its timer; late success and failure stay inert", async () => {
  for (const reject of [false, true]) {
    const pending = deferred();
    let signal;
    const f = fixture({ fetch: (_, options) => { signal = options.signal; return pending.promise; } });
    f.render(); const cleanups = f.runEffects();
    const request = button(f.render(), "Continue with Google").props.onClick();
    cleanups.filter(Boolean).forEach(cleanup => cleanup());
    assert.equal(signal.aborted, true);
    assert.equal(f.timers.size, 0);
    const writes = f.stateWrites();
    if (reject) pending.reject(new Error("aborted")); else pending.resolve(redirect);
    await request;
    assert.deepEqual(f.assigned, []);
    assert.equal(f.stateWrites(), writes);
  }
});

test("development sign-in preserves safe continuations and rejects external paths", async () => {
  for (const [search, destination] of [["?next=%2Fdiscover", "/discover"], ["?next=%2F%2Fevil.example", "/home"]]) {
    const f = fixture({ search });
    f.render(); f.runEffects();
    await button(f.render(), "Use dev account").props.onClick();
    assert.equal(f.devCalls(), 1);
    assert.deepEqual(f.pushed, [destination]);
  }
});
