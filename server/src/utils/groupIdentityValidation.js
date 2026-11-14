// Shared alias policy only; no accounts, database, or session imports.
const { classifyVibe } = require("./moderation");

const ENCOUNTER_ALIAS_MIN_LENGTH = 2;
const ENCOUNTER_ALIAS_MAX_LENGTH = 24;
// Letters and numbers (any script), with inner spaces, dots, dashes,
// underscores and apostrophes. Must start and end with a letter or number.
const ENCOUNTER_ALIAS_PATTERN =
  /^[\p{L}\p{N}](?:[\p{L}\p{N} ._'-]*[\p{L}\p{N}])?$/u;

const normalizeEncounterAlias = (raw) => {
  if (raw === null) {
    return { value: "" };
  }
  if (typeof raw !== "string") {
    return { error: "encounterAlias must be a string" };
  }
  const value = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!value) {
    return { value: "" };
  }
  if (
    value.length < ENCOUNTER_ALIAS_MIN_LENGTH ||
    value.length > ENCOUNTER_ALIAS_MAX_LENGTH
  ) {
    return {
      error: `encounterAlias must be ${ENCOUNTER_ALIAS_MIN_LENGTH} to ${ENCOUNTER_ALIAS_MAX_LENGTH} characters`,
    };
  }
  if (!ENCOUNTER_ALIAS_PATTERN.test(value)) {
    return {
      error: "encounterAlias can use letters, numbers, spaces and . _ ' -",
    };
  }
  if (classifyVibe(value) !== "ok") {
    return { error: "That name isn't allowed" };
  }
  return { value };
};

module.exports = {
  ENCOUNTER_ALIAS_MIN_LENGTH,
  ENCOUNTER_ALIAS_MAX_LENGTH,
  normalizeEncounterAlias,
};
