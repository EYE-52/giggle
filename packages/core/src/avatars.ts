import { parseCharacter, encodeCharacter, validateCharacter, CHARACTER_DEFAULTS, CHARACTER_OPTIONS } from "../../../server/src/utils/characterConfig.js";
import type { CharacterConfig } from "../../../server/src/utils/characterConfig.js";
export { parseCharacter, encodeCharacter, validateCharacter, CHARACTER_DEFAULTS, CHARACTER_OPTIONS } from "../../../server/src/utils/characterConfig.js";
export type { CharacterConfig } from "../../../server/src/utils/characterConfig.js";
/**
 * Giggle avatar system.
 * Storage key: "giggle.avatar"
 * Value: a `giggle:v1:` character string, a legacy DEFAULT_AVATARS id or a
 * data: URL for custom uploads. Legacy ids stay valid data (the server and
 * the mobile app accept them) but the web app renders them as characters.
 * Picked values are also saved on the server profile (`avatar`) so other
 * people see them; custom uploads stay on this device only.
 */

export type AvatarStyle =
  | "blob"
  | "bot"
  | "star"
  | "ghost"
  | "cat"
  | "bolt"
  | "moon"
  | "diamond";

export interface DefaultAvatar {
  id: string;
  name: string;
  colors: [string, string]; // [from, to] gradient stops
  style: AvatarStyle;
}

export const DEFAULT_AVATARS: DefaultAvatar[] = [
  { id: "violet-blob",   name: "Violet Blob",   colors: ["#9B7CFF", "#5436C9"], style: "blob" },
  { id: "teal-bot",      name: "Teal Bot",      colors: ["#3DD6C0", "#1A8A78"], style: "bot" },
  { id: "coral-star",    name: "Coral Star",    colors: ["#FF7BA3", "#C2306B"], style: "star" },
  { id: "lime-ghost",    name: "Lime Ghost",    colors: ["#D4FF6E", "#8FCF12"], style: "ghost" },
  { id: "orange-cat",    name: "Orange Cat",    colors: ["#FFA877", "#D85E34"], style: "cat" },
  { id: "blue-bolt",     name: "Blue Bolt",     colors: ["#7BA3FF", "#2F5BD4"], style: "bolt" },
  { id: "gold-moon",     name: "Gold Moon",     colors: ["#FFD787", "#D49A23"], style: "moon" },
  { id: "pink-diamond",  name: "Pink Diamond",  colors: ["#FF9EE0", "#CC3D9F"], style: "diamond" },
  { id: "cyan-bot",      name: "Cyan Bot",      colors: ["#5BE8D4", "#0FA89A"], style: "bot" },
  { id: "indigo-blob",   name: "Indigo Blob",   colors: ["#B49BFF", "#6344C2"], style: "blob" },
  { id: "red-ghost",     name: "Red Ghost",     colors: ["#FF8080", "#CC2222"], style: "ghost" },
  { id: "green-star",    name: "Green Star",    colors: ["#80FFB0", "#1AA85A"], style: "star" },
  { id: "yellow-cat",    name: "Yellow Cat",    colors: ["#FFE87A", "#CCA800"], style: "cat" },
  { id: "navy-moon",     name: "Navy Moon",     colors: ["#7BA3FF", "#1A2ACC"], style: "moon" },
  { id: "rose-diamond",  name: "Rose Diamond",  colors: ["#FFADD0", "#EE3377"], style: "diamond" },
  { id: "mint-bolt",     name: "Mint Bolt",     colors: ["#A8FFE0", "#14B87A"], style: "bolt" },
];

/** The first avatars are free; the rest belong to the premium "vibe_pack". */
export const FREE_AVATAR_COUNT = 8;

// ─── Giggle characters (what every person avatar renders as) ───────────────

/**
 * Editor color palettes, mirroring the avatar playground's palettes
 * (apps/desktop/app/avatar-playground/page.tsx). Curated and seeded
 * characters only use these colors.
 */
const PALETTES = {
  skin: ["#f6d4b8", "#efbd98", "#dca47c", "#bd815e", "#a36c4b", "#86523e", "#684332", "#493126"],
  hairColor: ["#25252a", "#39302e", "#633e30", "#9e5a39", "#c18a49", "#dfbf85", "#bcb4ad", "#ece0c9"],
  shirtColor: ["#f4ecdd", "#d97654", "#953d48", "#bd943e", "#657f6b", "#446c87", "#8c8ebe", "#30313b", "#c8502e", "#e9a13b", "#2f6f5e", "#274e67", "#6f5aa8"],
  accessoryColor: ["#d2a951", "#c5c7cc", "#74618c", "#466957", "#a45443", "#324d67", "#dfb9ae", "#292b32", "#c8502e", "#1f7a6d", "#e9a13b", "#8c2f39"],
  accent: ["#e5dbc9", "#e4dce9", "#d5e2dd", "#d9e6ef", "#f1d9ca", "#efdfa7", "#e6ccd4", "#dededc", "#eab676", "#a9c6a2", "#93b8d4", "#e5a9a0", "#274e67", "#b7a3d9"],
} as const;

