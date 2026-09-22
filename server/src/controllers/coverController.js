const crypto = require("crypto");
const { Squad } = require("../models/Squad");
const coverStorage = require("../services/coverStorage");
const {
  COVER_HASH_PATTERN,
  SERVABLE_COVER_CONTENT_TYPES,
  SQUAD_ID_PATTERN,
  decodeCoverDataUrl,
  servedCoverHash,
  uploadCoverKey,
} = require("../utils/squadCovers");

const notFound = (res) => res.status(404).set("Cache-Control", "no-store").end();

// { contentType, bytes } for the squad's current cover when `hash` names it,
// else null. Uploads come from coverStorage; legacy squads still hold the
// image inline as a data URL until the migration script has run.
async function loadCurrentCover(coverImage, hash) {
  const expected = servedCoverHash(coverImage);
  if (!expected || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return null;

  const key = uploadCoverKey(coverImage);
  if (key) {
    const stored = await coverStorage.getCover(key);
    if (!stored || !SERVABLE_COVER_CONTENT_TYPES.has(stored.contentType)) return null;
    return stored;
  }

  const legacy = decodeCoverDataUrl(coverImage);
  return legacy ? { contentType: legacy.contentType, bytes: legacy.body } : null;
}

// Public (no auth: CSS backgrounds can't send Authorization) uploaded-cover
// image. The hash in the URL must match the squad's current cover, so the URL
// works as a capability and is immutable: a new cover gets a new URL.
const getSquadCoverImageHandler = async (req, res) => {
  const { squadId, hash } = req.params;
  if (
    typeof squadId !== "string" ||
    typeof hash !== "string" ||
    !SQUAD_ID_PATTERN.test(squadId) ||
    !COVER_HASH_PATTERN.test(hash)
  ) {
    return notFound(res);
  }

  try {
    const squad = await Squad.findOne({ squadId }).select("coverImage").lean();
    const cover = await loadCurrentCover(squad?.coverImage, hash);
    if (!cover) return notFound(res);

    res.set({
      "Content-Type": cover.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // The web app is on another origin; helmet's default same-origin CORP
      // would block its <img>/CSS loads.
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    return res.status(200).send(cover.bytes);
  } catch (error) {
    console.error("Error serving squad cover:", error);
    return res.status(500).set("Cache-Control", "no-store").end();
  }
};

module.exports = { getSquadCoverImageHandler };
