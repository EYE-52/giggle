// Approved Giggle palette. Legacy accent names keep existing components compatible.
export const brand = {
  background: "#faf7f2",
  paper: "#fffdf9",
  peach: "#f4e1d5",
  sage: "#e7ebdf",
  accent: "#ba4b33",
  accentPressed: "#a33d29",
  ink: "#252323",
  muted: "#69645e",
  line: "#ded8cf",
  success: "#477950",
  danger: "#ac392c",
} as const;
export const colors = {
  bg: brand.background,
  bgDeep: "#f1ece4",
  surface: brand.paper,
  surfaceGlass: "rgba(255,253,249,0.94)",
  border: brand.line,
  borderStrong: "#c9c0b5",
  violet: brand.accent,
  violetDeep: brand.accentPressed,
  violetSoft: brand.peach,
  lime: brand.success,
  limeSoft: brand.sage,
  coral: brand.danger,
  coralSoft: "#fae5df",
  textPrimary: brand.ink,
  textSecondary: brand.muted,
  textTertiary: "#756d64",
  avatar: ["#a75440", "#507f72", "#af7048", "#72864d", "#a34e70", "#586f99", "#a37b30", "#82709b"],
} as const;
export const callColors = {
  ...colors,
  bg: "#242323",
  bgDeep: "#1b1b1a",
  surface: "#33312f",
  surfaceGlass: "rgba(51,49,47,0.94)",
  border: "#494640",
  borderStrong: "#645f57",
  violet: "#ed947b",
  violetSoft: "#50372e",
  lime: "#a6c59a",
  limeSoft: "#354533",
  coral: "#f29682",
  coralSoft: "#583a34",
  textPrimary: "#faf7f2",
  textSecondary: "#c5beb3",
  textTertiary: "#aca497",
} as const;
export const radii = { input: 12, card: 22, pill: 999, tile: 16 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22, xxl: 32 } as const;
export const font = { heading: "Cabinet Grotesk", body: "Cabinet Grotesk" } as const;
export const type = { h1: 36, h2: 28, h3: 21, title: 17, body: 16, small: 14, tiny: 12 } as const;
export const glow = { violet: "none", lime: "none" } as const;
export const tokens = { brand, colors, callColors, radii, space, font, type, glow };
export default tokens;

export { logoPaths, logoViewBox } from "./logo";
