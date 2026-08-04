const assert = require("node:assert/strict");
const { after, test } = require("node:test");

const {
  ackEncounterForSquad,
  endEncounterAndRequeue,
  endEncounterAsymmetric,
  hasMinimumOnlineMembers,
  scoreCandidate,
  tryMatchmakeForSquad,
} = require("../src/services/matchmakingService");
const { Squad } = require("../src/models/Squad");
const { Encounter } = require("../src/models/Encounter");
const User = require("../src/models/User");
const { redis, subClient } = require("../src/config/redisConfig");
const { redlock } = require("../src/config/redisConfig");
const queueService = require("../src/services/queueService");
const sessionService = require("../src/services/sessionService");
const socketService = require("../src/services/socketService");

const MATCH_USER_A = "507f1f77bcf86cd799439011";
const MATCH_USER_B = "507f1f77bcf86cd799439012";
const MATCH_USER_C = "507f1f77bcf86cd799439013";

after(async () => {
  await Promise.allSettled([redis.quit(), subClient.quit()]);
});

test("candidate scoring does not give premium squads queue priority", () => {
  const now = new Date("2026-07-10T00:00:30.000Z");
  const seeker = {
    squadId: "sq_seeker",
    size: 2,
    queuedAt: new Date("2026-07-10T00:00:00.000Z"),
    tags: ["chill"],
    reputationScore: 100,
    isPremiumSquad: false,
  };
  const baseCandidate = {
    squadId: "sq_candidate",
    size: "2",
    queuedAt: String(new Date("2026-07-10T00:00:00.000Z").getTime()),
    tags: "chill",
    reputationScore: "100",
  };

  const freeScore = scoreCandidate({
    seeker,
    candidate: { ...baseCandidate, isPremiumSquad: false },
    now,
  });
  const premiumScore = scoreCandidate({
    seeker,
    candidate: { ...baseCandidate, isPremiumSquad: true },
    now,
  });

  assert.equal(premiumScore, freeScore);
});

test("minimum online membership uses the configured threshold", () => {
  const squad = { members: [{ userId: "user_a" }, { userId: "user_b" }] };

  assert.equal(hasMinimumOnlineMembers(squad, new Set(["user_a"]), 2), false);
  assert.equal(hasMinimumOnlineMembers(squad, new Set(["user_a", "user_b"]), 2), true);
});

test("matcher purges an offline seeker before creating an encounter", async () => {
  const originals = {
    acquire: redlock.acquire,
    using: redlock.using,
    queued: queueService.getQueuedSquadsByRegion,
    remove: queueService.removeFromQueue,
    findOne: Squad.findOne,
    create: Encounter.create,
    online: socketService.getOnlineUserIds,
    users: User.find,
  };
  const seeker = {
    squadId: "sq_seeker",
    status: "searching",
    searchRegion: "global",
    searchQueuedAt: new Date(),
    members: [{ userId: "user_a" }],
    tags: [],
    reputationScore: 100,
    async save() {},
  };
  const candidate = {
    squadId: "sq_candidate",
    status: "searching",
    members: [{ userId: "user_b" }],
    async save() {},
  };
  const removed = [];
  let encounters = 0;

  redlock.acquire = async () => ({ release: async () => {} });
  queueService.getQueuedSquadsByRegion = async () => [
    { squadId: "sq_seeker", size: "1", queuedAt: String(Date.now()) },
    { squadId: "sq_candidate", size: "1", queuedAt: String(Date.now()) },
  ];
  queueService.removeFromQueue = async (squadId) => { removed.push(squadId); };
  Squad.findOne = async ({ squadId }) => squadId === seeker.squadId ? seeker : candidate;
  Encounter.create = async () => { encounters += 1; return {}; };
  socketService.getOnlineUserIds = async (userIds) => userIds.includes("user_a")
    ? new Set()
    : new Set(["user_b"]);
  User.find = ({ _id: { $in: ids } }) => ({
    select: async () => ids.map((_id) => ({
      _id,
      ageConfirmed: true,
      isAdult: true,
      ageVerified: true,
    })),
  });

  try {
    const result = await tryMatchmakeForSquad(seeker);

    assert.equal(result, null);
    assert.equal(encounters, 0);
    assert.equal(seeker.status, "idle");
    assert.deepEqual(removed, ["sq_seeker"]);
  } finally {
    redlock.acquire = originals.acquire;
    queueService.getQueuedSquadsByRegion = originals.queued;
    queueService.removeFromQueue = originals.remove;
    Squad.findOne = originals.findOne;
    Encounter.create = originals.create;
    socketService.getOnlineUserIds = originals.online;
    User.find = originals.users;
  }
});

