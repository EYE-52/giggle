// src/utils/moderation.js
//
// AUTHORITATIVE server-side moderation for user-authored text (custom vibe tags).
// This mirrors giggle-web/packages/core/src/moderation.ts exactly — the frontend
// copy is a first-line UX guard; THIS copy is the source of truth. Keep the word
// lists and normalization in sync with the frontend on any change.
//
// Buckets:
//   • "blocked" — disallowed outright (slurs, hate, sexual content involving
//                 minors, illegal). Never accepted.
//   • "mature"  — adult sexual content. Current squad endpoints reject it.
//   • "ok"      — everything else.

// Normalize leetspeak / spacing so "s3x" / "s e x" don't slip past.
function canon(input) {
  return String(input)
    .toLowerCase()
    .replace(/1/g, "i")
    .replace(/3/g, "e")
    .replace(/4/g, "a")
    .replace(/0/g, "o")
    .replace(/5/g, "s")
    .replace(/7/g, "t")
    .replace(/@/g, "a")
    .replace(/\$/g, "s");
}

// Collapse to letters only, for substring scanning of obfuscated input.
function letters(input) {
  return canon(input).replace(/[^a-z]/g, "");
}

// Hard-blocked: hate slurs + any sexualization of minors / illegal. Kept terse
// and euphemized where possible; matched as substrings on the delettered form.
const BLOCKED = [
  "childporn", "cp", "loli", "shota", "pedo", "underage", "minorsex", "jailbait",
  "rape", "bestiality", "incest",
  // common hate slurs (delettered)
  "nigger", "faggot", "kike", "chink", "spic", "tranny", "retard",
];

// Adult sexual content. Kept separate from illegal/hate content for reporting,
// but current squad endpoints reject both buckets.
const MATURE = [
  "sex", "sexy", "nsfw", "nude", "nudes", "naked", "porn", "porno", "xxx",
  "hookup", "hookups", "fuck", "onlyfans", "kink", "kinky", "fetish", "bdsm",
  "horny", "sext", "sexting", "camgirl", "escort", "18plus", "adult", "erotic",
  "thirst", "freaky",
];

function matches(list, hay) {
  return list.some((term) => hay.includes(term));
}

/** Classify a user-authored vibe/tag string → "ok" | "mature" | "blocked". */
function classifyVibe(raw) {
  const hay = letters(raw);
  if (!hay) return "ok";
  if (matches(BLOCKED, hay)) return "blocked";
  if (matches(MATURE, hay)) return "mature";
  return "ok";
}

/** True if any of a squad's tags is adult (18+). */
function tagsAreMature(tags = []) {
  return (Array.isArray(tags) ? tags : []).some((t) => classifyVibe(t) === "mature");
}

/** True if any of a squad's tags is hard-blocked. Returns the first blocked tag or null. */
function firstBlockedTag(tags = []) {
  const list = Array.isArray(tags) ? tags : [];
  for (const t of list) {
    if (classifyVibe(t) === "blocked") return t;
  }
  return null;
}

module.exports = { classifyVibe, tagsAreMature, firstBlockedTag };
