const assert = require("node:assert/strict");
const test = require("node:test");

const User = require("../src/models/User");
const { Squad } = require("../src/models/Squad");
const { redis, subClient } = require("../src/config/redisConfig");
const {
  opaqueEncounterId,
  encounterRtcUid,
  fallbackEncounterAlias,
} = require("../src/services/encounterIdentityService");
const { emitRealtimeProjection } = require("../src/services/socketService");
require("../src/config/agoraConfig");

test.after(async () => {
  await Promise.allSettled([redis.quit(), subClient.quit()]);
});

const ALICE = "507f1f77bcf86cd799439011";
const AMY = "507f1f77bcf86cd799439033";
const BRUNO = "507f1f77bcf86cd799439022";
const BEN = "507f1f77bcf86cd799439044";
const ENC = "enc_1728000000000_abc123def4";

const USERS = [
  { _id: ALICE, avatar: "violet-blob" },
  { _id: AMY, avatar: "coral-star", anonymousInEncounters: true, encounterAlias: "" },
  { _id: BRUNO, avatar: "teal-bot", anonymousInEncounters: true, encounterAlias: "Quiet Fox" },
  { _id: BEN, avatar: "gold-moon" },
];

const encounter = { encounterId: ENC, squadAId: "sq-A", squadBId: "sq-B", status: "active", ackBySquad: new Map() };
const squadA = {
  squadId: "sq-A",
  squadName: "Night Owls",
  members: [
    { memberId: "m-a1", userId: ALICE, displayName: "Ann Real", role: "leader" },
    { memberId: "m-a2", userId: AMY, displayName: "Amy Real", role: "member" },
  ],
};
const squadB = {
  squadId: "sq-B",
  squadName: "Day Larks",
  members: [
    { memberId: "m-b1", userId: BRUNO, displayName: "Bruno Real", role: "leader" },
    { memberId: "m-b2", userId: BEN, displayName: "Ben", role: "member" },
  ],
};