async function runFreshRosterMatch(
  users,
  {
    seekerTags = [],
    candidateTags = [],
    queuedSquads,
    refreshedSeekerMembers,
    seekerMembers = [{ memberId: "member_a", userId: MATCH_USER_A }],
    candidateMembers = [{ memberId: "member_b", userId: MATCH_USER_B }],
  } = {}
) {
  const originals = {
    acquire: redlock.acquire,
    queued: queueService.getQueuedSquadsByRegion,
    allQueued: queueService.getAllQueuedSquads,
    remove: queueService.removeFromQueue,
    findOne: Squad.findOne,
    create: Encounter.create,
    online: socketService.getOnlineUserIds,
    session: sessionService.setSessionField,
    emit: socketService.emitToSquad,
    users: User.find,
  };
  const seeker = {
    squadId: "sq_seeker",
    squadName: "Seekers",
    status: "searching",
    searchRegion: "global",
    searchQueuedAt: new Date(),
    members: seekerMembers,
    tags: seekerTags,
    reputationScore: 100,
    async save() {},
  };
  const candidate = {
    squadId: "sq_candidate",
    squadName: "Candidates",
    status: "searching",
    searchRegion: "global",
    searchQueuedAt: new Date(),
    members: candidateMembers,
    tags: candidateTags,
    reputationScore: 100,
    async save() {},
  };
  const removed = [];
  let encounters = 0;
  let seekerReads = 0;
  let blockReads = 0;

  redlock.acquire = async () => ({ release: async () => {} });
  const defaultQueue = [
    { squadId: seeker.squadId, size: "1", queuedAt: String(Date.now()) },
    { squadId: candidate.squadId, size: "1", queuedAt: String(Date.now()) },
  ];
  queueService.getQueuedSquadsByRegion = async () => queuedSquads ?? defaultQueue;
  queueService.getAllQueuedSquads = async () => queuedSquads ?? defaultQueue;
  queueService.removeFromQueue = async (squadId) => { removed.push(squadId); };
  Squad.findOne = async ({ squadId }) => {
    if (squadId !== seeker.squadId) return candidate;
    seekerReads += 1;
    if (seekerReads > 1 && refreshedSeekerMembers) seeker.members = refreshedSeekerMembers;
    return seeker;
  };
  Encounter.create = async (data) => { encounters += 1; return data; };
  socketService.getOnlineUserIds = async (ids) => new Set(ids);
  sessionService.setSessionField = async () => {};
  socketService.emitToSquad = () => {};
  User.find = ({ _id: { $in: ids } }) => {
    const matching = users.filter((user) => ids.map(String).includes(String(user._id)));
    return {
      select: async () => matching,
      lean: async () => { blockReads += 1; return matching; },
    };
  };

  try {
    const result = await tryMatchmakeForSquad(seeker);
    return { blockReads, candidate, encounters, removed, result, seeker };
  } finally {
    redlock.acquire = originals.acquire;
    queueService.getQueuedSquadsByRegion = originals.queued;
    queueService.getAllQueuedSquads = originals.allQueued;
    queueService.removeFromQueue = originals.remove;
    Squad.findOne = originals.findOne;
    Encounter.create = originals.create;
    socketService.getOnlineUserIds = originals.online;
    sessionService.setSessionField = originals.session;
    socketService.emitToSquad = originals.emit;
    User.find = originals.users;
  }
}