/** Fills in a character config the same way the playground's presets do. */
function look(overrides: Partial<CharacterConfig>): CharacterConfig {
  return { ...CHARACTER_DEFAULTS, ...overrides };
}

export interface CharacterPreset {
  id: string;
  name: string;
  /** True for the looks the avatar playground offers as starting points. */
  playground?: boolean;
  config: CharacterConfig;
}

/**
 * Twelve curated looks: every hairstyle, face shape and outfit, a spread of
 * skin tones light to deep, glasses on some, facial hair on a couple, and
 * headwear or earrings on a couple. Palette colors only.
 */
export const CHARACTER_PRESETS: CharacterPreset[] = [
  { id: "curls", name: "Curls", playground: true, config: look({ skin: "#684332", hairColor: "#25252a", shirtColor: "#c8502e", accent: "#eab676", expression: "laugh", freckles: true, eyeSize: 40 }) },
  { id: "bob", name: "Bob", playground: true, config: look({ hair: "bob", face: "round", skin: "#f6d4b8", hairColor: "#39302e", clothing: "sweater", shirtColor: "#2f6f5e", accent: "#93b8d4", earrings: "hoops", accessoryColor: "#d2a951", expression: "surprised", eyeSpacing: 40, faceWidth: 35 }) },
  { id: "swoop", name: "Swoop", playground: true, config: look({ hair: "swoop", face: "angular", skin: "#493126", hairColor: "#25252a", clothing: "jacket", shirtColor: "#274e67", accessoryColor: "#e9a13b", accent: "#e5a9a0", glasses: "round", eyeSize: 45 }) },
  { id: "buzz", name: "Buzz", config: look({ hair: "buzz", face: "angular", skin: "#dca47c", hairColor: "#39302e", clothing: "hoodie", shirtColor: "#30313b", accent: "#e5a9a0", glasses: "square", expression: "wink" }) },
  { id: "bald", name: "Bald", config: look({ hair: "bald", face: "round", skin: "#efbd98", hairColor: "#dfbf85", clothing: "collared", shirtColor: "#e9a13b", accent: "#274e67", facialHair: "beard" }) },
  { id: "long", name: "Long", config: look({ hair: "long", face: "soft", skin: "#86523e", hairColor: "#c18a49", shirtColor: "#953d48", accent: "#93b8d4", expression: "laugh" }) },
  { id: "bun", name: "Bun", config: look({ hair: "bun", face: "angular", skin: "#a36c4b", hairColor: "#25252a", clothing: "sweater", shirtColor: "#d97654", accent: "#b7a3d9", glasses: "round" }) },
  { id: "crop", name: "Crop", config: look({ hair: "crop", face: "soft", skin: "#bd815e", hairColor: "#633e30", clothing: "jacket", shirtColor: "#446c87", accent: "#eab676", earrings: "studs", accessoryColor: "#d2a951", expression: "wink" }) },
  { id: "beanie", name: "Beanie", config: look({ hair: "swoop", face: "round", skin: "#dca47c", hairColor: "#9e5a39", clothing: "hoodie", shirtColor: "#657f6b", accent: "#e5a9a0", headwear: "beanie", accessoryColor: "#e9a13b", expression: "laugh" }) },
  { id: "hoops", name: "Hoops", config: look({ hair: "curls", face: "soft", skin: "#493126", hairColor: "#ece0c9", shirtColor: "#c8502e", accent: "#a9c6a2", earrings: "hoops", accessoryColor: "#e9a13b", expression: "surprised" }) },
  { id: "stubble", name: "Stubble", config: look({ hair: "buzz", face: "angular", skin: "#bd815e", hairColor: "#25252a", clothing: "collared", shirtColor: "#e9a13b", accent: "#93b8d4", facialHair: "stubble" }) },
  { id: "cap", name: "Cap", config: look({ hair: "crop", face: "angular", skin: "#86523e", hairColor: "#39302e", shirtColor: "#d97654", accent: "#eab676", headwear: "cap", accessoryColor: "#1f7a6d", facialHair: "mustache", expression: "laugh" }) },
];

/**
 * A fixed character for each legacy DEFAULT_AVATARS id, so people who saved
 * one keep a familiar look: shirt and background hues track the old
 * gradient, while hair and skin vary across ids. Deterministic by id.
 */
