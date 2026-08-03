const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const mongoose = require("mongoose");
const User = require("../src/models/User");
const notificationModule = require("../src/models/Notification");

const IDS = [
  "507f1f77bcf86cd799439011",
  "507f1f77bcf86cd799439012",
  "507f1f77bcf86cd799439013",
  "507f1f77bcf86cd799439014",
  "507f1f77bcf86cd799439015",
  "507f1f77bcf86cd799439016",
  "507f1f77bcf86cd799439017",
  "507f1f77bcf86cd799439018",
  "507f1f77bcf86cd799439019",
  "507f1f77bcf86cd799439020",
];

const service = () => require("../src/services/interactionSafetyService");

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function controller() {
  const controllerPath = require.resolve("../src/controllers/friendsController");
  delete require.cache[controllerPath];
  return require(controllerPath);
}

test("user schema stores blocked account ids", () => {
  assert.ok(User.schema.path("blockedUserIds"));
  assert.equal(User.schema.path("blockedUserIds").caster.instance, "String");
});

test("pair decisions are symmetric", () => {
  const { hasBlockedPair } = service();
  const [a, b] = IDS;

  assert.equal(hasBlockedPair({ _id: a, blockedUserIds: [b] }, { _id: b, blockedUserIds: [] }), true);
  assert.equal(hasBlockedPair({ _id: a, blockedUserIds: [] }, { _id: b, blockedUserIds: [a] }), true);
  assert.equal(hasBlockedPair({ _id: a, blockedUserIds: [] }, { _id: b, blockedUserIds: [] }), false);
});

test("loadBlockState uses the minimal projection", async () => {
  const { loadBlockState } = service();
  const [a, b] = IDS;
  let query;
  let projection;
  const FakeUser = {
    find(nextQuery, nextProjection) {
      query = nextQuery;
      projection = nextProjection;
      return { lean: async () => [{ _id: a, blockedUserIds: [b] }, { _id: b, blockedUserIds: [] }] };
    },
  };

  const state = await loadBlockState([a, b], { User: FakeUser });

  assert.deepEqual(query, { _id: { $in: [a, b] } });
  assert.equal(projection, "_id blockedUserIds");
  assert.equal(state.get(a).blockedUserIds[0], b);
});

test("interaction boundaries fail closed for missing users and database errors", async () => {
  const { anyBlockedPair, filterBlockedCandidates } = service();
  const [a, b] = IDS;
  const MissingUser = {
    find: () => ({ lean: async () => [{ _id: a, blockedUserIds: [] }] }),
  };
  const BrokenUser = {
    find: () => ({ lean: async () => { throw new Error("database unavailable"); } }),
  };

  assert.equal(await anyBlockedPair([a, b], { User: MissingUser }), true);
  assert.deepEqual(await filterBlockedCandidates(a, [b], { User: MissingUser }), []);
  assert.equal(await anyBlockedPair([a, b], { User: BrokenUser }), true);
  assert.deepEqual(await filterBlockedCandidates(a, [b], { User: BrokenUser }), []);
});

test("filterBlockedCandidates removes blocks in either direction", async () => {
  const { filterBlockedCandidates } = service();
  const [viewer, blockedByViewer, blocksViewer, allowed] = IDS;
  const docs = [
    { _id: viewer, blockedUserIds: [blockedByViewer] },
    { _id: blockedByViewer, blockedUserIds: [] },
    { _id: blocksViewer, blockedUserIds: [viewer] },
    { _id: allowed, blockedUserIds: [] },
  ];
  const FakeUser = { find: () => ({ lean: async () => docs }) };

  assert.deepEqual(
    await filterBlockedCandidates(viewer, [blockedByViewer, blocksViewer, allowed], { User: FakeUser }),
    [allowed]
  );
});

test("block input rejects empty, duplicate, oversized, self, and malformed targets before lookup", async () => {
  const { blockUsers } = controller();
  const myId = IDS[0];
  const invalidBodies = [
    { userIds: [] },
    { userIds: [IDS[1], IDS[1]] },
    { userIds: [IDS[1], IDS[1].toUpperCase()] },
    { userIds: IDS.slice(1, 10) },
    { userIds: [myId] },
    { userIds: ["not-an-object-id"] },
  ];
  const originalFind = User.find;
  let lookups = 0;
  User.find = () => { lookups += 1; return { lean: async () => [] }; };

  try {
    for (const body of invalidBodies) {
      const res = response();
      await blockUsers({ user: { userId: myId }, body }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, "INVALID_REQUEST");
    }
    assert.equal(lookups, 0);
  } finally {
    User.find = originalFind;
  }
});

