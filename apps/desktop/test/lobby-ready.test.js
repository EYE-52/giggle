const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
// Run the actual lobby handlers with a small media/API boundary. No copy of
// their decision logic, browser permissions or provider calls lives here.
const source = fs.readFileSync(path.join(__dirname, "../app/(app)/lobby/page.tsx"), "utf8");
const syntax = ts.createSourceFile("lobby.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const wanted = new Set(["enableLobbyMedia", "updateMyReady", "handleReady", "completeDeviceSetup", "handleFindMatch", "proceedFindMatch", "fetchJoinRequests", "resetLobbySetup"]);
const functions = [];
function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && wanted.has(node.name?.text))
        functions.push(node.getText(syntax));
    ts.forEachChild(node, visit);
}
visit(syntax);
assert.equal(functions.length, wanted.size);
const code = ts.transpileModule(functions.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => {
    let resolve;
    const promise = new Promise(done => resolve = done);
    return { promise, resolve };
};
function fixture(options = {}) {
    const events = [], call = { squadId: "squad", encounterId: null, joined: !!options.joined,
        capture: { audio: options.joined ? "active" : "off", video: "off" } };
    let captureDenied = !!options.denied, readyFailure = !!options.readyFailure;
    const squadCall = {
        getSnapshot: () => call,
        async connect(id, encounter, requested) {
            events.push({ type: "connect", id, requested });
            const gate = options.connectGates?.shift() || options.connectGate;
            if (gate)
                await gate;
            if (options.connectError)
                throw Error("Could not connect your devices.");
            call.joined = true;
            call.capture.audio = captureDenied ? "denied" : "active";
            call.capture.video = requested.video ? (captureDenied ? "denied" : "active") : "off";
            state.connected();
        },
        async setDevice(id, kind) {
            events.push({ type: "retry-device", id, kind });
            call.capture[kind] = captureDenied ? "denied" : "active";
        },
    };
    const api = {
        async joinRequests() {
            if (options.pollGate)
                await options.pollGate;
            if (options.pollFailure)
                throw Error("Squad not found");
            return { requests: [] };
        },
        async setReady(id, ready) {
            events.push({ type: "ready", id, ready });
            const gate = options.readyGates?.shift() || options.readyGate;
            if (gate)
                await gate;
            if (readyFailure)
                throw Error("Ready could not be saved. Try again.");
        },
        async startSearch(id) { events.push({ type: "search", id }); },
    };
    const factory = new Function("api", "squadCall", "options", `
    const WEB_DISCOVERY_ENABLED=true, isLeader=!!options.leader, myUserId="viewer";
    let squadId = "squad";
    const session = {user:{id:"viewer"}};
    let squad = {isPrivatePair:!!options.pair, communicationMode:options.mode || "video",
      members:[{memberId:"self",userId:"viewer",role:"member",ready:!!options.ready}]};
    let settingReady=false, noCamEnabling=false, videoJoined=!!options.joined, videoJoining=false;
    let deviceAction="match", modal=false, matchError=null, videoError=null, findingMatch=false;
    const joinRequestsScopeRef={current:{active:true,generation:0}}, lobbyExitingRef={current:false};
    const setJoinReqs=()=>{}, pollSucceeded=()=>{}, pollFailed=()=>{options.pollFailures=(options.pollFailures||0)+1;};
    const console={error:()=>{options.pollErrors=(options.pollErrors||0)+1;}};
    const readyRequestPending={current:null}, deviceActionPending={current:null}, lobbyMediaGenerationRef={current:0};
    const isOwnGroupMember=(_group,member,id)=>member.userId===id;
    const setSquad=update=>{squad=update(squad);};
    const setSettingReady=value=>{settingReady=value;};
    const setMatchError=value=>{matchError=value;};
    const setVideoError=value=>{videoError=value;};
    const setNoCamEnabling=value=>{noCamEnabling=value;};
    const setNoCamConfirmOpen=value=>{modal=value;};
    const setDeviceAction=value=>{deviceAction=value;};
    const setFindingMatch=value=>{findingMatch=value;};
    const describeVideoError=error=>error.message;
    const router={push:()=>{}};
    ${code}
    return {handleReady,handleFindMatch,completeDeviceSetup,updateMyReady,fetchJoinRequests,
      closeChoice(){modal=false;}, leave(){lobbyExitingRef.current=true;},
      changeRoom(){
        squadId="next-squad";
        squad={...squad,members:[{memberId:"next-self",userId:"viewer",ready:false}]};
        squadCall.getSnapshot().squadId=squadId;
        resetLobbySetup();
      },
      unmount(){joinRequestsScopeRef.current={active:false,generation:1};},
      connected(){videoJoined=true;}, invalidate(){lobbyMediaGenerationRef.current++;},
      snapshot(){return {ready:squad.members[0].ready,modal,deviceAction,matchError,videoError,settingReady,noCamEnabling};}};
  `);
    const state = factory(api, squadCall, options);
    return { ...state, events, call, allowCapture() { captureDenied = false; }, allowReady() { readyFailure = false; } };
}
test("Ready asks for a device choice before capture or readiness; audio-only joins then marks ready", async () => {
    const f = fixture();
    assert.deepEqual(f.events, []);
    await f.handleReady();
    assert.equal(f.snapshot().modal, true);
    assert.equal(f.snapshot().deviceAction, "ready");
    assert.deepEqual(f.events, []);
    assert.equal(f.snapshot().ready, false);
    await f.completeDeviceSetup(false);
    assert.deepEqual(f.events.map(event => event.type), ["connect", "ready"]);
    assert.deepEqual(f.events[0].requested, { audio: true, video: false });
    assert.equal(f.snapshot().ready, true);
    assert.equal(f.snapshot().modal, false);
});
test("capture denial never marks ready and a successful retry finishes the same choice", async () => {
    const f = fixture({ denied: true });
    await f.handleReady();
    await f.completeDeviceSetup(true);
    assert.equal(f.snapshot().modal, true);
    assert.equal(f.snapshot().ready, false);
    assert.equal(f.events.some(event => event.type === "ready"), false);
    f.allowCapture();
    await f.completeDeviceSetup(false);
    assert.deepEqual(f.events.map(event => event.type), ["connect", "retry-device", "ready"]);
    assert.equal(f.snapshot().ready, true);
    assert.equal(f.snapshot().modal, false);
});
test("a failed ready write rolls back and keeps its device dialog retryable", async () => {
    const f = fixture({ readyFailure: true });
    await f.handleReady();
    await f.completeDeviceSetup(false);
    assert.equal(f.snapshot().ready, false);
    assert.equal(f.snapshot().modal, true);
    assert.match(f.snapshot().matchError, /Try again/);
    f.allowReady();
    await f.completeDeviceSetup(false);
    assert.equal(f.snapshot().ready, true);
    assert.equal(f.snapshot().modal, false);
    assert.equal(f.events.filter(event => event.type === "connect").length, 1);
});
test("leaving during device connection cannot mark the old squad ready", async () => {
    const gate = deferred(), f = fixture({ connectGate: gate.promise });
    await f.handleReady();
    const pending = f.completeDeviceSetup(false);
    f.invalidate();
    gate.resolve();
    await pending;
    assert.equal(f.events.some(event => event.type === "ready"), false);
});
test("ready requests are single-flight and Not ready needs no device capture", async () => {
    const gate = deferred(), f = fixture({ joined: true, readyGate: gate.promise });
    const a = f.updateMyReady(true), b = f.updateMyReady(true);
    gate.resolve();
    await Promise.all([a, b]);
    assert.equal(f.events.filter(event => event.type === "ready").length, 1);
    const off = fixture({ ready: true });
    await off.handleReady();
    assert.deepEqual(off.events, [{ type: "ready", id: "squad", ready: false }]);
});
test("pairs and voice/chat groups cannot enter matching readiness; leader continuation still searches", async () => {
    for (const options of [{ pair: true }, { mode: "voice" }, { mode: "chat" }]) {
        const f = fixture(options);
        await f.handleReady();
        assert.deepEqual(f.events, []);
        assert.equal(f.snapshot().modal, false);
    }
    const leader = fixture();
    await leader.completeDeviceSetup(false);
    assert.deepEqual(leader.events.map(event => event.type), ["connect", "ready", "search"]);
});
test("leader cancel or device denial does not mark Ready; connected choice readies before search", async () => {
    const f = fixture({ leader: true });
    await f.handleFindMatch();
    assert.equal(f.snapshot().modal, true);
    assert.equal(f.snapshot().ready, false);
    assert.deepEqual(f.events, []);
    f.closeChoice();
    assert.equal(f.snapshot().ready, false);
    const denied = fixture({ leader: true, denied: true });
    await denied.handleFindMatch();
    await denied.completeDeviceSetup(false);
    assert.equal(denied.snapshot().ready, false);
    assert.equal(denied.snapshot().modal, true);
    assert.equal(denied.events.some(event => event.type === "ready" || event.type === "search"), false);
    denied.allowCapture();
    await denied.completeDeviceSetup(false);
    assert.deepEqual(denied.events.map(event => event.type), ["connect", "retry-device", "ready", "search"]);
    const joined = fixture({ leader: true, joined: true });
    await joined.handleFindMatch();
    assert.deepEqual(joined.events.map(event => event.type), ["ready", "search"]);
});
test("join-request polling ignores late leave/unmount errors but reports active-room failures", async () => {
    for (const retire of ["leave", "unmount"]) {
        const gate = deferred(), options = { pollGate: gate.promise, pollFailure: true }, f = fixture(options);
        const pending = f.fetchJoinRequests();
        f[retire]();
        gate.resolve();
        await pending;
        assert.equal(options.pollErrors, undefined);
        assert.equal(options.pollFailures, undefined);
    }
    const active = { pollFailure: true }, f = fixture(active);
    await f.fetchJoinRequests();
    assert.equal(active.pollErrors, 1);
    assert.equal(active.pollFailures, 1);
});

test("room switch clears old readiness busy state without an old completion unlocking the new request", async () => {
    const oldGate = deferred();
    const newGate = deferred();
    const f = fixture({ joined: true, readyGates: [oldGate.promise, newGate.promise] });
    const oldRequest = f.updateMyReady(true);
    assert.equal(f.snapshot().settingReady, true);
    f.changeRoom();
    assert.equal(f.snapshot().settingReady, false);
    assert.equal(f.snapshot().modal, false);
    const newRequest = f.updateMyReady(true);
    assert.equal(f.snapshot().settingReady, true);
    oldGate.resolve();
    assert.equal(await oldRequest, false);
    assert.equal(f.snapshot().settingReady, true);
    assert.equal(await f.updateMyReady(true), false);
    assert.equal(f.events.filter(event => event.type === "ready").length, 2);
    newGate.resolve();
    assert.equal(await newRequest, true);
    assert.equal(f.snapshot().settingReady, false);
});

test("room switch clears device setup and late old capture cannot unlock or close a new choice", async () => {
    const oldGate = deferred();
    const newGate = deferred();
    const f = fixture({ connectGates: [oldGate.promise, newGate.promise] });
    await f.handleReady();
    const oldSetup = f.completeDeviceSetup(false);
    assert.equal(f.snapshot().noCamEnabling, true);
    f.changeRoom();
    assert.equal(f.snapshot().noCamEnabling, false);
    assert.equal(f.snapshot().settingReady, false);
    assert.equal(f.snapshot().modal, false);
    await f.handleReady();
    const newSetup = f.completeDeviceSetup(false);
    assert.equal(f.snapshot().noCamEnabling, true);
    oldGate.resolve();
    await oldSetup;
    assert.equal(f.snapshot().noCamEnabling, true);
    assert.equal(f.snapshot().modal, true);
    await f.completeDeviceSetup(false);
    assert.equal(f.events.filter(event => event.type === "connect").length, 2);
    assert.equal(f.events.some(event => event.type === "ready"), false);
    newGate.resolve();
    await newSetup;
    assert.equal(f.snapshot().noCamEnabling, false);
    assert.equal(f.snapshot().modal, false);
    assert.deepEqual(f.events.filter(event => event.type === "ready"), [{type:"ready",id:"next-squad",ready:true}]);
});
