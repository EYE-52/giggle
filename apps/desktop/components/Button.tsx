"use client";
import { CSSProperties, MouseEvent, ReactNode } from "react";

export type ButtonVariant = "primary" | "tonal" | "secondary" | "ghost" | "danger";

export interface ButtonProps {
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /**
   * Five intents (Design System v3, spec 03):
   *  primary   — solid accent, colored glow, hover darken + lift (ONE per view)
   *  tonal     — accent-soft fill + accent text (replaces most old "secondary")
   *  secondary — surface + border
   *  ghost     — transparent
   *  danger    — tonal coral (coral-soft bg + coral text), never solid red
   * Back-compat: the old solid "danger" maps to the new tonal danger.
   */
  variant?: ButtonVariant;
  size?: "sm" | "md";
  fullWidth?: boolean;
  /** Shows the branded spinner and disables the button (width stays stable). */
  loading?: boolean;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
  style?: CSSProperties;
  "aria-label"?: string;
}

const SIZES: Record<"sm" | "md", CSSProperties> = {
  sm: { minHeight: 36, padding: "0 16px", fontSize: 13 },
  md: { minHeight: 44, padding: "0 24px", fontSize: 14 },
};

/* Colors/borders/shadows live in globals.css (.gg-btn--*) so :hover works. */
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "gg-btn--primary",
  tonal: "gg-btn--tonal",
  secondary: "gg-btn--secondary",
  ghost: "gg-btn--ghost",
  danger: "gg-btn--danger",
};

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  fullWidth,
  loading = false,
  disabled,
  type = "button",
  style,
  "aria-label": ariaLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: "var(--radius-btn)",
    fontFamily: "var(--font-body)",
    fontWeight: 600,
    cursor: isDisabled ? "not-allowed" : "pointer",
    width: fullWidth ? "100%" : undefined,
    opacity: isDisabled ? 0.55 : 1,
    whiteSpace: "nowrap",
    boxSizing: "border-box",
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className={`gg-press gg-focusable ${VARIANT_CLASS[variant]}`}
      style={{ ...base, ...SIZES[size], ...style }}
    >
      {loading && <span className="gg-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
