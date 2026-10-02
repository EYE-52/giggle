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
 * Wraps an avatar element with a presence status dot when `online` is true.
 * Used by both Avatar (initials) and AvatarArt. `pa` (presence avatar) and
 * `presence on` are the skin-system hooks from the approved mock markup.
 */
export function OnlineWrap({ children, online, className }: { children: ReactNode; online?: boolean; className?: string }) {
  if (!online) {
    return <div className={`gg-pa${className ? ` ${className}` : ""}`}>{children}</div>;
  }
  return (
    <div className={`gg-pa pa${className ? ` ${className}` : ""}`}>
      {children}
      <span aria-hidden="true" className="gg-presence presence on" />
    </div>
  );
}

/** Stable palette slot for a name, so one person keeps one color everywhere. */
function nameColorIndex(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash;
}


// Letter badges (squads without a cover) take the active palette: a tint of the
// brand, pop or deep brand colour picked per name, ink text, the skin's display font.
const BADGE_TONES = ["var(--brand, var(--accent))", "var(--pop, var(--accent))", "var(--brand-deep, var(--brand))"];

export function Avatar({ name, size = 40, colorIndex, ring = false, online, style }: AvatarProps) {
  const tone = BADGE_TONES[(colorIndex ?? nameColorIndex(name || "")) % BADGE_TONES.length];
  const initial = name ? name.trim()[0]?.toUpperCase() ?? "?" : "?";
  return (
    <OnlineWrap online={online}>
      <div
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          borderRadius: radii.pill,
          background: `color-mix(in srgb, ${tone} 26%, var(--surface))`,
          border: `1.5px solid color-mix(in srgb, ${tone} 45%, transparent)`,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: size * 0.42,
          color: "var(--text)",
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
