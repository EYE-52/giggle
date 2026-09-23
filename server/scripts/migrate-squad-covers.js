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
const { migrateSquadCovers, DEFAULT_BATCH_SIZE } = require("../src/services/coverMigration");

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
