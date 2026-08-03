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

async function runFreshRosterMatch(users, { seekerTags = [], candidateTags = [] } = {}) {
  const originals = {
    acquire: redlock.acquire,
    queued: queueService.getQueuedSquadsByRegion,
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
    members: [{ memberId: "member_a", userId: "user_a" }],
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
    members: [{ memberId: "member_b", userId: "user_b" }],
    tags: candidateTags,
    reputationScore: 100,
    async save() {},
  };
  const removed = [];
  let encounters = 0;

  redlock.acquire = async () => ({ release: async () => {} });
  queueService.getQueuedSquadsByRegion = async () => [
    { squadId: seeker.squadId, size: "1", queuedAt: String(Date.now()) },
    { squadId: candidate.squadId, size: "1", queuedAt: String(Date.now()) },
  ];
  queueService.removeFromQueue = async (squadId) => { removed.push(squadId); };
  Squad.findOne = async ({ squadId }) => squadId === seeker.squadId ? seeker : candidate;
  Encounter.create = async (data) => { encounters += 1; return data; };
  socketService.getOnlineUserIds = async (ids) => new Set(ids);
  sessionService.setSessionField = async () => {};
  socketService.emitToSquad = () => {};
  User.find = ({ _id: { $in: ids } }) => ({
    select: async () => users.filter((user) => ids.map(String).includes(String(user._id))),
  });

  try {
    const result = await tryMatchmakeForSquad(seeker);
    return { candidate, encounters, removed, result, seeker };
  } finally {
    redlock.acquire = originals.acquire;
    queueService.getQueuedSquadsByRegion = originals.queued;
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
    { _id: "user_a", ageConfirmed: true, isAdult: true, ageVerified: false },
    { _id: "user_b", ageConfirmed: true, isAdult: true, ageVerified: true },
  ]);

  assert.equal(result, null);
  assert.equal(encounters, 0);
  assert.equal(seeker.status, "idle");
  assert.deepEqual(removed, ["sq_seeker"]);
});

test("matcher purges a stale candidate with a missing roster user", async () => {
  const { candidate, encounters, removed, result, seeker } = await runFreshRosterMatch([
    { _id: "user_a", ageConfirmed: true, isAdult: true, ageVerified: true },
  ]);

  assert.equal(result, null);
  assert.equal(encounters, 0);
  assert.equal(seeker.status, "searching");
  assert.equal(candidate.status, "idle");
  assert.deepEqual(removed, ["sq_candidate"]);
});

test("matcher creates an encounter for two fresh verified-adult rosters", async () => {
  const { encounters, result, seeker, candidate } = await runFreshRosterMatch([
    { _id: "user_a", ageConfirmed: true, isAdult: true, ageVerified: true },
    { _id: "user_b", ageConfirmed: true, isAdult: true, ageVerified: true },
  ]);

  assert.equal(encounters, 1);
  assert.equal(result.squadAId, "sq_seeker");
  assert.equal(seeker.status, "matched");
  assert.equal(candidate.status, "matched");
});

test("matcher purges a legacy queued seeker with blocked tags", async () => {
  const { encounters, removed, result, seeker } = await runFreshRosterMatch([
    { _id: "user_a", ageConfirmed: true, isAdult: true, ageVerified: true },
    { _id: "user_b", ageConfirmed: true, isAdult: true, ageVerified: true },
  ], { seekerTags: ["pedo"] });

  assert.equal(result, null);
  assert.equal(encounters, 0);
  assert.equal(seeker.status, "idle");
  assert.deepEqual(removed, ["sq_seeker"]);
});

test("matcher purges a legacy queued candidate with mature tags", async () => {
  const { candidate, encounters, removed, result } = await runFreshRosterMatch([
    { _id: "user_a", ageConfirmed: true, isAdult: true, ageVerified: true },
    { _id: "user_b", ageConfirmed: true, isAdult: true, ageVerified: true },
  ], { candidateTags: ["nsfw"] });

  assert.equal(result, null);
  assert.equal(encounters, 0);
  assert.equal(candidate.status, "idle");
  assert.deepEqual(removed, ["sq_candidate"]);
});

test("ending an encounter does not requeue ineligible rosters", async () => {
  const originals = {
    acquire: redlock.acquire,
    updateMany: Squad.updateMany,
    find: Squad.find,
    users: User.find,
    add: queueService.addToQueue,
    remove: queueService.removeFromQueue,
    queued: queueService.getQueuedSquadsByRegion,
    session: sessionService.setSessionField,
    emit: socketService.emitToSquad,
    close: socketService.closeEncounterRoom,
  };
  const squads = ["sq_a", "sq_b"].map((squadId, index) => ({
    squadId,
    searchRegion: "global",
    tags: [],
    reputationScore: 100,
    members: [{ memberId: `member_${index}`, userId: `user_${index}` }],
  }));
  const queued = [];
  const updates = [];
  redlock.acquire = async () => ({ release: async () => {} });
  Squad.updateMany = async (filter, update) => { updates.push([filter, update]); };
  Squad.find = async () => squads;
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
    const result = await endEncounterAndRequeue({ encounter, triggeringSquadId: "sq_a" });
    assert.equal(result, null);
    assert.deepEqual(queued, []);
    assert.equal(updates.some(([, update]) => update.$set?.status === "idle"), true);
  } finally {
    redlock.acquire = originals.acquire;
    Squad.updateMany = originals.updateMany;
    Squad.find = originals.find;
    User.find = originals.users;
    queueService.addToQueue = originals.add;
    queueService.removeFromQueue = originals.remove;
    queueService.getQueuedSquadsByRegion = originals.queued;
    sessionService.setSessionField = originals.session;
    socketService.emitToSquad = originals.emit;
    socketService.closeEncounterRoom = originals.close;
  }
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
