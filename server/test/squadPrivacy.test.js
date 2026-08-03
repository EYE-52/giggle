const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { after, test } = require("node:test");

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
  getJoinRequestsHandler,
  getSquadPreviewHandler,
  inviteToSquadHandler,
  inviteUserToSquadHandler,
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
  User.find = async () => [
    { _id: leaderId, blockedUserIds: [] },
    { _id: blockedId, blockedUserIds: [leaderId], name: "Hidden" },
    { _id: allowedId, blockedUserIds: [], name: "Visible" },
  ];

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
  } finally {
    User.find = originalFind;
  }
});

test("a block racing a request or invite removes the just-written artifact", async () => {
  const requesterId = "507f1f77bcf86cd799439011";
  const leaderId = "507f1f77bcf86cd799439012";
  const originals = {
    findOne: Squad.findOne,
    findById: User.findById,
    find: User.find,
    create: Notification.create,
  };
  let blockReads = 0;
  User.find = () => ({
    lean: async () => {
      blockReads += 1;
      return [
        { _id: requesterId, blockedUserIds: blockReads > 1 ? [leaderId] : [] },
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
  Notification.create = async () => assert.fail("a raced request or invite must not notify");

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
      async save() {},
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

    blockReads = 0;
    const inviteSquad = {
      squadId: "invite_squad",
      squadName: "Invites",
      squadCode: "DEF-456",
      members: [{ memberId: "leader", userId: leaderId, role: "leader" }],
      invitedUserIds: [],
      joinRequests: [],
      async save() {},
    };
    res = createResponse();
    await inviteUserToSquadHandler({
      body: { userId: requesterId },
      user: { userId: leaderId, name: "Leader" },
      squadAccess: { squad: inviteSquad },
    }, res);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(inviteSquad.invitedUserIds, []);
  } finally {
    Squad.findOne = originals.findOne;
    User.findById = originals.findById;
    User.find = originals.find;
    Notification.create = originals.create;
  }
});

test("blocked targets cannot be approved or invited into a squad", async () => {
  const leaderId = "507f1f77bcf86cd799439011";
  const targetId = "507f1f77bcf86cd799439012";
  const originals = { findById: User.findById, find: User.find };
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

  assert.equal(asymmetricHandler.includes("let otherQueued = false;"), true);
  assert.equal(asymmetricHandler.includes('reason: "squad_disconnected"'), true);
  assert.equal(asymmetricHandler.includes("endedBySquadId: disconnectingSquadId"), true);
  assert.equal(asymmetricHandler.includes("otherQueued = true;"), true);
  assert.match(asymmetricHandler, /catch \(error\) \{[\s\S]*if \(!otherQueued\) \{[\s\S]*await rollbackSquadsToIdle\(\[otherSquadId\]\);[\s\S]*\}[\s\S]*throw error;[\s\S]*\}/);
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
  assert.equal(leaderInviteHandler.indexOf("INVITE_USER_NOT_FOUND") < leaderInviteHandler.indexOf("squad.invitedUserIds.push(targetUserId)"), true);
  assert.equal(memberInviteHandler.includes('code: "INVITE_USER_NOT_FOUND"'), true);
  assert.equal(memberInviteHandler.indexOf("INVITE_USER_NOT_FOUND") < memberInviteHandler.indexOf("squad.invitedUserIds.push(targetUserId)"), true);
});

test("joining a squad resolves any matching invite notification", () => {
  const controller = read("src/controllers/squadController.js");
  const joinHandler = section(controller, "const joinSquadHandler", "const getSquadHandler");

  assert.equal(controller.includes("const resolveSquadInviteNotification = async"), true);
  assert.equal(joinHandler.includes("await resolveSquadInviteNotification(userId, squad.squadId);"), true);
  assert.equal((joinHandler.match(/resolveSquadInviteNotification\(userId, squad\.squadId\)/g) ?? []).length, 3);
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
  ["leader invite", inviteToSquadHandler, { body: { userId: "507f1f77bcf86cd799439012" } }],
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
        ageVerified: true,
      }),
    });
    User.find = () => ({
      lean: async () => [{ _id: req.body.userId, blockedUserIds: [] }],
    });
    Notification.create = async () => ({ _id: "507f1f77bcf86cd799439099" });

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
    }
  });
}

async function runSearchWithUsers(users, tags = ["gaming"]) {
  const originals = {
    acquire: redlock.acquire,
    findOne: Squad.findOne,
    find: User.find,
    findById: User.findById,
    session: sessionService.getSquadSession,
    online: socketService.getOnlineUserIds,
    add: queueService.addToQueue,
    queued: queueService.getQueuedSquadsByRegion,
  };
  const memberUserId = "507f1f77bcf86cd799439011";
  const squad = {
    squadId: "sq_search",
    status: "idle",
    searchRegion: "global",
    tags,
    reputationScore: 100,
    members: [{ memberId: "leader", userId: memberUserId, role: "leader", ready: true, inLobbyVideo: true }],
    async save() {},
  };
  let queued = 0;
  redlock.acquire = async () => ({ release: async () => {} });
  Squad.findOne = async () => squad;
  User.find = () => ({
    select: async () => users,
    lean: async () => users.map((user) => ({ ...user, blockedUserIds: user.blockedUserIds || [] })),
  });
  User.findById = () => ({ select: async () => ({ isPremium: false }) });
  sessionService.getSquadSession = async () => ({ leader: { ready: true, inLobbyVideo: true } });
  socketService.getOnlineUserIds = async () => new Set([memberUserId]);
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
