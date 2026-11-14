const { classifyVibe } = require("./moderation");
const PUBLIC_TOPICS = [
  "games",
  "dating",
  "relationships",
  "banter",
  "deep-talks",
];
const GROUP_LANGUAGES = ["any", "en", "hi", "es", "fr", "de", "pt"];
function groupMetadata(input = {}, partial = false) {
  const out = {};
  for (const [key, choices, fallback] of [
    ["publicTopic", PUBLIC_TOPICS, "banter"],
    ["language", GROUP_LANGUAGES, "any"],
  ]) {
    if (partial && input[key] === undefined) {
      continue;
    }
    const value = input[key] ?? fallback;
    if (!choices.includes(value)) {
      return { error: `Choose a valid ${key}.` };
    }
    out[key] = value;
  }
  if (!partial || input.description !== undefined) {
    if (
      input.description !== undefined &&
      typeof input.description !== "string"
    ) {
      return { error: "Description must be text." };
    }
    const value = (input.description || "").normalize("NFC").trim();
    if (value.length > 160) {
      return { error: "Description must be 160 characters or less." };
    }
    if (value && classifyVibe(value) !== "ok") {
      return { error: "That description is not allowed." };
    }
    out.description = value;
  }
  return { value: out };
}
module.exports = { PUBLIC_TOPICS, GROUP_LANGUAGES, groupMetadata };

/** The directory searches group metadata only, never members or account data. */
function directoryQuery(input = {}) {
  const query = {};
  if (input.search !== undefined) {
    if (typeof input.search !== "string" || input.search.length > 80) {
      return { error: "Search must be 80 characters or less." };
    }
    const search = input.search.normalize("NFC").trim();
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.$or = ["squadName", "description", "tags"].map((field) => ({
        [field]: { $regex: escaped, $options: "i" },
      }));
    }
  }
  for (const [field, allowed] of [
    ["communicationMode", ["chat", "voice", "video"]],
    ["publicTopic", PUBLIC_TOPICS],
    ["language", GROUP_LANGUAGES],
  ]) {
    const value = input[field];
    if (value === undefined || value === "" || value === "any") {
      continue;
    }
    if (typeof value !== "string" || !allowed.includes(value)) {
      return { error: `Choose a valid ${field}.` };
    }
    if (
      (field === "communicationMode" && value === "video") ||
      (field === "publicTopic" && value === "banter")
    ) {
      (query.$and ||= []).push({
        $or: [{ [field]: value }, { [field]: { $exists: false } }],
      });
    } else {
      query[field] = value;
    }
  }
  return { query };
}
module.exports.directoryQuery = directoryQuery;
