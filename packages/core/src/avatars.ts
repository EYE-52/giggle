import { parseCharacter } from "../../../server/src/utils/characterConfig.js";
export { parseCharacter, encodeCharacter, validateCharacter, CHARACTER_DEFAULTS, CHARACTER_OPTIONS } from "../../../server/src/utils/characterConfig.js";
export type { CharacterConfig } from "../../../server/src/utils/characterConfig.js";
/**
 * Giggle avatar system.
 * Storage key: "giggle.avatar"
 * Value: a DEFAULT_AVATARS id string OR a data: URL for custom uploads.
 * Illustrated ids are also saved on the server profile (`avatar`) so other
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

const STORAGE_KEY = "giggle.avatar";
const DEFAULT_ID = DEFAULT_AVATARS[0].id;
const MAX_CUSTOM_AVATAR_LENGTH = 2_000_000;
const SAFE_CUSTOM_AVATAR = /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;
/** Stable default avatar id — use this for SSR-safe useState initialization
    (getMyAvatar() reads localStorage on the client only, causing hydration
    mismatches if used as an initializer). */
export const DEFAULT_AVATAR_ID = DEFAULT_ID;

function normalizeAvatarValue(value: string): string | null {
  const avatar = value.trim();
  if (getDefaultAvatarById(avatar) || parseCharacter(avatar) || isCustomAvatar(avatar)) return avatar;
  return null;
}

/** Returns the stored avatar value (id or data URL), seeded from a userId if unset. */
export function getMyAvatar(userId?: string): string {
  if (typeof window === "undefined") return DEFAULT_ID;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const normalized = normalizeAvatarValue(stored);
      if (normalized) return normalized;
      localStorage.removeItem(STORAGE_KEY);
    }
    // Same seeded default other people see for this user.
    return userId ? defaultAvatarFor(userId) : DEFAULT_ID;
  } catch {
    return DEFAULT_ID;
  }
}

export function setMyAvatar(value: string): void {
  if (typeof window === "undefined") return;
  try {
    const next = normalizeAvatarValue(value) ?? DEFAULT_ID;
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

/** Stable illustrated avatar for someone who hasn't picked one (free set only). */
export function defaultAvatarFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return DEFAULT_AVATARS[h % FREE_AVATAR_COUNT].id;
}

/** A shared (server-side) avatar id, or the seeded default when it is missing or unknown. */
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
