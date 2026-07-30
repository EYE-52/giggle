"use client";
import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { advanceSpeakerFocus, api, connectSocket, deriveEncounterLayout, EMPTY_SPEAKER_FOCUS, SOCKET_EVENTS, SOCKET_EMIT, getMyAvatar, subscribeAvatar, DEFAULT_AVATAR_ID, resolveCover, session, sendReaction, subscribeReaction, reportOpponentSquad, joinChat, subscribeChat } from "@giggle/core";
import type { EncounterDetail } from "@giggle/core";
import { Avatar } from "@/components/Avatar";
import { AvatarArt } from "@/components/AvatarArt";
import { Icon } from "@/components/Icons";
import { ChatPanel } from "@/components/ChatPanel";
import { Button } from "@/components/Button";
import { createVideoClient } from "@giggle/agora";
import type { ConnectionState, RemoteParticipant } from "@giggle/agora";
import { useViewport } from "@/components/useViewport";

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
      {/* cover / gradient — the squad's theme, rendered with real presence so
          it fills the space around the (opaque) video tiles and the opponent
          actually SEES which theme you're repping. */}
      <div style={{ position: "absolute", inset: 0, backgroundImage: backdrop, backgroundSize: "cover", backgroundPosition: "center", opacity: presence }} />
      {/* light legibility scrim only — enough to keep the name label + tile
          edges readable, without blacking the theme out. No neon frame. */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(7,7,11,0.55) 0%, rgba(7,7,11,0.28) 45%, rgba(7,7,11,0.6) 100%)" }} />
      {/* faint accent wash from the side's corner — a whisper of team colour */}
      <div style={{ position: "absolute", inset: 0, background: `radial-gradient(140% 100% at ${tone === "yours" ? "6% 6%" : "94% 6%"}, ${accent.soft}, transparent 55%)`, opacity: 0.6 }} />
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
        <TeamRoomBackdrop cover={mine.cover} squadKey={mine.key} tone="yours" radius={0} presence={0.85} />
      </div>
      {/* right half — opponent's themed room */}
      <div style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: "50%", overflow: "hidden" }}>
        <TeamRoomBackdrop cover={opp.cover} squadKey={opp.key} tone="theirs" radius={0} presence={0.85} />
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
/* Thumbnails crop for density. Focused media stays fully visible and uses a
   restrained blurred copy as fill, so ultrawide and portrait cameras remain
   recognizable without leaving a hard black frame. */
[data-media-host] video,
[data-media-host] > div > video {
  width: 100% !important;
  height: 100% !important;
}
[data-media-fit="crop"] [data-media-host] video {
  object-fit: cover !important;
}
[data-media-fit="fit"] [data-media-host] video {
  object-fit: contain !important;
}
[data-media-backdrop] {
  object-fit: cover !important;
}
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

type MediaFit = "fit" | "crop";

