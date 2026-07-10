// Mobile theme re-exports the shared @giggle/ui-tokens package as the single
// source of truth. Names below (COLORS/SPACE/RADII) are the ones the screens use.
import { colors, radii, space } from '@giggle/ui-tokens';

export const COLORS = {
  bg: colors.bg,
  bgDeep: colors.bgDeep,
  surface: colors.surface,
  border: colors.border,
  violet: colors.violet,
  violetSoft: colors.violetSoft,
  lime: colors.lime,
  limeSoft: colors.limeSoft,
  coral: colors.coral,
  coralSoft: colors.coralSoft,
  text: colors.textPrimary,
  textMuted: colors.textSecondary,
  textDim: colors.textTertiary,
  avatar: colors.avatar,
} as const;

export const RADII = {
  card: radii.card,
  pill: radii.pill,
  tile: radii.tile,
  input: radii.input,
} as const;

export const SPACE = {
  xs: space.xs,
  sm: space.sm,
  md: space.md,
  lg: space.lg,
  xl: space.xl,
  xxl: space.xxl,
} as const;