test("matcher purges a stale self-attested seeker before creating an encounter", async () => {
  const { encounters, removed, result, seeker } = await runFreshRosterMatch([
    { _id: MATCH_USER_A, ageConfirmed: true, isAdult: true, ageVerified: false },
    { _id: MATCH_USER_B, ageConfirmed: true, isAdult: true, ageVerified: true },
  ]);

  assert.equal(result, null);
  assert.equal(encounters, 0);
  assert.equal(seeker.status, "idle");
  assert.deepEqual(removed, ["sq_seeker"]);
});

test("matcher purges a stale candidate with a missing roster user", async () => {
  const { candidate, encounters, removed, result, seeker } = await runFreshRosterMatch([
    { _id: MATCH_USER_A, ageConfirmed: true, isAdult: true, ageVerified: true },
  ]);

  assert.equal(result, null);
  assert.equal(encounters, 0);
  assert.equal(seeker.status, "searching");
  assert.equal(candidate.status, "idle");
  assert.deepEqual(removed, ["sq_candidate"]);
});

test("matcher creates an encounter for two fresh verified-adult rosters", async () => {
  const { encounters, result, seeker, candidate } = await runFreshRosterMatch([
    { _id: MATCH_USER_A, ageConfirmed: true, isAdult: true, ageVerified: true },
    { _id: MATCH_USER_B, ageConfirmed: true, isAdult: true, ageVerified: true },
  ]);

  assert.equal(encounters, 1);
  assert.equal(result.squadAId, "sq_seeker");
  assert.equal(seeker.status, "matched");
  assert.equal(candidate.status, "matched");
});

test("matcher purges a legacy queued seeker with blocked tags", async () => {
  const { encounters, removed, result, seeker } = await runFreshRosterMatch([
    { _id: MATCH_USER_A, ageConfirmed: true, isAdult: true, ageVerified: true },
    { _id: MATCH_USER_B, ageConfirmed: true, isAdult: true, ageVerified: true },
  ], { seekerTags: ["pedo"] });

  assert.equal(result, null);
  assert.equal(encounters, 0);
  assert.equal(seeker.status, "idle");
  assert.deepEqual(removed, ["sq_seeker"]);
});

test("matcher purges a legacy queued candidate with mature tags", async () => {
  const { candidate, encounters, removed, result } = await runFreshRosterMatch([
    { _id: MATCH_USER_A, ageConfirmed: true, isAdult: true, ageVerified: true },
    { _id: MATCH_USER_B, ageConfirmed: true, isAdult: true, ageVerified: true },
  ], { candidateTags: ["nsfw"] });

  assert.equal(result, null);
  assert.equal(encounters, 0);
  assert.equal(candidate.status, "idle");
  assert.deepEqual(removed, ["sq_candidate"]);
});

test("matcher purges an ineligible seeker even when no candidate is queued", async () => {
  const { encounters, removed, result, seeker } = await runFreshRosterMatch([
    { _id: MATCH_USER_A, ageConfirmed: true, isAdult: true, ageVerified: false },
  ], { queuedSquads: [] });

  assert.equal(result, null);
  assert.equal(encounters, 0);
  assert.equal(seeker.status, "idle");
  assert.deepEqual(removed, ["sq_seeker"]);
});

test("matcher purges a mature-tag seeker even when no candidate is queued", async () => {
  const { encounters, removed, result, seeker } = await runFreshRosterMatch([
    { _id: MATCH_USER_A, ageConfirmed: true, isAdult: true, ageVerified: true },
  ], { seekerTags: ["nsfw"], queuedSquads: [] });

  assert.equal(result, null);
  assert.equal(encounters, 0);
  assert.equal(seeker.status, "idle");
  assert.deepEqual(removed, ["sq_seeker"]);
});

