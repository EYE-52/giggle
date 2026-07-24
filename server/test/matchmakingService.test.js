const assert = require("node:assert/strict");
const { after, test } = require("node:test");

const { scoreCandidate } = require("../src/services/matchmakingService");
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
