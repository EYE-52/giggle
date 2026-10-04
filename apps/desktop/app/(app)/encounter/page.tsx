"use client";
import { describeVideoError } from "@/lib/videoError";
import { useState, useEffect, useRef, useCallback, Suspense, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  chatMessageMatchesScope,
  mergeChatMessage,
  api,
  connectSocket,
  createOpponentUserIds,
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
import type { EncounterDetail, SafetyReportCategory } from "@giggle/core";
import { Avatar } from "@/components/Avatar";
import { AvatarArt } from "@/components/AvatarArt";
import { Icon } from "@/components/Icons";
import { ChatPanel, type ChatPanelMessage } from "@/components/ChatPanel";
import { GamePanel, type GameLayoutOverride } from "@/components/GamePanel";
import { mapCaptureToVoiceMic, resolveGameLayout, type GamePresentation } from "@/lib/gameBridge";
import { Button } from "@/components/Button";
import { ParticipantVideoTile as VideoTile } from "@/components/ParticipantVideoTile";
import { FocusVideoStage, type TileSizeControls } from "@/components/FocusVideoStage";
import { Modal } from "@/components/Modal";
import { createVideoClient } from "@giggle/agora";
import type { CaptureState, ConnectionState, RemoteParticipant } from "@giggle/agora";
import { useViewport } from "@/components/useViewport";
import { discoveryEnabledNow, useDiscoveryEnabled } from "@/lib/discovery";
import { useGamesEnabled } from "@/lib/games";
import { REACTIONS, ReactionGlyph } from "@/components/Reaction";
import { CallNotice } from "@/components/CallNotice";
import feedbackStyles from "./call-feedback.module.css";

const REPORT_REASONS: { value: SafetyReportCategory; label: string }[] = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate or discrimination" },
  { value: "sexual", label: "Sexual content" },
  { value: "minor_safety", label: "Concern about a minor" },
  { value: "spam", label: "Spam or scams" },
  { value: "other", label: "Something else" },
];
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
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
}
[data-testid="encounter-shell"] input {
  transition: border-color .18s cubic-bezier(.4,0,.2,1), box-shadow .18s cubic-bezier(.4,0,.2,1), background .18s cubic-bezier(.4,0,.2,1);
}
[data-testid="encounter-shell"] input:focus {
  border-color: var(--accent) !important;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
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


function EncounterInner() {
  // stranger matching follows the API switch (see lib/discovery)
  const WEB_DISCOVERY_ENABLED = useDiscoveryEnabled() === true;
  // encounter games follow the API switch (see lib/games)
  const GAMES_ENABLED = useGamesEnabled() === true;
  const router = useRouter();
  const params = useSearchParams();
  const squadId = params.get("squad") ?? "";
  const encId = params.get("enc") ?? "";

  const [chatOpen, setChatOpen] = useState(false);
  // Encounter games open INSIDE this call (no navigation, no new tab): the
  // game stage mounts beside the video stage while vcRef, media nodes, and
  // call controls stay put. Both squads share one game room; opening games
  // requests no camera/mic permission.
  const [gameOpen, setGameOpen] = useState(false);
  // Contextual video: the child's hint (auto) plus the user's override pin.
  // The override persists across game changes until Auto; closing games
  // resets both (see the gameOpen effect below). Layout changes restyle the
  // rail only — video nodes and the Agora client are never touched.
  const [gamePresentation, setGamePresentation] = useState<GamePresentation>("balanced");
  const [layoutOverride, setLayoutOverride] = useState<GameLayoutOverride>("auto");
  // Stable subscriber: GamePanel reads it via ref, so auth never re-runs.
  const handlePresentation = useCallback((p: GamePresentation) => {
    setGamePresentation(p);
  }, []);
  const effectiveLayout = resolveGameLayout(layoutOverride, gamePresentation);
  useEffect(() => {
    if (!gameOpen) {
      setLayoutOverride("auto");
      setGamePresentation("balanced");
    }
  }, [gameOpen]);
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
  const [reportNotice, setReportNotice] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportCategory, setReportCategory] = useState<SafetyReportCategory | "">("");
  const [reportDetails, setReportDetails] = useState("");
  const [reportError, setReportError] = useState("");
  const reportPendingRef = useRef(false);
  const reportReasonRef = useRef<HTMLSelectElement>(null);
  const callKey = `${squadId}:${encId}`;
  const reportCallRef = useRef(callKey);
  reportCallRef.current = callKey;
  const [failedReaction, setFailedReaction] = useState<string | null>(null);
  useEffect(() => {
    reportPendingRef.current = false;
    setReporting(false); setReportOpen(false); setReported(false); setReportNotice(false);
    setReportCategory(""); setReportDetails(""); setReportError(""); setFailedReaction(null);
  }, [callKey]);
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


  // Hover states
  const [hoveredCtrl, setHoveredCtrl] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // Call chrome (header + controls) floats over the video and fades out when idle.
  // It comes back on any pointer move, tap, key press or focus; it never hides while
  // hovered, focused, while a menu or chat is open, or for viewers who asked to keep it.
  // state, not a ref: the shell mounts after the loading screen, and the idle timer must attach then
  const [shellEl, setShellEl] = useState<HTMLDivElement | null>(null);
  const [chromeShown, setChromeShown] = useState(true);
  const [chromeAlways, setChromeAlways] = useState(false);
  useEffect(() => {
    try { setChromeAlways(localStorage.getItem("giggle.callChrome") === "always"); } catch {}
  }, []);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const chatButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);

  const { width, height, isPhone } = useViewport();
  const isPhoneChrome = isPhone || height <= 500;

  function closeMore(restoreFocus = false) {
    setMoreOpen(false);
    if (restoreFocus) moreButtonRef.current?.focus();
  }

  useEffect(() => {
    if (!moreOpen) return;
    moreMenuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        moreOpen &&
        !moreMenuRef.current?.contains(target) &&
        !moreButtonRef.current?.contains(target)
      )
        closeMore();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMore(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen, isPhoneChrome]);

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
  const micOn = captureState.audio === "active";
  const camOn = captureState.video === "active";
  const [deviceBusy, setDeviceBusy] = useState(false);
  const deviceBusyRef = useRef(false);
  // Full remote participant state (uid + hasVideo/hasAudio) — drives truthful
  // per-tile "Muted" / "Camera off" / "Connecting…" signals.
  const [remotes, setRemotes] = useState<RemoteParticipant[]>([]);
  const seenUidsRef = useRef<Set<string>>(new Set());
  for (const remote of remotes) seenUidsRef.current.add(String(remote.uid));
  const [arrivalWindowOver, setArrivalWindowOver] = useState(false);
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
      // The call is over: close the shared game room with it (the overlay
      // takes the screen; renewal would be denied from here on anyway).
      setGameOpen(false);
      if (payload?.reason === 'next_squad') {
        void leaveVideo();
        router.replace(`/${payload.queueStatus === 'searching' ? 'matchmaking' : 'lobby'}?squad=${squadId}`);
        return;
      }
      const opponentLeft = payload?.reason === "squad_disconnected" && payload?.endedBySquadId !== squadId;
      void leaveVideo();
      setEndedReason(opponentLeft ? "opponent-left" : "ended");
      setEndedNotice(true);
      setEndError(null);
      setFindingNextMatch(false);
      // Give people time to read the overlay + choose an action before we
      // auto-return home.
      if (endedNavTimerRef.current) clearTimeout(endedNavTimerRef.current);
      // The server already queued a squad whose opponent left; keep matching.
      // Matchmaking sends an idle squad back to its lobby.
      endedNavTimerRef.current = setTimeout(() => {
        void leaveVideo();
        router.push(
          discoveryEnabledNow() && opponentLeft
            ? `/matchmaking?squad=${squadId}`
            : `/lobby?squad=${squadId}`,
        );
      }, 5000);
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
        if (detail.status === "awaiting_ack") {
          router.replace(`/match?squad=${squadId}&enc=${encId}`);
          return;
        }
        setEncounter(detail);
        setEncounterLoading(false);
        if (detail.status === "ended") return;
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

  useEffect(() => {
    setArrivalWindowOver(false);
    if (!videoJoined) return;
    const timer = setTimeout(() => setArrivalWindowOver(true), 25_000);
    return () => clearTimeout(timer);
  }, [videoJoined, encId]);

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
  // The stage shows who is actually here. Someone not seen yet gets a
  // "Connecting…" tile for the first moments of the call; after that, people
  // who never arrived or who left drop off and the others re-flow.
  const isHere = (person: EncounterParticipant) =>
    person.isLocal ||
    (person.uid != null && remotes.some((r) => String(r.uid) === String(person.uid))) ||
    (!arrivalWindowOver && (person.uid == null || !seenUidsRef.current.has(String(person.uid))));
  const mineHere = mineParticipants.filter(isHere);
  // Squadmates count as still here if their video is connected or the server
  // last saw them in the call (the safer reading: never end a call too early).
  const lastOfMySquad = !myMembers.some((member) =>
    member.userId !== myUserId &&
    ((member.uid != null && remotes.some((r) => String(r.uid) === String(member.uid))) || member.inEncounterVideo === true));
  const theirsHere = theirParticipants.filter(isHere);
  const participantIdsKey = JSON.stringify(participants.map((person) => person.id));
  const activeSpeakerId = loudestUid
    ? (participants.find(
        (person) => String(person.isLocal ? myUidRef.current : person.uid) === loudestUid,
      )?.id ?? null)
    : null;
  useEffect(() => {
    const shell = shellEl;
    if (!shell) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const busy = () => {
      if (chromeAlways || moreOpen || chatOpen || endConfirmOpen || reportOpen) return true;
      const active = document.activeElement;
      const chrome = shell.querySelectorAll(".call-top, .gg-call-controls-wrap");
      return [...chrome].some(el => el.matches(":hover") || (active != null && el.contains(active)));
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (!busy()) setChromeShown(false); else schedule(); }, 3200);
    };
    const wake = () => { setChromeShown(true); schedule(); };
    // Page-wide: keyboard users start from the body or the skip link, outside the shell.
    const events = ["pointermove", "pointerdown", "keydown", "focusin", "touchstart"] as const;
    events.forEach(name => window.addEventListener(name, wake, { passive: true }));
    wake();
    return () => { if (timer) clearTimeout(timer); events.forEach(name => window.removeEventListener(name, wake)); };
  }, [shellEl, chromeAlways, moreOpen, chatOpen, endConfirmOpen, reportOpen]);

  // ── Truthful per-participant signals ─────────────────────────────────────
  // Look up a remote participant's live track state by uid. Returns undefined
  // when the uid is unknown or not (yet) connected.
  const remoteFor = (uid: number | undefined): RemoteParticipant | undefined =>
    uid == null ? undefined : remotes.find((r) => String(r.uid) === String(uid));
  // Mic pill: local uses our own toggle; remotes use real hasAudio (undefined
  // while connecting so no pill is faked).
  const micOnFor = (isLocal: boolean, uid: number | undefined): boolean | undefined =>
    isLocal ? micOn : remoteFor(uid)?.hasAudio;
  // Do not leave a disconnected call looking as if video is still loading.
  const statusTextFor = (isLocal: boolean, uid: number | undefined): string => {
    if (!videoJoined && connState === "DISCONNECTED") return "Video disconnected";
    if (isLocal) {
      if (captureState.video === "denied") return "Camera blocked";
      if (captureState.video === "unavailable") return "Camera unavailable";
      if (captureState.video === "pending") return "Starting camera…";
      return "Camera off";
    }
    return remoteFor(uid) ? "Camera off" : connState === "CONNECTED" ? "Waiting for video" : "Connecting…";
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
  }, [videoJoined, camOn, participantIdsKey]);

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
  }, [remoteVideoKey, videoJoined, participantIdsKey]);

  async function toggleDevice(kind: "audio" | "video") {
    const client = vcRef.current;
    if (!client || !videoJoined || deviceBusyRef.current) return;
    const generation = videoGenerationRef.current;
    deviceBusyRef.current = true;
    setDeviceBusy(true);
    setVideoError(null);
    try {
      if (kind === "audio") await client.setMicEnabled(!micOn);
      else await client.setCamEnabled(!camOn);
    } catch (error) {
      if (generation === videoGenerationRef.current)
        setVideoError(describeVideoError(error));
    } finally {
      if (generation === videoGenerationRef.current) {
        deviceBusyRef.current = false;
        setDeviceBusy(false);
      }
    }
  }

  const toggleMic = () => toggleDevice("audio");
  const toggleCam = () => toggleDevice("video");

  async function leaveVideo() {
    videoGenerationRef.current += 1;
    const client = vcRef.current;
    vcRef.current = null;
    setVideoJoined(false);
    setCaptureState({ audio: "off", video: "off" });
    deviceBusyRef.current = false;
    setDeviceBusy(false);
    try {
      await client?.leave();
    } catch {}
  }

  async function leaveVideoAndGoHome() {
    await leaveVideo();
    router.replace("/home");
  }

  async function handlePersonalLeave() {
    // Leaving as the last of your squad ends the call; otherwise the other
    // squad would sit in an empty room.
    if (lastOfMySquad) return handleEnd();
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
      router.replace(`/lobby?squad=${squadId}`);
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
    if (reported || reportPendingRef.current || !reportCategory || !encounter) return;
    const submittedCall = callKey;
    reportPendingRef.current = true;
    setReportError("");
    setReporting(true);
    const result = await reportOpponentSquad({
      encounterId: encId,
      squadId,
      encounter,
      category: reportCategory,
      details: reportDetails,
    });
    if (reportCallRef.current !== submittedCall) return;
    reportPendingRef.current = false;
    setReporting(false);
    if (!result.ok) {
      setReportError(result.error || "Report was not sent. Check your connection and try again.");
      return;
    }
    closeReport();
    setReportCategory(""); setReportDetails("");
    setReported(true);
    setReportNotice(true);
    setUiTimeout(() => { if (reportCallRef.current === submittedCall) setReportNotice(false); }, 2500);
  }

  function closeReport() {
    if (reportPendingRef.current) return;
    setReportOpen(false);
    requestAnimationFrame(() => moreButtonRef.current?.focus());
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

  function fireReaction(emoji: string, restoreFocus = false) {
    if (!encId || !squadId) return;
    const sent = sendReaction({ kind: "encounter", encounterId: encId, squadId }, emoji, {
      id: session.user?.id ?? "",
      name: session.user?.name ?? "You",
    });
    if (!sent) {
      setFailedReaction(emoji);
      return;
    }
    setFailedReaction(null);
    spawnReaction(emoji, session.user?.id ?? "");
    if (restoreFocus) requestAnimationFrame(() => moreButtonRef.current?.focus());
  }

  function dismissReactionError() {
    setFailedReaction(null);
    requestAnimationFrame(() => moreButtonRef.current?.focus());
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

  const participantById = new Map(participants.map((person) => [person.id, person]));
  const hasVideoFor = (person: EncounterParticipant) =>
    videoJoined && (person.isLocal ? camOn && captureState.video === "active" : !!remoteFor(person.uid)?.hasVideo);
  const videoOnById = Object.fromEntries(participants.map((person) => [person.id, hasVideoFor(person)]));

  function renderParticipant(id: string, size: TileSizeControls) {
    const person = participantById.get(id);
    if (!person) return null;
    return (
      <VideoTile
        key={person.id}
        name={person.name}
        colorIndex={person.colorIndex}
        micOn={micOnFor(person.isLocal, person.uid)}
        hasVideo={hasVideoFor(person)}
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
        size={size}
        fit={size.fit}
        backdrop
        reactions={floatingReactions.filter((reaction) => reaction.senderId === person.id)}
      />
    );
  }

  function renderAdaptiveStage() {
    return <FocusVideoStage
      mine={mineHere.map(person => person.id)}
      theirs={theirsHere.map(person => person.id)}
      videoOn={videoOnById}
      selfId={mineParticipants.find(person => person.isLocal)?.id}
      mineLabel={mySquad?.name ? `Your squad · ${mySquad.name}` : "Your squad"}
      theirsLabel={oppSquad?.name ? `Their squad · ${oppSquad.name}` : "Their squad"}
      renderParticipant={renderParticipant}
    />;
  }

  const renderStage = () => (
    <div
      data-layout-kind="focus-grid"
      style={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        display: "flex",
        overflow: "hidden",
      }}
    >
      {renderAdaptiveStage()}
    </div>
  );

  function reactionChoices(onDone: () => void) {
    return REACTIONS.map(({ value, label }) => (
      <button
        key={value}
        type="button"
        onClick={() => {
          fireReaction(value);
          onDone();
        }}
        title={label}
        aria-label={`React: ${label}`}
        className="gg-press"
      >
        <ReactionGlyph value={value} />
      </button>
    ));
  }

  // ── CONTROL BUTTONS CONFIG ────────────────────────────────────────────────

  function toggleChat() {
    setMoreOpen(false);
    setChatOpen((open) => !open);
  }

  // Games toggle is state-only: no join/leave, no navigation, no permission
  // prompt — the Agora client and every video node stay exactly as they are.
  function toggleGames() {
    setMoreOpen(false);
    setGameOpen((open) => !open);
  }

  function closeChat() {
    setChatOpen(false);
    requestAnimationFrame(() => chatButtonRef.current?.focus());
  }

  function toggleMore() {
    const next = !moreOpen;
    setChatOpen(false);
    setMoreOpen(next);
  }

  const ctrlBtns = [
    {
      id: "mic",
      icon: micOn ? <Icon.mic size={20} weight="regular" color="currentColor" /> : <Icon.micOff size={20} weight="regular" color="currentColor" />,
      active: micOn,
      danger: true,
      onClick: toggleMic,
      title: micOn ? "Mute microphone" : "Unmute microphone",
      badge: 0,
    },
    {
      id: "cam",
      icon: camOn ? <Icon.cam size={20} weight="regular" color="currentColor" /> : <Icon.camOff size={20} weight="regular" color="currentColor" />,
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
    // Play together with the other squad, inside this call. State-only
    // toggle (see toggleGames): the call never drops, moves, or re-asks.
    ...(GAMES_ENABLED
      ? [
          {
            id: "games",
            icon: <Icon.dice size={20} color={gameOpen ? "var(--accent)" : "var(--text)"} />,
            active: gameOpen,
            danger: false,
            onClick: toggleGames,
            title: gameOpen ? "Close games" : "Play together",
            badge: 0,
          },
        ]
      : []),
    {
      id: "more",
      icon: <Icon.more size={20} color={moreOpen ? "var(--accent)" : "var(--text)"} />,
      active: moreOpen,
      danger: false,
      onClick: toggleMore,
      title: "More",
      badge: 0,
    },
  ];

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
  const recoveryMessages = videoError ? [videoError] : captureIssues;
  const transientNotice = reportNotice
    ? "reported"
    : connState === "RECONNECTING" && !reconnectDismissed
      ? "reconnecting"
      : null;

  const toLobbyOrHome = (
    <>
      {squadId && <Button onClick={() => router.push(`/lobby?squad=${squadId}`)}>Back to lobby</Button>}
      <Button variant="secondary" onClick={() => router.push("/home")}>Home</Button>
    </>
  );

  if (!squadId || !encId) {
    return (
      <CallNotice icon={<Icon.cam size={26} color="currentColor" />} title="This call link is incomplete" actions={toLobbyOrHome} role="alert">
        It is missing the squad or call details.
      </CallNotice>
    );
  }

  if (encounterLoading) {
    return <CallNotice busy title="Opening the call…" role="status" />;
  }

  if (encounterError || !encounter) {
    return (
      <CallNotice icon={<Icon.cam size={26} color="currentColor" />} title="This call isn't available" actions={toLobbyOrHome} role="alert">
        {encounterError ?? "It may have ended already."}
      </CallNotice>
    );
  }

  if (encounter.status === "ended") {
    return <CallNotice icon={<Icon.hangup size={26} color="currentColor" />} title="This call has ended" actions={toLobbyOrHome} role="status">
      Return to your lobby to meet another squad.
    </CallNotice>;
  }

  const moreActions = moreOpen ? (
    <div ref={moreMenuRef} role="group" aria-label="More call actions" className="gg-call-menu" data-placement={isPhoneChrome ? "center" : "end"}>
      <div className="gg-call-menu-reactions">{reactionChoices(() => closeMore(true))}</div>
      <button type="button" onClick={() => { setReportError(""); closeMore(false); setReportOpen(true); }} disabled={reported || reporting} data-tone={reported ? "ok" : undefined}>
        <Icon.flag size={18} color="currentColor" />
        {reported ? "Reported" : reporting ? "Sending report…" : "Report opponent squad"}
      </button>
      <button type="button" className="gg-btn--danger" onClick={() => { setBlockError(null); closeMore(true); setBlockConfirmOpen(true); }} disabled={!canBlockOpponent || blocking} aria-label="Block opponent squad" data-tone="danger">
        <Icon.shield size={18} color="currentColor" />
        Block opponent squad
      </button>
      <hr />
      {WEB_DISCOVERY_ENABLED && mySquad?.members.some(member => member.userId === session.user?.id && member.role === 'leader') && (
        <button type="button" onClick={() => { closeMore(true); setNextError(''); setNextConfirmOpen(true); }}>
          <Icon.shuffle size={18} color="currentColor" />
          Next squad
        </button>
      )}
      <button type="button" className="gg-btn--danger" onClick={() => { setExitKind("end"); setEndError(null); closeMore(true); setEndConfirmOpen(true); }} aria-label="End encounter" data-tone="danger">
        <Icon.hangup size={18} color="currentColor" />
        End call for both squads
      </button>
    </div>
  ) : null;

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div
        ref={setShellEl}
        data-testid="encounter-shell"
        className="gg-screen-call"
        data-games={gameOpen && GAMES_ENABLED || undefined}
        data-chrome={chromeShown || chromeAlways ? "shown" : "hidden"}
        style={{
          position: "relative",
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
            padding: isPhoneChrome ? "max(8px, env(safe-area-inset-top)) 10px 18px" : "12px 20px 24px",
            flexShrink: 0,
            zIndex: 30,
            // on a phone the open chat takes the whole screen; the header steps aside
            visibility: isPhoneChrome && chatOpen ? "hidden" : undefined,
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
              // same order as the stage: their squad left, yours right
              [oppSquad?.name ?? "Their squad", theirsHere.length, "theirs"],
              [mySquad?.name ?? "Your squad", mineHere.length, "mine"],
            ].map(([name, count, side]) => (
              <span
                key={String(side)}
                className="call-title"
                data-side={side}
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
                    background: connState === "DISCONNECTED" ? coral : "var(--away, var(--amber))",
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
          className={`gg-encounter-content ${chatOpen ? "gg-chat-open" : ""} ${gameOpen && GAMES_ENABLED ? "gg-games-open" : ""}`}
          data-games-layout={gameOpen && GAMES_ENABLED ? effectiveLayout : undefined}
          style={{
            display: "flex",
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Encounter games: one shared room for both squads, mounted INSIDE
              this call beside the video stage. The stage below stays mounted
              with the same tiles and the same Agora client across open,
              layout, game, and close changes; on a phone the game hides
              (never unmounts) while chat takes the screen. */}
          {gameOpen && GAMES_ENABLED && (
            <section data-testid="encounter-game-stage" className="gg-encounter-game" hidden={isPhone && chatOpen} aria-label="Encounter games">
              <GamePanel squadId={squadId} encounter={{ encounterId: encId }} onClose={() => setGameOpen(false)} onPresentation={handlePresentation} layout={layoutOverride} onLayoutChange={setLayoutOverride} voice={{ mic: mapCaptureToVoiceMic(captureState.audio), onEnableMic: toggleMic }} />
            </section>
          )}
          {/* ── VIDEO STAGE ─────────────────────────────────────────────── */}
          <div
            data-testid="video-stage"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              background: "var(--bg)",
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
                  // In flow (not floating) so it never covers a person's tile; it only
                  // appears while video can't start and can be dismissed.
                  flexShrink: 0,
                  alignSelf: "center",
                  margin: isPhoneChrome ? "52px 12px 6px" : "60px 12px 8px",
                  maxWidth: "calc(100% - 24px)",
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "nowrap",
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
                  style={{ fontSize: 13, fontWeight: 600, color: textPrimary, lineHeight: 1.4, minWidth: 0, flex: "1 1 auto" }}
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
            {failedReaction && <div role="alert" data-testid="reaction-error" className={feedbackStyles.reactionError}
              style={{ margin: recoveryMessages.length ? "0 12px 6px" : isPhoneChrome ? "52px 12px 6px" : "60px 12px 8px" }}>
              <span>Reaction wasn’t sent. Check your connection and retry.</span>
              <Button variant="secondary" size="sm" onClick={() => fireReaction(failedReaction, true)}>Retry reaction</Button>
              <button type="button" className={feedbackStyles.dismiss} aria-label="Dismiss reaction error" onClick={dismissReactionError}><Icon.close size={16} /></button>
            </div>}
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
              <CallNotice
                overlay
                role="status"
                icon={<Icon.users size={26} color="currentColor" />}
                title={endedReason === "opponent-left" ? `${oppSquad?.name ?? "The other squad"} left` : "The call ended"}
                actions={
                  <>
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
                            setEndError((error as { message?: string })?.message || "Couldn't start matchmaking.");
                            setFindingNextMatch(false);
                          }
                        }}
                        loading={findingNextMatch}
                      >
                        {endedReason === "opponent-left" ? "Find another now" : "Find another squad"}
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (endedNavTimerRef.current) {
                          clearTimeout(endedNavTimerRef.current);
                          endedNavTimerRef.current = null;
                        }
                        void leaveVideo();
                        if (endedReason === "opponent-left") void api.cancelSearch(squadId).catch(() => {});
                        router.push(`/lobby?squad=${squadId}`);
                      }}
                    >
                      Back to lobby
                    </Button>
                  </>
                }
              >
                <p>
                  {WEB_DISCOVERY_ENABLED && endedReason === "opponent-left"
                    ? "Finding you another squad…"
                    : "Taking you back to your lobby…"}
                </p>
                {endError && <p role="alert" style={{ color: "var(--coral)", marginTop: 6 }}>{endError}</p>}
              </CallNotice>
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
              }}
            >
              {renderStage()}
            </div>
          </div>

          {/* Kept mounted so closing chat preserves drafts and never moves video hosts. */}
          <aside className="gg-encounter-chat" hidden={!chatOpen} aria-label="Call chat">
            <ChatPanel
              active={chatOpen}
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
                    disabled={danger && (!videoJoined || videoRetrying || deviceBusy)}
                    aria-busy={danger && deviceBusy}
                    onMouseEnter={() => setHoveredCtrl(id)}
                    onMouseLeave={() => setHoveredCtrl(null)}
                    title={title}
                    aria-label={title}
                    aria-pressed={
                      id === "more" ? undefined : typeof active === "boolean" ? active : undefined
                    }
                    aria-expanded={id === "more" ? moreOpen : undefined}
                    className={`gg-press cbtn${off ? " gg-btn--danger" : ""}`} data-call-control data-cbtn-state={off ? "off" : selected ? "on" : undefined}
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
                    {(id === "chat" || id === "more") && <span className="gg-control-label">{id === "chat" ? "Chat" : "More"}</span>}
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
                          background: "var(--brand, var(--accent))",
                          color: "var(--on-brand, #fff)",
                          fontSize: 12,
                          fontWeight: 700,
                          lineHeight: "18px",
                          textAlign: "center",
                          border: "1.5px solid var(--surface)",
                        }}
                      >
                        {badge > 9 ? "9+" : badge}
                      </span>
                    )}
                  </button>

                  {id === "more" && !isPhoneChrome && moreActions}
                </div>
              );
            })}

            <button
              onClick={() => {
                closeMore();
                setExitKind("leave");
                setEndError(null);
                setEndConfirmOpen(true);
              }}
              disabled={ending}
              aria-label="Leave call"
              onMouseEnter={() => setHoveredCtrl("end")}
              onMouseLeave={() => setHoveredCtrl(null)}
              className="gg-press cbtn leave gg-btn--danger" data-call-control data-call-leave
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
          {isPhoneChrome && moreActions}
        </div>
      </div>

      {reportOpen && (
        <Modal title="Report opponent squad" subtitle="Your report is private. It won't block anyone or end this call." onClose={closeReport}
          closeOnBackdrop={!reporting} showClose={!reporting} width={440} initialFocusRef={reportReasonRef}>
          <form className={feedbackStyles.reportForm} onSubmit={e => { e.preventDefault(); void handleReport(); }}>
            <label>Reason
              <select ref={reportReasonRef} value={reportCategory} required disabled={reporting} onChange={e => setReportCategory(e.target.value as SafetyReportCategory | "")}>
                <option value="" disabled>Choose a reason</option>
                {REPORT_REASONS.map(reason => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
              </select>
            </label>
            <label>Details (optional)
              <textarea value={reportDetails} maxLength={500} disabled={reporting} rows={3} placeholder="What happened?"
                aria-describedby="report-details-count" onChange={e => setReportDetails(e.target.value)} />
            </label>
            <span id="report-details-count" className={feedbackStyles.count}>{reportDetails.length} / 500</span>
            {reportError && <p role="alert" className={feedbackStyles.reportError}>{reportError}</p>}
            <div className={feedbackStyles.actions}>
              <Button variant="secondary" disabled={reporting} onClick={closeReport}>Cancel</Button>
              <Button type="submit" loading={reporting} disabled={!reportCategory}>{reporting ? "Sending report…" : reportError ? "Try again" : "Send report"}</Button>
            </div>
          </form>
        </Modal>
      )}

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
            <div role="alert" style={{ color: "var(--coral)", fontSize: 14, marginBottom: 16 }}>
              {blockError}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
            <Button variant="secondary" disabled={blocking} onClick={() => { setBlockConfirmOpen(false); setBlockError(null); }}>Keep talking</Button>
            <Button variant="danger" onClick={handleBlockOpponent} disabled={!canBlockOpponent || blocking} aria-label="Block opponent squad" aria-busy={blocking}>
              {blocking ? "Blocking…" : "Block everyone and leave"}
            </Button>
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
          title={exitKind === "leave" ? "Leave this call?" : "End the call?"}
          subtitle={exitKind === "leave"
            ? lastOfMySquad
              ? "You're the last one here from your squad, so the call ends."
              : "Only you will leave. Your squad can keep talking."
            : "This ends the call for both squads."}
          showClose={false}
          closeOnBackdrop={!ending}
          width={420}
        >
          {endError && (
            <div role="alert" style={{ color: "var(--coral)", fontSize: 14, marginBottom: 16 }}>
              {endError}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
            <Button
              variant="secondary"
              disabled={ending}
              onClick={() => {
                if (endError && exitKind === "leave") retryVideo();
                setEndConfirmOpen(false);
                setEndError(null);
              }}
            >
              {endError && exitKind === "leave" ? "Reconnect call" : "Keep talking"}
            </Button>
            <Button
              variant="danger"
              onClick={exitKind === "leave" ? handlePersonalLeave : handleEnd}
              disabled={ending}
              aria-label={exitKind === "leave" ? "Confirm leave call" : "End encounter"}
            >
              {ending ? (exitKind === "leave" ? "Leaving…" : "Ending…") : exitKind === "leave" ? "Leave call" : "End the call"}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function EncounterPage() {
  return (
    <Suspense fallback={<div style={{ color: "var(--text-muted)", padding: 40, fontFamily: "var(--font-body)" }}>Opening the call…</div>}>
      <EncounterInner />
    </Suspense>
  );
}
