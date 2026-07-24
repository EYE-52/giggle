"use client";
/**
 * Theme-aware squad cover system.
 *
 * The preset gradients in @giggle/core were designed for the dark theme; on
 * light themes (e.g. "tangerine") they read as heavy dark slabs. This module
 * keeps the dark covers byte-identical and adds a BRIGHT twin for every preset
 * gradient — same hue family, pastel/vivid over a light base — plus bright
 * twins of the deterministic fallback gradients used when a squad has no cover.
 *
 * Selection model:
 *   theme id → coverStyle ("dark" | "light") via the THEMES registry
 *   photo / uploaded covers → ALWAYS treated as "dark" (photos need a dark
 *   scrim + white text in every theme); only generated gradients switch.
 */
import { PRESET_COVERS, resolveCover, coverSwatch } from "@giggle/core";
import { THEMES, type ThemeId } from "@/components/ThemeToggle";

export type CoverStyle = "dark" | "light";

/** coverStyle for a theme id, falling back to "dark" for unknown ids. */
export function themeCoverStyle(themeId: ThemeId | string): CoverStyle {
  return THEMES.find((t) => t.id === themeId)?.coverStyle ?? "dark";
}

/** True when the cover is a real image (preset photo, upload, or URL). */
export function isPhotoCover(coverImage?: string | null): boolean {
  if (!coverImage) return false;
  const preset = PRESET_COVERS.find((p) => p.id === coverImage);
  if (preset) return preset.type === "photo";
  return (
    coverImage.startsWith("data:") ||
    coverImage.startsWith("https://") ||
    coverImage.startsWith("http://")
  );
}

/**
 * Effective render style for one cover in one theme: photos are always "dark"
 * (dark scrim + white text); gradients follow the theme's coverStyle.
 */
export function coverKind(coverImage: string | null | undefined, themeId: ThemeId | string): CoverStyle {
  if (isPhotoCover(coverImage)) return "dark";
  return themeCoverStyle(themeId);
}

/* ── Bright twins of every preset gradient (same hue family, light base) ── */
// Confident duotone pastels (~55% saturation) that harmonize with the violet
// accent — rich enough to read as intentional on both white (#F6F7FB light bg)
// and the tangerine theme's ice-blue paper (#E7EFFF), never near-white washes.
// v3 (spec 06): vivid, confident two-hue duotones — the #7C5CFF→#5EC9F8
// (iris→sky) and #FF8FB1→#FFC96B (rose→peach) families — never pastel washes.
const BRIGHT_PRESETS: Record<string, string> = {
  "grad-aurora": "linear-gradient(120deg, #7C5CFF 0%, #5EC9F8 100%)",
  "grad-neon": "linear-gradient(120deg, #8AE24C 0%, #38CBF0 100%)",
  "grad-sunset": "linear-gradient(120deg, #FF8FB1 0%, #FFC96B 100%)",
  "grad-cyber": "linear-gradient(120deg, #9F7BFF 0%, #5B8CFF 100%)",
  "grad-velvet": "linear-gradient(120deg, #D46BF0 0%, #8B5CF6 100%)",
  "grad-lagoon": "linear-gradient(120deg, #38BDF8 0%, #2DD4BF 100%)",
  "grad-ember": "linear-gradient(120deg, #FF7A6B 0%, #FFB84C 100%)",
  "grad-frost": "linear-gradient(120deg, #5EC9F8 0%, #8B9CFF 100%)",
  "grad-mardi": "linear-gradient(120deg, #9F7BFF 0%, #FF8FB1 100%)",
  "grad-galaxy": "linear-gradient(120deg, #6D52FF 0%, #4CC3FF 100%)",
  "grad-citrus": "linear-gradient(120deg, #B8E24C 0%, #FFB84C 100%)",
  "grad-orchid": "linear-gradient(120deg, #FF8FD4 0%, #7C5CFF 100%)",
};

// Bright twin of the core DEFAULT_COVER (aurora family).
const BRIGHT_DEFAULT = BRIGHT_PRESETS["grad-aurora"];

/**
 * Resolve a coverImage value to a CSS `background`, picking the dark or bright
 * variant of preset gradients by `kind`. Photos/uploads are returned as-is in
 * both kinds (only generated gradients switch).
 */
