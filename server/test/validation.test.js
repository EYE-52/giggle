const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const mongoose = require("mongoose");

const { dismissNotification, markOneRead } = require("../src/controllers/notificationController");
const { Notification, deleteNotifications } = require("../src/models/Notification");
const { Squad } = require("../src/models/Squad");
const User = require("../src/models/User");
const { hasIdentityId, persistSquadAfterMemberRemoval } = require("../src/app/squadAccess");
const {
  cancelSearchHandler,
  declineJoinRequestHandler,
  disbandSquadHandler,
  kickMemberHandler,
  leaveSquadHandler,
  updateReadyStateHandler,
} = require("../src/controllers/squadController");
const { normalizeEmail, normalizeProfileImage, normalizeProfilePatch } = require("../src/controllers/authController");
const { acceptRequest, declineRequest, removeFriend, searchUsers } = require("../src/controllers/friendsController");
const { normalizeSquadCoverImage } = require("../src/utils/squadCoverValidation");
const { normalizeSquadTags } = require("../src/utils/squadValidation");
const { normalizeDisplayName } = require("../src/utils/identityValidation");
const {
  MAX_CHAT_TEXT_LENGTH,
  createSocketRateLimiter,
  normalizeChatText,
  normalizeReactionEmoji,
  resolveSocketSenderName,
} = require("../src/services/socketService");

after(async () => {
  const redisPath = require.resolve("../src/config/redisConfig");
  if (!require.cache[redisPath]) return;
  const { redis, subClient } = require("../src/config/redisConfig");
  await Promise.allSettled([redis.quit(), subClient.quit()]);
});

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("stats route names all-time squad count as squadsTotal", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/routes/statsRoutes.js"), "utf8");

  assert.equal(source.includes("squadsTotal"), true);
  assert.equal(source.includes("const [squadsOnline"), false);
});

test("markOneRead rejects invalid notification ids without cast errors", async () => {
  const req = {
    user: { userId: "507f1f77bcf86cd799439011" },
    params: { id: "not-an-object-id" },
  };
  const res = createResponse();

  await markOneRead(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, "INVALID_REQUEST");
});

