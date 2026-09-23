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
const { SquadCover } = require("../src/models/SquadCover");
const { Binary } = require("mongoose").mongo;
const { redis, subClient } = require("../src/config/redisConfig");
const socketService = require("../src/services/socketService");
const { decodeCoverDataUrl, publicCoverImage, uploadCoverKey } = require("../src/utils/squadCovers");
const {
  disbandSquadHandler,
  discoverSquadsHandler,
  getSquadPreviewHandler,
  updateSquadCoverHandler,
} = require("../src/controllers/squadController");
const { buildAccountExport } = require("../src/controllers/accountController");
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
const PNG_KEY = `${SQUAD_ID}/${sha16(PNG_BYTES)}`;
const GIF_BYTES = Buffer.from("47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b", "hex");
const GIF_DATA_URL = `data:image/gif;base64,${GIF_BYTES.toString("base64")}`;

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

// In-memory SquadCover collection behind the real Mongo coverStorage backend.
// Lean reads return BSON Binary, as the driver does.
function stubSquadCoverCollection(initialRows = []) {
  const originals = {
    updateOne: SquadCover.updateOne,
    findOne: SquadCover.findOne,
    deleteOne: SquadCover.deleteOne,
    deleteMany: SquadCover.deleteMany,
  };
  const rows = new Map(initialRows.map((row) => [row.key, { ...row }]));
  const ops = [];
  SquadCover.updateOne = async (filter, update, options) => {
    ops.push(["updateOne", filter.key]);
    assert.deepEqual(options, { upsert: true });
    const existing = rows.get(filter.key);
    rows.set(filter.key, existing ? { ...existing, ...update.$set } : { ...update.$setOnInsert, ...update.$set });
    return { acknowledged: true };
  };
  SquadCover.findOne = (filter) => {
    ops.push(["findOne", filter.key]);
    const chain = {
      select: () => chain,
      lean: async () => {
        const row = rows.get(filter.key);
        return row ? { contentType: row.contentType, bytes: new Binary(row.bytes) } : null;
      },
    };
    return chain;
  };
  SquadCover.deleteOne = async (filter) => {
    ops.push(["deleteOne", filter.key]);
    return { deletedCount: rows.delete(filter.key) ? 1 : 0 };
  };
  SquadCover.deleteMany = async (filter) => {
    ops.push(["deleteMany", filter.squadId]);
    let deletedCount = 0;
    for (const [key, row] of rows) {
      if (row.squadId === filter.squadId) deletedCount += rows.delete(key) ? 1 : 0;
    }
    return { deletedCount };
  };
  return { rows, ops, restore: () => Object.assign(SquadCover, originals) };
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

test("publicCoverImage turns an upload reference into its cover URL without reading bytes", () => {
  const store = stubSquadCoverCollection();
  try {
    withEnv({ BACKEND_PUBLIC_URL: "https://api.example.com" }, () => {
      assert.equal(
        publicCoverImage({ squadId: SQUAD_ID, coverImage: `upload:${PNG_KEY}` }),
        `https://api.example.com/api/covers/${SQUAD_ID}/${sha16(PNG_BYTES)}`
      );
      for (const malformed of ["upload:", "upload:nokey", `upload:${SQUAD_ID}/XYZ`, `upload:${SQUAD_ID}/${sha16(PNG_BYTES)}/x`]) {
        assert.equal(publicCoverImage({ squadId: SQUAD_ID, coverImage: malformed }), null, malformed);
      }
      assert.equal(publicCoverImage({ coverImage: `upload:${PNG_KEY}` }), null);
    });
    assert.equal(uploadCoverKey(`upload:${PNG_KEY}`), PNG_KEY);
    assert.equal(uploadCoverKey(PNG_DATA_URL), null);
    assert.equal(uploadCoverKey("grad-aurora"), null);
    assert.deepEqual(store.ops, []);
  } finally {
    store.restore();
  }
});

test("GET /api/covers serves an upload-backed cover from coverStorage", async () => {
  const stub = stubSquadCoverLookup({ [SQUAD_ID]: { coverImage: `upload:${PNG_KEY}` } });
  const store = stubSquadCoverCollection([
    { key: PNG_KEY, squadId: SQUAD_ID, contentType: "image/png", bytes: PNG_BYTES, size: PNG_BYTES.length },
  ]);
  try {
    const { response, body } = await fetchFromApp(`/api/covers/${SQUAD_ID}/${sha16(PNG_BYTES)}`, {
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
    assert.deepEqual(store.ops, [["findOne", PNG_KEY]]);
  } finally {
    stub.restore();
    store.restore();
  }
});

test("GET /api/covers 404s for an upload-backed cover with a wrong hash, missing bytes or unsafe type", async () => {
  const missingSquadId = "sq_1727000000004_missing";
  const svgSquadId = "sq_1727000000005_svg";
  const svgKey = `${svgSquadId}/${sha16(Buffer.from("<svg/>"))}`;
  const stub = stubSquadCoverLookup({
    [SQUAD_ID]: { coverImage: `upload:${PNG_KEY}` },
    [missingSquadId]: { coverImage: `upload:${missingSquadId}/${sha16(PNG_BYTES)}` },
    [svgSquadId]: { coverImage: `upload:${svgKey}` },
  });
  const store = stubSquadCoverCollection([
    { key: PNG_KEY, squadId: SQUAD_ID, contentType: "image/png", bytes: PNG_BYTES, size: PNG_BYTES.length },
    { key: svgKey, squadId: svgSquadId, contentType: "image/svg+xml", bytes: Buffer.from("<svg/>"), size: 6 },
  ]);
  try {
    for (const requestPath of [
      `/api/covers/${SQUAD_ID}/${sha16(PNG_DATA_URL)}`,
      `/api/covers/${missingSquadId}/${sha16(PNG_BYTES)}`,
      `/api/covers/${svgSquadId}/${sha16(Buffer.from("<svg/>"))}`,
    ]) {
      const { response, body } = await fetchFromApp(requestPath);
      assert.equal(response.status, 404, requestPath);
      assert.equal(body.length, 0, requestPath);
      assert.equal(response.headers.get("cache-control"), "no-store", requestPath);
    }
    // The wrong hash is rejected before any storage read.
    assert.deepEqual(store.ops, [["findOne", `${missingSquadId}/${sha16(PNG_BYTES)}`], ["findOne", svgKey]]);
  } finally {
    stub.restore();
    store.restore();
  }
});

test("GET /api/covers still serves a legacy inline data URL cover (before migration)", async () => {
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

test("setting an uploaded cover stores its bytes in coverStorage and only a reference on the squad", async () => {
  const originalEmit = socketService.emitToSquad;
  const store = stubSquadCoverCollection();
  let saves = 0;
  const squad = { squadId: SQUAD_ID, coverImage: "grad-aurora", async save() { saves += 1; } };
  socketService.emitToSquad = () => {};

  try {
    await withEnv({ BACKEND_PUBLIC_URL: "https://api.example.com" }, async () => {
      const coverUrl = `https://api.example.com/api/covers/${SQUAD_ID}/${sha16(PNG_BYTES)}`;

      let res = createResponse();
      await updateSquadCoverHandler({ body: { coverImage: PNG_DATA_URL }, squadAccess: { squad } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data, { squadId: SQUAD_ID, coverImage: coverUrl });
      assert.equal(squad.coverImage, `upload:${PNG_KEY}`, "the squad stores a short reference");
      assert.equal(saves, 1);
      const row = store.rows.get(PNG_KEY);
      assert.deepEqual(
        { key: row.key, squadId: row.squadId, contentType: row.contentType, size: row.size },
        { key: PNG_KEY, squadId: SQUAD_ID, contentType: "image/png", size: PNG_BYTES.length }
      );
      assert.deepEqual(row.bytes, PNG_BYTES);

      // The picker echoes the current cover back when "Apply" is pressed unchanged.
      res = createResponse();
      await updateSquadCoverHandler({ body: { coverImage: coverUrl }, squadAccess: { squad } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data, { squadId: SQUAD_ID, coverImage: coverUrl });
      assert.equal(squad.coverImage, `upload:${PNG_KEY}`, "a self-referencing URL is never stored");
      assert.equal(saves, 1);

      // Re-uploading the same bytes keeps the (same) stored image.
      res = createResponse();
      await updateSquadCoverHandler({ body: { coverImage: PNG_DATA_URL }, squadAccess: { squad } }, res);
      assert.equal(res.body.data.coverImage, coverUrl);
      assert.equal(store.rows.has(PNG_KEY), true);
      assert.equal(store.ops.some(([op]) => op === "deleteOne"), false);

      // A new upload replaces the previous stored image.
      const gifKey = `${SQUAD_ID}/${sha16(GIF_BYTES)}`;
      res = createResponse();
      await updateSquadCoverHandler({ body: { coverImage: GIF_DATA_URL }, squadAccess: { squad } }, res);
      assert.equal(res.body.data.coverImage, `https://api.example.com/api/covers/${SQUAD_ID}/${sha16(GIF_BYTES)}`);
      assert.equal(squad.coverImage, `upload:${gifKey}`);
      assert.deepEqual([...store.rows.keys()], [gifKey]);

      // Switching to a preset deletes the uploaded image too.
      res = createResponse();
      await updateSquadCoverHandler({ body: { coverImage: "grad-neon" }, squadAccess: { squad } }, res);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.data, { squadId: SQUAD_ID, coverImage: "grad-neon" });
      assert.equal(squad.coverImage, "grad-neon");
      assert.equal(store.rows.size, 0);
      assert.equal(saves, 4);
    });
  } finally {
    socketService.emitToSquad = originalEmit;
    store.restore();
  }
});

test("setting a cover rejects storage references and non-raster data URLs from clients", async () => {
  const store = stubSquadCoverCollection();
  const squad = { squadId: SQUAD_ID, coverImage: "grad-aurora", async save() { throw new Error("no save"); } };
  try {
    for (const coverImage of [
      `upload:${PNG_KEY}`,
      "data:image/svg+xml;base64,PHN2Zy8+",
      `data:image/png;base64,${"A".repeat(2_000_001)}`,
    ]) {
      const res = createResponse();
      await updateSquadCoverHandler({ body: { coverImage }, squadAccess: { squad } }, res);
      assert.equal(res.statusCode, 400, coverImage.slice(0, 40));
      assert.equal(res.body.error.code, "INVALID_COVER_IMAGE");
    }
    assert.equal(squad.coverImage, "grad-aurora");
    assert.deepEqual(store.ops, []);
  } finally {
    store.restore();
  }
});

test("a failed cover save keeps the previous cover; replaced and orphaned images are cleaned up best effort", async () => {
  const originalEmit = socketService.emitToSquad;
  const originalError = console.error;
  const store = stubSquadCoverCollection([
    { key: PNG_KEY, squadId: SQUAD_ID, contentType: "image/png", bytes: PNG_BYTES, size: PNG_BYTES.length },
  ]);
  const gifKey = `${SQUAD_ID}/${sha16(GIF_BYTES)}`;
  socketService.emitToSquad = () => {};
  console.error = () => {};

  try {
    // Generic save failure: the write may have landed, so the new image stays.
    const squad = { squadId: SQUAD_ID, coverImage: `upload:${PNG_KEY}`, async save() { throw new Error("boom"); } };
    let res = createResponse();
    await updateSquadCoverHandler({ body: { coverImage: GIF_DATA_URL }, squadAccess: { squad } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(squad.coverImage, `upload:${PNG_KEY}`);
    assert.deepEqual([...store.rows.keys()].sort(), [PNG_KEY, gifKey].sort());

    // Squad deleted meanwhile: nothing can reference the new image.
    store.rows.delete(gifKey);
    squad.save = async () => {
      const error = new Error("No document found");
      error.name = "DocumentNotFoundError";
      throw error;
    };
    res = createResponse();
    await updateSquadCoverHandler({ body: { coverImage: GIF_DATA_URL }, squadAccess: { squad } }, res);
    assert.equal(res.statusCode, 500);
    assert.deepEqual([...store.rows.keys()], [PNG_KEY]);

    // Deleting the replaced image failing does not fail the update.
    SquadCover.deleteOne = async () => { throw new Error("storage down"); };
    squad.save = async () => {};
    res = createResponse();
    await updateSquadCoverHandler({ body: { coverImage: "grad-neon" }, squadAccess: { squad } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(squad.coverImage, "grad-neon");
  } finally {
    socketService.emitToSquad = originalEmit;
    console.error = originalError;
    store.restore();
  }
});

test("disbanding a squad deletes its stored covers, and storage failures never fail it", async () => {
  const originals = {
    revoke: socketService.revokeUserRealtimeAccess,
    emitUser: socketService.emitToUser,
    error: console.error,
  };
  const notifications = require("../src/models/Notification").Notification;
  const originalNotifications = { deleteMany: notifications.deleteMany, distinct: notifications.distinct };
  const store = stubSquadCoverCollection([
    { key: PNG_KEY, squadId: SQUAD_ID, contentType: "image/png", bytes: PNG_BYTES, size: PNG_BYTES.length },
    { key: `${SQUAD_ID}/0123456789abcdef`, squadId: SQUAD_ID, contentType: "image/png", bytes: PNG_BYTES, size: 1 },
    { key: "sq_1727000000009_other/0123456789abcdef", squadId: "sq_1727000000009_other", contentType: "image/png", bytes: PNG_BYTES, size: 1 },
  ]);
  socketService.revokeUserRealtimeAccess = () => {};
  socketService.emitToUser = () => {};
  notifications.deleteMany = async () => ({ deletedCount: 0 });
  notifications.distinct = async () => [];
  console.error = () => {};
  const disband = async () => {
    const res = createResponse();
    await disbandSquadHandler({
      squadAccess: {
        isLeader: true,
        squad: {
          squadId: SQUAD_ID,
          status: "idle",
          coverImage: `upload:${PNG_KEY}`,
          members: [{ memberId: "m1", userId: LEADER_ID, role: "leader" }],
          deleteOne: async () => {},
        },
      },
    }, res);
    return res;
  };

  try {
    let res = await disband();
    assert.equal(res.statusCode, 200);
    assert.deepEqual([...store.rows.keys()], ["sq_1727000000009_other/0123456789abcdef"]);

    SquadCover.deleteMany = async () => { throw new Error("storage down"); };
    res = await disband();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.disbanded, true);
  } finally {
    socketService.revokeUserRealtimeAccess = originals.revoke;
    socketService.emitToUser = originals.emitUser;
    console.error = originals.error;
    Object.assign(notifications, originalNotifications);
    store.restore();
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
  const store = stubSquadCoverCollection();

  try {
    await withEnv({ BACKEND_PUBLIC_URL: "https://api.example.com", STRANGER_DISCOVERY_ENABLED: "true" }, async () => {
      for (const [stored, hash] of [[`upload:${PNG_KEY}`, sha16(PNG_BYTES)], [PNG_DATA_URL, sha16(PNG_DATA_URL)]]) {
        squad.coverImage = stored;
        const coverUrl = `https://api.example.com/api/covers/${SQUAD_ID}/${hash}`;

        let res = createResponse();
        await getSquadPreviewHandler({ params: { squadId: SQUAD_ID }, user: { userId: VIEWER_ID } }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.data.coverImage, coverUrl);
        assert.equal(JSON.stringify(res.body).includes("base64"), false);
        assert.equal(JSON.stringify(res.body).includes("upload:"), false);

        res = createResponse();
        await discoverSquadsHandler({ user: { userId: VIEWER_ID } }, res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body.data.squads.map((s) => s.coverImage), [coverUrl]);
        assert.equal(JSON.stringify(res.body).includes("base64"), false);
      }
      assert.deepEqual(store.ops, [], "listing squads never reads cover bytes");
    });
  } finally {
    store.restore();
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

test("client-facing squad responses never serialize the raw stored cover; the data export resolves it", () => {
  const read = (relativePath) => readFileSync(path.join(__dirname, "..", relativePath), "utf8");
  const squadController = read("src/controllers/squadController.js");
  const matchmakingController = read("src/controllers/matchmakingController.js");
  const accountController = read("src/controllers/accountController.js");
  const server = read("src/server.js");

  for (const source of [squadController, matchmakingController]) {
    assert.doesNotMatch(source, /[Cc]over(?:Image)?: squad[AB]?\??\.coverImage/);
  }
  assert.equal((squadController.match(/coverImage: publicCoverImage\(squad\)/g) || []).length, 5);
  assert.equal(accountController.includes("coverImage: coverImages[index],"), true);
  // Mounted without auth middleware.
  assert.equal(server.includes('app.use("/api", coverRoutes);'), true);
  assert.equal(read("src/routes/coverRoutes.js").includes('router.get("/covers/:squadId/:hash", getSquadCoverImageHandler);'), true);
});

test("the account export carries an uploaded cover as the image itself, not the storage reference", async () => {
  const userId = LEADER_ID;
  const squads = [
    { squadId: SQUAD_ID, coverImage: `upload:${PNG_KEY}`, members: [] },
    { squadId: "sq_1727000000006_legacy", coverImage: PNG_DATA_URL, members: [] },
    { squadId: "sq_1727000000007_preset", coverImage: "grad-aurora", members: [] },
    { squadId: "sq_1727000000008_gone", coverImage: "upload:sq_1727000000008_gone/0123456789abcdef", members: [] },
  ];
  const reads = [];
  const exported = await buildAccountExport(userId, {
    User: { findById: async () => ({ _id: userId, friends: [], blockedUserIds: [] }), find: async () => [] },
    Squad: { find: async () => squads },
    Notification: { find: async () => [] },
    SafetyReport: { find: async () => [] },
    getCover: async (key) => {
      reads.push(key);
      return key === PNG_KEY ? { contentType: "image/png", bytes: PNG_BYTES } : null;
    },
  });
  assert.deepEqual(exported.squads.map((squad) => squad.coverImage), [PNG_DATA_URL, PNG_DATA_URL, "grad-aurora", null]);
  assert.deepEqual(reads, [PNG_KEY, "sq_1727000000008_gone/0123456789abcdef"]);
});