export function coverBackground(coverImage: string | null | undefined, kind: CoverStyle): string {
  if (kind === "dark") return resolveCover(coverImage);
  if (!coverImage) return BRIGHT_DEFAULT;
  const bright = BRIGHT_PRESETS[coverImage];
  if (bright) return bright;
  return resolveCover(coverImage); // photos, uploads, unknown ids
}

/** Theme-aware swatch chip (always a gradient; photos fall back to default). */
export function coverSwatchBackground(coverImage: string | null | undefined, kind: CoverStyle): string {
  if (kind === "dark") return coverSwatch(coverImage);
  if (coverImage && BRIGHT_PRESETS[coverImage]) return BRIGHT_PRESETS[coverImage];
  return BRIGHT_DEFAULT;
}

/* ── Deterministic fallback gradients (squads with no cover) ─────────────── */
// Dark set: byte-identical to the previous per-file arrays (SquadCard /
// SquadPreview). Bright set: same four hue families over a near-white base.
const DARK_FALLBACKS = [
  "radial-gradient(120% 90% at 20% 10%, rgba(255,92,138,0.55), transparent 55%), radial-gradient(120% 90% at 90% 80%, rgba(118,87,255,0.6), transparent 55%), linear-gradient(160deg, #2a1140, #0b0b0f)",
  "radial-gradient(120% 90% at 80% 10%, rgba(92,140,255,0.5), transparent 55%), radial-gradient(120% 90% at 10% 90%, rgba(61,214,192,0.45), transparent 55%), linear-gradient(160deg, #10243a, #0b0b0f)",
  "radial-gradient(120% 90% at 30% 20%, rgba(183,255,42,0.4), transparent 55%), radial-gradient(120% 90% at 80% 90%, rgba(118,87,255,0.55), transparent 55%), linear-gradient(160deg, #1a2a12, #0b0b0f)",
  "radial-gradient(120% 90% at 70% 15%, rgba(255,176,32,0.45), transparent 55%), radial-gradient(120% 90% at 15% 85%, rgba(255,92,138,0.5), transparent 55%), linear-gradient(160deg, #2e1a10, #0b0b0f)",
];
// Same four hue families, but confident duotones (spec 06 families).
const BRIGHT_FALLBACKS = [
  "linear-gradient(120deg, #FF8FB1 0%, #9F7BFF 100%)",
  "linear-gradient(120deg, #5EC9F8 0%, #2DD4BF 100%)",
  "linear-gradient(120deg, #8AE24C 0%, #7C5CFF 100%)",
  "linear-gradient(120deg, #FFC96B 0%, #FF8FB1 100%)",
];

/** Deterministic per-squad fallback gradient (same hash as before). */
export function fallbackGradient(key: string, kind: CoverStyle): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  const list = kind === "light" ? BRIGHT_FALLBACKS : DARK_FALLBACKS;
  return list[h % list.length];
}

/* ── Companion ink + scrim tokens for text rendered over a cover ─────────── */
export interface CoverInk {
  /** Primary text color over the cover. */
  text: string;
  /** Secondary/soft text color. */
  textSoft: string;
  /** Muted/tertiary text color. */
  textMuted: string;
  /** "r,g,b" base for building scrim rgba() stops. */
  scrimRgb: string;
  /** Bottom legibility scrim (card-style: strong at bottom, clear at top). */
  bottomScrim: string;
}

const DARK_INK: CoverInk = {
  text: "#F4F4F7",
  textSoft: "#E7E7F0",
  textMuted: "#C9C9DA",
  scrimRgb: "7,7,11",
  bottomScrim:
    "linear-gradient(to top, rgba(7,7,11,0.97) 16%, rgba(7,7,11,0.62) 52%, rgba(7,7,11,0.14) 78%)",
};

const LIGHT_INK: CoverInk = {
  text: "#14121A",
  textSoft: "#2A2233",
  textMuted: "#45405A",
  scrimRgb: "255,255,255",
  // Stronger than before: the richer duotone covers need a firmer white
  // scrim so ink text keeps AA contrast at the bottom of the card.
  bottomScrim:
    "linear-gradient(to top, rgba(255,255,255,0.97) 16%, rgba(255,255,255,0.7) 52%, rgba(255,255,255,0.16) 78%)",
};

export function coverInk(kind: CoverStyle): CoverInk {
  return kind === "light" ? LIGHT_INK : DARK_INK;
}
