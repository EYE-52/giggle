const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function handler(file, name) {
  const syntax = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(syntax);
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  assert.ok(found, `Missing ${name}`);
  return compile(found);
}
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function lobbyFixture(getSquad) {
  const state = { squad: null, error: null, loading: true, routes: [], failures: 0 };
  const scope = { current: { squadId: "one", active: true, generation: 1, request: 0 } };
  const make = new Function("api", "squadId", "squadScopeRef", "state", `
    const lobbyExitingRef={current:false};
    const setSquad=value=>state.squad=value, setLoadError=value=>state.error=value;
    const setLoading=value=>state.loading=value, setVisibility=()=>{},setJoinPolicy=()=>{};
    const pollSucceeded=()=>{},pollFailed=()=>state.failures++;
    const discoveryEnabledNow=()=>false,router={replace:route=>state.routes.push(route)};
    const console={error:()=>{}};
    ${handler("app/(app)/lobby/page.tsx", "fetchSquad")}
    return fetchSquad;
  `);
  return { state, scope, fetch: make({ getSquad }, "one", scope, state), forRoom: id => make({ getSquad }, id, scope, state) };
}

test("a first lobby network failure stays retryable and a successful retry clears it", async () => {
  let failed = true;
  const f = lobbyFixture(async () => {
    if (failed) throw Error("Offline");
    return { squadId: "one" };
  });
  await f.fetch();
  assert.equal(f.state.loading, false);
  assert.match(f.state.error, /connection/);
  assert.deepEqual(f.state.routes, []);
  failed = false;
  await f.fetch();
  assert.equal(f.state.error, null);
  assert.equal(f.state.squad.squadId, "one");
});

test("closed or forbidden lobbies keep their existing home exit", async () => {
  for (const status of [403, 404]) {
    const f = lobbyFixture(async () => { throw Object.assign(Error("Gone"), { status }); });
    await f.fetch();
    assert.deepEqual(f.state.routes, ["/home"]);
    assert.equal(f.state.error, null);
  }
});

test("an older room response and stale old-room refresh cannot overwrite the new room", async () => {
  const old = deferred();
  const calls = [];
  const f = lobbyFixture(async id => {
    calls.push(id);
    return id === "one" ? old.promise : { squadId: id };
  });
  const pending = f.fetch();
  f.scope.current = { squadId: "two", active: true, generation: 2, request: 0 };
  await f.forRoom("two")();
  old.resolve({ squadId: "one" });
  await pending;
  await f.fetch();
  assert.equal(f.state.squad.squadId, "two");
  assert.deepEqual(calls, ["one", "two"]);
});

test("the latest lobby refresh wins over a slower previous refresh", async () => {
  const first = deferred();
  let calls = 0;
  const f = lobbyFixture(async () => ++calls === 1 ? first.promise : { squadId: "one", squadName: "New name" });
  const pending = f.fetch();
  await f.fetch();
  first.resolve({ squadId: "one", squadName: "Old name" });
  await pending;
  assert.equal(f.state.squad.squadName, "New name");
});

test("retrying an invite after squad creation never creates a second squad", async () => {
  const state = { creates: 0, invites: 0, error: "", routes: [], open: true, pending: "" };
  const run = new Function("state", `
    const action={current:false}, name="Friday", topics=[],communicationMode="video",matching=false;
    const inviteAfterCreate={userId:"friend",name:"Sam"};let createdSquadId=null;
    const ensureAuthed=()=>true,setPending=value=>state.pending=value,setCreateError=value=>state.error=value;
    const setCreatedSquadId=value=>createdSquadId=value,setReload=()=>{},setCreateOpen=value=>state.open=value;
    const api={createSquad:async()=>{state.creates++;return {squadId:"created"};},
      inviteUserToSquad:async()=>{if(++state.invites===1)throw Error("Offline");}};
    const window={location:{search:""}},router={push:route=>state.routes.push(route)};
    const withGameIntent=route=>route,readGameIntent=()=>null,readGamesIntent=()=>false;
    const message=(error,fallback)=>error.message||fallback;
    ${handler("app/(app)/home/page.tsx", "create")}
    return create;
  `)(state);
  await run();
  assert.equal(state.creates, 1);
  assert.equal(state.open, true);
  assert.match(state.error, /squad is ready.*couldn't invite Sam/);
  assert.deepEqual(state.routes, []);
  await run();
  assert.equal(state.creates, 1);
  assert.equal(state.invites, 2);
  assert.equal(state.open, false);
  assert.deepEqual(state.routes, ["/lobby?squad=created"]);
});

test("chat composers keep separate drafts for each room and preserve controlled drafts", () => {
  const slots = [];
  let cursor = 0;
  const useState = initial => {
    const index = cursor++;
    if (!(index in slots)) slots[index] = initial;
    return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
  };
  const jsx = (type, props) => ({ type, props });
  const react = { useState, useEffect() {}, useRef: value => ({ current: value }), useCallback: fn => fn, useMemo: fn => fn(), useId: () => "emoji" };
  const stubs = {
    react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@giggle/core": { session: { user: { id: "me" } }, chatMessageMatchesScope: () => true },
    "@/components/Icons": { Icon: new Proxy({}, { get: () => () => null }) },
    "./ChatPanel.module.css": { default: {} },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", compile(read("components/ChatPanel.tsx")))(name => stubs[name] ?? {}, module, module.exports);
  function find(node, type) {
    if (!node || typeof node !== "object") return;
    if (node.type === type) return node;
    for (const child of [node.props?.children].flat(Infinity)) {
      const result = find(child, type);
      if (result) return result;
    }
  }
  function input(squadId, extra = {}) {
    cursor = 0;
    return find(module.exports.ChatPanel({ scope: { kind: "lobby", squadId }, ...extra }), "input").props;
  }
  input("one").onChange({ target: { value: "For room one" } });
  assert.equal(input("two").value, "");
  input("two").onChange({ target: { value: "For room two" } });
  assert.equal(input("one").value, "For room one");
  assert.equal(input("two").value, "For room two");
  let controlled;
  input("two", { draft: "Controlled", onDraftChange: value => { controlled = value; } }).onChange({ target: { value: "New controlled" } });
  assert.equal(controlled, "New controlled");
  assert.equal(input("two").value, "For room two");
});
