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
 *
 * Colors live in globals.css (.gg-chip / .gg-chip--on) so the skin system's
 * `chip` / `is-on` hooks (app/skins/*.css) can restyle them.
 */
export function Chip({ children, onClick, selected = false, onRemove, removeLabel, disabled, style }: ChipProps) {
  const shellClasses = `gg-chip chip${selected ? " gg-chip--on is-on" : ""}${disabled ? " gg-chip--disabled" : ""}`;

  const removeButton = onRemove ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      disabled={disabled}
      aria-label={removeLabel ?? "Remove"}
      className="gg-press gg-focusable gg-chip-remove"
    >
      <Icon.close size={12} color="currentColor" />
    </button>
  ) : null;

  if (onClick) {
    return (
      <span className="gg-chip-wrap">
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-pressed={selected}
          className={`gg-press gg-focusable ${shellClasses}`}
          style={style}
        >
          {children}
          {removeButton}
        </button>
      </span>
    );
  }

  return (
    <span className={shellClasses} style={style}>
      {children}
      {removeButton}
    </span>
  );
}
