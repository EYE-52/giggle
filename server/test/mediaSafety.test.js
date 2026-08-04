const assert = require("node:assert/strict");
const { after, test } = require("node:test");

const User = require("../src/models/User");
const { Squad } = require("../src/models/Squad");
const { Encounter } = require("../src/models/Encounter");
const { getLobbyTokenHandler } = require("../src/controllers/agoraController");
const { issueEncounterTokenHandler } = require("../src/controllers/encounterController");

const USER_A = "507f1f77bcf86cd799439011";
const USER_B = "507f1f77bcf86cd799439012";

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const blockedUsers = () => ({
  lean: async () => [
    { _id: USER_A, blockedUserIds: [USER_B] },
    { _id: USER_B, blockedUserIds: [] },
  ],
});

after(async () => {
  const { redis, subClient } = require("../src/config/redisConfig");
  await Promise.allSettled([redis.quit(), subClient.quit()]);
});

test("lobby token issuance fails closed for a blocked squad roster", async () => {
  const originalFind = User.find;
  User.find = blockedUsers;
  const squad = {
    squadId: "sq_a",
    members: [
      { memberId: "mem_a", userId: USER_A },
      { memberId: "mem_b", userId: USER_B },
    ],
  };

  try {
    const res = response();
    await getLobbyTokenHandler({ squadAccess: { squad, member: squad.members[0] } }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "INTERACTION_BLOCKED");
  } finally {
    User.find = originalFind;
  }
});

test("encounter token issuance fails closed for a blocked cross-squad roster", async () => {
  const originals = {
    squadFindOne: Squad.findOne,
    encounterFindOne: Encounter.findOne,
    userFind: User.find,
  };
  const squadA = {
    squadId: "sq_a",
    currentEncounterId: "enc_1",
    members: [{ memberId: "mem_a", userId: USER_A }],
  };
  const squadB = {
    squadId: "sq_b",
    currentEncounterId: "enc_1",
    members: [{ memberId: "mem_b", userId: USER_B }],
  };
  Squad.findOne = async ({ squadId }) => squadId === "sq_a" ? squadA : squadB;
  Encounter.findOne = async () => ({
    encounterId: "enc_1",
    squadAId: "sq_a",
    squadBId: "sq_b",
    status: "active",
  });
  User.find = blockedUsers;

  try {
    const res = response();
    await issueEncounterTokenHandler({
      body: { squadId: "sq_a", encounterId: "enc_1" },
      user: { userId: USER_A },
    }, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "INTERACTION_BLOCKED");
  } finally {
    Squad.findOne = originals.squadFindOne;
    Encounter.findOne = originals.encounterFindOne;
    User.find = originals.userFind;
  }
});