test("markOneRead reports not found when no owned notification is updated", async () => {
  const notificationId = "507f1f77bcf86cd799439012";
  const originalUpdateOne = Notification.updateOne;
  const originalCountDocuments = Notification.countDocuments;

  Notification.updateOne = async () => ({ matchedCount: 0, modifiedCount: 0 });
  Notification.countDocuments = async () => {
    throw new Error("unread count should not be queried after a miss");
  };

  try {
    const req = { user: { userId: "507f1f77bcf86cd799439011" }, params: { id: notificationId } };
    const res = createResponse();

    await markOneRead(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
  } finally {
    Notification.updateOne = originalUpdateOne;
    Notification.countDocuments = originalCountDocuments;
  }
});

test("dismissNotification deletes only the authed user's notification", async () => {
  const myId = "507f1f77bcf86cd799439011";
  const notificationId = "507f1f77bcf86cd799439012";
  const originalDeleteOne = Notification.deleteOne;
  const originalCountDocuments = Notification.countDocuments;
  let deleteQuery = null;

  Notification.deleteOne = async (query) => {
    deleteQuery = query;
    return { deletedCount: 1 };
  };
  Notification.countDocuments = async () => 0;

  try {
    const req = { user: { userId: myId }, params: { id: notificationId } };
    const res = createResponse();

    await dismissNotification(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(deleteQuery, { _id: notificationId, userId: myId });
    assert.equal(res.body.data.dismissed, true);
  } finally {
    Notification.deleteOne = originalDeleteOne;
    Notification.countDocuments = originalCountDocuments;
  }
});

test("dismissNotification is idempotent when the notification is already gone", async () => {
  const notificationId = "507f1f77bcf86cd799439012";
  const originalDeleteOne = Notification.deleteOne;
  const originalCountDocuments = Notification.countDocuments;

  Notification.deleteOne = async () => ({ deletedCount: 0 });
  Notification.countDocuments = async () => 3;

  try {
    const req = { user: { userId: "507f1f77bcf86cd799439011" }, params: { id: notificationId } };
    const res = createResponse();

    await dismissNotification(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, { dismissed: true, unread: 3 });
  } finally {
    Notification.deleteOne = originalDeleteOne;
    Notification.countDocuments = originalCountDocuments;
  }
});

test("resolved notifications invalidate every affected user session", async () => {
  const socketService = require("../src/services/socketService");
  const originalDeleteMany = Notification.deleteMany;
  const originalEmitToUser = socketService.emitToUser;
  const emitted = [];

  Notification.deleteMany = async () => ({ deletedCount: 2 });
  socketService.emitToUser = (userId, event) => emitted.push([userId, event]);

  try {
    await deleteNotifications(
      { squadId: "squad_done" },
      ["507f1f77bcf86cd799439011", null, "507f1f77bcf86cd799439012", undefined, "507f1f77bcf86cd799439011"]
    );

    assert.deepEqual(emitted, [
      ["507f1f77bcf86cd799439011", "notifications_changed"],
      ["507f1f77bcf86cd799439012", "notifications_changed"],
    ]);
  } finally {
    Notification.deleteMany = originalDeleteMany;
    socketService.emitToUser = originalEmitToUser;
  }
});

test("notification invalidation lookup failure never skips cleanup", async () => {
  const originalDistinct = Notification.distinct;
  const originalDeleteMany = Notification.deleteMany;
  let deleted = false;

  Notification.distinct = async () => { throw new Error("lookup unavailable"); };
  Notification.deleteMany = async () => {
    deleted = true;
    return { deletedCount: 1 };
  };

  try {
    const result = await deleteNotifications({ squadId: "squad_done" });
    assert.equal(deleted, true);
    assert.equal(result.deletedCount, 1);
  } finally {
    Notification.distinct = originalDistinct;
    Notification.deleteMany = originalDeleteMany;
  }
});

test("deleting an empty squad also deletes its notifications", async () => {
  const originalDistinct = Notification.distinct;
  const originalDeleteMany = Notification.deleteMany;
  let notificationQuery = null;
  let squadDeleted = false;
  Notification.distinct = async () => [];
  Notification.deleteMany = async (query) => {
    notificationQuery = query;
    return { deletedCount: 2 };
  };

  try {
    const result = await persistSquadAfterMemberRemoval({
      squadId: "squad_empty",
      members: [],
      deleteOne: async () => { squadDeleted = true; },
    }, { removedMemberRole: "leader" });

    assert.deepEqual(notificationQuery, { squadId: "squad_empty" });
    assert.equal(squadDeleted, true);
    assert.equal(result.squadDeleted, true);
  } finally {
    Notification.distinct = originalDistinct;
    Notification.deleteMany = originalDeleteMany;
  }
});

test("disbanding a squad also deletes its notifications", async () => {
  const socketService = require("../src/services/socketService");
  const originalDistinct = Notification.distinct;
  const originalDeleteMany = Notification.deleteMany;
  const originalRevoke = socketService.revokeUserRealtimeAccess;
  let notificationQuery = null;
  const revoked = [];
  Notification.distinct = async () => [];
  Notification.deleteMany = async (query) => {
    notificationQuery = query;
    return { deletedCount: 3 };
  };
  socketService.revokeUserRealtimeAccess = (payload) => revoked.push(payload);

  try {
    const req = {
      squadAccess: {
        isLeader: true,
        squad: {
          squadId: "squad_disbanded",
          status: "idle",
          currentEncounterId: "enc_active",
          members: [
            { memberId: "member_a", userId: "user_a", role: "leader" },
            { memberId: "member_b", userId: "user_b", role: "member" },
          ],
          deleteOne: async () => {},
        },
      },
    };
    const res = createResponse();

    await disbandSquadHandler(req, res);

    assert.deepEqual(notificationQuery, { squadId: "squad_disbanded" });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.disbanded, true);
    assert.deepEqual(revoked, [
      { userId: "user_a", squadId: "squad_disbanded", encounterId: "enc_active" },
      { userId: "user_b", squadId: "squad_disbanded", encounterId: "enc_active" },
    ]);
  } finally {
    Notification.distinct = originalDistinct;
    Notification.deleteMany = originalDeleteMany;
    socketService.revokeUserRealtimeAccess = originalRevoke;
  }
});

test("kicking a member revokes their live squad and encounter rooms", async () => {
  const socketService = require("../src/services/socketService");
  const originalRevoke = socketService.revokeUserRealtimeAccess;
  const revoked = [];
  socketService.revokeUserRealtimeAccess = (payload) => revoked.push(payload);

  try {
    const squad = {
      squadId: "squad_a",
      status: "in_encounter",
      currentEncounterId: "enc_1",
      members: [
        { memberId: "leader", userId: "user_a", role: "leader" },
        { memberId: "member_b", userId: "user_b", role: "member" },
      ],
      save: async () => {},
    };
    const res = createResponse();

    await kickMemberHandler({ params: { memberId: "member_b" }, squadAccess: { squad } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(revoked, [
      { userId: "user_b", squadId: "squad_a", encounterId: "enc_1" },
    ]);
  } finally {
    socketService.revokeUserRealtimeAccess = originalRevoke;
  }
});

test("leaving a squad revokes every socket owned by the leaving user", async () => {
  const socketService = require("../src/services/socketService");
  const originalRevoke = socketService.revokeUserRealtimeAccess;
  const revoked = [];
  socketService.revokeUserRealtimeAccess = (payload) => revoked.push(payload);

  try {
    const squad = {
      squadId: "squad_a",
      status: "in_encounter",
      currentEncounterId: "enc_1",
      members: [
        { memberId: "leader", userId: "user_a", role: "leader" },
        { memberId: "member_b", userId: "user_b", role: "member" },
      ],
      save: async () => {},
    };
    const res = createResponse();

    await leaveSquadHandler({ squadAccess: { squad, memberIndex: 1 } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(revoked, [
      { userId: "user_b", squadId: "squad_a", encounterId: "enc_1" },
    ]);
  } finally {
    socketService.revokeUserRealtimeAccess = originalRevoke;
  }
});

test("ready state rechecks squad status under the search admission lock", async () => {
  const { redlock } = require("../src/config/redisConfig");
  const sessionService = require("../src/services/sessionService");
  const originalAcquire = redlock.acquire;
  const originalFindOne = Squad.findOne;
  const originalSetSessionField = sessionService.setSessionField;
  const calls = [];
  let writes = 0;
  redlock.acquire = async () => {
    calls.push("lock");
    return { release: async () => { calls.push("release"); } };
  };
  Squad.findOne = async () => ({
    squadId: "squad_a",
    status: "searching",
    members: [{ memberId: "member_a" }],
  });
  sessionService.setSessionField = async () => { writes += 1; };

  try {
    const res = createResponse();
    await updateReadyStateHandler({
      body: { ready: false },
      squadAccess: {
        squad: {
          squadId: "squad_a",
          status: "idle",
          members: [{ memberId: "member_a" }],
        },
        member: { memberId: "member_a" },
        memberIndex: 0,
      },
    }, res);

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.code, "INVALID_SQUAD_STATE");
    assert.equal(writes, 0);
    assert.deepEqual(calls, ["lock", "release"]);
  } finally {
    redlock.acquire = originalAcquire;
    Squad.findOne = originalFindOne;
    sessionService.setSessionField = originalSetSessionField;
  }
});

test("ready state broadcasts a member delta after the Redis write", async () => {
  const { redlock } = require("../src/config/redisConfig");
  const sessionService = require("../src/services/sessionService");
  const socketService = require("../src/services/socketService");
  const originals = {
    acquire: redlock.acquire,
    findOne: Squad.findOne,
    setSessionField: sessionService.setSessionField,
    emitToSquad: socketService.emitToSquad,
  };
  const calls = [];
  redlock.acquire = async () => ({ release: async () => {} });
  Squad.findOne = async () => ({
    squadId: "squad_a",
    status: "idle",
    members: [{ memberId: "member_a" }],
  });
  sessionService.setSessionField = async (...args) => { calls.push(["write", ...args]); };
  socketService.emitToSquad = (...args) => { calls.push(["emit", ...args]); };

  try {
    const res = createResponse();
    await updateReadyStateHandler({
      body: { ready: true },
      squadAccess: {
        squad: { squadId: "squad_a" },
        member: { memberId: "member_a" },
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls, [
      ["write", "squad_a", "member_a", "ready", true],
      ["emit", "squad_a", "SQUAD_UPDATED", { memberId: "member_a", ready: true }],
    ]);
  } finally {
    redlock.acquire = originals.acquire;
    Squad.findOne = originals.findOne;
    sessionService.setSessionField = originals.setSessionField;
    socketService.emitToSquad = originals.emitToSquad;
  }
});

test("cancelling search serializes with matchmaking and refetches queue state", async () => {
  const { redlock } = require("../src/config/redisConfig");
  const queueService = require("../src/services/queueService");
  const socketService = require("../src/services/socketService");
  const originals = {
    acquire: redlock.acquire,
    using: redlock.using,
    findOne: Squad.findOne,
    remove: queueService.removeFromQueue,
    emit: socketService.emitToSquad,
  };
  const calls = [];
  const freshSquad = {
    squadId: "squad_a",
    status: "searching",
    searchQueuedAt: new Date(),
    async save() { calls.push("save"); },
  };

  redlock.using = async (_resources, _duration, routine) => {
    calls.push("lock");
    const result = await routine({ aborted: false });
    calls.push("release");
    return result;
  };
  Squad.findOne = async () => {
    calls.push("find");
    return freshSquad;
  };
  queueService.removeFromQueue = async () => { calls.push("dequeue"); };
  socketService.emitToSquad = () => { calls.push("emit"); };

  try {
    const res = createResponse();
    await cancelSearchHandler({
      squadAccess: {
        squad: { squadId: "squad_a", status: "searching" },
        member: { memberId: "leader" },
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(freshSquad.status, "idle");
    assert.deepEqual(calls, ["lock", "find", "save", "dequeue", "release", "emit"]);
  } finally {
    redlock.acquire = originals.acquire;
    redlock.using = originals.using;
    Squad.findOne = originals.findOne;
    queueService.removeFromQueue = originals.remove;
    socketService.emitToSquad = originals.emit;
  }
});

test("declining a join request deletes the leader notification", async () => {
  const leaderId = "507f1f77bcf86cd799439011";
  const requesterId = "507f1f77bcf86cd799439012";
  const originalDeleteMany = Notification.deleteMany;
  let notificationQuery = null;
  Notification.deleteMany = async (query) => {
    notificationQuery = query;
    return { deletedCount: 1 };
  };

  try {
    const req = {
      user: { userId: leaderId },
      params: { userId: requesterId },
      squadAccess: {
        squad: {
          squadId: "squad_request",
          joinRequests: [{ userId: requesterId }],
          save: async () => {},
        },
      },
    };
    const res = createResponse();

    await declineJoinRequestHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(notificationQuery, {
      userId: leaderId,
      type: "join_request",
      fromUserId: requesterId,
      squadId: "squad_request",
    });
  } finally {
    Notification.deleteMany = originalDeleteMany;
  }
});

test("normalizeProfilePatch validates lengths after trimming", () => {
  const valid = normalizeProfilePatch({
    country: `${" ".repeat(100)}US${" ".repeat(100)}`,
    languages: [" English ", " Hindi "],
  });

  assert.deepEqual(valid.patch.country, "US");
  assert.deepEqual(valid.patch.languages, ["English", "Hindi"]);

  const invalid = normalizeProfilePatch({ country: "x".repeat(65) });
  assert.equal(invalid.error, "country must be a short string");
});

test("normalizeProfilePatch dedupes languages after trimming case-insensitively", () => {
  const valid = normalizeProfilePatch({
    languages: [" English ", "english", "", "Hindi", " hindi "],
  });

  assert.deepEqual(valid.patch.languages, ["English", "Hindi"]);
});

test("normalizeProfilePatch validates and normalizes vibe preferences", () => {
  const valid = normalizeProfilePatch({
    vibes: [" Gaming ", "gaming", "Deep Talks", "", "Music", "Chill", "Comedy", "Art"],
  });

  assert.deepEqual(valid.patch.vibes, ["Gaming", "Deep Talks", "Music", "Chill", "Comedy"]);
  assert.equal(normalizeProfilePatch({ vibes: "Gaming" }).error, "vibes must be an array of short strings");
  assert.equal(normalizeProfilePatch({ vibes: ["x".repeat(16)] }).error, "vibes must be an array of short strings");
});

test("normalizeProfilePatch ignores public age edits", () => {
  const normalized = normalizeProfilePatch({ age: 22 });

  assert.deepEqual(normalized.patch, {});
  assert.deepEqual(normalized.unset, []);
});

test("normalizeEmail canonicalizes account identity", () => {
  assert.equal(normalizeEmail("  Person@Example.COM  "), "person@example.com");
  assert.equal(normalizeEmail("   "), "");
  assert.equal(normalizeEmail(null), "");
});

test("normalizeDisplayName keeps public names short and readable", () => {
  assert.equal(normalizeDisplayName("  Ana\n  Rivera  "), "Ana Rivera");
  assert.equal(normalizeDisplayName("x".repeat(80)), "x".repeat(48));
  assert.equal(normalizeDisplayName("   "), "");
  assert.equal(normalizeDisplayName({ name: "Ana" }), "");
});

test("normalizeProfileImage accepts only safe profile image values", () => {
  assert.equal(
    normalizeProfileImage(" https://lh3.googleusercontent.com/a/photo.jpg "),
    "https://lh3.googleusercontent.com/a/photo.jpg"
  );
  assert.equal(normalizeProfileImage(""), undefined);
  assert.equal(normalizeProfileImage(undefined), undefined);

  assert.equal(normalizeProfileImage("http://cdn.example.com/photo.jpg"), undefined);
  assert.equal(normalizeProfileImage("javascript:alert(1)"), undefined);
  assert.equal(normalizeProfileImage("linear-gradient(red, blue)"), undefined);
  assert.equal(normalizeProfileImage("data:text/html;base64,PHNjcmlwdA=="), undefined);
  assert.equal(normalizeProfileImage("x".repeat(2049)), undefined);
});

test("user email schema trims and lowercases as a persistence backstop", () => {
  const emailPath = User.schema.path("email");

  assert.equal(emailPath.options.trim, true);
  assert.equal(emailPath.options.lowercase, true);
  assert.equal(emailPath.options.unique, true);
});

test("public text schemas enforce persistence length backstops", () => {
  assert.equal(User.schema.path("name").options.trim, true);
  assert.equal(User.schema.path("name").options.maxlength, 48);
  assert.equal(User.schema.path("vibes.$").options.maxlength, 15);
  assert.equal(Squad.schema.path("members.displayName").options.trim, true);
  assert.equal(Squad.schema.path("members.displayName").options.maxlength, 48);
  assert.equal(Squad.schema.path("joinRequests.name").options.trim, true);
  assert.equal(Squad.schema.path("joinRequests.name").options.maxlength, 48);
  assert.equal(Notification.schema.path("title").options.maxlength, 80);
  assert.equal(Notification.schema.path("body").options.maxlength, 180);
  assert.equal(Notification.schema.path("fromName").options.maxlength, 48);
  assert.equal(Notification.schema.path("squadName").options.maxlength, 32);
});

test("hasIdentityId matches ObjectId-backed relationship arrays", () => {
  const id = "507f1f77bcf86cd799439012";

  assert.equal(hasIdentityId([new mongoose.Types.ObjectId(id)], id), true);
  assert.equal(hasIdentityId([{ userId: new mongoose.Types.ObjectId(id) }], id, "userId"), true);
  assert.equal(hasIdentityId([new mongoose.Types.ObjectId("507f1f77bcf86cd799439013")], id), false);
});

test("squad invite and request checks use normalized identity ids", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/controllers/squadController.js"), "utf8");

  assert.equal(/hasIdentityId\((?:currentS|s)quad\.invitedUserIds/.test(source), true);
  assert.equal(/hasIdentityId\((?:currentS|s)quad\.joinRequests/.test(source), true);
  assert.equal(source.includes("(squad.invitedUserIds || []).includes(userId)"), false);
  assert.equal(source.includes("(squad.joinRequests || []).some((r) => r.userId === userId)"), false);
});

test("searchUsers rejects oversized queries before database lookup", async () => {
  const req = {
    user: { userId: "507f1f77bcf86cd799439011" },
    query: { q: "a".repeat(100) },
  };
  const res = createResponse();

  await searchUsers(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, "INVALID_REQUEST");
});

test("searchUsers excludes existing friends stored as ObjectIds", async () => {
  const myId = "507f1f77bcf86cd799439011";
  const friendId = "507f1f77bcf86cd799439012";
  const originalFindById = User.findById;
  const originalFind = User.find;
  const socketPath = require.resolve("../src/services/socketService");
  const friendsPath = require.resolve("../src/controllers/friendsController");
  const originalGetOnlineUserIds = require(socketPath).getOnlineUserIds;
  let searchQuery = null;

  User.findById = () => ({
    lean: async () => ({ _id: myId, friends: [new mongoose.Types.ObjectId(friendId)] }),
  });
  User.find = (query) => {
    searchQuery = query;
    return {
      limit: () => ({
        lean: async () => [],
      }),
    };
  };
  require(socketPath).getOnlineUserIds = async () => new Set();
  delete require.cache[friendsPath];
  const { searchUsers: isolatedSearchUsers } = require("../src/controllers/friendsController");

  try {
    const req = { user: { userId: myId }, query: { q: "ma" } };
    const res = createResponse();

    await isolatedSearchUsers(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(searchQuery._id.$nin, [myId, friendId]);
  } finally {
    User.findById = originalFindById;
    User.find = originalFind;
    require(socketPath).getOnlineUserIds = originalGetOnlineUserIds;
    delete require.cache[friendsPath];
  }
});

test("acceptRequest rejects stale incoming friend requests when target user is gone", async () => {
  const myId = "507f1f77bcf86cd799439011";
  const missingTargetId = "507f1f77bcf86cd799439012";
  const originalFindById = User.findById;
  const originalUpdateOne = User.updateOne;
  const originalTransaction = mongoose.connection.transaction;
  let updateCount = 0;

  User.findById = (id) => ({
    lean: async () => {
      if (String(id) === myId) {
        return { _id: myId, friendRequestsIncoming: [missingTargetId] };
      }
      return null;
    },
  });
  User.updateOne = async () => {
    updateCount += 1;
  };
  mongoose.connection.transaction = async (work) => work({ testSession: true });

  try {
    const req = {
      user: { userId: myId },
      body: { userId: missingTargetId },
    };
    const res = createResponse();

    await acceptRequest(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, "NOT_FOUND");
    assert.equal(updateCount, 0);
  } finally {
    User.findById = originalFindById;
    User.updateOne = originalUpdateOne;
    mongoose.connection.transaction = originalTransaction;
  }
});

test("acceptRequest deletes the resolved friend notification", async () => {
  const myId = "507f1f77bcf86cd799439011";
  const targetId = "507f1f77bcf86cd799439012";
  const originalFindById = User.findById;
  const originalUpdateOne = User.updateOne;
  const originalDeleteMany = Notification.deleteMany;
  const originalTransaction = mongoose.connection.transaction;
  const session = { testSession: true };
  let notificationQuery = null;
  let notificationOptions = null;

  User.findById = (id) => ({
    lean: async () => String(id) === myId
      ? { _id: myId, friendRequestsIncoming: [targetId] }
      : { _id: targetId },
  });
  User.updateOne = async () => ({ modifiedCount: 1 });
  Notification.deleteMany = async (query, options) => {
    notificationQuery = query;
    notificationOptions = options;
    return { deletedCount: 1 };
  };
  mongoose.connection.transaction = async (work) => work(session);

  try {
    const req = { user: { userId: myId }, body: { userId: targetId } };
    const res = createResponse();

    await acceptRequest(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(notificationQuery.userId.test(myId.toUpperCase()), true);
    assert.equal(notificationQuery.fromUserId.test(targetId.toUpperCase()), true);
    assert.equal(notificationQuery.type, "friend_request");
    assert.deepEqual(notificationOptions, { session });
  } finally {
    User.findById = originalFindById;
    User.updateOne = originalUpdateOne;
    Notification.deleteMany = originalDeleteMany;
    mongoose.connection.transaction = originalTransaction;
  }
});

test("declineRequest deletes the resolved friend notification", async () => {
  const myId = "507f1f77bcf86cd799439011";
  const targetId = "507f1f77bcf86cd799439012";
  const originalFindById = User.findById;
  const originalUpdateOne = User.updateOne;
  const originalDeleteMany = Notification.deleteMany;
  const socketService = require("../src/services/socketService");
  const originalEmitToUser = socketService.emitToUser;
  let notificationQuery = null;
  const emitted = [];

  User.findById = (id) => ({
    lean: async () => String(id) === myId
      ? { _id: myId, friendRequestsIncoming: [targetId] }
      : { _id: targetId },
  });
  User.updateOne = async () => ({ modifiedCount: 1 });
  Notification.deleteMany = async (query) => {
    notificationQuery = query;
    return { deletedCount: 1 };
  };
  socketService.emitToUser = (userId, event) => emitted.push([userId, event]);

  try {
    const req = { user: { userId: myId }, body: { userId: targetId } };
    const res = createResponse();

    await declineRequest(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(notificationQuery.userId.test(myId.toUpperCase()), true);
    assert.equal(notificationQuery.fromUserId.test(targetId.toUpperCase()), true);
    assert.equal(notificationQuery.type, "friend_request");
    assert.deepEqual(emitted, [[myId, "notifications_changed"]]);
  } finally {
    User.findById = originalFindById;
    User.updateOne = originalUpdateOne;
    Notification.deleteMany = originalDeleteMany;
    socketService.emitToUser = originalEmitToUser;
  }
});

test("sendRequest is idempotent for already-pending outgoing requests", async () => {
  const myId = "507f1f77bcf86cd799439011";
  const targetId = "507f1f77bcf86cd799439012";
  const originalFindById = User.findById;
  const originalUpdateOne = User.updateOne;
  const notificationPath = require.resolve("../src/models/Notification");
  const friendsPath = require.resolve("../src/controllers/friendsController");
  const originalNotification = require(notificationPath).createNotification;
  const originalTransaction = mongoose.connection.transaction;
  let updateCount = 0;
  let notificationCount = 0;

  User.findById = (id, projection) => ({
    lean: async () => {
      if (String(id) === targetId) return { _id: targetId, friends: [], friendRequestsOutgoing: [] };
      if (String(id) === myId) return { _id: myId, friends: [], friendRequestsOutgoing: [targetId] };
      return null;
    },
  });
  User.updateOne = async () => {
    updateCount += 1;
  };
  require(notificationPath).createNotification = async () => {
    notificationCount += 1;
  };
  mongoose.connection.transaction = async (work) => work({ testSession: true });
  delete require.cache[friendsPath];
  const { sendRequest: isolatedSendRequest } = require("../src/controllers/friendsController");

  try {
    const req = { user: { userId: myId, name: "Ana" }, body: { userId: targetId } };
    const res = createResponse();

    await isolatedSendRequest(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.status, "requested");
    assert.equal(updateCount, 0);
    assert.equal(notificationCount, 0);
  } finally {
    User.findById = originalFindById;
    User.updateOne = originalUpdateOne;
    require(notificationPath).createNotification = originalNotification;
    mongoose.connection.transaction = originalTransaction;
    delete require.cache[friendsPath];
  }
});

test("sendRequest is idempotent when target already has the incoming request", async () => {
  const myId = "507f1f77bcf86cd799439011";
  const targetId = "507f1f77bcf86cd799439012";
  const originalFindById = User.findById;
  const originalUpdateOne = User.updateOne;
  const notificationPath = require.resolve("../src/models/Notification");
  const friendsPath = require.resolve("../src/controllers/friendsController");
  const originalNotification = require(notificationPath).createNotification;
  const originalTransaction = mongoose.connection.transaction;
  let updateCount = 0;
  let notificationCount = 0;

  User.findById = (id) => ({
    lean: async () => {
      if (String(id) === targetId) {
        return { _id: targetId, friends: [], friendRequestsIncoming: [myId], friendRequestsOutgoing: [] };
      }
      if (String(id) === myId) return { _id: myId, friends: [], friendRequestsOutgoing: [] };
      return null;
    },
  });
  User.updateOne = async () => {
    updateCount += 1;
  };
  require(notificationPath).createNotification = async () => {
    notificationCount += 1;
  };
  mongoose.connection.transaction = async (work) => work({ testSession: true });
  delete require.cache[friendsPath];
  const { sendRequest: isolatedSendRequest } = require("../src/controllers/friendsController");

  try {
    const req = { user: { userId: myId, name: "Ana" }, body: { userId: targetId } };
    const res = createResponse();

    await isolatedSendRequest(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.status, "requested");
    assert.equal(updateCount, 0);
    assert.equal(notificationCount, 0);
  } finally {
    User.findById = originalFindById;
    User.updateOne = originalUpdateOne;
    require(notificationPath).createNotification = originalNotification;
    mongoose.connection.transaction = originalTransaction;
    delete require.cache[friendsPath];
  }
});

test("declineRequest rejects when there is no incoming friend request", async () => {
  const myId = "507f1f77bcf86cd799439011";
  const targetId = "507f1f77bcf86cd799439012";
  const originalFindById = User.findById;
  const originalUpdateOne = User.updateOne;
  let updateCount = 0;

  User.findById = (id) => ({
    lean: async () => {
      if (String(id) === myId) return { _id: myId, friendRequestsIncoming: [] };
      return { _id: targetId };
    },
  });
  User.updateOne = async () => {
    updateCount += 1;
  };

  try {
    const req = { user: { userId: myId }, body: { userId: targetId } };
    const res = createResponse();

    await declineRequest(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, "NO_REQUEST");
    assert.equal(updateCount, 0);
  } finally {
    User.findById = originalFindById;
    User.updateOne = originalUpdateOne;
  }
});

test("removeFriend rejects when users are not friends", async () => {
  const myId = "507f1f77bcf86cd799439011";
  const targetId = "507f1f77bcf86cd799439012";
  const originalFindById = User.findById;
  const originalUpdateOne = User.updateOne;
  let updateCount = 0;

  User.findById = (id) => ({
    lean: async () => {
      if (String(id) === myId) return { _id: myId, friends: [] };
      return { _id: targetId };
    },
  });
  User.updateOne = async () => {
    updateCount += 1;
  };

  try {
    const req = { user: { userId: myId }, body: { userId: targetId } };
    const res = createResponse();

    await removeFriend(req, res);

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, "NOT_FRIENDS");
    assert.equal(updateCount, 0);
  } finally {
    User.findById = originalFindById;
    User.updateOne = originalUpdateOne;
  }
});

test("normalizeSquadTags rejects non-string tags", () => {
  const invalid = normalizeSquadTags(["Gaming", { label: "Hype" }]);

  assert.equal(invalid.error, "tags must be an array of strings");
});

test("normalizeSquadTags trims, caps, and filters public tags", () => {
  const valid = normalizeSquadTags([
    "  Gaming  ",
    "",
    "Deep conversations",
    "Music",
    "Late Night",
    "Foodies",
    "Ignored",
  ]);

  assert.deepEqual(valid.tags, ["Gaming", "Deep conversati", "Music", "Late Night", "Foodies"]);
});

test("normalizeSquadTags dedupes tags case-insensitively after trimming", () => {
  const valid = normalizeSquadTags([
    " Music ",
    "music",
    "MUSIC",
    "Deep Talks",
    " deep   talks ",
    "Gaming",
  ]);

  assert.deepEqual(valid.tags, ["Music", "Deep Talks", "Gaming"]);
});

test("normalizeSquadCoverImage accepts only safe cover values", () => {
  assert.deepEqual(normalizeSquadCoverImage("grad-aurora"), { coverImage: "grad-aurora" });
  assert.deepEqual(normalizeSquadCoverImage("https://cdn.example.com/cover.jpg"), {
    coverImage: "https://cdn.example.com/cover.jpg",
  });
  assert.deepEqual(normalizeSquadCoverImage("data:image/png;base64,aaaa"), {
    coverImage: "data:image/png;base64,aaaa",
  });

  assert.equal(normalizeSquadCoverImage("linear-gradient(red, blue)").error, "coverImage must be a known preset, https image URL, or image data URL");
  assert.equal(normalizeSquadCoverImage("javascript:alert(1)").error, "coverImage must be a known preset, https image URL, or image data URL");
  assert.equal(normalizeSquadCoverImage("data:text/html;base64,PHNjcmlwdA==").error, "coverImage must be a known preset, https image URL, or image data URL");
  assert.equal(normalizeSquadCoverImage("x".repeat(2_000_001)).error, "coverImage exceeds maximum allowed size");
});

test("normalizeChatText collapses whitespace and rejects non-strings", () => {
  assert.equal(normalizeChatText("  hey\n\nthere  "), "hey there");
  assert.equal(normalizeChatText({ text: "nope" }), "");
});

test("socket sender names are bounded and readable", () => {
  assert.equal(resolveSocketSenderName("  Maya\n  K  ", "ignored"), "Maya K");
  assert.equal(resolveSocketSenderName("", "x".repeat(80)), "x".repeat(48));
  assert.equal(resolveSocketSenderName("", ""), "Someone");
});

test("reaction emoji accepts only compact emoji-like values", () => {
  assert.equal(normalizeReactionEmoji("🔥"), "🔥");
  assert.equal(normalizeReactionEmoji("  😂  "), "😂");
  assert.equal(normalizeReactionEmoji("ok"), "");
  assert.equal(normalizeReactionEmoji("<script>"), "");
  assert.equal(normalizeReactionEmoji("🔥".repeat(9)), "");
});

test("chat text length limit is bounded for socket payloads", () => {
  assert.equal(MAX_CHAT_TEXT_LENGTH, 500);
  assert.equal("x".repeat(MAX_CHAT_TEXT_LENGTH + 1).length > MAX_CHAT_TEXT_LENGTH, true);
});

test("socket rate limiter allows bursts then resets by window", () => {
  const limiter = createSocketRateLimiter({ limit: 2, windowMs: 1000 });

  assert.equal(limiter.allow("socket-a", 1000), true);
  assert.equal(limiter.allow("socket-a", 1100), true);
  assert.equal(limiter.allow("socket-a", 1200), false);
  assert.equal(limiter.allow("socket-b", 1200), true);
  assert.equal(limiter.allow("socket-a", 2101), true);
});
