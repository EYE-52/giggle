// Giggle "Vibrant Dark" design tokens — single source of truth for both apps.

export const colors = {
  bg: "#0B0B0F",
  bgDeep: "#060609",
  surface: "#16161E",
  surfaceGlass: "rgba(22,22,30,0.7)",
  border: "rgba(255,255,255,0.09)",
  borderStrong: "rgba(255,255,255,0.16)",
  violet: "#7C5CFF",
  violetDeep: "#5436c9",
  violetSoft: "rgba(124,92,255,0.14)",
  lime: "#C2FF3D",
  limeSoft: "rgba(194,255,61,0.14)",
  coral: "#FF5C5C",
  coralSoft: "rgba(255,92,92,0.14)",
  textPrimary: "#F4F4F7",
  textSecondary: "#9A9AB0",
  textTertiary: "#6E6E84",
  // accent palette used for avatars / squads
  avatar: ["#7C5CFF", "#3DD6C0", "#FF8A5C", "#C2FF3D", "#FF5C8A", "#5C8CFF", "#FFC65C", "#9B7CFF"],
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
  violet: "0 0 34px -6px rgba(124,92,255,0.6)",
  lime: "0 0 30px -4px rgba(194,255,61,0.5)",
} as const;

export const tokens = { colors, radii, space, font, type, glow };
export default tokens;
