const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  migrate,
  INDEX_NAME,
  INDEX_KEY,
} = require("../scripts/migrate-group-reports");
function fixture({ invalid = 0, duplicates = 0 } = {}) {
  const events = [],
    indexes = [
      {
        name: "legacy",
        key: { reporterUserId: 1, encounterId: 1, targetSquadId: 1 },
        unique: true,
      },
    ];
  let missing = 4;
  const collection = {
    listIndexes: () => ({ toArray: async () => [...indexes] }),
    countDocuments: async () => missing,
    aggregate: (pipeline) => ({
      toArray: async () => [
        { count: pipeline.some((p) => p.$group) ? duplicates : invalid },
      ],
    }),
    async updateMany() {
      events.push("backfill");
      missing = 0;
    },
    async createIndex(key, options) {
      events.push("create");
      if (!indexes.some((i) => i.name === INDEX_NAME))
        indexes.push({ key, ...options });
    },
    async dropIndex(name) {
      events.push("drop");
      assert(indexes.some((i) => i.name === INDEX_NAME && i.unique));
      indexes.splice(
        indexes.findIndex((i) => i.name === name),
        1,
      );
    },
  };
  return { collection, events, indexes };
}
test("report migration dry run reads without changing data or indexes", async () => {
  const f = fixture();
  const result = await migrate(f.collection);
  assert.equal(result.mode, "dry-run");
  assert.equal(result.backfill, 4);
  assert.deepEqual(f.events, []);
  assert.equal(f.indexes.length, 1);
});
test("report migration verifies replacement before old index removal and can run again", async () => {
  const f = fixture();
  const first = await migrate(f.collection, { apply: true });
  assert.equal(first.removedLegacyIndexes, 1);
  assert.deepEqual(f.events, ["backfill", "create", "drop"]);
  assert.deepEqual(f.indexes[0].key, INDEX_KEY);
  const second = await migrate(f.collection, { apply: true });
  assert.equal(second.backfill, 0);
  assert.equal(second.removedLegacyIndexes, 0);
});
test("invalid or duplicate report data retains old indexes and makes no writes", async () => {
  for (const data of [{ invalid: 1 }, { duplicates: 1 }]) {
    const f = fixture(data);
    await assert.rejects(
      migrate(f.collection, { apply: true }),
      /No indexes were removed/,
    );
    assert.deepEqual(f.events, []);
  }
});