function userFind(users = USERS) {
  return (query) => {
    const ids = (query?._id?.$in || []).map(String);
    const rows = users.filter((user) => ids.includes(String(user._id)));
    return { lean: async () => rows };
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

async function getHandoff(viewerId, { users } = {}) {
  const controllerPath = require.resolve("../src/controllers/matchmakingController");
  const servicePath = require.resolve("../src/services/matchmakingService");
  const originalServiceModule = require.cache[servicePath];
  const originals = { find: User.find, squadFindOne: Squad.findOne };
  User.find = userFind(users);
  Squad.findOne = async ({ squadId }) => (squadId === "sq-A" ? squadA : squadB);
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
  const originalError = console.error;
  console.error = () => {};
  try {
    const { getEncounterHandoffHandler } = require(controllerPath);
    const res = createResponse();
    await getEncounterHandoffHandler({ params: { encounterId: ENC }, user: { userId: viewerId } }, res);
    return res;
  } finally {
    console.error = originalError;
    User.find = originals.find;
    Squad.findOne = originals.squadFindOne;
    if (originalServiceModule) require.cache[servicePath] = originalServiceModule;
    else delete require.cache[servicePath];
    delete require.cache[controllerPath];
  }
}

test("encounter payload hides an anonymous opponent's real identity", async () => {
  const res = await getHandoff(ALICE);
  assert.equal(res.statusCode, 200);
  const [bruno, ben] = res.body.data.squadBMembers;
  const brunoId = opaqueEncounterId(ENC, BRUNO);
  assert.deepEqual(bruno, {
    memberId: brunoId,
    userId: brunoId,
    displayName: "Quiet Fox",
    role: "leader",
    avatar: null,
    callId: brunoId,
    uid: encounterRtcUid(ENC, BRUNO),
    anonymous: true,
  });
  // A non-anonymous opponent looks as before.
  assert.equal(ben.userId, BEN);
  assert.equal(ben.displayName, "Ben");
  assert.equal(ben.avatar, "gold-moon");

  const opponentJson = JSON.stringify(res.body.data.squadBMembers);
  for (const secret of [BRUNO, "Bruno Real", "teal-bot", "m-b1"]) {
    assert.ok(!opponentJson.includes(secret), `leaked ${secret}`);
  }
});

test("encounter payload shows the own squad's real identities and the viewer's alias", async () => {
  const res = await getHandoff(AMY);
  assert.equal(res.statusCode, 200);
  const [ann, amy] = res.body.data.squadAMembers;
  assert.equal(ann.userId, ALICE);
  assert.equal(ann.displayName, "Ann Real");
  assert.equal(amy.userId, AMY);
  assert.equal(amy.displayName, "Amy Real");
  assert.equal(amy.avatar, "coral-star");
  assert.equal(amy.anonymous, true);
  assert.equal(amy.alias, fallbackEncounterAlias(AMY), "empty alias falls back to Guest NNNN");

  // From the other side, Amy is only her fallback alias.
  const fromB = await getHandoff(BEN);
  const amyFromB = fromB.body.data.squadAMembers[1];
  assert.equal(amyFromB.displayName, fallbackEncounterAlias(AMY));
  assert.ok(!JSON.stringify(fromB.body.data.squadAMembers).includes(AMY));
  assert.ok(!JSON.stringify(fromB.body.data.squadAMembers).includes("Amy Real"));
  // Bruno sees his own squad for real.
  assert.equal(fromB.body.data.squadBMembers[0].displayName, "Bruno Real");
});

test("encounter payload fails closed when the identity lookup fails", async () => {
  const res = await getHandoff(ALICE, { users: null });
  assert.equal(res.statusCode, 500);
  assert.ok(!JSON.stringify(res.body).includes(BRUNO));
});

test("encounter RTC tokens use the same keyed uid as the payload", () => {
  const configPath = require.resolve("../src/config/agoraConfig");
  const tokenServicePath = require.resolve("../src/services/agoraTokenService");
  const originalConfig = require.cache[configPath];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { ...originalConfig.exports, AGORA_APP_ID: "a".repeat(32), AGORA_APP_CERTIFICATE: "b".repeat(32) },
  };
  delete require.cache[tokenServicePath];
  try {
    const { createEncounterRtcToken } = require(tokenServicePath);
    assert.equal(createEncounterRtcToken({ encounterId: ENC, userId: BRUNO }).uid, encounterRtcUid(ENC, BRUNO));
  } finally {
    require.cache[configPath] = originalConfig;
    delete require.cache[tokenServicePath];
  }
});

function fakeServer() {
  const emits = [];
  return {
    emits,
    to(room) {
      return { emit: (event, payload) => emits.push({ room, event, payload }) };
    },
  };
}

const authorization = {
  allowed: true,
  room: `encounter_${ENC}`,
  encounter,
  squadA,
  squadB,
};

test("encounter chat reaches the other squad only under the sender's alias", async () => {
  const server = fakeServer();
  const message = {
    id: "1-abc",
    text: "hi",
    senderName: "Bruno Real",
    senderId: BRUNO,
    encounterId: ENC,
    squadId: "sq-B",
    ts: 1,
  };
  await emitRealtimeProjection({
    authorization, senderUserId: BRUNO, event: "new_message", payload: message, server, UserModel: { find: userFind() },
  });
  assert.equal(server.emits.length, 2);
  const toA = server.emits.find((e) => e.room === `encounter_${ENC}:squad_sq-A`);
  const toB = server.emits.find((e) => e.room === `encounter_${ENC}:squad_sq-B`);
  assert.equal(toB.payload, message, "own squad sees the message as sent");
  assert.equal(toA.payload.senderName, "Quiet Fox");
  assert.equal(toA.payload.senderId, opaqueEncounterId(ENC, BRUNO));
  assert.equal(toA.payload.text, "hi");
  assert.ok(!JSON.stringify(toA.payload).includes(BRUNO));
  assert.ok(!JSON.stringify(toA.payload).includes("Bruno Real"));
  assert.ok(!server.emits.some((e) => e.room === `encounter_${ENC}`), "never broadcast to the shared room");
});

test("encounter reactions are projected the same way; non-anonymous senders keep their id", async () => {
  const server = fakeServer();
  await emitRealtimeProjection({
    authorization,
    senderUserId: BEN,
    event: "new_reaction",
    payload: { id: "r1", emoji: "🔥", senderId: BEN, senderName: "ben@example.com", encounterId: ENC },
    server,
    UserModel: { find: userFind() },
  });
  const toA = server.emits.find((e) => e.room === `encounter_${ENC}:squad_sq-A`);
  assert.equal(toA.event, "new_reaction");
  assert.equal(toA.payload.senderId, BEN);
  // The other squad sees the squad display name, never the account email.
  assert.equal(toA.payload.senderName, "Ben");
});

test("encounter chat projection fails closed when the sender lookup fails", async () => {
  const server = fakeServer();
  await assert.rejects(emitRealtimeProjection({
    authorization,
    senderUserId: BRUNO,
    event: "new_message",
    payload: { senderId: BRUNO, senderName: "Bruno Real" },
    server,
    UserModel: { find: () => ({ lean: async () => { throw new Error("db down"); } }) },
  }));
  assert.equal(server.emits.length, 0);
});

test("squad (lobby) chat is unchanged", async () => {
  const server = fakeServer();
  const payload = { senderId: BRUNO, senderName: "Bruno Real", squadId: "sq-B" };
  await emitRealtimeProjection({
    authorization: { allowed: true, room: "squad_sq-B" },
    senderUserId: BRUNO,
    event: "new_message",
    payload,
    server,
  });
  assert.deepEqual(server.emits, [{ room: "squad_sq-B", event: "new_message", payload }]);
});
