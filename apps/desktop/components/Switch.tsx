"use client";
import { CSSProperties } from "react";

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible name — required unless labelled externally via `ariaLabelledBy`. */
  ariaLabel?: string;
  ariaLabelledBy?: string;
  id?: string;
  style?: CSSProperties;
}

const TRACK_W = 44;
const TRACK_H = 26;
const THUMB = 20;

/**
 * Accessible switch: role="switch" + aria-checked, 44px min touch target,
 * keyboard focus ring on the track (via .gg-switch / .gg-switch-track CSS in
 * globals.css), animated thumb that honors reduced motion.
 */
export function Switch({ checked, onChange, disabled, ariaLabel, ariaLabelledBy, id, style }: SwitchProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="gg-switch gg-press"
      style={{
        // 44px hit area around a smaller visual track.
        minWidth: 44,
        minHeight: 44,
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        className="gg-switch-track"
        style={{
          display: "inline-flex",
          alignItems: "center",
          width: TRACK_W,
          height: TRACK_H,
          borderRadius: 999,
          padding: (TRACK_H - THUMB) / 2,
          boxSizing: "border-box",
          background: checked ? "var(--accent)" : "var(--surface-2)",
          border: checked
            ? "var(--border-w) solid transparent"
            : "var(--border-w) solid var(--border-strong)",
          transition: "background-color var(--dur) var(--ease-inout), border-color var(--dur) var(--ease-inout)",
        }}
      >
        <span
          style={{
            width: THUMB - 2,
            height: THUMB - 2,
            borderRadius: 999,
            background: checked ? "var(--on-accent)" : "var(--text-muted)",
            transform: checked ? `translateX(${TRACK_W - TRACK_H}px)` : "translateX(0)",
            transition: "transform var(--dur) var(--ease-out), background-color var(--dur) var(--ease-inout)",
          }}
        />
      </span>
    </button>
  );
}
