"use client";
import { CSSProperties, ReactNode } from "react";

export type BadgeTone = "live" | "open" | "full" | "info" | "error";

export interface BadgeProps {
  children: ReactNode;
  tone: BadgeTone;
  style?: CSSProperties;
}

/* Tinted-pill pairs (Design System v3, spec 04): soft tint bg + strong tone
   text. Never bare lime text — live pairs the dot-lime tint with the darker
   --lime-text tier. */
const TONES: Record<BadgeTone, { bg: string; color: string; dot?: boolean }> = {
  live: { bg: "var(--live-soft)", color: "var(--lime-text)", dot: true },
  open: { bg: "var(--sky-soft)", color: "var(--sky)" },
  full: { bg: "var(--surface-2)", color: "var(--text-muted)" },
  info: { bg: "var(--accent-soft)", color: "var(--accent)" },
  error: { bg: "var(--coral-soft)", color: "var(--coral)" },
};

/** Tinted status badge (LIVE / OPEN / FULL / info / error). */
export function Badge({ children, tone, style }: BadgeProps) {
  const t = TONES[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        borderRadius: 8,
        padding: "4px 9px",
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: "0.04em",
        fontFamily: "var(--font-body)",
        background: t.bg,
        color: t.color,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {t.dot && (
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: "var(--lime)",
            flexShrink: 0,
          }}
        />
      )}
      {children}
    </span>
  );
}
