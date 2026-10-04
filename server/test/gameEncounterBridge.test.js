const assert = require("node:assert/strict");
const http = require("node:http");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const jwt = require("jsonwebtoken");

const {
  BRIDGE_ISSUER,
  BRIDGE_AUDIENCE,
  TICKET_TTL_SECONDS,
  ENCOUNTER_ROOM_PREFIX,
  encounterRoomKey,
  issueEncounterGameTicket,
} = require("../src/services/gameBridgeService");
const gameRoutes = require("../src/routes/gameRoutes");
const User = require("../src/models/User");
const { Squad } = require("../src/models/Squad");
const { Encounter } = require("../src/models/Encounter");
const { redis, subClient } = require("../src/config/redisConfig");

test.after(async () => {
  await Promise.allSettled([redis.quit(), subClient.quit()]);
});

const SECRET = "test-game-bridge-secret-0123456789abcdef";
const GAMES_URL = "http://127.0.0.1:8125";
const HTTP_JWT_SECRET = "test-http-jwt-secret-with-32-plus-bytes";

const ENC = "enc_1728000000000_abc123def4";
const SQUAD_A = "sq-A";
const SQUAD_B = "sq-B";

const ALICE = "507f1f77bcf86cd799439011";
const AMY = "507f1f77bcf86cd799439033";
const BRUNO = "507f1f77bcf86cd799439022";
const BEN = "507f1f77bcf86cd799439044";
const OUTSIDER = "507f1f77bcf86cd799439055";

