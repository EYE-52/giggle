// Moves legacy inline squad covers (base64 data URLs inside squad documents)
// into coverStorage and leaves a short "upload:<key>" reference on the squad.
// Lives in src/ because the server runs it after boot; scripts/ is excluded
// from the deployed image (.dockerignore). CLI: scripts/migrate-squad-covers.js.
//
// Idempotent: migrated squads no longer match, and storing the same bytes
// again reuses the same key. Each squad is updated only if its cover is still
// the data URL that was read, so a cover changed mid-run is never overwritten.
const { decodeCoverDataUrl, uploadCoverRef } = require("../utils/squadCovers");

const LEGACY_COVER_FILTER = /^data:/i;
const DEFAULT_BATCH_SIZE = 20; // data URLs are up to ~2 MB each

async function migrateSquadCovers({
  Squad = require("../models/Squad").Squad,
  storage = require("./coverStorage"),
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

module.exports = { migrateSquadCovers, DEFAULT_BATCH_SIZE };
