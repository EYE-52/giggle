const assert = require("node:assert/strict");
const { after, test } = require("node:test");

const { ackEncounterForSquad, scoreCandidate } = require("../src/services/matchmakingService");
const { redis, subClient } = require("../src/config/redisConfig");

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
