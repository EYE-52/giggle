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
  validateGamesUrl,
  getGamesConfig,
  isGamesEnabled,
  issueGameTicket,
} = require("../src/services/gameBridgeService");
const gameRoutes = require("../src/routes/gameRoutes");
const { postGameTokenHandler } = require("../src/routes/gameRoutes");
const User = require("../src/models/User");
const { Squad } = require("../src/models/Squad");
const { redis, subClient } = require("../src/config/redisConfig");

test.after(async () => {
  await Promise.allSettled([redis.quit(), subClient.quit()]);
});

const SECRET = "test-game-bridge-secret-0123456789abcdef";
const GAMES_URL = "http://127.0.0.1:8125";
const HTTP_JWT_SECRET = "test-http-jwt-secret-with-32-plus-bytes";

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

test("game ticket route requires auth plus live squad membership", () => {
  const source = readFileSync(path.join(__dirname, "../src/routes/gameRoutes.js"), "utf8");

  assert.match(source, /router\.post\("\/squads\/:squadId\/games\/token", requireApiAuth, requireSquadMemberAccess, postGameTokenHandler\)/);
  assert.match(source, /anyBlockedPair\(squad\.members\.map\(\(candidate\) => candidate\.userId\), \{ User \}\)/);
});

test("games URL validation enforces scheme, credentials, and shape", () => {
  const dev = { NODE_ENV: "development" };
  const prod = { NODE_ENV: "production" };

  assert.equal(validateGamesUrl("https://games.example.com", prod).ok, true);
  assert.equal(validateGamesUrl("https://games.example.com/night", prod).origin, "https://games.example.com");
  assert.equal(validateGamesUrl("http://127.0.0.1:8125", dev).ok, true);
  assert.equal(validateGamesUrl("http://127.0.0.1:8125", prod).ok, false);
  assert.equal(validateGamesUrl("http://127.0.0.1:8125", prod).reason, "https-required");
  assert.equal(validateGamesUrl("", dev).ok, false);
  assert.equal(validateGamesUrl("notaurl", dev).ok, false);
  assert.equal(validateGamesUrl("ftp://games.example.com", dev).ok, false);
  assert.equal(validateGamesUrl("https://user@games.example.com", prod).ok, false);
  assert.equal(validateGamesUrl("https://games.example.com/?x=1", prod).ok, false);
  assert.equal(validateGamesUrl("https://games.example.com/#x", prod).ok, false);
});

test("games stay disabled unless fully configured", () => {
  setEnv({ NODE_ENV: "development" });
  assert.equal(isGamesEnabled(), false);

  setEnv({ NODE_ENV: "development", GAMES_PUBLIC_URL: GAMES_URL });
  assert.equal(isGamesEnabled(), false);

  setEnv({ NODE_ENV: "development", GAMES_PUBLIC_URL: GAMES_URL, GAME_BRIDGE_SECRET: "short" });
  assert.equal(isGamesEnabled(), false);
  assert.equal(getGamesConfig().reason, "bad-secret");

  setEnv({ NODE_ENV: "production", GAMES_PUBLIC_URL: GAMES_URL, GAME_BRIDGE_SECRET: SECRET });
  assert.equal(isGamesEnabled(), false);

  setEnv({ NODE_ENV: "development", GAMES_PUBLIC_URL: GAMES_URL, GAME_BRIDGE_SECRET: SECRET });
  const config = getGamesConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.gamesUrl, GAMES_URL);
  assert.equal(config.gamesOrigin, "http://127.0.0.1:8125");
});

