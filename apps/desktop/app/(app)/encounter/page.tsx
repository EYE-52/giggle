"use client";
import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { EncounterView } from "@giggle/core";
import { api, connectSocket, SOCKET_EVENTS, SOCKET_EMIT, getMyAvatar, subscribeAvatar, DEFAULT_AVATAR_ID, resolveCover, session, sendReaction, subscribeReaction, reportOpponentSquad, joinChat, subscribeChat } from "@giggle/core";
import type { EncounterDetail } from "@giggle/core";
import { Avatar } from "@/components/Avatar";
import { AvatarArt } from "@/components/AvatarArt";
import { Icon } from "@/components/Icons";
import { ChatPanel } from "@/components/ChatPanel";
import { Button } from "@/components/Button";
import { createVideoClient } from "@giggle/agora";
import type { ConnectionState, RemoteParticipant } from "@giggle/agora";
import { useViewport } from "@/components/useViewport";

const VIEW_MODES: { mode: EncounterView; label: string }[] = [
  { mode: "versus", label: "Versus" },
  { mode: "grid", label: "Grid" },
  { mode: "spotlight", label: "Spotlight" },
  { mode: "focus-opponent", label: "Focus Opp." },
];

const avatarColors = ["#7C5CFF", "#3DD6C0", "#FF8A5C", "#C2FF3D", "#FF5C8A", "#5C8CFF", "#FFC65C", "#9B7CFF"];

const REACTION_EMOJIS = ["👋", "🔥", "😂", "❤️", "👏"];

// Deterministic tasteful gradient fallback keyed off the squad id/name — same
// visual language as SquadCard so squad identity reads consistently when a
// squad has no cover image set.
const TEAM_GRADIENTS = [
  "radial-gradient(120% 90% at 20% 10%, rgba(255,92,138,0.55), transparent 55%), radial-gradient(120% 90% at 90% 80%, rgba(124,92,255,0.6), transparent 55%), linear-gradient(160deg, #2a1140, #0b0b0f)",
  "radial-gradient(120% 90% at 80% 10%, rgba(92,140,255,0.5), transparent 55%), radial-gradient(120% 90% at 10% 90%, rgba(61,214,192,0.45), transparent 55%), linear-gradient(160deg, #10243a, #0b0b0f)",
  "radial-gradient(120% 90% at 30% 20%, rgba(194,255,61,0.4), transparent 55%), radial-gradient(120% 90% at 80% 90%, rgba(124,92,255,0.55), transparent 55%), linear-gradient(160deg, #1a2a12, #0b0b0f)",
  "radial-gradient(120% 90% at 70% 15%, rgba(255,176,32,0.45), transparent 55%), radial-gradient(120% 90% at 15% 85%, rgba(255,92,138,0.5), transparent 55%), linear-gradient(160deg, #2e1a10, #0b0b0f)",
];

function teamGradientFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return TEAM_GRADIENTS[h % TEAM_GRADIENTS.length];
}

// A squad's backdrop CSS background: its cover image when set, else a
// deterministic gradient keyed off the squad id (mirrors SquadCard).
function teamBackdrop(cover: string | null | undefined, key: string): string {
  return cover ? resolveCover(cover) : teamGradientFor(key);
}

// Per-side accent palette. "yours" = lime, "theirs" = coral. Used to tint the
// team backdrop's edge glow so each themed room reads as its own side while the
// cover carries the personality.
type SideTone = "yours" | "theirs";
const SIDE_ACCENT: Record<SideTone, { rgb: string; soft: string; edge: string }> = {
  yours: { rgb: "194,255,61", soft: "rgba(194,255,61,0.14)", edge: "rgba(194,255,61,0.22)" },
  theirs: { rgb: "255,92,92", soft: "rgba(255,92,92,0.14)", edge: "rgba(255,92,92,0.22)" },
};

