"use client";
import { CSSProperties, ReactNode } from "react";

export type BadgeTone = "live" | "open" | "full" | "info" | "error";

export interface BadgeProps {
  children: ReactNode;
  tone: BadgeTone;
  style?: CSSProperties;
}

/* Tinted-pill pairs (Design System v3, spec 04): soft tint bg + strong tone
 * text. Never bare lime text — live pairs the dot-lime tint with the darker
 * --lime-text tier. Colors live in globals.css (.gg-badge--<tone>) so the
 * skin system's `badge` hook can restyle them. */
const TONE_CLASS: Record<BadgeTone, string> = {
  live: "gg-badge--live",
  open: "gg-badge--open",
  full: "gg-badge--full",
  info: "gg-badge--info",
  error: "gg-badge--error",
};

/** Tinted status badge (LIVE / OPEN / FULL / info / error). */
export function Badge({ children, tone, style }: BadgeProps) {
  return (
    <span className={`gg-badge badge ${TONE_CLASS[tone]}`} style={style}>
      {tone === "live" && <span aria-hidden="true" className="gg-badge-dot" />}
      {children}
    </span>
  );
}