test("issued tickets carry the fixed bridge claims with a 90s window", () => {
  setEnv({ NODE_ENV: "development", GAMES_PUBLIC_URL: GAMES_URL, GAME_BRIDGE_SECRET: SECRET });

  const { ticket, gameUrl } = issueGameTicket({ squadId: "sq1", userId: "507f1f77bcf86cd799439011", displayName: "Ann" });
  assert.equal(gameUrl, GAMES_URL);
  const decoded = jwt.verify(ticket, SECRET, {
    algorithms: ["HS256"],
    issuer: BRIDGE_ISSUER,
    audience: BRIDGE_AUDIENCE,
  });
  assert.equal(decoded.sub, "507f1f77bcf86cd799439011");
  assert.equal(decoded.squadId, "sq1");
  assert.equal(decoded.displayName, "Ann");
  assert.equal(typeof decoded.jti, "string");
  assert.equal(decoded.exp - decoded.iat, TICKET_TTL_SECONDS);
  assert.equal(TICKET_TTL_SECONDS, 90);

  // A tampered ticket fails verification.
  const tampered = ticket.slice(0, -2) + (ticket.endsWith("aa") ? "bb" : "aa");
  assert.throws(() => jwt.verify(tampered, SECRET, { issuer: BRIDGE_ISSUER, audience: BRIDGE_AUDIENCE }));

  // Long display names are truncated, never break the ticket.
  const long = issueGameTicket({ squadId: "sq1", userId: "u", displayName: "x".repeat(200) });
  assert.equal(jwt.decode(long.ticket).displayName.length, 64);

  assert.throws(() => issueGameTicket({ squadId: "sq1" }), /MISSING_IDENTITY/);
});

test("issueGameTicket refuses to sign while games are unavailable", () => {
  setEnv({ NODE_ENV: "development" });
  assert.throws(() => issueGameTicket({ squadId: "sq1", userId: "u" }), /GAMES_UNAVAILABLE/);
});

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

const ALICE = "507f1f77bcf86cd799439011";
const BRUNO = "507f1f77bcf86cd799439022";

function stubBlockState(users) {
  const original = User.find;
  User.find = () => ({ lean: async () => users });
  return () => {
    User.find = original;
  };
}

function squadReq({ members, member, identity, body }) {
  return {
    body: body || {},
    giggleIdentity: identity,
    squadAccess: {
      squad: { squadId: "sq-alpha", members },
      member,
    },
  };
}

test("game token handler returns 503 while games are unavailable", async () => {
  setEnv({ NODE_ENV: "development" });
  const req = squadReq({
    members: [{ userId: ALICE }],
    member: { userId: ALICE, displayName: "Ann" },
    identity: { userId: ALICE },
  });
  const res = createResponse();

  await postGameTokenHandler(req, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error.code, "GAMES_UNAVAILABLE");
});

test("game token handler issues tickets from session identity, ignoring the body", async () => {
  setEnv({ NODE_ENV: "development", GAMES_PUBLIC_URL: GAMES_URL, GAME_BRIDGE_SECRET: SECRET });
  const restore = stubBlockState([
    { _id: ALICE, blockedUserIds: [] },
    { _id: BRUNO, blockedUserIds: [] },
  ]);
  try {
    const req = squadReq({
      members: [{ userId: ALICE }, { userId: BRUNO }],
      member: { userId: ALICE, displayName: "Ann" },
      identity: { userId: ALICE, name: "Ann Identity" },
      body: { userId: "attacker", displayName: "Attacker", role: "leader", squadId: "sq-evil" },
    });
    const res = createResponse();

    await postGameTokenHandler(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.squadId, "sq-alpha");
    assert.equal(res.body.data.gameUrl, GAMES_URL);
    const decoded = jwt.verify(res.body.data.ticket, SECRET, {
      algorithms: ["HS256"],
      issuer: BRIDGE_ISSUER,
      audience: BRIDGE_AUDIENCE,
    });
    assert.equal(decoded.sub, ALICE);
    assert.equal(decoded.squadId, "sq-alpha");
    assert.equal(decoded.displayName, "Ann");
  } finally {
    restore();
  }
});

