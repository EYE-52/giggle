const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { after, test } = require("node:test");
const mongoose = require("mongoose");

const User = require("../src/models/User");
const { Squad } = require("../src/models/Squad");
const { Notification } = require("../src/models/Notification");
const { redlock, redis, subClient } = require("../src/config/redisConfig");
const queueService = require("../src/services/queueService");
const sessionService = require("../src/services/sessionService");
const socketService = require("../src/services/socketService");
const {
  approveJoinRequestHandler,
  createSquadHandler,
  discoverSquadsHandler,
  getMySquadHandler,
  getMySquadsHandler,
  getJoinRequestsHandler,
  getSquadHandler,
  getSquadPreviewHandler,
  inviteToSquadHandler,
  inviteUserToSquadHandler,
  joinRandomSquadHandler,
  joinSquadHandler,
  startSearchHandler,
  updateSquadTagsHandler,
} = require("../src/controllers/squadController");

const read = (relativePath) => readFileSync(path.join(__dirname, "..", relativePath), "utf8");

after(async () => {
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

function section(source, start, end) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt);
  assert.notEqual(startAt, -1);
  assert.notEqual(endAt, -1);
  return source.slice(startAt, endAt);
}

test("public squad discovery and preview do not expose join codes or member demographics", () => {
  const controller = read("src/controllers/squadController.js");
  const routes = read("src/routes/squadRoutes.js");
  const publicSerializer = section(controller, "const toPublicSquad", "const findJoinableSquads");
  const previewHandler = section(controller, "const getSquadPreviewHandler", "const updateReadyStateHandler");
  const discoverQuery = section(controller, "const findJoinableSquads", "const discoverSquadsHandler");

  assert.equal(publicSerializer.includes("squadCode:"), false);
  assert.equal(previewHandler.includes("squadCode:"), false);
  for (const field of ["gender", "age", "languages", "country"]) {
    assert.equal(new RegExp(`\\b${field}\\s*:`).test(previewHandler), false);
  }
  assert.equal(routes.includes('router.post("/squads/:squadId/join", requireApiAuth, joinSquadHandler);'), true);
  assert.equal(discoverQuery.includes('joinPolicy: { $in: ["open", "request"] }'), true);
});

test("blocked accounts are checked at every squad discovery and admission boundary", () => {
  const controller = read("src/controllers/squadController.js");
  const join = section(controller, "const joinSquadHandler", "const getSquadHandler");
  const approve = section(controller, "const approveJoinRequestHandler", "const declineJoinRequestHandler");
  const leaderInvite = section(controller, "const inviteToSquadHandler", "const revokeInviteHandler");
  const memberInvite = section(controller, "const inviteUserToSquadHandler", "const startSearchHandler");
  const startSearch = section(controller, "const startSearchHandler", "const cancelSearchHandler");
  const discovery = section(controller, "const findJoinableSquads", "const tryJoinSquadOnce");
  const randomJoin = section(controller, "const tryJoinSquadOnce", "const joinRandomSquadHandler");

  for (const boundary of [join, approve, leaderInvite, memberInvite, startSearch]) {
    assert.match(boundary, /anyBlockedPair/);
    assert.match(boundary, /interactionBlocked\(res\)/);
  }
  assert.match(randomJoin, /anyBlockedPair/);
  assert.match(discovery, /filterBlockedCandidates/);
  assert.match(controller, /code: "INTERACTION_BLOCKED"/);
});

test("member session cleanup removes legacy and field-per-member Redis entries", async () => {
  const originalHkeys = redis.hkeys;
  const originalHdel = redis.hdel;
  const deleted = [];
  redis.hkeys = async () => [
    "member_a",
    "member_a:ready",
    "member_a:inLobbyVideo",
    "member_b:ready",
  ];
  redis.hdel = async (key, ...fields) => { deleted.push([key, ...fields]); };

  try {
    await sessionService.clearMemberSession("squad_a", "member_a");
    assert.deepEqual(deleted, [[
      "squad_session:squad_a",
      "member_a",
      "member_a:ready",
      "member_a:inLobbyVideo",
    ]]);
  } finally {
    redis.hkeys = originalHkeys;
    redis.hdel = originalHdel;
  }
});

test("blocked pairs cannot join by code or id, including request-gated squads", async () => {
  const requesterId = "507f1f77bcf86cd799439011";
  const leaderId = "507f1f77bcf86cd799439012";
  const originals = { findOne: Squad.findOne, findById: User.findById, find: User.find };
  User.findById = async () => ({ _id: requesterId });
  User.find = () => ({
    lean: async () => [
      { _id: requesterId, blockedUserIds: [leaderId] },
      { _id: leaderId, blockedUserIds: [] },
    ],
  });

  try {
    for (const request of [
      { body: { squadCode: "ABC-123" }, params: {}, joinPolicy: "open" },
      { body: {}, params: { squadId: "squad_a" }, joinPolicy: "request" },
    ]) {
      let saves = 0;
      const squad = {
        squadId: "squad_a",
        squadCode: "ABC-123",
        status: "idle",
        joinPolicy: request.joinPolicy,
        members: [{ memberId: "leader", userId: leaderId, role: "leader" }],
        invitedUserIds: [],
        joinRequests: [],
        async save() { saves += 1; },
      };
      Squad.findOne = async () => squad;
      const res = createResponse();
      await joinSquadHandler({
        body: request.body,
        params: request.params,
        user: { userId: requesterId, name: "Requester" },
      }, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error.code, "INTERACTION_BLOCKED");
      assert.equal(saves, 0);
      assert.equal(squad.members.length, 1);
      assert.deepEqual(squad.joinRequests, []);
    }
  } finally {
    Squad.findOne = originals.findOne;
    User.findById = originals.findById;
    User.find = originals.find;
  }
});

