"use client";
import { useSyncExternalStore } from "react";
import type { PhosphorWeight } from "@/components/phosphorPaths";

/**
 * The "look" system (phase 1 of the skin redesign).
 *
 * A look is the pair of choices a person makes in Profile → Appearance plus
 * the resolved color mode:
 *   skin    visual character (fonts come with the skin today; porting the
 *           rest of each skin's look onto real screens is phase 2)
 *   palette one of the 6 approved color palettes × light/dark tokens
 *   mode    light | dark | auto (auto follows prefers-color-scheme live)
 *
 * Persisted in localStorage["giggle.look"] as JSON `{skin, palette, mode}`.
 * The old localStorage["giggle.theme"] values migrate once:
 *   "dark" → mode dark · "light" → mode light · anything else → defaults.
 * public/theme-init.js mirrors this module's read logic pre-paint (keep the
 * two in sync — test/look.test.js asserts the contract).
 */

export type SkinId = "soft" | "play" | "clay" | "paper" | "scrap";
export type PaletteId = "raspberry" | "grape" | "lagoon" | "moss" | "honey" | "petrol";
export type Mode = "light" | "dark" | "auto";
/** The concrete light/dark value after resolving `auto`. */
export type ResolvedMode = "light" | "dark";
export type IconWeight = PhosphorWeight;

export interface Skin {
  id: SkinId;
  /** Display name (the `paper` skin is shown as "Doodle"). */
  name: string;
  /** One-line, plain-language description for the Appearance picker. */
  description: string;
  /** Phosphor icon weight this skin renders Icon.* in. */
  iconWeight: IconWeight;
  /** [display, body] Google font families from the skin's META line. */
  fonts: [string, string];
  defaultPalette: PaletteId;
}

export interface Palette {
  id: PaletteId;
  label: string;
  /** Swatch colors for the Appearance picker (from design/skins/base.css). */
  brandLight: string;
  brandDark: string;
  accentLight: string;
}

/* Registries — skin facts come from the META line of design/skins/skin-*.css. */
export const SKINS: readonly Skin[] = [
  { id: "soft", name: "Soft Depth", description: "Calm surfaces with soft depth", iconWeight: "bold", fonts: ["Bricolage Grotesque", "Plus Jakarta Sans"], defaultPalette: "honey" },
  { id: "play", name: "Bold Play", description: "Chunky outlines and pop energy", iconWeight: "bold", fonts: ["Baloo 2", "Nunito"], defaultPalette: "raspberry" },
  { id: "paper", name: "Doodle", description: "Hand-drawn, notebook feel", iconWeight: "bold", fonts: ["Caveat Brush", "Kalam"], defaultPalette: "honey" },
  { id: "clay", name: "Clay", description: "Rounded, friendly shapes", iconWeight: "fill", fonts: ["Fredoka", "Nunito"], defaultPalette: "grape" },
  { id: "scrap", name: "Scrapbook", description: "Cut paper and taped notes", iconWeight: "bold", fonts: ["Nunito", "Nunito"], defaultPalette: "lagoon" },
];

export const PALETTES: readonly Palette[] = [
  { id: "raspberry", label: "Raspberry", brandLight: "#DE1E6A", brandDark: "#FF4F8F", accentLight: "#FFB020" },
  { id: "grape", label: "Grape", brandLight: "#7C2FEB", brandDark: "#A474FF", accentLight: "#18C4B8" },
  { id: "lagoon", label: "Lagoon", brandLight: "#0C9B8A", brandDark: "#2BD4BD", accentLight: "#FFC53D" },
  { id: "moss", label: "Moss", brandLight: "#2E7D4E", brandDark: "#5FC287", accentLight: "#FF7AA8" },
  { id: "honey", label: "Honey", brandLight: "#C98600", brandDark: "#FFB627", accentLight: "#DE1E6A" },
  { id: "petrol", label: "Petrol", brandLight: "#146B8C", brandDark: "#4FB6DB", accentLight: "#FF6B9D" },
];

export interface Look {
  skin: SkinId;
  palette: PaletteId;
  mode: Mode;
}

export const DEFAULT_LOOK: Look = { skin: "soft", palette: "honey", mode: "auto" };

export const LOOK_STORAGE_KEY = "giggle.look";
/** Legacy key from the pre-skins theme picker. Kept read-only for migration. */
export const LEGACY_THEME_STORAGE_KEY = "giggle.theme";

const SKIN_IDS = new Set<string>(SKINS.map((s) => s.id));
const PALETTE_IDS = new Set<string>(PALETTES.map((p) => p.id));
const MODES = new Set<string>(["light", "dark", "auto"]);

