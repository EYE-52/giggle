process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.ENABLE_REQUEST_LOGS = "false";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");
const { Binary } = require("mongoose").mongo;

const coverStorage = require("../src/services/coverStorage");
const { SquadCover } = require("../src/models/SquadCover");
const { migrateSquadCovers, parseArgs } = require("../scripts/migrate-squad-covers");

const SQUAD_ID = "sq_1727000000000_abc123xyz0";
const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;
const sha16 = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);

// Minimal in-memory stand-in for the SquadCover model (the Mongo backend's
// only dependency). Lean reads return BSON Binary, as the driver does.
function fakeCoverModel({ failUpsertWith } = {}) {
  const rows = new Map();
  const calls = [];
  return {
    rows,
    calls,
    async updateOne(filter, update, options) {
      calls.push(["updateOne", filter, options]);
      if (failUpsertWith) throw failUpsertWith;
      const existing = rows.get(filter.key);
      rows.set(filter.key, existing ? { ...existing, ...update.$set } : { ...update.$setOnInsert, ...update.$set });
    },
    findOne(filter) {
      calls.push(["findOne", filter]);
      const chain = {
        select(projection) {
          calls.push(["select", projection]);
          return chain;
        },
        async lean() {
          const row = rows.get(filter.key);
          return row ? { contentType: row.contentType, bytes: new Binary(row.bytes) } : null;
        },
      };
      return chain;
    },
    async deleteOne(filter) {
      calls.push(["deleteOne", filter]);
      rows.delete(filter.key);
    },
    async deleteMany(filter) {
      calls.push(["deleteMany", filter]);
      for (const [key, row] of rows) if (row.squadId === filter.squadId) rows.delete(key);
    },
  };
}

test("cover keys are `${squadId}/${first 16 hex of sha256(bytes)}`", () => {
  const key = coverStorage.coverKeyFor({ squadId: SQUAD_ID, bytes: PNG_BYTES });
  assert.equal(key, `${SQUAD_ID}/${sha16(PNG_BYTES)}`);
  assert.match(key, coverStorage.COVER_KEY_PATTERN);
  assert.deepEqual(coverStorage.parseCoverKey(key), { squadId: SQUAD_ID, hash: sha16(PNG_BYTES) });
  for (const bad of [null, 42, {}, "", SQUAD_ID, `${SQUAD_ID}/`, `${SQUAD_ID}/ABCDEF0123456789`, `../x/${sha16(PNG_BYTES)}`, `a/b/${sha16(PNG_BYTES)}`]) {
    assert.equal(coverStorage.parseCoverKey(bad), null, String(bad));
  }
});

test("mongo cover storage puts, gets and deletes covers by key", async () => {
  const model = fakeCoverModel();
  const storage = coverStorage.createMongoCoverStorage({ model });

  const { key } = await storage.putCover({ squadId: SQUAD_ID, contentType: "image/png", bytes: PNG_BYTES });
  assert.equal(key, `${SQUAD_ID}/${sha16(PNG_BYTES)}`);
  const row = model.rows.get(key);
  assert.deepEqual(
    { key: row.key, squadId: row.squadId, contentType: row.contentType, size: row.size },
    { key, squadId: SQUAD_ID, contentType: "image/png", size: PNG_BYTES.length }
  );
  assert.ok(row.createdAt instanceof Date);
  assert.deepEqual(model.calls[0][2], { upsert: true });

  const cover = await storage.getCover(key);
  assert.equal(cover.contentType, "image/png");
  assert.equal(Buffer.isBuffer(cover.bytes), true);
  assert.deepEqual(cover.bytes, PNG_BYTES);
  assert.deepEqual(model.calls.find(([op]) => op === "select"), ["select", "contentType bytes"]);

  // Same bytes again: same key, still one row.
  assert.deepEqual(await storage.putCover({ squadId: SQUAD_ID, contentType: "image/png", bytes: PNG_BYTES }), { key });
  assert.equal(model.rows.size, 1);

  await storage.deleteCover(key);
  assert.equal(await storage.getCover(key), null);
  await storage.deleteCover(key); // deleting a missing key is fine
});

test("mongo cover storage ignores malformed keys instead of querying with them", async () => {
  const model = fakeCoverModel();
  const storage = coverStorage.createMongoCoverStorage({ model });
  assert.equal(await storage.getCover({ $gt: "" }), null);
  assert.equal(await storage.getCover("upload:whatever"), null);
  await storage.deleteCover({ $ne: null });
  await storage.deleteSquadCovers({ $ne: null });
  await storage.deleteSquadCovers("");
  assert.deepEqual(model.calls, []);
});

