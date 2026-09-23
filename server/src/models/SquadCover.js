const mongoose = require("mongoose");

// Uploaded squad cover image bytes, kept out of squad documents so squad reads
// stay small. Squads reference a row by `coverImage: "upload:<key>"`. Only
// src/services/coverStorage.js reads or writes this collection.
const squadCoverSchema = new mongoose.Schema({
  // `${squadId}/${first 16 hex of sha256(bytes)}`
  key: { type: String, required: true, unique: true },
  squadId: { type: String, required: true, index: true },
  contentType: { type: String, required: true },
  bytes: { type: Buffer, required: true },
  size: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now },
});

const SquadCover = mongoose.model("SquadCover", squadCoverSchema);

module.exports = { SquadCover };
