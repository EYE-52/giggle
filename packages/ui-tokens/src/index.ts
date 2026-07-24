// Giggle "Vibrant Dark" design tokens — single source of truth for both apps.

// Values mirror app/globals.css :root (dark) — that file is the single
// source of truth; keep these hexes in sync with the CSS custom properties.
export const colors = {
  bg: "#080A0B",
  bgDeep: "#0C0F10",
  surface: "#121615",
  surfaceGlass: "rgba(18,22,21,0.7)",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",
  violet: "#7657FF",
  violetDeep: "#5536CC",
  violetSoft: "rgba(118,87,255,0.18)",
  lime: "#B7FF2A",
  limeSoft: "rgba(183,255,42,0.14)",
  coral: "#FF5C5C",
  coralSoft: "rgba(255,92,92,0.14)",
  textPrimary: "#F4F4F7",
  textSecondary: "#9A9AB0",
  textTertiary: "#6E6E84",
  // accent palette used for avatars / squads
  avatar: ["#7657FF", "#2FE6C8", "#FF8A5C", "#B7FF2A", "#FF5C8A", "#5C8CFF", "#FFC65C", "#9278FF"],
} as const;

export const radii = {
  input: 14,
  card: 20,
  pill: 999,
  tile: 16,
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 32,
} as const;

export const font = {
  heading: "Space Grotesk",
  body: "Inter",
} as const;

export const type = {
  h1: 39,
  h2: 30,
  h3: 21,
  title: 17,
  body: 15,
  small: 13,
  tiny: 11,
} as const;

export const glow = {
  violet: "0 0 34px -6px rgba(118,87,255,0.6)",
  lime: "0 0 30px -4px rgba(183,255,42,0.5)",
} as const;

export const tokens = { colors, radii, space, font, type, glow };
export default tokens;