test("mongo cover storage validates put arguments and tolerates a lost upsert race", async () => {
  const storage = coverStorage.createMongoCoverStorage({ model: fakeCoverModel() });
  await assert.rejects(storage.putCover({ squadId: "a/b", contentType: "image/png", bytes: PNG_BYTES }), TypeError);
  await assert.rejects(storage.putCover({ squadId: SQUAD_ID, contentType: "", bytes: PNG_BYTES }), TypeError);
  await assert.rejects(storage.putCover({ squadId: SQUAD_ID, contentType: "image/png", bytes: "abc" }), TypeError);

  const duplicate = Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
  const racing = coverStorage.createMongoCoverStorage({ model: fakeCoverModel({ failUpsertWith: duplicate }) });
  assert.deepEqual(
    await racing.putCover({ squadId: SQUAD_ID, contentType: "image/png", bytes: PNG_BYTES }),
    { key: `${SQUAD_ID}/${sha16(PNG_BYTES)}` }
  );
  const failing = coverStorage.createMongoCoverStorage({ model: fakeCoverModel({ failUpsertWith: new Error("down") }) });
  await assert.rejects(failing.putCover({ squadId: SQUAD_ID, contentType: "image/png", bytes: PNG_BYTES }), /down/);
});

test("deleteSquadCovers removes every cover of one squad only", async () => {
  const model = fakeCoverModel();
  const storage = coverStorage.createMongoCoverStorage({ model });
  const other = "sq_1727000000001_other";
  const a = await storage.putCover({ squadId: SQUAD_ID, contentType: "image/png", bytes: PNG_BYTES });
  const b = await storage.putCover({ squadId: SQUAD_ID, contentType: "image/gif", bytes: Buffer.from("GIF89a") });
  const c = await storage.putCover({ squadId: other, contentType: "image/png", bytes: PNG_BYTES });
  assert.notEqual(a.key, c.key, "keys are per squad even for identical bytes");

  await storage.deleteSquadCovers(SQUAD_ID);
  assert.equal(await storage.getCover(a.key), null);
  assert.equal(await storage.getCover(b.key), null);
  assert.deepEqual((await storage.getCover(c.key)).bytes, PNG_BYTES);
});

test("the default storage is the Mongo backend on the SquadCover model; COVER_STORAGE selects it", async () => {
  assert.doesNotThrow(() => coverStorage.createCoverStorage({}));
  assert.doesNotThrow(() => coverStorage.createCoverStorage({ COVER_STORAGE: " Mongo " }));
  assert.throws(() => coverStorage.createCoverStorage({ COVER_STORAGE: "s3" }), /only "mongo" is implemented/);

  const original = SquadCover.findOne;
  const queries = [];
  SquadCover.findOne = (filter) => {
    queries.push(filter);
    const chain = { select: () => chain, lean: async () => ({ contentType: "image/png", bytes: new Binary(PNG_BYTES) }) };
    return chain;
  };
  try {
    const key = `${SQUAD_ID}/${sha16(PNG_BYTES)}`;
    assert.deepEqual(await coverStorage.getCover(key), { contentType: "image/png", bytes: PNG_BYTES });
    assert.deepEqual(queries, [{ key }]);
  } finally {
    SquadCover.findOne = original;
  }
});

// In-memory Squad model for the migration: find(...).select().sort().limit().lean(),
// updateOne (compare-and-set on coverImage) and findOne(...).select().lean().
function fakeSquadModel(squads) {
  const docs = squads.map((squad, index) => ({ _id: index + 1, ...squad }));
  const finds = [];
  const matches = (doc, filter) =>
    (!filter.coverImage || (typeof doc.coverImage === "string" && filter.coverImage.test(doc.coverImage))) &&
    (!filter._id?.$gt || doc._id > filter._id.$gt);
  return {
    docs,
    finds,
    find(filter) {
      finds.push(filter);
      let limit = Infinity;
      const chain = {
        select: () => chain,
        sort: () => chain,
        limit(value) {
          limit = value;
          return chain;
        },
        lean: async () => docs.filter((doc) => matches(doc, filter)).slice(0, limit).map((doc) => ({ ...doc })),
      };
      return chain;
    },
    async updateOne(filter, update) {
      const doc = docs.find((candidate) => candidate._id === filter._id && candidate.coverImage === filter.coverImage);
      if (!doc) return { modifiedCount: 0 };
      Object.assign(doc, update.$set);
      return { modifiedCount: 1 };
    },
    findOne(filter) {
      const chain = { select: () => chain, lean: async () => docs.find((doc) => doc._id === filter._id) || null };
      return chain;
    },
  };
}

test("migrateSquadCovers dry run counts legacy covers without writing", async () => {
  const Squad = fakeSquadModel([
    { squadId: SQUAD_ID, coverImage: PNG_DATA_URL },
    { squadId: "sq_1727000000002_preset", coverImage: "grad-aurora" },
    { squadId: "sq_1727000000003_svg", coverImage: "data:image/svg+xml;base64,PHN2Zy8+" },
    { squadId: "sq_1727000000004_none", coverImage: null },
  ]);
  const model = fakeCoverModel();
  const logs = [];
  const counts = await migrateSquadCovers({
    Squad,
    storage: coverStorage.createMongoCoverStorage({ model }),
    dryRun: true,
    log: (line) => logs.push(line),
  });
  assert.deepEqual(counts, { scanned: 2, migrated: 1, bytes: PNG_BYTES.length, unservable: 1, changedMeanwhile: 0, failed: 0 });
  assert.equal(model.rows.size, 0);
  assert.equal(Squad.docs[0].coverImage, PNG_DATA_URL);
  assert.ok(logs.some((line) => line.includes("sq_1727000000003_svg")));
});

