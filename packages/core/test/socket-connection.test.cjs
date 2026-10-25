const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setImmediate: flush } = require("node:timers/promises");
const test = require("node:test");
const ts = require("typescript");

test("shared socket callers send one handshake while awaiting auth and preserve reconnect rooms", async () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "giggle-socket-connection-"));
  let runtime;
  try {
    for (const name of ["socket", "report"]) {
      const source = readFileSync(path.join(__dirname, `../src/${name}.ts`), "utf8");
      writeFileSync(path.join(temp, `${name}.js`), ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText);
    }
    writeFileSync(path.join(temp, "config.js"), 'exports.BACKEND_URL = "http://127.0.0.1:1";');
    writeFileSync(path.join(temp, "client.js"), 'exports.getAuthToken = () => Promise.resolve("synthetic-socket-test-token");');
    mkdirSync(path.join(temp, "node_modules"));
    symlinkSync(path.dirname(require.resolve("socket.io-client/package.json")), path.join(temp, "node_modules/socket.io-client"), "dir");
    runtime = require(path.join(temp, "socket.js"));
    const socket = runtime.getSocket();
    const manager = socket.io;
    const packets = [];
    // Keep the real Socket.IO client, but control transport/ACK timing without a network.
    manager.open = () => { manager._readyState = "open"; return manager; };
    manager._packet = packet => packets.push(packet);
    const accept = sid => manager.emitReserved("packet", { type: 0, nsp: "/", data: { sid } });
    const joins = () => packets.filter(packet => packet.type === 2).map(packet => packet.data);

    runtime.connectSocket("blocked");
    await flush();
    assert.equal(packets.length, 0, "adult access still gates the first connection");

    runtime.setAdultAccessGetter(() => true);
    runtime.connectSocket("squad-a");
    runtime.joinChat({ kind: "encounter", squadId: "squad-a", encounterId: "encounter-a" });
    const stopChat = runtime.subscribeChat(() => {});
    const stopReactions = runtime.subscribeReaction(() => {});
    await flush();
    assert.equal(socket.connected, false, "the server has not acknowledged the namespace");
    assert.deepEqual(packets.map(packet => packet.type), [0], "concurrent callers must not duplicate CONNECT packets");
    accept("first-session");
    assert.equal(socket.connected, true);
    assert.deepEqual(joins(), [["join_squad", "squad-a"], ["join_encounter", "encounter-a"]]);

    packets.length = 0;
    manager._readyState = "closed";
    manager.emitReserved("close", "transport close");
    runtime.connectSocket("squad-b");
    await flush();
    assert.equal(packets.length, 0, "callers must leave automatic reconnect scheduling to the manager");
    manager._readyState = "open";
    manager.emitReserved("open");
    await flush();
    assert.deepEqual(packets.map(packet => packet.type), [0]);
    accept("reconnected-session");
    assert.deepEqual(joins(), [["join_squad", "squad-a"], ["join_squad", "squad-b"], ["join_encounter", "encounter-a"]]);

    runtime.disconnectSocket();
    assert.equal(socket.active, false);
    packets.length = 0;
    runtime.connectSocket("fresh-squad");
    await flush();
    assert.deepEqual(packets.map(packet => packet.type), [0], "intentional disconnect permits a fresh handshake");
    accept("fresh-session");
    assert.deepEqual(joins(), [["join_squad", "fresh-squad"]], "intentional disconnect clears stale rooms");
    stopChat();
    stopReactions();
  } finally {
    runtime?.disconnectSocket();
    rmSync(temp, { recursive: true, force: true });
  }
});