// A themed "room" backdrop for one squad: its cover (or deterministic gradient)
// rendered prominently, then a smart gradient scrim + accent glow/edge so video
// tiles and name chips stay perfectly legible. Shared across ALL views so both
// squads' themes are simultaneously visible during the meet.
//   scrim  — direction of the darkening gradient ("down" for headers-on-top
//            sides, "radial" for full stages).
function TeamRoomBackdrop({
  cover,
  squadKey,
  tone,
  radius = 16,
  presence = 0.55,
}: {
  cover: string | null | undefined;
  squadKey: string;
  tone: SideTone;
  radius?: number;
  presence?: number;
}) {
  const backdrop = teamBackdrop(cover, squadKey);
  const accent = SIDE_ACCENT[tone];
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", borderRadius: radius, overflow: "hidden" }}>
      {/* cover / gradient — richer presence so the side feels themed */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: backdrop, backgroundSize: "cover", backgroundPosition: "center", opacity: presence }} />
      {/* smart scrim: keeps center brightest for the theme, darkens top/bottom
          so name chips + tile edges stay readable in any cover */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(7,7,11,0.7) 0%, rgba(7,7,11,0.42) 42%, rgba(7,7,11,0.72) 100%)" }} />
      {/* accent-tinted glow from the side's corner — intentional theme signal */}
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(120% 90% at ${tone === "yours" ? "8% 10%" : "92% 10%"}, ${accent.soft}, transparent 60%)` }} />
      {/* accent edge on the whole room */}
      <div style={{ position: "absolute", inset: 0, borderRadius: radius, boxShadow: `inset 0 0 0 1px ${accent.edge}, inset 0 0 60px -22px rgba(${accent.rgb},0.35)` }} />
    </div>
  );
}

// A split themed backdrop for stages that mix both squads (grid, spotlight,
// focus, focus-opponent): your squad's theme fills the left half, the
// opponent's fills the right half, so both themed rooms are simultaneously
// visible with a clean seam down the middle. Sits behind the tiles (zIndex 0);
// tiles/content must be relatively positioned above it.
function SplitRoomBackdrop({
  mine,
  opp,
}: {
  mine: { cover: string | null | undefined; key: string };
  opp: { cover: string | null | undefined; key: string };
}) {
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
      {/* left half — your themed room */}
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "50%", overflow: "hidden" }}>
        <TeamRoomBackdrop cover={mine.cover} squadKey={mine.key} tone="yours" radius={0} presence={0.5} />
      </div>
      {/* right half — opponent's themed room */}
      <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "50%", overflow: "hidden" }}>
        <TeamRoomBackdrop cover={opp.cover} squadKey={opp.key} tone="theirs" radius={0} presence={0.5} />
      </div>
      {/* center seam — a clean faded divider between the two themed sides */}
      <div style={{ position: "absolute", top: "8%", bottom: "8%", left: "50%", width: 1, transform: "translateX(-50%)", background: "linear-gradient(to bottom, transparent, rgba(255,255,255,0.12) 30%, rgba(255,255,255,0.12) 70%, transparent)" }} />
    </div>
  );
}

// Small rounded cover thumbnail that reinforces squad identity wherever the
// squad name appears (versus headers, top bar). Accent-ringed per side.
function CoverThumb({
  cover,
  squadKey,
  tone,
  size = 20,
  radius = 6,
}: {
  cover: string | null | undefined;
  squadKey: string;
  tone: SideTone;
  size?: number;
  radius?: number;
}) {
  const backdrop = teamBackdrop(cover, squadKey);
  const accent = SIDE_ACCENT[tone];
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flexShrink: 0,
        display: "inline-block",
        backgroundImage: backdrop,
        backgroundSize: "cover",
        backgroundPosition: "center",
        border: `1px solid rgba(${accent.rgb},0.55)`,
        boxShadow: `0 0 10px -3px rgba(${accent.rgb},0.6), inset 0 0 0 1px rgba(255,255,255,0.06)`,
      }}
    />
  );
}

// Translate a thrown ApiError / Agora error into a friendly, non-technical
// message for the video banner.
function describeVideoError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  const msg = (e as { message?: string })?.message ?? String(e ?? "");
  const blob = `${code} ${msg}`;
  if (/AGORA_NOT_CONFIGURED|NOT_CONFIGURED|not available|unavailable/i.test(blob)) {
    return "Video isn't available right now.";
  }
  if (/PERMISSION_DENIED|NotAllowed|NotAllowedError|Permission denied/i.test(blob)) {
    return "Camera/mic blocked — others can't see or hear you. Check browser permissions.";
  }
  return "Couldn't connect video — you can still use chat.";
}

const KEYFRAMES = `
@keyframes tileIn {
  from { opacity: 0; transform: scale(0.93); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes slideFromLeft {
  from { opacity: 0; transform: translateX(-48px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes slideFromRight {
  from { opacity: 0; transform: translateX(48px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes vsFlourish {
  0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
  60%  { opacity: 1; transform: translate(-50%, -50%) scale(1.18); }
  100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
@keyframes bannerFade {
  0%   { opacity: 0; transform: translateY(-8px); }
  15%  { opacity: 1; transform: translateY(0); }
  70%  { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-8px); }
}
@keyframes activeSpeakerGlow {
  0%,100% { box-shadow: 0 0 0 2px #7C5CFF44; }
  50%      { box-shadow: 0 0 0 3px #7C5CFF88, 0 0 28px -4px #7C5CFF66; }
}
@keyframes speakingRing {
  0%   { opacity: 0.85; transform: scale(1); }
  70%  { opacity: 0;    transform: scale(1.04); }
  100% { opacity: 0;    transform: scale(1.04); }
}
@keyframes vsPulse {
  0%,100% { box-shadow: 0 0 22px -6px rgba(124,92,255,0.5), 0 0 0 1px rgba(124,92,255,0.28) inset; }
  50%      { box-shadow: 0 0 34px -4px rgba(124,92,255,0.75), 0 0 0 1px rgba(124,92,255,0.45) inset; }
}
@keyframes controlIn {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes chatSlideIn {
  from { opacity: 0; transform: translateX(20px); }
  to   { opacity: 1; transform: translateX(0); }
}
@keyframes livePulse {
  0%,100% { opacity: 1; }
  50%      { opacity: 0.55; }
}
@keyframes reactionFloat {
  0%   { opacity: 1; transform: translateY(0) scale(1); }
  80%  { opacity: 0.9; transform: translateY(-80px) scale(1.3); }
  100% { opacity: 0; transform: translateY(-120px) scale(0.9); }
}
@keyframes viewTransition {
  from { opacity: 0; transform: scale(0.985); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes focusPinIn {
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: scale(1); }
}

/* ── PREMIUM MICRO-INTERACTION SPEC (shared) ─────────────────────────────
   Tactile press feedback for every control. Scoped to the dark calling root.
   Press uses !important to beat inline hover transforms. */
[data-theme="dark"] button:not(:disabled) {
  -webkit-tap-highlight-color: transparent;
  transition: transform .14s cubic-bezier(.22,1,.36,1), box-shadow .2s cubic-bezier(.4,0,.2,1), background .2s cubic-bezier(.4,0,.2,1), color .2s cubic-bezier(.4,0,.2,1), border-color .2s cubic-bezier(.4,0,.2,1), filter .2s cubic-bezier(.4,0,.2,1);
}
[data-theme="dark"] button:not(:disabled):active {
  transform: scale(.94) !important;
  transition-duration: .06s;
}
[data-theme="dark"] button:disabled { cursor: not-allowed; }
[data-theme="dark"] button:focus-visible,
[data-theme="dark"] input:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px #0B0B0F, 0 0 0 4px var(--violet, #7C5CFF);
}
[data-theme="dark"] input {
  transition: border-color .18s cubic-bezier(.4,0,.2,1), box-shadow .18s cubic-bezier(.4,0,.2,1), background .18s cubic-bezier(.4,0,.2,1);
}
[data-theme="dark"] input:focus {
  border-color: var(--violet, #7C5CFF) !important;
  box-shadow: 0 0 0 3px rgba(124,92,255,0.22);
}
@media (prefers-reduced-motion: reduce) {
  [data-theme="dark"] *,
  [data-theme="dark"] *::before,
  [data-theme="dark"] *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
  [data-theme="dark"] button:not(:disabled):active { transform: none !important; }
}
`;

interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
}

// A unique key for each participant to use as focusedKey
type ParticipantKey = string; // e.g. "local-0", "opp-0", "opp-1"

function VideoTile({
  name,
  colorIndex,
  micOn,
  videoRef,
  style,
  isLocal,
  isSpeaking,
  animClass,
  onClick,
  focused,
  showFocusHint,
  compact,
  localAvatarValue,
  statusText = "Camera off",
}: {
  name: string;
  colorIndex: number;
  /** Mic state when KNOWN — pill renders only on explicit `false` (never on unknown). */
  micOn?: boolean;
  videoRef?: (el: HTMLDivElement | null) => void;
  style?: React.CSSProperties;
  isLocal?: boolean;
  isSpeaking?: boolean;
  animClass?: string;
  onClick?: () => void;
  focused?: boolean;
  showFocusHint?: boolean;
  compact?: boolean;
  /** Only passed for the local participant — renders their chosen AvatarArt instead of initials. */
  localAvatarValue?: string;
  /** Fallback status under the avatar: "Camera off" (default) or "Connecting…". */
  statusText?: string;
}) {
  const bg = avatarColors[colorIndex % avatarColors.length];
  const { isPhone } = useViewport();
  // compact = strip/thumbnail tiles (short) → smaller avatar, no center name/subtext
  const small = isPhone || compact;
  const avSize = small ? 44 : 72;
  const glowSize = small ? 54 : 160;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      data-media-frame
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? (focused ? `Unpin ${name}'s video` : `Pin ${name}'s video`) : undefined}
      aria-pressed={onClick ? !!focused : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: `linear-gradient(155deg, ${bg}22, #0A0A0E 60%)`,
        border: focused
          ? `1.5px solid ${bg}cc`
          : isSpeaking
          ? `1.5px solid ${bg}88`
          : "1px solid rgba(255,255,255,0.08)",
        borderRadius: "var(--radius-tile, 16px)",
        overflow: "hidden",
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 0,
        animation: animClass
          ? undefined
          : "tileIn 0.4s cubic-bezier(.22,1,.36,1) forwards",
        boxShadow: focused
          ? `0 0 0 1px ${bg}66, 0 0 44px -6px ${bg}66, 0 18px 40px -12px rgba(0,0,0,0.7)`
          : isSpeaking
          ? `0 0 0 1px ${bg}55, 0 0 30px -6px ${bg}66, 0 12px 30px -12px rgba(0,0,0,0.65)`
          : hovered
          ? `0 0 0 1px ${bg}44, 0 14px 34px -14px rgba(0,0,0,0.7)`
          : "0 8px 24px -14px rgba(0,0,0,0.6)",
        transform: hovered && onClick ? "translateY(-2px)" : "translateY(0)",
        transition: "border-color .3s cubic-bezier(.4,0,.2,1), box-shadow .3s cubic-bezier(.4,0,.2,1), transform .25s cubic-bezier(.22,1,.36,1)",
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {/* Glass top-edge highlight — a thin bright rim that catches light */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          pointerEvents: "none",
          zIndex: 4,
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0) 22%)",
          mixBlendMode: "screen" as const,
        }}
      />
      {/* Inner vignette — darkens edges so faces/video pop toward the center */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          pointerEvents: "none",
          zIndex: 4,
          boxShadow: "inset 0 0 60px -18px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.04)",
        }}
      />
      {/* Speaking ring — a soft animated halo, tasteful not garish */}
      {isSpeaking && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: -1,
            borderRadius: "inherit",
            pointerEvents: "none",
            zIndex: 5,
            border: `2px solid ${bg}`,
            boxShadow: `0 0 22px -2px ${bg}`,
            animation: "speakingRing 1.8s ease-in-out infinite",
          }}
        />
      )}
      {/* Camera-off fallback */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          zIndex: 0,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: glowSize,
            height: glowSize,
            borderRadius: "50%",
            background: `radial-gradient(circle, ${bg}3A, transparent 70%)`,
            filter: "blur(14px)",
            flexShrink: 0,
          }}
        />
        {isLocal && localAvatarValue ? (
          /* Local user — show their chosen avatar */
          <div style={{
            position: "relative",
            width: avSize, height: avSize,
            flexShrink: 0,
            borderRadius: "50%",
            overflow: "hidden",
            boxShadow: `0 0 28px -6px ${bg}, 0 0 0 1px rgba(255,255,255,0.12), inset 0 0 0 2px rgba(255,255,255,0.06)`,
          }}>
            <AvatarArt value={localAvatarValue} size={avSize} />
          </div>
        ) : (
          /* Remote participants — initials circle (TODO: per-user avatars via backend) */
          <div
            style={{
              position: "relative",
              width: avSize,
              height: avSize,
              flexShrink: 0,
              aspectRatio: "1 / 1",
              borderRadius: "50%",
              background: `linear-gradient(150deg, ${bg}, ${bg}99)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-display, var(--font-space-grotesk))",
              fontWeight: 700,
              fontSize: small ? 18 : 30,
              color: "#0B0B0F",
              boxShadow: `0 0 28px -6px ${bg}, 0 0 0 1px rgba(255,255,255,0.14), inset 0 -6px 14px -6px rgba(0,0,0,0.4)`,
            }}
          >
            {name[0]}
          </div>
        )}
        <div
          style={{
            position: "relative",
            display: small ? "none" : "block",
            fontFamily: "var(--font-display, var(--font-space-grotesk))",
            fontWeight: 600,
            fontSize: 13,
            color: "#F4F4F7",
          }}
        >
          {name}
        </div>
        <div
          style={{
            position: "relative",
            display: small ? "none" : "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 12,
            color: "#9A9AB0",
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: "#9A9AB0",
              flexShrink: 0,
            }}
          />
          {statusText}
        </div>
      </div>

      {/* Live video layer */}
      {videoRef && (
        <div
          ref={videoRef}
          style={{ position: "absolute", inset: 0, zIndex: 1 }}
        />
      )}

      {/* Bottom gradient overlay */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 68,
          background: "linear-gradient(transparent, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.78))",
          zIndex: 2,
        }}
      />

      {/* Name pill */}
      <div
        style={{
          position: "absolute",
          left: 10,
          bottom: 10,
          zIndex: 6,
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "rgba(10,10,14,0.5)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 999,
          padding: "3px 10px 3px 8px",
          boxShadow: "0 2px 10px -2px rgba(0,0,0,0.5)",
          maxWidth: "calc(100% - 20px)",
        }}
      >
        <span
          style={{
            fontSize: 12,
            color: "#F4F4F7",
            fontFamily: "var(--font-display, var(--font-space-grotesk))",
            fontWeight: 600,
            letterSpacing: "0.01em",
            maxWidth: 160,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap" as const,
          }}
        >
          {name}
          {isLocal ? " (You)" : ""}
        </span>
      </div>

      {/* Focus / expand hint icon (hover) */}
      {showFocusHint && (hovered || focused) && (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: focused ? 44 : 10,
            zIndex: 6,
            background: "rgba(10,10,14,0.5)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 9,
            width: 28,
            height: 28,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            color: "#F4F4F7",
            opacity: hovered ? 1 : 0.7,
            transition: "opacity 0.15s",
          }}
          title={focused ? "Unpin" : "Pin / focus"}
          aria-hidden
        >
          {focused ? <Icon.close size={13} color="#F4F4F7" /> : <Icon.pin size={13} color="#F4F4F7" />}
        </div>
      )}

      {/* Mic indicator — only when the mic state is KNOWN to be off */}
      {micOn === false && (
        <div
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            background: "rgba(255,92,92,0.16)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            border: "1px solid rgba(255,92,92,0.4)",
            borderRadius: 999,
            padding: "3px 9px 3px 7px",
            fontSize: 12,
            color: "#FF8A8A",
            fontWeight: 700,
            letterSpacing: "0.02em",
            display: "flex",
            alignItems: "center",
            gap: 4,
            zIndex: 6,
            boxShadow: "0 2px 10px -2px rgba(255,92,92,0.45)",
          }}
        >
          <Icon.mic size={10} color="#FF8A8A" />
          Muted
        </div>
      )}
    </div>
  );
}

/** Graceful placeholder shown while waiting for the other squad — never fake tiles. */
function WaitingForSquad({ label = "Waiting for the other squad…" }: { label?: string }) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 420,
        aspectRatio: "16 / 9",
        maxHeight: "100%",
        borderRadius: 18,
        border: "1px dashed rgba(124,92,255,0.28)",
        background: "radial-gradient(120% 120% at 50% 20%, rgba(124,92,255,0.08), rgba(255,255,255,0.015) 60%)",
        boxShadow: "inset 0 0 40px -16px rgba(124,92,255,0.4)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        margin: "0 auto",
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 999,
          border: "2px solid rgba(124,92,255,0.22)",
          borderTopColor: "rgba(124,92,255,0.85)",
          boxShadow: "0 0 20px -6px rgba(124,92,255,0.6)",
          animation: "gg-spin 0.9s linear infinite",
        }}
      />
      <div style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.55)", fontFamily: "var(--font-display, var(--font-space-grotesk))" }}>
        {label}
      </div>
    </div>
  );
}

function EncounterInner() {
  const router = useRouter();
  const params = useSearchParams();
  const squadId = params.get("squad") ?? "";
  const encId = params.get("enc") ?? "";

  const [view, setView] = useState<EncounterView>("versus");
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [encounter, setEncounter] = useState<EncounterDetail | null>(null);
  const [encounterLoading, setEncounterLoading] = useState(true);
  const [encounterError, setEncounterError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [showBanner, setShowBanner] = useState(true);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const reactionCountRef = useRef(0);
  // Short-lived UI timers (reaction despawn, "Reported" toast) — cleared on
  // unmount so they never setState on an unmounted page.
  const uiTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const timers = uiTimersRef.current;
    return () => { timers.forEach(clearTimeout); timers.clear(); };
  }, []);
  function setUiTimeout(fn: () => void, ms: number) {
    const t = setTimeout(() => { uiTimersRef.current.delete(t); fn(); }, ms);
    uiTimersRef.current.add(t);
  }
  const [endedNotice, setEndedNotice] = useState(false);
  // Why the encounter ended — lets the overlay distinguish "the other squad
  // left" from a generic server end.
  const [endedReason, setEndedReason] = useState<"opponent-left" | "ended">("ended");
  const endedNavTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [findingNextMatch, setFindingNextMatch] = useState(false);
  const [reported, setReported] = useState(false);
  // Unread chat badge while the chat panel is closed (mirrors the lobby pattern).
  const [unread, setUnread] = useState(0);
  const chatVisibleRef = useRef(false);
  // Reconnect UX: Agora connection lifecycle + user dismissal of the banner.
  const [connState, setConnState] = useState<ConnectionState | null>(null);
  const [reconnectDismissed, setReconnectDismissed] = useState(false);
  // Speaking uids (from the SDK's volume indicator) keyed by String(uid).
  const [speakingUids, setSpeakingUids] = useState<Set<string>>(new Set());
  const myUidRef = useRef<string | number | null>(null);

  // Local user's chosen avatar (SSR-safe: read after mount)
  const [myAvatar, setMyAvatarState] = useState<string>(DEFAULT_AVATAR_ID);

  useEffect(() => {
    setMyAvatarState(getMyAvatar());
    return subscribeAvatar((v) => setMyAvatarState(v));
  }, []);

  // Click-to-focus state: null = no focus, else a participant key
  const [focusedKey, setFocusedKey] = useState<ParticipantKey | null>(null);

  // Hover states
  const [hoveredViewMode, setHoveredViewMode] = useState<string | null>(null);
  const [hoveredCtrl, setHoveredCtrl] = useState<string | null>(null);
  // Phone-only: reactions collapse into a popover to keep the control bar compact.
  const [reactionsOpen, setReactionsOpen] = useState(false);

  const { width, isPhone } = useViewport();
  const isCompactPhone = width <= 360;

  const vcRef = useRef<ReturnType<typeof createVideoClient> | null>(null);
  // Serializes join/leave so a StrictMode double-mount never overlaps two joins
  // on the same uid (which triggers Agora UID_CONFLICT and blanks the video).
  const joinChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const localElRef = useRef<HTMLDivElement | null>(null);
  const oppElsRef = useRef<(HTMLDivElement | null)[]>([]);
  // Identity-based map: Agora uid -> tile element. Lets us route each remote
  // track to the exact member that owns that uid (opponent OR our own non-local
  // squadmate), instead of leaking streams by array position.
  const remoteElsRef = useRef<Map<string | number, HTMLDivElement | null>>(new Map());
  const [videoJoined, setVideoJoined] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  // Full remote participant state (uid + hasVideo/hasAudio) — drives truthful
  // per-tile "Muted" / "Camera off" / "Connecting…" signals.
  const [remotes, setRemotes] = useState<RemoteParticipant[]>([]);
  const remoteUids = remotes.map((r) => r.uid);

  const setLocalEl = (el: HTMLDivElement | null) => {
    localElRef.current = el;
  };
  const setOppEl =
    (idx: number) => (el: HTMLDivElement | null) => {
      oppElsRef.current[idx] = el;
    };
  const setRemoteElByUid =
    (uid: string | number) => (el: HTMLDivElement | null) => {
      remoteElsRef.current.set(uid, el);
    };
  // Resolve the videoRef for a participant. Local -> local track. Remote with a
  // known uid -> identity map. Remote without uid (older data) -> positional
  // opponent slot fallback so nothing breaks.
  const participantRef = (
    isLocal: boolean,
    uid: number | undefined,
    oppIndex: number | undefined,
  ): ((el: HTMLDivElement | null) => void) | undefined => {
    if (isLocal) return setLocalEl;
    if (uid != null) return setRemoteElByUid(uid);
    if (oppIndex != null) return setOppEl(oppIndex);
    return undefined;
  };

  // These accent constants are kept for dark-only surfaces (video tiles, control bar, banners).
  const violet = "var(--violet, #7C5CFF)";
  const lime = "var(--lime-text, #C2FF3D)";
  const coral = "var(--coral, #FF5C5C)";
  const textPrimary = "var(--text, #F4F4F7)";
  const textMuted = "var(--text-muted, #9A9AB0)";
  const _violet = "#7C5CFF";
  const _coral = "#FF5C5C";

  useEffect(() => {
    if (!squadId || !encId) return;

    let cancelled = false;
    let tick: ReturnType<typeof setInterval> | undefined;
    let bannerTimer: ReturnType<typeof setTimeout> | undefined;
    let socket: ReturnType<typeof connectSocket> | undefined;
    let endedEvent = "ENCOUNTER_ENDED";
    let activeEvent = "ENCOUNTER_ACTIVE";
    const onEnded = (payload?: unknown) => {
      const blob = JSON.stringify(payload ?? "");
      setEndedReason(/left|leave|disconnect|abandon/i.test(blob) ? "opponent-left" : "ended");
      setEndedNotice(true);
      // Give people time to read the overlay + choose an action before we
      // auto-return home.
      if (endedNavTimerRef.current) clearTimeout(endedNavTimerRef.current);
      endedNavTimerRef.current = setTimeout(() => router.push("/home"), 6500);
    };
    const onActive = () => {
      api.getEncounter(encId).then(setEncounter).catch(() => {});
    };

    setEncounterLoading(true);
    setEncounterError(null);
    setEncounter(null);
    setElapsed(0);

    const boot = async () => {
      try {
        const detail = await api.getEncounter(encId);
        if (cancelled) return;
        setEncounter(detail);
        setEncounterLoading(false);
      } catch {
        if (!cancelled) {
          setEncounterError("This encounter is no longer available.");
          setEncounterLoading(false);
        }
        return;
      }

      tick = setInterval(() => setElapsed((e) => e + 1), 1000);

      joinChainRef.current = joinChainRef.current.catch(() => {}).then(async () => {
      if (cancelled) return;
      try {
        await api.setEncounterVideo(squadId, true);
        const tokenData = await api.encounterToken(squadId, encId);
        if (cancelled) return;
        const vc = createVideoClient();
        vcRef.current = vc;
        myUidRef.current = tokenData.uid;
        vc.onRemoteChange((rs) => setRemotes(rs));
        // Real speaking detection — only mark tiles as speaking from actual
        // audio levels (never faked). Defensive: optional on the interface.
        try {
          vc.onVolumes?.((levels) => {
            const next = new Set<string>();
            for (const v of levels) if (v.level > 5) next.add(String(v.uid));
            setSpeakingUids((prev) => {
              if (prev.size === next.size && [...next].every((u) => prev.has(u))) return prev;
              return next;
            });
          });
        } catch {}
        // Connection lifecycle → reconnect banner / disconnected error.
        try {
          vc.onConnectionState?.((state) => {
            setConnState(state);
            if (state === "CONNECTED") setReconnectDismissed(false);
            if (state === "DISCONNECTED") setVideoError("Couldn't connect video — you can still use chat.");
          });
        } catch {}
        await vc.join(tokenData, { audio: true, video: true });
        // If we were torn down mid-join, leave immediately so the next mount's
        // join (queued after this on the same chain) won't hit a uid conflict.
        if (cancelled) { await vc.leave().catch(() => {}); vcRef.current = null; return; }
        setVideoJoined(true);
      } catch (e) {
        console.error("Encounter video join failed (non-fatal):", e);
        if (!cancelled) setVideoError(describeVideoError(e));
      }
    });

      socket = connectSocket(squadId);
    socket.emit(SOCKET_EMIT.JOIN_ENCOUNTER, encId);

    // Lifecycle: opponent (or server) ended the encounter -> show a brief notice
    // then return home so the user isn't stuck on a dead call.
      endedEvent = (SOCKET_EVENTS as Record<string, string>).ENCOUNTER_ENDED ?? "ENCOUNTER_ENDED";
      activeEvent = (SOCKET_EVENTS as Record<string, string>).ENCOUNTER_ACTIVE ?? "ENCOUNTER_ACTIVE";
    socket.on(endedEvent, onEnded);
    socket.on(activeEvent, onActive);

      bannerTimer = setTimeout(() => setShowBanner(false), 2500);
    };

    boot();

    return () => {
      if (tick) clearInterval(tick);
      if (bannerTimer) clearTimeout(bannerTimer);
      if (endedNavTimerRef.current) { clearTimeout(endedNavTimerRef.current); endedNavTimerRef.current = null; }
      socket?.off(endedEvent, onEnded);
      socket?.off(activeEvent, onActive);
      // Mark this mount cancelled and queue the leave AFTER the in-flight join
      // on the same chain — so a StrictMode remount's join waits for this leave
      // to finish (no overlapping joins on the same uid → no UID_CONFLICT).
      cancelled = true;
      joinChainRef.current = joinChainRef.current.catch(() => {}).then(async () => {
        try { await vcRef.current?.leave(); } catch {}
        vcRef.current = null;
      });
      setVideoJoined(false);
    };
  }, [squadId, encId, router]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const mySquad = encounter
    ? encounter.squadAId === squadId
      ? { name: encounter.squadAName, members: encounter.squadAMembers, cover: encounter.squadACover, id: encounter.squadAId }
      : { name: encounter.squadBName, members: encounter.squadBMembers, cover: encounter.squadBCover, id: encounter.squadBId }
    : null;
  const oppSquad = encounter
    ? encounter.squadAId === squadId
      ? { name: encounter.squadBName, members: encounter.squadBMembers, cover: encounter.squadBCover, id: encounter.squadBId }
      : { name: encounter.squadAName, members: encounter.squadAMembers, cover: encounter.squadACover, id: encounter.squadAId }
    : null;

  const myMembers = mySquad?.members ?? [];
  const oppMembers = oppSquad?.members ?? [];
  const allMembers = [
    ...myMembers.map((m, i) => ({
      id: m.memberId,
      name: m.displayName,
      squad: "yours" as const,
      ci: i,
      uid: (m as { uid?: number }).uid,
      pkey: `local-${i}` as ParticipantKey,
    })),
    ...oppMembers.map((m, i) => ({
      id: m.memberId,
      name: m.displayName,
      squad: "opp" as const,
      ci: i + 4,
      uid: (m as { uid?: number }).uid,
      pkey: `opp-${i}` as ParticipantKey,
    })),
  ];

  // ── Truthful per-participant signals ─────────────────────────────────────
  // Look up a remote participant's live track state by uid. Returns undefined
  // when the uid is unknown or not (yet) connected.
  const remoteFor = (uid: number | undefined): RemoteParticipant | undefined =>
    uid == null ? undefined : remotes.find((r) => String(r.uid) === String(uid));
  // Mic pill: local uses our own toggle; remotes use real hasAudio (undefined
  // while connecting so no pill is faked).
  const micOnFor = (isLocal: boolean, uid: number | undefined): boolean | undefined =>
    isLocal ? micOn : remoteFor(uid)?.hasAudio;
  // Fallback status: a remote we know about but with no tracks yet is
  // "Connecting…"; a connected remote without video is "Camera off".
  const statusTextFor = (isLocal: boolean, uid: number | undefined): string => {
    if (isLocal) return "Camera off";
    return remoteFor(uid) ? "Camera off" : "Connecting…";
  };
  // Real speaking state from audio levels (never faked).
  const isSpeakingFor = (isLocal: boolean, uid: number | undefined): boolean => {
    const key = isLocal ? myUidRef.current : uid;
    return key != null && speakingUids.has(String(key));
  };

  useEffect(() => {
    if (videoJoined && camOn && localElRef.current) {
      try {
        vcRef.current?.playLocal(localElRef.current);
      } catch {}
    }
  }, [videoJoined, camOn, view, encounter, focusedKey]);

  useEffect(() => {
    if (!videoJoined) return;
    remoteUids.forEach((uid, i) => {
      // Identity mapping first; positional opponent slot as fallback (older data
      // without per-member uid).
      const el = remoteElsRef.current.get(uid) ?? oppElsRef.current[i];
      if (el) {
        try {
          vcRef.current?.playRemote(uid, el);
        } catch {}
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remotes, videoJoined, view, encounter, focusedKey]);

  async function toggleMic() {
    const previous = micOn;
    const next = !micOn;
    setMicOn(next);
    setVideoError(null);
    try {
      if (!vcRef.current) throw new Error("Video is not connected yet.");
      await vcRef.current.setMicEnabled(next);
    } catch (e) {
      setMicOn(previous);
      setVideoError((e as { message?: string })?.message || "Couldn't update microphone.");
    }
  }

  async function toggleCam() {
    const previous = camOn;
    const next = !camOn;
    setCamOn(next);
    setVideoError(null);
    try {
      if (!vcRef.current) throw new Error("Video is not connected yet.");
      await vcRef.current.setCamEnabled(next);
      if (next && localElRef.current) vcRef.current?.playLocal(localElRef.current);
    } catch (e) {
      setCamOn(previous);
      setVideoError((e as { message?: string })?.message || "Couldn't update camera.");
    }
  }

  async function handleEnd() {
    setEnding(true);
    setVideoError(null);
    try {
      await vcRef.current?.leave();
    } catch {}
    try {
      await api.disconnectEncounter(squadId, encId);
      router.push("/home");
    } catch (e) {
      setEnding(false);
      setVideoError((e as { message?: string })?.message || "Couldn't end this encounter yet.");
    }
  }

  function handleReport() {
    if (reported || !encounter) return;
    setVideoError(null);
    const sent = reportOpponentSquad({
      encounterId: encId,
      squadId,
      encounter,
    });
    if (!sent) {
      setVideoError("Report was not sent. Check your connection and try again.");
      return;
    }
    setReported(true);
    setUiTimeout(() => setReported(false), 2500);
  }

  // Spawn a floating emoji locally (used for both our own taps and ones we
  // receive from other participants over the socket).
  function spawnReaction(emoji: string) {
    const id = ++reactionCountRef.current;
    // Slightly randomized spawn position per tap so bursts don't stack in a line.
    const x = 24 + Math.random() * 52;
    setFloatingReactions((prev) => [...prev, { id, emoji, x }]);
    setUiTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
    }, 1400);
  }

  function fireReaction(emoji: string) {
    if (!encId || !squadId) return;
    setVideoError(null);
    const sent = sendReaction(
      { kind: "encounter", encounterId: encId, squadId },
      emoji,
      { id: session.user?.id ?? "", name: session.user?.name ?? "You" },
    );
    if (!sent) {
      setVideoError("Reaction was not sent. Check your connection and try again.");
      return;
    }
    spawnReaction(emoji);
  }

  // Receive reactions from other participants (skip our own echo).
  useEffect(() => {
    const myId = session.user?.id;
    const unsub = subscribeReaction((r) => {
      if (r.encounterId !== encId) return;
      if (r.senderId && r.senderId === myId) return; // already shown optimistically
      if (r.emoji) spawnReaction(r.emoji);
    });
    return unsub;
  }, [encId]);

  // Unread chat tracking — mirrors the lobby: count messages from others while
  // the chat panel is closed, and clear as soon as it opens.
  const myUserId = session.user?.id;
  useEffect(() => {
    if (!encId || !squadId) return;
    try { joinChat({ kind: "encounter", encounterId: encId, squadId }); } catch {}
    const unsub = subscribeChat((m) => {
      if (m.encounterId !== encId) return;
      if (myUserId && m.userId === myUserId) return;
      if (chatVisibleRef.current) return;
      setUnread((u) => Math.min(u + 1, 99));
    });
    return unsub;
  }, [encId, squadId, myUserId]);
  chatVisibleRef.current = chatOpen;
  useEffect(() => { if (chatOpen) setUnread(0); }, [chatOpen]);

  // Toggle focus on a participant key; clicking focused tile clears focus
  function handleTileClick(pkey: ParticipantKey) {
    setFocusedKey((prev) => (prev === pkey ? null : pkey));
  }

  // ── FOCUSED VIEW ────────────────────────────────────────────────────────────
  // When focusedKey is set, render the focused person large + everyone else in a strip.
  // The ref wiring is identical to what the current view would give them — we just
  // change layout, not which element receives the ref.

  const renderFocused = () => {
    // Find the focused participant
    const focusedMember = allMembers.find((m) => m.pkey === focusedKey);
    const restMembers = allMembers.filter((m) => m.pkey !== focusedKey);

    if (!focusedMember) return renderStageByView();

    // Ref for focused tile: identity-mapped (same wiring approach as grid)
    const focusedRef = participantRef(
      focusedMember.squad === "yours" && focusedMember.ci === 0,
      focusedMember.uid,
      focusedMember.squad === "opp" ? focusedMember.ci - 4 : undefined,
    );

    return (
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: isPhone ? "8px 8px 0 8px" : "12px 16px 0 16px",
          animation: "focusPinIn 0.15s ease forwards",
        }}
      >
        {/* Themed room of the focused person's squad behind the whole stage */}
        <SplitRoomBackdrop
          mine={{ cover: mySquad?.cover, key: mySquad?.id ?? "mine" }}
          opp={{ cover: oppSquad?.cover, key: oppSquad?.id ?? "opp" }}
        />
        {/* Main focused tile — large 16:9, centered (not stretched ultra-wide) */}
        <div style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ height: "100%", maxWidth: "100%", aspectRatio: "16 / 9", maxHeight: "100%" }}>
          <VideoTile
            name={focusedMember.name}
            colorIndex={focusedMember.ci}
            micOn={micOnFor(focusedMember.squad === "yours" && focusedMember.ci === 0, focusedMember.uid)}
            videoRef={focusedRef}
            isLocal={focusedMember.squad === "yours" && focusedMember.ci === 0}
            localAvatarValue={myAvatar}
            isSpeaking={isSpeakingFor(focusedMember.squad === "yours" && focusedMember.ci === 0, focusedMember.uid)}
            statusText={statusTextFor(focusedMember.squad === "yours" && focusedMember.ci === 0, focusedMember.uid)}
            onClick={() => handleTileClick(focusedMember.pkey)}
            focused
            showFocusHint
          />
          </div>
        </div>

        {/* Strip of everyone else */}
        {restMembers.length > 0 && (
          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              gap: 8,
              height: isPhone ? 90 : 110,
              flexShrink: 0,
              overflowX: "auto" as const,
              WebkitOverflowScrolling: "touch",
              paddingBottom: 0,
            }}
          >
            {restMembers.map((m) => {
              const ref = participantRef(
                m.squad === "yours" && m.ci === 0,
                m.uid,
                m.squad === "opp" ? m.ci - 4 : undefined,
              );
              return (
                <div
                  key={m.pkey}
                  style={{
                    height: "100%",
                    aspectRatio: isPhone ? "4/3" : "16/9",
                    flexShrink: 0,
                  }}
                >
                  <VideoTile
                    name={m.name}
                    colorIndex={m.ci}
                    micOn={micOnFor(m.squad === "yours" && m.ci === 0, m.uid)}
                    videoRef={ref}
                    isLocal={m.squad === "yours" && m.ci === 0}
                    localAvatarValue={myAvatar}
                    isSpeaking={isSpeakingFor(m.squad === "yours" && m.ci === 0, m.uid)}
                    statusText={statusTextFor(m.squad === "yours" && m.ci === 0, m.uid)}
                    onClick={() => handleTileClick(m.pkey)}
                    showFocusHint
                    compact
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── STAGE RENDERERS ────────────────────────────────────────────────────────

  const renderVersus = () => {
    const side = (
      squadName: string,
      accentColor: string,
      members: typeof myMembers,
      isMine: boolean,
      entranceAnim: string,
      cover: string | null | undefined,
      squadKey: string
    ) => {
      const list = members.length ? members : [];
      // Single member fills the column as one big tile; 2+ go into a 2-up grid.
      const versusGridCols = list.length > 1 && !(isPhone && list.length === 2) ? 2 : 1;
      // Number of grid rows so we can stretch each row to fill the side height
      // evenly (no big empty top/bottom gaps).
      const versusRows = Math.max(1, Math.ceil(list.length / versusGridCols));
      const tone: SideTone = isMine ? "yours" : "theirs";
      return (
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            alignItems: "stretch",
            flex: 1,
            width: isPhone ? "100%" : undefined,
            minWidth: 0,
            minHeight: 0,
            height: "100%",
            marginBottom: 0,
            borderRadius: 16,
            overflow: "hidden",
            padding: isPhone ? 10 : 12,
            animation: entranceAnim,
          }}
        >
          {/* TEAM ROOM BACKDROP — the squad's identity (cover or deterministic
              gradient) rendered prominently behind this side's tiles, with a
              smart scrim + accent glow so video + names stay legible and each
              side reads as its own themed room. */}
          <TeamRoomBackdrop cover={cover} squadKey={squadKey} tone={tone} radius={16} presence={0.55} />

          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            {/* squad cover thumbnail next to the name */}
            <CoverThumb cover={cover} squadKey={squadKey} tone={tone} size={20} radius={6} />
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: accentColor,
                letterSpacing: "0.12em",
                textTransform: "uppercase" as const,
                fontFamily: "var(--font-display, var(--font-space-grotesk))",
                opacity: 0.95,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {squadName}
            </div>
          </div>
          {list.length === 0 ? (
            <div style={{ position: "relative", zIndex: 1, flex: isPhone ? undefined : 1, minHeight: isPhone ? 160 : 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <WaitingForSquad label={isMine ? "Waiting for your squad…" : "Waiting for the other squad…"} />
            </div>
          ) : (
          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "grid",
              gridTemplateColumns: `repeat(${versusGridCols}, 1fr)`,
              // Desktop: stretch rows to evenly fill the full side height so the
              // tile(s) are generous and there are no empty top/bottom gaps.
              gridTemplateRows: `repeat(${versusRows}, 1fr)`,
              gap: 16,
              width: "100%",
              flex: 1,
              minHeight: 0,
              alignContent: "stretch",
              justifyContent: "stretch",
            }}
          >
            {list.map((m, i) => (
              <div
                key={m?.memberId ?? i}
                style={{
                  minHeight: 0,
                  minWidth: 0,
                  // Phone: fixed-height stacked tiles. Desktop: fill the grid
                  // cell (rows are 1fr) so the tile is large and balanced;
                  // object-fit:cover frames the video nicely.
                  height: "100%",
                }}
              >
                <VideoTile
                  name={m?.displayName ?? (isMine ? "You" : "Waiting…")}
                  colorIndex={isMine ? i : i + 4}
                  videoRef={participantRef(
                    isMine && i === 0,
                    (m as { uid?: number } | undefined)?.uid,
                    isMine ? undefined : i,
                  )}
                  micOn={micOnFor(isMine && i === 0, (m as { uid?: number } | undefined)?.uid)}
                  isLocal={isMine && i === 0}
                  localAvatarValue={myAvatar}
                  isSpeaking={isSpeakingFor(isMine && i === 0, (m as { uid?: number } | undefined)?.uid)}
                  statusText={statusTextFor(isMine && i === 0, (m as { uid?: number } | undefined)?.uid)}
                  onClick={() => handleTileClick(isMine ? `local-${i}` : `opp-${i}`)}
                  showFocusHint
                />
              </div>
            ))}
          </div>
          )}
        </div>
      );
    };

    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          alignItems: "stretch",
          justifyContent: "stretch",
          gap: 0,
          padding: isPhone ? "10px 12px 12px" : "12px 16px",
          flexDirection: isPhone ? "column" as const : "row" as const,
          overflow: "hidden",
          animation: "viewTransition 0.15s ease forwards",
        }}
      >
        {side(
          mySquad?.name ?? "Your Squad",
          lime,
          myMembers,
          true,
          "slideFromLeft 0.5s ease 0.05s both",
          mySquad?.cover,
          mySquad?.id ?? "mine"
        )}
        {/* center seam — one tasteful VS badge over a single subtle divider.
            Desktop: vertical 44px column between the two sides. Phone: a short
            horizontal strip between the stacked squads (your squad / VS / theirs). */}
        <div
          style={{
            width: isPhone ? "100%" : 44,
            alignSelf: isPhone ? "center" : "stretch",
            margin: isPhone ? "2px 0" : "0 4px",
            flexShrink: 0,
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Divider line — vertical on desktop, horizontal on phone, faded ends */}
          <div
            style={{
              position: "absolute",
              ...(isPhone
                ? {
                    left: "12%",
                    right: "12%",
                    top: "50%",
                    transform: "translateY(-50%)",
                    height: 1,
                    background:
                      "linear-gradient(to right, transparent, rgba(255,255,255,0.10) 30%, rgba(255,255,255,0.10) 70%, transparent)",
                  }
                : {
                    top: "12%",
                    bottom: "12%",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 1,
                    background:
                      "linear-gradient(to bottom, transparent, rgba(255,255,255,0.10) 30%, rgba(255,255,255,0.10) 70%, transparent)",
                  }),
            }}
          />
          {/* VS badge */}
          <div
            style={{
              position: "relative",
              zIndex: 1,
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "radial-gradient(circle at 38% 32%, #221a38, #0C0C12 70%)",
              border: "1px solid rgba(124,92,255,0.32)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              animation: "vsFlourish 0.6s ease 0.35s both, vsPulse 3.2s ease-in-out 1s infinite",
              flexShrink: 0,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-display, var(--font-space-grotesk))",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.08em",
                background: "linear-gradient(135deg, #9B7CFF, #FF8A5C)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
                lineHeight: 1,
              }}
            >
              VS
            </span>
          </div>
        </div>
        {side(
          oppSquad?.name ?? "Opponent",
          coral,
          oppMembers,
          false,
          "slideFromRight 0.5s ease 0.05s both",
          oppSquad?.cover,
          oppSquad?.id ?? "opp"
        )}
      </div>
    );
  };

  const renderGrid = () => {
    const members = allMembers.length
      ? allMembers
      : [{ id: "p", name: "You", squad: "yours" as const, ci: 0, uid: undefined, pkey: "local-0" as ParticipantKey }];
    const count = members.length;
    const cols = isPhone
      ? count <= 1 ? 1 : 2
      : count <= 2 ? count : count <= 4 ? 2 : count <= 6 ? 3 : 4;
    const rows = Math.ceil(count / cols);
    return (
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          overflowY: isPhone ? "auto" as const : "hidden" as const,
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 16,
          padding: isPhone ? "10px" : "12px 16px",
          alignContent: "center",
          justifyContent: "center",
          animation: "viewTransition 0.15s ease forwards",
        }}
      >
        <SplitRoomBackdrop
          mine={{ cover: mySquad?.cover, key: mySquad?.id ?? "mine" }}
          opp={{ cover: oppSquad?.cover, key: oppSquad?.id ?? "opp" }}
        />
        {members.map((m) => (
          <div
            key={m.id}
            style={{
              position: "relative",
              zIndex: 1,
              minHeight: 0,
              ...(isPhone ? { aspectRatio: "4/3" } : { aspectRatio: "16 / 9" }),
            }}
          >
            <VideoTile
              name={m.name}
              colorIndex={m.ci}
              videoRef={participantRef(
                m.squad === "yours" && m.ci === 0,
                m.uid,
                m.squad === "opp" ? m.ci - 4 : undefined,
              )}
              micOn={micOnFor(m.squad === "yours" && m.ci === 0, m.uid)}
              isLocal={m.squad === "yours" && m.ci === 0}
              localAvatarValue={myAvatar}
              isSpeaking={isSpeakingFor(m.squad === "yours" && m.ci === 0, m.uid)}
              statusText={statusTextFor(m.squad === "yours" && m.ci === 0, m.uid)}
              onClick={() => handleTileClick(m.pkey)}
              showFocusHint
            />
          </div>
        ))}
      </div>
    );
  };

  const renderSpotlight = () => {
    const members = allMembers.length
      ? allMembers
      : [{ id: "p", name: "You", squad: "yours" as const, ci: 0, uid: undefined, pkey: "local-0" as ParticipantKey }];
    const [spotlight, ...rest] = members;
    return (
      <div
        style={{
          position: "relative",
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: isPhone ? "8px 8px 0 8px" : "12px 16px 0 16px",
          animation: "viewTransition 0.15s ease forwards",
        }}
      >
        <SplitRoomBackdrop
          mine={{ cover: mySquad?.cover, key: mySquad?.id ?? "mine" }}
          opp={{ cover: oppSquad?.cover, key: oppSquad?.id ?? "opp" }}
        />
        {/* Main spotlight — large 16:9, centered (not stretched ultra-wide) */}
        <div
          style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div style={{ height: "100%", maxWidth: "100%", aspectRatio: "16 / 9", maxHeight: "100%" }}>
          <VideoTile
            name={spotlight.name}
            colorIndex={spotlight.ci}
            micOn={micOnFor(spotlight.squad === "yours" && spotlight.ci === 0, spotlight.uid)}
            videoRef={participantRef(
              spotlight.squad === "yours" && spotlight.ci === 0,
              spotlight.uid,
              spotlight.squad === "opp" ? spotlight.ci - 4 : undefined,
            )}
            isLocal={spotlight.squad === "yours" && spotlight.ci === 0}
            localAvatarValue={myAvatar}
            isSpeaking={isSpeakingFor(spotlight.squad === "yours" && spotlight.ci === 0, spotlight.uid)}
            statusText={statusTextFor(spotlight.squad === "yours" && spotlight.ci === 0, spotlight.uid)}
            onClick={() => handleTileClick(spotlight.pkey)}
            style={{ height: "100%" }}
            showFocusHint
          />
          </div>
        </div>
        {rest.length > 0 && (
          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              gap: 8,
              height: isPhone ? 90 : 110,
              flexShrink: 0,
              overflowX: "auto" as const,
              WebkitOverflowScrolling: "touch",
            }}
          >
            {rest.map((m) => (
              <div
                key={m.id}
                style={{
                  height: "100%",
                  aspectRatio: isPhone ? "4/3" : "16/9",
                  flexShrink: 0,
                }}
              >
                <VideoTile
                  name={m.name}
                  colorIndex={m.ci}
                  micOn={micOnFor(m.squad === "yours" && m.ci === 0, m.uid)}
                  videoRef={participantRef(
                    m.squad === "yours" && m.ci === 0,
                    m.uid,
                    m.squad === "opp" ? m.ci - 4 : undefined,
                  )}
                  isLocal={m.squad === "yours" && m.ci === 0}
                  localAvatarValue={myAvatar}
                  isSpeaking={isSpeakingFor(m.squad === "yours" && m.ci === 0, m.uid)}
                  statusText={statusTextFor(m.squad === "yours" && m.ci === 0, m.uid)}
                  onClick={() => handleTileClick(m.pkey)}
                  showFocusHint
                  compact
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderFocusOpponent = () => {
    // Only ever render REAL participants — never fabricate empty/placeholder users.
    const oppList = oppMembers;
    const myList = myMembers.length ? myMembers : [];
    const cols = oppList.length <= 2 ? Math.max(oppList.length, 1) : oppList.length <= 4 ? 2 : 3;
    const rows = Math.ceil(oppList.length / cols);
    return (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: isPhone ? "8px 8px 0 8px" : "12px 16px 0 16px",
          animation: "viewTransition 0.15s ease forwards",
        }}
      >
        {/* Opponent tiles — fill the bulk of the stage, over the opponent's
            themed room backdrop */}
        {oppList.length === 0 ? (
          <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 16, overflow: "hidden" }}>
            <TeamRoomBackdrop cover={oppSquad?.cover} squadKey={oppSquad?.id ?? "opp"} tone="theirs" radius={16} presence={0.5} />
            <div style={{ position: "relative", zIndex: 1 }}>
              <WaitingForSquad />
            </div>
          </div>
        ) : (
        <div
          style={{
            position: "relative",
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 16,
            alignContent: "center",
            justifyContent: "center",
            borderRadius: 16,
            padding: 8,
          }}
        >
          <TeamRoomBackdrop cover={oppSquad?.cover} squadKey={oppSquad?.id ?? "opp"} tone="theirs" radius={16} presence={0.5} />
          {oppList.map((m, i) => (
            <div
              key={m.memberId}
              style={{ position: "relative", zIndex: 1, minHeight: 0, ...(isPhone ? { aspectRatio: "4/3" } : { aspectRatio: "16 / 9" }) }}
            >
              <VideoTile
                name={m.displayName}
                colorIndex={i + 4}
                videoRef={participantRef(false, (m as { uid?: number }).uid, i)}
                micOn={micOnFor(false, (m as { uid?: number }).uid)}
                isSpeaking={isSpeakingFor(false, (m as { uid?: number }).uid)}
                statusText={statusTextFor(false, (m as { uid?: number }).uid)}
                onClick={() => handleTileClick(`opp-${i}` as ParticipantKey)}
                showFocusHint
              />
            </div>
          ))}
        </div>
        )}
        {/* My squad strip — fixed height, over my themed room backdrop */}
        <div
          style={{
            position: "relative",
            display: "flex",
            gap: 8,
            height: isPhone ? 90 : 110,
            flexShrink: 0,
            overflowX: "auto" as const,
            WebkitOverflowScrolling: "touch",
            borderRadius: 14,
            padding: myList.length ? 6 : 0,
          }}
        >
          {myList.length > 0 && (
            <TeamRoomBackdrop cover={mySquad?.cover} squadKey={mySquad?.id ?? "mine"} tone="yours" radius={14} presence={0.5} />
          )}
          {myList.map((m, i) => (
            <div
              key={m.memberId}
              style={{
                position: "relative",
                zIndex: 1,
                height: "100%",
                aspectRatio: isPhone ? "4/3" : "16/9",
                flexShrink: 0,
              }}
            >
              <VideoTile
                name={m.displayName}
                colorIndex={i}
                videoRef={participantRef(i === 0, (m as { uid?: number }).uid, undefined)}
                micOn={micOnFor(i === 0, (m as { uid?: number }).uid)}
                isLocal={i === 0}
                localAvatarValue={myAvatar}
                isSpeaking={isSpeakingFor(i === 0, (m as { uid?: number }).uid)}
                statusText={statusTextFor(i === 0, (m as { uid?: number }).uid)}
                onClick={() => handleTileClick(`local-${i}` as ParticipantKey)}
                showFocusHint
                compact
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  // The base view renderer (no focus override)
  const renderStageByView = () => {
    if (view === "versus") return renderVersus();
    if (view === "grid") return renderGrid();
    if (view === "spotlight") return renderSpotlight();
    return renderFocusOpponent();
  };

  const renderStage = () => {
    if (focusedKey) return renderFocused();
    return renderStageByView();
  };

  // ── CONTROL BUTTONS CONFIG ────────────────────────────────────────────────

  const ctrlBtns = [
    {
      id: "mic",
      icon: <Icon.mic size={20} color="#fff" />,
      active: micOn,
      danger: true,
      onClick: toggleMic,
      title: micOn ? "Mute microphone" : "Unmute microphone",
      badge: 0,
    },
    {
      id: "cam",
      icon: <Icon.cam size={20} color="#fff" />,
      active: camOn,
      danger: true,
      onClick: toggleCam,
      title: camOn ? "Turn camera off" : "Turn camera on",
      badge: 0,
    },
    {
      id: "chat",
      icon: <Icon.chat size={20} color={chatOpen ? "#fff" : "#C7C7D6"} />,
      active: chatOpen,
      danger: false,
      onClick: () => setChatOpen(!chatOpen),
      title: "Chat",
      badge: !chatOpen && unread > 0 ? unread : 0,
    },
    {
      id: "report",
      icon: <Icon.flag size={20} color={reported ? "#C2FF3D" : "#C7C7D6"} />,
      active: reported as boolean | undefined,
      danger: false,
      onClick: handleReport,
      title: reported ? "Reported" : "Report opponent squad",
      badge: 0,
    },
  ];

  // Derive focusedKey's display name for the chip
  const focusedMemberName = focusedKey
    ? allMembers.find((m) => m.pkey === focusedKey)?.name ?? null
    : null;

  if (!squadId || !encId) {
    return (
      <div data-theme="dark" style={{ height: "100%", display: "grid", placeItems: "center", background: "var(--stage, #1B1420)", padding: 24 }}>
        <div style={{ width: "min(460px, 100%)", background: "linear-gradient(155deg, var(--surface-grad-from), var(--surface-grad-to))", border: "1px solid var(--border-strong)", borderRadius: 20, padding: 24, textAlign: "center", boxShadow: "var(--shadow-card, var(--elev))" }}>
          <div style={{ width: 54, height: 54, borderRadius: 16, margin: "0 auto 16px", display: "grid", placeItems: "center", background: "var(--overlay)", border: "1px solid var(--border)" }}>
            <Icon.cam size={24} color="var(--lime)" />
          </div>
          <h1 style={{ margin: 0, color: "var(--text)", fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em" }}>Encounter unavailable</h1>
          <p style={{ margin: "10px 0 22px", color: "var(--text-muted)", lineHeight: 1.5, fontSize: 14 }}>This live room link is missing required details.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            {squadId && (
              <button onClick={() => router.push(`/lobby?squad=${squadId}`)} className="gg-press" style={{ minHeight: 44, padding: "0 18px", borderRadius: 999, border: "none", background: "var(--violet)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Back to lobby</button>
            )}
            <button onClick={() => router.push("/home")} className="gg-press" style={{ minHeight: 44, padding: "0 18px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--overlay)", color: "var(--text)", fontWeight: 700, cursor: "pointer" }}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  if (encounterLoading) {
    return (
      <div data-theme="dark" style={{ height: "100%", display: "grid", placeItems: "center", background: "var(--stage, #1B1420)", padding: 24 }}>
        <WaitingForSquad label="Opening encounter..." />
      </div>
    );
  }

  if (encounterError || !encounter) {
    return (
      <div data-theme="dark" style={{ height: "100%", display: "grid", placeItems: "center", background: "var(--stage, #1B1420)", padding: 24 }}>
        <div style={{ width: "min(460px, 100%)", background: "linear-gradient(155deg, var(--surface-grad-from), var(--surface-grad-to))", border: "1px solid var(--border-strong)", borderRadius: 20, padding: 24, textAlign: "center", boxShadow: "var(--shadow-card, var(--elev))" }}>
          <div style={{ width: 54, height: 54, borderRadius: 16, margin: "0 auto 16px", display: "grid", placeItems: "center", background: "var(--overlay)", border: "1px solid var(--border)" }}>
            <Icon.cam size={24} color="var(--lime)" />
          </div>
          <h1 style={{ margin: 0, color: "var(--text)", fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em" }}>Encounter unavailable</h1>
          <p style={{ margin: "10px 0 22px", color: "var(--text-muted)", lineHeight: 1.5, fontSize: 14 }}>{encounterError ?? "This live room could not be loaded."}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            {squadId && (
              <button onClick={() => router.push(`/lobby?squad=${squadId}`)} className="gg-press" style={{ minHeight: 44, padding: "0 18px", borderRadius: 999, border: "none", background: "var(--violet)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Back to lobby</button>
            )}
            <button onClick={() => router.push("/home")} className="gg-press" style={{ minHeight: 44, padding: "0 18px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--overlay)", color: "var(--text)", fontWeight: 700, cursor: "pointer" }}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div
        data-theme="dark"
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          // Video stage stays dark in ALL themes — never --bg/--surface here.
          background: "var(--stage, #1B1420)",
          overflow: "hidden",
        }}
      >
        {/* ── SLIM HEADER ─────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: isPhone ? 6 : 12,
            padding: isPhone ? "7px 10px" : "9px 20px",
            background: "linear-gradient(180deg, rgba(20,20,28,0.98), rgba(14,14,20,0.96))",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset, 0 4px 20px -12px rgba(0,0,0,0.8)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            flexShrink: 0,
            zIndex: 10,
            overflow: "hidden",
            maxWidth: "100vw",
          }}
        >
          {/* Squad names — single line, truncate instead of wrapping */}
          <div style={{ display: isCompactPhone ? "none" : "flex", alignItems: "center", gap: isPhone ? 5 : 8, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" as const, flexShrink: 1 }}>
            <CoverThumb cover={mySquad?.cover} squadKey={mySquad?.id ?? "mine"} tone="yours" size={isPhone ? 16 : 18} radius={5} />
            <span
              style={{
                fontFamily: "var(--font-display, var(--font-space-grotesk))",
                fontWeight: 700,
                fontSize: isPhone ? 13 : 14,
                color: lime,
                whiteSpace: "nowrap" as const,
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
                flexShrink: 1,
                maxWidth: isPhone ? 84 : 170,
              }}
            >
              {mySquad?.name ?? "Your Squad"}
            </span>
            <span style={{ color: textMuted, fontSize: 12, fontWeight: 600, flexShrink: 0 }}>vs</span>
            <CoverThumb cover={oppSquad?.cover} squadKey={oppSquad?.id ?? "opp"} tone="theirs" size={isPhone ? 16 : 18} radius={5} />
            <span
              style={{
                fontFamily: "var(--font-display, var(--font-space-grotesk))",
                fontWeight: 700,
                fontSize: isPhone ? 13 : 14,
                color: coral,
                whiteSpace: "nowrap" as const,
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
                flexShrink: 1,
                maxWidth: isPhone ? 84 : 170,
              }}
            >
              {oppSquad?.name ?? "Opponent"}
            </span>
          </div>

          {/* Focused chip — only shown when a person is pinned */}
          {focusedMemberName && (
            <div
              style={{
                display: isPhone ? "none" : "flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(124,92,255,0.18)",
                border: "1px solid rgba(124,92,255,0.35)",
                borderRadius: 999,
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: 600,
                color: "#C4B5FF",
                flexShrink: 0,
                fontFamily: "var(--font-display, var(--font-space-grotesk))",
              }}
            >
              <Icon.pin size={12} color="#C4B5FF" />
              <span style={{ maxWidth: isPhone ? 70 : 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{focusedMemberName}</span>
              <button
                onClick={() => setFocusedKey(null)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "#9A9AB0",
                  fontSize: 13,
                  lineHeight: 1,
                  padding: "0 2px",
                  display: "flex",
                  alignItems: "center",
                }}
                title="Exit focus"
                aria-label="Exit focus"
              >
                <Icon.close size={12} color="#9A9AB0" />
              </button>
            </div>
          )}

          {/* Spacer */}
          <div style={{ display: isCompactPhone ? "none" : "block", flex: 1 }} />

          {/* View mode switcher — horizontally scrollable strip; shrinks before
              the squad names do so it never forces overflow on phone. */}
          <div style={{ position: "relative", flexShrink: isCompactPhone ? 0 : 1, minWidth: 0, width: isCompactPhone ? "max-content" : undefined, margin: isCompactPhone ? "0 auto" : 0 }}>
          <div style={{ overflowX: "auto" as const, minWidth: 0, WebkitOverflowScrolling: "touch" }}>
          <div
            role="tablist"
            aria-label="View mode"
            style={{
              display: "inline-flex",
              gap: 4,
              background: "var(--overlay, rgba(255,255,255,0.04))",
              borderRadius: 999,
              padding: "3px 5px",
              border: "1px solid var(--border, rgba(255,255,255,0.07))",
              width: "max-content",
            }}
          >
            {VIEW_MODES.map(({ mode, label }) => {
              const isActive = view === mode;
              const isHovered = hoveredViewMode === mode;
              return (
                <button
                  key={mode}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => { setView(mode); setFocusedKey(null); }}
                  onMouseEnter={() => setHoveredViewMode(mode)}
                  onMouseLeave={() => setHoveredViewMode(null)}
                  style={{
                    padding: "5px 13px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "var(--font-inter)",
                    fontWeight: 600,
                    fontSize: 12,
                    background: isActive
                      ? "linear-gradient(180deg, #8A6BFF, #7C5CFF)"
                      : isHovered
                      ? "var(--overlay-hover, rgba(255,255,255,0.08))"
                      : "transparent",
                    color: isActive ? "#fff" : textMuted,
                    boxShadow: isActive
                      ? "0 2px 12px -2px rgba(124,92,255,0.6), inset 0 1px 0 rgba(255,255,255,0.25)"
                      : "none",
                    transition: "background .2s cubic-bezier(.4,0,.2,1), color .2s, box-shadow .2s",
                    whiteSpace: "nowrap" as const,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          </div>
          {/* Phone scroll hint — a subtle right-edge fade signalling more modes */}
          {isPhone && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                right: 0,
                width: 22,
                pointerEvents: "none",
                background: "linear-gradient(to right, transparent, rgba(14,14,20,0.92))",
                borderRadius: "0 999px 999px 0",
              }}
            />
          )}
          </div>

          {/* LIVE pill + timer */}
          {/* Always visible — squad names truncate/hide first on tight phones. */}
          <div style={{ display: "flex", alignItems: "center", gap: isPhone ? 6 : 10, flexShrink: 0 }}>
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: isPhone ? 4 : 5,
                fontSize: 12,
                fontWeight: 700,
                color: coral,
                background: "color-mix(in srgb, var(--coral, #FF5C5C) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--coral, #FF5C5C) 20%, transparent)",
                borderRadius: 999,
                padding: isPhone ? "2px 7px" : "3px 10px",
                letterSpacing: "0.08em",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: coral,
                  display: "inline-block",
                  animation: "livePulse 1.6s ease-in-out infinite",
                }}
              />
              LIVE
            </span>
            <span
              style={{
                fontFamily: "var(--font-display, var(--font-space-grotesk))",
                fontSize: isPhone ? 13 : 14,
                fontWeight: 700,
                color: textPrimary,
                minWidth: isPhone ? 38 : 48,
              }}
            >
              {fmt(elapsed)}
            </span>
          </div>
        </div>

        {/* ── MAIN AREA ────────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* ── VIDEO STAGE ─────────────────────────────────────────────── */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              background: "var(--stage-2, #2A2135)",
              position: "relative",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {/* Top toast stack — banners stack vertically instead of overlapping */}
            <div
              style={{
                position: "absolute",
                top: 18,
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 32,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                maxWidth: "calc(100% - 24px)",
                pointerEvents: "none",
              }}
            >
            {/* "Squads meeting" entrance banner */}
            {showBanner && (
              <div
                style={{
                  pointerEvents: "auto",
                  background: "rgba(18,18,26,0.92)",
                  backdropFilter: "blur(16px)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 999,
                  padding: "8px 22px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  whiteSpace: "nowrap" as const,
                  animation: "bannerFade 2.5s ease forwards",
                  boxShadow: `0 4px 30px rgba(0,0,0,0.5)`,
                }}
              >
                <span style={{ fontSize: 14 }}>🤝</span>
                <span
                  style={{
                    fontFamily: "var(--font-display, var(--font-space-grotesk))",
                    fontSize: 13,
                    fontWeight: 600,
                    color: textPrimary,
                  }}
                >
                  You&apos;re now meeting{" "}
                  <span style={{ color: coral, fontWeight: 700 }}>
                    {oppSquad?.name ?? "the opponent squad"}
                  </span>
                </span>
              </div>
            )}

            {/* Video failure banner — non-blocking, dismissible. Chat, controls,
                reactions all stay usable; avatar fallbacks already cover tiles. */}
            {videoError && (
              <div
                style={{
                  pointerEvents: "auto",
                  maxWidth: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "var(--surface, rgba(22,22,30,0.97))",
                  backgroundImage: "linear-gradient(var(--coral-soft), var(--coral-soft))",
                  border: "1px solid color-mix(in srgb, var(--coral) 38%, transparent)",
                  borderRadius: 12,
                  padding: "9px 12px 9px 14px",
                  boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 999, background: coral, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--coral)", lineHeight: 1.4 }}>
                  {videoError}
                </span>
                <button
                  onClick={() => setVideoError(null)}
                  title="Dismiss"
                  aria-label="Dismiss"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: textMuted,
                    fontSize: 16,
                    lineHeight: 1,
                    padding: "0 2px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  ×
                </button>
              </div>
            )}

            {/* "Reported" confirmation toast */}
            {reported && (
              <div
                role="status"
                style={{
                  pointerEvents: "auto",
                  background: "rgba(18,18,26,0.94)",
                  backdropFilter: "blur(16px)",
                  border: "1px solid rgba(194,255,61,0.4)",
                  borderRadius: 999,
                  padding: "8px 18px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  whiteSpace: "nowrap" as const,
                  boxShadow: "0 4px 30px rgba(0,0,0,0.5)",
                  fontFamily: "var(--font-display, var(--font-space-grotesk))",
                  fontSize: 13,
                  fontWeight: 700,
                  color: lime,
                }}
              >
                <Icon.flag size={14} color="#C2FF3D" />
                Reported — thanks for keeping Giggle safe
              </div>
            )}

            {/* Reconnecting banner — real Agora connection state, dismissible */}
            {connState === "RECONNECTING" && !reconnectDismissed && (
              <div
                role="status"
                style={{
                  pointerEvents: "auto",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "rgba(18,18,26,0.94)",
                  backdropFilter: "blur(16px)",
                  border: "1px solid color-mix(in srgb, var(--amber) 45%, transparent)",
                  borderRadius: 12,
                  padding: "9px 12px 9px 14px",
                  boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 999,
                    border: "2px solid color-mix(in srgb, var(--amber) 25%, transparent)",
                    borderTopColor: "var(--amber)",
                    animation: "gg-spin 0.9s linear infinite",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 600, color: textPrimary, lineHeight: 1.4 }}>
                  Reconnecting…
                </span>
                <button
                  onClick={() => setReconnectDismissed(true)}
                  title="Dismiss"
                  aria-label="Dismiss reconnecting notice"
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: textMuted,
                    fontSize: 16,
                    lineHeight: 1,
                    padding: "0 2px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  ×
                </button>
              </div>
            )}
            </div>

            {/* Encounter-ended overlay (opponent left / server ended) */}
            {endedNotice && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 40,
                  background: "rgba(11,11,15,0.82)",
                  backdropFilter: "blur(8px)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                }}
              >
                <div style={{ fontSize: 30 }}>👋</div>
                <div
                  style={{
                    fontFamily: "var(--font-display, var(--font-space-grotesk))",
                    fontSize: 22,
                    fontWeight: 700,
                    color: textPrimary,
                  }}
                >
                  {endedReason === "opponent-left" ? "The other squad left" : "Encounter ended"}
                </div>
                <div style={{ fontSize: 13, color: textMuted }}>
                  {endedReason === "opponent-left"
                    ? "You can jump straight into another match."
                    : "Thanks for hanging out."}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap", justifyContent: "center" }}>
                  <Button
                    onClick={async () => {
                      if (endedNavTimerRef.current) { clearTimeout(endedNavTimerRef.current); endedNavTimerRef.current = null; }
                      setFindingNextMatch(true);
                      // Mirror how the lobby enters matchmaking: start the
                      // search server-side, then open the matchmaking screen.
                      try { await api.startSearch(squadId); } catch {}
                      router.push(`/matchmaking?squad=${squadId}`);
                    }}
                    loading={findingNextMatch}
                    variant="primary"
                  >
                    Find another match
                  </Button>
                  <Button
                    onClick={() => {
                      if (endedNavTimerRef.current) { clearTimeout(endedNavTimerRef.current); endedNavTimerRef.current = null; }
                      router.push("/home");
                    }}
                    variant="secondary"
                  >
                    Back home
                  </Button>
                </div>
              </div>
            )}

            {/* Floating reactions layer */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 25,
                pointerEvents: "none",
                overflow: "hidden",
              }}
            >
              {floatingReactions.map((r) => (
                <div
                  key={r.id}
                  style={{
                    position: "absolute",
                    bottom: 100,
                    left: `${r.x}%`,
                    fontSize: 32,
                    animation: "reactionFloat 1.3s ease forwards",
                    lineHeight: 1,
                  }}
                >
                  {r.emoji}
                </div>
              ))}
            </div>

            {/* Tile area — paddingBottom leaves space for the floating control bar */}
            <div
              data-testid="encounter-stage"
              style={{
                position: "relative",
                zIndex: 1,
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                paddingBottom: isPhone ? 96 : 80,
              }}
            >
              {renderStage()}
            </div>

            {/* ── FLOATING CONTROL BAR ─────────────────────────────────── */}
            <div
              style={{
                position: "absolute",
                bottom: 16,
                left: 0,
                right: 0,
                display: "flex",
                justifyContent: "center",
                zIndex: 20,
              }}
            >
              <div
                data-testid="call-controls"
                role="toolbar"
                aria-label="Encounter controls"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: isPhone ? 6 : 8,
                  background: "linear-gradient(180deg, rgba(26,26,36,0.92), rgba(14,14,20,0.94))",
                  backdropFilter: "blur(22px)",
                  WebkitBackdropFilter: "blur(22px)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "var(--radius-card, 20px)",
                  padding: isPhone ? "9px 10px" : "10px 16px",
                  animation: "controlIn 0.5s cubic-bezier(.22,1,.36,1) 0.2s forwards",
                  opacity: 0,
                  boxShadow: "0 12px 44px -8px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.08)",
                  flexWrap: isPhone ? ("wrap" as const) : ("nowrap" as const),
                  justifyContent: "center",
                  rowGap: isPhone ? 8 : undefined,
                  maxWidth: "calc(100vw - 16px)",
                }}
              >
                {ctrlBtns.map(({ id, icon, active, danger, onClick, title, badge }) => {
                  const hov = hoveredCtrl === id;
                  let bg: string;
                  let ring = "inset 0 1px 0 rgba(255,255,255,0.06)";
                  let brdr = "1px solid rgba(255,255,255,0.10)";
                  if (danger && active === false) {
                    // mic/cam OFF — confident coral state (v3: danger = --coral)
                    bg = hov ? "color-mix(in srgb, var(--coral) 85%, #fff)" : "var(--coral)";
                    ring = "0 0 20px -3px color-mix(in srgb, var(--coral) 85%, transparent), inset 0 1px 0 rgba(255,255,255,0.2)";
                    brdr = "1px solid var(--coral)";
                  } else if (danger && active === true) {
                    // mic/cam ON — subtle live-tinted glass (v3: active = --live)
                    bg = hov ? "color-mix(in srgb, var(--live) 22%, transparent)" : "rgba(255,255,255,0.08)";
                    ring = hov
                      ? "0 0 16px -4px color-mix(in srgb, var(--live) 60%, transparent), inset 0 1px 0 rgba(255,255,255,0.08)"
                      : "inset 0 1px 0 rgba(255,255,255,0.08)";
                    brdr = hov ? "1px solid color-mix(in srgb, var(--live) 50%, transparent)" : "1px solid rgba(255,255,255,0.12)";
                  } else if (!danger && active === true) {
                    bg = hov ? "rgba(124,92,255,0.42)" : "rgba(124,92,255,0.28)";
                    ring = "0 0 16px -4px rgba(124,92,255,0.6), inset 0 1px 0 rgba(255,255,255,0.08)";
                    brdr = "1px solid rgba(124,92,255,0.5)";
                  } else {
                    bg = hov ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)";
                  }
                  return (
                    <button
                      key={id}
                      onClick={onClick}
                      onMouseEnter={() => setHoveredCtrl(id)}
                      onMouseLeave={() => setHoveredCtrl(null)}
                      title={title}
                      aria-label={title}
                      aria-pressed={typeof active === "boolean" ? active : undefined}
                      className="gg-press"
                      style={{
                        position: "relative",
                        width: isPhone ? 44 : 48,
                        height: isPhone ? 44 : 48,
                        borderRadius: "var(--radius-control, 14px)",
                        border: brdr,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: bg,
                        boxShadow: ring,
                        transform: hov ? "scale(1.08)" : "scale(1)",
                        transition: "all .15s ease",
                      }}
                    >
                      {icon}
                      {badge > 0 && (
                        <span
                          aria-label={`${badge} unread message${badge === 1 ? "" : "s"}`}
                          style={{
                            position: "absolute",
                            top: -3,
                            right: -3,
                            minWidth: 18,
                            height: 18,
                            padding: "0 4px",
                            borderRadius: 999,
                            background: coral,
                            color: "#fff",
                            fontSize: 12,
                            fontWeight: 700,
                            lineHeight: "18px",
                            textAlign: "center" as const,
                            border: "1.5px solid rgba(14,14,20,0.94)",
                            boxSizing: "border-box",
                          }}
                        >
                          {badge > 9 ? "9+" : badge}
                        </span>
                      )}
                    </button>
                  );
                })}

                {/* Divider */}
                <div
                  style={{
                    width: 1,
                    height: 28,
                    background: "rgba(255,255,255,0.1)",
                    margin: "0 2px",
                    display: isPhone ? "none" : "block",
                  }}
                />

                {/* Reactions stay behind one familiar control so video remains primary. */}
                {(
                  <div style={{ position: "relative", display: "flex" }}>
                    <button
                      onClick={() => setReactionsOpen((o) => !o)}
                      title="Reactions"
                      aria-label="Reactions"
                      aria-expanded={reactionsOpen}
                      className="gg-press"
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "var(--radius-control, 14px)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 20,
                        background: reactionsOpen
                          ? "rgba(124,92,255,0.26)"
                          : "rgba(255,255,255,0.09)",
                        transition: "all .12s ease",
                      }}
                    >
                      😀
                    </button>
                    {reactionsOpen && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "calc(100% + 10px)",
                          left: "50%",
                          transform: "translateX(-50%)",
                          display: "flex",
                          gap: 6,
                          background: "rgba(18,18,26,0.98)",
                          backdropFilter: "blur(18px)",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 999,
                          padding: "8px 10px",
                          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
                          zIndex: 5,
                        }}
                      >
                        {REACTION_EMOJIS.map((emoji) => (
                          <button
                            key={emoji}
                            onClick={() => { fireReaction(emoji); setReactionsOpen(false); }}
                            title={`React ${emoji}`}
                            aria-label={`React ${emoji}`}
                            className="gg-press"
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: "var(--radius-control, 14px)",
                              border: "none",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 22,
                              background: "rgba(255,255,255,0.06)",
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Divider */}
                <div
                  style={{
                    width: 1,
                    height: 28,
                    background: "rgba(255,255,255,0.1)",
                    margin: "0 2px",
                    display: isPhone ? "none" : "block",
                  }}
                />

                {/* End button */}
                <button
                  onClick={handleEnd}
                  disabled={ending}
                  aria-label="End encounter"
                  onMouseEnter={() => setHoveredCtrl("end")}
                  onMouseLeave={() => setHoveredCtrl(null)}
                  className="gg-press"
                  style={{
                    height: isPhone ? 40 : 48,
                    borderRadius: "var(--radius-control, 14px)",
                    border: "none",
                    cursor: ending ? "default" : "pointer",
                    padding: isPhone ? "0 14px" : "0 22px",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    background:
                      hoveredCtrl === "end" && !ending ? "color-mix(in srgb, var(--coral) 82%, black)" : coral,
                    color: "#fff",
                    fontFamily: "var(--font-display, var(--font-space-grotesk))",
                    fontSize: 14,
                    fontWeight: 700,
                    boxShadow:
                      hoveredCtrl === "end"
                        ? `0 0 40px -4px ${coral}, 0 0 0 3px color-mix(in srgb, var(--coral, #FF5C5C) 27%, transparent)`
                        : `0 0 20px -6px ${coral}`,
                    transform:
                      hoveredCtrl === "end" && !ending ? "scale(1.04)" : "scale(1)",
                    transition: "all .15s ease",
                    minWidth: isPhone ? 64 : 110,
                    whiteSpace: "nowrap" as const,
                    justifyContent: "center",
                  }}
                >
                  {ending ? "Ending…" : isPhone ? "End" : "End Encounter"}
                </button>
              </div>
            </div>
          </div>

          {/* ── CHAT PANEL ──────────────────────────────────────────────── */}
          {chatOpen && (
            <div
              style={{
                position: isPhone ? "fixed" : "relative",
                inset: isPhone ? "0" : undefined,
                width: isPhone ? "100%" : 300,
                zIndex: isPhone ? 50 : undefined,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                background: "var(--surface, rgba(16,16,22,0.98))",
                border: isPhone ? "none" : "1px solid var(--border, rgba(255,255,255,0.06))",
                borderRadius: 0,
                margin: 0,
                overflow: "hidden",
                animation: "chatSlideIn 0.22s ease forwards",
              }}
            >
              <ChatPanel
                scope={{ kind: "encounter", encounterId: encId, squadId }}
                onClose={() => setChatOpen(false)}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function EncounterPage() {
  return (
    <Suspense
      fallback={
        <div style={{ color: "#9A9AB0", padding: 40 }}>
          Loading encounter…
        </div>
      }
    >
      <EncounterInner />
    </Suspense>
  );
}
