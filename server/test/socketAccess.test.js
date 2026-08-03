const assert = require("node:assert/strict");
const test = require("node:test");
const { after } = require("node:test");

const {
  authorizeEncounterRoomJoin,
  authorizeSquadReport,
  authorizeSquadRoomJoin,
  normalizeRealtimeId,
  resolveReportTargetSquadId,
} = require("../src/utils/socketAccess");
const {
  closeEncounterRoom,
  isRealtimeDebugEnabled,
  normalizeSocketIdentity,
  revokeUserRealtimeAccess,
  resolveSocketAuthToken,
} = require("../src/services/socketService");
const { isMatchmakingDebugEnabled } = require("../src/services/matchmakingService");

after(async () => {
  const redisPath = require.resolve("../src/config/redisConfig");
  if (!require.cache[redisPath]) return;
  const { redis, subClient } = require("../src/config/redisConfig");
  await Promise.allSettled([redis.quit(), subClient.quit()]);
});

const squadModel = (squads) => ({
  async findOne(query) {
    if (query.squadId?.$in && query["members.userId"]) {
      return squads.find(
        (squad) =>
          query.squadId.$in.includes(squad.squadId) &&
          squad.members.some((member) => member.userId === query["members.userId"])
      ) || null;
    }

    if (query.squadId && query["members.userId"]) {
      return squads.find(
        (squad) =>
          squad.squadId === query.squadId &&
          squad.members.some((member) => member.userId === query["members.userId"])
      ) || null;
    }

    return squads.find((squad) => squad.squadId === query.squadId) || null;
  },
});

const encounterModel = (encounters) => ({
  async findOne(query) {
    return encounters.find((encounter) => encounter.encounterId === query.encounterId) || null;
  },
});

test("normalizeRealtimeId accepts only bounded room id strings", () => {
  assert.equal(normalizeRealtimeId(" sq_123_abc "), "sq_123_abc");
  assert.equal(normalizeRealtimeId("enc-123_ABC"), "enc-123_ABC");
  assert.equal(normalizeRealtimeId("squad/../../other"), "");
  assert.equal(normalizeRealtimeId("x".repeat(97)), "");
  assert.equal(normalizeRealtimeId(null), "");
});

test("realtime debug logging is opt-in for production", () => {
  assert.equal(isRealtimeDebugEnabled({ NODE_ENV: "production" }), false);
  assert.equal(isRealtimeDebugEnabled({ NODE_ENV: "production", REALTIME_DEBUG: "true" }), true);
  assert.equal(isRealtimeDebugEnabled({ NODE_ENV: "development" }), true);
});

test("socket identity accepts only valid Mongo user ids", () => {
  assert.deepEqual(
    normalizeSocketIdentity({
      userId: "507f1f77bcf86cd799439011",
      name: "Ana",
    }),
    { userId: "507f1f77bcf86cd799439011", userName: "Ana" }
  );
  assert.equal(normalizeSocketIdentity({ userId: "not-a-mongo-id", name: "Ana" }), null);
});

test("production sockets do not accept JWTs from query strings", () => {
  assert.equal(
    resolveSocketAuthToken({ auth: { token: "auth-token" }, query: { token: "query-token" } }, true),
    "auth-token"
  );
  assert.equal(
    resolveSocketAuthToken({ auth: {}, query: { token: "query-token" } }, true),
    undefined
  );
  assert.equal(
    resolveSocketAuthToken({ auth: {}, query: { token: "query-token" } }, false),
    "query-token"
  );
});

test("revoking squad access removes every user socket from squad and encounter rooms", () => {
  const calls = [];
  const server = {
    in(room) {
      calls.push(["in", room]);
      return { socketsLeave: (rooms) => calls.push(["leave", rooms]) };
    },
  };

  revokeUserRealtimeAccess({
    userId: "user_a",
    squadId: "sq_a",
    encounterId: "enc_1",
  }, server);

  assert.deepEqual(calls, [
    ["in", "user_user_a"],
    ["leave", ["squad_sq_a", "encounter_enc_1"]],
  ]);
});

test("closing an encounter removes every socket from its stale room", () => {
  const calls = [];
  const server = {
    in(room) {
      calls.push(["in", room]);
      return { socketsLeave: (leftRoom) => calls.push(["leave", leftRoom]) };
    },
  };

  closeEncounterRoom("enc_1", server);

  assert.deepEqual(calls, [
    ["in", "encounter_enc_1"],
    ["leave", "encounter_enc_1"],
  ]);
});