test("matcher rechecks a seeker roster before creating an encounter", async () => {
  const { encounters, removed, result, seeker } = await runFreshRosterMatch([
    { _id: MATCH_USER_A, ageConfirmed: true, isAdult: true, ageVerified: true },
    { _id: MATCH_USER_B, ageConfirmed: true, isAdult: true, ageVerified: true },
  ], { refreshedSeekerMembers: [{ memberId: "member_stale", userId: "missing_user" }] });

  assert.equal(result, null);
  assert.equal(encounters, 0);
  assert.equal(seeker.status, "idle");
  assert.deepEqual(removed, ["sq_seeker"]);
});

test("matcher skips only the blocked cross-squad pairing and keeps both healthy squads searchable", async () => {
  const { blockReads, candidate, encounters, removed, result, seeker } = await runFreshRosterMatch([
    { _id: MATCH_USER_A, ageConfirmed: true, isAdult: true, ageVerified: true, blockedUserIds: [MATCH_USER_B] },
    { _id: MATCH_USER_B, ageConfirmed: true, isAdult: true, ageVerified: true, blockedUserIds: [] },
  ]);

  assert.equal(result, null);
  assert.equal(encounters, 0);
  // The block applies to this pairing, not either internally valid squad. Both
  // remain queued so they can still match compatible candidates.
  assert.equal(seeker.status, "searching");
  assert.equal(candidate.status, "searching");
  assert.deepEqual(removed, []);
  assert.equal(blockReads, 2, "one seeker snapshot and one combined candidate snapshot");
});

test("matcher purges a candidate whose fresh roster contains a blocked pair", async () => {
  const { candidate, encounters, removed, result } = await runFreshRosterMatch([
    { _id: MATCH_USER_A, ageConfirmed: true, isAdult: true, ageVerified: true, blockedUserIds: [] },
    { _id: MATCH_USER_B, ageConfirmed: true, isAdult: true, ageVerified: true, blockedUserIds: [MATCH_USER_C] },
    { _id: MATCH_USER_C, ageConfirmed: true, isAdult: true, ageVerified: true, blockedUserIds: [] },
  ], {
    candidateMembers: [
      { memberId: "member_b", userId: MATCH_USER_B },
      { memberId: "member_c", userId: MATCH_USER_C },
    ],
  });

  assert.equal(result, null);
  assert.equal(encounters, 0);
  assert.equal(candidate.status, "idle");
  assert.deepEqual(removed, ["sq_candidate"]);
});

async function runEncounterRequeue(users) {
  const originals = {
    acquire: redlock.acquire,
    updateMany: Squad.updateMany,
    find: Squad.find,
    findOne: Squad.findOne,
    users: User.find,
    add: queueService.addToQueue,
    remove: queueService.removeFromQueue,
    queued: queueService.getQueuedSquadsByRegion,
    allQueued: queueService.getAllQueuedSquads,
    session: sessionService.setSessionField,
    emit: socketService.emitToSquad,
    close: socketService.closeEncounterRoom,
  };
  const squads = ["sq_a", "sq_b"].map((squadId, index) => ({
    squadId,
    searchRegion: "global",
    tags: [],
    reputationScore: 100,
    members: [{ memberId: `member_${index}`, userId: index === 0 ? MATCH_USER_A : MATCH_USER_B }],
  }));
  const queued = [];
  const updates = [];
  redlock.acquire = async () => ({ release: async () => {} });
  Squad.updateMany = async (filter, update) => { updates.push([filter, update]); };
  Squad.find = async () => squads;
  Squad.findOne = async ({ squadId }) => squads.find((squad) => squad.squadId === squadId) || null;
  User.find = ({ _id: { $in: ids } }) => {
    const matching = users.filter((user) => ids.map(String).includes(String(user._id)));
    return { select: async () => matching, lean: async () => matching };
  };
  queueService.addToQueue = async (squadId) => { queued.push(squadId); };
  queueService.removeFromQueue = async () => {};
  queueService.getQueuedSquadsByRegion = async () => [];
  queueService.getAllQueuedSquads = async () => [];
  sessionService.setSessionField = async () => {};
  socketService.emitToSquad = () => {};
  socketService.closeEncounterRoom = () => {};
  const encounter = {
    encounterId: "enc_1",
    squadAId: "sq_a",
    squadBId: "sq_b",
    async save() {},
  };

  try {
    const result = await endEncounterAndRequeue({ encounter, triggeringSquadId: "sq_a" });
    return { queued, result, updates };
  } finally {
    redlock.acquire = originals.acquire;
    Squad.updateMany = originals.updateMany;
    Squad.find = originals.find;
    Squad.findOne = originals.findOne;
    User.find = originals.users;
    queueService.addToQueue = originals.add;
    queueService.removeFromQueue = originals.remove;
    queueService.getQueuedSquadsByRegion = originals.queued;
    queueService.getAllQueuedSquads = originals.allQueued;
    sessionService.setSessionField = originals.session;
    socketService.emitToSquad = originals.emit;
    socketService.closeEncounterRoom = originals.close;
  }
}

