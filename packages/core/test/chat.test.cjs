const assert = require("node:assert/strict");
const test = require("node:test");
test("chat keeps public call messages separate from private squad messages", async () => {
  const { chatMessageMatchesScope: matches } = await import("../src/chat.ts");
  const privateScope = { kind: "lobby", squadId: "mine" };
  const callScope = { kind: "encounter", encounterId: "call", squadId: "mine" };
  for (const [message, squad, call] of [
    [{ squadId: "mine" }, true, false],
    [{ squadId: "theirs" }, false, false],
    [{ squadId: "mine", encounterId: "call" }, false, true],
    [{ squadId: "theirs", encounterId: "call" }, false, true],
    [{ squadId: "mine", encounterId: "old-call" }, false, false],
    [{}, false, false],
  ]) {
    assert.equal(matches(message, privateScope), squad);
    assert.equal(matches(message, callScope), call);
  }
});

test("mergeChatMessage collapses a pending message into its server acknowledgement", async () => {
  const { mergeChatMessage } = await import("../src/chat.ts");
  const pending = { id: "client-1", clientMessageId: "client-1", userId: "u1", name: "A", text: "hi", ts: 1, squadId: "s1" };
  const delivered = { id: "server-1", clientMessageId: "client-1", userId: "u1", name: "A", text: "hi", ts: 2, squadId: "s1", delivery: "delivered" };
  const result = mergeChatMessage([pending], delivered);
  assert.deepEqual(result, [{ ...pending, ...delivered }]);
});

test("same client id from another user or scope remains a separate message", async () => {
  const { mergeChatMessage } = await import("../src/chat.ts");
  const base = { id: "", clientMessageId: "same", userId: "u1", name: "A", text: "one", ts: 1, squadId: "s1" };
  const otherUser = { ...base, userId: "u2", text: "two" };
  const otherSquad = { ...base, squadId: "s2", text: "three" };
  const encounter = { ...base, encounterId: "e1", text: "four" };
  const result = mergeChatMessage([base], otherUser);
  const result2 = mergeChatMessage(result, otherSquad);
  const result3 = mergeChatMessage(result2, encounter);
  assert.equal(result.length, 2);
  assert.equal(result2.length, 3);
  assert.equal(result3.length, 4);
});

test("encounter scope is used when either candidate has an encounter", async () => {
  const { mergeChatMessage } = await import("../src/chat.ts");
  const privateMessage = { id: "", clientMessageId: "same", userId: "u1", name: "A", text: "private", ts: 1, squadId: "s1" };
  const callMessage = { ...privateMessage, encounterId: "e1", text: "call" };
  assert.equal(mergeChatMessage([privateMessage], callMessage).length, 2);
});

test("preserves order, caps history, and does not mutate inputs", async () => {
  const { mergeChatMessage } = await import("../src/chat.ts");
  const history = Array.from({ length: 4 }, (_, i) => ({ id: `m${i}`, userId: "u", name: "A", text: `${i}`, ts: i, squadId: "s" }));
  const snapshot = history.map((message) => ({ ...message }));
  const result = mergeChatMessage(history, { id: "m4", userId: "u", name: "A", text: "4", ts: 4, squadId: "s" }, 3);
  assert.deepEqual(result.map((message) => message.id), ["m2", "m3", "m4"]);
  assert.deepEqual(history, snapshot);
  assert.notEqual(result, history);
});

test("validates sensible limits", async () => {
  const { mergeChatMessage } = await import("../src/chat.ts");
  const message = { id: "m", userId: "u", name: "A", text: "x", ts: 1, squadId: "s" };
  for (const limit of [0, -1, 1.5, NaN, Infinity, 10001]) {
    assert.throws(() => mergeChatMessage([], message, limit), RangeError);
  }
  assert.deepEqual(mergeChatMessage([], message, 1), [message]);
});
