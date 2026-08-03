const assert = require("node:assert/strict");
const test = require("node:test");
const { after } = require("node:test");
const jwt = require("jsonwebtoken");

const User = require("../src/models/User");

const {
  authorizeEncounterRoomJoin,
  authorizeSquadReport,
  authorizeSquadRoomJoin,
  normalizeRealtimeId,
  resolveReportTargetSquadId,
} = require("../src/utils/socketAccess");
const {
  authenticateSocket,
  closeEncounterRoom,
  isRealtimeDebugEnabled,
  normalizeSocketIdentity,
  revokeUserRealtimeAccess,
  resolveSocketAuthToken,
} = require("../src/services/socketService");
const { isMatchmakingDebugEnabled } = require("../src/services/matchmakingService");

const USER_ID = "64b7f3c9a1b2c3d4e5f67890";

async function withSocketAuthEnvironment(run) {
  const originals = {
    JWT_SECRET: process.env.JWT_SECRET,
    NODE_ENV: process.env.NODE_ENV,
    AGE_VERIFICATION_BYPASS: process.env.AGE_VERIFICATION_BYPASS,
  };
  process.env.JWT_SECRET = "test-secret";
  process.env.NODE_ENV = "production";
  process.env.AGE_VERIFICATION_BYPASS = "true";

  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withSocketUser(user, run) {
  const originalFindById = User.findById;
  let selectedFields;
  User.findById = () => ({
    select: async (fields) => {
      selectedFields = fields;
      if (user instanceof Error) throw user;
      return user;
    },
  });

  try {
    return await run(() => selectedFields);
  } finally {
    User.findById = originalFindById;
  }
}

function socketWithToken(token) {
  return {
    id: "socket_1",
    handshake: { auth: token === undefined ? {} : { token }, query: {} },
  };
}

function signSocketToken(claims = {}) {
  return jwt.sign({ userId: USER_ID, name: "Ana", ...claims }, process.env.JWT_SECRET);
}

async function runSocketAuth(socket) {
  let error;
  await authenticateSocket(socket, (nextError) => {
    error = nextError || null;
  });
  return error;
}

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

test("socket auth loads only live age-access fields and allows a verified adult", async () => {
  await withSocketAuthEnvironment(() =>
    withSocketUser(
      { ageConfirmed: true, isAdult: true, ageVerified: true },
      async (getSelectedFields) => {
        const socket = socketWithToken(signSocketToken());

        assert.equal(await runSocketAuth(socket), null);
        assert.equal(getSelectedFields(), "ageConfirmed isAdult ageVerified");
        assert.equal(socket.userId, USER_ID);
        assert.equal(socket.userName, "Ana");
      }
    )
  );
});

test("production socket auth rejects missing, minor, self-attested, and rejected users", async () => {
  const deniedUsers = [
    null,
    { ageConfirmed: true, isAdult: false, ageVerified: false },
    { ageConfirmed: true, isAdult: true, ageVerified: false },
    { ageConfirmed: true, isAdult: true, ageVerified: false, ageVerificationStatus: "rejected" },
  ];

  await withSocketAuthEnvironment(async () => {
    for (const user of deniedUsers) {
      await withSocketUser(user, async () => {
        const socket = socketWithToken(signSocketToken());
        const error = await runSocketAuth(socket);

        assert.equal(error?.message, "UNAUTHORIZED");
        assert.equal(socket.userId, undefined);
      });
    }
  });
});

test("production socket auth ignores the development age bypass", async () => {
  await withSocketAuthEnvironment(() =>
    withSocketUser(
      { ageConfirmed: true, isAdult: true, ageVerified: false },
      async () => {
        const error = await runSocketAuth(socketWithToken(signSocketToken()));
        assert.equal(error?.message, "UNAUTHORIZED");
      }
    )
  );
});

test("socket auth fails closed when the live user lookup fails", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await withSocketAuthEnvironment(() =>
      withSocketUser(new Error("database unavailable"), async () => {
        const error = await runSocketAuth(socketWithToken(signSocketToken()));
        assert.equal(error?.message, "UNAUTHORIZED");
      })
    );
  } finally {
    console.error = originalConsoleError;
  }
});

test("malformed presented socket tokens reject even in development", async () => {
  await withSocketAuthEnvironment(async () => {
    process.env.NODE_ENV = "development";
    const originalConsoleWarn = console.warn;
    console.warn = () => {};
    try {
      for (const token of ["not-a-jwt", "", null]) {
        const error = await runSocketAuth(socketWithToken(token));
        assert.equal(error?.message, "UNAUTHORIZED");
      }
    } finally {
      console.warn = originalConsoleWarn;
    }
  });
});

test("only exact development mode permits a tokenless anonymous socket", async () => {
  await withSocketAuthEnvironment(async () => {
    const productionError = await runSocketAuth(socketWithToken());
    assert.equal(productionError?.message, "UNAUTHORIZED");

    process.env.NODE_ENV = "test";
    const testError = await runSocketAuth(socketWithToken());
    assert.equal(testError?.message, "UNAUTHORIZED");

    process.env.NODE_ENV = "development";
    const originalConsoleWarn = console.warn;
    console.warn = () => {};
    try {
      const socket = socketWithToken();
      assert.equal(await runSocketAuth(socket), null);
      assert.equal(socket.userId, null);
      assert.equal(socket.userName, null);
    } finally {
      console.warn = originalConsoleWarn;
    }
  });
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
