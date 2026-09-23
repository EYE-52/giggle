// Env must be set before any src module (appConfig reads it at load time).
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/giggle-test";
process.env.ENABLE_REQUEST_LOGS = "false";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { after, test } = require("node:test");

const User = require("../src/models/User");
const { Squad } = require("../src/models/Squad");
const { redis, subClient } = require("../src/config/redisConfig");
const socketService = require("../src/services/socketService");
const { decodeCoverDataUrl, publicCoverImage } = require("../src/utils/squadCovers");
const {
  discoverSquadsHandler,
  getSquadPreviewHandler,
  updateSquadCoverHandler,
} = require("../src/controllers/squadController");
const { app } = require("../src/server");

after(() => {
  // quit() waits for a connection that does not exist in unit-test runs.
  redis.disconnect();
  subClient.disconnect();
});

const SQUAD_ID = "sq_1727000000000_abc123xyz0";
const LEADER_ID = "507f1f77bcf86cd799439011";
const VIEWER_ID = "507f1f77bcf86cd799439012";
const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
const sha16 = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);

function withEnv(values, fn) {
  const originals = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = fn();
    if (result && typeof result.then === "function") return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

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

async function fetchFromApp(requestPath, init) {
  const testServer = http.createServer(app);
  await new Promise((resolve, reject) => {
    testServer.once("error", reject);
    testServer.listen(0, "127.0.0.1", resolve);
  });
  const { port } = testServer.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${requestPath}`, init);
    const body = Buffer.from(await response.arrayBuffer());
    return { response, body };
  } finally {
    await new Promise((resolve, reject) => {
      testServer.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

// Squad.findOne(...).select(...).lean() double recording the lookups.
function stubSquadCoverLookup(squadsById) {
  const original = Squad.findOne;
  const calls = [];
  Squad.findOne = (query) => {
    const call = { query, projection: undefined, lean: false };
    calls.push(call);
    const chain = {
      select(projection) {
        call.projection = projection;
        return chain;
      },
      async lean() {
        call.lean = true;
        const squad = squadsById[query.squadId];
        return squad ? { _id: "x", coverImage: squad.coverImage } : null;
      },
    };
    return chain;
  };
  return { calls, restore: () => { Squad.findOne = original; } };
}

test("publicCoverImage passes presets, https URLs and missing covers through unchanged", () => {
  assert.equal(publicCoverImage({ squadId: SQUAD_ID, coverImage: "grad-aurora" }), "grad-aurora");
  assert.equal(publicCoverImage({ squadId: SQUAD_ID, coverImage: "photo-hero" }), "photo-hero");
  assert.equal(
    publicCoverImage({ squadId: SQUAD_ID, coverImage: "https://cdn.example.com/cover.jpg" }),
    "https://cdn.example.com/cover.jpg"
  );
  assert.equal(publicCoverImage({ squadId: SQUAD_ID, coverImage: null }), null);
  assert.equal(publicCoverImage({ squadId: SQUAD_ID }), null);
  assert.equal(publicCoverImage(null), null);
  assert.equal(publicCoverImage(undefined), null);
});

test("publicCoverImage turns an uploaded data URL into its content-addressed cover URL", () => {
  withEnv({ BACKEND_PUBLIC_URL: "https://api.example.com/" }, () => {
    const url = publicCoverImage({ squadId: SQUAD_ID, coverImage: PNG_DATA_URL });
    assert.equal(url, `https://api.example.com/api/covers/${SQUAD_ID}/${sha16(PNG_DATA_URL)}`);
    assert.match(url, /\/[a-f0-9]{16}$/);

    const changed = publicCoverImage({ squadId: SQUAD_ID, coverImage: `${PNG_DATA_URL}AAAA` });
    assert.notEqual(changed, url, "a new cover gets a new (cache-busting) URL");
  });

  withEnv({ BACKEND_PUBLIC_URL: undefined, PORT: "3001" }, () => {
    assert.equal(
      publicCoverImage({ squadId: SQUAD_ID, coverImage: PNG_DATA_URL }),
      `http://localhost:3001/api/covers/${SQUAD_ID}/${sha16(PNG_DATA_URL)}`
    );
  });
});

test("publicCoverImage never inlines a data URL it cannot serve", () => {
  assert.equal(
    publicCoverImage({ squadId: SQUAD_ID, coverImage: "data:image/svg+xml;base64,PHN2Zy8+" }),
    null
  );
  assert.equal(publicCoverImage({ squadId: SQUAD_ID, coverImage: "data:text/html;base64,PGI+" }), null);
  assert.equal(publicCoverImage({ coverImage: PNG_DATA_URL }), null);
});

