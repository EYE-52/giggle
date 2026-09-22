// Moves legacy inline squad covers (base64 data URLs inside squad documents)
// into coverStorage and leaves a short "upload:<key>" reference on the squad.
//
//   npm run migrate:covers -- --dry-run          # count only, writes nothing
//   npm run migrate:covers                       # migrate
//   npm run migrate:covers -- --batch-size=50    # default 20 squads per batch
//
// Needs MONGODB_URI (and MONGODB_DB_NAME when the server uses it), e.g.
// `railway run npm run migrate:covers` or
// `node --env-file=.env.local scripts/migrate-squad-covers.js --dry-run`.
//
// Idempotent: migrated squads no longer match, and storing the same bytes
// again reuses the same key. Each squad is updated only if its cover is still
// the data URL that was read, so a cover changed mid-run is never overwritten.
if (require.main === module) require("dotenv").config(); // before src/ reads env
const mongoose = require("mongoose");
const { decodeCoverDataUrl, uploadCoverRef } = require("../src/utils/squadCovers");

const LEGACY_COVER_FILTER = /^data:/i;
const DEFAULT_BATCH_SIZE = 20; // data URLs are up to ~2 MB each

async function migrateSquadCovers({
  Squad = require("../src/models/Squad").Squad,
  storage = require("../src/services/coverStorage"),
  dryRun = false,
  batchSize = DEFAULT_BATCH_SIZE,
  log = console.log,
} = {}) {
  const counts = {
    scanned: 0,
    migrated: 0, // in a dry run: would migrate
    bytes: 0,
    unservable: 0, // non-raster/malformed data URLs; never served, left as-is
    changedMeanwhile: 0,
    failed: 0,
  };
  const unservableSquadIds = [];
  let lastId = null;

  for (;;) {
    const filter = { coverImage: LEGACY_COVER_FILTER };
    if (lastId !== null) filter._id = { $gt: lastId };
    const batch = await Squad.find(filter)
      .select("_id squadId coverImage")
      .sort({ _id: 1 })
      .limit(batchSize)
      .lean();
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]._id;

    for (const squad of batch) {
      counts.scanned += 1;
      const upload = decodeCoverDataUrl(squad.coverImage);
      if (!upload || !squad.squadId) {
        counts.unservable += 1;
        unservableSquadIds.push(squad.squadId || String(squad._id));
        continue;
      }
      if (dryRun) {
        counts.migrated += 1;
        counts.bytes += upload.body.length;
        continue;
      }

      try {
        const { key } = await storage.putCover({
          squadId: squad.squadId,
          contentType: upload.contentType,
          bytes: upload.body,
        });
        const result = await Squad.updateOne(
          { _id: squad._id, coverImage: squad.coverImage },
          { $set: { coverImage: uploadCoverRef(key) } }
        );
        if (result.modifiedCount === 1) {
          counts.migrated += 1;
          counts.bytes += upload.body.length;
        } else {
          // Re-covered or deleted since it was read: the stored copy is unused
          // unless the squad now points at the same bytes.
          counts.changedMeanwhile += 1;
          const current = await Squad.findOne({ _id: squad._id }).select("coverImage").lean();
          if (current?.coverImage !== uploadCoverRef(key)) await storage.deleteCover(key);
        }
      } catch (error) {
        counts.failed += 1;
        log(`  failed ${squad.squadId}: ${error.message}`);
      }
    }
    log(`${dryRun ? "[dry run] " : ""}scanned ${counts.scanned}, ${dryRun ? "would migrate" : "migrated"} ${counts.migrated}`);
  }

  if (unservableSquadIds.length) {
    log(`left ${unservableSquadIds.length} unservable data URL cover(s) untouched: ${unservableSquadIds.slice(0, 20).join(", ")}`);
  }
  return counts;
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const batchArg = argv.find((arg) => arg.startsWith("--batch-size="));
  const batchSize = batchArg ? Number(batchArg.split("=")[1]) : DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("--batch-size must be an integer between 1 and 500");
  }
  return { dryRun, batchSize };
}

async function main(argv = process.argv.slice(2)) {
  const { dryRun, batchSize } = parseArgs(argv);
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");
  const dbName = process.env.MONGODB_DB_NAME;
  await mongoose.connect(uri, dbName ? { dbName } : undefined);
  try {
    // The unique key index must exist before any upsert.
    if (!dryRun) await require("../src/models/SquadCover").SquadCover.init();
    const counts = await migrateSquadCovers({ dryRun, batchSize });
    console.log(`${dryRun ? "DRY RUN " : ""}done:`, counts);
    return counts.failed ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { migrateSquadCovers, parseArgs };
