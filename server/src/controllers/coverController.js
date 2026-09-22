const crypto = require("crypto");
const { Squad } = require("../models/Squad");
const {
  COVER_HASH_PATTERN,
  SQUAD_ID_PATTERN,
  coverImageHash,
  decodeCoverDataUrl,
} = require("../utils/squadCovers");

const notFound = (res) => res.status(404).set("Cache-Control", "no-store").end();

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
    const cover = decodeCoverDataUrl(squad?.coverImage);
    if (!cover) return notFound(res);

    const expected = Buffer.from(coverImageHash(squad.coverImage));
    if (!crypto.timingSafeEqual(expected, Buffer.from(hash))) return notFound(res);

    res.set({
      "Content-Type": cover.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // The web app is on another origin; helmet's default same-origin CORP
      // would block its <img>/CSS loads.
      "Cross-Origin-Resource-Policy": "cross-origin",
    });
    return res.status(200).send(cover.body);
  } catch (error) {
    console.error("Error serving squad cover:", error);
    return res.status(500).set("Cache-Control", "no-store").end();
  }
};

module.exports = { getSquadCoverImageHandler };
