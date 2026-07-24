function normalizeSquadTags(tags) {
  if (!Array.isArray(tags)) {
    return { error: "tags must be an array of strings" };
  }

  const normalized = [];
  const seen = new Set();
  for (const tag of tags) {
    if (typeof tag !== "string") {
      return { error: "tags must be an array of strings" };
    }
    const value = tag.replace(/\s+/g, " ").trim();
    if (!value) continue;
    if (value.length > 32) {
      return { error: "tags must be 32 characters or less" };
    }
    const publicValue = value.slice(0, 15);
    const dedupeKey = publicValue.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push(publicValue);
    if (normalized.length >= 5) break;
  }

  return { tags: normalized };
}

module.exports = { normalizeSquadTags };
