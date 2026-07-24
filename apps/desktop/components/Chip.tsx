"use client";
import { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icons";

export interface ChipProps {
  children: ReactNode;
  /** When provided the chip is a toggle button with aria-pressed. */
  onClick?: () => void;
  selected?: boolean;
  /** When provided renders an accessible remove (✕) button. */
  onRemove?: () => void;
  /** Accessible label for the remove button, e.g. `Remove ${tag}`. */
  removeLabel?: string;
  disabled?: boolean;
  style?: CSSProperties;
}

/**
 * Selectable pill. Interactive chips (onClick) render as aria-pressed toggle
 * buttons; static chips render as spans. Removable variant adds a dedicated
 * remove button. Min height 44px for touch.
 */
export function Chip({ children, onClick, selected = false, onRemove, removeLabel, disabled, style }: ChipProps) {
  const shell: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minHeight: 44,
    padding: onRemove ? "0 6px 0 16px" : "0 16px",
    borderRadius: "var(--radius-pill)",
    fontFamily: "var(--font-body)",
    fontSize: 13,
    fontWeight: 600,
    // Spec 04: selected = solid accent chip; unselected = surface + strong border.
    background: selected ? "var(--accent)" : "var(--surface)",
    border: selected
      ? "var(--border-w) solid var(--accent)"
      : "var(--border-w) solid var(--border-strong)",
    color: selected ? "var(--accent-contrast)" : "var(--text-body)",
    opacity: disabled ? 0.5 : 1,
    boxSizing: "border-box",
    ...style,
  };

  const removeButton = onRemove ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      disabled={disabled}
      aria-label={removeLabel ?? "Remove"}
      className="gg-press gg-focusable"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: 999,
        border: "none",
        background: "transparent",
        color: "inherit",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <Icon.close size={12} color="currentColor" />
    </button>
  ) : null;

  if (onClick) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-pressed={selected}
          className="gg-press gg-focusable"
          style={{ ...shell, cursor: disabled ? "not-allowed" : "pointer" }}
        >
          {children}
          {removeButton}
        </button>
      </span>
    );
  }

  return (
    <span style={shell}>
      {children}
      {removeButton}
    </span>
  );
}
