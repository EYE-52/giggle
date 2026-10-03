"use client";
import { Icon } from "@/components/Icons";
import { type PublicSquad } from "@giggle/core";
import { useTheme } from "@/components/useTheme";
import { coverKind, coverBackground } from "@/components/covers";
import styles from "./SquadCard.module.css";

const STATUS_LABEL: Record<string, string> = {
  idle: "Open",
  searching: "Searching",
  matched: "Matched",
  in_encounter: "In a call",
};

/**
 * An open squad on Discover. A skin card: the squad's own cover (or a strip in
 * the palette's colours) on top, then its name, leader, size and interests in
 * the theme's type and ink. Opens the preview; never joins directly.
 */
export function SquadCard({ squad, onPreview }: { squad: PublicSquad; onPreview: (squad: PublicSquad) => void }) {
  const themeId = useTheme();
  const cover = squad.coverImage ? coverBackground(squad.coverImage, coverKind(squad.coverImage, themeId)) : undefined;
  const statusLabel = STATUS_LABEL[squad.status] ?? squad.status;
  const tone = Math.abs([...(squad.squadId || squad.squadName)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % 3;
  const open = () => onPreview(squad);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${squad.squadName}, ${squad.memberCount} of ${squad.maxSlots}. Preview`}
      onClick={open}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } }}
      className={`card gg-squad-card gg-focusable ${styles.card}`}
      data-note-tone={tone}
    >
      <div className={`gg-squad-cover ${styles.cover}`} data-tone={tone} style={cover ? { background: cover, backgroundSize: "cover", backgroundPosition: "center" } : undefined}>
        <span className={`chip ${styles.status}`} data-live={squad.status === "in_encounter" || undefined}>{statusLabel}</span>
        <span className={styles.count}><Icon.users size={14} color="currentColor" />{squad.memberCount} of {squad.maxSlots}</span>
      </div>
      <div className={styles.body}>
        <b className={styles.name}>{squad.squadName}</b>
        <span className={`muted ${styles.meta}`}>{squad.leaderName ? `Led by ${squad.leaderName}` : "Open squad"}</span>
        {squad.tags && squad.tags.length > 0 && (
          <span className={`muted ${styles.tags}`}>{squad.tags.slice(0, 3).join(" · ")}{squad.tags.length > 3 ? ` +${squad.tags.length - 3}` : ""}</span>
        )}
        <span className={`gg-squad-preview ${styles.preview}`}>Preview<Icon.arrowRight size={16} color="currentColor" /></span>
      </div>
    </div>
  );
}
