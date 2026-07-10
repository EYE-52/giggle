"use client";
import { colors, radii } from "./tokens";
import { CSSProperties, ReactNode, MouseEvent } from "react";

interface ButtonProps {
  children: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  fullWidth?: boolean;
  style?: CSSProperties;
  disabled?: boolean;
}

export function Button({ children, onClick, variant = "primary", fullWidth, style, disabled }: ButtonProps) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radii.pill,
    fontFamily: "Inter, sans-serif",
    fontWeight: 600,
    fontSize: 15,
    cursor: disabled ? "not-allowed" : "pointer",
    border: "none",
    outline: "none",
    padding: "12px 24px",
    width: fullWidth ? "100%" : undefined,
    opacity: disabled ? 0.5 : 1,
    transition: "opacity 0.15s, transform 0.1s",
  };

  const variants: Record<string, CSSProperties> = {
    primary: {
      background: colors.violet,
      color: "#fff",
      boxShadow: "0 0 24px -4px rgba(124,92,255,0.5)",
    },
    secondary: {
      background: colors.surface,
      color: colors.textPrimary,
      border: `1px solid ${colors.border}`,
    },
    ghost: {
      background: "transparent",
      color: colors.textSecondary,
      border: `1px solid ${colors.border}`,
    },
    danger: {
      background: colors.coral,
      color: "#fff",
    },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {children}
    </button>
  );
}
