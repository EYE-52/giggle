"use client";
import { colors, radii } from "@giggle/ui-tokens";
import { CSSProperties, ReactNode } from "react";

interface AvatarProps {
  name: string;
  size?: number;
  colorIndex?: number;
  ring?: boolean;
  online?: boolean;
  style?: CSSProperties;
}

/**
 * Wraps an avatar element with a presence status dot when
 * `online` is true. Used by both Avatar (initials) and AvatarArt.
 */
export function OnlineWrap({ children, size, online }: { children: ReactNode; size: number; online?: boolean }) {
  if (!online) return <>{children}</>;
  const dot = Math.max(8, Math.round(size * 0.28));
  return (
    <div style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      {children}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          right: -1,
          bottom: -1,
          width: dot,
          height: dot,
          borderRadius: radii.pill,
          background: "var(--live)",
          border: "2px solid var(--surface)",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}

/** Stable palette slot for a name, so one person keeps one color everywhere. */
function nameColorIndex(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash;
}

// Paired gradient stops per avatar accent for a premium, dimensional look.
const GRADIENTS: Record<string, [string, string, string]> = {
  "#7657FF": ["#9278FF", "#5536CC", "#fff"],
  "#2FE6C8": ["#5BE8D4", "#1F9A8A", "#06241f"],
  "#B7FF2A": ["#D4FF6E", "#8FCF12", "#162400"],
  "#9278FF": ["#B49BFF", "#6344C2", "#fff"],
  "#7C5CFF": ["#9B7CFF", "#5436C9", "#fff"],
  "#3DD6C0": ["#5BE8D4", "#1F9A8A", "#06241f"],
  "#FF8A5C": ["#FFA877", "#D85E34", "#fff"],
  "#C2FF3D": ["#D4FF6E", "#8FCF12", "#162400"],
  "#FF5C8A": ["#FF7BA3", "#C2306B", "#fff"],
  "#5C8CFF": ["#7BA3FF", "#2F5BD4", "#fff"],
  "#FFC65C": ["#FFD787", "#D49A23", "#3a2a00"],
  "#9B7CFF": ["#B49BFF", "#6344C2", "#fff"],
};

export function Avatar({ name, size = 40, colorIndex, ring = false, online, style }: AvatarProps) {
  const base = colors.avatar[(colorIndex ?? nameColorIndex(name || "")) % colors.avatar.length];
  const [from, to, fg] = GRADIENTS[base] ?? [base, base, "#fff"];
  const initial = name ? name[0].toUpperCase() : "?";
  return (
    <OnlineWrap size={size} online={online}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: radii.pill,
          background: `linear-gradient(150deg, ${from}, ${to})`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: size * 0.42,
          color: fg,
          flexShrink: 0,
          boxShadow: ring && !online ? "0 0 0 2px var(--surface)" : undefined,
          ...style,
        }}
      >
        {initial}
      </div>
    </OnlineWrap>
  );
}

/** Overlapping avatar stack (e.g. "+12"). */
export function AvatarStack({
  names,
  size = 30,
  extra,
  total,
  max = 4,
}: {
  names: string[];
  size?: number;
  /** Explicit overflow count (legacy API). Ignored when `total` is set. */
  extra?: number;
  /** Total people in the group; overflow is derived as total − shown. */
  total?: number;
  /** Max avatars to render before collapsing the rest into the +N badge. */
  max?: number;
}) {
  // When `total` is provided, the count is correct-by-construction: cap the
  // visible avatars and derive the remainder. Otherwise fall back to the
  // explicit `extra` (existing call sites pass extra={0} to show all names).
  const usesTotal = total != null;
  const shown = usesTotal ? names.slice(0, max) : names;
  const overflow = usesTotal ? Math.max(0, total - shown.length) : (extra ?? 0);
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      {shown.map((n, i) => (
        <div key={i} style={{ marginLeft: i === 0 ? 0 : -size * 0.32 }}>
          <Avatar name={n} size={size} colorIndex={i} ring />
        </div>
      ))}
      {overflow > 0 ? (
        <div
          style={{
            marginLeft: -size * 0.32,
            width: size,
            height: size,
            borderRadius: radii.pill,
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            boxShadow: "0 0 0 2px var(--bg)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontWeight: 700,
            fontSize: size * 0.34,
            color: "var(--text-body)",
          }}
        >
          +{overflow}
        </div>
      ) : null}
    </div>
  );
}