test("ending an encounter does not requeue ineligible rosters", async () => {
  const { queued, result, updates } = await runEncounterRequeue([]);

  assert.equal(result, null);
  assert.deepEqual(queued, []);
  assert.equal(updates.some(([, update]) => update.$set?.status === "idle"), true);
});

test("ending an encounter requeues verified-adult rosters", async () => {
  const { queued, result } = await runEncounterRequeue([
    { _id: MATCH_USER_A, ageConfirmed: true, isAdult: true, ageVerified: true, blockedUserIds: [] },
    { _id: MATCH_USER_B, ageConfirmed: true, isAdult: true, ageVerified: true, blockedUserIds: [] },
  ]);

  assert.equal(result.squadId, "sq_a");
  assert.deepEqual(queued, ["sq_a", "sq_b"]);
});

test("asymmetric encounter end leaves an ineligible remaining roster idle", async () => {
  const originals = {
    acquire: redlock.acquire,
    updateOne: Squad.updateOne,
    updateMany: Squad.updateMany,
    findOne: Squad.findOne,
    users: User.find,
    add: queueService.addToQueue,
    remove: queueService.removeFromQueue,
    queued: queueService.getQueuedSquadsByRegion,
    session: sessionService.setSessionField,
    emit: socketService.emitToSquad,
    close: socketService.closeEncounterRoom,
  };
  const other = {
    squadId: "sq_b",
    searchRegion: "global",
    tags: [],
    reputationScore: 100,
    members: [{ memberId: "member_b", userId: "missing_user" }],
  };
  const disconnecting = {
    squadId: "sq_a",
    members: [{ memberId: "member_a", userId: "user_a" }],
  };
  const queued = [];
  const updates = [];
  redlock.acquire = async () => ({ release: async () => {} });
  Squad.updateOne = async (filter, update) => { updates.push([filter, update]); };
  Squad.updateMany = async (filter, update) => { updates.push([filter, update]); };
  Squad.findOne = async ({ squadId }) => squadId === other.squadId ? other : disconnecting;
  User.find = () => ({ select: async () => [] });
  queueService.addToQueue = async (squadId) => { queued.push(squadId); };
  queueService.removeFromQueue = async () => {};
  queueService.getQueuedSquadsByRegion = async () => [];
  sessionService.setSessionField = async () => {};
  socketService.emitToSquad = () => {};
  socketService.closeEncounterRoom = () => {};
  const encounter = {
    encounterId: "enc_1",
    squadAId: "sq_a",
    squadBId: "sq_b",
    async save() {},
  };

  try {
    await endEncounterAsymmetric({ encounter, disconnectingSquadId: "sq_a" });
    assert.deepEqual(queued, []);
    assert.equal(updates.some(([, update]) => update.$set?.status === "idle"), true);
  } finally {
    redlock.acquire = originals.acquire;
    Squad.updateOne = originals.updateOne;
    Squad.updateMany = originals.updateMany;
    Squad.findOne = originals.findOne;
    User.find = originals.users;
    queueService.addToQueue = originals.add;
    queueService.removeFromQueue = originals.remove;
    queueService.getQueuedSquadsByRegion = originals.queued;
    sessionService.setSessionField = originals.session;
    socketService.emitToSquad = originals.emit;
    socketService.closeEncounterRoom = originals.close;
  }
});

