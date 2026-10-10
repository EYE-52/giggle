"use client";
import type { RefObject } from "react";
import styles from "./FloatingCallTools.module.css";

export type CallCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

// Controls the existing media container. No portal, new stream or call client.
export function FloatingCallTools({ corner, onCornerChange, onCollapse, hideButtonRef }: {
  corner: CallCorner;
  onCornerChange: (corner: CallCorner) => void;
  onCollapse: () => void;
  hideButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  return <div className={styles.tools} data-testid="floating-call-tools">
    <select aria-label="Floating call corner" value={corner}
      onChange={event => onCornerChange(event.target.value as CallCorner)}>
      <option value="top-left">Top left</option>
      <option value="top-right">Top right</option>
      <option value="bottom-left">Bottom left</option>
      <option value="bottom-right">Bottom right</option>
    </select>
    <button ref={hideButtonRef} type="button" aria-expanded={true} onClick={onCollapse}
      aria-label="Collapse floating call" title="Hide video tiles. The call stays on.">
      Hide
    </button>
  </div>;
}
