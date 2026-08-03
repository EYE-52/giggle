const assert = require("node:assert/strict");
const { after, test } = require("node:test");

const {
  ackEncounterForSquad,
  hasMinimumOnlineMembers,
  scoreCandidate,
  tryMatchmakeForSquad,
} = require("../src/services/matchmakingService");
const { Squad } = require("../src/models/Squad");
const { Encounter } = require("../src/models/Encounter");
const { redis, subClient } = require("../src/config/redisConfig");
const { redlock } = require("../src/config/redisConfig");
const queueService = require("../src/services/queueService");
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
