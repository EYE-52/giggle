const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { after, test } = require("node:test");
const mongoose = require("mongoose");
const User = require("../src/models/User");
const { Squad } = require("../src/models/Squad");
const { Encounter } = require("../src/models/Encounter");
const notificationModule = require("../src/models/Notification");
const queueService = require("../src/services/queueService");
const sessionService = require("../src/services/sessionService");
const socketService = require("../src/services/socketService");
const squadAccess = require("../src/app/squadAccess");
const { redlock, redis, subClient } = require("../src/config/redisConfig");

after(async () => {
  // Unit tests must also tear down when Redis is unavailable.
  redis.disconnect();
  subClient.disconnect();
});

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

test("relational ids are canonical and legacy mixed-case blocks still apply", async () => {
  const {
    canonicalUserId,
    relationalIdMatcher,
    hasBlockedPair,
    filterBlockedCandidates,
  } = service();
  const [viewer, blocked, allowed] = IDS;
  const mixedCase = (id) => [...id].map((char, index) => index % 2 ? char.toUpperCase() : char).join("");
  const legacyBlocked = mixedCase(blocked);
  let query;
  const FakeUser = {
    find(nextQuery) {
      query = nextQuery;
      return {
        lean: async () => [
          { _id: viewer, blockedUserIds: [legacyBlocked] },
          { _id: blocked, blockedUserIds: [] },
          { _id: allowed, blockedUserIds: [] },
        ],
      };
    },
  };

  assert.equal(canonicalUserId(legacyBlocked), blocked);
  assert.equal(relationalIdMatcher(legacyBlocked).test(legacyBlocked), true);
  assert.equal(relationalIdMatcher(legacyBlocked).test(blocked), true);
  assert.equal(
    hasBlockedPair(
      { _id: viewer.toUpperCase(), blockedUserIds: [legacyBlocked] },
      { _id: blocked, blockedUserIds: [] }
    ),
    true
  );
  assert.deepEqual(
    await filterBlockedCandidates(viewer.toUpperCase(), [legacyBlocked, allowed.toUpperCase()], { User: FakeUser }),
    [allowed]
  );
  assert.deepEqual(query, { _id: { $in: [viewer, blocked, allowed] } });
});

test("notification cleanup matches arbitrary legacy ObjectId casing", async () => {
  const [userId, otherUserId] = IDS;
  const mixedCase = (id) => [...id].map((char, index) => index % 2 ? char.toUpperCase() : char).join("");
  const originalDeleteMany = notificationModule.Notification.deleteMany;
  let filter;
  notificationModule.Notification.deleteMany = async (nextFilter) => {
    filter = nextFilter;
    return { deletedCount: 1 };
  };

  try {
    await notificationModule.deleteNotificationsBetweenUsers(userId, [otherUserId]);
    assert.equal(filter.$or[0].userId.test(mixedCase(userId)), true);
    assert.equal(filter.$or[0].fromUserId.$in[0].test(mixedCase(otherUserId)), true);
    assert.equal(filter.$or[1].userId.$in[0].test(mixedCase(otherUserId)), true);
    assert.equal(filter.$or[1].fromUserId.test(mixedCase(userId)), true);
  } finally {
    notificationModule.Notification.deleteMany = originalDeleteMany;
  }
});