test("asymmetric encounter end immediately rematches with the opponent's searching state", async () => {
  const originals = {
    acquire: redlock.acquire,
    using: redlock.using,
    updateOne: Squad.updateOne,
    updateMany: Squad.updateMany,
    findOne: Squad.findOne,
    users: User.find,
    add: queueService.addToQueue,
    remove: queueService.removeFromQueue,
    queued: queueService.getQueuedSquadsByRegion,
    allQueued: queueService.getAllQueuedSquads,
    session: sessionService.setSessionField,
    emit: socketService.emitToSquad,
    close: socketService.closeEncounterRoom,
  };
  const other = {
    squadId: "sq_b",
    status: "in_encounter",
    currentEncounterId: "enc_rematch",
    searchRegion: "global",
    tags: [],
    reputationScore: 100,
    members: [{ memberId: "member_b", userId: MATCH_USER_B }],
  };
  const disconnecting = {
    squadId: "sq_a",
    status: "in_encounter",
    currentEncounterId: "enc_rematch",
    members: [{ memberId: "member_a", userId: MATCH_USER_A }],
  };
  const safeUsers = [MATCH_USER_A, MATCH_USER_B].map((_id) => ({
    _id,
    ageConfirmed: true,
    isAdult: true,
    ageVerified: true,
    blockedUserIds: [],
  }));
  const queued = [];
  const sessionWrites = [];
  let lockUses = 0;
  redlock.acquire = async () => ({ release: async () => {} });
  redlock.using = async (_resources, _duration, routine) => {
    lockUses += 1;
    return routine({ aborted: false });
  };
  Squad.updateOne = async (filter, update) => {
    const target = filter.squadId === other.squadId ? other : disconnecting;
    if (filter.currentEncounterId && target.currentEncounterId !== filter.currentEncounterId) {
      return { matchedCount: 0 };
    }
    Object.assign(target, update.$set);
    return { matchedCount: 1 };
  };
  Squad.updateMany = async () => {};
  Squad.findOne = async ({ squadId }) => squadId === other.squadId ? other : disconnecting;
  User.find = ({ _id: { $in: ids } }) => {
    const users = safeUsers.filter((user) => ids.map(String).includes(String(user._id)));
    return { select: async () => users, lean: async () => users };
  };
  queueService.addToQueue = async (squadId) => { queued.push(squadId); };
  queueService.removeFromQueue = async () => {};
  queueService.getQueuedSquadsByRegion = async () => [];
  queueService.getAllQueuedSquads = async () => [];
  sessionService.setSessionField = async (squadId, memberId, field, value) => {
    sessionWrites.push([squadId, memberId, field, value]);
  };
  socketService.emitToSquad = () => {};
  socketService.closeEncounterRoom = () => {};
  const encounter = {
    encounterId: "enc_rematch",
    squadAId: "sq_a",
    squadBId: "sq_b",
    async save() {},
  };

  try {
    await endEncounterAsymmetric({ encounter, disconnectingSquadId: "sq_a" });
    assert.deepEqual(queued, ["sq_b"]);
    assert.equal(other.status, "searching");
    assert.equal(lockUses, 1);
    assert.deepEqual(new Set(sessionWrites.map(([squadId]) => squadId)), new Set(["sq_a", "sq_b"]));
  } finally {
    redlock.acquire = originals.acquire;
    redlock.using = originals.using;
    Squad.updateOne = originals.updateOne;
    Squad.updateMany = originals.updateMany;
    Squad.findOne = originals.findOne;
    User.find = originals.users;
    queueService.addToQueue = originals.add;
    queueService.removeFromQueue = originals.remove;
    queueService.getQueuedSquadsByRegion = originals.queued;
    queueService.getAllQueuedSquads = originals.allQueued;
    sessionService.setSessionField = originals.session;
    socketService.emitToSquad = originals.emit;
    socketService.closeEncounterRoom = originals.close;
  }
});

