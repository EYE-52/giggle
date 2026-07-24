"use client";
import type React from "react";

/**
 * Compact, inline empty state. Replaces the page-dominating dashed mega-boxes
 * that used to say "nothing here" with maximum visual weight. Visual weight
 * should track information value — an empty section is low-value, so this stays
 * small and simply points at the next best action.
 */
export function EmptyState({
  icon,
  title,
  body,
  primary,
  secondary,
  compact = false,
  accentColor = "var(--accent)",
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  primary?: { label: string; onClick: () => void; disabled?: boolean };
  secondary?: { label: string; onClick: () => void; disabled?: boolean };
  /** When true, renders as a single tight row (for rails/panels). */
  compact?: boolean;
  /** Icon color inside the accent-soft tile. Default `var(--accent)`. */
  accentColor?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: compact ? "row" : "column",
        alignItems: "center",
        justifyContent: compact ? "flex-start" : "center",
        textAlign: compact ? "left" : "center",
        gap: compact ? 12 : 10,
        padding: compact ? "14px 16px" : "30px 24px",
        borderRadius: "var(--radius-tile)",
        border: "var(--border-w) solid var(--border)",
        background: "var(--surface)",
      }}
    >
      {icon && (
        <div
          style={{
            width: compact ? 34 : 42,
            height: compact ? 34 : 42,
            borderRadius: 12,
            display: "grid",
            placeItems: "center",
            /* v3: tinted icon tile — accent-soft fill, accent glyph. */
            background: "var(--accent-soft)",
            color: accentColor,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      )}
      <div style={{ flex: compact ? 1 : undefined, minWidth: 0 }}>
        <div style={{ color: "var(--text)", fontSize: compact ? 13 : 14, fontWeight: 700 }}>
          {title}
        </div>
        {body && (
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: compact ? 12 : 13,
              marginTop: 3,
              lineHeight: 1.45,
            }}
          >
            {body}
          </div>
        )}
      </div>
      {(primary || secondary) && (
        <div style={{ display: "flex", gap: 8, marginTop: compact ? 0 : 6, flexShrink: 0, flexWrap: compact ? "wrap" : undefined, justifyContent: "flex-end" }}>
          {secondary && (
            <button
              onClick={secondary.onClick}
              disabled={secondary.disabled}
              className="gg-press"
              style={{
                height: 40,
                padding: "0 16px",
                borderRadius: "var(--radius-btn)",
                border: "var(--border-w) solid var(--border-strong)",
                background: "transparent",
                color: "var(--text)",
                fontSize: 13,
                fontWeight: 600,
                cursor: secondary.disabled ? "default" : "pointer",
                opacity: secondary.disabled ? 0.6 : 1,
              }}
            >
              {secondary.label}
            </button>
          )}
          {primary && (
            <button
              onClick={primary.onClick}
              disabled={primary.disabled}
              className="gg-press"
              style={{
                height: 40,
                padding: "0 18px",
                borderRadius: "var(--radius-btn)",
                border: "var(--btn-primary-border)",
                background: "var(--accent)",
                color: "var(--accent-contrast)",
                fontSize: 13,
                fontWeight: 700,
                cursor: primary.disabled ? "default" : "pointer",
                opacity: primary.disabled ? 0.7 : 1,
                boxShadow: "var(--btn-primary-shadow)",
              }}
            >
              {primary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