test("required notification persistence uses the transaction session and fails closed", async () => {
  const [userId, fromUserId] = IDS;
  const originalCreate = notificationModule.Notification.create;
  const originalConsoleError = console.error;
  const session = { transaction: true };
  let createArgs;
  notificationModule.Notification.create = async (...args) => {
    createArgs = args;
    return [{ _id: IDS[2], ...args[0][0] }];
  };

  try {
    const fields = { userId, fromUserId, type: "friend_request" };
    const doc = await notificationModule.createNotification(
      fields,
      { session, required: true, emit: false }
    );
    assert.deepEqual(createArgs, [[{
      userId,
      type: "friend_request",
      title: undefined,
      body: undefined,
      fromUserId,
      fromName: undefined,
      squadId: undefined,
      squadCode: undefined,
      squadName: undefined,
    }], { session }]);
    assert.equal(doc.userId, userId);

    console.error = () => {};
    notificationModule.Notification.create = async () => { throw new Error("write failed"); };
    await assert.rejects(
      notificationModule.createNotification(fields, { session, required: true, emit: false }),
      /write failed/
    );
  } finally {
    notificationModule.Notification.create = originalCreate;
    console.error = originalConsoleError;
  }
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

test("anyBlockedPair fails closed when a roster contains an invalid user id", async () => {
  const { anyBlockedPair } = service();
  const [valid] = IDS;
  let reads = 0;
  const FakeUser = {
    find: () => {
      reads += 1;
      return { lean: async () => [{ _id: valid, blockedUserIds: [] }] };
    },
  };

  assert.equal(await anyBlockedPair([valid, "legacy-bad-id"], { User: FakeUser }), true);
  assert.equal(await anyBlockedPair([], { User: FakeUser }), false);
  assert.equal(reads, 0);
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

test("block atomically records canonical blocks and cleans legacy relationship ids and notifications", async () => {
  const [myId, targetA, targetB] = IDS;
  const mixedCase = (id) => [...id].map((char, index) => index % 2 ? char.toUpperCase() : char).join("");
  const originalFind = User.find;
  const originalUpdateOne = User.updateOne;
  const originalUpdateMany = User.updateMany;
  const originalSquadFind = Squad.find;
  const originalTransaction = mongoose.connection.transaction;
  const originalDeleteBetween = notificationModule.deleteNotificationsBetweenUsers;
  const originalEmit = notificationModule.emitNotificationsChanged;
  const originalAcquire = redlock.acquire;
  const originalUsing = redlock.using;
  const originalCleanup = squadAccess.removeBlockedIdentityFromSharedSquads;
  const originalDisconnect = socketService.disconnectUserSockets;
  const writes = [];
  const events = [];
  let transactionCount = 0;
  let deletion;
  const session = { transaction: true };

  User.find = () => ({ lean: async () => [{ _id: targetA }, { _id: targetB }] });
  User.updateOne = async (...args) => { writes.push(["one", ...args]); return { modifiedCount: 1 }; };
  User.updateMany = async (...args) => { writes.push(["many", ...args]); return { modifiedCount: 2 }; };
  Squad.find = async () => [];
  redlock.acquire = async () => ({ release: async () => {} });
  redlock.using = async (resources, duration, routine) => {
    events.push(["using", resources, duration]);
    const result = await routine({ aborted: false });
    events.push(["release"]);
    return result;
  };
  mongoose.connection.transaction = async (work) => {
    transactionCount += 1;
    events.push(["transaction"]);
    return work(session);
  };
  notificationModule.deleteNotificationsBetweenUsers = async (...args) => { deletion = args; return { deletedCount: 2 }; };
  notificationModule.emitNotificationsChanged = () => {};
  squadAccess.removeBlockedIdentityFromSharedSquads = async () => { events.push(["cleanup"]); };
  socketService.disconnectUserSockets = (userId) => { events.push(["disconnect", userId]); };

  try {
    const { blockUsers } = controller();
    const res = response();
    await blockUsers({
      user: { userId: mixedCase(myId) },
      body: { userIds: [mixedCase(targetA), targetB] },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, { status: "blocked", userIds: [targetA, targetB] });
    assert.equal(transactionCount, 1);
    assert.deepEqual(events, [
      ["using", ["lock:matchmaking"], 5000],
      ["transaction"],
      ["release"],
      ["cleanup"],
      ["disconnect", myId],
    ]);
    assert.deepEqual(writes[0], [
      "one",
      { _id: myId },
      {
        $addToSet: { blockedUserIds: { $each: [targetA, targetB] } },
        $pull: {
          friends: { $in: [new RegExp(`^${targetA}$`, "i"), new RegExp(`^${targetB}$`, "i")] },
          friendRequestsIncoming: { $in: [new RegExp(`^${targetA}$`, "i"), new RegExp(`^${targetB}$`, "i")] },
          friendRequestsOutgoing: { $in: [new RegExp(`^${targetA}$`, "i"), new RegExp(`^${targetB}$`, "i")] },
        },
      },
      { session },
    ]);
    assert.deepEqual(writes[1], [
      "many",
      { _id: { $in: [targetA, targetB] } },
      {
        $pull: {
          friends: new RegExp(`^${myId}$`, "i"),
          friendRequestsIncoming: new RegExp(`^${myId}$`, "i"),
          friendRequestsOutgoing: new RegExp(`^${myId}$`, "i"),
        },
      },
      { session },
    ]);
    assert.deepEqual(deletion, [myId, [targetA, targetB], { session }]);
  } finally {
    User.find = originalFind;
    User.updateOne = originalUpdateOne;
    User.updateMany = originalUpdateMany;
    Squad.find = originalSquadFind;
    mongoose.connection.transaction = originalTransaction;
    notificationModule.deleteNotificationsBetweenUsers = originalDeleteBetween;
    notificationModule.emitNotificationsChanged = originalEmit;
    redlock.acquire = originalAcquire;
    redlock.using = originalUsing;
    squadAccess.removeBlockedIdentityFromSharedSquads = originalCleanup;
    socketService.disconnectUserSockets = originalDisconnect;
    delete require.cache[require.resolve("../src/controllers/friendsController")];
  }
});

test("a committed block still cleans shared squads before a lock-release failure response", async () => {
  const [myId, targetId] = IDS;
  const originals = {
    find: User.find,
    updateOne: User.updateOne,
    updateMany: User.updateMany,
    transaction: mongoose.connection.transaction,
    deleteBetween: notificationModule.deleteNotificationsBetweenUsers,
    emit: notificationModule.emitNotificationsChanged,
    acquire: redlock.acquire,
    using: redlock.using,
    cleanup: squadAccess.removeBlockedIdentityFromSharedSquads,
  };
  const events = [];
  User.find = () => ({ lean: async () => [{ _id: targetId }] });
  User.updateOne = async () => { events.push("write:blocker"); };
  User.updateMany = async () => { events.push("write:targets"); };
  mongoose.connection.transaction = async (routine) => {
    const result = await routine({ transaction: true });
    events.push("commit");
    return result;
  };
  notificationModule.deleteNotificationsBetweenUsers = async () => {};
  notificationModule.emitNotificationsChanged = () => {};
  redlock.acquire = async () => ({ release: async () => { throw new Error("release failed"); } });
  redlock.using = async (_resources, _duration, routine) => {
    await routine({ aborted: false });
    throw new Error("release failed");
  };
  squadAccess.removeBlockedIdentityFromSharedSquads = async () => { events.push("cleanup"); };

  try {
    const { blockUsers } = controller();
    const res = response();
    await blockUsers({ user: { userId: myId }, body: { userIds: [targetId] } }, res);

    assert.equal(res.statusCode, 500);
    assert.deepEqual(events, ["write:blocker", "write:targets", "commit", "cleanup"]);
  } finally {
    User.find = originals.find;
    User.updateOne = originals.updateOne;
    User.updateMany = originals.updateMany;
    mongoose.connection.transaction = originals.transaction;
    notificationModule.deleteNotificationsBetweenUsers = originals.deleteBetween;
    notificationModule.emitNotificationsChanged = originals.emit;
    redlock.acquire = originals.acquire;
    redlock.using = originals.using;
    squadAccess.removeBlockedIdentityFromSharedSquads = originals.cleanup;
    delete require.cache[require.resolve("../src/controllers/friendsController")];
  }
});

test("send request keeps live reads, writes, and persistence inside the transaction and emits after commit", async () => {
  const [myId, targetId] = IDS;
  const mixedCase = (id) => [...id].map((char, index) => index % 2 ? char.toUpperCase() : char).join("");
  const originalFindById = User.findById;
  const originalUpdateOne = User.updateOne;
  const originalTransaction = mongoose.connection.transaction;
  const originalCreate = notificationModule.createNotification;
  const originalEmit = notificationModule.emitNotification;
  const session = { transaction: true };
  const events = [];
  let insideTransaction = false;
  const notification = { _id: IDS[2], userId: targetId };

  mongoose.connection.transaction = async (work) => {
    insideTransaction = true;
    try {
      const result = await work(session);
      events.push(["commit"]);
      return result;
    } finally {
      insideTransaction = false;
    }
  };
  User.findById = (id, _projection, options) => {
    events.push(["read", id, options?.session === session, insideTransaction]);
    return {
      lean: async () => id === targetId
        ? {
            _id: targetId,
            friends: [],
            friendRequestsIncoming: [],
            friendRequestsOutgoing: [],
            blockedUserIds: [],
          }
        : { _id: myId, friends: [], friendRequestsOutgoing: [], blockedUserIds: [] },
    };
  };
  User.updateOne = async (filter, update, options) => {
    events.push(["write", filter._id, update, options?.session === session, insideTransaction]);
    return { modifiedCount: 1 };
  };
  notificationModule.createNotification = async (fields, options) => {
    events.push(["persist", fields, options, insideTransaction]);
    return notification;
  };
  notificationModule.emitNotification = (doc) => {
    events.push(["emit", doc, insideTransaction]);
  };

  try {
    const { sendRequest } = controller();
    const res = response();
    const json = res.json;
    res.json = function respond(body) {
      events.push(["response", insideTransaction]);
      return json.call(this, body);
    };
    await sendRequest({
      user: { userId: mixedCase(myId), name: "Ana" },
      body: { userId: mixedCase(targetId) },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, { status: "requested" });
    assert.deepEqual(events.filter(([type]) => type === "read").map((event) => event.slice(1)), [
      [targetId, true, true],
      [myId, true, true],
    ]);
    assert.equal(events.filter(([type]) => type === "write").every((event) => event[3] && event[4]), true);
    const persist = events.find(([type]) => type === "persist");
    assert.equal(persist[1].userId, targetId);
    assert.equal(persist[1].fromUserId, myId);
    assert.deepEqual(persist[2], { session, required: true, emit: false });
    assert.equal(persist[3], true);
    assert.deepEqual(events.find(([type]) => type === "emit"), ["emit", notification, false]);
    assert.deepEqual(events.find(([type]) => type === "response"), ["response", false]);
  } finally {
    User.findById = originalFindById;
    User.updateOne = originalUpdateOne;
    mongoose.connection.transaction = originalTransaction;
    notificationModule.createNotification = originalCreate;
    notificationModule.emitNotification = originalEmit;
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
    assert.deepEqual(updates[0][1], {
      $pull: { blockedUserIds: new RegExp(`^${targetId}$`, "i") },
    });
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

test("friend relation creation is transactional and every writer canonicalizes accepted ids", () => {
  const source = readFileSync(path.join(__dirname, "../src/controllers/friendsController.js"), "utf8");
  const sendRequest = source.slice(source.indexOf("const sendRequest"), source.indexOf("const acceptRequest"));
  const acceptRequest = source.slice(source.indexOf("const acceptRequest"), source.indexOf("const declineRequest"));
  const declineRequest = source.slice(source.indexOf("const declineRequest"), source.indexOf("const removeFriend"));
  const removeFriend = source.slice(source.indexOf("const removeFriend"), source.indexOf("const searchUsers"));

  for (const writer of [sendRequest, acceptRequest, declineRequest, removeFriend]) {
    assert.match(writer, /const rawTargetId = req\.body\?\.userId/);
    assert.match(writer, /const targetId = canonicalUserId\(rawTargetId\)/);
  }
  for (const writer of [sendRequest, acceptRequest]) {
    assert.match(writer, /mongoose\.connection\.transaction\(async \(session\)/);
    assert.match(writer, /User\.findById\([\s\S]+\{ session \}\s*\)\.lean\(\)/);
    assert.match(writer, /User\.updateOne\([\s\S]+\{ session \}\s*\)/);
    assert.match(writer, /required: true/);
    assert.match(writer, /emit: false/);
  }
});

test("block routes are adult gated", () => {
  const routes = readFileSync(path.join(__dirname, "../src/routes/friendsRoutes.js"), "utf8");

  assert.match(routes, /router\.post\("\/users\/block", requireApiAuth, blockUsers\)/);
  assert.match(routes, /router\.delete\("\/users\/:userId\/block", requireApiAuth, unblockUser\)/);
  assert.match(routes, /router\.get\("\/me\/blocks", requireApiAuth, listBlockedUsers\)/);
});

test("blocking removes the blocker from every shared squad and clears stale squad requests", async () => {
  const [blockerId, targetId] = IDS;
  const originals = {
    find: Squad.find,
    remove: queueService.removeFromQueue,
    clear: sessionService.clearMemberSession,
    revoke: socketService.revokeUserRealtimeAccess,
    emitUser: socketService.emitToUser,
    emitSquad: socketService.emitToSquad,
  };
  const calls = [];
  const shared = {
    squadId: "shared",
    status: "searching",
    searchQueuedAt: new Date(),
    currentEncounterId: null,
    members: [
      { memberId: "blocker_member", userId: blockerId, role: "leader" },
      { memberId: "target_member", userId: targetId, role: "member" },
    ],
    invitedUserIds: [targetId],
    joinRequests: [{ userId: targetId }],
    async save() { calls.push("save:shared"); },
  };
  const targetSquad = {
    squadId: "target",
    status: "idle",
    members: [{ memberId: "target_leader", userId: targetId, role: "leader" }],
    invitedUserIds: [blockerId],
    joinRequests: [{ userId: blockerId }],
    async save() { calls.push("save:target"); },
  };
  Squad.find = async () => [shared, targetSquad];
  queueService.removeFromQueue = async (squadId) => { calls.push(`dequeue:${squadId}`); };
  sessionService.clearMemberSession = async (squadId, memberId) => { calls.push(`clear:${squadId}:${memberId}`); };
  socketService.revokeUserRealtimeAccess = (payload) => { calls.push(["revoke", payload]); };
  socketService.emitToUser = () => {};
  socketService.emitToSquad = () => {};

  try {
    const result = await squadAccess.removeBlockedIdentityFromSharedSquads({ blockerId, blockedUserIds: [targetId] });

    assert.equal(result.removedMemberships, 1);
    assert.deepEqual(shared.members.map((member) => [member.userId, member.role]), [[targetId, "leader"]]);
    assert.equal(shared.status, "idle");
    assert.equal(shared.searchQueuedAt, null);
    assert.deepEqual(shared.invitedUserIds, []);
    assert.deepEqual(shared.joinRequests, []);
    assert.deepEqual(targetSquad.invitedUserIds, []);
    assert.deepEqual(targetSquad.joinRequests, []);
    assert.equal(calls.includes("dequeue:shared"), true);
    assert.equal(calls.includes("clear:shared:blocker_member"), true);
    assert.equal(calls.some((call) => Array.isArray(call) && call[0] === "revoke" && call[1].userId === blockerId), true);
  } finally {
    Squad.find = originals.find;
    queueService.removeFromQueue = originals.remove;
    sessionService.clearMemberSession = originals.clear;
    socketService.revokeUserRealtimeAccess = originals.revoke;
    socketService.emitToUser = originals.emitUser;
    socketService.emitToSquad = originals.emitSquad;
  }
});

test("shared-squad cleanup unions indexed and mixed-case legacy matches", async () => {
  const [blockerId, targetId] = IDS;
  const mixedCase = (id) => [...id].map((char, index) => index % 2 ? char.toUpperCase() : char).join("");
  const originals = {
    find: Squad.find,
    clear: sessionService.clearMemberSession,
    revoke: socketService.revokeUserRealtimeAccess,
    emitUser: socketService.emitToUser,
    emitSquad: socketService.emitToSquad,
  };
  const queries = [];
  const canonical = {
    squadId: "canonical_only",
    status: "idle",
    members: [{ memberId: "canonical_blocker", userId: blockerId, role: "leader" }],
    invitedUserIds: [],
    joinRequests: [],
    async save() {},
  };
  const legacyShared = {
    squadId: "legacy_shared",
    status: "idle",
    members: [
      { memberId: "legacy_blocker", userId: mixedCase(blockerId), role: "leader" },
      { memberId: "legacy_target", userId: mixedCase(targetId), role: "member" },
    ],
    invitedUserIds: [],
    joinRequests: [],
    async save() {},
  };
  Squad.find = async (query) => {
    queries.push(query);
    return queries.length === 1 ? [canonical] : [canonical, legacyShared];
  };
  sessionService.clearMemberSession = async () => {};
  socketService.revokeUserRealtimeAccess = () => {};
  socketService.emitToUser = () => {};
  socketService.emitToSquad = () => {};

  try {
    const result = await squadAccess.removeBlockedIdentityFromSharedSquads({ blockerId, blockedUserIds: [targetId] });

    assert.deepEqual(queries[0], {
      "members.userId": { $in: [blockerId, targetId] },
    });
    assert.equal(queries.length, 2);
    assert.equal(queries[1]["members.userId"].$in.every((value) => value instanceof RegExp), true);
    assert.equal(result.removedMemberships, 1);
    assert.deepEqual(
      legacyShared.members.map((member) => service().canonicalUserId(member.userId)),
      [targetId]
    );
  } finally {
    Squad.find = originals.find;
    sessionService.clearMemberSession = originals.clear;
    socketService.revokeUserRealtimeAccess = originals.revoke;
    socketService.emitToUser = originals.emitUser;
    socketService.emitToSquad = originals.emitSquad;
  }
});

test("last-member removal keeps Mongo membership retryable until encounter cleanup succeeds", async () => {
  const matchmakingService = require("../src/services/matchmakingService");
  const originals = {
    findEncounter: Encounter.findOne,
    clear: sessionService.clearMemberSession,
    revoke: socketService.revokeUserRealtimeAccess,
    emitUser: socketService.emitToUser,
    asymmetric: matchmakingService.endEncounterAsymmetric,
    deleteNotifications: notificationModule.Notification.deleteMany,
    distinctNotifications: notificationModule.Notification.distinct,
  };
  const events = [];
  let deletes = 0;
  const squad = {
    squadId: "last_member_squad",
    status: "in_encounter",
    currentEncounterId: "enc_active",
    members: [{ memberId: "last_member", userId: IDS[0], role: "leader" }],
    async deleteOne() { deletes += 1; events.push("persist-delete"); },
  };
  Encounter.findOne = async () => ({
    encounterId: "enc_active",
    squadAId: squad.squadId,
    squadBId: "opponent_squad",
  });
  socketService.revokeUserRealtimeAccess = () => { events.push("revoke"); };
  sessionService.clearMemberSession = async () => { events.push("clear-session"); };
  socketService.emitToUser = () => { events.push("emit-removed"); };
  matchmakingService.endEncounterAsymmetric = async () => {
    events.push("requeue-opponent");
    throw new Error("opponent transition failed");
  };
  notificationModule.Notification.deleteMany = async () => ({ deletedCount: 0 });
  notificationModule.Notification.distinct = async () => [];

  try {
    await assert.rejects(
      () => squadAccess.removeSquadMember(squad, 0),
      /opponent transition failed/
    );
    assert.equal(deletes, 0);
    assert.equal(squad.members.length, 1);
    assert.deepEqual(events, ["revoke", "clear-session", "requeue-opponent"]);
  } finally {
    Encounter.findOne = originals.findEncounter;
    sessionService.clearMemberSession = originals.clear;
    socketService.revokeUserRealtimeAccess = originals.revoke;
    socketService.emitToUser = originals.emitUser;
    matchmakingService.endEncounterAsymmetric = originals.asymmetric;
    notificationModule.Notification.deleteMany = originals.deleteNotifications;
    notificationModule.Notification.distinct = originals.distinctNotifications;
  }
});

test("last-member removal requeues the active opponent before deleting the empty squad", async () => {
  const matchmakingService = require("../src/services/matchmakingService");
  const originals = {
    findEncounter: Encounter.findOne,
    clear: sessionService.clearMemberSession,
    revoke: socketService.revokeUserRealtimeAccess,
    emitUser: socketService.emitToUser,
    asymmetric: matchmakingService.endEncounterAsymmetric,
    deleteNotifications: notificationModule.Notification.deleteMany,
    distinctNotifications: notificationModule.Notification.distinct,
  };
  const events = [];
  const squad = {
    squadId: "last_member_squad",
    status: "in_encounter",
    currentEncounterId: "enc_active",
    members: [{ memberId: "last_member", userId: IDS[0], role: "leader" }],
    async deleteOne() { events.push("persist-delete"); },
  };
  Encounter.findOne = async () => ({
    encounterId: "enc_active",
    squadAId: squad.squadId,
    squadBId: "opponent_squad",
  });
  socketService.revokeUserRealtimeAccess = () => { events.push("revoke"); };
  sessionService.clearMemberSession = async () => { events.push("clear-session"); };
  socketService.emitToUser = () => { events.push("emit-removed"); };
  matchmakingService.endEncounterAsymmetric = async () => { events.push("requeue-opponent"); };
  notificationModule.Notification.deleteMany = async () => ({ deletedCount: 0 });
  notificationModule.Notification.distinct = async () => [];

  try {
    const result = await squadAccess.removeSquadMember(squad, 0);
    assert.equal(result.squadDeleted, true);
    assert.equal(squad.members.length, 0);
    assert.ok(events.indexOf("requeue-opponent") < events.indexOf("persist-delete"));
    assert.deepEqual(events, ["revoke", "clear-session", "requeue-opponent", "persist-delete", "emit-removed"]);
  } finally {
    Encounter.findOne = originals.findEncounter;
    sessionService.clearMemberSession = originals.clear;
    socketService.revokeUserRealtimeAccess = originals.revoke;
    socketService.emitToUser = originals.emitUser;
    matchmakingService.endEncounterAsymmetric = originals.asymmetric;
    notificationModule.Notification.deleteMany = originals.deleteNotifications;
    notificationModule.Notification.distinct = originals.distinctNotifications;
  }
});

test("the block endpoint runs shared-squad cleanup only after the relationship transaction", () => {
  const source = readFileSync(path.join(__dirname, "../src/controllers/friendsController.js"), "utf8");
  const block = source.slice(source.indexOf("const blockUsers"), source.indexOf("const unblockUser"));
  assert.match(block, /removeBlockedIdentityFromSharedSquads/);
  assert.equal(
    block.indexOf("removeBlockedIdentityFromSharedSquads") > block.indexOf("mongoose.connection.transaction"),
    true
  );
});