test("cover data URLs decode to their bytes with a normalized content type", () => {
  assert.deepEqual(decodeCoverDataUrl(PNG_DATA_URL), { contentType: "image/png", body: PNG_BYTES });
  assert.equal(decodeCoverDataUrl("data:image/jpg;base64,/9j/").contentType, "image/jpeg");
  assert.equal(decodeCoverDataUrl("data:IMAGE/WEBP;base64,UklG").contentType, "image/webp");
  assert.equal(decodeCoverDataUrl("data:image/svg+xml;base64,PHN2Zy8+"), null);
  assert.equal(decodeCoverDataUrl("grad-aurora"), null);
  assert.equal(decodeCoverDataUrl(null), null);
});

test("GET /api/covers serves a matching uploaded cover publicly with immutable caching", async () => {
  const stub = stubSquadCoverLookup({ [SQUAD_ID]: { coverImage: PNG_DATA_URL } });
  try {
    // No Authorization header: CSS backgrounds can't send one.
    const { response, body } = await fetchFromApp(`/api/covers/${SQUAD_ID}/${sha16(PNG_DATA_URL)}`, {
      headers: { Origin: "http://localhost:3000" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(body, PNG_BYTES);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("cross-origin-resource-policy"), "cross-origin");
    assert.deepEqual(stub.calls.map((call) => [call.query, call.projection, call.lean]), [
      [{ squadId: SQUAD_ID }, "coverImage", true],
    ]);
  } finally {
    stub.restore();
  }
});

test("GET /api/covers 404s without details for a wrong hash, preset cover or unknown squad", async () => {
  const presetSquadId = "sq_1727000000001_preset";
  const stub = stubSquadCoverLookup({
    [SQUAD_ID]: { coverImage: PNG_DATA_URL },
    [presetSquadId]: { coverImage: "grad-aurora" },
  });
  try {
    for (const requestPath of [
      `/api/covers/${SQUAD_ID}/${sha16(`${PNG_DATA_URL}x`)}`,
      `/api/covers/${presetSquadId}/${sha16("grad-aurora")}`,
      `/api/covers/sq_1727000000002_missing/${sha16(PNG_DATA_URL)}`,
    ]) {
      const { response, body } = await fetchFromApp(requestPath);
      assert.equal(response.status, 404, requestPath);
      assert.equal(body.length, 0, requestPath);
      assert.notEqual(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    }
    assert.equal(stub.calls.length, 3);
  } finally {
    stub.restore();
  }
});

test("GET /api/covers rejects malformed ids and hashes before any lookup", async () => {
  const stub = stubSquadCoverLookup({ [SQUAD_ID]: { coverImage: PNG_DATA_URL } });
  const hash = sha16(PNG_DATA_URL);
  try {
    for (const requestPath of [
      `/api/covers/${SQUAD_ID}/${hash.toUpperCase()}`,
      `/api/covers/${SQUAD_ID}/${hash.slice(0, 15)}`,
      `/api/covers/${SQUAD_ID}/${hash}0`,
      `/api/covers/not-a-squad/${hash}`,
      `/api/covers/${encodeURIComponent('{"$gt":""}')}/${hash}`,
    ]) {
      const { response, body } = await fetchFromApp(requestPath);
      assert.equal(response.status, 404, requestPath);
      assert.equal(body.length, 0, requestPath);
    }
    assert.equal(stub.calls.length, 0);
  } finally {
    stub.restore();
  }
});

test("setting an uploaded cover responds with its URL and re-applying that URL keeps the image", async () => {
  const originalEmit = socketService.emitToSquad;
  let saves = 0;
  const squad = { squadId: SQUAD_ID, coverImage: "grad-aurora", async save() { saves += 1; } };
  socketService.emitToSquad = () => {};

  try {
    await withEnv({ BACKEND_PUBLIC_URL: "https://api.example.com" }, async () => {
      const coverUrl = `https://api.example.com/api/covers/${SQUAD_ID}/${sha16(PNG_DATA_URL)}`;

      let res = createResponse();
      await updateSquadCoverHandler({ body: { coverImage: PNG_DATA_URL }, squadAccess: { squad } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data, { squadId: SQUAD_ID, coverImage: coverUrl });
      assert.equal(squad.coverImage, PNG_DATA_URL, "storage keeps the data URL");
      assert.equal(saves, 1);

      // The picker echoes the current cover back when "Apply" is pressed unchanged.
      res = createResponse();
      await updateSquadCoverHandler({ body: { coverImage: coverUrl }, squadAccess: { squad } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data, { squadId: SQUAD_ID, coverImage: coverUrl });
      assert.equal(squad.coverImage, PNG_DATA_URL, "a self-referencing URL is never stored");
      assert.equal(saves, 1);

      res = createResponse();
      await updateSquadCoverHandler({ body: { coverImage: "grad-neon" }, squadAccess: { squad } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data, { squadId: SQUAD_ID, coverImage: "grad-neon" });
      assert.equal(saves, 2);
    });
  } finally {
    socketService.emitToSquad = originalEmit;
  }
});

test("squad preview and discovery send uploaded covers as URLs, not image data", async () => {
  const originals = { find: Squad.find, findOne: Squad.findOne, userFind: User.find, findById: User.findById };
  const squad = {
    squadId: SQUAD_ID,
    squadName: "Night Owls",
    status: "idle",
    visibility: "open",
    joinPolicy: "open",
    tags: [],
    coverImage: PNG_DATA_URL,
    members: [{ memberId: "mem_leader", userId: LEADER_ID, role: "leader", displayName: "Leader" }],
  };
  const users = [{ _id: LEADER_ID, blockedUserIds: [] }, { _id: VIEWER_ID, blockedUserIds: [] }];
  Squad.find = () => ({ sort() { return this; }, limit: async () => [squad] });
  Squad.findOne = async () => squad;
  User.find = () => {
    const chain = { select: () => chain, lean: async () => users };
    return chain;
  };
  User.findById = async () => ({ isPremium: false });

  try {
    await withEnv({ BACKEND_PUBLIC_URL: "https://api.example.com", STRANGER_DISCOVERY_ENABLED: "true" }, async () => {
      const coverUrl = `https://api.example.com/api/covers/${SQUAD_ID}/${sha16(PNG_DATA_URL)}`;

      let res = createResponse();
      await getSquadPreviewHandler({ params: { squadId: SQUAD_ID }, user: { userId: VIEWER_ID } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.coverImage, coverUrl);
      assert.equal(JSON.stringify(res.body).includes("base64"), false);

      res = createResponse();
      await discoverSquadsHandler({ user: { userId: VIEWER_ID } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data.squads.map((s) => s.coverImage), [coverUrl]);
      assert.equal(JSON.stringify(res.body).includes("base64"), false);
    });
  } finally {
    Squad.find = originals.find;
    Squad.findOne = originals.findOne;
    User.find = originals.userFind;
    User.findById = originals.findById;
  }
});

test("encounter handoff sends squad covers as URLs or preset ids", async () => {
  const controllerPath = require.resolve("../src/controllers/matchmakingController");
  const servicePath = require.resolve("../src/services/matchmakingService");
  const originalServiceModule = require.cache[servicePath];
  const originals = { find: User.find, findOne: Squad.findOne };
  const encounter = {
    encounterId: "enc_cover",
    squadAId: SQUAD_ID,
    squadBId: "sq_1727000000003_other",
    status: "active",
    ackBySquad: new Map(),
  };
  const squadA = {
    squadId: SQUAD_ID,
    squadName: "A",
    coverImage: PNG_DATA_URL,
    members: [{ memberId: "a1", userId: LEADER_ID, displayName: "Leader", role: "leader" }],
  };
  const squadB = {
    squadId: encounter.squadBId,
    squadName: "B",
    coverImage: "photo-hero",
    members: [{ memberId: "b1", userId: VIEWER_ID, displayName: "Other", role: "leader" }],
  };
  User.find = () => {
    const chain = { select: () => chain, lean: async () => [] };
    return chain;
  };
  Squad.findOne = async ({ squadId }) => (squadId === SQUAD_ID ? squadA : squadB);
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

  try {
    await withEnv({ BACKEND_PUBLIC_URL: "https://api.example.com" }, async () => {
      const { getEncounterHandoffHandler } = require(controllerPath);
      const res = createResponse();
      await getEncounterHandoffHandler({ params: { encounterId: "enc_cover" }, user: { userId: LEADER_ID } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.data.squadACover, `https://api.example.com/api/covers/${SQUAD_ID}/${sha16(PNG_DATA_URL)}`);
      assert.equal(res.body.data.squadBCover, "photo-hero");
    });
  } finally {
    User.find = originals.find;
    Squad.findOne = originals.findOne;
    if (originalServiceModule) require.cache[servicePath] = originalServiceModule;
    else delete require.cache[servicePath];
    delete require.cache[controllerPath];
  }
});

test("client-facing squad responses never serialize the raw stored cover; the data export does", () => {
  const read = (relativePath) => readFileSync(path.join(__dirname, "..", relativePath), "utf8");
  const squadController = read("src/controllers/squadController.js");
  const matchmakingController = read("src/controllers/matchmakingController.js");
  const accountController = read("src/controllers/accountController.js");
  const server = read("src/server.js");

  for (const source of [squadController, matchmakingController]) {
    assert.doesNotMatch(source, /[Cc]over(?:Image)?: squad[AB]?\??\.coverImage/);
  }
  assert.equal((squadController.match(/coverImage: publicCoverImage\(squad\)/g) || []).length, 5);
  assert.equal(accountController.includes("coverImage: squad.coverImage ?? null,"), true);
  // Mounted without auth middleware.
  assert.equal(server.includes('app.use("/api", coverRoutes);'), true);
  assert.equal(read("src/routes/coverRoutes.js").includes('router.get("/covers/:squadId/:hash", getSquadCoverImageHandler);'), true);
});
