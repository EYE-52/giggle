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

/**
 * Accessible switch: role="switch" + aria-checked, 44px min touch target,
 * keyboard focus ring on the track (via .gg-switch / .gg-switch-track CSS in
 * globals.css), animated thumb that honors reduced motion.
 *
 * The thumb is the track's ::after pseudo-element (positioned with `left`,
 * translated when checked) so the ported skins — which style the mock's
 * `.switch span::after` — can restyle it. Track/thumb geometry lives in the
 * .gg-switch-track rules in globals.css.
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
      className={`gg-switch gg-press switch${disabled ? " gg-switch--disabled" : ""}`}
      style={style}
    >
      <span aria-hidden="true" className="gg-switch-track" />
    </button>
  );
}