test("migrateSquadCovers moves legacy covers to storage in batches and is idempotent", async () => {
  const legacy = Array.from({ length: 5 }, (_, index) => {
    const bytes = Buffer.concat([PNG_BYTES, Buffer.from([index])]);
    return { squadId: `sq_172700000001${index}_mig`, bytes, coverImage: `data:image/png;base64,${bytes.toString("base64")}` };
  });
  const Squad = fakeSquadModel([
    ...legacy.map(({ squadId, coverImage }) => ({ squadId, coverImage })),
    { squadId: "sq_1727000000020_preset", coverImage: "photo-hero" },
    { squadId: "sq_1727000000021_done", coverImage: `upload:sq_1727000000021_done/${sha16(PNG_BYTES)}` },
  ]);
  const model = fakeCoverModel();
  const storage = coverStorage.createMongoCoverStorage({ model });

  const counts = await migrateSquadCovers({ Squad, storage, batchSize: 2, log: () => {} });
  assert.deepEqual(counts, {
    scanned: 5, migrated: 5, bytes: legacy.reduce((sum, { bytes }) => sum + bytes.length, 0),
    unservable: 0, changedMeanwhile: 0, failed: 0,
  });
  assert.equal(Squad.finds.length, 4, "3 batches of <=2 plus the empty terminating read");
  for (const [index, { squadId, bytes }] of legacy.entries()) {
    const key = `${squadId}/${sha16(bytes)}`;
    assert.equal(Squad.docs[index].coverImage, `upload:${key}`);
    assert.deepEqual((await storage.getCover(key)).bytes, bytes);
  }
  assert.equal(Squad.docs[5].coverImage, "photo-hero");
  assert.equal(Squad.docs[6].coverImage, `upload:sq_1727000000021_done/${sha16(PNG_BYTES)}`);

  const again = await migrateSquadCovers({ Squad, storage, batchSize: 2, log: () => {} });
  assert.deepEqual(again, { scanned: 0, migrated: 0, bytes: 0, unservable: 0, changedMeanwhile: 0, failed: 0 });
  assert.equal(model.rows.size, 5);
});

test("migrateSquadCovers never overwrites a cover changed mid-run and keeps going after a failure", async () => {
  const other = Buffer.concat([PNG_BYTES, Buffer.from([9])]);
  const Squad = fakeSquadModel([
    { squadId: SQUAD_ID, coverImage: PNG_DATA_URL },
    { squadId: "sq_1727000000030_ok", coverImage: `data:image/png;base64,${other.toString("base64")}` },
  ]);
  const model = fakeCoverModel();
  const storage = coverStorage.createMongoCoverStorage({ model });
  const put = storage.putCover;
  let first = true;
  storage.putCover = async (args) => {
    const result = await put(args);
    // The leader picks a preset while the first squad is being migrated.
    if (first) Squad.docs[0].coverImage = "grad-neon";
    first = false;
    return result;
  };
  let counts = await migrateSquadCovers({ Squad, storage, log: () => {} });
  assert.deepEqual(
    { migrated: counts.migrated, changedMeanwhile: counts.changedMeanwhile, failed: counts.failed },
    { migrated: 1, changedMeanwhile: 1, failed: 0 }
  );
  assert.equal(Squad.docs[0].coverImage, "grad-neon");
  assert.equal(model.rows.has(`${SQUAD_ID}/${sha16(PNG_BYTES)}`), false, "the unused copy is removed");

  Squad.docs[0].coverImage = PNG_DATA_URL;
  storage.putCover = async () => { throw new Error("storage down"); };
  const logs = [];
  counts = await migrateSquadCovers({ Squad, storage, log: (line) => logs.push(line) });
  assert.equal(counts.failed, 1);
  assert.equal(Squad.docs[0].coverImage, PNG_DATA_URL);
  assert.ok(logs.some((line) => line.includes(`failed ${SQUAD_ID}: storage down`)));
});

test("migration CLI flags", () => {
  assert.deepEqual(parseArgs([]), { dryRun: false, batchSize: 20 });
  assert.deepEqual(parseArgs(["--dry-run", "--batch-size=50"]), { dryRun: true, batchSize: 50 });
  assert.throws(() => parseArgs(["--batch-size=0"]), /batch-size/);
  assert.throws(() => parseArgs(["--batch-size=abc"]), /batch-size/);
});
