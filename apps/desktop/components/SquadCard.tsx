"use client";
import { useState } from "react";
import { Icon } from "@/components/Icons";
import { coverName, type PublicSquad } from "@giggle/core";
import { useTheme } from "@/components/useTheme";
import { coverKind, coverBackground, coverSwatchBackground, coverInk, fallbackGradient } from "@/components/covers";

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
  const themeId = useTheme();

  const hasCover = !!squad.coverImage;
  // Photos are always rendered dark-scrimmed; generated gradients follow the theme.
  const kind = hasCover ? coverKind(squad.coverImage, themeId) : coverKind(null, themeId);
  const ink = coverInk(kind);
  const background = hasCover ? undefined : fallbackGradient(squad.squadId || squad.squadName, kind);
  const statusLabel = STATUS_LABEL[squad.status] ?? squad.status;
  const isLive = squad.status === "in_encounter";
  const theme = coverName(squad.coverImage);

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
        height: 240,
        borderRadius: "var(--radius-tile)",
        overflow: "hidden",
        border: hovered
          ? "var(--border-w) solid var(--border-strong)"
          : "var(--border-w) solid var(--border)",
        background: background ?? (kind === "light" ? "#FFFFFF" : "#0b0b0f"),
        cursor: "pointer",
        transition: "transform .18s var(--ease-ui), box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hovered ? "var(--shadow-pop)" : "var(--shadow-card)",
      }}
    >
      {/* Cover image (real cover only; gradient lives on the container).
          Slightly desaturated so a wall of vivid covers doesn't glare. */}
      {hasCover && (
        <div style={{
          position: "absolute", inset: 0,
          background: coverBackground(squad.coverImage, kind),
          // Photos (always dark-scrimmed) + dark-theme gradients get toned down;
          // bright gradients stay clean so the light card doesn't look dirty.
          filter: kind === "dark" ? "saturate(0.88) brightness(0.82)" : undefined,
        }} />
      )}
      {/* bottom scrim for legibility — dark scrim + light text over dark/photo
          covers, light scrim + ink text over bright gradients */}
      <div style={{ position: "absolute", inset: 0, background: ink.bottomScrim }} />

      {/* Status pill (top-left) */}
      <div style={{
        position: "absolute", top: 12, left: 12,
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "4px 8px", borderRadius: 7,
        background: kind === "light" ? "rgba(255,255,255,0.72)" : "rgba(11,11,15,0.6)",
        border: isLive
          ? "1px solid color-mix(in srgb, var(--live) 55%, transparent)"
          : kind === "light" ? "1px solid rgba(27,20,32,0.2)" : "1px solid rgba(255,255,255,0.18)",
        backdropFilter: "blur(6px)",
      }}>
        {isLive && <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--live)", boxShadow: "0 0 8px var(--live)" }} />}
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: isLive ? "var(--lime-text)" : ink.textSoft, textTransform: "uppercase" }}>{statusLabel}</span>
      </div>
      {/* Member count */}
      <div style={{
        position: "absolute", top: 12, right: 12,
        display: "inline-flex", alignItems: "center", gap: 5,
        color: ink.textSoft,
      }}>
        <Icon.account size={12} color={ink.textSoft} />
        <span style={{ fontSize: 12, fontWeight: 700, color: ink.textSoft, fontVariantNumeric: "tabular-nums" }}>
          {squad.memberCount}/{squad.maxSlots}
        </span>
      </div>

      {/* Bottom overlay: name + leader + tags + Join (matches VenueCard layout) */}
      <div style={{ position: "absolute", left: 16, right: 16, bottom: 14, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          {theme && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 7, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: ink.textMuted }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: coverSwatchBackground(squad.coverImage, kind), boxShadow: kind === "light" ? "inset 0 0 0 1px rgba(27,20,32,0.25)" : "inset 0 0 0 1px rgba(255,255,255,0.35)" }} />
              {theme}
            </span>
          )}
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 17, color: ink.text, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {squad.squadName}
          </div>
          <div style={{ fontSize: 12, color: ink.textMuted, marginTop: 2 }}>
            {squad.leaderName ? `Led by ${squad.leaderName}` : "Open squad"}
          </div>
          {squad.tags && squad.tags.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", marginTop: 8, color: ink.textMuted }}>
              {squad.tags.slice(0, 3).map((tag, index, visibleTags) => (
                <span key={tag} style={{ fontSize: 12, fontWeight: 600 }}>
                  {tag}{index < visibleTags.length - 1 ? <span aria-hidden style={{ margin: "0 7px", color: kind === "light" ? "#9A93A6" : "#777789" }}>·</span> : null}
                </span>
              ))}
              {squad.tags.length > 3 && (
                <span style={{ marginLeft: 7, fontSize: 12, fontWeight: 600, color: ink.textMuted }}>
                  +{squad.tags.length - 3}
                </span>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 12, fontWeight: 600, color: kind === "light" ? "#6A6278" : "#9A9AAE", marginTop: 8 }}>
              No vibes set
            </div>
          )}
        </div>

        <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 6, color: ink.text, fontSize: 12, fontWeight: 700 }}>
          Preview <Icon.enter size={14} color={ink.text} />
        </span>
      </div>
    </div>
  );
}
