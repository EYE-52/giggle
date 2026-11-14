#!/usr/bin/env node
// Default is read-only. Run --apply only during the approved release.
const INDEX_NAME = "report_scope_target_v1";
const INDEX_KEY = { scope: 1, scopeId: 1, reporterUserId: 1, targetKey: 1 };
const INDEX_OPTIONS = {
  unique: true,
  name: INDEX_NAME,
  partialFilterExpression: {
    scope: { $exists: true },
    scopeId: { $exists: true },
    targetKey: { $exists: true },
  },
};
const BACKFILL = {
  $or: [
    { scope: { $exists: false } },
    { scopeId: { $exists: false } },
    { targetKey: { $exists: false } },
  ],
};
const projection = {
  scope: { $ifNull: ["$scope", "encounter"] },
  scopeId: { $ifNull: ["$scopeId", "$encounterId"] },
  reporterUserId: "$reporterUserId",
  targetKey: { $ifNull: ["$targetKey", "$targetSquadId"] },
};
const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function inspect(collection) {
  const [indexes, missing, invalid, duplicates] = await Promise.all([
    collection.listIndexes().toArray(),
    collection.countDocuments(BACKFILL),
    collection
      .aggregate([
        { $project: projection },
        {
          $match: {
            $or: ["scopeId", "reporterUserId", "targetKey"].flatMap((key) => [
              { [key]: null },
              { [key]: "" },
            ]),
          },
        },
        { $count: "count" },
      ])
      .toArray(),
    collection
      .aggregate([
        { $project: projection },
        {
          $group: {
            _id: {
              scope: "$scope",
              scopeId: "$scopeId",
              reporterUserId: "$reporterUserId",
              targetKey: "$targetKey",
            },
            count: { $sum: 1 },
          },
        },
        { $match: { count: { $gt: 1 } } },
        { $count: "count" },
      ])
      .toArray(),
  ]);
  return {
    indexes,
    missing,
    invalid: invalid[0]?.count || 0,
    duplicates: duplicates[0]?.count || 0,
  };
}
async function migrate(collection, { apply = false } = {}) {
  const before = await inspect(collection);
  const summary = {
    mode: apply ? "apply" : "dry-run",
    backfill: before.missing,
    invalid: before.invalid,
    duplicateKeys: before.duplicates,
    replacementExists: before.indexes.some(
      (index) => index.name === INDEX_NAME,
    ),
  };
  if (!apply) {
    return summary;
  }
  if (before.invalid || before.duplicates) {
    throw Error(
      "Report data must be repaired before applying this migration. No indexes were removed.",
    );
  }
  await collection.updateMany(BACKFILL, [{ $set: projection }]);
  await collection.createIndex(INDEX_KEY, INDEX_OPTIONS);
  const indexes = await collection.listIndexes().toArray(),
    replacement = indexes.find((index) => index.name === INDEX_NAME);
  if (!replacement?.unique || !sameKey(replacement.key, INDEX_KEY)) {
    throw Error(
      "Replacement index verification failed. Old indexes were retained.",
    );
  }
  const legacy = indexes.filter((index) =>
    sameKey(index.key, { reporterUserId: 1, encounterId: 1, targetSquadId: 1 }),
  );
  for (const index of legacy) {
    await collection.dropIndex(index.name);
  }
  return { ...summary, removedLegacyIndexes: legacy.length };
}
module.exports = { migrate, inspect, INDEX_NAME, INDEX_KEY, INDEX_OPTIONS };
if (require.main === module) {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error("Set MONGODB_URI. No database was contacted.");
    process.exitCode = 1;
  } else {
    (async () => {
      const { MongoClient } = require("mongoose").mongo,
        client = new MongoClient(uri);
      try {
        await client.connect();
        console.log(
          JSON.stringify(
            await migrate(client.db().collection("safetyreports"), {
              apply: process.argv.includes("--apply"),
            }),
            null,
            2,
          ),
        );
      } finally {
        await client.close();
      }
    })().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