const LEGACY_CHARACTER_LOOKS: Partial<CharacterConfig>[] = [
  // violet-blob → violet tee on lilac
  look({ hair: "curls", skin: "#f6d4b8", hairColor: "#39302e", shirtColor: "#6f5aa8", accent: "#b7a3d9", expression: "laugh" }),
  // teal-bot → green hoodie on sage
  look({ hair: "crop", face: "angular", skin: "#dca47c", hairColor: "#25252a", clothing: "hoodie", shirtColor: "#2f6f5e", accent: "#a9c6a2", glasses: "square" }),
  // coral-star → terracotta sweater on rose
  look({ hair: "bob", face: "round", skin: "#efbd98", hairColor: "#39302e", clothing: "sweater", shirtColor: "#c8502e", accent: "#e5a9a0", earrings: "hoops", accessoryColor: "#e9a13b", expression: "wink" }),
  // lime-ghost → green tee on sage
  look({ hair: "swoop", skin: "#a36c4b", hairColor: "#633e30", shirtColor: "#2f6f5e", accent: "#a9c6a2", expression: "laugh" }),
  // orange-cat → terracotta tee on amber
  look({ hair: "buzz", face: "angular", skin: "#bd815e", hairColor: "#25252a", shirtColor: "#c8502e", accent: "#eab676", facialHair: "stubble", expression: "laugh" }),
  // blue-bolt → deep-blue jacket on sky
  look({ hair: "long", skin: "#684332", hairColor: "#25252a", clothing: "jacket", shirtColor: "#274e67", accessoryColor: "#e9a13b", accent: "#93b8d4" }),
  // gold-moon → amber collar on sky (blonde hair needs a cool background)
  look({ hair: "bun", face: "round", skin: "#efbd98", hairColor: "#dfbf85", clothing: "collared", shirtColor: "#e9a13b", accent: "#93b8d4", expression: "laugh" }),
  // pink-diamond → berry tee on rose
  look({ hair: "bald", face: "angular", skin: "#86523e", hairColor: "#39302e", shirtColor: "#953d48", accent: "#e5a9a0", glasses: "round", expression: "wink" }),
  // cyan-bot → deep-blue tee on sky
  look({ hair: "curls", face: "round", skin: "#f6d4b8", hairColor: "#9e5a39", shirtColor: "#274e67", accent: "#93b8d4", freckles: true, expression: "surprised" }),
  // indigo-blob → violet sweater on lilac
  look({ hair: "long", face: "round", skin: "#bd815e", hairColor: "#633e30", clothing: "sweater", shirtColor: "#6f5aa8", accent: "#b7a3d9", earrings: "hoops", accessoryColor: "#e9a13b", expression: "laugh" }),
  // red-ghost → berry jacket on rose
  look({ hair: "curls", face: "angular", skin: "#dca47c", hairColor: "#39302e", headwear: "beanie", clothing: "jacket", shirtColor: "#953d48", accessoryColor: "#e9a13b", accent: "#e5a9a0", facialHair: "beard", expression: "wink" }),
  // green-star → green tee on sage
  look({ hair: "swoop", skin: "#86523e", hairColor: "#25252a", shirtColor: "#2f6f5e", accent: "#a9c6a2", expression: "wink" }),
  // yellow-cat → amber hoodie on lilac
  look({ hair: "buzz", face: "round", skin: "#a36c4b", hairColor: "#25252a", clothing: "hoodie", shirtColor: "#e9a13b", accent: "#b7a3d9", expression: "laugh" }),
  // navy-moon → deep-blue collar on amber
  look({ hair: "crop", face: "round", skin: "#493126", hairColor: "#25252a", clothing: "collared", shirtColor: "#274e67", accent: "#eab676", facialHair: "beard", expression: "wink" }),
  // rose-diamond → terracotta sweater on rose
  look({ hair: "bun", face: "round", skin: "#efbd98", hairColor: "#633e30", clothing: "sweater", shirtColor: "#c8502e", accent: "#e5a9a0", earrings: "studs", accessoryColor: "#e9a13b", expression: "surprised" }),
  // mint-bolt → green tee on sage
  look({ hair: "buzz", face: "round", skin: "#684332", hairColor: "#25252a", shirtColor: "#2f6f5e", accent: "#eab676", facialHair: "mustache", freckles: true, expression: "laugh" }),
];

export function legacyCharacterFor(id: string): CharacterConfig | null {
  const index = DEFAULT_AVATARS.findIndex((avatar) => avatar.id === id);
  if (index === -1) return null;
  return validateCharacter(LEGACY_CHARACTER_LOOKS[index]);
}

// Bold, on-brand colors for generated characters (the pale backgrounds read as flat).
const LIVELY_SHIRTS = ["#d97654", "#953d48", "#446c87", "#c8502e", "#e9a13b", "#2f6f5e", "#274e67", "#6f5aa8"] as const;
const LIVELY_ACCENTS = ["#eab676", "#a9c6a2", "#93b8d4", "#e5a9a0", "#b7a3d9"] as const;

