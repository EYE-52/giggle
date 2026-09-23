const crypto = require("crypto");

// Storage for uploaded squad cover images.
//
// Squad documents never hold image bytes; they hold `coverImage:
// "upload:<key>"` and the bytes live behind this module. Controllers, the
// cover route and scripts only use the functions exported at the bottom, so a
// different backend (S3, R2, ...) can replace the Mongo one without touching
// them.
//
// Backend interface. Every backend implements exactly these, all async:
//
//   putCover({ squadId, contentType, bytes: Buffer }) -> { key }
//     Stores the image and returns its key. The key MUST be
//     coverKeyFor({ squadId, bytes }), i.e. `${squadId}/${16 hex}`: the cover
//     URL carries that hash, so publicCoverImage builds URLs without reading
//     bytes. Idempotent: storing the same bytes again returns the same key.
//   getCover(key) -> { contentType, bytes: Buffer } | null
//     null when the key is malformed or nothing is stored under it.
//   deleteCover(key) -> void
//     Removing a missing key is not an error.
//   deleteSquadCovers(squadId) -> void
//     Removes every cover stored for the squad (in S3: the `${squadId}/`
//     prefix). Used when a squad is deleted, which also clears orphans left by
//     a failed best-effort deleteCover.
//
// The backend is chosen with COVER_STORAGE (default "mongo"). Only "mongo" is
// implemented; an S3/R2 backend would be COVER_STORAGE=s3 plus its bucket
// settings, followed by a copy of the existing rows (see
// scripts/migrate-squad-covers.js for the squad-side migration pattern).

const COVER_KEY_PATTERN = /^([A-Za-z0-9_-]{1,64})\/([a-f0-9]{16})$/;

function coverBytesHash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

function coverKeyFor({ squadId, bytes }) {
  return `${squadId}/${coverBytesHash(bytes)}`;
}

// { squadId, hash } for a well-formed key, else null.
function parseCoverKey(key) {
  if (typeof key !== "string") return null;
  const match = COVER_KEY_PATTERN.exec(key);
  return match ? { squadId: match[1], hash: match[2] } : null;
}

function assertPutArgs({ squadId, contentType, bytes } = {}) {
  if (typeof squadId !== "string" || !parseCoverKey(`${squadId}/0000000000000000`)) {
    throw new TypeError("putCover: invalid squadId");
  }
  if (typeof contentType !== "string" || !contentType) {
    throw new TypeError("putCover: contentType is required");
  }
  if (!Buffer.isBuffer(bytes)) throw new TypeError("putCover: bytes must be a Buffer");
}

// Lean reads return BSON Binary for Buffer fields.
function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value && value._bsontype === "Binary") {
    return Buffer.from(value.buffer.buffer, value.buffer.byteOffset, value.position);
  }
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function createMongoCoverStorage({ model } = {}) {
  const SquadCover = () => model || require("../models/SquadCover").SquadCover;

  return {
    async putCover(args) {
      assertPutArgs(args);
      const { squadId, contentType, bytes } = args;
      const key = coverKeyFor({ squadId, bytes });
      try {
        await SquadCover().updateOne(
          { key },
          {
            $set: { contentType },
            $setOnInsert: { key, squadId, bytes, size: bytes.length, createdAt: new Date() },
          },
          { upsert: true }
        );
      } catch (error) {
        // A concurrent upload of the same bytes won the upsert race.
        if (error?.code !== 11000) throw error;
      }
      return { key };
    },

    async getCover(key) {
      if (!parseCoverKey(key)) return null;
      const row = await SquadCover().findOne({ key }).select("contentType bytes").lean();
      const bytes = toBuffer(row?.bytes);
      if (!row || !bytes) return null;
      return { contentType: row.contentType, bytes };
    },

    async deleteCover(key) {
      if (!parseCoverKey(key)) return;
      await SquadCover().deleteOne({ key });
    },

    async deleteSquadCovers(squadId) {
      if (typeof squadId !== "string" || !squadId) return;
      await SquadCover().deleteMany({ squadId });
    },
  };
}

function createCoverStorage(env = process.env) {
  const backend = String(env.COVER_STORAGE || "mongo").trim().toLowerCase();
  if (backend === "mongo") return createMongoCoverStorage();
  throw new Error(`Unsupported COVER_STORAGE "${backend}": only "mongo" is implemented`);
}

const storage = createCoverStorage();

module.exports = {
  putCover: (args) => storage.putCover(args),
  getCover: (key) => storage.getCover(key),
  deleteCover: (key) => storage.deleteCover(key),
  deleteSquadCovers: (squadId) => storage.deleteSquadCovers(squadId),
  COVER_KEY_PATTERN,
  coverKeyFor,
  parseCoverKey,
  createCoverStorage,
  createMongoCoverStorage,
};
