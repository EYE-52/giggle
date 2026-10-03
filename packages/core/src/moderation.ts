// Lightweight, client-side moderation for user-authored text (custom vibe tags).
// Two buckets:
//   • "blocked"  — disallowed outright (slurs, hate, sexual content involving
//                  minors, illegal). Never accepted.
//   • "mature"   — adult sexual content. Squad topics reject it.
//   • "ok"       — everything else.
//
// This is a first-line UX guard, NOT a substitute for server-side moderation.
// Real enforcement (and anything monetized) must be validated on the backend.

export type VibeVerdict = "ok" | "mature" | "blocked";

// Normalize leetspeak / spacing so "s3x" / "s e x" don't slip past.
function canon(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
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
function letters(input: string): string {
  return canon(input).replace(/[^a-z]/g, "");
}

// Hard-blocked: hate slurs + any sexualization of minors / illegal. Kept terse
// and euphemized where possible; matched as substrings on the delettered form.
const BLOCKED: string[] = [
  "childporn", "loli", "shota", "pedo", "underage", "minorsex", "jailbait",
  "bestiality", "incest",
  // common hate slurs (delettered)
  "nigger", "faggot", "tranny",
];

// Ambiguous short terms match words (including spaced/punctuated spellings),
// so ordinary topics such as Music production, Grape juice and Spicy food survive.
const BLOCKED_WORDS = ["cp", "rape", "raped", "rapist", "kike", "chink", "spic", "retard"].map(
  term => new RegExp("\\b" + term.split("").join("[^a-z]*") + "\\b"),
);

// Adult sexual content — rejected by squad endpoints.
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
  if (matches(BLOCKED, hay) || BLOCKED_WORDS.some(pattern => pattern.test(canon(raw)))) return "blocked";
  if (matches(MATURE, hay) || /(?:^|[^0-9])18\s*(?:\+|plus)/i.test(raw.normalize("NFKC"))) return "mature";
  return "ok";
}

/** True if any of a squad's tags is adult (18+). */
export function tagsAreMature(tags: string[] = []): boolean {
  return tags.some((t) => classifyVibe(t) === "mature");
}