test("game token handler blocks squads with a blocked pair", async () => {
  setEnv({ NODE_ENV: "development", GAMES_PUBLIC_URL: GAMES_URL, GAME_BRIDGE_SECRET: SECRET });
  const restore = stubBlockState([
    { _id: ALICE, blockedUserIds: [BRUNO] },
    { _id: BRUNO, blockedUserIds: [] },
  ]);
  try {
    const req = squadReq({
      members: [{ userId: ALICE }, { userId: BRUNO }],
      member: { userId: ALICE, displayName: "Ann" },
      identity: { userId: ALICE },
    });
    const res = createResponse();

    await postGameTokenHandler(req, res);

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, "INTERACTION_BLOCKED");
  } finally {
    restore();
  }
});

async function fetchFromApp(app, requestPath) {
  const testServer = http.createServer(app);
  await new Promise((resolve, reject) => {
    testServer.once("error", reject);
    testServer.listen(0, "127.0.0.1", resolve);
  });
  const { port } = testServer.address();
  try {
    return await fetch(`http://127.0.0.1:${port}${requestPath}`);
  } finally {
    await new Promise((resolve) => testServer.close(resolve));
  }
}

// Real HTTP through the REAL route chain (requireApiAuth +
// requireSquadMemberAccess + handler). Only the Mongoose model methods
// return fixture rows — the same injected-fixture pattern as
// authMiddleware.test.js — so every gate below is production middleware.
function buildTokenApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", gameRoutes);
  return app;
}