test("matchmaking debug logging is opt-in for production", () => {
  assert.equal(isMatchmakingDebugEnabled({ NODE_ENV: "production" }), false);
  assert.equal(isMatchmakingDebugEnabled({ NODE_ENV: "production", MATCHMAKING_DEBUG: "true" }), true);
  assert.equal(isMatchmakingDebugEnabled({ NODE_ENV: "development" }), true);
});

test("authorizeSquadRoomJoin requires membership for authenticated sockets", async () => {
  const Squad = squadModel([
    { squadId: "sq_a", members: [{ userId: "user_a" }] },
    { squadId: "sq_b", members: [{ userId: "user_b" }] },
  ]);

  const allowed = await authorizeSquadRoomJoin({
    squadId: "sq_a",
    userId: "user_a",
    isProduction: true,
    Squad,
  });
  const denied = await authorizeSquadRoomJoin({
    squadId: "sq_b",
    userId: "user_a",
    isProduction: true,
    Squad,
  });

  assert.deepEqual(allowed, { allowed: true, room: "squad_sq_a" });
  assert.equal(denied.allowed, false);
});

test("authorizeEncounterRoomJoin requires membership in either encounter squad", async () => {
  const Squad = squadModel([
    { squadId: "sq_a", members: [{ userId: "user_a" }] },
    { squadId: "sq_b", members: [{ userId: "user_b" }] },
  ]);
  const Encounter = encounterModel([
    { encounterId: "enc_1", squadAId: "sq_a", squadBId: "sq_b", status: "active" },
  ]);

  const allowed = await authorizeEncounterRoomJoin({
    encounterId: "enc_1",
    userId: "user_a",
    isProduction: true,
    Squad,
    Encounter,
  });
  const denied = await authorizeEncounterRoomJoin({
    encounterId: "enc_1",
    userId: "user_c",
    isProduction: true,
    Squad,
    Encounter,
  });

  assert.deepEqual(allowed, { allowed: true, room: "encounter_enc_1" });
  assert.equal(denied.allowed, false);
});

test("resolveReportTargetSquadId prefers the reported squad over reporter squad", () => {
  assert.equal(
    resolveReportTargetSquadId({ squadId: "sq_reporter", reportedSquadId: "sq_target" }),
    "sq_target"
  );
  assert.equal(resolveReportTargetSquadId({ squadId: "sq_legacy" }), "sq_legacy");
});

test("authorizeSquadReport allows only encounter participants to report the opponent", async () => {
  const Squad = squadModel([
    { squadId: "sq_a", members: [{ userId: "user_a" }] },
    { squadId: "sq_b", members: [{ userId: "user_b" }] },
  ]);
  const Encounter = encounterModel([
    { encounterId: "enc_1", squadAId: "sq_a", squadBId: "sq_b", status: "active" },
  ]);

  const allowed = await authorizeSquadReport({
    payload: { encounterId: "enc_1", squadId: "sq_a", reportedSquadId: "sq_b" },
    userId: "user_a",
    Squad,
    Encounter,
  });
  const denied = await authorizeSquadReport({
    payload: { encounterId: "enc_1", squadId: "sq_a", reportedSquadId: "sq_b" },
    userId: "user_c",
    Squad,
    Encounter,
  });

  assert.deepEqual(allowed, { allowed: true, targetSquadId: "sq_b" });
  assert.equal(denied.allowed, false);
});

test("reaction broadcasts include encounter ids for client-side scoped filtering", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../src/services/socketService.js"),
    "utf8"
  );
  const reactionBlock = source.slice(
    source.indexOf("socket.on('send_reaction'"),
    source.indexOf("socket.on('report_squad'")
  );

  assert.match(reactionBlock, /encounterId: normalizedEncounterId \|\| undefined,/);
  assert.match(reactionBlock, /squadId: normalizedSquadId \|\| undefined,/);
});

test("chat broadcasts include scope, client ids, and explicit acknowledgements", () => {
  const source = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "../src/services/socketService.js"),
    "utf8"
  );
  const messageBlock = source.slice(
    source.indexOf("socket.on('send_message'"),
    source.indexOf("socket.on('send_reaction'")
  );

  assert.match(messageBlock, /encounterId: normalizedEncounterId \|\| undefined,/);
  assert.match(messageBlock, /squadId: normalizedSquadId \|\| undefined,/);
  assert.match(messageBlock, /clientMessageId: normalizedClientMessageId \|\| undefined,/);
  assert.match(messageBlock, /reply\(\{ ok: false, error:/);
  assert.match(messageBlock, /reply\(\{ ok: true, message \}\);/);
  assert.match(messageBlock, /sentChatMessages\.get\(normalizedClientMessageId\)/);
});
