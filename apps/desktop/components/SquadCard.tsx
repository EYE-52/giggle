"use client";
import { useState } from "react";
import { Icon } from "@/components/Icons";
import { resolveCover, type PublicSquad } from "@giggle/core";

// Deterministic tasteful gradient fallback keyed off the squad id/name — same
// visual language as the Home "Trending Vibes" VenueCard so the two read as one
// consistent system.
const GRADIENTS = [
  "radial-gradient(120% 90% at 20% 10%, rgba(255,92,138,0.55), transparent 55%), radial-gradient(120% 90% at 90% 80%, rgba(124,92,255,0.6), transparent 55%), linear-gradient(160deg, #2a1140, #0b0b0f)",
  "radial-gradient(120% 90% at 80% 10%, rgba(92,140,255,0.5), transparent 55%), radial-gradient(120% 90% at 10% 90%, rgba(61,214,192,0.45), transparent 55%), linear-gradient(160deg, #10243a, #0b0b0f)",
  "radial-gradient(120% 90% at 30% 20%, rgba(194,255,61,0.4), transparent 55%), radial-gradient(120% 90% at 80% 90%, rgba(124,92,255,0.55), transparent 55%), linear-gradient(160deg, #1a2a12, #0b0b0f)",
  "radial-gradient(120% 90% at 70% 15%, rgba(255,176,32,0.45), transparent 55%), radial-gradient(120% 90% at 15% 85%, rgba(255,92,138,0.5), transparent 55%), linear-gradient(160deg, #2e1a10, #0b0b0f)",
];

function gradientFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

const STATUS_LABEL: Record<string, string> = {
  idle: "Open",
  searching: "Searching",
  matched: "Matched",
  in_encounter: "Live",
};

export function SquadCard({
  squad,
  onPreview,
}: {
  squad: PublicSquad;
  onPreview: (squad: PublicSquad) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [btnHover, setBtnHover] = useState(false);

  const hasCover = !!squad.coverImage;
  const background = hasCover ? undefined : gradientFor(squad.squadId || squad.squadName);
  const isFull = squad.memberCount >= squad.maxSlots;
  const statusLabel = STATUS_LABEL[squad.status] ?? squad.status;
  const isLive = squad.status === "in_encounter";
  const isRequest = squad.joinPolicy === "request";
  const btnLabel = isRequest ? "Request to join" : "View / Join";

  // Clicking the card (or its button) NO LONGER joins directly — it opens the
  // two-step preview so members can vet themes + roster before committing.
  function handleClick() {
    onPreview(squad);
  }

  return (
    <div
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="gg-focusable gg-press-card"
      style={{
        position: "relative",
        height: 232,
        borderRadius: 20,
        overflow: "hidden",
        border: hovered ? "1px solid var(--border-strong)" : "1px solid var(--border)",
        background: background ?? "#0b0b0f",
        cursor: "pointer",
        transition: "transform .18s var(--ease-ui), box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
        transform: hovered ? "translateY(-2px) scale(1.01)" : "translateY(0) scale(1)",
        boxShadow: hovered ? "0 16px 40px rgba(0,0,0,0.32)" : "var(--elev)",
      }}
    >
      {/* Cover image (real cover only; gradient lives on the container) */}
      {hasCover && (
        <div style={{
          position: "absolute", inset: 0,
          background: resolveCover(squad.coverImage),
        }} />
      )}
      {/* texture + bottom scrim for legibility — identical treatment to VenueCard */}
      <div style={{
        position: "absolute", inset: 0,
        background: "repeating-linear-gradient(115deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 22px)",
        mixBlendMode: "overlay",
      }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(7,7,11,0.94) 6%, rgba(7,7,11,0.35) 46%, transparent 70%)" }} />

      {/* Status pill (top-left) */}
      <div style={{
        position: "absolute", top: 12, left: 12,
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "4px 9px", borderRadius: 999,
        background: "rgba(11,11,15,0.6)",
        border: isLive ? "1px solid rgba(194,255,61,0.5)" : "1px solid rgba(255,255,255,0.18)",
        backdropFilter: "blur(6px)",
      }}>
        {isLive && <span style={{ width: 6, height: 6, borderRadius: 999, background: "#C2FF3D", boxShadow: "0 0 8px #C2FF3D" }} />}
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", color: isLive ? "#C2FF3D" : "#E7E7F0", textTransform: "uppercase" }}>{statusLabel}</span>
      </div>
      {/* Member count pill (top-right) */}
      <div style={{
        position: "absolute", top: 12, right: 12,
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "4px 9px", borderRadius: 999,
        background: "rgba(11,11,15,0.6)",
        border: "1px solid rgba(255,255,255,0.18)",
        backdropFilter: "blur(6px)",
      }}>
        <Icon.account size={12} color="#E7E7F0" />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#E7E7F0", fontVariantNumeric: "tabular-nums" }}>
          {squad.memberCount}/{squad.maxSlots}
        </span>
      </div>

      {/* Bottom overlay: name + leader + tags + Join (matches VenueCard layout) */}
      <div style={{ position: "absolute", left: 16, right: 16, bottom: 14, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 19, color: "#F4F4F7", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {squad.squadName}
          </div>
          <div style={{ fontSize: 12.5, color: "#C9C9DA", marginTop: 2 }}>
            {squad.leaderName ? `Led by ${squad.leaderName}` : "Open squad"}
          </div>
          {squad.tags && squad.tags.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              {squad.tags.slice(0, 3).map(tag => (
                <span key={tag} style={{
                  fontSize: 11, fontWeight: 600, color: "#E7E7F0",
                  background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.18)",
                  borderRadius: 999, padding: "2px 9px", backdropFilter: "blur(4px)",
                }}>{tag}</span>
              ))}
              {squad.tags.length > 3 && (
                <span style={{ fontSize: 11, fontWeight: 600, color: "#C9C9DA", padding: "2px 4px" }}>
                  +{squad.tags.length - 3}
                </span>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, fontWeight: 600, color: "#9A9AAE", marginTop: 8 }}>
              No vibes set
            </div>
          )}
        </div>

        <button
          onClick={e => { e.stopPropagation(); handleClick(); }}
          onMouseEnter={() => setBtnHover(true)}
          onMouseLeave={() => setBtnHover(false)}
          className="gg-focusable gg-press"
          style={{
            flexShrink: 0,
            height: 38, minHeight: 40, padding: "0 18px", borderRadius: 999, border: "none",
            cursor: "pointer",
            background: btnHover ? "var(--violet-bright)" : "var(--violet)",
            color: "#fff",
            fontFamily: "var(--font-inter)", fontWeight: 700, fontSize: 14,
            boxShadow: btnHover ? "0 0 26px -6px rgba(124,92,255,0.95)" : "0 0 18px -8px rgba(124,92,255,0.8)",
            transform: btnHover ? "translateY(-1px)" : "translateY(0)",
            transition: "transform .14s ease, box-shadow .2s var(--ease-ui), background .2s var(--ease-ui)",
            whiteSpace: "nowrap",
          }}
        >
          {btnLabel}
        </button>
      </div>
    </div>
  );
}
