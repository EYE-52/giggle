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
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  primary?: { label: string; onClick: () => void; disabled?: boolean };
  secondary?: { label: string; onClick: () => void; disabled?: boolean };
  /** When true, renders as a single tight row (for rails/panels). */
  compact?: boolean;
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
        borderRadius: 16,
        border: "1px solid var(--border)",
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
            background: "var(--overlay)",
            boxShadow: "inset 0 0 0 1px var(--border)",
            color: "var(--text-dim)",
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      )}
      <div style={{ flex: compact ? 1 : undefined, minWidth: 0 }}>
        <div style={{ color: "var(--text)", fontSize: compact ? 13.5 : 15, fontWeight: 700 }}>
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
        <div style={{ display: "flex", gap: 8, marginTop: compact ? 0 : 6, flexShrink: 0 }}>
          {secondary && (
            <button
              onClick={secondary.onClick}
              disabled={secondary.disabled}
              className="gg-press"
              style={{
                height: 40,
                padding: "0 16px",
                borderRadius: 999,
                border: "1px solid var(--border-strong)",
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
                borderRadius: 999,
                border: "none",
                background: "var(--violet)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                cursor: primary.disabled ? "default" : "pointer",
                opacity: primary.disabled ? 0.7 : 1,
                boxShadow: "0 0 20px -8px rgba(118,87,255,0.8)",
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
