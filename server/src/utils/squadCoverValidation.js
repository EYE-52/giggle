const MAX_COVER_IMAGE_LENGTH = 2_000_000;

const PRESET_COVER_IDS = new Set([
  "grad-aurora",
  "grad-neon",
  "grad-sunset",
  "grad-cyber",
  "grad-velvet",
  "grad-lagoon",
  "grad-ember",
  "grad-frost",
  "grad-mardi",
  "grad-galaxy",
  "grad-citrus",
  "grad-orchid",
  "photo-neon-nights",
  "photo-midnight-gamers",
  "photo-match-your-squad",
  "photo-match-opponent",
  "photo-hero",
  "photo-alex",
]);

const SAFE_IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;

function normalizeSquadCoverImage(value) {
  if (typeof value !== "string") {
    return { error: "coverImage must be a string" };
  }

  const coverImage = value.trim();
  if (coverImage.length > MAX_COVER_IMAGE_LENGTH) {
    return { error: "coverImage exceeds maximum allowed size" };
  }

  if (PRESET_COVER_IDS.has(coverImage)) {
    return { coverImage };
  }

  try {
    const url = new URL(coverImage);
    if (url.protocol === "https:") {
      return { coverImage: url.toString() };
    }
  } catch {}

  if (SAFE_IMAGE_DATA_URL.test(coverImage)) {
    return { coverImage };
  }

  return { error: "coverImage must be a known preset, https image URL, or image data URL" };
}

module.exports = { MAX_COVER_IMAGE_LENGTH, normalizeSquadCoverImage };
