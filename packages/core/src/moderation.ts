// Lightweight, client-side moderation for user-authored text (custom vibe tags).
// Two buckets:
//   • "blocked"  — disallowed outright (slurs, hate, sexual content involving
//                  minors, illegal). Never accepted.
//   • "mature"   — adult (18+) but legal. Allowed, but the squad becomes an
//                  adult room: gate it behind an 18+ confirmation.
//   • "ok"       — everything else.
//
// This is a first-line UX guard, NOT a substitute for server-side moderation.
// Real enforcement (and anything monetized) must be validated on the backend.

export type VibeVerdict = "ok" | "mature" | "blocked";

// Normalize leetspeak / spacing so "s3x" / "s e x" don't slip past.
function canon(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]/g, (m) => m) // keep for word-boundary checks below
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
function letters(input: string): string {
  return canon(input).replace(/[^a-z]/g, "");
}

// Hard-blocked: hate slurs + any sexualization of minors / illegal. Kept terse
// and euphemized where possible; matched as substrings on the delettered form.
const BLOCKED: string[] = [
  "childporn", "cp", "loli", "shota", "pedo", "underage", "minorsex", "jailbait",
  "rape", "bestiality", "incest",
  // common hate slurs (delettered)
  "nigger", "faggot", "kike", "chink", "spic", "tranny", "retard",
];

// Adult (18+) but legal — triggers the age-gate, not a block.
const MATURE: string[] = [
  "sex", "sexy", "nsfw", "nude", "nudes", "naked", "porn", "porno", "xxx",
  "hookup", "hookups", "fuck", "onlyfans", "kink", "kinky", "fetish", "bdsm",
  "horny", "sext", "sexting", "camgirl", "escort", "18plus", "adult", "erotic",
  "thirst", "freaky",
];

function matches(list: string[], hay: string): boolean {
  return list.some((term) => hay.includes(term));
}

/** Classify a user-authored vibe/tag string. */
export function classifyVibe(raw: string): VibeVerdict {
  const hay = letters(raw);
  if (!hay) return "ok";
  if (matches(BLOCKED, hay)) return "blocked";
  if (matches(MATURE, hay)) return "mature";
  return "ok";
}

/** True if any of a squad's tags is adult (18+). */
export function tagsAreMature(tags: string[] = []): boolean {
  return tags.some((t) => classifyVibe(t) === "mature");
}
