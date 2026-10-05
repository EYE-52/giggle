"use client";
import styles from "./FloatingCallTools.module.css";

export type CallCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

// Controls the existing media container. No portal, new stream or call client.
export function FloatingCallTools({ corner, collapsed, onCornerChange, onToggle }: {
  corner: CallCorner;
  collapsed: boolean;
  onCornerChange: (corner: CallCorner) => void;
  onToggle: () => void;
}) {
  return <div className={styles.tools} data-testid="floating-call-tools">
    <select aria-label="Floating call corner" value={corner}
      onChange={event => onCornerChange(event.target.value as CallCorner)}>
      <option value="top-left">Top left</option>
      <option value="top-right">Top right</option>
      <option value="bottom-left">Bottom left</option>
      <option value="bottom-right">Bottom right</option>
    </select>
    <button type="button" aria-expanded={!collapsed} onClick={onToggle}
      aria-label={collapsed ? "Expand floating call" : "Collapse floating call"}
      title={collapsed ? "Show your friends. The call is still on." : "Hide video tiles. The call stays on."}>
      {collapsed ? "Friends" : "Hide"}
    </button>
  </div>;
}