test("block rejects a missing target without changing relationships", async () => {
  const { blockUsers } = controller();
  const [myId, targetId] = IDS;
  const originalFind = User.find;
  const originalUpdateOne = User.updateOne;
  let updates = 0;
  User.find = () => ({ lean: async () => [] });
  User.updateOne = async () => { updates += 1; };

  try {
    const res = response();
    await blockUsers({ user: { userId: myId }, body: { userIds: [targetId] } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
    assert.equal(updates, 0);
  } finally {
    User.find = originalFind;
    User.updateOne = originalUpdateOne;
  }
});

test("block atomically records blocks and cleans both relationship directions and notifications", async () => {
  const [myId, targetA, targetB] = IDS;
  const originalFind = User.find;
  const originalUpdateOne = User.updateOne;
  const originalUpdateMany = User.updateMany;
  const originalTransaction = mongoose.connection.transaction;
  const originalDeleteBetween = notificationModule.deleteNotificationsBetweenUsers;
  const originalEmit = notificationModule.emitNotificationsChanged;
  const writes = [];
  let transactionCount = 0;
  let deletion;
  const session = { transaction: true };

  User.find = () => ({ lean: async () => [{ _id: targetA }, { _id: targetB }] });
  User.updateOne = async (...args) => { writes.push(["one", ...args]); return { modifiedCount: 1 }; };
  User.updateMany = async (...args) => { writes.push(["many", ...args]); return { modifiedCount: 2 }; };
  mongoose.connection.transaction = async (work) => { transactionCount += 1; return work(session); };
  notificationModule.deleteNotificationsBetweenUsers = async (...args) => { deletion = args; return { deletedCount: 2 }; };
  notificationModule.emitNotificationsChanged = () => {};

  try {
    const { blockUsers } = controller();
    const res = response();
    await blockUsers({ user: { userId: myId }, body: { userIds: [targetA, targetB] } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, { status: "blocked", userIds: [targetA, targetB] });
    assert.equal(transactionCount, 1);
    assert.deepEqual(writes[0], [
      "one",
      { _id: myId },
      {
        $addToSet: { blockedUserIds: { $each: [targetA, targetB] } },
        $pull: {
          friends: { $in: [targetA, targetB] },
          friendRequestsIncoming: { $in: [targetA, targetB] },
          friendRequestsOutgoing: { $in: [targetA, targetB] },
        },
      },
      { session },
    ]);
    assert.deepEqual(writes[1], [
      "many",
      { _id: { $in: [targetA, targetB] } },
      {
        $pull: {
          friends: myId,
          friendRequestsIncoming: myId,
          friendRequestsOutgoing: myId,
        },
      },
      { session },
    ]);
    assert.deepEqual(deletion, [myId, [targetA, targetB], { session }]);
  } finally {
    User.find = originalFind;
    User.updateOne = originalUpdateOne;
    User.updateMany = originalUpdateMany;
    mongoose.connection.transaction = originalTransaction;
    notificationModule.deleteNotificationsBetweenUsers = originalDeleteBetween;
    notificationModule.emitNotificationsChanged = originalEmit;
    delete require.cache[require.resolve("../src/controllers/friendsController")];
  }
});

test("unblock is idempotent and list exposes only safe account fields", async () => {
  const [myId, targetId] = IDS;
  const originalFindById = User.findById;
  const originalFind = User.find;
  const originalUpdateOne = User.updateOne;
  const updates = [];

  User.findById = (id) => ({
    lean: async () => String(id) === myId
      ? { _id: myId, blockedUserIds: [targetId] }
      : { _id: targetId },
  });
  User.find = () => ({
    lean: async () => [{ _id: targetId, name: "Blocked person", image: "avatar-1", email: "private@example.com" }],
  });
  User.updateOne = async (...args) => { updates.push(args); return { modifiedCount: updates.length === 1 ? 1 : 0 }; };

  try {
    const { unblockUser, listBlockedUsers } = controller();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = response();
      await unblockUser({ user: { userId: myId }, params: { userId: targetId } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data, { status: "unblocked", userId: targetId });
    }
    const listRes = response();
    await listBlockedUsers({ user: { userId: myId } }, listRes);
    assert.deepEqual(listRes.body.data.accounts, [{ userId: targetId, name: "Blocked person", image: "avatar-1" }]);
    assert.deepEqual(updates[0][1], { $pull: { blockedUserIds: targetId } });
  } finally {
    User.findById = originalFindById;
    User.find = originalFind;
    User.updateOne = originalUpdateOne;
  }
});

test("friend reads filter blocked pairs and friend creation rejects them through the shared service", () => {
  const source = readFileSync(path.join(__dirname, "../src/controllers/friendsController.js"), "utf8");
  const listFriends = source.slice(source.indexOf("const listFriends"), source.indexOf("const listRequests"));
  const listRequests = source.slice(source.indexOf("const listRequests"), source.indexOf("const sendRequest"));
  const sendRequest = source.slice(source.indexOf("const sendRequest"), source.indexOf("const acceptRequest"));
  const acceptRequest = source.slice(source.indexOf("const acceptRequest"), source.indexOf("const declineRequest"));
  const searchUsers = source.slice(source.indexOf("const searchUsers"), source.indexOf("module.exports"));

  assert.match(listFriends, /filterBlockedCandidates/);
  assert.match(listRequests, /filterBlockedCandidates/);
  assert.match(searchUsers, /filterBlockedCandidates/);
  assert.match(sendRequest, /hasBlockedPair/);
  assert.match(acceptRequest, /hasBlockedPair/);
});

test("block routes are adult gated", () => {
  const routes = readFileSync(path.join(__dirname, "../src/routes/friendsRoutes.js"), "utf8");

  assert.match(routes, /router\.post\("\/users\/block", requireApiAuth, blockUsers\)/);
  assert.match(routes, /router\.delete\("\/users\/:userId\/block", requireApiAuth, unblockUser\)/);
  assert.match(routes, /router\.get\("\/me\/blocks", requireApiAuth, listBlockedUsers\)/);
});
