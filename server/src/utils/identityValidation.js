const MAX_DISPLAY_NAME_LENGTH = 48;

function normalizeDisplayName(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_DISPLAY_NAME_LENGTH);
}

function firstDisplayName(...values) {
  for (const value of values) {
    const normalized = normalizeDisplayName(value);
    if (normalized) return normalized;
  }
  return "Someone";
}

module.exports = {
  MAX_DISPLAY_NAME_LENGTH,
  normalizeDisplayName,
  firstDisplayName,
};