interface EncounterParticipant {
  id: string;
  memberId: string;
  name: string;
  side: "mine" | "theirs";
  colorIndex: number;
  uid?: number;
  isLocal: boolean;
}

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
  fit = "crop",
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
  fit?: MediaFit;
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
  const mediaHostRef = useRef<HTMLDivElement | null>(null);
  const backdropVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const host = mediaHostRef.current;
    const backdrop = backdropVideoRef.current;
    if (fit !== "fit" || !host || !backdrop) return;

    let frame = 0;
    const sync = () => {
      const foreground = host.querySelector("video");
      if (!foreground?.srcObject || backdrop.srcObject === foreground.srcObject) return;
      backdrop.srcObject = foreground.srcObject;
      backdrop.play().catch(() => {});
    };
    const observer = new MutationObserver(() => {
      sync();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    });
    observer.observe(host, { childList: true, subtree: true });
    frame = requestAnimationFrame(sync);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      backdrop.pause();
      backdrop.srcObject = null;
    };
  }, [fit]);

  return (
    <div
      data-media-frame
      data-media-fit={fit}
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
        background: `linear-gradient(155deg, ${bg}14, #0A0A0E 62%)`,
        // One calm neutral frame. Focused = pinned (brighter neutral edge);
        // speaking = a restrained team-colour edge. No loud colored glow rings.
        border: focused
          ? "1.5px solid rgba(255,255,255,0.32)"
          : isSpeaking
          ? `1.5px solid ${bg}88`
          : "1px solid rgba(255,255,255,0.09)",
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
          ? "0 12px 34px -14px rgba(0,0,0,0.75)"
          : isSpeaking
          ? `0 0 14px -8px ${bg}77, 0 12px 30px -16px rgba(0,0,0,0.7)`
          : hovered
          ? "0 14px 34px -14px rgba(0,0,0,0.7)"
          : "0 8px 24px -16px rgba(0,0,0,0.6)",
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
      {/* Speaking cue is the frame border alone (see above) — no extra halo
          ring, which stacked into a garish triple-glow. */}
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

      {/* Soft fill behind focused Fit media. */}
      {videoRef && fit === "fit" && (
        <video
          ref={backdropVideoRef}
          data-media-backdrop
          aria-hidden
          muted
          playsInline
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            zIndex: 1,
            filter: "blur(22px) brightness(.46) saturate(.8)",
            transform: "scale(1.12)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Live video layer */}
      {videoRef && (
        <div
          ref={(el) => {
            mediaHostRef.current = el;
            videoRef(el);
          }}
          data-media-host
          style={{ position: "absolute", inset: 0, zIndex: 2 }}
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
  const [loudestUid, setLoudestUid] = useState<string | null>(null);
  const myUidRef = useRef<string | number | null>(null);

  // Local user's chosen avatar (SSR-safe: read after mount)
  const [myAvatar, setMyAvatarState] = useState<string>(DEFAULT_AVATAR_ID);

  useEffect(() => {
    setMyAvatarState(getMyAvatar());
    return subscribeAvatar((v) => setMyAvatarState(v));
  }, []);

  // The encounter's video stage is forced dark (video pops on dark, like every
  // call app) — but we still want the call chrome and active controls
  // to reflect the app theme. So we read the real accent from the document root
  // and inject it back into the dark stage, re-reading when the theme changes.
  const [appAccent, setAppAccent] = useState<{ a: string; b: string }>({ a: "", b: "" });
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.documentElement);
      const a = (cs.getPropertyValue("--accent") || cs.getPropertyValue("--violet")).trim();
      const b = (cs.getPropertyValue("--accent-hover") || cs.getPropertyValue("--violet-bright") || a).trim();
      if (a) setAppAccent({ a, b: b || a });
    };
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [focusedFit, setFocusedFit] = useState<MediaFit>("fit");
  const [speakerFocus, setSpeakerFocus] = useState(EMPTY_SPEAKER_FOCUS);

  // Hover states
  const [hoveredCtrl, setHoveredCtrl] = useState<string | null>(null);
  // Phone-only: reactions collapse into a popover to keep the control bar compact.
  const [reactionsOpen, setReactionsOpen] = useState(false);

  const { width, height, isPhone } = useViewport();
  const isPhoneChrome = isPhone || height <= 500;
  const vcRef = useRef<ReturnType<typeof createVideoClient> | null>(null);
  // Serializes join/leave so a StrictMode double-mount never overlaps two joins
  // on the same uid (which triggers Agora UID_CONFLICT and blanks the video).
  const joinChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const localElRef = useRef<HTMLDivElement | null>(null);
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
  const setRemoteElByUid =
    (uid: string | number) => (el: HTMLDivElement | null) => {
      remoteElsRef.current.set(uid, el);
    };
  // Resolve media only by identity. Unknown remote UIDs keep their honest
  // connecting fallback instead of borrowing another person's stream.
  const participantRef = (
    isLocal: boolean,
    uid: number | undefined,
  ): ((el: HTMLDivElement | null) => void) | undefined => {
    if (isLocal) return setLocalEl;
    if (uid != null) return setRemoteElByUid(uid);
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
    setConnState(null);

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
        // Keep only the real loudest speaker. The stable participant id is
        // resolved from this SDK uid after the roster is available.
        try {
          vc.onVolumes?.((levels) => {
            const loudest = levels.reduce((best, level) => level.level > best.level ? level : best, { uid: 0, level: 5 });
            setLoudestUid(loudest.level > 5 ? String(loudest.uid) : null);
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
        setConnState("CONNECTED");
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

  useEffect(() => {
    if (connState !== "CONNECTED") return;
    const tick = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(tick);
  }, [connState]);

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
  const myUserId = session.user?.id ?? "";
  const mineParticipants: EncounterParticipant[] = myMembers.map((m, i) => ({
    id: m.userId,
    memberId: m.memberId,
    name: m.displayName,
    side: "mine",
    colorIndex: i,
    uid: m.uid,
    isLocal: m.userId === myUserId || (myUidRef.current != null && String(m.uid) === String(myUidRef.current)),
  }));
  const theirParticipants: EncounterParticipant[] = oppMembers.map((m, i) => ({
    id: m.userId,
    memberId: m.memberId,
    name: m.displayName,
    side: "theirs",
    colorIndex: i + 4,
    uid: m.uid,
    isLocal: false,
  }));
  const participants = [...mineParticipants, ...theirParticipants];
  const participantIdsKey = JSON.stringify(participants.map((person) => person.id));
  const activeSpeakerId = loudestUid
    ? participants.find((person) => String(person.isLocal ? myUidRef.current : person.uid) === loudestUid)?.id ?? null
    : null;
  const viewportClass = width >= 1180 ? "wide" : isPhone ? "phone" : "narrow";
  const layout = deriveEncounterLayout({
    viewport: viewportClass,
    mine: mineParticipants,
    theirs: theirParticipants,
    pinnedId,
    automaticFocusId: speakerFocus.focusedId,
  });

  useEffect(() => {
    if (participants.length < 5) {
      setSpeakerFocus(EMPTY_SPEAKER_FOCUS);
      return;
    }
    const ids = participants.map((person) => person.id);
    const advance = () => setSpeakerFocus((previous) =>
      advanceSpeakerFocus(ids, previous, activeSpeakerId, Date.now())
    );
    advance();
    const tick = setInterval(advance, 200);
    return () => clearInterval(tick);
    // participantIdsKey intentionally represents the stable roster identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantIdsKey, participants.length, activeSpeakerId]);

  useEffect(() => {
    if (pinnedId && !participants.some((person) => person.id === pinnedId)) setPinnedId(null);
    // participantIdsKey intentionally represents the stable roster identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedId, participantIdsKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinnedId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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
    return key != null && String(key) === loudestUid;
  };

  useEffect(() => {
    if (videoJoined && camOn && localElRef.current) {
      try {
        vcRef.current?.playLocal(localElRef.current);
      } catch {}
    }
  }, [videoJoined, camOn, participantIdsKey, layout.kind, focusedFit]);

  useEffect(() => {
    if (!videoJoined) return;
    remoteUids.forEach((uid) => {
      const el = remoteElsRef.current.get(uid);
      if (el) {
        try {
          vcRef.current?.playRemote(uid, el);
        } catch {}
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remotes, videoJoined, participantIdsKey, layout.kind, focusedFit]);

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

  function handleTileClick(id: string) {
    setPinnedId((previous) => previous === id ? null : id);
  }

  const participantById = new Map(participants.map((person) => [person.id, person]));

  function renderParticipant(id: string, fit: MediaFit, compact = false) {
    const person = participantById.get(id);
    if (!person) return null;
    return (
      <VideoTile
        key={person.id}
        name={person.name}
        colorIndex={person.colorIndex}
        micOn={micOnFor(person.isLocal, person.uid)}
        videoRef={participantRef(person.isLocal, person.uid)}
        isLocal={person.isLocal}
        localAvatarValue={person.isLocal ? myAvatar : undefined}
        isSpeaking={isSpeakingFor(person.isLocal, person.uid)}
        statusText={statusTextFor(person.isLocal, person.uid)}
        onClick={() => handleTileClick(person.id)}
        focused={pinnedId === person.id}
        showFocusHint
        compact={compact}
        fit={fit}
      />
    );
  }

  function squadLabel(
    name: string,
    count: number,
    tone: SideTone,
    cover: string | null | undefined,
    key: string
  ) {
    const color = tone === "yours" ? lime : coral;
    return (
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 5,
          display: "flex",
          alignItems: "center",
          gap: 7,
          maxWidth: "calc(100% - 20px)",
          padding: "4px 10px 4px 4px",
          borderRadius: 999,
          background: "rgba(10,10,14,.62)",
          backdropFilter: "blur(12px)",
          border: "1px solid rgba(255,255,255,.11)",
        }}
      >
        <CoverThumb cover={cover} squadKey={key} tone={tone} size={20} radius={999} />
        <span style={{ color, fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name}
        </span>
        <span style={{ color: textMuted, fontSize: 11, fontWeight: 700 }}>{count}</span>
      </div>
    );
  }

  function renderFilmstrip(ids: string[], label: string, tone: SideTone) {
    if (!ids.length) return null;
    const color = tone === "yours" ? lime : coral;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 8,
          height: isPhone ? 82 : 104,
          minHeight: 0,
          flexShrink: 0,
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
        }}
      >
        <div
          style={{
            position: "sticky",
            left: 0,
            zIndex: 3,
            display: "flex",
            alignItems: "center",
            padding: "0 8px",
            color,
            background: "rgba(12,12,18,.86)",
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: ".08em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
        {ids.map((id) => (
          <div key={id} style={{ height: "100%", aspectRatio: isPhone ? "4 / 3" : "16 / 9", flexShrink: 0 }}>
            {renderParticipant(id, "crop", true)}
          </div>
        ))}
      </div>
    );
  }

  function renderCombinedFilmstrip(mineIds: string[], theirIds: string[]) {
    if (!mineIds.length && !theirIds.length) return null;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 8,
          height: isPhone ? 82 : 104,
          flexShrink: 0,
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {[
          { label: "Yours", tone: "yours" as SideTone, ids: mineIds },
          { label: "Theirs", tone: "theirs" as SideTone, ids: theirIds },
        ].map((group) => group.ids.length > 0 && (
          <div key={group.label} style={{ display: "contents" }}>
            <div
              style={{
                position: "sticky",
                left: 0,
                zIndex: 3,
                display: "flex",
                alignItems: "center",
                padding: "0 8px",
                color: group.tone === "yours" ? lime : coral,
                background: "rgba(12,12,18,.86)",
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: ".08em",
                textTransform: "uppercase",
              }}
            >
              {group.label}
            </div>
            {group.ids.map((id) => (
              <div key={id} style={{ height: "100%", aspectRatio: isPhone ? "4 / 3" : "16 / 9", flexShrink: 0 }}>
                {renderParticipant(id, "crop", true)}
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  function renderSquadSplitSide(side: "mine" | "theirs") {
    const people = side === "mine" ? mineParticipants : theirParticipants;
    const squad = side === "mine" ? mySquad : oppSquad;
    const tone: SideTone = side === "mine" ? "yours" : "theirs";
    return (
      <section
        aria-label={side === "mine" ? "Your squad" : "Other squad"}
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          borderRadius: 18,
          padding: "42px 8px 8px",
        }}
      >
        <TeamRoomBackdrop cover={squad?.cover} squadKey={squad?.id ?? side} tone={tone} radius={18} presence={0.82} />
        {squadLabel(squad?.name ?? (side === "mine" ? "Your Squad" : "Opponent"), people.length, tone, squad?.cover, squad?.id ?? side)}
        {people.length ? (
          <div style={{ position: "relative", zIndex: 1, display: "flex", flexWrap: people.length > 2 ? "wrap" : "nowrap", gap: 8, height: "100%", minHeight: 0 }}>
            {people.map((person) => (
              <div key={person.id} style={{ flex: people.length > 2 ? "1 1 calc(50% - 4px)" : 1, minWidth: 0, minHeight: 0 }}>
                {renderParticipant(person.id, "crop")}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ position: "relative", zIndex: 1, height: "100%", display: "grid", placeItems: "center" }}>
            <WaitingForSquad label={side === "mine" ? "Waiting for your squad…" : "Waiting for the other squad…"} />
          </div>
        )}
      </section>
    );
  }

  function renderFeaturedSide(side: "mine" | "theirs", filmstrip: boolean) {
    const primaryId = side === "mine" ? layout.minePrimaryId : layout.theirsPrimaryId;
    const stripIds = side === "mine" ? layout.mineStripIds : layout.theirsStripIds;
    const squad = side === "mine" ? mySquad : oppSquad;
    const tone: SideTone = side === "mine" ? "yours" : "theirs";
    const count = side === "mine" ? mineParticipants.length : theirParticipants.length;
    const useFilmstrip = filmstrip || isPhone;
    return (
      <section
        aria-label={side === "mine" ? "Your squad" : "Other squad"}
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          borderRadius: 18,
          padding: "42px 8px 8px",
        }}
      >
        <TeamRoomBackdrop cover={squad?.cover} squadKey={squad?.id ?? side} tone={tone} radius={18} presence={0.82} />
        {squadLabel(squad?.name ?? (side === "mine" ? "Your Squad" : "Opponent"), count, tone, squad?.cover, squad?.id ?? side)}
        {primaryId ? (
          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              flexDirection: useFilmstrip ? "column" : "row",
              gap: 8,
              height: "100%",
              minHeight: 0,
            }}
          >
            <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
              {renderParticipant(primaryId, focusedFit)}
            </div>
            {useFilmstrip ? renderFilmstrip(stripIds, side === "mine" ? "Yours" : "Theirs", tone) : stripIds.length > 0 && (
              <div style={{ width: "29%", display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
                {stripIds.map((id) => (
                  <div key={id} style={{ flex: 1, minHeight: 0 }}>
                    {renderParticipant(id, "crop", true)}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ position: "relative", zIndex: 1, height: "100%", display: "grid", placeItems: "center" }}>
            <WaitingForSquad label={side === "mine" ? "Waiting for your squad…" : "Waiting for the other squad…"} />
          </div>
        )}
      </section>
    );
  }

  function renderFocusedStage(withFilmstrip: boolean) {
    const focusId = layout.focusId ?? layout.theirsPrimaryId ?? layout.minePrimaryId;
    if (!focusId) return <WaitingForSquad />;
    const local = participants.find((person) => person.isLocal);
    const showSelfView = local && local.id !== focusId;
    const mineIds = layout.mineStripIds.filter((id) => id !== local?.id);
    const theirIds = layout.theirsStripIds;
    const companionIds = participants.filter((person) => person.id !== focusId && person.id !== local?.id).map((person) => person.id);
    return (
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <SplitRoomBackdrop
          mine={{ cover: mySquad?.cover, key: mySquad?.id ?? "mine" }}
          opp={{ cover: oppSquad?.cover, key: oppSquad?.id ?? "theirs" }}
        />
        <div style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0 }}>
          {renderParticipant(focusId, focusedFit)}
        </div>
        {withFilmstrip
          ? renderCombinedFilmstrip(mineIds, theirIds)
          : companionIds.length > 0 && (
            <div style={{ position: "absolute", right: 12, bottom: 12, zIndex: 5, width: isPhone ? 112 : 168, aspectRatio: "16 / 10" }}>
              {renderParticipant(companionIds[0], "crop", true)}
            </div>
          )}
        {showSelfView && (
          <div style={{ position: "absolute", top: 12, right: 12, zIndex: 6, width: isPhone ? 96 : 148, aspectRatio: "16 / 10" }}>
            {renderParticipant(local.id, "crop", true)}
          </div>
        )}
      </div>
    );
  }

  function renderAdaptiveStage() {
    if (layout.kind === "remote-main") return renderFocusedStage(false);
    if (layout.kind === "squad-split") {
      return (
        <div style={{ display: "flex", flexDirection: isPhone ? "column" : "row", gap: 8, flex: 1, minHeight: 0 }}>
          {renderSquadSplitSide("mine")}
          {renderSquadSplitSide("theirs")}
        </div>
      );
    }
    if (layout.kind === "featured-split") {
      return (
        <div style={{ display: "flex", flexDirection: isPhone ? "column" : "row", gap: 8, flex: 1, minHeight: 0 }}>
          {renderFeaturedSide("mine", false)}
          {renderFeaturedSide("theirs", false)}
        </div>
      );
    }
    if (layout.kind === "dual-focus") {
      return (
        <div style={{ display: "flex", flexDirection: "row", gap: 8, flex: 1, minHeight: 0 }}>
          {renderFeaturedSide("mine", true)}
          {renderFeaturedSide("theirs", true)}
        </div>
      );
    }
    return renderFocusedStage(true);
  }

  const renderStage = () => (
    <div
      data-layout-kind={layout.kind}
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        padding: isPhone ? 6 : 10,
        overflow: "hidden",
      }}
    >
      {renderAdaptiveStage()}
    </div>
  );

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

  const pinnedMemberName = pinnedId
    ? participantById.get(pinnedId)?.name ?? null
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
              <button onClick={() => router.push(`/lobby?squad=${squadId}`)} className="gg-press" style={{ minHeight: 44, padding: "0 18px", borderRadius: 999, border: "none", background: "var(--violet)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Find a match</button>
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
              <button onClick={() => router.push(`/lobby?squad=${squadId}`)} className="gg-press" style={{ minHeight: 44, padding: "0 18px", borderRadius: 999, border: "none", background: "var(--violet)", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Find a match</button>
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
          // …but re-inject the app theme's accent so the chrome themes (violet
          // in Midnight → iris in Cloud → tangerine) on top of the dark stage.
          ...(appAccent.a
            ? ({ "--violet": appAccent.a, "--violet-bright": appAccent.b, "--accent": appAccent.a } as React.CSSProperties)
            : {}),
        }}
      >
        {/* ── SLIM HEADER ─────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: isPhoneChrome ? 6 : 12,
            padding: isPhoneChrome ? "7px 10px" : "9px 20px",
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
          {/* Squad names — desktop only. On phone they truncate to ugly "C… vs
              B…" and each video panel already carries its squad label, so we
              hide them here for a clean, uncluttered top bar. */}
          <div style={{ display: isPhoneChrome ? "none" : "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" as const, flexShrink: 1 }}>
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
            <span style={{ color: textMuted, fontSize: 11, fontWeight: 700 }}>{mineParticipants.length}</span>
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
            <span style={{ color: textMuted, fontSize: 11, fontWeight: 700 }}>{theirParticipants.length}</span>
          </div>

          {/* Focused chip — only shown when a person is pinned */}
          {pinnedMemberName && (
            <div
              style={{
                display: isPhoneChrome ? "none" : "flex",
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
              <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{pinnedMemberName}</span>
              <button
                onClick={() => setPinnedId(null)}
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

          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {connState === "CONNECTED" ? (
              <>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12,
                    fontWeight: 800,
                    color: coral,
                    background: "color-mix(in srgb, var(--coral, #FF5C5C) 10%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--coral, #FF5C5C) 20%, transparent)",
                    borderRadius: 999,
                    padding: isPhoneChrome ? "2px 7px" : "3px 10px",
                    letterSpacing: ".08em",
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: coral, animation: "livePulse 1.6s ease-in-out infinite" }} />
                  LIVE
                </span>
                <span style={{ color: textPrimary, fontSize: isPhoneChrome ? 13 : 14, fontWeight: 700, minWidth: isPhoneChrome ? 38 : 48 }}>
                  {fmt(elapsed)}
                </span>
              </>
            ) : (
              <span
                role="status"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: connState === "DISCONNECTED" ? coral : textMuted,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 999, background: connState === "DISCONNECTED" ? coral : "var(--amber, #FFB020)" }} />
                {connState === "RECONNECTING" ? "Reconnecting" : connState === "DISCONNECTED" ? "Offline" : "Connecting"}
              </span>
            )}
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
                    // Active accent follows the theme.
                    bg = hov ? "color-mix(in srgb, var(--violet, #7C5CFF) 42%, transparent)" : "color-mix(in srgb, var(--violet, #7C5CFF) 28%, transparent)";
                    ring = "0 0 16px -4px color-mix(in srgb, var(--violet, #7C5CFF) 60%, transparent), inset 0 1px 0 rgba(255,255,255,0.08)";
                    brdr = "1px solid color-mix(in srgb, var(--violet, #7C5CFF) 50%, transparent)";
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
                        borderRadius: "50%",
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
                    height: isPhone ? 44 : 48,
                    borderRadius: 999,
                    border: "none",
                    cursor: ending ? "default" : "pointer",
                    padding: isPhone ? "0 16px" : "0 22px",
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