const ENV_KEYS = ["NODE_ENV", "GAMES_PUBLIC_URL", "GAME_BRIDGE_SECRET"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

function setEnv(patch) {
  for (const key of ENV_KEYS) {
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
}

test.afterEach(() => {
  setEnv(savedEnv);
});

test("encounter route requires auth and derives scope from the URL, ignoring the body", () => {
  const source = readFileSync(path.join(__dirname, "../src/routes/gameRoutes.js"), "utf8");

  assert.match(
    source,
    /router\.post\("\/encounters\/:encounterId\/games\/token", requireApiAuth, postEncounterGameTokenHandler\)/
  );
  assert.match(source, /const encounterId = req\.params\.encounterId;/);
  // Both game token handlers ignore the request body entirely.
  assert.doesNotMatch(source, /req\.body/);
});

test("encounter room keys namespace the shared room away from squad ids", () => {
  assert.equal(ENCOUNTER_ROOM_PREFIX, "enc:");
  assert.equal(encounterRoomKey(ENC), `enc:${ENC}`);
  // Deterministic: both squads in the same call compute the same key.
  assert.equal(encounterRoomKey(ENC), encounterRoomKey(ENC));
  // Namespaced: can never equal a squad id or a bare encounter id.
  assert.notEqual(encounterRoomKey(ENC), SQUAD_A);
  assert.notEqual(encounterRoomKey(ENC), SQUAD_B);
  assert.notEqual(encounterRoomKey(ENC), ENC);
  assert.throws(() => encounterRoomKey(""), /MISSING_IDENTITY/);
  assert.throws(() => encounterRoomKey("   "), /MISSING_IDENTITY/);
  assert.throws(() => encounterRoomKey(), /MISSING_IDENTITY/);
});

test("issued encounter tickets share one room claim under the fixed bridge protocol", () => {
  setEnv({ NODE_ENV: "development", GAMES_PUBLIC_URL: GAMES_URL, GAME_BRIDGE_SECRET: SECRET });

  const forAlice = issueEncounterGameTicket({ encounterId: ENC, userId: ALICE, displayName: "Ann" });
  const forBruno = issueEncounterGameTicket({ encounterId: ENC, userId: BRUNO, displayName: "Bruno" });
  assert.equal(forAlice.gameUrl, GAMES_URL);

  const verify = (ticket) =>
    jwt.verify(ticket, SECRET, { algorithms: ["HS256"], issuer: BRIDGE_ISSUER, audience: BRIDGE_AUDIENCE });
  const decodedA = verify(forAlice.ticket);
  const decodedB = verify(forBruno.ticket);

  // Same shared room for both sides — never either side's squad room.
  assert.equal(decodedA.squadId, `enc:${ENC}`);
  assert.equal(decodedB.squadId, `enc:${ENC}`);
  assert.notEqual(decodedA.squadId, SQUAD_A);
  assert.notEqual(decodedA.squadId, SQUAD_B);
  // Distinct seats, fixed protocol (issuer/audience/90s window/single-use jti).
  assert.equal(decodedA.sub, ALICE);
  assert.equal(decodedB.sub, BRUNO);
  assert.equal(decodedA.displayName, "Ann");
  assert.equal(typeof decodedA.jti, "string");
  assert.notEqual(decodedA.jti, decodedB.jti);
  assert.equal(decodedA.exp - decodedA.iat, TICKET_TTL_SECONDS);
  assert.equal(TICKET_TTL_SECONDS, 90);

  const long = issueEncounterGameTicket({ encounterId: ENC, userId: ALICE, displayName: "x".repeat(200) });
  assert.equal(jwt.decode(long.ticket).displayName.length, 64);

  assert.throws(() => issueEncounterGameTicket({ userId: ALICE }), /MISSING_IDENTITY/);
});

test("issueEncounterGameTicket refuses to sign while games are unavailable", () => {
  setEnv({ NODE_ENV: "development" });
  assert.throws(() => issueEncounterGameTicket({ encounterId: ENC, userId: ALICE }), /GAMES_UNAVAILABLE/);
});

// Real HTTP through the REAL route chain (requireApiAuth + handler). Only the
// Mongoose model methods return fixture rows — the same injected-fixture
// pattern as gameBridge.test.js — so every gate below is production code.
function buildTokenApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", gameRoutes);
  return app;
}

async function postEncounterToken(app, encounterId, { token, body } = {}) {
  const testServer = http.createServer(app);
  await new Promise((resolve, reject) => {
    testServer.once("error", reject);
    testServer.listen(0, "127.0.0.1", resolve);
  });
  const { port } = testServer.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/encounters/${encounterId}/games/token`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body || {}),
    });
    return { status: res.status, payload: await res.json() };
  } finally {
    await new Promise((resolve) => testServer.close(resolve));
  }
}

const VERIFIED_ADULT = { ageConfirmed: true, isAdult: true, ageVerified: true };

const member = (memberId, userId, displayName, role = "member") => ({
  memberId,
  userId,
  providerAccountId: userId,
  displayName,
  role,
});

// Mutable fixtures: tests mutate encounter status / membership between posts
// to prove each renewal is re-authorized against live server records.
function makeFixtures() {
  return {
    authUser: { ...VERIFIED_ADULT },
    encounter: { encounterId: ENC, squadAId: SQUAD_A, squadBId: SQUAD_B, status: "active" },
    squads: {
      [SQUAD_A]: {
        squadId: SQUAD_A,
        currentEncounterId: ENC,
        members: [member("m-a1", ALICE, "Ann", "leader"), member("m-a2", AMY, "Amy")],
      },
      [SQUAD_B]: {
        squadId: SQUAD_B,
        currentEncounterId: ENC,
        members: [member("m-b1", BRUNO, "Bruno", "leader"), member("m-b2", BEN, "Ben")],
      },
    },
    blockUsers: [
      { _id: ALICE, blockedUserIds: [] },
      { _id: AMY, blockedUserIds: [] },
      { _id: BRUNO, blockedUserIds: [] },
      { _id: BEN, blockedUserIds: [] },
    ],
  };
}

function stubEncounterDb(fixtures) {
  const originals = {
    findById: User.findById,
    findOneSquad: Squad.findOne,
    findOneEncounter: Encounter.findOne,
    find: User.find,
  };
  User.findById = () => ({ select: () => ({ lean: async () => fixtures.authUser }) });
  Squad.findOne = async (query) => fixtures.squads[query?.squadId] || null;
  Encounter.findOne = async (query) =>
    fixtures.encounter && query?.encounterId === fixtures.encounter.encounterId ? fixtures.encounter : null;
  User.find = () => ({ lean: async () => fixtures.blockUsers });
  return () => {
    User.findById = originals.findById;
    Squad.findOne = originals.findOneSquad;
    Encounter.findOne = originals.findOneEncounter;
    User.find = originals.find;
  };
}

async function withHttpEnv(run) {
  const originalJwt = process.env.JWT_SECRET;
  const originalDeclared = process.env.SELF_DECLARED_AGE_ACCESS;
  const originalBypass = process.env.AGE_VERIFICATION_BYPASS;
  setEnv({ NODE_ENV: "development", GAMES_PUBLIC_URL: GAMES_URL, GAME_BRIDGE_SECRET: SECRET });
  process.env.JWT_SECRET = HTTP_JWT_SECRET;
  delete process.env.SELF_DECLARED_AGE_ACCESS;
  delete process.env.AGE_VERIFICATION_BYPASS;
  try {
    return await run();
  } finally {
    if (originalJwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwt;
    if (originalDeclared === undefined) delete process.env.SELF_DECLARED_AGE_ACCESS;
    else process.env.SELF_DECLARED_AGE_ACCESS = originalDeclared;
    if (originalBypass === undefined) delete process.env.AGE_VERIFICATION_BYPASS;
    else process.env.AGE_VERIFICATION_BYPASS = originalBypass;
  }
}

const decodeTicket = (ticket) =>
  jwt.verify(ticket, SECRET, { algorithms: ["HS256"], issuer: BRIDGE_ISSUER, audience: BRIDGE_AUDIENCE });

test("POST encounter games/token issues both squads the SAME shared room", async () => {
  await withHttpEnv(async () => {
    const restore = stubEncounterDb(makeFixtures());
    try {
      const app = buildTokenApp();
      const forAlice = await postEncounterToken(app, ENC, {
        token: jwt.sign({ userId: ALICE }, HTTP_JWT_SECRET),
      });
      const forBruno = await postEncounterToken(app, ENC, {
        token: jwt.sign({ userId: BRUNO }, HTTP_JWT_SECRET),
      });

      assert.equal(forAlice.status, 200);
      assert.equal(forBruno.status, 200);
      assert.equal(forAlice.payload.data.encounterId, ENC);
      assert.equal(forAlice.payload.data.squadId, SQUAD_A);
      assert.equal(forBruno.payload.data.squadId, SQUAD_B);

      const decodedA = decodeTicket(forAlice.payload.data.ticket);
      const decodedB = decodeTicket(forBruno.payload.data.ticket);
      // One shared room — never each side's separate squad room.
      assert.equal(decodedA.squadId, `enc:${ENC}`);
      assert.equal(decodedB.squadId, decodedA.squadId);
      assert.notEqual(decodedA.squadId, SQUAD_A);
      assert.notEqual(decodedA.squadId, SQUAD_B);
      // Distinct seats with the fixed 90s single-use protocol.
      assert.equal(decodedA.sub, ALICE);
      assert.equal(decodedB.sub, BRUNO);
      assert.equal(decodedA.displayName, "Ann");
      assert.equal(decodedB.displayName, "Bruno");
      assert.equal(decodedA.exp - decodedA.iat, 90);
      assert.notEqual(decodedA.jti, decodedB.jti);
    } finally {
      restore();
    }
  });
});

test("POST encounter games/token ignores forged body identity and room claims", async () => {
  await withHttpEnv(async () => {
    const restore = stubEncounterDb(makeFixtures());
    try {
      const { status, payload } = await postEncounterToken(buildTokenApp(), ENC, {
        token: jwt.sign({ userId: ALICE }, HTTP_JWT_SECRET),
        body: {
          encounterId: "enc-evil",
          squadId: "sq-evil",
          userId: OUTSIDER,
          displayName: "Mallory",
          role: "leader",
        },
      });
      assert.equal(status, 200);
      assert.equal(payload.data.encounterId, ENC);
      assert.equal(payload.data.squadId, SQUAD_A);
      const decoded = decodeTicket(payload.data.ticket);
      assert.equal(decoded.squadId, `enc:${ENC}`);
      assert.equal(decoded.sub, ALICE);
      assert.equal(decoded.displayName, "Ann");
    } finally {
      restore();
    }
  });
});

test("POST encounter games/token denies outsiders and unknown encounters", async () => {
  await withHttpEnv(async () => {
    const fixtures = makeFixtures();
    const restore = stubEncounterDb(fixtures);
    try {
      const app = buildTokenApp();
      const outsider = await postEncounterToken(app, ENC, {
        token: jwt.sign({ userId: OUTSIDER }, HTTP_JWT_SECRET),
      });
      assert.equal(outsider.status, 403);
      assert.equal(outsider.payload.error.code, "FORBIDDEN");

      const missing = await postEncounterToken(app, "enc_missing", {
        token: jwt.sign({ userId: ALICE }, HTTP_JWT_SECRET),
      });
      assert.equal(missing.status, 404);
      assert.equal(missing.payload.error.code, "ENCOUNTER_NOT_FOUND");
    } finally {
      restore();
    }
  });
});

test("POST encounter games/token denies ended and not-yet-active encounters", async () => {
  await withHttpEnv(async () => {
    const fixtures = makeFixtures();
    const restore = stubEncounterDb(fixtures);
    try {
      const app = buildTokenApp();
      const token = jwt.sign({ userId: ALICE }, HTTP_JWT_SECRET);

      fixtures.encounter.status = "ended";
      const ended = await postEncounterToken(app, ENC, { token });
      assert.equal(ended.status, 409);
      assert.equal(ended.payload.error.code, "ENCOUNTER_ENDED");

      fixtures.encounter.status = "awaiting_ack";
      const waiting = await postEncounterToken(app, ENC, { token });
      assert.equal(waiting.status, 409);
      assert.equal(waiting.payload.error.code, "ENCOUNTER_NOT_ACTIVE");
    } finally {
      restore();
    }
  });
});

test("POST encounter games/token denies encounters with a blocked pair across squads", async () => {
  await withHttpEnv(async () => {
    const fixtures = makeFixtures();
    fixtures.blockUsers = [
      { _id: ALICE, blockedUserIds: [BRUNO] },
      { _id: AMY, blockedUserIds: [] },
      { _id: BRUNO, blockedUserIds: [] },
      { _id: BEN, blockedUserIds: [] },
    ];
    const restore = stubEncounterDb(fixtures);
    try {
      const app = buildTokenApp();
      for (const userId of [ALICE, BRUNO]) {
        const { status, payload } = await postEncounterToken(app, ENC, {
          token: jwt.sign({ userId }, HTTP_JWT_SECRET),
        });
        assert.equal(status, 403, `expected 403 for ${userId}`);
        assert.equal(payload.error.code, "INTERACTION_BLOCKED");
      }
    } finally {
      restore();
    }
  });
});

test("POST encounter games/token denies renewal after membership ends", async () => {
  await withHttpEnv(async () => {
    const fixtures = makeFixtures();
    const restore = stubEncounterDb(fixtures);
    try {
      const app = buildTokenApp();
      const token = jwt.sign({ userId: ALICE }, HTTP_JWT_SECRET);

      const first = await postEncounterToken(app, ENC, { token });
      assert.equal(first.status, 200);

      // Alice leaves/is removed: the next renewal (~60s later) must fail.
      fixtures.squads[SQUAD_A].members = fixtures.squads[SQUAD_A].members.filter(
        (candidate) => candidate.userId !== ALICE
      );
      const renewal = await postEncounterToken(app, ENC, { token });
      assert.equal(renewal.status, 403);
      assert.equal(renewal.payload.error.code, "FORBIDDEN");
    } finally {
      restore();
    }
  });
});

test("POST encounter games/token denies renewal after the squad leaves the encounter", async () => {
  await withHttpEnv(async () => {
    const fixtures = makeFixtures();
    const restore = stubEncounterDb(fixtures);
    try {
      const app = buildTokenApp();
      const token = jwt.sign({ userId: BRUNO }, HTTP_JWT_SECRET);

      const first = await postEncounterToken(app, ENC, { token });
      assert.equal(first.status, 200);

      fixtures.squads[SQUAD_B].currentEncounterId = "enc_somewhere_else";
      const renewal = await postEncounterToken(app, ENC, { token });
      assert.equal(renewal.status, 403);
      assert.equal(renewal.payload.error.code, "MEMBER_NOT_IN_ENCOUNTER");
    } finally {
      restore();
    }
  });
});

test("POST encounter games/token enforces auth and live account gates", async () => {
  await withHttpEnv(async () => {
    const fixtures = makeFixtures();
    const restore = stubEncounterDb(fixtures);
    try {
      const app = buildTokenApp();

      const missing = await postEncounterToken(app, ENC);
      assert.equal(missing.status, 401);
      assert.equal(missing.payload.error.code, "UNAUTHORIZED");

      fixtures.authUser = { ...VERIFIED_ADULT, isSuspended: true };
      const suspended = await postEncounterToken(app, ENC, {
        token: jwt.sign({ userId: ALICE }, HTTP_JWT_SECRET),
      });
      assert.equal(suspended.status, 403);
      assert.equal(suspended.payload.error.code, "ACCOUNT_UNAVAILABLE");
    } finally {
      restore();
    }
  });
});

test("POST encounter games/token returns 503 while games are unavailable", async () => {
  await withHttpEnv(async () => {
    setEnv({ NODE_ENV: "development" });
    const restore = stubEncounterDb(makeFixtures());
    try {
      const { status, payload } = await postEncounterToken(buildTokenApp(), ENC, {
        token: jwt.sign({ userId: ALICE }, HTTP_JWT_SECRET),
      });
      assert.equal(status, 503);
      assert.equal(payload.error.code, "GAMES_UNAVAILABLE");
    } finally {
      restore();
    }
  });
});
