"use client";
import { CSSProperties, ReactNode } from "react";

export interface StatTileProps {
  label: string;
  value: ReactNode;
  /** Live variant: tinted --live-soft tile, pulsing dot, live-colored value. */
  live?: boolean;
  icon?: ReactNode;
  style?: CSSProperties;
}

/**
 * Stat tile (Design System v3, spec 04). Replaces gray uppercase
 * micro-labels: a real surface with real hierarchy — 12px/600 muted
 * label over a 24px/700 display-font value. The live variant gets a
 * pulsing dot (reduced-motion safe — the global reduce rule kills the
 * animation) and a --live-soft tinted background.
 */
export function StatTile({ label, value, live = false, icon, style }: StatTileProps) {
  return (
    <div
      style={{
        background: live ? "var(--live-soft)" : "var(--surface)",
        border: live
          ? "var(--border-w) solid color-mix(in srgb, var(--lime) 35%, var(--border))"
          : "var(--border-w) solid var(--border)",
        borderRadius: "var(--radius-control)",
        padding: "12px 16px",
        minWidth: 118,
        boxShadow: "var(--shadow-sm)",
        boxSizing: "border-box",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          fontWeight: 600,
          color: "var(--text-muted)",
          fontFamily: "var(--font-body)",
        }}
      >
        {live && (
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: "var(--lime)",
              boxShadow: "0 0 0 3px color-mix(in srgb, var(--lime) 20%, transparent)",
              animation: "gg-pulse-dot 1.6s var(--ease-inout) infinite",
              flexShrink: 0,
            }}
          />
        )}
        {icon && (
          <span aria-hidden="true" style={{ display: "inline-flex", flexShrink: 0 }}>
            {icon}
          </span>
        )}
        <span>{label}</span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 24,
          fontWeight: 700,
          lineHeight: 1.15,
          letterSpacing: "-0.01em",
          color: live ? "var(--lime-text)" : "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
