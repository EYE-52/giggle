const crypto = require("crypto");
const { publicApiBaseUrl } = require("../config/appConfig");
const { parseCoverKey } = require("../services/coverStorage");

// Squad.coverImage holds a preset id, an https URL, null, or for uploads a
// short reference "upload:<key>" into coverStorage. Squads created before the
// cover migration may still hold the image inline as a base64 data URL
// (legacy, until scripts/migrate-squad-covers.js has run).
//
// API responses carry a short, cacheable URL for uploads instead of image
// data; the bytes are served by GET /api/covers/:squadId/:hash (see
// coverController).

const UPLOAD_COVER_PREFIX = "upload:";
// Only raster types are ever served. SVG (script-capable) never is.
const SERVABLE_COVER_DATA_URL = /^data:(image\/(?:png|jpe?g|webp|gif));base64,/i;
const SERVABLE_COVER_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const COVER_HASH_PATTERN = /^[a-f0-9]{16}$/;
// Squad ids come from generateId("sq"): sq_<timestamp>_<base36 suffix>.
const SQUAD_ID_PATTERN = /^sq_\d{1,16}_[a-z0-9]{0,32}$/;

// Legacy inline covers: content hash of the full stored data URL. It changes
// whenever the cover changes (cache busting) and makes the URL an unguessable
// capability, so covers of private squads can't be enumerated by squad id.
// Uploaded covers carry the equivalent hash (of the bytes) in their key.
function coverImageHash(coverImage) {
  return crypto.createHash("sha256").update(coverImage, "utf8").digest("hex").slice(0, 16);
}

function uploadCoverRef(key) {
  return `${UPLOAD_COVER_PREFIX}${key}`;
}

// The coverStorage key of an "upload:<key>" cover, else null.
function uploadCoverKey(coverImage) {
  if (typeof coverImage !== "string" || !coverImage.startsWith(UPLOAD_COVER_PREFIX)) return null;
  const key = coverImage.slice(UPLOAD_COVER_PREFIX.length);
  return parseCoverKey(key) ? key : null;
}

function isLegacyDataUrlCover(coverImage) {
  return typeof coverImage === "string" && /^data:/i.test(coverImage);
}

// { contentType, body } for a data URL that may be served, else null.
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

// The hash a cover URL carries for this stored coverImage, or null when the
// cover route would not serve it. Never reads image bytes for uploads.
function servedCoverHash(coverImage) {
  const key = uploadCoverKey(coverImage);
  if (key) return parseCoverKey(key).hash;
  if (typeof coverImage === "string" && SERVABLE_COVER_DATA_URL.test(coverImage)) {
    return coverImageHash(coverImage);
  }
  return null;
}

// The coverImage value to send to clients. Preset ids, https URLs and null pass
// through unchanged; an upload reference (or legacy data URL) becomes its
// absolute cover URL. A stored value the cover route would refuse to serve
// (malformed reference, non-raster data URL) is dropped rather than exposed.
function publicCoverImage(squad) {
  const coverImage = squad?.coverImage ?? null;
  if (typeof coverImage !== "string") return coverImage;
  if (!coverImage.startsWith(UPLOAD_COVER_PREFIX) && !isLegacyDataUrlCover(coverImage)) {
    return coverImage;
  }
  const hash = servedCoverHash(coverImage);
  if (!hash || !squad.squadId) return null;
  const squadId = encodeURIComponent(squad.squadId);
  return `${publicApiBaseUrl()}/covers/${squadId}/${hash}`;
}

module.exports = {
  COVER_HASH_PATTERN,
  SERVABLE_COVER_CONTENT_TYPES,
  SQUAD_ID_PATTERN,
  UPLOAD_COVER_PREFIX,
  coverImageHash,
  decodeCoverDataUrl,
  isLegacyDataUrlCover,
  publicCoverImage,
  servedCoverHash,
  uploadCoverKey,
  uploadCoverRef,
};