test("asymmetric encounter teardown stays retryable after its first guarded squad write fails", async () => {
  const originals = {
    updateOne: Squad.updateOne,
    findOne: Squad.findOne,
    users: User.find,
    remove: queueService.removeFromQueue,
    session: sessionService.setSessionField,
    emit: socketService.emitToSquad,
    close: socketService.closeEncounterRoom,
    add: queueService.addToQueue,
  };
  const writes = [];
  let queued = false;
  let failFirstWrite = true;
  let saves = 0;
  let closes = 0;
  const other = {
    squadId: "sq_b",
    status: "in_encounter",
    currentEncounterId: "enc_partial",
    tags: [],
    members: [{ memberId: "member_b", userId: "missing_user" }],
  };
  const disconnecting = {
    squadId: "sq_a",
    status: "in_encounter",
    currentEncounterId: "enc_partial",
    members: [{ memberId: "member_a", userId: MATCH_USER_A }],
  };
  Squad.updateOne = async (filter, update) => {
    writes.push([filter, update]);
    if (failFirstWrite) {
      failFirstWrite = false;
      throw new Error("first guarded write failed");
    }
    const squad = filter.squadId === other.squadId ? other : disconnecting;
    if (!filter.currentEncounterId || squad.currentEncounterId === filter.currentEncounterId) {
      Object.assign(squad, update.$set);
      return { matchedCount: 1 };
    }
    return { matchedCount: 0 };
  };
  Squad.findOne = async ({ squadId }) => squadId === other.squadId ? other : disconnecting;
  User.find = () => ({ select: async () => [] });
  queueService.removeFromQueue = async () => {};
  sessionService.setSessionField = async () => {};
  socketService.emitToSquad = () => {};
  socketService.closeEncounterRoom = () => { closes += 1; };
  queueService.addToQueue = async () => { queued = true; };
  const encounter = {
    encounterId: "enc_partial",
    status: "active",
    squadAId: "sq_a",
    squadBId: "sq_b",
    async save() { saves += 1; },
  };

  try {
    await assert.rejects(
      () => endEncounterAsymmetric({ encounter, disconnectingSquadId: "sq_a" }),
      /first guarded write failed/
    );
    assert.equal(encounter.status, "active");
    assert.equal(saves, 0);
    assert.equal(closes, 0);

    await endEncounterAsymmetric({ encounter, disconnectingSquadId: "sq_a" });
    assert.equal(encounter.status, "ended");
    assert.equal(saves, 1);
    assert.equal(closes, 1);
    assert.equal(other.status, "idle");
    assert.equal(disconnecting.status, "idle");
    assert.equal(
      writes.slice(1, 3).every(([filter]) => filter.currentEncounterId === encounter.encounterId),
      true
    );
    assert.equal(queued, false);
  } finally {
    Squad.updateOne = originals.updateOne;
    Squad.findOne = originals.findOne;
    User.find = originals.users;
    queueService.removeFromQueue = originals.remove;
    sessionService.setSessionField = originals.session;
    socketService.emitToSquad = originals.emit;
    socketService.closeEncounterRoom = originals.close;
    queueService.addToQueue = originals.add;
  }
});

test("late acknowledgements cannot expire an already-active encounter", async () => {
  let saves = 0;
  const encounter = {
    encounterId: "enc_active",
    status: "active",
    squadAId: "sq_a",
    squadBId: "sq_b",
    expiresAt: new Date(Date.now() - 60_000),
    ackBySquad: new Map([["sq_a", true], ["sq_b", true]]),
    async save() { saves += 1; },
  };

  const result = await ackEncounterForSquad({ encounter, squadId: "sq_a" });

  assert.equal(result.error, undefined);
  assert.equal(result.acknowledged, true);
  assert.equal(result.allAcked, true);
  assert.equal(encounter.status, "active");
  assert.equal(saves, 0);
});
