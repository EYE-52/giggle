"use client";
import { describeVideoError } from "@/lib/videoError";
import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import styles from "./lobby.module.css";
import type { VideoClient } from "@giggle/agora";
import { squadCall, useSquadCall } from "@/lib/squadCall";
import { useRouter, useSearchParams } from "next/navigation";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Icon } from "@/components/Icons";
import { ChatPanel } from "@/components/ChatPanel";
import { GamePanel, type GameLayoutOverride } from "@/components/GamePanel";
import { FloatingCallTools, type CallCorner } from "@/components/FloatingCallTools";
import floatingStyles from "@/components/FloatingCallTools.module.css";
import { CameraGameCaption, useCameraTiles } from "@/components/CameraGameStage";
import cameraStyles from "@/components/CameraGameStage.module.css";
import { CAMERA_GALLERY_SCENE, mapCaptureToVoiceMic, resolveGameLayout, type GameCameraScene, type GamePresentation } from "@/lib/gameBridge";
import { CoverPicker } from "@/components/CoverPicker";
import { InviteToSquad } from "@/components/InviteToSquad";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { api, connectSocket, SOCKET_EVENTS, session, subscribeChat, joinChat } from "@giggle/core";
import { coverKind, coverBackground } from "@/components/covers";
import type { SquadState, SquadMemberState, JoinRequestUser } from "@giggle/core";
import { useViewport } from "@/components/useViewport";
import { useTheme } from "@/components/useTheme";
import { discoveryEnabledNow, useDiscoveryEnabled } from "@/lib/discovery";
import { useGamesEnabled } from "@/lib/games";
import { pollWhileVisible } from "@/lib/poll";
import { TopicPicker } from "@/components/TopicPicker";
import { normalizeTopics } from "@/lib/topics";

function normalizeVibeLabels(vibes: string[] = []) { return normalizeTopics(vibes); }


