const crypto = require("crypto");
const { publicApiBaseUrl } = require("../config/appConfig");

// Uploaded squad covers are stored inline as base64 data URLs (up to ~2 MB).
// API responses carry a short, cacheable URL for them instead; the image bytes
// are served by GET /api/covers/:squadId/:hash (see coverController).

// Only raster types are ever served. SVG (script-capable) never is.
const SERVABLE_COVER_DATA_URL = /^data:(image\/(?:png|jpe?g|webp|gif));base64,/i;
const COVER_HASH_PATTERN = /^[a-f0-9]{16}$/;
// Squad ids come from generateId("sq"): sq_<timestamp>_<base36 suffix>.
const SQUAD_ID_PATTERN = /^sq_\d{1,16}_[a-z0-9]{0,32}$/;

// Content hash of the full stored cover string. It changes whenever the cover
// changes (cache busting) and makes the URL an unguessable capability, so
// covers of private squads can't be enumerated by squad id.
function coverImageHash(coverImage) {
  return crypto.createHash("sha256").update(coverImage, "utf8").digest("hex").slice(0, 16);
}

// { contentType, body } for a stored data URL that may be served, else null.
function decodeCoverDataUrl(coverImage) {
  if (typeof coverImage !== "string") return null;
  const match = SERVABLE_COVER_DATA_URL.exec(coverImage);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  return {
    contentType: mimeType === "image/jpg" ? "image/jpeg" : mimeType,
    body: Buffer.from(coverImage.slice(match[0].length), "base64"),
  };
}

// The coverImage value to send to clients. Preset ids, https URLs and null pass
// through unchanged; an uploaded data URL becomes its absolute cover URL. A
// data URL the cover route would refuse to serve (legacy, non-raster) is
// dropped rather than inlined into the response.
function publicCoverImage(squad) {
  const coverImage = squad?.coverImage ?? null;
  if (typeof coverImage !== "string" || !/^data:/i.test(coverImage)) return coverImage;
  if (!SERVABLE_COVER_DATA_URL.test(coverImage) || !squad.squadId) return null;
  const squadId = encodeURIComponent(squad.squadId);
  return `${publicApiBaseUrl()}/covers/${squadId}/${coverImageHash(coverImage)}`;
}

module.exports = {
  COVER_HASH_PATTERN,
  SQUAD_ID_PATTERN,
  coverImageHash,
  decodeCoverDataUrl,
  publicCoverImage,
};
