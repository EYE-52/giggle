"use client";
import { useState, useEffect, useRef, useCallback, Suspense, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  advanceSpeakerFocus,
  chatMessageMatchesScope,
  mergeChatMessage,
  api,
  connectSocket,
  createOpponentUserIds,
  deriveEncounterLayout,
  EMPTY_SPEAKER_FOCUS,
  SOCKET_EVENTS,
  SOCKET_EMIT,
  getMyAvatar,
  resolveAvatar,
  subscribeAvatar,
  DEFAULT_AVATAR_ID,
  session,
  sendChatMessage,
  sendReaction,
  subscribeReaction,
  reportOpponentSquad,
  joinChat,
  subscribeChat,
} from "@giggle/core";
import type { EncounterDetail } from "@giggle/core";
import { Avatar } from "@/components/Avatar";
import { AvatarArt } from "@/components/AvatarArt";
import { Icon } from "@/components/Icons";
import { ChatPanel, type ChatPanelMessage } from "@/components/ChatPanel";
import { Button } from "@/components/Button";
import { ParticipantVideoTile as VideoTile } from "@/components/ParticipantVideoTile";
import { AdaptiveVideoStage } from "@/components/AdaptiveVideoStage";
import { Modal } from "@/components/Modal";
import { createVideoClient } from "@giggle/agora";
import type { CaptureState, ConnectionState, RemoteParticipant } from "@giggle/agora";
import { useViewport } from "@/components/useViewport";
import { WEB_DISCOVERY_ENABLED } from "@/lib/discovery";