test("public discovery excludes squads blocked in either direction", async () => {
  const viewerId = "507f1f77bcf86cd799439011";
  const memberId = "507f1f77bcf86cd799439012";
  const originals = { find: Squad.find, userFind: User.find };
  const hiddenSquad = {
    squadId: "hidden",
    status: "idle",
    visibility: "open",
    joinPolicy: "open",
    members: [{ userId: memberId, role: "leader" }],
  };
  Squad.find = () => ({
    sort() { return this; },
    limit: async () => [hiddenSquad],
  });
  User.find = () => ({
    lean: async () => [
      { _id: viewerId, blockedUserIds: [] },
      { _id: memberId, blockedUserIds: [viewerId] },
    ],
  });

  try {
    const res = createResponse();
    await discoverSquadsHandler({ user: { userId: viewerId } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.squads, []);
  } finally {
    Squad.find = originals.find;
    User.find = originals.userFind;
  }
});

test("public preview does not expose a squad across a blocked relationship", async () => {
  const viewerId = "507f1f77bcf86cd799439011";
  const memberId = "507f1f77bcf86cd799439012";
  const originals = { findOne: Squad.findOne, find: User.find };
  Squad.findOne = async () => ({
    squadId: "hidden",
    members: [{ memberId: "leader", userId: memberId, role: "leader" }],
  });
  User.find = () => ({
    lean: async () => [
      { _id: viewerId, blockedUserIds: [memberId] },
      { _id: memberId, blockedUserIds: [] },
    ],
  });

  try {
    const res = createResponse();
    await getSquadPreviewHandler({ params: { squadId: "hidden" }, user: { userId: viewerId } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "INTERACTION_BLOCKED");
    assert.equal(JSON.stringify(res.body).includes("leader"), false);
  } finally {
    Squad.findOne = originals.findOne;
    User.find = originals.find;
  }
});

test("join-request reads omit missing and blocked requesters", async () => {
  const leaderId = "507f1f77bcf86cd799439011";
  const blockedId = "507f1f77bcf86cd799439012";
  const allowedId = "507f1f77bcf86cd799439013";
  const originalFind = User.find;
  let projection;
  User.find = async (_query, fields) => {
    projection = fields;
    return [
      { _id: leaderId, blockedUserIds: [] },
      { _id: blockedId, blockedUserIds: [leaderId], name: "Hidden" },
      { _id: allowedId, blockedUserIds: [], name: "Visible" },
    ];
  };

  try {
    const res = createResponse();
    await getJoinRequestsHandler({
      squadAccess: {
        squad: {
          members: [{ userId: leaderId }],
          joinRequests: [
            { userId: blockedId, name: "Hidden" },
            { userId: allowedId, name: "Visible" },
            { userId: "507f1f77bcf86cd799439014", name: "Missing" },
          ],
        },
      },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.requests.map((request) => request.userId), [allowedId]);
    assert.equal(projection, "_id blockedUserIds gender languages country");
  } finally {
    User.find = originalFind;
  }
});

test("random join skips a blocked squad and admits the user only to a safe candidate", async () => {
  const viewerId = "507f1f77bcf86cd799439011";
  const blockedLeaderId = "507f1f77bcf86cd799439012";
  const safeLeaderId = "507f1f77bcf86cd799439013";
  const originals = { find: Squad.find, findOne: Squad.findOne, userFind: User.find, findById: User.findById };
  const blocked = {
    squadId: "blocked_squad",
    status: "idle",
    visibility: "open",
    joinPolicy: "open",
    members: [{ memberId: "blocked_leader", userId: blockedLeaderId, role: "leader" }],
  };
  const safe = {
    squadId: "safe_squad",
    squadCode: "SAFE-01",
    squadName: "Safe squad",
    status: "idle",
    visibility: "open",
    joinPolicy: "open",
    members: [{ memberId: "safe_leader", userId: safeLeaderId, role: "leader" }],
    async save() {},
  };
  const users = [
    { _id: viewerId, blockedUserIds: [blockedLeaderId] },
    { _id: blockedLeaderId, blockedUserIds: [] },
    { _id: safeLeaderId, blockedUserIds: [] },
  ];
  Squad.find = () => ({ sort() { return this; }, limit: async () => [blocked, safe] });
  Squad.findOne = async ({ squadId }) => squadId === safe.squadId ? safe : blocked;
  User.find = ({ _id }) => ({
    lean: async () => users.filter((user) => _id.$in.includes(user._id)),
  });
  User.findById = () => ({ select: async () => ({ isPremium: false }) });

  try {
    const res = createResponse();
    await joinRandomSquadHandler({
      body: { displayName: "Viewer" },
      user: { userId: viewerId, name: "Viewer" },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.squadId, safe.squadId);
    assert.deepEqual(blocked.members.map((member) => member.userId), [blockedLeaderId]);
    assert.deepEqual(safe.members.map((member) => member.userId), [safeLeaderId, viewerId]);
  } finally {
    Squad.find = originals.find;
    Squad.findOne = originals.findOne;
    User.find = originals.userFind;
    User.findById = originals.findById;
  }
});

test("request and invite final block decisions run under the auto-extending lock before writes", async () => {
  const requesterId = "507f1f77bcf86cd799439011";
  const leaderId = "507f1f77bcf86cd799439012";
  const originals = {
    findOne: Squad.findOne,
    findById: User.findById,
    find: User.find,
    create: Notification.create,
    deleteMany: Notification.deleteMany,
    transaction: mongoose.connection.transaction,
    using: redlock.using,
    emitSquad: socketService.emitToSquad,
  };
  let blockReads = 0;
  let blockOnRead = 2;
  let events = [];
  User.find = () => ({
    lean: async () => {
      blockReads += 1;
      events.push(`block-read:${blockReads}`);
      return [
        { _id: requesterId, blockedUserIds: blockReads >= blockOnRead ? [leaderId] : [] },
        { _id: leaderId, blockedUserIds: [] },
      ];
    },
  });
  User.findById = () => ({
    select: async () => ({
      _id: requesterId,
      ageConfirmed: true,
      isAdult: true,
      ageVerified: true,
    }),
  });
  Notification.create = async () => assert.fail("blocked artifact must not be persisted");
  Notification.deleteMany = async () => assert.fail("blocked artifact must not need compensation");
  mongoose.connection.transaction = async (routine) => {
    events.push("transaction");
    return routine({ transaction: true });
  };
  redlock.using = async (resources, duration, routine) => {
    events.push(["using:start", resources, duration]);
    const result = await routine({ aborted: false });
    events.push("using:end");
    return result;
  };
  socketService.emitToSquad = () => { events.push("squad:emit"); };

  try {
    const requestSquad = {
      squadId: "request_squad",
      squadCode: "ABC-123",
      squadName: "Requests",
      status: "idle",
      joinPolicy: "request",
      members: [{ memberId: "leader", userId: leaderId, role: "leader" }],
      invitedUserIds: [],
      joinRequests: [],
      async save() { events.push("request:save"); },
    };
    Squad.findOne = async () => requestSquad;
    let res = createResponse();
    await joinSquadHandler({
      body: { squadCode: "ABC-123" },
      params: {},
      user: { userId: requesterId, name: "Requester" },
    }, res);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(requestSquad.joinRequests, []);
    assert.deepEqual(events, [
      "block-read:1",
      ["using:start", ["lock:matchmaking"], 5000],
      "transaction",
      "block-read:2",
      "using:end",
    ]);

    blockReads = 0;
    blockOnRead = 1;
    events = [];
    const inviteSquad = {
      squadId: "invite_squad",
      squadName: "Invites",
      squadCode: "DEF-456",
      members: [{ memberId: "leader", userId: leaderId, role: "leader" }],
      invitedUserIds: [],
      joinRequests: [],
      async save() { events.push("invite:save"); },
    };
    Squad.findOne = async () => inviteSquad;
    res = createResponse();
    await inviteToSquadHandler({
      body: { userId: requesterId },
      user: { userId: leaderId },
      squadAccess: { squad: inviteSquad },
    }, res);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(inviteSquad.invitedUserIds, []);
    assert.deepEqual(events, [
      ["using:start", ["lock:matchmaking"], 5000],
      "transaction",
      "block-read:1",
      "using:end",
    ]);

    blockReads = 0;
    events = [];
    res = createResponse();
    await inviteUserToSquadHandler({
      body: { userId: requesterId },
      user: { userId: leaderId, name: "Leader" },
      squadAccess: { squad: inviteSquad },
    }, res);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(inviteSquad.invitedUserIds, []);
    assert.deepEqual(events, [
      ["using:start", ["lock:matchmaking"], 5000],
      "transaction",
      "block-read:1",
      "using:end",
    ]);
  } finally {
    Squad.findOne = originals.findOne;
    User.findById = originals.findById;
    User.find = originals.find;
    Notification.create = originals.create;
    Notification.deleteMany = originals.deleteMany;
    mongoose.connection.transaction = originals.transaction;
    redlock.using = originals.using;
    socketService.emitToSquad = originals.emitSquad;
  }
});

test("notification persistence failure rolls back a join request without realtime emits", async () => {
  const requesterId = "507f1f77bcf86cd799439011";
  const leaderId = "507f1f77bcf86cd799439012";
  const originals = {
    findOne: Squad.findOne,
    findById: User.findById,
    find: User.find,
    create: Notification.create,
    transaction: mongoose.connection.transaction,
    using: redlock.using,
    emitSquad: socketService.emitToSquad,
    emitUser: socketService.emitToUser,
  };
  const squad = {
    squadId: "request_atomic",
    squadCode: "ABC-123",
    squadName: "Atomic request",
    status: "idle",
    joinPolicy: "request",
    members: [{ memberId: "leader", userId: leaderId, role: "leader" }],
    invitedUserIds: [],
    joinRequests: [],
    async save() {},
  };
  const before = [...squad.joinRequests];
  let emits = 0;
  Squad.findOne = async () => squad;
  User.findById = async () => ({ _id: requesterId });
  User.find = () => ({
    lean: async () => [
      { _id: requesterId, blockedUserIds: [] },
      { _id: leaderId, blockedUserIds: [] },
    ],
  });
  Notification.create = async () => { throw new Error("notification write failed"); };
  mongoose.connection.transaction = async (routine) => {
    try {
      return await routine({ transaction: true });
    } catch (error) {
      squad.joinRequests = [...before];
      throw error;
    }
  };
  redlock.using = async (_resources, _duration, routine) => routine({ aborted: false });
  socketService.emitToSquad = () => { emits += 1; };
  socketService.emitToUser = () => { emits += 1; };

  try {
    const res = createResponse();
    await joinSquadHandler({
      body: { squadCode: "ABC-123" },
      params: {},
      user: { userId: requesterId, name: "Requester" },
    }, res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual(squad.joinRequests, []);
    assert.equal(emits, 0);
  } finally {
    Squad.findOne = originals.findOne;
    User.findById = originals.findById;
    User.find = originals.find;
    Notification.create = originals.create;
    mongoose.connection.transaction = originals.transaction;
    redlock.using = originals.using;
    socketService.emitToSquad = originals.emitSquad;
    socketService.emitToUser = originals.emitUser;
  }
});

test("a lock lost after notification persistence aborts before the join-request transaction commits", async () => {
  const requesterId = "507f1f77bcf86cd799439011";
  const leaderId = "507f1f77bcf86cd799439012";
  const originals = {
    findOne: Squad.findOne,
    findById: User.findById,
    find: User.find,
    create: Notification.create,
    transaction: mongoose.connection.transaction,
    using: redlock.using,
    emitSquad: socketService.emitToSquad,
    emitUser: socketService.emitToUser,
  };
  const squad = {
    squadId: "request_lock_loss",
    squadCode: "ABC-123",
    squadName: "Lock loss",
    status: "idle",
    joinPolicy: "request",
    members: [{ memberId: "leader", userId: leaderId, role: "leader" }],
    invitedUserIds: [],
    joinRequests: [],
    async save() {},
  };
  let signal;
  let committed = false;
  let rolledBack = false;
  let emits = 0;
  Squad.findOne = async () => squad;
  User.findById = async () => ({ _id: requesterId });
  User.find = () => ({
    lean: async () => [
      { _id: requesterId, blockedUserIds: [] },
      { _id: leaderId, blockedUserIds: [] },
    ],
  });
  Notification.create = async () => {
    signal.aborted = true;
    signal.error = new Error("lock extension failed");
    return [{ _id: "507f1f77bcf86cd799439099", userId: leaderId }];
  };
  mongoose.connection.transaction = async (routine) => {
    try {
      const result = await routine({ transaction: true });
      committed = true;
      return result;
    } catch (error) {
      squad.joinRequests = [];
      rolledBack = true;
      throw error;
    }
  };
  redlock.using = async (_resources, _duration, routine) => {
    signal = { aborted: false, error: null };
    return routine(signal);
  };
  socketService.emitToSquad = () => { emits += 1; };
  socketService.emitToUser = () => { emits += 1; };

  try {
    const res = createResponse();
    await joinSquadHandler({
      body: { squadCode: "ABC-123" },
      params: {},
      user: { userId: requesterId, name: "Requester" },
    }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(committed, false);
    assert.equal(rolledBack, true);
    assert.deepEqual(squad.joinRequests, []);
    assert.equal(emits, 0);
  } finally {
    Squad.findOne = originals.findOne;
    User.findById = originals.findById;
    User.find = originals.find;
    Notification.create = originals.create;
    mongoose.connection.transaction = originals.transaction;
    redlock.using = originals.using;
    socketService.emitToSquad = originals.emitSquad;
    socketService.emitToUser = originals.emitUser;
  }
});

test("member squad reads fail closed while a blocked shared roster still exists", async () => {
  const viewerId = "507f1f77bcf86cd799439011";
  const blockedId = "507f1f77bcf86cd799439012";
  const originals = {
    squadFind: Squad.find,
    userFind: User.find,
    userFindById: User.findById,
    session: sessionService.getSquadSession,
  };
  const squad = {
    squadId: "blocked_shared_squad",
    squadCode: "ABC-123",
    squadName: "Hidden",
    status: "idle",
    createdAt: new Date(),
    members: [
      { memberId: "viewer", userId: viewerId, role: "leader", displayName: "Viewer" },
      { memberId: "blocked", userId: blockedId, role: "member", displayName: "Hidden user" },
    ],
  };
  Squad.find = async () => [squad];
  User.find = () => ({
    lean: async () => [
      { _id: viewerId, blockedUserIds: [blockedId] },
      { _id: blockedId, blockedUserIds: [] },
    ],
  });
  User.findById = async () => ({ isPremium: false });
  let sessionReads = 0;
  sessionService.getSquadSession = async () => { sessionReads += 1; return {}; };

  try {
    let res = createResponse();
    await getMySquadHandler({ user: { userId: viewerId } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "INTERACTION_BLOCKED");

    res = createResponse();
    await getSquadHandler({ squadAccess: { squad, leader: squad.members[0] } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "INTERACTION_BLOCKED");
    assert.equal(sessionReads, 0);

    res = createResponse();
    await getMySquadsHandler({ user: { userId: viewerId } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.squads, []);
  } finally {
    Squad.find = originals.squadFind;
    User.find = originals.userFind;
    User.findById = originals.userFindById;
    sessionService.getSquadSession = originals.session;
  }
});

test("blocked targets cannot be approved or invited into a squad", async () => {
  const leaderId = "507f1f77bcf86cd799439011";
  const targetId = "507f1f77bcf86cd799439012";
  const originals = {
    findById: User.findById,
    find: User.find,
    squadFindOne: Squad.findOne,
    transaction: mongoose.connection.transaction,
    using: redlock.using,
  };
  let currentSquad;
  User.findById = () => ({
    select: async () => ({
      _id: targetId,
      ageConfirmed: true,
      isAdult: true,
      ageVerified: true,
    }),
    then(resolve) {
      return Promise.resolve({
        _id: targetId,
        ageConfirmed: true,
        isAdult: true,
        ageVerified: true,
      }).then(resolve);
    },
  });
  User.find = () => ({
    lean: async () => [
      { _id: leaderId, blockedUserIds: [] },
      { _id: targetId, blockedUserIds: [leaderId] },
    ],
  });
  Squad.findOne = async () => currentSquad;
  mongoose.connection.transaction = (routine) => routine({ transaction: true });
  redlock.using = (_resources, _duration, routine) => routine({ aborted: false });

  try {
    for (const [handler, request] of [
      [approveJoinRequestHandler, { params: { userId: targetId }, user: { userId: leaderId } }],
      [inviteToSquadHandler, { body: { userId: targetId }, user: { userId: leaderId } }],
      [inviteUserToSquadHandler, { body: { userId: targetId }, user: { userId: leaderId, name: "Leader" } }],
    ]) {
      let saves = 0;
      const squad = {
        squadId: "squad_a",
        squadName: "A",
        squadCode: "ABC-123",
        status: "idle",
        members: [{ memberId: "leader", userId: leaderId, role: "leader" }],
        invitedUserIds: [],
        joinRequests: [{ userId: targetId, name: "Target" }],
        async save() { saves += 1; },
      };
      currentSquad = squad;
      const res = createResponse();
      await handler({ ...request, squadAccess: { squad } }, res);
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error.code, "INTERACTION_BLOCKED");
      assert.equal(saves, 0);
      assert.equal(squad.members.length, 1);
      assert.deepEqual(squad.invitedUserIds, []);
    }
  } finally {
    User.findById = originals.findById;
    User.find = originals.find;
    Squad.findOne = originals.squadFindOne;
    mongoose.connection.transaction = originals.transaction;
    redlock.using = originals.using;
  }
});

test("public squad discovery and preview normalize stale display fields", () => {
  const controller = read("src/controllers/squadController.js");
  const publicSerializer = section(controller, "const toPublicSquad", "const findJoinableSquads");
  const previewHandler = section(controller, "const getSquadPreviewHandler", "const updateReadyStateHandler");

  assert.equal(controller.includes("const publicSquadName = (squad) =>"), true);
  assert.equal(controller.includes("const publicMemberName = (member) =>"), true);
  assert.equal(controller.includes("const publicSquadTags = (squad) =>"), true);
  assert.equal(publicSerializer.includes("squadName: publicSquadName(squad),"), true);
  assert.equal(publicSerializer.includes("tags: publicSquadTags(squad),"), true);
  assert.equal(publicSerializer.includes("leaderName: leader ? publicMemberName(leader) : undefined,"), true);
  assert.equal(previewHandler.includes("squadName: publicSquadName(squad),"), true);
  assert.equal(previewHandler.includes("displayName: publicMemberName(member),"), true);
  assert.equal(previewHandler.includes("tags: publicSquadTags(squad),"), true);
});

test("squad premium capacity status is resolved live but not sent to matchmaking queue", () => {
  const controller = read("src/controllers/squadController.js");
  const queueService = read("src/services/queueService.js");
  const createHandler = section(controller, "const createSquadHandler", "const joinSquadHandler");
  const searchHandler = section(controller, "const startSearchHandler", "const cancelSearchHandler");

  assert.equal(controller.includes("const getSquadPremiumStatus = async (squad) =>"), true);
  assert.equal(createHandler.includes("isPremiumSquad: await getUserPremiumStatus(userId)"), true);
  assert.equal(createHandler.includes("const { userId, providerAccountId, name, email, isPremium } = identity"), false);
  assert.equal(searchHandler.includes("squad.isPremiumSquad = await getSquadPremiumStatus(squad);"), true);
  assert.equal(searchHandler.includes("queueService.addToQueue(squad.squadId, squad.members.length, squad.searchRegion, squad.tags, squad.reputationScore, squad.isPremiumSquad)"), false);
  assert.equal(queueService.includes("isPremiumSquad"), false);
});

test("start search rolls back squad state when queue insertion fails", () => {
  const controller = read("src/controllers/squadController.js");
  const searchHandler = section(controller, "const startSearchHandler", "const cancelSearchHandler");

  assert.equal(searchHandler.includes("let searchStateSaved = false;"), true);
  assert.equal(searchHandler.includes("searchStateSaved = true;"), true);
  assert.equal(searchHandler.includes("if (searchStateSaved)"), true);
  assert.equal(searchHandler.includes('squad.status = "idle";'), true);
  assert.equal(searchHandler.includes("squad.searchQueuedAt = null;"), true);
  assert.equal(searchHandler.indexOf("searchStateSaved = true;") < searchHandler.indexOf("await queueService.addToQueue"), true);
});

test("encounter requeue rolls squads back to idle when Redis queue insertion fails", () => {
  const service = read("src/services/matchmakingService.js");
  const requeueHandler = section(service, "const endEncounterAndRequeue", "const endEncounterToIdle");

  assert.equal(service.includes("const rollbackSquadsToIdle = async"), true);
  assert.equal(requeueHandler.includes("const requeuedSquadIds = [];"), true);
  assert.equal(requeueHandler.includes("requeuedSquadIds.push(s.squadId);"), true);
  assert.match(requeueHandler, /catch \(error\) \{[\s\S]*await rollbackSquadsToIdle\(squadIds\);[\s\S]*throw error;[\s\S]*\}/);
});

test("asymmetric encounter end rolls opponent back to idle when requeue fails", () => {
  const service = read("src/services/matchmakingService.js");
  const asymmetricHandler = section(service, "const endEncounterAsymmetric", "// ── Stuck-encounter sweeper");

  assert.equal(asymmetricHandler.includes('reason: "squad_disconnected"'), true);
  assert.equal(asymmetricHandler.includes("endedBySquadId: disconnectingSquadId"), true);
  assert.equal(
    asymmetricHandler.indexOf("{ squadId: otherSquadId }") <
      asymmetricHandler.indexOf("{ squadId: disconnectingSquadId }"),
    true
  );
  assert.match(asymmetricHandler, /catch \(error\) \{[\s\S]*await rollbackSquadsToIdle\(\[otherSquadId\]\);[\s\S]*throw error;[\s\S]*\}/);
});

test("encounter requeue paths refuse mature or blocked tags", () => {
  const service = read("src/services/matchmakingService.js");
  const requeueHandler = section(service, "const endEncounterAndRequeue", "const endEncounterToIdle");
  const asymmetricHandler = section(service, "const endEncounterAsymmetric", "// ── Stuck-encounter sweeper");

  assert.equal(service.includes('const { classifyVibe } = require("../utils/moderation");'), true);
  assert.equal(requeueHandler.includes("classifyVibe(tag) !== \"ok\""), true);
  assert.equal(asymmetricHandler.includes("classifyVibe(tag) !== \"ok\""), true);
  assert.equal(
    asymmetricHandler.indexOf("try {") < asymmetricHandler.indexOf("await allUsersHaveAdultAccess"),
    true
  );
});

test("squad creation accepts normalized initial tags atomically", () => {
  const controller = read("src/controllers/squadController.js");
  const createHandler = section(controller, "const createSquadHandler", "const joinSquadHandler");

  assert.equal(createHandler.includes("const { displayName, squadName, tags, visibility } = req.body;"), true);
  assert.equal(createHandler.includes("const normalizedTags = normalizeSquadTags(tags ?? []);"), true);
  assert.equal(createHandler.includes("tags: normalizedTags.tags,"), true);
});

test("squad creation validates and persists optional initial visibility", () => {
  const controller = read("src/controllers/squadController.js");
  const createHandler = section(controller, "const createSquadHandler", "const joinSquadHandler");

  assert.equal(createHandler.includes("const { displayName, squadName, tags, visibility } = req.body;"), true);
  assert.equal(createHandler.includes('const normalizedVisibility = visibility ?? "private";'), true);
  assert.equal(createHandler.includes('["private", "open"].includes(normalizedVisibility)'), true);
  assert.equal(createHandler.includes('code: "INVALID_VISIBILITY"'), true);
  assert.equal(createHandler.includes("visibility: normalizedVisibility,"), true);
});

test("squad creation API docs include initial name and tags", () => {
  const routes = read("src/routes/squadRoutes.js");
  const createDocs = section(routes, " * /squads/create:", "router.post(\"/squads/create\"");

  assert.equal(createDocs.includes("squadName:"), true);
  assert.equal(createDocs.includes("tags:"), true);
  assert.equal(createDocs.includes("visibility:"), true);
  assert.equal(createDocs.includes("maxItems: 5"), true);
  assert.equal(createDocs.includes("User already belongs to another squad"), false);
});

test("squad join API docs do not claim other squad membership blocks joining", () => {
  const routes = read("src/routes/squadRoutes.js");
  const joinDocs = section(routes, " * /squads/join:", "router.post(\"/squads/join\"");

  assert.equal(joinDocs.includes("user already in another squad"), false);
});

test("approving a join request rejects stale deleted users", () => {
  const controller = read("src/controllers/squadController.js");
  const approveHandler = section(controller, "const approveJoinRequestHandler", "const declineJoinRequestHandler");

  assert.equal(approveHandler.includes("const targetUser = await User.findById(targetUserId);"), true);
  assert.equal(approveHandler.includes('code: "REQUEST_USER_NOT_FOUND"'), true);
  assert.equal(approveHandler.indexOf("REQUEST_USER_NOT_FOUND") < approveHandler.indexOf("const newMember = {"), true);
  assert.equal(approveHandler.indexOf("REQUEST_USER_NOT_FOUND") < approveHandler.indexOf("squad.joinRequests.splice"), true);
  assert.equal((approveHandler.match(/await resolveJoinRequestNotification\(leaderUserId, targetUserId, squad\.squadId\);/g) ?? []).length, 2);
});

test("squad invite endpoints reject nonexistent user ids", () => {
  const controller = read("src/controllers/squadController.js");
  const leaderInviteHandler = section(controller, "const inviteToSquadHandler", "const revokeInviteHandler");
  const memberInviteHandler = section(controller, "const inviteUserToSquadHandler", "const startSearchHandler");

  assert.equal(controller.includes("const isValidUserObjectId = (value) =>"), true);
  assert.equal(leaderInviteHandler.includes("!isValidUserObjectId(targetUserId)"), true);
  assert.equal(memberInviteHandler.includes("!isValidUserObjectId(targetUserId)"), true);
  assert.equal(leaderInviteHandler.indexOf("!isValidUserObjectId(targetUserId)") < leaderInviteHandler.indexOf("User.findById(targetUserId)"), true);
  assert.equal(memberInviteHandler.indexOf("!isValidUserObjectId(targetUserId)") < memberInviteHandler.indexOf("User.findById(targetUserId)"), true);
  assert.equal(leaderInviteHandler.includes('code: "INVITE_USER_NOT_FOUND"'), true);
  assert.equal(leaderInviteHandler.indexOf("INVITE_USER_NOT_FOUND") < leaderInviteHandler.indexOf("currentSquad.invitedUserIds.push(targetUserId)"), true);
  assert.equal(memberInviteHandler.includes('code: "INVITE_USER_NOT_FOUND"'), true);
  assert.equal(memberInviteHandler.indexOf("INVITE_USER_NOT_FOUND") < memberInviteHandler.indexOf("currentSquad.invitedUserIds.push(targetUserId)"), true);
});

test("joining a squad resolves any matching invite notification", () => {
  const controller = read("src/controllers/squadController.js");
  const joinHandler = section(controller, "const joinSquadHandler", "const getSquadHandler");

  assert.equal(controller.includes("const resolveSquadInviteNotification = async"), true);
  assert.equal(joinHandler.includes("await resolveSquadInviteNotification(userId, squad.squadId);"), true);
  assert.equal((joinHandler.match(/resolveSquadInviteNotification\(userId,/g) ?? []).length, 3);
});

test("join approval rejects a missing target without mutating the request or roster", async () => {
  const originalFindById = User.findById;
  const originalDeleteMany = Notification.deleteMany;
  const targetUserId = "507f1f77bcf86cd799439012";
  let saves = 0;
  const squad = {
    squadId: "sq_missing",
    members: [{ memberId: "leader", userId: "507f1f77bcf86cd799439011", role: "leader" }],
    joinRequests: [{ userId: targetUserId, name: "Missing" }],
    async save() { saves += 1; },
  };
  User.findById = async (userId) => userId === targetUserId ? null : { isPremium: false };
  Notification.deleteMany = async () => ({ deletedCount: 0 });

  try {
    const res = createResponse();
    await approveJoinRequestHandler({
      params: { userId: targetUserId },
      user: { userId: squad.members[0].userId },
      squadAccess: { squad },
    }, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, "REQUEST_USER_NOT_FOUND");
    assert.equal(saves, 0);
    assert.equal(squad.members.length, 1);
    assert.equal(squad.joinRequests.length, 1);
  } finally {
    User.findById = originalFindById;
    Notification.deleteMany = originalDeleteMany;
  }
});

test("join approval rejects a self-attested-only target before roster mutation", async () => {
  const originalFindById = User.findById;
  const originalDeleteMany = Notification.deleteMany;
  const targetUserId = "507f1f77bcf86cd799439012";
  let saves = 0;
  const squad = {
    squadId: "sq_unverified",
    members: [{ memberId: "leader", userId: "507f1f77bcf86cd799439011", role: "leader" }],
    joinRequests: [{ userId: targetUserId, name: "Pending" }],
    async save() { saves += 1; },
  };
  User.findById = async (userId) => userId === targetUserId
    ? { _id: targetUserId, ageConfirmed: true, isAdult: true, ageVerified: false }
    : { isPremium: false };
  Notification.deleteMany = async () => ({ deletedCount: 0 });

  try {
    const res = createResponse();
    await approveJoinRequestHandler({
      params: { userId: targetUserId },
      user: { userId: squad.members[0].userId },
      squadAccess: { squad },
    }, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "AGE_RESTRICTED");
    assert.equal(saves, 0);
    assert.equal(squad.members.length, 1);
    assert.equal(squad.joinRequests.length, 1);
  } finally {
    User.findById = originalFindById;
    Notification.deleteMany = originalDeleteMany;
  }
});

test("join approval admits a verified-adult target", async () => {
  const originalFindById = User.findById;
  const originalFind = User.find;
  const originalDeleteMany = Notification.deleteMany;
  const leaderUserId = "507f1f77bcf86cd799439011";
  const targetUserId = "507f1f77bcf86cd799439012";
  let saves = 0;
  const squad = {
    squadId: "sq_verified",
    members: [{ memberId: "leader", userId: leaderUserId, role: "leader" }],
    joinRequests: [{ userId: targetUserId, name: "Verified" }],
    async save() { saves += 1; },
  };
  User.findById = async (userId) => userId === targetUserId
    ? { _id: targetUserId, name: "Verified", ageConfirmed: true, isAdult: true, ageVerified: true }
    : { isPremium: false };
  User.find = () => ({
    lean: async () => [
      { _id: leaderUserId, blockedUserIds: [] },
      { _id: targetUserId, blockedUserIds: [] },
    ],
  });
  Notification.deleteMany = async () => ({ deletedCount: 0 });

  try {
    const res = createResponse();
    await approveJoinRequestHandler({
      params: { userId: targetUserId },
      user: { userId: leaderUserId },
      squadAccess: { squad },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(saves, 1);
    assert.equal(squad.members.length, 2);
    assert.equal(squad.joinRequests.length, 0);
  } finally {
    User.findById = originalFindById;
    User.find = originalFind;
    Notification.deleteMany = originalDeleteMany;
  }
});

for (const [name, handler, req] of [
  ["leader invite", inviteToSquadHandler, { body: { userId: "507f1f77bcf86cd799439012" }, user: { userId: "507f1f77bcf86cd799439011" } }],
  ["member invite", inviteUserToSquadHandler, { body: { userId: "507f1f77bcf86cd799439012" }, user: { userId: "507f1f77bcf86cd799439011", name: "Leader" } }],
]) {
  test(`${name} rejects an unverified adult before invite mutation`, async () => {
    const originalFindById = User.findById;
    const originalCreate = Notification.create;
    let saves = 0;
    const squad = {
      squadId: "sq_invite",
      squadName: "Invite squad",
      squadCode: "ABC-123",
      invitedUserIds: [],
      members: [],
      async save() { saves += 1; },
    };
    User.findById = () => ({
      select: async () => ({
        _id: req.body.userId,
        ageConfirmed: true,
        isAdult: true,
        ageVerified: false,
      }),
    });
    Notification.create = async () => ({
      _id: "507f1f77bcf86cd799439099",
      userId: req.body.userId,
      toObject() { return this; },
    });

    try {
      const res = createResponse();
      await handler({ ...req, squadAccess: { squad } }, res);

      assert.equal(res.statusCode, 403);
      assert.equal(res.body.error.code, "AGE_RESTRICTED");
      assert.equal(saves, 0);
      assert.deepEqual(squad.invitedUserIds, []);
    } finally {
      User.findById = originalFindById;
      Notification.create = originalCreate;
    }
  });

  test(`${name} rejects moderated and pending-deletion targets`, async () => {
    const originalFindById = User.findById;
    const originalCreate = Notification.create;
    let selectedFields = "";
    let saves = 0;
    let unavailableUser;
    const squad = {
      squadId: "sq_invite",
      squadName: "Invite squad",
      squadCode: "ABC-123",
      invitedUserIds: [],
      members: [],
      async save() { saves += 1; },
    };
    User.findById = () => ({
      select: async (fields) => {
        selectedFields = fields;
        return unavailableUser;
      },
    });
    Notification.create = async () => assert.fail("unavailable target was notified");

    try {
      const adult = { _id: req.body.userId, ageConfirmed: true, isAdult: true, ageVerified: true };
      for (unavailableUser of [
        { ...adult, isSuspended: true },
        { ...adult, isShadowBanned: true },
        { ...adult, deletionStatus: "pending" },
      ]) {
        const res = createResponse();
        await handler({ ...req, squadAccess: { squad } }, res);
        assert.equal(res.statusCode, 403);
      }

      assert.equal(
        selectedFields,
        "_id ageConfirmed isAdult ageVerified isSuspended isShadowBanned deletionStatus"
      );
      assert.equal(saves, 0);
      assert.deepEqual(squad.invitedUserIds, []);
    } finally {
      User.findById = originalFindById;
      Notification.create = originalCreate;
    }
  });

  test(`${name} admits a verified-adult target`, async () => {
    const originalFindById = User.findById;
    const originalFind = User.find;
    const originalCreate = Notification.create;
    const originalSquadFindOne = Squad.findOne;
    const originalTransaction = mongoose.connection.transaction;
    const originalUsing = redlock.using;
    let saves = 0;
    const squad = {
      squadId: "sq_invite",
      squadName: "Invite squad",
      squadCode: "ABC-123",
      invitedUserIds: [],
      members: [{ memberId: "leader", userId: "507f1f77bcf86cd799439011", role: "leader" }],
      async save() { saves += 1; },
    };
    User.findById = () => ({
      select: async () => ({
        _id: req.body.userId,
        ageConfirmed: true,
        isAdult: true,
        ageVerified: true,
      }),
    });
    User.find = () => ({
      lean: async () => [
        { _id: "507f1f77bcf86cd799439011", blockedUserIds: [] },
        { _id: req.body.userId, blockedUserIds: [] },
      ],
    });
    Notification.create = async (payload) => {
      const doc = {
        _id: "507f1f77bcf86cd799439099",
        userId: req.body.userId,
        type: "squad_invite",
      };
      return Array.isArray(payload) ? [doc] : doc;
    };
    Squad.findOne = async () => squad;
    mongoose.connection.transaction = (routine) => routine({ transaction: true });
    redlock.using = (_resources, _duration, routine) => routine({ aborted: false });

    try {
      const res = createResponse();
      await handler({ ...req, squadAccess: { squad } }, res);

      assert.equal(res.statusCode, 200);
      assert.equal(saves, 1);
      assert.deepEqual(squad.invitedUserIds, [req.body.userId]);
    } finally {
      User.findById = originalFindById;
      User.find = originalFind;
      Notification.create = originalCreate;
      Squad.findOne = originalSquadFindOne;
      mongoose.connection.transaction = originalTransaction;
      redlock.using = originalUsing;
    }
  });
}

async function runSearchWithUsers(users, tags = ["gaming"], members) {
  const originals = {
    acquire: redlock.acquire,
    using: redlock.using,
    findOne: Squad.findOne,
    find: User.find,
    findById: User.findById,
    session: sessionService.getSquadSession,
    online: socketService.getOnlineUserIds,
    add: queueService.addToQueue,
    queued: queueService.getQueuedSquadsByRegion,
  };
  const memberUserId = "507f1f77bcf86cd799439011";
  const roster = members || [
    { memberId: "leader", userId: memberUserId, role: "leader", ready: true, inLobbyVideo: true },
  ];
  const squad = {
    squadId: "sq_search",
    status: "idle",
    searchRegion: "global",
    tags,
    reputationScore: 100,
    members: roster,
    async save() {},
  };
  let queued = 0;
  redlock.acquire = async () => ({ release: async () => {} });
  redlock.using = (_resources, _duration, routine) => routine({ aborted: false });
  Squad.findOne = async () => squad;
  User.find = () => ({
    select: async () => users,
    lean: async () => users.map((user) => ({ ...user, blockedUserIds: user.blockedUserIds || [] })),
  });
  User.findById = () => ({ select: async () => ({ isPremium: false }) });
  sessionService.getSquadSession = async () => Object.fromEntries(
    roster.map((member) => [member.memberId, { ready: true, inLobbyVideo: true }])
  );
  socketService.getOnlineUserIds = async () => new Set(roster.map((member) => member.userId));
  queueService.addToQueue = async () => { queued += 1; };
  queueService.getQueuedSquadsByRegion = async () => [];

  try {
    const res = createResponse();
    await startSearchHandler({
      squadAccess: { squad, member: squad.members[0] },
    }, res);
    return { res, queued };
  } finally {
    redlock.acquire = originals.acquire;
    redlock.using = originals.using;
    Squad.findOne = originals.findOne;
    User.find = originals.find;
    User.findById = originals.findById;
    sessionService.getSquadSession = originals.session;
    socketService.getOnlineUserIds = originals.online;
    queueService.addToQueue = originals.add;
    queueService.getQueuedSquadsByRegion = originals.queued;
  }
}

for (const [name, users] of [
  ["missing member", []],
  ["minor member", [{ _id: "507f1f77bcf86cd799439011", ageConfirmed: true, isAdult: false, ageVerified: true }]],
  ["self-attested-only member", [{ _id: "507f1f77bcf86cd799439011", ageConfirmed: true, isAdult: true, ageVerified: false }]],
]) {
  test(`search rejects a ${name} before queue insertion`, async () => {
    const { res, queued } = await runSearchWithUsers(users);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "AGE_RESTRICTED");
    assert.equal(queued, 0);
  });
}

test("search admits a verified-adult roster", async () => {
  const { res, queued } = await runSearchWithUsers([
    { _id: "507f1f77bcf86cd799439011", ageConfirmed: true, isAdult: true, ageVerified: true },
  ]);
  assert.equal(res.statusCode, 200);
  assert.equal(queued, 1);
});

test("search rejects a live blocked pair before queue insertion", async () => {
  const firstId = "507f1f77bcf86cd799439011";
  const secondId = "507f1f77bcf86cd799439012";
  const { res, queued } = await runSearchWithUsers([
    { _id: firstId, ageConfirmed: true, isAdult: true, ageVerified: true, blockedUserIds: [secondId] },
    { _id: secondId, ageConfirmed: true, isAdult: true, ageVerified: true, blockedUserIds: [] },
  ], ["gaming"], [
    { memberId: "leader", userId: firstId, role: "leader", ready: true, inLobbyVideo: true },
    { memberId: "member", userId: secondId, role: "member", ready: true, inLobbyVideo: true },
  ]);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, "INTERACTION_BLOCKED");
  assert.equal(queued, 0);
});

for (const tag of ["nsfw", "pedo"]) {
  test(`squad creation rejects ${tag} tags`, async () => {
    const originalFindById = User.findById;
    const originalSave = Squad.prototype.save;
    User.findById = () => ({
      select: async (field) => field === "isAdult" ? { isAdult: true } : { isPremium: false },
    });
    Squad.prototype.save = async function save() { return this; };
    try {
      const res = createResponse();
      await createSquadHandler({
        body: { displayName: "Leader", squadName: "Safe name", tags: [tag] },
        user: { userId: "507f1f77bcf86cd799439011", name: "Leader" },
      }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, "TAG_BLOCKED");
    } finally {
      User.findById = originalFindById;
      Squad.prototype.save = originalSave;
    }
  });

  test(`squad tag updates reject ${tag} tags without saving`, async () => {
    const originalFindById = User.findById;
    let saves = 0;
    const squad = { squadId: "sq_tags", adult: false, tags: [], async save() { saves += 1; } };
    User.findById = () => ({ select: async () => ({ isAdult: true }) });
    try {
      const res = createResponse();
      await updateSquadTagsHandler({
        body: { tags: [tag] },
        user: { userId: "507f1f77bcf86cd799439011" },
        squadAccess: { squad },
      }, res);
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.error.code, "TAG_BLOCKED");
      assert.equal(saves, 0);
    } finally {
      User.findById = originalFindById;
    }
  });

  test(`search rejects a legacy squad with ${tag} tags`, async () => {
    const { res, queued } = await runSearchWithUsers([
      { _id: "507f1f77bcf86cd799439011", ageConfirmed: true, isAdult: true, ageVerified: true },
    ], [tag]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, "TAG_BLOCKED");
    assert.equal(queued, 0);
  });
}