/** Deterministic FNV-1a-style hash with a salt, so each choice decorrelates. */
function hashSeed(seed: string, salt: number): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/**
 * A deterministic, valid character for any string (user id, display name,
 * fallback). Same seed, same face — palette colors only, animated.
 */
export function seededCharacterFor(seed: string): CharacterConfig {
  const pick = <T>(options: readonly T[], salt: number): T => options[hashSeed(seed, salt) % options.length];
  const proportion = (salt: number): number => 40 + (hashSeed(seed, salt) % 21);
  const roll = hashSeed(seed, 9) % 10;
  const config = validateCharacter(look({
    hair: pick(CHARACTER_OPTIONS.hair, 1),
    face: pick(CHARACTER_OPTIONS.face, 2),
    skin: pick(PALETTES.skin, 3),
    hairColor: pick(PALETTES.hairColor, 4),
    shirtColor: pick(LIVELY_SHIRTS, 5),
    accent: pick(LIVELY_ACCENTS, 6),
    accessoryColor: pick(PALETTES.accessoryColor, 16),
    clothing: pick(CHARACTER_OPTIONS.clothing, 7),
    expression: pick(["laugh", "laugh", "wink", "smile", "smile"] as const, 8),
    glasses: roll === 0 ? "round" : roll === 5 ? "square" : "none",
    facialHair: pick(["none", "none", "none", "stubble", "beard", "mustache"] as const, 17),
    headwear: pick(["none", "none", "none", "none", "beanie", "cap"] as const, 18),
    earrings: pick(["none", "none", "none", "studs", "hoops"] as const, 19),
    freckles: hashSeed(seed, 20) % 5 === 0,
    faceWidth: proportion(10),
    eyeSize: proportion(11),
    eyeSpacing: proportion(12),
    browTilt: proportion(13),
    noseSize: proportion(14),
    mouthWidth: proportion(15),
    animated: true,
  }));
  if (!config) throw new Error("seededCharacterFor produced an invalid character");
  return config;
}

const STORAGE_KEY = "giggle.avatar";
const MAX_CUSTOM_AVATAR_LENGTH = 2_000_000;
const SAFE_CUSTOM_AVATAR = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;
/** Stable default avatar value (the first character preset) — use this for
    SSR-safe useState initialization (getMyAvatar() reads localStorage on the
    client only, causing hydration mismatches if used as an initializer). */
export const DEFAULT_AVATAR_ID = encodeCharacter(CHARACTER_PRESETS[0].config);

function normalizeAvatarValue(value: string): string | null {
  const avatar = value.trim();
  if (getDefaultAvatarById(avatar) || parseCharacter(avatar) || isCustomAvatar(avatar)) return avatar;
  return null;
}

/** Returns the stored avatar value (character, legacy id or data URL), seeded from a userId if unset. */
export function getMyAvatar(userId?: string): string {
  if (typeof window === "undefined") return DEFAULT_AVATAR_ID;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const normalized = normalizeAvatarValue(stored);
      if (normalized) return normalized;
      localStorage.removeItem(STORAGE_KEY);
    }
    // Same seeded character other people see for this user.
    return userId ? defaultAvatarFor(userId) : DEFAULT_AVATAR_ID;
  } catch {
    return DEFAULT_AVATAR_ID;
  }
}

export function setMyAvatar(value: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = normalizeAvatarValue(value) ?? DEFAULT_AVATAR_ID;
    localStorage.setItem(STORAGE_KEY, next);
    _notify(next);
  } catch {}
}

/** The avatar explicitly chosen on this device, or null when none was picked. */
export function getStoredAvatar(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeAvatarValue(stored) : null;
  } catch {
    return null;
  }
}

/** The shared character shown for someone who hasn't picked an avatar. */
export function defaultAvatarFor(seed: string): string {
  return encodeCharacter(seededCharacterFor(seed));
}

/** A shared (server-side) avatar value, or the seeded character when it is missing or unknown. */
export function resolveAvatar(avatar: string | null | undefined, seed: string): string {
  return avatar && (getDefaultAvatarById(avatar) || parseCharacter(avatar)) ? avatar : defaultAvatarFor(seed);
}

export function isCustomAvatar(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length <= MAX_CUSTOM_AVATAR_LENGTH &&
    SAFE_CUSTOM_AVATAR.test(value.trim())
  );
}

export function getDefaultAvatarById(id: string): DefaultAvatar | undefined {
  return DEFAULT_AVATARS.find((a) => a.id === id);
}

// ─── Subscribe/notify ──────────────────────────────────────────────────────
type Listener = (value: string) => void;
const _listeners = new Set<Listener>();

function _notify(value: string) {
  _listeners.forEach((fn) => fn(value));
}

export function subscribeAvatar(fn: Listener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