const REACTION_EMOJIS = ["👋", "🔥", "😂", "❤️", "👏"];

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
[data-media-host],
[data-media-host] > div,
[data-media-host] video,
[data-media-host] canvas {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  border-radius: inherit !important;
  overflow: clip !important;
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
@keyframes reactionFade {
  from { opacity: 1; }
  to   { opacity: 0; }
}
@keyframes viewTransition {
  from { opacity: 0; transform: scale(0.985); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes focusPinIn {
  from { opacity: 0; transform: scale(0.94); }
  to   { opacity: 1; transform: scale(1); }
}

/* ── CALL MICRO-INTERACTIONS ─────────────────────────────────────────────
   Tactile press feedback for every control. Scoped to the encounter shell.
   Press uses !important to beat inline hover transforms. */
[data-testid="encounter-shell"] button:not(:disabled) {
  -webkit-tap-highlight-color: transparent;
  transition: transform .14s cubic-bezier(.22,1,.36,1), box-shadow .2s cubic-bezier(.4,0,.2,1), background .2s cubic-bezier(.4,0,.2,1), color .2s cubic-bezier(.4,0,.2,1), border-color .2s cubic-bezier(.4,0,.2,1), filter .2s cubic-bezier(.4,0,.2,1);
}
[data-testid="encounter-shell"] button:not(:disabled):active {
  transform: scale(.94) !important;
  transition-duration: .06s;
}
[data-testid="encounter-shell"] button:disabled { cursor: not-allowed; }
[data-testid="encounter-shell"] button:focus-visible,
[data-testid="encounter-shell"] input:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px #0B0B0F, 0 0 0 4px var(--violet, #7C5CFF);
}
[data-testid="encounter-shell"] input {
  transition: border-color .18s cubic-bezier(.4,0,.2,1), box-shadow .18s cubic-bezier(.4,0,.2,1), background .18s cubic-bezier(.4,0,.2,1);
}
[data-testid="encounter-shell"] input:focus {
  border-color: var(--violet, #7C5CFF) !important;
  box-shadow: 0 0 0 3px rgba(124,92,255,0.22);
}
@media (prefers-reduced-motion: reduce) {
  [data-testid="encounter-shell"] *,
  [data-testid="encounter-shell"] *::before,
  [data-testid="encounter-shell"] *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
  [data-testid="encounter-shell"] button:not(:disabled):active { transform: none !important; }
  [data-testid="encounter-shell"] [data-reaction] {
    animation: reactionFade 1.8s linear forwards !important;
    transform: none !important;
  }
}
`;

interface FloatingReaction {
  id: number;
  emoji: string;
  senderId: string;
}

type MediaFit = "fit" | "crop";

interface EncounterParticipant {
  id: string;
  memberId: string;
  name: string;
  side: "mine" | "theirs";
  colorIndex: number;
  /** Shared illustrated avatar (or seeded default) shown when the camera is off. */
  avatar: string;
  uid?: number;
  isLocal: boolean;
}

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
        background:
          "radial-gradient(120% 120% at 50% 20%, rgba(124,92,255,0.08), rgba(255,255,255,0.015) 60%)",
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
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "rgba(255,255,255,0.55)",
          fontFamily: "var(--font-display, var(--font-space-grotesk))",
        }}
      >
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
  const [chatAudience, setChatAudience] = useState<"everyone" | "squad">("everyone");
  const [chatDrafts, setChatDrafts] = useState({ everyone: "", squad: "" });
  const [chatUnread, setChatUnread] = useState({ everyone: 0, squad: 0 });
  const chatAudienceRef = useRef(chatAudience);
  chatAudienceRef.current = chatAudience;
  const chatScope =
    chatAudience === "everyone"
      ? { kind: "encounter" as const, encounterId: encId, squadId }
      : { kind: "lobby" as const, squadId };
  const [elapsed, setElapsed] = useState(0);
  const [encounter, setEncounter] = useState<EncounterDetail | null>(null);
  const [encounterLoading, setEncounterLoading] = useState(true);
  const [encounterError, setEncounterError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [exitKind, setExitKind] = useState<"leave" | "end">("leave");
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [nextConfirmOpen, setNextConfirmOpen] = useState(false);
  const [nextPending, setNextPending] = useState(false);
  const [nextError, setNextError] = useState('');
  const nextPendingRef = useRef(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const reactionCountRef = useRef(0);
  // Short-lived UI timers (reaction despawn, "Reported" toast) — cleared on
  // unmount so they never setState on an unmounted page.
  const uiTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const timers = uiTimersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, []);
  function setUiTimeout(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      uiTimersRef.current.delete(t);
      fn();
    }, ms);
    uiTimersRef.current.add(t);
  }
  const [endedNotice, setEndedNotice] = useState(false);
  // Why the encounter ended — lets the overlay distinguish "the other squad
  // left" from a generic server end.
  const [endedReason, setEndedReason] = useState<"opponent-left" | "ended">("ended");
  const endedNavTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [findingNextMatch, setFindingNextMatch] = useState(false);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [blockConfirmOpen, setBlockConfirmOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  // Unread chat badge while the chat panel is closed (mirrors the lobby pattern).
  const unread = chatUnread.everyone + chatUnread.squad;
  const [chatMessages, setChatMessages] = useState<ChatPanelMessage[]>([]);
  const chatVisibleRef = useRef(false);
  // Reconnect UX: Agora connection lifecycle + user dismissal of the banner.
  const [connState, setConnState] = useState<ConnectionState | null>(null);
  const [reconnectDismissed, setReconnectDismissed] = useState(false);
  const [loudestUid, setLoudestUid] = useState<string | null>(null);
  const myUidRef = useRef<string | number | null>(null);

  // Local user's chosen avatar (SSR-safe: read after mount)
  const [myAvatar, setMyAvatarState] = useState<string>(DEFAULT_AVATAR_ID);

  useEffect(() => {
    setMyAvatarState(getMyAvatar(session.user?.id));
    return subscribeAvatar((v) => setMyAvatarState(v));
  }, []);

  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [focusedFit, setFocusedFit] = useState<MediaFit>("fit");
  const [selfViewMinimized, setSelfViewMinimized] = useState(false);
  const [stripSide, setStripSide] = useState<"mine" | "theirs">("mine");
  const [speakerFocus, setSpeakerFocus] = useState(EMPTY_SPEAKER_FOCUS);

  // Hover states
  const [hoveredCtrl, setHoveredCtrl] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const chatButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const reactionButtonRef = useRef<HTMLButtonElement | null>(null);
  const reactionMenuRef = useRef<HTMLDivElement | null>(null);

  const { width, height, isPhone } = useViewport();
  const isPhoneChrome = isPhone || height <= 500;

  function closeMore(restoreFocus = false) {
    setMoreOpen(false);
    if (restoreFocus) requestAnimationFrame(() => moreButtonRef.current?.focus());
  }

  function closeReactions(restoreFocus = false) {
    setReactionsOpen(false);
    if (restoreFocus) requestAnimationFrame(() => reactionButtonRef.current?.focus());
  }

  useEffect(() => {
    if (!moreOpen && !reactionsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        moreOpen &&
        !moreMenuRef.current?.contains(target) &&
        !moreButtonRef.current?.contains(target)
      )
        closeMore(true);
      if (
        reactionsOpen &&
        !reactionMenuRef.current?.contains(target) &&
        !reactionButtonRef.current?.contains(target)
      )
        closeReactions(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (reactionsOpen) closeReactions(true);
      else if (moreOpen) closeMore(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen, reactionsOpen]);

  useEffect(() => {
    if (!chatOpen || width >= 1180) {
      setKeyboardInset(0);
      return;
    }
    const viewport = window.visualViewport;
    if (!viewport) return;
    const sync = () =>
      setKeyboardInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop));
    sync();
    viewport.addEventListener("resize", sync);
    return () => viewport.removeEventListener("resize", sync);
  }, [chatOpen, width]);

  const vcRef = useRef<ReturnType<typeof createVideoClient> | null>(null);
  // Serializes join/leave so a StrictMode double-mount never overlaps two joins
  // on the same uid (which triggers Agora UID_CONFLICT and blanks the video).
  const joinChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const videoGenerationRef = useRef(0);
  const localElRef = useRef<HTMLDivElement | null>(null);
  // Identity-based map: Agora uid -> tile element. Lets us route each remote
  // track to the exact member that owns that uid (opponent OR our own non-local
  // squadmate), instead of leaking streams by array position.
  const remoteElsRef = useRef<Map<string | number, HTMLDivElement | null>>(new Map());
  const [videoJoined, setVideoJoined] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoRetrying, setVideoRetrying] = useState(false);
  const [captureState, setCaptureState] = useState<CaptureState>({ audio: "off", video: "off" });
  // Full remote participant state (uid + hasVideo/hasAudio) — drives truthful
  // per-tile "Muted" / "Camera off" / "Connecting…" signals.
  const [remotes, setRemotes] = useState<RemoteParticipant[]>([]);
  const remoteUids = remotes.map((r) => r.uid);
  const remoteVideoKey = JSON.stringify(remotes.map(r => [r.uid, r.hasVideo]));

  const setLocalEl = (el: HTMLDivElement | null) => {
    localElRef.current = el;
  };
  const setRemoteElByUid = (uid: string | number) => (el: HTMLDivElement | null) => {
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

  async function joinVideo(isCancelled: () => boolean = () => false) {
    if (!squadId || !encId) throw new Error("This encounter is unavailable.");
    const generation = ++videoGenerationRef.current;
    const joinCancelled = () => isCancelled() || generation !== videoGenerationRef.current;
    setVideoError(null);
    setVideoJoined(false);
    setConnState("CONNECTING");
    setCaptureState({ audio: "off", video: "off" });
    setRemotes([]);
    setLoudestUid(null);

    const staleClient = vcRef.current;
    vcRef.current = null;
    try {
      await staleClient?.leave();
    } catch {}
    if (joinCancelled()) return;

    await api.setEncounterVideo(squadId, true);
    const tokenData = await api.encounterToken(squadId, encId);
    if (joinCancelled()) return;

    const vc = createVideoClient();
    vcRef.current = vc;
    myUidRef.current = tokenData.uid;
    vc.onRemoteChange((next) => {
      if (vcRef.current === vc) setRemotes(next);
    });
    vc.onCaptureState?.((next) => {
      if (vcRef.current !== vc) return;
      setCaptureState(next);
      if (next.audio === "active") setMicOn(true);
      else if (next.audio === "denied" || next.audio === "unavailable") setMicOn(false);
      if (next.video === "active") setCamOn(true);
      else if (next.video === "denied" || next.video === "unavailable") setCamOn(false);
    });
    vc.onVolumes?.((levels) => {
      if (vcRef.current !== vc) return;
      const loudest = levels.reduce((best, level) => (level.level > best.level ? level : best), {
        uid: 0,
        level: 5,
      });
      setLoudestUid(loudest.level > 5 ? String(loudest.uid) : null);
    });
    vc.onConnectionState?.((state) => {
      if (vcRef.current !== vc) return;
      setConnState(state);
      if (state === "CONNECTED") setReconnectDismissed(false);
      if (state === "DISCONNECTED" && vcRef.current === vc) {
        setVideoError("Video disconnected — chat is still available.");
      }
    });

    await vc.join(tokenData, { audio: true, video: true });
    if (joinCancelled()) {
      if (vcRef.current === vc) vcRef.current = null;
      await vc.leave().catch(() => {});
      return;
    }
    setVideoJoined(true);
    setConnState("CONNECTED");
  }

  useEffect(() => {
    if (!squadId || !encId) return;

    let cancelled = false;
    let socket: ReturnType<typeof connectSocket> | undefined;
    const endedEvent = SOCKET_EVENTS.ENCOUNTER_ENDED;
    const activeEvent = SOCKET_EVENTS.ENCOUNTER_ACTIVE;
    const onEnded = (payload?: {
      encounterId?: string;
      reason?: string;
      queueStatus?: string;
      endedBySquadId?: string;
    }) => {
      if (payload?.encounterId && payload.encounterId !== encId) return;
      if (nextPendingRef.current) return;
      if (payload?.reason === 'next_squad') {
        void leaveVideo();
        router.replace(`/${payload.queueStatus === 'searching' ? 'matchmaking' : 'lobby'}?squad=${squadId}`);
        return;
      }
      if (payload?.endedBySquadId === squadId) return;
      setEndedReason(payload?.reason === "squad_disconnected" ? "opponent-left" : "ended");
      setEndedNotice(true);
      setEndError(null);
      setFindingNextMatch(false);
      // Give people time to read the overlay + choose an action before we
      // auto-return home.
      if (endedNavTimerRef.current) clearTimeout(endedNavTimerRef.current);
      endedNavTimerRef.current = setTimeout(() => router.push("/home"), 6500);
    };
    const onActive = () => {
      api
        .getEncounter(encId)
        .then(setEncounter)
        .catch(() => {});
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

      joinChainRef.current = joinChainRef.current
        .catch(() => {})
        .then(async () => {
          if (cancelled) return;
          try {
            await joinVideo(() => cancelled);
          } catch (error) {
            if (!cancelled) {
              setConnState("DISCONNECTED");
              setVideoError(describeVideoError(error));
            }
          }
        });

      socket = connectSocket(squadId);
      socket.emit(SOCKET_EMIT.JOIN_ENCOUNTER, encId);

      // Lifecycle: opponent (or server) ended the encounter -> show a brief notice
      // then return home so the user isn't stuck on a dead call.
      socket.on(endedEvent, onEnded);
      socket.on(activeEvent, onActive);
    };

    boot();

    return () => {
      if (endedNavTimerRef.current) {
        clearTimeout(endedNavTimerRef.current);
        endedNavTimerRef.current = null;
      }
      socket?.off(endedEvent, onEnded);
      socket?.off(activeEvent, onActive);
      // Stop owned media now, even while a permission prompt is pending.
      // The chain still prevents the next join from overlapping SDK cleanup.
      cancelled = true;
      videoGenerationRef.current += 1;
      const staleClient = vcRef.current;
      vcRef.current = null;
      const stopping = staleClient?.leave().catch(() => {});
      joinChainRef.current = joinChainRef.current.catch(() => {}).then(() => stopping);
      setVideoJoined(false);
    };
  }, [squadId, encId, router]);

  function retryVideo() {
    if (videoRetrying) return;
    setVideoRetrying(true);
    joinChainRef.current = joinChainRef.current
      .catch(() => {})
      .then(async () => {
        try {
          await joinVideo();
        } catch (error) {
          setConnState("DISCONNECTED");
          setVideoError(describeVideoError(error));
        } finally {
          setVideoRetrying(false);
        }
      });
  }

  useEffect(() => {
    if (connState !== "CONNECTED") return;
    const tick = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(tick);
  }, [connState]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  const mySquad = encounter
    ? encounter.squadAId === squadId
      ? {
          name: encounter.squadAName,
          members: encounter.squadAMembers,
          cover: encounter.squadACover,
          id: encounter.squadAId,
        }
      : {
          name: encounter.squadBName,
          members: encounter.squadBMembers,
          cover: encounter.squadBCover,
          id: encounter.squadBId,
        }
    : null;
  const oppSquad = encounter
    ? encounter.squadAId === squadId
      ? {
          name: encounter.squadBName,
          members: encounter.squadBMembers,
          cover: encounter.squadBCover,
          id: encounter.squadBId,
        }
      : {
          name: encounter.squadAName,
          members: encounter.squadAMembers,
          cover: encounter.squadACover,
          id: encounter.squadAId,
        }
    : null;
  const opponentUserIds =
    createOpponentUserIds({ squadId, ownUserId: session.user?.id, encounter }) ?? [];
  const canBlockOpponent = opponentUserIds.length > 0;

  const myMembers = mySquad?.members ?? [];
  const oppMembers = oppSquad?.members ?? [];
  const myUserId = session.user?.id ?? "";
  const mineParticipants: EncounterParticipant[] = myMembers.map((m, i) => ({
    id: m.userId,
    memberId: m.memberId,
    name: m.displayName,
    side: "mine",
    colorIndex: i,
    avatar: resolveAvatar(m.avatar, m.userId),
    uid: m.uid,
    isLocal:
      m.userId === myUserId ||
      (myUidRef.current != null && String(m.uid) === String(myUidRef.current)),
  }));
  const theirParticipants: EncounterParticipant[] = oppMembers.map((m, i) => ({
    id: m.userId,
    memberId: m.memberId,
    name: m.displayName,
    side: "theirs",
    colorIndex: i + 4,
    avatar: resolveAvatar(m.avatar, m.userId),
    uid: m.uid,
    isLocal: false,
  }));
  const participants = [...mineParticipants, ...theirParticipants];
  const participantIdsKey = JSON.stringify(participants.map((person) => person.id));
  const activeSpeakerId = loudestUid
    ? (participants.find(
        (person) => String(person.isLocal ? myUidRef.current : person.uid) === loudestUid,
      )?.id ?? null)
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
    const advance = () =>
      setSpeakerFocus((previous) =>
        advanceSpeakerFocus(ids, previous, activeSpeakerId, Date.now()),
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
      if (event.key === "Escape" && !moreOpen && !reactionsOpen && !chatOpen && !endConfirmOpen)
        setPinnedId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moreOpen, reactionsOpen, chatOpen, endConfirmOpen]);

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
  }, [videoJoined, camOn, participantIdsKey, layout.kind, pinnedId]);

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
  }, [remoteVideoKey, videoJoined, participantIdsKey, layout.kind, pinnedId]);

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

  async function leaveVideo() {
    videoGenerationRef.current += 1;
    const client = vcRef.current;
    vcRef.current = null;
    setVideoJoined(false);
    try {
      await client?.leave();
    } catch {}
  }

  async function leaveVideoAndGoHome() {
    await leaveVideo();
    router.replace("/home");
  }

  async function handlePersonalLeave() {
    setEnding(true);
    setEndError(null);
    await leaveVideo();
    try {
      await api.setEncounterVideo(squadId, false);
      router.replace("/home");
    } catch {
      setEnding(false);
      setEndError("Your camera and microphone are off. Couldn’t update your call status. Try leaving again.");
    }
  }

  async function findNextSquad() {
    if (!squadId || !encId || nextPendingRef.current) return;
    nextPendingRef.current = true;
    setNextPending(true);
    setNextError('');
    try {
      const result = await api.skip(squadId, encId);
      await leaveVideo();
      router.replace(`/${result.queueStatus === 'searching' ? 'matchmaking' : 'lobby'}?squad=${squadId}`);
    } catch {
      nextPendingRef.current = false;
      setNextPending(false);
      setNextError('Couldn’t move your squad. Try again.');
    }
  }

  async function handleEnd() {
    setEnding(true);
    setEndError(null);
    const mediaExit = leaveVideo();
    try {
      await api.disconnectEncounter(squadId, encId);
      await mediaExit;
      router.replace("/home");
    } catch {
      await mediaExit;
      setEnding(false);
      setEndError("Couldn't end this encounter yet. Reconnecting your video…");
      retryVideo();
    }
  }

  async function handleBlockOpponent() {
    if (!canBlockOpponent || blocking) return;
    setBlocking(true);
    setBlockError(null);
    try {
      await api.blockUsers(opponentUserIds);
      await api.disconnectEncounter(squadId, encId);
      await leaveVideoAndGoHome();
    } catch {
      setBlocking(false);
      setBlockError("Couldn't block this squad yet. Try again.");
    }
  }

  async function handleReport() {
    if (reported || reporting || !encounter) return;
    setVideoError(null);
    setReporting(true);
    const result = await reportOpponentSquad({
      encounterId: encId,
      squadId,
      encounter,
    });
    setReporting(false);
    if (!result.ok) {
      setVideoError("Report was not sent. Check your connection and try again.");
      return;
    }
    setReported(true);
    setUiTimeout(() => setReported(false), 2500);
  }

  // Spawn a floating emoji locally (used for both our own taps and ones we
  // receive from other participants over the socket).
  function spawnReaction(emoji: string, senderId: string) {
    const id = ++reactionCountRef.current;
    setFloatingReactions((prev) => [...prev, { id, emoji, senderId }]);
    setUiTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
    }, 1800);
  }

  function fireReaction(emoji: string) {
    if (!encId || !squadId) return;
    setVideoError(null);
    const sent = sendReaction({ kind: "encounter", encounterId: encId, squadId }, emoji, {
      id: session.user?.id ?? "",
      name: session.user?.name ?? "You",
    });
    if (!sent) {
      setVideoError("Reaction was not sent. Check your connection and try again.");
      return;
    }
    spawnReaction(emoji, session.user?.id ?? "");
  }

  // Receive reactions from other participants (skip our own echo).
  useEffect(() => {
    const myId = session.user?.id;
    const unsub = subscribeReaction((r) => {
      if (r.encounterId !== encId) return;
      if (r.senderId && r.senderId === myId) return; // already shown optimistically
      if (r.emoji) spawnReaction(r.emoji, r.senderId);
    });
    return unsub;
  }, [encId]);

  const upsertChatMessage = useCallback((message: ChatPanelMessage) => {
    setChatMessages((previous) => mergeChatMessage(previous, message));
  }, []);

  const markChatFailed = useCallback((clientMessageId: string) => {
    setChatMessages((previous) =>
      previous.map((message) =>
        message.clientMessageId === clientMessageId && message.delivery !== "delivered"
          ? { ...message, delivery: "failed" }
          : message,
      ),
    );
  }, []);

  function sendEncounterMessage(
    text: string,
    retryClientMessageId?: string,
    audience = chatAudience,
  ): boolean {
    if (!encId || !squadId) return false;
    const clientMessageId = retryClientMessageId ?? crypto.randomUUID();
    upsertChatMessage({
      id: clientMessageId,
      clientMessageId,
      userId: session.user?.id ?? "",
      name: session.user?.name ?? "You",
      text,
      ts: Date.now(),
      encounterId: audience === "everyone" ? encId : undefined,
      squadId,
      delivery: "sending",
    });
    const sent = sendChatMessage(
      audience === "everyone"
        ? { kind: "encounter", encounterId: encId, squadId }
        : { kind: "lobby", squadId },
      text,
      { id: session.user?.id ?? "", name: session.user?.name ?? "You" },
      {
        clientMessageId,
        ack: (result) => {
          if (result.ok) upsertChatMessage({ ...result.message, delivery: "delivered" });
          else markChatFailed(clientMessageId);
        },
      },
    );
    if (!sent) markChatFailed(clientMessageId);
    return true;
  }

  function retryEncounterMessage(message: ChatPanelMessage) {
    sendEncounterMessage(
      message.text,
      message.clientMessageId ?? message.id,
      message.encounterId ? "everyone" : "squad",
    );
  }

  // Keep encounter messages for the route lifetime. Count messages from others
  // while the panel is closed and clear the badge as soon as it opens.
  useEffect(() => {
    if (!encId || !squadId) return;
    try {
      joinChat({ kind: "encounter", encounterId: encId, squadId });
    } catch {}
    const unsub = subscribeChat((m) => {
      if (
        !chatMessageMatchesScope(m, { kind: "encounter", encounterId: encId, squadId }) &&
        !chatMessageMatchesScope(m, { kind: "lobby", squadId })
      )
        return;
      upsertChatMessage({ ...m, delivery: "delivered" });
      if (myUserId && m.userId === myUserId) return;
      const audience = m.encounterId ? "everyone" : "squad";
      if (chatVisibleRef.current && chatAudienceRef.current === audience) return;
      setChatUnread((counts) => ({ ...counts, [audience]: Math.min(counts[audience] + 1, 99) }));
    });
    return unsub;
  }, [encId, squadId, myUserId, upsertChatMessage]);
  chatVisibleRef.current = chatOpen;
  useEffect(() => {
    if (chatOpen) setChatUnread((counts) => ({ ...counts, [chatAudience]: 0 }));
  }, [chatOpen, chatAudience]);
  useEffect(() => {
    setChatMessages([]);
    setChatDrafts({ everyone: "", squad: "" });
    setChatUnread({ everyone: 0, squad: 0 });
  }, [encId, squadId]);

  function handleTileClick(id: string) {
    setPinnedId((previous) => (previous === id ? null : id));
  }

  const participantById = new Map(participants.map((person) => [person.id, person]));

  function renderParticipant(id: string, fit: MediaFit, compact = false, adaptive = false) {
    const person = participantById.get(id);
    if (!person) return null;
    return (
      <VideoTile
        key={person.id}
        name={person.name}
        colorIndex={person.colorIndex}
        micOn={micOnFor(person.isLocal, person.uid)}
        hasVideo={videoJoined && (person.isLocal ? camOn && captureState.video === "active" : !!remoteFor(person.uid)?.hasVideo)}
        mutedForMe={remoteFor(person.uid)?.mutedForMe}
        onMute={!person.isLocal && person.uid != null && remoteFor(person.uid) ? async muted => {
          if (!vcRef.current) throw new Error("The call is reconnecting. Try again.");
          await vcRef.current.setRemoteAudioMuted(person.uid!, muted);
        } : undefined}
        videoRef={participantRef(person.isLocal, person.uid)}
        isLocal={person.isLocal}
        avatarValue={person.isLocal ? myAvatar : person.avatar}
        isSpeaking={isSpeakingFor(person.isLocal, person.uid)}
        statusText={statusTextFor(person.isLocal, person.uid)}
        onClick={() => handleTileClick(person.id)}
        focused={pinnedId === person.id}
        showFocusHint
        compact={compact}
        fit={fit}
        backdrop
        reactions={floatingReactions.filter((reaction) => reaction.senderId === person.id)}
      />
    );
  }

  function squadLabel(name: string, count: number) {
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
          padding: "5px 10px",
          borderRadius: "var(--radius-pill, 999px)",
          background: "color-mix(in srgb, var(--surface) 88%, transparent)",
          backdropFilter: "blur(12px)",
          border: "var(--control-border, 1px solid rgba(255,255,255,.11))",
        }}
      >
        <span
          style={{
            color: "var(--text)",
            fontSize: 12,
            fontWeight: 700,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 700 }}>{count}</span>
      </div>
    );
  }

  function renderFilmstrip(ids: string[], label: string) {
    if (!ids.length) return null;
    return (
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 8,
          width: "100%",
          minWidth: 0,
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
            color: "var(--text)",
            background: "color-mix(in srgb, var(--surface) 90%, transparent)",
            border: "var(--control-border)",
            borderRadius: "var(--radius-control, 10px)",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: ".08em",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
        {ids.map((id) => (
          <div
            key={id}
            style={{ height: "100%", aspectRatio: isPhone ? "4 / 3" : "16 / 9", flexShrink: 0 }}
          >
            {renderParticipant(id, "crop", true)}
          </div>
        ))}
      </div>
    );
  }

  function renderSegmentedFilmstrip(mineIds: string[], theirIds: string[]) {
    if (!mineIds.length && !theirIds.length) return null;
    const selectedIds = stripSide === "mine" ? mineIds : theirIds;
    return (
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          width: "100%",
          minWidth: 0,
          height: isPhone ? 138 : 160,
          flexShrink: 0,
        }}
      >
        <div
          role="group"
          aria-label="Filmstrip squad"
          style={{
            display: "flex",
            gap: 4,
            height: 50,
            padding: 3,
            borderRadius: "var(--radius-pill, 999px)",
            background: "color-mix(in srgb, var(--surface) 90%, transparent)",
            border: "var(--control-border)",
            alignSelf: "center",
          }}
        >
          {(["mine", "theirs"] as const).map((side) => {
            const selected = stripSide === side;
            return (
              <button
                key={side}
                type="button"
                onClick={() => setStripSide(side)}
                aria-pressed={selected}
                aria-label={side === "mine" ? "Show your squad" : "Show opponent squad"}
                style={{
                  minWidth: 92,
                  height: 44,
                  padding: "0 14px",
                  border: selected ? "1px solid rgba(255,255,255,.16)" : "1px solid transparent",
                  borderRadius: "var(--radius-pill, 999px)",
                  background: selected ? "var(--accent-soft)" : "transparent",
                  color: selected ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                {side === "mine" ? "Yours" : "Theirs"}
              </button>
            );
          })}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "stretch",
            gap: 8,
            width: "100%",
            minWidth: 0,
            height: isPhone ? 82 : 104,
            overflowX: "auto",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {selectedIds.map((id) => (
            <div
              key={id}
              style={{ height: "100%", aspectRatio: isPhone ? "4 / 3" : "16 / 9", flexShrink: 0 }}
            >
              {renderParticipant(id, "crop", true)}
            </div>
          ))}
          {!selectedIds.length && (
            <div
              style={{
                width: "100%",
                display: "grid",
                alignItems: "center",
                justifyContent: "center",
                color: textMuted,
                fontSize: 12,
              }}
            >
              No other participants
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderSquadSplitSide(side: "mine" | "theirs") {
    const people = side === "mine" ? mineParticipants : theirParticipants;
    const squad = side === "mine" ? mySquad : oppSquad;
    return (
      <section
        aria-label={side === "mine" ? "Your squad" : "Other squad"}
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          overflow: "hidden",
          borderRadius: "var(--radius-card, 18px)",
          padding: "38px 4px 4px",
        }}
      >
        {squadLabel(squad?.name ?? (side === "mine" ? "Your squad" : "Their squad"), people.length)}
        {people.length ? (
          <div
            style={{
              position: "relative",
              zIndex: 1,
              display: "flex",
              flexWrap: people.length > 2 ? "wrap" : "nowrap",
              gap: 8,
              height: "100%",
              minHeight: 0,
            }}
          >
            {people.map((person) => (
              <div
                key={person.id}
                style={{
                  flex: people.length > 2 ? "1 1 calc(50% - 4px)" : 1,
                  minWidth: 0,
                  minHeight: 0,
                }}
              >
                {renderParticipant(person.id, "fit")}
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              position: "relative",
              zIndex: 1,
              height: "100%",
              display: "grid",
              placeItems: "center",
            }}
          >
            <WaitingForSquad
              label={side === "mine" ? "Waiting for your squad…" : "Waiting for the other squad…"}
            />
          </div>
        )}
      </section>
    );
  }

  function renderFeaturedSide(side: "mine" | "theirs", filmstrip: boolean) {
    const primaryId = side === "mine" ? layout.minePrimaryId : layout.theirsPrimaryId;
    const stripIds = side === "mine" ? layout.mineStripIds : layout.theirsStripIds;
    const squad = side === "mine" ? mySquad : oppSquad;
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
          borderRadius: "var(--radius-card, 18px)",
          padding: "38px 4px 4px",
        }}
      >
        {squadLabel(squad?.name ?? (side === "mine" ? "Your squad" : "Their squad"), count)}
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
            {useFilmstrip
              ? renderFilmstrip(stripIds, side === "mine" ? "Yours" : "Theirs")
              : stripIds.length > 0 && (
                  <div
                    style={{
                      width: "29%",
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      minHeight: 0,
                    }}
                  >
                    {stripIds.map((id) => (
                      <div key={id} style={{ flex: 1, minHeight: 0 }}>
                        {renderParticipant(id, "crop", true)}
                      </div>
                    ))}
                  </div>
                )}
          </div>
        ) : (
          <div
            style={{
              position: "relative",
              zIndex: 1,
              height: "100%",
              display: "grid",
              placeItems: "center",
            }}
          >
            <WaitingForSquad
              label={side === "mine" ? "Waiting for your squad…" : "Waiting for the other squad…"}
            />
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
    const companionIds = participants
      .filter((person) => person.id !== focusId && person.id !== local?.id)
      .map((person) => person.id);
    return (
      <div
        style={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          overflow: "hidden",
        }}
      >
        <div style={{ position: "relative", zIndex: 1, flex: 1, minHeight: 0 }}>
          {renderParticipant(focusId, focusedFit)}
        </div>
        {withFilmstrip
          ? renderSegmentedFilmstrip(mineIds, theirIds)
          : companionIds.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  right: 12,
                  bottom: 12,
                  zIndex: 5,
                  width: isPhone ? 112 : 168,
                  aspectRatio: "16 / 10",
                }}
              >
                {renderParticipant(companionIds[0], "crop", true)}
              </div>
            )}
        {showSelfView && !selfViewMinimized && (
          <div
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              zIndex: 6,
              width: isPhone ? 96 : 148,
              aspectRatio: "16 / 10",
            }}
          >
            {renderParticipant(local.id, "crop", true)}
          </div>
        )}
      </div>
    );
  }

  function renderAdaptiveStage() {
    if (!pinnedId) return <AdaptiveVideoStage
      mine={mineParticipants.map(person => ({ id: person.id, cameraOn: person.isLocal ? camOn && videoJoined : !!remoteFor(person.uid)?.hasVideo }))}
      theirs={theirParticipants.map(person => ({ id: person.id, cameraOn: !!remoteFor(person.uid)?.hasVideo }))}
      mineLabel={mySquad?.name ? `Your squad · ${mySquad.name}` : "Your squad"}
      theirsLabel={oppSquad?.name ? `Their squad · ${oppSquad.name}` : "Their squad"}
      renderParticipant={id => renderParticipant(id, "crop", false, true)}
    />;

    if (layout.kind === "remote-main") return renderFocusedStage(false);
    if (layout.kind === "squad-split") {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: isPhone ? "column" : "row",
            gap: 8,
            flex: 1,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          {renderSquadSplitSide("mine")}
          {renderSquadSplitSide("theirs")}
        </div>
      );
    }
    if (layout.kind === "featured-split") {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: isPhone && height >= Math.max(width, 640) ? "column" : "row",
            gap: 8,
            flex: 1,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          {renderFeaturedSide("mine", false)}
          {renderFeaturedSide("theirs", false)}
        </div>
      );
    }
    if (layout.kind === "dual-focus") {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            gap: 8,
            flex: 1,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          {renderFeaturedSide("mine", true)}
          {renderFeaturedSide("theirs", true)}
        </div>
      );
    }
    return renderFocusedStage(true);
  }

  const renderStage = () => (
    <div
      data-layout-kind={pinnedId ? layout.kind : "adaptive-grid"}
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

  function reactionChoices(onDone: () => void) {
    return REACTION_EMOJIS.map((emoji) => (
      <button
        key={emoji}
        onClick={() => {
          fireReaction(emoji);
          onDone();
        }}
        title={`React ${emoji}`}
        aria-label={`React ${emoji}`}
        className="gg-press"
        style={{
          width: 44,
          height: 44,
          flexShrink: 0,
          borderRadius: "var(--radius-control, 14px)",
          border: "var(--control-border)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 22,
          background: "var(--overlay)",
        }}
      >
        {emoji}
      </button>
    ));
  }

  // ── CONTROL BUTTONS CONFIG ────────────────────────────────────────────────

  function toggleChat() {
    setMoreOpen(false);
    setReactionsOpen(false);
    setChatOpen((open) => !open);
  }

  function closeChat() {
    setChatOpen(false);
    requestAnimationFrame(() => chatButtonRef.current?.focus());
  }

  function toggleMore() {
    const next = !moreOpen;
    setChatOpen(false);
    setReactionsOpen(false);
    setMoreOpen(next);
  }

  function toggleReactions() {
    const next = !reactionsOpen;
    setChatOpen(false);
    setMoreOpen(false);
    setReactionsOpen(next);
  }

  const hasFocusedFrame = !!pinnedId;
  const localParticipant = participants.find((person) => person.isLocal);
  const hasCompactSelfView =
    !!pinnedId &&
    !!localParticipant &&
    localParticipant.id !== layout.focusId &&
    (layout.kind === "remote-main" || layout.kind === "single-focus");

  const ctrlBtns = [
    {
      id: "mic",
      icon: <Icon.mic size={20} color={micOn ? "var(--text)" : "#fff"} />,
      active: micOn,
      danger: true,
      onClick: toggleMic,
      title: micOn ? "Mute microphone" : "Unmute microphone",
      badge: 0,
    },
    {
      id: "cam",
      icon: <Icon.cam size={20} color={camOn ? "var(--text)" : "#fff"} />,
      active: camOn,
      danger: true,
      onClick: toggleCam,
      title: camOn ? "Turn camera off" : "Turn camera on",
      badge: 0,
    },
    {
      id: "chat",
      icon: <Icon.chat size={20} color={chatOpen ? "var(--accent)" : "var(--text)"} />,
      active: chatOpen,
      danger: false,
      onClick: toggleChat,
      title: "Chat",
      badge: !chatOpen && unread > 0 ? unread : 0,
    },
    {
      id: "more",
      icon: (
        <span
          aria-hidden
          style={{
            color: moreOpen ? "var(--accent)" : "var(--text)",
            fontSize: 18,
            fontWeight: 800,
            letterSpacing: 1,
          }}
        >
          •••
        </span>
      ),
      active: moreOpen,
      danger: false,
      onClick: toggleMore,
      title: "More",
      badge: 0,
    },
  ];

  const pinnedMemberName = pinnedId ? (participantById.get(pinnedId)?.name ?? null) : null;
  const captureIssues = [
    captureState.audio === "denied"
      ? "Microphone permission is blocked."
      : captureState.audio === "unavailable"
        ? "No usable microphone was found."
        : null,
    captureState.video === "denied"
      ? "Camera permission is blocked."
      : captureState.video === "unavailable"
        ? "No usable camera was found."
        : null,
  ].filter((message): message is string => !!message);
  const recoveryMessages = [
    ...new Set([videoError, ...captureIssues].filter((message): message is string => !!message)),
  ];
  const transientNotice = reported
    ? "reported"
    : connState === "RECONNECTING" && !reconnectDismissed
      ? "reconnecting"
      : null;

  if (!squadId || !encId) {
    return (
      <div
        style={{
          height: "100%",
          display: "grid",
          placeItems: "center",
          background: "var(--bg)",
          color: "var(--text)",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "min(460px, 100%)",
            background: "linear-gradient(155deg, var(--surface-grad-from), var(--surface-grad-to))",
            border: "1px solid var(--border-strong)",
            borderRadius: 20,
            padding: 24,
            textAlign: "center",
            boxShadow: "var(--shadow-card, var(--elev))",
          }}
        >
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 16,
              margin: "0 auto 16px",
              display: "grid",
              placeItems: "center",
              background: "var(--overlay)",
              border: "1px solid var(--border)",
            }}
          >
            <Icon.cam size={24} color="var(--lime)" />
          </div>
          <h1
            style={{
              margin: 0,
              color: "var(--text)",
              fontFamily: "var(--font-display, var(--font-space-grotesk))",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.03em",
            }}
          >
            Encounter unavailable
          </h1>
          <p
            style={{
              margin: "10px 0 22px",
              color: "var(--text-muted)",
              lineHeight: 1.5,
              fontSize: 14,
            }}
          >
            This live room link is missing required details.
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            {squadId && (
              <button
                onClick={() => router.push(`/lobby?squad=${squadId}`)}
                className="gg-press"
                style={{
                  minHeight: 44,
                  padding: "0 18px",
                  borderRadius: 999,
                  border: "none",
                  background: "var(--violet)",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Find a match
              </button>
            )}
            <button
              onClick={() => router.push("/home")}
              className="gg-press"
              style={{
                minHeight: 44,
                padding: "0 18px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--overlay)",
                color: "var(--text)",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (encounterLoading) {
    return (
      <div
        style={{
          height: "100%",
          display: "grid",
          placeItems: "center",
          background: "var(--bg)",
          color: "var(--text)",
          padding: 24,
        }}
      >
        <WaitingForSquad label="Opening encounter..." />
      </div>
    );
  }

  if (encounterError || !encounter) {
    return (
      <div
        style={{
          height: "100%",
          display: "grid",
          placeItems: "center",
          background: "var(--bg)",
          color: "var(--text)",
          padding: 24,
        }}
      >
        <div
          style={{
            width: "min(460px, 100%)",
            background: "linear-gradient(155deg, var(--surface-grad-from), var(--surface-grad-to))",
            border: "1px solid var(--border-strong)",
            borderRadius: 20,
            padding: 24,
            textAlign: "center",
            boxShadow: "var(--shadow-card, var(--elev))",
          }}
        >
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 16,
              margin: "0 auto 16px",
              display: "grid",
              placeItems: "center",
              background: "var(--overlay)",
              border: "1px solid var(--border)",
            }}
          >
            <Icon.cam size={24} color="var(--lime)" />
          </div>
          <h1
            style={{
              margin: 0,
              color: "var(--text)",
              fontFamily: "var(--font-display, var(--font-space-grotesk))",
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: "-0.03em",
            }}
          >
            Encounter unavailable
          </h1>
          <p
            style={{
              margin: "10px 0 22px",
              color: "var(--text-muted)",
              lineHeight: 1.5,
              fontSize: 14,
            }}
          >
            {encounterError ?? "This live room could not be loaded."}
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            {squadId && (
              <button
                onClick={() => router.push(`/lobby?squad=${squadId}`)}
                className="gg-press"
                style={{
                  minHeight: 44,
                  padding: "0 18px",
                  borderRadius: 999,
                  border: "none",
                  background: "var(--violet)",
                  color: "#fff",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Find a match
              </button>
            )}
            <button
              onClick={() => router.push("/home")}
              className="gg-press"
              style={{
                minHeight: 44,
                padding: "0 18px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--overlay)",
                color: "var(--text)",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div
        data-testid="encounter-shell"
        className="gg-screen-call"
        style={{
          display: "flex",
          flexDirection: "column",
          height: `calc(100% - ${keyboardInset}px)`,
          background: "var(--bg)",
          color: "var(--text)",
          fontFamily: "var(--font-body, var(--font-inter))",
          overflow: "hidden",
        }}
      >
        {/* ── SLIM HEADER ─────────────────────────────────────────────────── */}
        <div
          data-testid="encounter-header"
          className="call-top"
          style={{
            display: "flex",
            alignItems: "center",
            gap: isPhoneChrome ? 6 : 12,
            padding: isPhoneChrome ? "7px 10px" : "9px 20px",
            flexShrink: 0,
            zIndex: 10,
            overflow: "hidden",
            maxWidth: "100vw",
          }}
        >
          {/* Friendly room context, not a competitive matchup. Phone labels live
              directly over the corresponding video groups. */}
          <div
            style={{
              display: isPhoneChrome ? "none" : "flex",
              alignItems: "center",
              gap: 6,
              minWidth: 0,
              overflow: "hidden",
              whiteSpace: "nowrap" as const,
              flexShrink: 1,
            }}
          >
            {[
              [mySquad?.name ?? "Your squad", mineParticipants.length],
              [oppSquad?.name ?? "Their squad", theirParticipants.length],
            ].map(([name, count]) => (
              <span
                key={String(name)}
                className="call-title"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                  maxWidth: 190,
                  padding: "4px 9px",
                  fontSize: 13,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{count}</span>
              </span>
            ))}
          </div>

          {/* Focused chip — only shown when a person is pinned */}
          {pinnedMemberName && (
            <div
              style={{
                display: isPhoneChrome ? "none" : "flex",
                alignItems: "center",
                gap: 6,
                background: "var(--accent-soft)",
                border: "1px solid var(--accent-line)",
                borderRadius: "var(--radius-pill)",
                padding: "3px 10px",
                fontSize: 12,
                fontWeight: 600,
                color: "var(--accent)",
                flexShrink: 0,
                fontFamily: "var(--font-display, var(--font-space-grotesk))",
              }}
            >
              <Icon.pin size={12} color="var(--accent)" />
              <span
                style={{
                  maxWidth: 160,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap" as const,
                }}
              >
                {pinnedMemberName}
              </span>
              <button
                onClick={() => setPinnedId(null)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontSize: 13,
                  lineHeight: 1,
                  padding: "0 2px",
                  display: "flex",
                  alignItems: "center",
                }}
                title="Exit focus"
                aria-label="Exit focus"
              >
                <Icon.close size={12} color="var(--text-muted)" />
              </button>
            </div>
          )}

          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {connState === "CONNECTED" ? (
              <>
                <span
                  className="pill live"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 12,
                    padding: isPhoneChrome ? "2px 7px" : "3px 10px",
                  }}
                >
                  <span
                    className="dot"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: "var(--live)",
                      animation: "livePulse 1.6s ease-in-out infinite",
                    }}
                  />
                  LIVE
                </span>
                <span
                  className="timer"
                  style={{
                    fontSize: isPhoneChrome ? 13 : 14,
                    minWidth: isPhoneChrome ? 38 : 48,
                  }}
                >
                  {fmt(elapsed)}
                </span>
              </>
            ) : (
              <span
                role="status"
                className="gg-call-status"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: connState === "DISCONNECTED" ? coral : textMuted,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: connState === "DISCONNECTED" ? coral : "var(--amber, #FFB020)",
                  }}
                />
                {connState === "RECONNECTING"
                  ? "Reconnecting"
                  : connState === "DISCONNECTED"
                    ? "Disconnected"
                    : "Connecting"}
              </span>
            )}
          </div>
        </div>

        {/* ── MAIN AREA ────────────────────────────────────────────────────── */}
        <div
          className={`gg-encounter-content ${chatOpen ? "gg-chat-open" : ""}`}
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* ── VIDEO STAGE ─────────────────────────────────────────────── */}
          <div
            data-testid="video-stage"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              background: "var(--stage, #101013)",
              position: "relative",
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            {recoveryMessages.length > 0 && (
              <div
                data-testid="media-recovery-notice"
                role="alert"
                style={{
                  // In flow (not a floating toast) so it never covers a person's tile.
                  flexShrink: 0,
                  alignSelf: "center",
                  margin: "10px 12px 0",
                  maxWidth: "calc(100% - 24px)",
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 10,
                  background: "var(--surface, rgba(22,22,30,0.97))",
                  backgroundImage: "linear-gradient(var(--coral-soft), var(--coral-soft))",
                  border: "1px solid color-mix(in srgb, var(--coral) 38%, transparent)",
                  borderRadius: 12,
                  padding: "9px 12px 9px 14px",
                  boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: coral,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{ fontSize: 13, fontWeight: 600, color: textPrimary, lineHeight: 1.4 }}
                >
                {recoveryMessages.join(" ")}
                </span>
                <button
                  onClick={retryVideo}
                  disabled={videoRetrying}
                  style={{
                    minHeight: 44,
                    padding: "0 13px",
                    borderRadius: 999,
                    border: "var(--control-border)",
                    background: "var(--overlay)",
                    color: textPrimary,
                    fontWeight: 700,
                    cursor: videoRetrying ? "default" : "pointer",
                  }}
                >
                  {videoRetrying ? "Retrying…" : "Retry devices"}
                </button>
                {videoError && (
                  <button
                    onClick={() => setVideoError(null)}
                    title="Dismiss"
                    aria-label="Dismiss media notice"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: textMuted,
                      fontSize: 16,
                      width: 44,
                      height: 44,
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
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
              {transientNotice && (
                <div
                  data-testid="encounter-transient-notice"
                  role="status"
                  style={{
                    pointerEvents: "auto",
                    background: "var(--surface)",
                    backdropFilter: "blur(16px)",
                    border:
                      transientNotice === "reported"
                        ? "1px solid var(--accent-line)"
                        : "1px solid color-mix(in srgb, var(--amber) 45%, transparent)",
                    borderRadius: 12,
                    padding: "8px 10px 8px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    whiteSpace: "nowrap" as const,
                    boxShadow: "var(--shadow-card)",
                    fontFamily: "var(--font-display, var(--font-space-grotesk))",
                    fontSize: 13,
                    fontWeight: 700,
                    color: transientNotice === "reported" ? lime : textPrimary,
                  }}
                >
                  {transientNotice === "reported" ? (
                    <>
                      <Icon.flag size={14} color={lime} />
                      Reported — thanks for keeping Giggle safe
                    </>
                  ) : (
                    <>
                      <span
                        aria-hidden
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
                      <span>Reconnecting…</span>
                      <button
                        onClick={() => setReconnectDismissed(true)}
                        aria-label="Dismiss reconnecting notice"
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: textMuted,
                          fontSize: 16,
                          width: 44,
                          height: 44,
                          padding: 0,
                        }}
                      >
                        ×
                      </button>
                    </>
                  )}
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
                  {WEB_DISCOVERY_ENABLED && endedReason === "opponent-left"
                    ? "You can jump straight into another match."
                    : "Thanks for hanging out."}
                </div>
                {endError && (
                  <div role="alert" style={{ color: coral, fontSize: 13, textAlign: "center" }}>
                    {endError}
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    marginTop: 8,
                    flexWrap: "wrap",
                    justifyContent: "center",
                  }}
                >
                  {WEB_DISCOVERY_ENABLED && (
                    <Button
                      onClick={async () => {
                        if (endedNavTimerRef.current) {
                          clearTimeout(endedNavTimerRef.current);
                          endedNavTimerRef.current = null;
                        }
                        setEndError(null);
                        setFindingNextMatch(true);
                        try {
                          if (endedReason !== "opponent-left") await api.startSearch(squadId);
                          router.push(`/matchmaking?squad=${squadId}`);
                        } catch (error) {
                          setEndError(
                            (error as { message?: string })?.message ||
                              "Couldn't start matchmaking.",
                          );
                          setFindingNextMatch(false);
                        }
                      }}
                      loading={findingNextMatch}
                      variant="primary"
                    >
                      {endedReason === "opponent-left" ? "Continue matching" : "Find another match"}
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      if (endedNavTimerRef.current) {
                        clearTimeout(endedNavTimerRef.current);
                        endedNavTimerRef.current = null;
                      }
                      router.push("/home");
                    }}
                    variant="secondary"
                  >
                    Back home
                  </Button>
                </div>
              </div>
            )}

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
                paddingBottom: 8,
              }}
            >
              {renderStage()}
            </div>
          </div>

          {/* Kept mounted so closing chat preserves drafts and never moves video hosts. */}
          <aside className="gg-encounter-chat" hidden={!chatOpen} aria-label="Call chat">
            <ChatPanel
              scope={chatScope}
              title="Chat"
              onClose={closeChat}
              messages={chatMessages}
              onSend={sendEncounterMessage}
              onRetry={retryEncounterMessage}
              draft={chatDrafts[chatAudience]}
              onDraftChange={(value) =>
                setChatDrafts((drafts) => ({ ...drafts, [chatAudience]: value }))
              }
              audienceControls={
                <div className="gg-chat-audience">
                  <button className="gg-phone-back" onClick={closeChat}>
                    ← Back to video
                  </button>
                  <div role="group" aria-label="Send messages to">
                    {(["everyone", "squad"] as const).map((audience) => (
                      <button
                        key={audience}
                        aria-pressed={chatAudience === audience}
                        onClick={() => setChatAudience(audience)}
                      >
                        {audience === "everyone" ? "Everyone" : "Your squad"}
                        {chatUnread[audience] > 0 && <span> {chatUnread[audience]}</span>}
                      </button>
                    ))}
                  </div>
                  <p>
                    {chatAudience === "everyone"
                      ? "Both squads can see these messages."
                      : "Only your squad can see these messages."}
                  </p>
                </div>
              }
            />
          </aside>
        </div>
        {/* ── FLOATING CONTROL BAR ─────────────────────────────────── */}
        <div
          className="gg-call-controls-wrap"
          style={{
            position: "relative",
            padding: "8px 0",
            flexShrink: 0,
            display: "flex",
            justifyContent: "center",
            zIndex: 40,
            pointerEvents: "none",
          }}
        >
          <div
            data-testid="call-controls"
            role="toolbar"
            aria-label="Encounter controls"
            className="call-bar"
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: isPhone ? 4 : 8,
              flexWrap: "nowrap",
              maxWidth: "calc(100vw - 16px)",
              padding: isPhone ? 8 : "9px 12px",
              opacity: 1,
            }}
          >
            {ctrlBtns.map(({ id, icon, active, danger, onClick, title, badge }) => {
              const hovered = hoveredCtrl === id;
              const off = danger && active === false;
              const selected = !danger && active === true;
              const background = off
                ? "var(--coral)"
                : selected
                  ? "var(--accent-soft)"
                  : hovered
                    ? "var(--overlay-hover)"
                    : "var(--overlay)";
              return (
                <div key={id} style={{ position: "relative", display: "flex", flexShrink: 0 }}>
                  <button
                    ref={id === "chat" ? chatButtonRef : id === "more" ? moreButtonRef : undefined}
                    onClick={onClick}
                    onMouseEnter={() => setHoveredCtrl(id)}
                    onMouseLeave={() => setHoveredCtrl(null)}
                    title={title}
                    aria-label={title}
                    aria-pressed={
                      id === "more" ? undefined : typeof active === "boolean" ? active : undefined
                    }
                    aria-expanded={id === "more" ? moreOpen : undefined}
                    className="gg-press cbtn" data-call-control data-cbtn-state={off ? "off" : selected ? "on" : undefined}
                    style={{
                      position: "relative",
                      width: isPhone ? 44 : 48,
                      height: isPhone ? 44 : 48,
                      flexShrink: 0,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      "--cbtn-bg": background,
                      "--cbtn-fg": off ? "#fff" : selected ? "var(--accent)" : "var(--text)",
                    } as CSSProperties}
                  >
                    {icon}
                    <span className="gg-control-label">{id === "cam" ? "Camera" : id === "mic" ? (micOn ? "Mic" : "Unmute") : id === "chat" ? "Chat" : "More"}</span>
                    {badge > 0 && (
                      <span
                        aria-label={String(badge) + " unread message" + (badge === 1 ? "" : "s")}
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
                          textAlign: "center",
                          border: "1.5px solid rgba(14,14,20,.94)",
                        }}
                      >
                        {badge > 9 ? "9+" : badge}
                      </span>
                    )}
                  </button>

                  {id === "more" && moreOpen && (
                    <div
                      ref={moreMenuRef}
                      role="group"
                      aria-label="More call actions"
                      style={{
                        position: "absolute",
                        right: isPhone ? "auto" : 0,
                        left: isPhone ? "50%" : "auto",
                        transform: isPhone ? "translateX(-50%)" : undefined,
                        bottom: "calc(100% + 10px)",
                        width: "min(280px, calc(100vw - 24px))",
                        padding: 10,
                        borderRadius: "var(--radius-card)",
                        border: "var(--control-border)",
                        background: "var(--surface)",
                        backdropFilter: "blur(18px)",
                        boxShadow: "var(--shadow-pop)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 7,
                      }}
                    >
                      {WEB_DISCOVERY_ENABLED && mySquad?.members.some(member => member.userId === session.user?.id && member.role === 'leader') && (
                        <button onClick={() => { closeMore(false); setNextError(''); setNextConfirmOpen(true); }} style={{ minHeight: 44, background: 'transparent', border: 0, color: 'var(--text)', textAlign: 'left' }}>Next squad</button>
                      )}
                      <button onClick={() => { setExitKind("end"); setEndError(null); closeMore(false); setEndConfirmOpen(true); }} aria-label="End encounter" style={{ minHeight: 44, background: "transparent", border: 0, color: "var(--coral)", textAlign: "left" }}>End encounter for both squads</button>
                      <div
                        style={{
                          color: textMuted,
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: ".08em",
                          textTransform: "uppercase",
                          padding: "2px 4px 0",
                        }}
                      >
                        Reactions
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {reactionChoices(() => closeMore(true))}
                      </div>
                      <button
                        onClick={() => {
                          handleReport();
                          closeMore(true);
                        }}
                        disabled={reported || reporting}
                        style={{
                          minHeight: 44,
                          padding: "0 12px",
                          borderRadius: "var(--radius-control)",
                          border: "var(--control-border)",
                          background: "var(--overlay)",
                          color: reported ? "var(--live)" : "var(--text)",
                          display: "flex",
                          alignItems: "center",
                          gap: 9,
                          cursor: reported || reporting ? "default" : "pointer",
                          fontWeight: 700,
                        }}
                      >
                        <Icon.flag
                          size={17}
                          color={reported ? "var(--live)" : "var(--text-muted)"}
                        />
                        {reported
                          ? "Reported"
                          : reporting
                            ? "Sending report…"
                            : "Report opponent squad"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setBlockError(null);
                          setBlockConfirmOpen(true);
                          closeMore(true);
                        }}
                        disabled={!canBlockOpponent || blocking}
                        aria-label="Block opponent squad"
                        style={{
                          minHeight: 44,
                          padding: "0 12px",
                          borderRadius: "var(--radius-control)",
                          border: "var(--control-border)",
                          background: "var(--overlay)",
                          color: "var(--coral)",
                          display: "flex",
                          alignItems: "center",
                          gap: 9,
                          cursor: !canBlockOpponent || blocking ? "default" : "pointer",
                          fontWeight: 700,
                        }}
                      >
                        <Icon.shield size={17} color="var(--coral)" />
                        Block opponent squad
                      </button>
                      {hasFocusedFrame && (
                        <button
                          onClick={() => {
                            setFocusedFit((fit) => (fit === "fit" ? "crop" : "fit"));
                            closeMore(true);
                          }}
                          style={{
                            minHeight: 44,
                            padding: "0 12px",
                            borderRadius: "var(--radius-control)",
                            border: "var(--control-border)",
                            background: "var(--overlay)",
                            color: "var(--text)",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: 700,
                          }}
                        >
                          {focusedFit === "fit" ? "Crop focused video" : "Fit focused video"}
                        </button>
                      )}
                      {hasCompactSelfView && (
                        <button
                          onClick={() => {
                            setSelfViewMinimized((minimized) => !minimized);
                            closeMore(true);
                          }}
                          style={{
                            minHeight: 44,
                            padding: "0 12px",
                            borderRadius: "var(--radius-control)",
                            border: "var(--control-border)",
                            background: "var(--overlay)",
                            color: "var(--text)",
                            textAlign: "left",
                            cursor: "pointer",
                            fontWeight: 700,
                          }}
                        >
                          {selfViewMinimized ? "Restore self-view" : "Minimize self-view"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              onClick={() => {
                setExitKind("leave");
                setEndError(null);
                setEndConfirmOpen(true);
              }}
              disabled={ending}
              aria-label="Leave call"
              onMouseEnter={() => setHoveredCtrl("end")}
              onMouseLeave={() => setHoveredCtrl(null)}
              className="gg-press cbtn leave" data-call-control data-call-leave
              style={{
                height: isPhone ? 44 : 48,
                minWidth: isPhone ? 64 : 110,
                flexShrink: 0,
                padding: isPhone ? "0 14px" : "0 20px",
                cursor: ending ? "default" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 14,
                fontWeight: 800,
                whiteSpace: "nowrap",
              }}
            >
              <Icon.hangup size={23} color="currentColor" /><span className="gg-control-label">Leave</span>
            </button>
          </div>
        </div>
      </div>

      {blockConfirmOpen && (
        <Modal
          onClose={() => {
            if (blocking) return;
            setBlockConfirmOpen(false);
            setBlockError(null);
          }}
          title="Block opponent squad?"
          subtitle="Every visible member of the opponent squad will be blocked. This does not send a report."
          showClose={false}
          closeOnBackdrop={!blocking}
          width={420}
        >
          {blockError && (
            <div role="alert" style={{ color: "var(--coral)", fontSize: 13, marginBottom: 16 }}>
              {blockError}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                setBlockConfirmOpen(false);
                setBlockError(null);
              }}
              disabled={blocking}
              className="gg-press"
              style={{
                minHeight: 44,
                padding: "0 18px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--overlay)",
                color: "var(--text)",
                fontWeight: 700,
                cursor: blocking ? "default" : "pointer",
              }}
            >
              Keep talking
            </button>
            <button
              type="button"
              onClick={handleBlockOpponent}
              disabled={!canBlockOpponent || blocking}
              aria-label="Block opponent squad"
              aria-busy={blocking}
              className="gg-press"
              style={{
                minHeight: 44,
                padding: "0 18px",
                borderRadius: 999,
                border: "none",
                background: "var(--coral)",
                color: "#fff",
                fontWeight: 800,
                cursor: !canBlockOpponent || blocking ? "default" : "pointer",
              }}
            >
              {blocking ? "Blocking…" : "Block everyone and leave"}
            </button>
          </div>
        </Modal>
      )}

      {nextConfirmOpen && (
        <Modal title="Find another squad?" subtitle="Your whole squad will leave this call and search together." onClose={() => { if (!nextPending) setNextConfirmOpen(false); }} showClose={false} closeOnBackdrop={!nextPending} width={420}>
          {nextError && <p role="alert" style={{ color: 'var(--coral)' }}>{nextError}</p>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="secondary" disabled={nextPending} onClick={() => setNextConfirmOpen(false)}>Keep talking</Button>
            <Button loading={nextPending} onClick={findNextSquad} aria-label="Confirm next squad">{nextPending ? 'Moving squad…' : 'Next squad'}</Button>
          </div>
        </Modal>
      )}

      {endConfirmOpen && (
        <Modal
          onClose={() => {
            if (ending) return;
            if (endError && exitKind === "leave") retryVideo();
            setEndConfirmOpen(false);
            setEndError(null);
          }}
          title={exitKind === "leave" ? "Leave this call?" : "End encounter?"}
          subtitle={exitKind === "leave" ? "Only you will leave. Your squad can keep talking." : "This ends the current encounter for both squads."}
          showClose={false}
          closeOnBackdrop={!ending}
          width={420}
        >
          {endError && (
            <div role="alert" style={{ color: "var(--coral)", fontSize: 13, marginBottom: 16 }}>
              {endError}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                if (endError && exitKind === "leave") retryVideo();
                setEndConfirmOpen(false);
                setEndError(null);
              }}
              disabled={ending}
              className="gg-press"
              style={{
                minHeight: 44,
                padding: "0 18px",
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--overlay)",
                color: "var(--text)",
                fontWeight: 700,
                cursor: ending ? "default" : "pointer",
              }}
            >
              {endError && exitKind === "leave" ? "Reconnect call" : "Keep talking"}
            </button>
            <button
              type="button"
              onClick={exitKind === "leave" ? handlePersonalLeave : handleEnd}
              disabled={ending}
              aria-label={exitKind === "leave" ? "Confirm leave call" : "End encounter"}
              className="gg-press"
              style={{
                minHeight: 44,
                padding: "0 18px",
                borderRadius: 999,
                border: "none",
                background: "var(--coral)",
                color: "#fff",
                fontWeight: 800,
                cursor: ending ? "wait" : "pointer",
              }}
            >
              {ending ? (exitKind === "leave" ? "Leaving…" : "Ending…") : exitKind === "leave" ? "Leave call" : "End encounter"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function EncounterPage() {
  return (
    <Suspense fallback={<div style={{ color: "#9A9AB0", padding: 40 }}>Loading encounter…</div>}>
      <EncounterInner />
    </Suspense>
  );
}
