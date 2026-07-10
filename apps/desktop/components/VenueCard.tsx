"use client";
import { AvatarStack } from "./Avatar";

const WASHES: Record<string, string> = {
  neon: "radial-gradient(120% 90% at 20% 10%, rgba(255,92,138,0.55), transparent 55%), radial-gradient(120% 90% at 90% 80%, rgba(124,92,255,0.6), transparent 55%), linear-gradient(160deg, #2a1140, #0b0b0f)",
  arcade: "radial-gradient(120% 90% at 80% 10%, rgba(92,140,255,0.5), transparent 55%), radial-gradient(120% 90% at 10% 90%, rgba(61,214,192,0.45), transparent 55%), linear-gradient(160deg, #10243a, #0b0b0f)",
};

const DEFAULT_IMAGES: Record<keyof typeof WASHES, string> = {
  neon: "/img/venue-neon-nights.jpg",
  arcade: "/img/venue-midnight-gamers.jpg",
};

export function VenueCard({
  title,
  subtitle,
  wash = "neon",
  image,
  live,
  members,
  total,
}: {
  title: string;
  subtitle: string;
  wash?: keyof typeof WASHES;
  image?: string;
  live?: boolean;
  members: string[];
  /** Total people in this venue; the +N badge is derived as total − shown. */
  total?: number;
}) {
  const resolvedImage = image ?? DEFAULT_IMAGES[wash];

  return (
    <div
      className="gg-venue gg-focusable gg-press-card"
      style={{
        position: "relative",
        flex: 1,
        minWidth: 0,
        height: "100%",
        minHeight: 200,
        borderRadius: 20,
        overflow: "hidden",
        border: "1px solid var(--border-strong)",
        background: WASHES[wash],
        cursor: "pointer",
        transition: "transform .18s var(--ease-ui), box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `url(${resolvedImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      {/* subtle texture lines unify user-uploaded photos with the Giggle surface */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 22px)",
          mixBlendMode: "overlay",
        }}
      />
      {/* bottom scrim for legibility */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(7,7,11,0.92) 8%, transparent 60%)" }} />

      {live && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: 12,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 9px",
            borderRadius: 999,
            background: "rgba(11,11,15,0.6)",
            border: "1px solid rgba(194,255,61,0.5)",
            backdropFilter: "blur(6px)",
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "#C2FF3D", boxShadow: "0 0 8px #C2FF3D" }} />
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", color: "#C2FF3D" }}>LIVE</span>
        </div>
      )}

      <div style={{ position: "absolute", left: 16, right: 16, bottom: 14 }}>
        <div style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 19, color: "#F4F4F7", letterSpacing: "-0.01em" }}>{title}</div>
        <div style={{ fontSize: 12.5, color: "#C9C9DA", marginTop: 2, marginBottom: 12 }}>{subtitle}</div>
        <AvatarStack names={members} size={28} total={total} />
      </div>
    </div>
  );
}
