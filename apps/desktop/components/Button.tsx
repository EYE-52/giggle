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
  /** Additive class hook (skin-port hooks / CSS modules) alongside the base classes. */
  className?: string;
  "aria-label"?: string;
}

/* Colors/borders/shadows live in globals.css (.gg-btn--*) so :hover works.
 * Base geometry lives in the .gg-btn / .gg-btn--sm / .gg-btn--wide classes so
 * the skin system (.btn / .btn-* in app/skins/*.css) can restyle buttons.
 * The mock skin classes (btn, btn-primary, …) are additive hooks. */
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "gg-btn--primary btn-primary",
  tonal: "gg-btn--tonal btn-tonal",
  secondary: "gg-btn--secondary btn-secondary",
  ghost: "gg-btn--ghost btn-ghost",
  danger: "gg-btn--danger btn-danger",
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
  className,
  "aria-label": ariaLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const classes = [
    "gg-press",
    "gg-focusable",
    "gg-btn",
    "btn",
    VARIANT_CLASS[variant],
    size === "sm" ? "gg-btn--sm small" : "gg-btn--md",
  ];
  if (fullWidth) classes.push("gg-btn--wide wide");
  if (className) classes.push(className);

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      aria-label={ariaLabel}
      aria-busy={loading || undefined}
      className={classes.join(" ")}
      style={style}
    >
      {loading && <span className="gg-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