function LobbyInner() {
  // stranger matching follows the API switch (see lib/discovery)
  const WEB_DISCOVERY_ENABLED = useDiscoveryEnabled() === true;
  // squad games follow the API switch (see lib/games)
  const GAMES_ENABLED = useGamesEnabled() === true;
  const { isPhone } = useViewport();
  const themeId = useTheme();
  const router = useRouter();
  const params = useSearchParams();
  const squadId = params.get("squad") ?? "";

  const media = useSquadCall(squadId);
  const remotes = media.remotes;
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [squad, setSquad] = useState<SquadState | null>(null);
  const [loading, setLoading] = useState(true);
  const micOn = media.capture.audio === "active";
  const micCapture = mapCaptureToVoiceMic(media.capture.audio);
  const camOn = media.capture.video === "active";
  const [settingReady, setSettingReady] = useState(false);
  const [findingMatch, setFindingMatch] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  // Camera priming: confirm layer shown when finding a match with lobby media
  // never enabled (we never auto-request permissions on mount).
  const [noCamConfirmOpen, setNoCamConfirmOpen] = useState(false);
  const [noCamEnabling, setNoCamEnabling] = useState(false);
  // Poll-failure visibility: consecutive fetch failures (≥2) surface a small
  // dismissible "connection trouble" banner; any success clears it.
  const pollFailsRef = useRef(0);
  const [connTrouble, setConnTrouble] = useState(false);
  const [leavingSquad, setLeavingSquad] = useState(false);
  const [leaveMenuOpen, setLeaveMenuOpen] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<SquadMemberState | null>(null);
  const [removingMember, setRemovingMember] = useState(false);
  const [personOptionsId, setPersonOptionsId] = useState<string | null>(null);
  const [listeningBusy, setListeningBusy] = useState(false);
  const [listeningError, setListeningError] = useState("");

  // Cover picker
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);

  // Invite people modal (friends + user search). Any member can open it.
  const [invitePeopleOpen, setInvitePeopleOpen] = useState(false);

  // Squad name rename (leader only)
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);

  // Premium status (drives the "unlock more seats" upgrade tile)

  // Vibe tag editing
  const [vibeEditorOpen, setVibeEditorOpen] = useState(false);
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [savingVibes, setSavingVibes] = useState(false);
  // Visibility toggle
  const [visibility, setVisibility] = useState<"private" | "open">("private");
  const [savingVisibility, setSavingVisibility] = useState(false);

  // Join policy toggle ("open" = instant, "request" = leader approves)
  const [joinPolicy, setJoinPolicy] = useState<"open" | "request" | "invite">("open");
  const [savingJoinPolicy, setSavingJoinPolicy] = useState(false);

  // Pending join requests (leader only)
  const [joinReqs, setJoinReqs] = useState<JoinRequestUser[]>([]);
  const [reqBusy, setReqBusy] = useState<string | null>(null); // userId currently approving/declining
  const [reqError, setReqError] = useState<string | null>(null);

  // Squad chat
  const [chatOpen, setChatOpen] = useState(false); // phone docked chat sheet

  // Squad games open INSIDE this lobby (no navigation): the stage mounts
  // beside the seats while vcRef, media nodes, and call controls stay put.
  const [gameOpen, setGameOpen] = useState(false);
  // Contextual video: the child's hint (auto), the user's override pin, and
  // the focused seat. The override persists across game changes until Auto;
  // Closing games resets the layout, focus and floating call controls.
  const [gamePresentation, setGamePresentation] = useState<GamePresentation>("balanced");
  const [cameraScene, setCameraScene] = useState<GameCameraScene | null>(null);
  const handleCameraScene = useCallback((scene: GameCameraScene | null) => setCameraScene(scene), []);
  const [layoutOverride, setLayoutOverride] = useState<GameLayoutOverride>("auto");
  const [callCorner, setCallCorner] = useState<CallCorner>("bottom-right");
  const [callCollapsed, setCallCollapsed] = useState(false);
  const [focusedMemberId, setFocusedMemberId] = useState<string | null>(null);
  // Stable subscriber: GamePanel reads it via ref, so auth never re-runs.
  const handlePresentation = useCallback((p: GamePresentation) => {
    setGamePresentation(p);
  }, []);
  // Effective rail: explicit pins win; auto maps the hint (social→faces,
  // immersive→compact, board/balanced stay calm side-by-side).
  const effectiveLayout = resolveGameLayout(layoutOverride, gamePresentation, cameraScene);
  const stageScene = gameOpen && effectiveLayout === "stage" ? cameraScene ?? CAMERA_GALLERY_SCENE : null;
  useEffect(() => {
    if (!gameOpen) {
      setFocusedMemberId(null);
      setLayoutOverride("auto");
      setGamePresentation("balanced");
      setCameraScene(null);
      setCallCorner("bottom-right");
      setCallCollapsed(false);
    }
  }, [gameOpen]);

  // Collapsible sidebar (desktop) + integrated chat
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"info" | "chat">("info");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const chatVisibleRef = useRef(false);
  const chatButtonRef = useRef<HTMLButtonElement>(null);
  // Video rail (games-open): scrolled rail-only to reveal a focused tile.
  const seatsRef = useRef<HTMLElement | null>(null);
  const cameraTiles = useCameraTiles(seatsRef, squad?.members.map(member => member.userId) ?? [], stageScene?.featured ?? null, !!stageScene);

  const vcRef = useRef<VideoClient | null>(null);
  vcRef.current = media.client;
  const lobbyMediaGenerationRef = useRef(0);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const videoJoined = media.joined;
  const videoJoining = media.pending;
  const deviceBusyRef = useRef({ audio: false, video: false });
  const [deviceBusy, setDeviceBusy] = useState({ audio: false, video: false });
  const [videoError, setVideoError] = useState<string | null>(null);
  useEffect(() => {
    if (media.error) setVideoError(describeVideoError(media.error));
    else if (media.capture.audio === "denied" || media.capture.video === "denied") setVideoError("Allow camera or microphone access in your browser, then try again.");
    else if (media.capture.audio === "unavailable" || media.capture.video === "unavailable") setVideoError("A camera or microphone couldn't connect. Try turning it on again.");
    else setVideoError(null);
  }, [media.error, media.capture.audio, media.capture.video]);

  // Hover states

  const [inviteCopied, setInviteCopied] = useState(false);

  const [codeCopied, setCodeCopied] = useState(false);

  const violet = "var(--accent, var(--violet))";

  // ── CHROME text tiers ───────────────────────────────────────────────────
  // The lobby now RESPECTS THE ACTIVE THEME (Meet/Zoom light-mode model): the
  // room chrome + canvas adopt theme tokens; only the video TILES stay dark.
  // These drive header / sidebar / control-bar / modal text, so they are theme
  // tokens (light in Cloud, plum in Midnight, ink in Tangerine). Tile-internal
  // text keeps its own light-on-dark literals inline (do NOT theme those).

  // Chrome hairline (header / sidebar / panels) — themed, not a stage literal.

  async function fetchSquad() {
    if (!squadId) return;
    try {
      const s = await api.getSquad(squadId);
      setSquad(s);
      if (discoveryEnabledNow() && ["searching", "matched", "in_encounter"].includes(s.status)) router.replace(`/matchmaking?squad=${squadId}`);
      const vis = (s as { visibility?: "private" | "open" }).visibility;
      if (vis === "open" || vis === "private") setVisibility(vis);
      const jp = (s as { joinPolicy?: "open" | "request" | "invite" }).joinPolicy;
      if (jp === "open" || jp === "request" || jp === "invite") setJoinPolicy(jp);

      pollSucceeded();
    } catch (e) {
      // Squad is gone (disbanded by the leader, or we were removed) → don't
      // trap the user in a dead lobby; send them home with a note.
      const status = (e as { status?: number })?.status;
      const code = (e as { code?: string })?.code;
      if (status === 404 || status === 403 || code === "SQUAD_NOT_FOUND" || code === "NOT_A_MEMBER") {
        router.replace("/home");
        return;
      }
      console.error("getSquad failed:", e);
      pollFailed();
    } finally {
      setLoading(false);
    }
  }

  function pollSucceeded() {
    pollFailsRef.current = 0;
    setConnTrouble(false);
  }
  function pollFailed() {
    pollFailsRef.current += 1;
    if (pollFailsRef.current >= 2) setConnTrouble(true);
  }

  // Returns true only if the camera/mic actually joined — callers that gate a
  // follow-up action (e.g. the "Enable camera" match flow) must not proceed on
  // a swallowed failure.
  async function enableLobbyMedia(withCamera = true, withAudio = true): Promise<boolean> {
    if (!squadId || videoJoining) return videoJoined;
    if (videoJoined) return true;
    const generation = lobbyMediaGenerationRef.current;
    setVideoError(null);
    try {
      await squadCall.connect(squadId, null, { audio: withAudio, video: withCamera });
      if (generation !== lobbyMediaGenerationRef.current) return false;
      const capture = squadCall.getSnapshot().capture;
      return (!withAudio || capture.audio === "active") && (!withCamera || capture.video === "active");
    } catch (error) {
      if (generation === lobbyMediaGenerationRef.current) setVideoError(describeVideoError(error));
      return false;
    }
  }

  useEffect(() => {
    if (!squadId) { setLoading(false); return; }
    fetchSquad();

    const socket = connectSocket(squadId);
    const onSquadUpdate = (update: { memberId?: string; ready?: boolean } = {}) => {
      const { memberId, ready } = update;
      if (memberId && typeof ready === "boolean") {
        setSquad(current => current ? {
          ...current,
          members: current.members.map(member =>
            member.memberId === memberId ? { ...member, ready } : member
          ),
        } : current);
        return;
      }
      void fetchSquad();
    };
    socket.on(SOCKET_EVENTS.SQUAD_UPDATED, onSquadUpdate);
    socket.on(SOCKET_EVENTS.MATCH_FOUND, onSquadUpdate);
    // SQUAD_UPDATED pushes changes; polling is only a fallback for missed events.
    const stopPolling = pollWhileVisible(fetchSquad, 10_000);

    return () => {
      stopPolling();
      socket.off(SOCKET_EVENTS.MATCH_FOUND, onSquadUpdate);
      socket.off(SOCKET_EVENTS.SQUAD_UPDATED, onSquadUpdate);
      lobbyMediaGenerationRef.current += 1;
      vcRef.current = null;
      // The authenticated layout owns the call across search and match pages.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadId]);

  useEffect(() => {
    if (videoJoined && camOn && localVideoRef.current) {
      try { vcRef.current?.playLocal(localVideoRef.current); } catch {}
    }
  }, [videoJoined, camOn]);

  // Unread chat tracking — runs even when the chat surface isn't mounted, so the
  // collapsed rail / header can show an unread dot. We join the lobby room and
  // count messages from others while chat isn't currently visible.
  const myUserId = session.user?.id;
  useEffect(() => {
    if (!squadId) return;
    try { joinChat({ kind: "lobby", squadId }); } catch {}
    const unsub = subscribeChat((m) => {
      if (m.encounterId || m.squadId !== squadId) return;
      if (myUserId && m.userId === myUserId) return;
      if (chatVisibleRef.current) return;
      setUnread((u) => Math.min(u + 1, 99));
    });
    return unsub;
  }, [squadId, myUserId]);

  // Is the chat surface currently on-screen? (phone sheet, or expanded desktop
  // chat tab.) Drives unread clearing + the header pressed state. Updated every
  // render via a ref so the unread subscription (a stable closure) can read it.
  const chatVisible = isPhone ? chatOpen : (!sidebarCollapsed && sidebarTab === "chat");
  chatVisibleRef.current = chatVisible;
  // Clear unread the moment chat becomes visible.
  useEffect(() => { if (chatVisible) setUnread(0); }, [chatVisible]);

  // Focused seat hygiene: a member who left (or went offline) clears the
  // pin; opening phone chat clears it too (seats hidden). Clearing never
  // touches the call — no leave, no navigation. ESC restores the same way
  // and returns keyboard focus to the seat's button.
  useEffect(() => {
    if (!focusedMemberId) return;
    const m = squad?.members.find(mm => mm.memberId === focusedMemberId);
    if (!m || (m.online === false && m.userId !== myUserId)) setFocusedMemberId(null);
  }, [squad, focusedMemberId, myUserId]);
  useEffect(() => {
    if (isPhone && chatVisible) setFocusedMemberId(null);
  }, [isPhone, chatVisible]);
  useEffect(() => {
    if (!focusedMemberId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const id = focusedMemberId;
      setFocusedMemberId(null);
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(`[data-focus-btn="${id}"]`)?.focus({ preventScroll: true });
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedMemberId]);
  // Focused tile visibility: the tile gets order:-1 (rail start) via CSS.
  // One rail-only scroll reveals it when the rail was parked on a later
  // member. No window scroll, no timers, no game frame touch.
  useEffect(() => {
    if (!focusedMemberId || !gameOpen) return;
    const rail = seatsRef.current;
    if (!rail) return;
    rail.scrollTop = 0;
    rail.scrollLeft = 0;
  }, [focusedMemberId, gameOpen]);

  async function toggleDevice(kind: "audio" | "video") {
    if (deviceBusyRef.current[kind] || videoJoining) return;
    if (!videoJoined) {
      await enableLobbyMedia(kind === "video", kind === "audio");
      return;
    }
    const vc = vcRef.current;
    if (!vc) return;
    const generation = lobbyMediaGenerationRef.current;
    const next = kind === "audio" ? !micOn : !camOn;
    deviceBusyRef.current[kind] = true;
    setDeviceBusy((current) => ({ ...current, [kind]: true }));
    setVideoError(null);
    try {
      await squadCall.setDevice(squadId, kind, next);
      // Capture events update the controls only after the device changes.
    } catch (error) {
      if (generation === lobbyMediaGenerationRef.current) setVideoError(describeVideoError(error));
    } finally {
      deviceBusyRef.current[kind] = false;
      if (generation === lobbyMediaGenerationRef.current) setDeviceBusy((current) => ({ ...current, [kind]: false }));
    }
  }

  // Identify the current user's own membership by matching the session user id
  // against squad members (falls back to first member only if session is missing).
  const myMember = squad
    ? (session.user?.id
        ? squad.members.find(m => m.userId === session.user!.id)
        : squad.members[0])
    : undefined;
  const isLeader = !!(squad && myMember && myMember.memberId === squad.leaderMemberId);

  // Join requests: leader only. Fetch on load, poll ~15s, and refetch when the
  // squad changes (the SQUAD_UPDATED socket event already drives fetchSquad).
  useEffect(() => {
    if (!squadId || !isLeader) { setJoinReqs([]); return; }
    fetchJoinRequests();
    const socket = connectSocket(squadId);
    const onUpdate = () => fetchJoinRequests();
    socket.on(SOCKET_EVENTS.SQUAD_UPDATED, onUpdate);
    const stopPolling = pollWhileVisible(fetchJoinRequests, 15000);
    return () => {
      socket.off(SOCKET_EVENTS.SQUAD_UPDATED, onUpdate);
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadId, isLeader]);

  async function handleVisibility(v: "private" | "open") {
    if (!squadId || !isLeader || v === visibility) return;
    const previousVisibility = visibility;
    setVisibility(v);
    setSavingVisibility(true);
    setMatchError(null);
    try {
      await api.setSquadVisibility(squadId, v);
      await fetchSquad();
    } catch (e) {
      setVisibility(previousVisibility);
      setMatchError((e as { message?: string })?.message || "Couldn't update squad visibility.");
    } finally {
      setSavingVisibility(false);
    }
  }

  async function handleJoinPolicy(v: "open" | "request" | "invite") {
    if (!squadId || !isLeader || v === joinPolicy) return;
    const previousJoinPolicy = joinPolicy;
    setJoinPolicy(v);
    setSavingJoinPolicy(true);
    setMatchError(null);
    try {
      await api.setJoinPolicy(squadId, v);
      await fetchSquad();
    } catch (e) {
      setJoinPolicy(previousJoinPolicy);
      setMatchError((e as { message?: string })?.message || "Couldn't update join policy.");
    } finally {
      setSavingJoinPolicy(false);
    }
  }

  async function fetchJoinRequests() {
    if (!squadId) return;
    try {
      const { requests } = await api.joinRequests(squadId);
      setJoinReqs(requests ?? []);
      pollSucceeded();
    } catch (e) {
      console.error("joinRequests failed:", e);
      pollFailed();
    }
  }

  async function handleApprove(userId: string) {
    if (!squadId) return;
    setReqBusy(userId);
    setReqError(null);
    try {
      await api.approveJoinRequest(squadId, userId);
      await Promise.all([fetchJoinRequests(), fetchSquad()]);
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? "";
      if (/full|FULL|capacity|max/i.test(msg)) {
        setReqError("Squad is full — free up a seat before approving.");
      } else {
        setReqError("Couldn't approve — try again.");
      }
      console.error("approveJoinRequest failed:", e);
    } finally {
      setReqBusy(null);
    }
  }

  async function handleDecline(userId: string) {
    if (!squadId) return;
    setReqBusy(userId);
    setReqError(null);
    try {
      await api.declineJoinRequest(squadId, userId);
      await Promise.all([fetchJoinRequests(), fetchSquad()]);
    } catch (e) {
      setReqError("Couldn't decline — try again.");
      console.error("declineJoinRequest failed:", e);
    } finally {
      setReqBusy(null);
    }
  }

  async function copyToClipboard(text: string, onSuccess: () => void, failureMessage: string) {
    setMatchError(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      onSuccess();
    } catch {
      setMatchError(failureMessage);
    }
  }

  // Shareable invite link: opening it joins the squad and drops the person
  // straight into this lobby (signing them in first if needed).
  const inviteUrl = squad && typeof window !== "undefined"
    ? `${window.location.origin}/join/${squad.squadCode}`
    : "";

  async function handleInvite() {
    if (!squad || !inviteUrl) return;
    // Prefer the native share sheet on phones; fall back to copying the link.
    if (typeof navigator !== "undefined" && typeof navigator.share === "function" && isPhone) {
      try {
        await navigator.share({ title: "Join my Giggle squad", text: `Join my squad "${squad.squadName}" on Giggle`, url: inviteUrl });
        return;
      } catch { /* user dismissed or unsupported — fall through to copy */ }
    }
    await copyToClipboard(
      inviteUrl,
      () => {
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 1800);
      },
      "Couldn't copy the invite link. Copy the squad code instead.",
    );
  }

  async function handleReady() {
    if (!squadId || settingReady) return;
    const myM = (session.user?.id
      ? squad?.members.find(m => m.userId === session.user!.id)
      : undefined) ?? squad?.members[0];
    const previousReady = myM?.ready ?? false;
    const nextReady = !previousReady;
    const setLocalReady = (ready: boolean) => setSquad(current => current ? {
      ...current,
      members: current.members.map(member => member.memberId === myM?.memberId ? { ...member, ready } : member),
    } : current);
    setSettingReady(true);
    setMatchError(null);
    setLocalReady(nextReady);
    try {
      await api.setReady(squadId, nextReady);
    } catch (e) {
      setLocalReady(previousReady);
      setMatchError((e as { message?: string })?.message || "Couldn't update ready status.");
    } finally {
      setSettingReady(false);
    }
  }

  async function handleFindMatch() {
    if (!squadId || !isLeader || findingMatch) return;
    if (!WEB_DISCOVERY_ENABLED) {
      setMatchError("Stranger discovery is unavailable.");
      return;
    }
    // Only members who are actually connected gate the match. An offline member
    // who never marked ready must not permanently trap the leader (mirrors the
    // server's online-only ready-check). online === false means offline;
    // true/undefined counts as online.
    const activeMembers = (squad?.members ?? []).filter(m => m.online !== false);
    const waitingOn = activeMembers.filter(member => member.userId !== myUserId && !member.ready);
    if (waitingOn.length) {
      setMatchError(`Waiting for ${waitingOn.map(member => member.displayName).join(", ")} to be ready.`);
      return;
    }
    // Pressing "Find a squad" is the leader saying they're ready.
    if (!squad?.members.find(member => member.userId === myUserId)?.ready) {
      setFindingMatch(true);
      try {
        await api.setReady(squadId, true);
        setSquad(current => current ? { ...current, members: current.members.map(member => member.userId === myUserId ? { ...member, ready: true } : member) } : current);
      } catch (e) {
        setFindingMatch(false);
        setMatchError((e as { message?: string })?.message || "Couldn't get your squad ready.");
        return;
      }
      setFindingMatch(false);
    }
    // Camera priming: if lobby media was never enabled, confirm before entering
    // the encounter camera-less (never auto-request on mount).
    if (!videoJoined) {
      setNoCamConfirmOpen(true);
      return;
    }
    await proceedFindMatch();
  }

  async function proceedFindMatch() {
    if (!squadId) return;
    setFindingMatch(true);
    setMatchError(null);
    try {
      await api.startSearch(squadId);
      router.push(`/matchmaking?squad=${squadId}`);
    } catch (e) {
      console.error("startSearch failed:", e);
      setMatchError((e as { message?: string })?.message || "Couldn't start search yet.");
      setFindingMatch(false);
    }
  }

  async function saveVibes() {
    if (!squadId) return;
    setSavingVibes(true);
    setMatchError(null);
    try {
      const tagsToSave = normalizeVibeLabels(selectedVibes);
      await api.setTags(squadId, tagsToSave);
      await fetchSquad();
      setVibeEditorOpen(false);
    } catch (e) {
      setMatchError((e as { message?: string })?.message || "Couldn't save vibes.");
    } finally {
      setSavingVibes(false);
    }
  }

  function startRename() {
    if (!squad) return;
    setNameDraft(squad.squadName ?? "");
    setEditingName(true);
  }

  async function saveName() {
    if (!squadId) return;
    const next = nameDraft.trim().slice(0, 32);
    if (!next || next === squad?.squadName) { setEditingName(false); return; }
    setSavingName(true);
    setMatchError(null);
    try {
      await api.setName(squadId, next);
      await fetchSquad();
      setEditingName(false);
    } catch (e) {
      setMatchError((e as { message?: string })?.message || "Couldn't rename squad.");
    } finally {
      setSavingName(false);
    }
  }

  async function leaveLobbyMedia() {
    lobbyMediaGenerationRef.current += 1;
    vcRef.current = null;
    await squadCall.stop();
  }

  async function handleLeaveSquad() {
    if (!squadId || leavingSquad) return;
    setLeavingSquad(true);
    setMatchError(null);
    const mediaExit = leaveLobbyMedia();
    void mediaExit;
    try {
      await api.leaveSquad(squadId);
      router.push("/home");
    } catch (e) {
      setMatchError((e as { message?: string })?.message || "Couldn't leave squad.");
      setLeavingSquad(false);
    }
  }

  async function handleDisbandSquad() {
    if (!squadId || leavingSquad) return;
    setLeavingSquad(true);
    setMatchError(null);
    try {
      await api.disbandSquad(squadId);
      router.push("/home");
    } catch (e) {
      console.error("disbandSquad failed:", e);
      setMatchError((e as { message?: string })?.message || "Couldn't delete squad.");
      setLeavingSquad(false);
      setLeaveMenuOpen(false);
    }
  }

  async function handleRemoveMember() {
    if (!squadId || !memberToRemove || removingMember) return;
    setRemovingMember(true);
    setMatchError(null);
    try {
      await api.kickMember(squadId, memberToRemove.memberId);
      setMemberToRemove(null);
      await fetchSquad();
    } catch (e) {
      setMatchError((e as { message?: string })?.message || "Couldn't remove that member.");
      setMemberToRemove(null);
    } finally {
      setRemovingMember(false);
    }
  }

  const memberCount = squad?.members.length ?? 0;
  // Capacity comes from the backend: 4 free, up to 8 when the leader is premium.
  const MAX_SLOTS = (squad as { maxSlots?: number } | null)?.maxSlots ?? 4;

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, color: "var(--text-muted)", fontSize: 14 }}>
        Loading lobby…
      </div>
    );
  }

  if (!squad) {
    return (
      <div style={{ minHeight: "calc(100vh - 160px)", display: "grid", placeItems: "center", padding: isPhone ? "32px 16px" : "48px 24px" }}>
        <div style={{
          width: "100%",
          maxWidth: 520,
          borderRadius: 24,
          border: "1px solid var(--border)",
          background: "linear-gradient(135deg, color-mix(in srgb, var(--violet) 12%, var(--surface)) 0%, var(--surface) 58%, color-mix(in srgb, var(--lime) 8%, var(--surface)) 100%)",
          boxShadow: "var(--shadow-card, var(--elev))",
          padding: isPhone ? 22 : 28,
          textAlign: "center",
        }}>
          <div style={{
            width: 58,
            height: 58,
            borderRadius: 18,
            margin: "0 auto 16px",
            display: "grid",
            placeItems: "center",
            background: "color-mix(in srgb, var(--violet) 16%, transparent)",
            border: "1px solid color-mix(in srgb, var(--violet) 30%, transparent)",
          }}>
            <Icon.users size={25} color={violet} />
          </div>
          <h1 style={{ margin: 0, color: "var(--text)", fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: isPhone ? 26 : 30, lineHeight: 1.08, letterSpacing: "-0.02em" }}>
            This lobby link is no longer active
          </h1>
          <p style={{ margin: "10px auto 0", maxWidth: 410, color: "var(--text-muted)", fontSize: 14, lineHeight: 1.5 }}>
            The squad may have ended, changed, or been opened from an old invite. Start fresh or browse live squads.
          </p>
          <div style={{ display: "flex", flexDirection: isPhone ? "column" : "row", justifyContent: "center", gap: 10, marginTop: 22 }}>
            <Button onClick={() => router.push("/home")} variant="primary">Go home</Button>
            <Button onClick={() => router.push("/discover")} variant="secondary">Browse squads</Button>
          </div>
        </div>
      </div>
    );
  }

  const currentTags = normalizeVibeLabels(squad.tags ?? []);
  const canInvite = memberCount < MAX_SLOTS;
  const onlineMembers = squad.members.filter(m => m.online !== false);
  const othersOnline = onlineMembers.filter(m => m.userId !== myUserId);
  const othersReady = othersOnline.every(m => m.ready);
  const myReady = !!myMember?.ready;
  const closeChat = () => {
    setChatOpen(false); setSidebarTab("info");
    requestAnimationFrame(() => chatButtonRef.current?.focus());
  };

  const openSeats = Math.max(0, MAX_SLOTS - memberCount);
  const readyLine = !WEB_DISCOVERY_ENABLED
    ? "Squad matching is unavailable right now"
    : isLeader
      ? othersOnline.length === 0
        ? "Just you so far"
        : othersReady ? "Everyone's ready" : `${othersOnline.filter(m => m.ready).length} of ${othersOnline.length} ready`
      : myReady ? "Your leader starts the search" : "Get ready. Your leader starts the search.";
  const openChat = () => { setChatOpen(true); setSidebarCollapsed(false); setSidebarTab("chat"); };
  const personOptions = squad.members.find(member => member.memberId === personOptionsId);
  const personRemote = personOptions && remotes.find(remote => String(remote.uid) === String(personOptions.uid));

  async function toggleListening() {
    const client = vcRef.current;
    if (!client || !personOptions || !personRemote || listeningBusy) return;
    setListeningBusy(true);
    setListeningError("");
    try {
      await client.setRemoteAudioMuted(personRemote.uid, !personRemote.mutedForMe);
      setPersonOptionsId(null);
    } catch (error) {
      setListeningError(error instanceof Error ? error.message : "Couldn't update listening. Try again.");
    } finally { setListeningBusy(false); }
  }

  return (
    <div className={`gg-lobby-root gg-screen ${styles.page}`} data-testid="lobby-page" data-chat={chatVisible || undefined}>
      <header className={styles.bar}>
        <Link href="/home" className={`icon-btn ${styles.iconBtn} ${styles.back}`} aria-label="Back home"><Icon.chevron size={20} /></Link>
        {squad.coverImage && <span aria-hidden="true" className={styles.cover} style={{ background: coverBackground(squad.coverImage, coverKind(squad.coverImage, themeId)) }} />}
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{squad.squadName}</h1>
          <span className={`muted ${styles.subtitle}`}>
            <span>{memberCount} of {MAX_SLOTS}</span>
            {currentTags.map(tag => <span key={tag} className={styles.interest}>{tag}</span>)}
          </span>
        </div>
        {isLeader && <button type="button" className={`icon-btn ${styles.iconBtn}`} aria-label="Edit squad topics" onClick={() => { setSelectedVibes([...currentTags]); setVibeEditorOpen(true); }}><Icon.star size={19} color="currentColor" /></button>}
        <button type="button" className={`${styles.codeChip}`} aria-label={`Copy squad code ${squad.squadCode}`} onClick={() => void copyToClipboard(squad.squadCode, () => setCodeCopied(true), "Couldn't copy the code.")}>
          <strong className={styles.codeText}>{squad.squadCode}</strong>
          <span className={styles.codeHint}>{codeCopied ? "Copied" : <Icon.copy size={16} />}</span>
        </button>
        {GAMES_ENABLED && <button type="button" className={styles.playBtn} aria-expanded={gameOpen} onClick={() => setGameOpen(v => !v)}><span className={styles.wide}>Play together</span><span className={styles.narrow}>Play</span></button>}
        <button type="button" className={`icon-btn ${styles.iconBtn}`} aria-label="Invite friends" disabled={!canInvite} onClick={() => setInviteSheetOpen(true)}><Icon.share size={19} /></button>
        <button ref={chatButtonRef} type="button" className={`icon-btn ${styles.iconBtn}`} aria-label={`Chat${unread > 0 ? `, ${unread} unread` : ""}`} onClick={openChat}>
          <Icon.chat size={19} />{unread > 0 && <span className={styles.dot} aria-hidden="true">{unread}</span>}
        </button>
        <button type="button" className={`icon-btn ${styles.iconBtn}`} aria-label={`Squad settings${joinReqs.length ? `, ${joinReqs.length} join request${joinReqs.length > 1 ? "s" : ""}` : ""}`} onClick={() => setSettingsOpen(true)}>
          <Icon.settings size={19} />{joinReqs.length > 0 && <span className={styles.dot} aria-hidden="true">{joinReqs.length}</span>}
        </button>
      </header>
      {(matchError || connTrouble) && <div role="alert" className={styles.notice}>{matchError || "Connection lost. Reconnecting to your squad…"}<Button variant="ghost" size="sm" onClick={() => void fetchSquad()}>Retry</Button></div>}

      <div className={styles.body} data-games={gameOpen || undefined} data-layout={gameOpen ? effectiveLayout : undefined}>
        {gameOpen && (
          <section className={styles.stage} hidden={isPhone && chatVisible} aria-label="Squad games">
            <GamePanel squadId={squadId} onClose={() => setGameOpen(false)} onPresentation={handlePresentation} onCameraScene={handleCameraScene} layout={layoutOverride} onLayoutChange={setLayoutOverride} voice={{ mic: micCapture, onEnableMic: () => void toggleDevice("audio") }} />
          </section>
        )}
        <section className={`${styles.seats} ${floatingStyles.shell} ${cameraStyles.shell}`} ref={(el) => { seatsRef.current = el; }} data-count={memberCount + Math.min(openSeats, 7)} hidden={isPhone && chatVisible} aria-label="Squad members"
          data-camera-stage={stageScene ? "true" : undefined} data-camera-mode={stageScene?.mode}
          data-floating-call={gameOpen && effectiveLayout === "floating" || undefined}
          data-call-corner={callCorner} data-call-collapsed={callCollapsed || undefined}>
          {gameOpen && effectiveLayout === "floating" && <FloatingCallTools corner={callCorner} collapsed={callCollapsed} onCornerChange={setCallCorner} onToggle={() => setCallCollapsed(value => !value)} />}
          {stageScene && <CameraGameCaption scene={stageScene} />}
          {squad.members.map((member) => {
            const isMe = member.userId === myUserId;
            const remote = remotes.find(r => String(r.uid) === String(member.uid));
            const offline = member.online === false && !isMe;
            const showVideo = isMe ? camOn && videoJoined : !!remote?.hasVideo;
            const focused = focusedMemberId === member.memberId;
            return <article className={`${styles.seat} ${isMe ? styles.me : ""}`} key={member.memberId} data-testid="lobby-person" data-offline={offline || undefined} data-video={showVideo} data-focused={focused || undefined}
              data-camera-featured={stageScene?.mode === "spotlight" && stageScene.featured === member.userId || undefined}
              style={stageScene ? cameraTiles.get(member.userId) : undefined}>
              <div className={styles.face}><PersonAvatar userId={member.userId} name={member.displayName} avatar={member.avatar} isMe={isMe} size="fill" /></div>
              {isMe ? <div ref={localVideoRef} className={styles.video} style={{ opacity: showVideo ? 1 : 0 }} /> : <div className={styles.video} style={{ opacity: showVideo ? 1 : 0 }} ref={el => { if (el && remote?.hasVideo && member.uid !== undefined) { try { vcRef.current?.playRemote(member.uid, el); } catch { setVideoError("Couldn’t show their video. Try reconnecting your devices."); } } }} />}
              <div className={styles.seatLabel}>
                <span className={styles.seatName}><span className={styles.nameText}>{isMe ? "You" : member.displayName}</span>{member.memberId === squad.leaderMemberId && <span className={styles.memberRole}>Leader</span>}</span>
                {WEB_DISCOVERY_ENABLED && member.ready && <span className={styles.ready}><Icon.check size={12} weight="regular" />Ready</span>}
                {(isMe ? videoJoined && !micOn : remote && !remote.hasAudio) && <span className={styles.state}>Mic off</span>}
                {remote?.mutedForMe && <span className={styles.state}>Muted for you</span>}
                {offline ? <span className={styles.state}>Offline</span> : !showVideo ? <span className={styles.state} aria-label="Camera off" title="Camera off"><Icon.camOff size={14} weight="regular" /><span className={styles.cameraStateText}>Camera off</span></span> : null}
              </div>
              {!isMe && <button type="button" className={styles.personOptions} aria-label={`${member.displayName}'s options`} aria-haspopup="dialog" onClick={() => { setListeningError(""); setPersonOptionsId(member.memberId); }}><span aria-hidden="true">•••</span></button>}
              {gameOpen && <button type="button" className={styles.focusBtn} data-focus-btn={member.memberId} aria-pressed={focused} aria-label={focused ? (isMe ? "Restore your video" : `Restore ${member.displayName}`) : (isMe ? "Enlarge your video" : `Enlarge ${member.displayName}`)} onClick={() => setFocusedMemberId(cur => cur === member.memberId ? null : member.memberId)}><Icon.pin size={16} color="currentColor" /></button>}
            </article>;
          })}
          {Array.from({ length: Math.min(openSeats, 7) }, (_, i) => (
            <button key={`open-${i}`} type="button" className={styles.openSeat} onClick={() => setInviteSheetOpen(true)} aria-label={i === 0 ? "Invite a friend" : `Open seat ${i + 1}, invite a friend`} tabIndex={i === 0 ? 0 : -1}>
              <span className={styles.emptyPortrait} aria-hidden="true"><Icon.profile size={48} weight="thin" /></span>
              <span className={styles.openMark} aria-hidden="true"><Icon.plus size={20} /></span>
              {i === 0 && <span className={styles.openText}>Invite</span>}
            </button>
          ))}
        </section>
        <aside className={styles.chat} hidden={!chatVisible} aria-label="Squad chat">
          <ChatPanel active={chatVisible} scope={{ kind: "lobby", squadId }} title="Squad chat" onClose={closeChat} />
        </aside>
      </div>

      <footer className={styles.dockWrap}>
        <div className={`card ${styles.dock}`}>
          <div className={styles.dockRow}>
            <div className={styles.devices} role="group" aria-label="Camera and microphone">
              <button type="button" className={styles.devBtn} disabled={videoJoining || deviceBusy.audio} aria-pressed={!micOn} onClick={() => void toggleDevice("audio")} aria-label={micOn ? "Mute microphone" : "Turn on microphone"} title={micOn ? "Mute microphone" : "Turn on microphone"} data-off={!micOn || undefined}>{micOn ? <Icon.mic size={22} weight="regular" /> : <Icon.micOff size={22} weight="regular" />}</button>
              <button type="button" className={styles.devBtn} disabled={videoJoining || deviceBusy.video} aria-pressed={!camOn} onClick={() => void toggleDevice("video")} aria-label={camOn ? "Turn camera off" : "Turn camera on"} title={camOn ? "Turn camera off" : "Turn camera on"} data-off={!camOn || undefined}>{camOn ? <Icon.cam size={22} weight="regular" /> : <Icon.camOff size={22} weight="regular" />}</button>
            </div>
            <span id="lobby-match-status" className={`muted ${styles.readyLine}`} role="status">{videoJoining ? <><span className="gg-spinner" aria-hidden="true" /> Connecting your devices…</> : readyLine}</span>
            {WEB_DISCOVERY_ENABLED && !isLeader && <Button variant={myReady ? "secondary" : "primary"} loading={settingReady} onClick={handleReady}>{myReady ? "Not ready" : <><span className={styles.wide}>I&apos;m ready to join</span><span className={styles.narrow}>I&apos;m ready</span></>}</Button>}
            <Button variant={isLeader ? "primary" : "secondary"} disabled={!WEB_DISCOVERY_ENABLED || !isLeader || !othersReady || findingMatch} loading={findingMatch} onClick={handleFindMatch} aria-describedby="lobby-match-status">Find a squad<Icon.arrowRight size={18} weight="regular" /></Button>
          </div>
          {videoError && <p role="alert" className={styles.error}>{videoError}</p>}
        </div>
      </footer>
      {personOptions && <Modal title={personOptions.displayName} onClose={() => { if (!listeningBusy) setPersonOptionsId(null); }} width={360}>
        <div className={styles.modalStack}>
          <Button variant="secondary" disabled={!personRemote || !videoJoined} loading={listeningBusy} onClick={() => void toggleListening()}>{personRemote?.mutedForMe ? "Unmute for me" : "Mute for me"}</Button>
          <p className="muted">Listening changes affect only you.{!videoJoined ? " Connect your microphone or camera first." : !personRemote ? " This person hasn't connected their devices yet." : ""}</p>
          {listeningError && <p role="alert" className={styles.error}>{listeningError}</p>}
          {isLeader && <Button variant="ghost" disabled={listeningBusy} onClick={() => { setPersonOptionsId(null); setMemberToRemove(personOptions); }}>Remove from squad</Button>}
        </div>
      </Modal>}
      {inviteSheetOpen && <Modal title="Invite friends" subtitle={`Join ${squad.squadName} with this code or link.`} onClose={() => setInviteSheetOpen(false)} width={420}>
        <div className={styles.modalStack}>
          <div className={styles.code}><strong>{squad.squadCode}</strong><Button variant="ghost" onClick={() => void copyToClipboard(squad.squadCode, () => setCodeCopied(true), "Couldn't copy the code.")}>{codeCopied ? "Copied" : "Copy code"}</Button></div>
          <Button onClick={handleInvite}>{inviteCopied ? "Link copied" : "Copy invite link"}</Button>
          <Button variant="secondary" onClick={() => { setInviteSheetOpen(false); setInvitePeopleOpen(true); }}>Choose friends on Giggle</Button>
          {matchError && <p role="alert" className={styles.error}>{matchError}</p>}
        </div>
      </Modal>}
      {settingsOpen && <Modal title="Squad settings" onClose={() => setSettingsOpen(false)} width={460}>
        <div className={styles.modalStack}>
          {matchError && <p role="alert" className={styles.error}>{matchError}</p>}
          {isLeader && <><Button variant="secondary" onClick={() => { setSettingsOpen(false); startRename(); }}>Rename squad</Button><Button variant="secondary" onClick={() => { setSettingsOpen(false); setCoverPickerOpen(true); }}>Change cover</Button><Button variant="secondary" onClick={() => { setSettingsOpen(false); setSelectedVibes([...currentTags]); setVibeEditorOpen(true); }}>Edit topics</Button></>}
          <label className={styles.field}>Visibility<select value={visibility} disabled={!isLeader || savingVisibility} onChange={e => void handleVisibility(e.target.value as "private" | "open")}><option value="private">Private — join with a code or invite</option><option value="open">Open — listed in Discover</option></select></label>
          <label className={styles.field}>Who can join<select value={joinPolicy} disabled={!isLeader || savingJoinPolicy} onChange={e => void handleJoinPolicy(e.target.value as "open" | "request" | "invite")}><option value="open">Anyone with access</option><option value="request">Ask to join</option><option value="invite">Invited people only</option></select></label>
          {isLeader && joinReqs.length > 0 && <section><h3>Join requests</h3>{reqError && <p role="alert">{reqError}</p>}{joinReqs.map(r => <div className={styles.row} key={r.userId}><span>{r.name}</span><Button size="sm" loading={reqBusy === r.userId} onClick={() => void handleApprove(r.userId)}>Approve</Button><Button size="sm" variant="ghost" disabled={!!reqBusy} onClick={() => void handleDecline(r.userId)}>Decline</Button></div>)}</section>}
          <section className={styles.modalStack}><h3>Members</h3>{squad.members.map(m => <div className={styles.row} key={m.memberId}><span>{m.displayName}{m.memberId === squad.leaderMemberId ? " · Leader" : ""}</span>{isLeader && m.userId !== myUserId && <Button size="sm" variant="ghost" onClick={() => { setSettingsOpen(false); setMemberToRemove(m); }}>Remove</Button>}</div>)}</section>
          <Button variant="danger" onClick={() => { setSettingsOpen(false); setLeaveMenuOpen(true); }}>Leave squad</Button>
        </div>
      </Modal>}
      {editingName && <Modal title="Rename squad" onClose={() => { if (!savingName) setEditingName(false); }} width={420}><form className={styles.modalStack} onSubmit={e => { e.preventDefault(); void saveName(); }}><label className={styles.field}>Squad name<input autoFocus maxLength={32} value={nameDraft} onChange={e => setNameDraft(e.target.value)} /></label>{matchError && <p role="alert">{matchError}</p>}<Button type="submit" loading={savingName}>Save name</Button></form></Modal>}
      {memberToRemove && <Modal title={`Remove ${memberToRemove.displayName}?`} onClose={() => { if (!removingMember) setMemberToRemove(null); }} width={420}><p>They will leave this squad. You can invite them again later.</p><Button variant="danger" loading={removingMember} onClick={handleRemoveMember}>Remove member</Button></Modal>}
      {leaveMenuOpen && <Modal title="Leave this squad?" onClose={() => { if (!leavingSquad) setLeaveMenuOpen(false); }} width={420}><div className={styles.modalStack}><p>{isLeader ? memberCount > 1 ? "Leadership will pass to another member. You can also end the squad for everyone." : "You are the only member. Leaving will close this squad." : "The rest of your squad can keep talking."}</p>{matchError && <p role="alert">{matchError}</p>}<Button variant="secondary" loading={leavingSquad} onClick={handleLeaveSquad}>Leave squad</Button>{isLeader && memberCount > 1 && <Button variant="danger" loading={leavingSquad} onClick={handleDisbandSquad}>End squad for everyone</Button>}</div></Modal>}
      {noCamConfirmOpen && <Modal title="Connect your devices" subtitle="Choose how you want to join the call." onClose={() => { if (!noCamEnabling) setNoCamConfirmOpen(false); }} width={420}><div className={styles.modalStack}>{videoError && <p role="alert" className={styles.error}>{videoError}</p>}<Button loading={noCamEnabling} onClick={async () => { setNoCamEnabling(true); const ok = await enableLobbyMedia(); setNoCamEnabling(false); if (!ok) return; setNoCamConfirmOpen(false); await proceedFindMatch(); }}>Turn on camera &amp; mic</Button><Button variant="secondary" loading={noCamEnabling} onClick={async () => { setNoCamEnabling(true); const ok = await enableLobbyMedia(false); setNoCamEnabling(false); if (!ok) return; setNoCamConfirmOpen(false); await proceedFindMatch(); }}>Continue with audio only</Button></div></Modal>}
      {invitePeopleOpen && <InviteToSquad squadId={squadId} squadName={squad.squadName} onClose={() => setInvitePeopleOpen(false)} />}
      {coverPickerOpen && <CoverPicker squadId={squadId} currentCover={squad.coverImage} onClose={() => setCoverPickerOpen(false)} onSaved={async () => { await fetchSquad(); setCoverPickerOpen(false); }} />}
      {vibeEditorOpen && <Modal title="Edit topics" onClose={() => { if (!savingVibes) setVibeEditorOpen(false); }} width={440}><div className={styles.modalStack}><TopicPicker value={selectedVibes} onChange={setSelectedVibes} disabled={savingVibes} />{matchError && <p role="alert" className={styles.error}>{matchError}</p>}<Button loading={savingVibes} onClick={saveVibes}>Save topics</Button></div></Modal>}
    </div>
  );
}

export default function LobbyPage() {
  return <Suspense fallback={<div style={{ padding: 40 }}>Loading lobby…</div>}><LobbyInner /></Suspense>;
}