async function postToken(app, squadId, { token, body } = {}) {
  const testServer = http.createServer(app);
  await new Promise((resolve, reject) => {
    testServer.once("error", reject);
    testServer.listen(0, "127.0.0.1", resolve);
  });
  const { port } = testServer.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/squads/${squadId}/games/token`, {
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

function memberSquad() {
  return {
    squadId: "sq-alpha",
    members: [
      { memberId: "m1", userId: ALICE, providerAccountId: ALICE, displayName: "Ann", role: "leader" },
      { memberId: "m2", userId: BRUNO, providerAccountId: BRUNO, displayName: "Bruno", role: "member" },
    ],
  };
}

function stubHttpDb({ authUser, squad, blockUsers }) {
  const originals = { findById: User.findById, findOne: Squad.findOne, find: User.find };
  User.findById = () => ({ select: () => ({ lean: async () => authUser }) });
  Squad.findOne = async () => squad;
  User.find = () => ({ lean: async () => blockUsers });
  return () => {
    User.findById = originals.findById;
    Squad.findOne = originals.findOne;
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

test("POST games/token over HTTP rejects missing auth with 401", async () => {
  await withHttpEnv(async () => {
    const restore = stubHttpDb({ authUser: VERIFIED_ADULT, squad: memberSquad(), blockUsers: [] });
    try {
      const { status, payload } = await postToken(buildTokenApp(), "sq-alpha");
      assert.equal(status, 401);
      assert.equal(payload.ok, false);
      assert.equal(payload.error.code, "UNAUTHORIZED");
    } finally {
      restore();
    }
  });
});

test("POST games/token over HTTP enforces live age/account gates with 403", async () => {
  await withHttpEnv(async () => {
    const app = buildTokenApp();
    const cases = [
      [{ ageConfirmed: true, isAdult: false, ageVerified: false }, "AGE_RESTRICTED"],
      [{ ageConfirmed: true, isAdult: true, ageVerified: false }, "AGE_VERIFICATION_REQUIRED"],
      [{ ...VERIFIED_ADULT, isSuspended: true }, "ACCOUNT_UNAVAILABLE"],
      [{ ...VERIFIED_ADULT, deletionStatus: "pending" }, "ACCOUNT_UNAVAILABLE"],
    ];
    for (const [authUser, code] of cases) {
      const restore = stubHttpDb({ authUser, squad: memberSquad(), blockUsers: [] });
      try {
        const token = jwt.sign({ userId: ALICE }, HTTP_JWT_SECRET);
        const { status, payload } = await postToken(app, "sq-alpha", { token });
        assert.equal(status, 403, `expected 403 for ${code}`);
        assert.equal(payload.error.code, code);
      } finally {
        restore();
      }
    }
  });
});

test("POST games/token over HTTP rejects non-members and unknown squads", async () => {
  await withHttpEnv(async () => {
    const app = buildTokenApp();
    const token = jwt.sign({ userId: ALICE }, HTTP_JWT_SECRET);
    // Squad exists, requester is not a member.
    let restore = stubHttpDb({
      authUser: VERIFIED_ADULT,
      squad: {
        squadId: "sq-alpha",
        members: [{ memberId: "m2", userId: BRUNO, providerAccountId: BRUNO, displayName: "Bruno", role: "leader" }],
      },
      blockUsers: [],
    });
    try {
      const denied = await postToken(app, "sq-alpha", { token });
      assert.equal(denied.status, 403);
      assert.equal(denied.payload.error.code, "FORBIDDEN");
    } finally {
      restore();
    }
    // Squad does not exist.
    restore = stubHttpDb({ authUser: VERIFIED_ADULT, squad: null, blockUsers: [] });
    try {
      const missing = await postToken(app, "sq-nothing", { token });
      assert.equal(missing.status, 404);
      assert.equal(missing.payload.error.code, "SQUAD_NOT_FOUND");
    } finally {
      restore();
    }
  });
});

test("POST games/token over HTTP blocks squads with a blocked pair", async () => {
  await withHttpEnv(async () => {
    const restore = stubHttpDb({
      authUser: VERIFIED_ADULT,
      squad: memberSquad(),
      blockUsers: [
        { _id: ALICE, blockedUserIds: [BRUNO] },
        { _id: BRUNO, blockedUserIds: [] },
      ],
    });
    try {
      const token = jwt.sign({ userId: ALICE }, HTTP_JWT_SECRET);
      const { status, payload } = await postToken(buildTokenApp(), "sq-alpha", { token });
      assert.equal(status, 403);
      assert.equal(payload.error.code, "INTERACTION_BLOCKED");
    } finally {
      restore();
    }
  });
});

test("POST games/token over HTTP issues member tickets from session identity, ignoring the body", async () => {
  await withHttpEnv(async () => {
    const restore = stubHttpDb({
      authUser: VERIFIED_ADULT,
      squad: memberSquad(),
      blockUsers: [
        { _id: ALICE, blockedUserIds: [] },
        { _id: BRUNO, blockedUserIds: [] },
      ],
    });
    try {
      const token = jwt.sign({ userId: ALICE }, HTTP_JWT_SECRET);
      const { status, payload } = await postToken(buildTokenApp(), "sq-alpha", {
        token,
        body: { userId: "attacker", squadId: "sq-evil", displayName: "Attacker", role: "leader" },
      });
      assert.equal(status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.data.squadId, "sq-alpha");
      assert.equal(payload.data.gameUrl, GAMES_URL);
      const decoded = jwt.verify(payload.data.ticket, SECRET, {
        algorithms: ["HS256"],
        issuer: BRIDGE_ISSUER,
        audience: BRIDGE_AUDIENCE,
      });
      assert.equal(decoded.sub, ALICE);
      assert.equal(decoded.squadId, "sq-alpha");
      assert.equal(decoded.displayName, "Ann");
      assert.equal(decoded.exp - decoded.iat, 90);
    } finally {
      restore();
    }
  });
});

test("GET /api/features preserves strangerDiscovery and gates games on config", async () => {
  const statsRoutes = require("../src/routes/statsRoutes");
  const app = express();
  app.use("/api", statsRoutes);

  setEnv({ NODE_ENV: "development", GAMES_PUBLIC_URL: GAMES_URL, GAME_BRIDGE_SECRET: SECRET });
  let response = await fetchFromApp(app, "/api/features");
  let payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.data.strangerDiscovery, true);
  assert.equal(payload.data.games, true);

  setEnv({ NODE_ENV: "development" });
  response = await fetchFromApp(app, "/api/features");
  payload = await response.json();
  assert.equal(payload.data.strangerDiscovery, true);
  assert.equal(payload.data.games, false);
});