export function isSkinId(value: unknown): value is SkinId {
  return typeof value === "string" && SKIN_IDS.has(value);
}
export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === "string" && PALETTE_IDS.has(value);
}
export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && MODES.has(value);
}

/**
 * Validate an unknown value as a (possibly partial) look. Accepts a JSON
 * string or an already-parsed object; unknown ids and junk fields fall back
 * to the defaults rather than throwing, so bad localStorage can never break
 * startup. Returns null for values that carry no usable fields at all.
 */
export function parseLook(value: unknown): Partial<Look> | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const out: Partial<Look> = {};
  if (isSkinId(raw.skin)) out.skin = raw.skin;
  if (isPaletteId(raw.palette)) out.palette = raw.palette;
  if (isMode(raw.mode)) out.mode = raw.mode;
  return Object.keys(out).length ? out : null;
}

/**
 * Map an old giggle.theme value onto look fields.
 * dark/light keep their mode; together/tangerine (and junk) → null (defaults).
 */
export function migrateTheme(value: unknown): Partial<Look> | null {
  if (value === "dark") return { mode: "dark" };
  if (value === "light") return { mode: "light" };
  return null;
}

/** The full validated look: stored giggle.look, else migrated giggle.theme, else defaults. */
export function readLook(): Look {
  let stored: Partial<Look> | null = null;
  try {
    stored = parseLook(localStorage.getItem(LOOK_STORAGE_KEY));
    if (!stored) stored = migrateTheme(localStorage.getItem(LEGACY_THEME_STORAGE_KEY));
  } catch {
    stored = null;
  }
  return { ...DEFAULT_LOOK, ...(stored ?? {}) };
}

export function writeLook(look: Look): void {
  try {
    localStorage.setItem(LOOK_STORAGE_KEY, JSON.stringify(look));
  } catch {}
}

/** Resolve `auto` against prefers-color-scheme (light when unavailable, e.g. SSR). */
export function resolveMode(mode: Mode): ResolvedMode {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

/**
 * Apply a look to the document: data-skin / data-palette / data-mode (the
 * RESOLVED light/dark) on <html>. Also keeps setting the legacy data-theme
 * attribute to the resolved mode so existing [data-theme] CSS keeps working
 * until every screen is ported. Persists the look. Returns the resolved mode.
 */
export function applyLook(look: Look): ResolvedMode {
  const next: Look = isSkinId(look.skin) && isPaletteId(look.palette) && isMode(look.mode)
    ? look
    : readLook();
  writeLook(next);
  cache = next;
  const resolved = resolveMode(next.mode);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.setAttribute("data-skin", next.skin);
    root.setAttribute("data-palette", next.palette);
    root.setAttribute("data-mode", resolved);
    // Legacy bridge: existing dark/light CSS keys off data-theme.
    root.setAttribute("data-theme", resolved);
  }
  watchSystemMode();
  emitChange();
  return resolved;
}

/* ── useLook(): live look state, mirroring components/useTheme.ts ── */

let cache: Look | null = null;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

/** Refresh the snapshot cache; returns true when the stored look changed. */
function refreshCache(): boolean {
  const next = readLook();
  if (cache && sameLook(cache, next)) return false;
  cache = next;
  return true;
}

function sameLook(a: Look, b: Look): boolean {
  return a.skin === b.skin && a.palette === b.palette && a.mode === b.mode;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // External writers (e.g. devtools) mutate attributes/storage; observe both.
  const observer = typeof MutationObserver !== "undefined"
    ? new MutationObserver(() => { if (refreshCache()) onChange(); })
    : null;
  if (observer) {
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-skin", "data-palette", "data-mode"],
    });
  }
  const stop = watchSystemMode();
  return () => {
    listeners.delete(onChange);
    observer?.disconnect();
    stop();
  };
}

function getSnapshot(): Look {
  if (!cache) cache = readLook();
  return cache;
}

/**
 * Live look. SSR-safe: the server snapshot is DEFAULT_LOOK (theme-init.js
 * applies the real look before first paint, so hydration settles at once).
 * Re-renders on applyLook and — when mode is `auto` — on system changes.
 */
export function useLook(): Look {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_LOOK);
}

/* Auto mode follows the OS live: one shared listener re-applies the stored
   look whenever prefers-color-scheme flips (no-op for light/dark modes). */
let systemStop: (() => void) | null = null;

function watchSystemMode(): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  if (!systemStop) {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const current = getSnapshot();
      if (current.mode === "auto") applyLook(current);
    };
    if (typeof query.addEventListener === "function") query.addEventListener("change", onChange);
    else query.addListener(onChange);
    systemStop = () => {
      if (typeof query.removeEventListener === "function") query.removeEventListener("change", onChange);
      else query.removeListener(onChange);
    };
  }
  return () => {};
}
