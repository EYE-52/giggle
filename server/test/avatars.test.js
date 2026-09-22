const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { after, test } = require("node:test");

const User = require("../src/models/User");
const { Squad } = require("../src/models/Squad");
const { Notification } = require("../src/models/Notification");
const { redis, subClient } = require("../src/config/redisConfig");
const sessionService = require("../src/services/sessionService");
const socketService = require("../src/services/socketService");
const { AVATAR_IDS, isAvatarId, publicAvatar } = require("../src/utils/avatars");
const {
  getMyProfile,
  issueSessionForEmail,
  normalizeProfilePatch,
  updateMyProfile,
} = require("../src/controllers/authController");
const {
  approveJoinRequestHandler,
  getJoinRequestsHandler,
  getMySquadHandler,
  getSquadHandler,
  getSquadPreviewHandler,
  joinSquadHandler,
} = require("../src/controllers/squadController");

const CORE_AVATARS_PATH = path.join(__dirname, "../../packages/core/src/avatars.ts");
const LEADER_ID = "507f1f77bcf86cd799439011";
const MEMBER_ID = "507f1f77bcf86cd799439012";
const OTHER_ID = "507f1f77bcf86cd799439013";

after(async () => {
  // quit() waits for a connection that does not exist in unit-test runs.
  redis.disconnect();
  subClient.disconnect();
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

// Mongoose-like User.find double: supports .select()/.lean() chains and plain
// awaiting, records each projection so tests can count avatar lookups.
function mockUserFind(users, { failAvatarLookup = false } = {}) {
  const projections = [];
  const find = (query, projection) => {
    projections.push(projection);
    if (failAvatarLookup && projection === "avatar") throw new Error("avatar lookup down");
    const ids = (query?._id?.$in || []).map(String);
    const rows = users
      .filter((user) => ids.includes(String(user._id)))
      .map((user) => ({ blockedUserIds: [], ...user }));
    const chain = {
      select: () => chain,
      lean: async () => rows,
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  };
  return { find, projections };
}

function buildSquad() {
  return new Squad({
    squadId: "sq_avatar",
    squadCode: "ABC-123",
    squadName: "Night Owls",
    status: "idle",
    members: [
      { memberId: "mem_leader", userId: LEADER_ID, providerAccountId: LEADER_ID, displayName: "Leader", role: "leader" },
      { memberId: "mem_member", userId: MEMBER_ID, providerAccountId: MEMBER_ID, displayName: "Member", role: "member" },
    ],
    joinRequests: [{ userId: OTHER_ID, name: "Requester" }],
  });
}

const USERS = [
  { _id: LEADER_ID, avatar: "teal-bot", isPremium: false },
  { _id: MEMBER_ID }, // never picked an avatar
  { _id: OTHER_ID, avatar: "gold-moon", ageConfirmed: true, isAdult: true, ageVerified: true },
];

test("server avatar ids match the client DEFAULT_AVATARS list exactly", () => {
  const source = readFileSync(CORE_AVATARS_PATH, "utf8");
  const start = source.indexOf("export const DEFAULT_AVATARS");
  assert.notEqual(start, -1, "DEFAULT_AVATARS must exist in packages/core/src/avatars.ts");
  const block = source.slice(start, source.indexOf("];", start));
  const clientIds = [...block.matchAll(/\bid:\s*["']([^"']+)["']/g)].map((match) => match[1]);

  assert.equal(clientIds.length > 0, true);
  assert.equal(new Set(clientIds).size, clientIds.length);
  assert.equal(new Set(AVATAR_IDS).size, AVATAR_IDS.length);
  assert.deepEqual([...clientIds].sort(), [...AVATAR_IDS].sort());
});

test("isAvatarId and publicAvatar accept only known ids", () => {
  assert.equal(AVATAR_IDS.length, 16);
  assert.equal(isAvatarId("violet-blob"), true);
  assert.equal(isAvatarId("mint-bolt"), true);
  for (const value of ["", " teal-bot", "TEAL-BOT", "data:image/png;base64,AAAA", "https://x.test/a.png", null, undefined, 7, {}]) {
    assert.equal(isAvatarId(value), false);
    assert.equal(publicAvatar(value), null);
  }
  assert.equal(publicAvatar("teal-bot"), "teal-bot");
  assert.equal(User.schema.path("avatar").enumValues.length, 16);
});

test("normalizeProfilePatch sets, clears and rejects avatar values", () => {
  assert.deepEqual(normalizeProfilePatch({ avatar: "coral-star" }), { patch: { avatar: "coral-star" }, unset: [] });
  assert.deepEqual(normalizeProfilePatch({ avatar: null }), { patch: {}, unset: ["avatar"] });
  assert.deepEqual(normalizeProfilePatch({ avatar: "" }), { patch: {}, unset: ["avatar"] });
  assert.deepEqual(normalizeProfilePatch({}), { patch: {}, unset: [] });
  for (const avatar of ["nope", " coral-star", "Coral-Star", "https://example.com/me.png", 3, true, ["teal-bot"], {}]) {
    assert.equal(normalizeProfilePatch({ avatar }).error, "avatar must be one of the available avatar ids");
  }
});

test("PATCH /api/me/profile saves a valid avatar, clears it with null, and rejects others", async () => {
  const originalFindById = User.findById;
  const user = new User({ email: "member@example.com", name: "Member" });
  let saves = 0;
  let lookups = 0;
  user.save = async function save() {
    saves += 1;
    await this.validate();
    return this;
  };
  User.findById = async () => { lookups += 1; return user; };

  try {
    let res = createResponse();
    await updateMyProfile({ user: { userId: LEADER_ID }, body: { avatar: "blue-bolt" } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.avatar, "blue-bolt");
    assert.equal(user.avatar, "blue-bolt");

    res = createResponse();
    await getMyProfile({ user: { userId: LEADER_ID } }, res);
    assert.equal(res.body.data.avatar, "blue-bolt");

    res = createResponse();
    await updateMyProfile({ user: { userId: LEADER_ID }, body: { avatar: null } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.avatar, null);
    assert.equal(user.avatar, undefined);

    res = createResponse();
    await getMyProfile({ user: { userId: LEADER_ID } }, res);
    assert.equal(res.body.data.avatar, null);

    const lookupsBefore = lookups;
    res = createResponse();
    await updateMyProfile({ user: { userId: LEADER_ID }, body: { avatar: "rainbow-unicorn", country: "IN" } }, res);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, {
      ok: false,
      error: { code: "INVALID_REQUEST", message: "avatar must be one of the available avatar ids" },
    });
    assert.equal(lookups, lookupsBefore);
    assert.equal(saves, 2);
    assert.equal(user.country, undefined);
  } finally {
    User.findById = originalFindById;
  }
});

test("auth exchange session user includes the chosen avatar", async () => {
  const previousSecret = process.env.JWT_SECRET;
  const originalFindOne = User.findOne;
  const user = {
    _id: LEADER_ID,
    email: "member@example.com",
    name: "Member",
    image: "https://lh3.googleusercontent.com/a/photo.jpg",
    avatar: "pink-diamond",
    referralCode: "AVATAR42",
    async save() { return this; },
  };
  process.env.JWT_SECRET = "local-test-only-secret-not-for-deployment";
  User.findOne = async () => user;

  try {
    let session = await issueSessionForEmail({ email: user.email });
    assert.equal(session.user.avatar, "pink-diamond");
    assert.equal(session.user.image, user.image);

    delete user.avatar;
    session = await issueSessionForEmail({ email: user.email });
    assert.equal(session.user.avatar, null);
  } finally {
    User.findOne = originalFindOne;
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test("friends list and friend requests include each user's avatar", async () => {
  const friendsPath = require.resolve("../src/controllers/friendsController");
  const originals = {
    findById: User.findById,
    find: User.find,
    online: socketService.getOnlineUserIds,
  };
  const me = {
    _id: LEADER_ID,
    friends: [MEMBER_ID],
    friendRequestsIncoming: [OTHER_ID],
    friendRequestsOutgoing: [MEMBER_ID],
    blockedUserIds: [],
  };
  const friendUsers = [
    { ...me },
    { _id: MEMBER_ID, name: "Member", image: null, avatar: "lime-ghost" },
    { _id: OTHER_ID, name: "Other", image: null, avatar: "not-a-real-avatar" },
  ];
  const { find, projections } = mockUserFind(friendUsers);
  User.findById = () => ({ lean: async () => me });
  User.find = find;
  socketService.getOnlineUserIds = async () => new Set([MEMBER_ID]);
  delete require.cache[friendsPath];
  const { listFriends, listRequests, listBlockedUsers } = require(friendsPath);

  try {
    let res = createResponse();
    await listFriends({ user: { userId: LEADER_ID } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.friends, [
      { userId: MEMBER_ID, name: "Member", image: null, avatar: "lime-ghost", online: true },
    ]);
    assert.equal(projections.includes("name image avatar"), true);

    res = createResponse();
    await listRequests({ user: { userId: LEADER_ID } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.incoming, [
      { userId: OTHER_ID, name: "Other", image: null, avatar: null, online: false },
    ]);
    assert.deepEqual(res.body.data.outgoing, [
      { userId: MEMBER_ID, name: "Member", image: null, avatar: "lime-ghost" },
    ]);

    me.blockedUserIds = [MEMBER_ID];
    res = createResponse();
    await listBlockedUsers({ user: { userId: LEADER_ID } }, res);
    assert.deepEqual(res.body.data.accounts, [
      { userId: MEMBER_ID, name: "Member", image: null, avatar: "lime-ghost" },
    ]);
  } finally {
    User.findById = originals.findById;
    User.find = originals.find;
    socketService.getOnlineUserIds = originals.online;
    delete require.cache[friendsPath];
  }
});

test("squad lobby members include avatars from the existing member query", async () => {
  const originals = {
    find: User.find,
    session: sessionService.getSquadSession,
    online: socketService.getOnlineUserIds,
  };
  const squad = buildSquad();
  const { find, projections } = mockUserFind(USERS);
  User.find = find;
  sessionService.getSquadSession = async () => ({});
  socketService.getOnlineUserIds = async () => new Set();

  try {
    const res = createResponse();
    await getSquadHandler({ squadAccess: { squad, leader: squad.members[0] } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.members.map((m) => [m.memberId, m.displayName, m.avatar]), [
      ["mem_leader", "Leader", "teal-bot"],
      ["mem_member", "Member", null],
    ]);
    assert.equal(projections.includes("avatar"), false, "lobby reuses its member query");
    assert.equal(squad.members[0].toObject().avatar, undefined, "avatar is never persisted on members");
  } finally {
    User.find = originals.find;
    sessionService.getSquadSession = originals.session;
    socketService.getOnlineUserIds = originals.online;
  }
});

test("my squad, join, preview and join requests include member avatars with one lookup each", async () => {
  const originals = {
    find: User.find,
    findById: User.findById,
    squadFind: Squad.find,
    squadFindOne: Squad.findOne,
    deleteMany: Notification.deleteMany,
  };
  const squad = buildSquad();
  const { find, projections } = mockUserFind(USERS);
  User.find = find;
  User.findById = async () => ({ isPremium: false });
  Squad.find = async () => [squad];
  Squad.findOne = async () => squad;
  Notification.deleteMany = async () => ({ deletedCount: 0 });

  try {
    let res = createResponse();
    await getMySquadHandler({ user: { userId: MEMBER_ID } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.members.map((m) => [m.memberId, m.userId, m.role, m.avatar]), [
      ["mem_leader", LEADER_ID, "leader", "teal-bot"],
      ["mem_member", MEMBER_ID, "member", null],
    ]);
    assert.equal(projections.filter((p) => p === "avatar").length, 1);

    projections.length = 0;
    res = createResponse();
    await joinSquadHandler({ body: { squadCode: "ABC-123" }, params: {}, user: { userId: MEMBER_ID } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.members.map((m) => m.avatar), ["teal-bot", null]);
    assert.equal(res.body.data.member.memberId, "mem_member");
    assert.equal(projections.filter((p) => p === "avatar").length, 1);

    projections.length = 0;
    res = createResponse();
    await getSquadPreviewHandler({ params: { squadId: squad.squadId }, user: { userId: OTHER_ID } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.members.map((m) => [m.memberId, m.displayName, m.avatar]), [
      ["mem_leader", "Leader", "teal-bot"],
      ["mem_member", "Member", null],
    ]);
    assert.equal(projections.filter((p) => p === "avatar").length, 1);

    projections.length = 0;
    res = createResponse();
    await getJoinRequestsHandler({ squadAccess: { squad } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.requests.map((r) => [r.userId, r.name, r.avatar]), [
      [OTHER_ID, "Requester", "gold-moon"],
    ]);
    assert.deepEqual(projections, ["_id blockedUserIds gender languages country avatar"]);
  } finally {
    User.find = originals.find;
    User.findById = originals.findById;
    Squad.find = originals.squadFind;
    Squad.findOne = originals.squadFindOne;
    Notification.deleteMany = originals.deleteMany;
  }
});

test("approving a join request returns members with avatars", async () => {
  const originals = { find: User.find, findById: User.findById, deleteMany: Notification.deleteMany };
  const squad = {
    squadId: "sq_approve",
    status: "idle",
    members: [{ memberId: "mem_leader", userId: LEADER_ID, role: "leader", displayName: "Leader" }],
    joinRequests: [{ userId: OTHER_ID, name: "Requester" }],
    async save() {},
  };
  const { find } = mockUserFind(USERS);
  User.find = find;
  User.findById = async (userId) => USERS.find((user) => user._id === String(userId));
  Notification.deleteMany = async () => ({ deletedCount: 0 });

  try {
    const res = createResponse();
    await approveJoinRequestHandler({
      params: { userId: OTHER_ID },
      user: { userId: LEADER_ID },
      squadAccess: { squad },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.members.map((m) => [m.userId, m.avatar]), [
      [LEADER_ID, "teal-bot"],
      [OTHER_ID, "gold-moon"],
    ]);
    assert.equal("avatar" in res.body.data.member, false);
    assert.equal(squad.members.every((member) => !("avatar" in member)), true);
  } finally {
    User.find = originals.find;
    User.findById = originals.findById;
    Notification.deleteMany = originals.deleteMany;
  }
});

test("member avatar lookups fail soft to null", async () => {
  const originals = { find: User.find, findById: User.findById, squadFindOne: Squad.findOne };
  const squad = buildSquad();
  User.find = mockUserFind(USERS, { failAvatarLookup: true }).find;
  User.findById = async () => ({ isPremium: false });
  Squad.findOne = async () => squad;
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const res = createResponse();
    await getSquadPreviewHandler({ params: { squadId: squad.squadId }, user: { userId: OTHER_ID } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data.members.map((m) => m.avatar), [null, null]);
  } finally {
    console.warn = originalWarn;
    User.find = originals.find;
    User.findById = originals.findById;
    Squad.findOne = originals.squadFindOne;
  }
});

test("encounter detail rosters include member avatars", async () => {
  const controllerPath = require.resolve("../src/controllers/matchmakingController");
  const servicePath = require.resolve("../src/services/matchmakingService");
  const originalServiceModule = require.cache[servicePath];
  const originals = { find: User.find, squadFindOne: Squad.findOne };
  const encounter = {
    encounterId: "enc_avatar",
    squadAId: "squad_a",
    squadBId: "squad_b",
    status: "active",
    ackBySquad: new Map(),
  };
  const squadA = { squadId: "squad_a", squadName: "A", members: [{ memberId: "a1", userId: LEADER_ID, displayName: "Leader", role: "leader" }] };
  const squadB = { squadId: "squad_b", squadName: "B", members: [{ memberId: "b1", userId: OTHER_ID, displayName: "Other", role: "leader" }] };
  const { find, projections } = mockUserFind(USERS);
  User.find = find;
  Squad.findOne = async ({ squadId }) => (squadId === "squad_a" ? squadA : squadB);
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      getEncounterById: async () => encounter,
      getEncounterRosterContext: async () => ({ allowed: true, squadA, squadB }),
    },
  };
  delete require.cache[controllerPath];

  try {
    const { getEncounterHandoffHandler } = require(controllerPath);
    const res = createResponse();
    await getEncounterHandoffHandler({ params: { encounterId: "enc_avatar" }, user: { userId: LEADER_ID } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.squadAMembers[0].avatar, "teal-bot");
    assert.equal(res.body.data.squadBMembers[0].avatar, "gold-moon");
    assert.equal(res.body.data.squadBMembers[0].displayName, "Other");
    assert.equal(projections.filter((p) => p === "avatar").length, 1);
  } finally {
    User.find = originals.find;
    Squad.findOne = originals.squadFindOne;
    if (originalServiceModule) require.cache[servicePath] = originalServiceModule;
    else delete require.cache[servicePath];
    delete require.cache[controllerPath];
  }
});
