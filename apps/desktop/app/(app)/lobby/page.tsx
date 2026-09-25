"use client";
import { useState, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import styles from "./lobby.module.css";
import { Wordmark } from "@/components/Brand";
import type { RemoteParticipant } from "@giggle/agora";
import { useRouter, useSearchParams } from "next/navigation";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Icon } from "@/components/Icons";
import { ChatPanel } from "@/components/ChatPanel";
import { CoverPicker } from "@/components/CoverPicker";
import { InviteToSquad } from "@/components/InviteToSquad";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { api, connectSocket, SOCKET_EVENTS, session, subscribeChat, joinChat, classifyVibe } from "@giggle/core";
import { coverKind, coverBackground } from "@/components/covers";
import type { SquadState, SquadMemberState, JoinRequestUser } from "@giggle/core";
import { createVideoClient } from "@giggle/agora";
import { useViewport } from "@/components/useViewport";
import { useTheme } from "@/components/useTheme";
import { WEB_DISCOVERY_ENABLED } from "@/lib/discovery";
import { pollWhileVisible } from "@/lib/poll";

const CURATED_VIBES = ["Gaming", "Music", "Chill", "Comedy", "Deep Talks", "Late Night", "Sports", "Art", "Study", "Hype", "Fitness", "Foodies"];

function normalizeVibeLabels(vibes: string[] = []) {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const vibe of vibes) {
    if (typeof vibe !== "string") continue;
    const label = vibe.replace(/^[^\w]+/, "").replace(/\s+/g, " ").trim().slice(0, 15);
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(label);
    if (normalized.length >= 5) break;
  }
  return normalized;
}

// Translate a thrown ApiError / Agora error into a friendly, non-technical
// message for the video banner. Returns null only if the error is unknown.
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

function LobbyInner() {
  const { isPhone } = useViewport();
  const themeId = useTheme();
  const router = useRouter();
  const params = useSearchParams();
  const squadId = params.get("squad") ?? "";

  const [remotes, setRemotes] = useState<RemoteParticipant[]>([]);
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const mediaUnsubRef = useRef<(() => void) | null>(null);
  const [squad, setSquad] = useState<SquadState | null>(null);
  const [loading, setLoading] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
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
  // Search box + a growing list of user-created vibes (persisted locally so
  // created vibes keep showing up as suggestions next time).
  const [vibeSearch, setVibeSearch] = useState("");
  const [customVibes, setCustomVibes] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("giggle.customVibes");
      if (raw) setCustomVibes(JSON.parse(raw));
    } catch {}
  }, []);
  const MAX_VIBES = 5;
  // Moderation UX for user-created vibes: block disallowed terms, and require an
  // 18+ confirmation for adult vibes (which turns the squad into an adult room).
  const [vibeWarning, setVibeWarning] = useState<string | null>(null);

  // Non-adults can't create adult rooms: they confirmed a DOB at signup, so we
  // trust session.isAdult and hard-block instead of offering an 18+ opt-in.
  function commitVibe(v: string) {
    const lower = v.toLowerCase();
    if (selectedVibes.some(x => x.toLowerCase() === lower)) { setVibeSearch(""); return; }
    if (selectedVibes.length >= MAX_VIBES) return;
    setSelectedVibes(prev => [...prev, v]);
    setCustomVibes(prev => {
      if (prev.some(x => x.toLowerCase() === lower) || CURATED_VIBES.some(x => x.toLowerCase() === lower)) return prev;
      const next = [v, ...prev].slice(0, 40);
      try { localStorage.setItem("giggle.customVibes", JSON.stringify(next)); } catch {}
      return next;
    });
    setVibeSearch("");
  }
  function addCustomVibe(raw: string) {
    const v = raw.trim().replace(/\s+/g, " ");
    if (!v || v.length > 24) return;
    setVibeWarning(null);
    const verdict = classifyVibe(v);
    if (verdict === "blocked") {
      setVibeWarning("That vibe isn't allowed. Try something that keeps Giggle welcoming for everyone.");
      return;
    }
    if (verdict === "mature") {
      setVibeWarning("Choose a different interest.");
      return;
    }
    commitVibe(v);
  }

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

  // Collapsible sidebar (desktop) + integrated chat
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"info" | "chat">("info");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const chatVisibleRef = useRef(false);

  const vcRef = useRef<ReturnType<typeof createVideoClient> | null>(null);
  const lobbyMediaGenerationRef = useRef(0);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const [videoJoined, setVideoJoined] = useState(false);
  const [videoJoining, setVideoJoining] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

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
      if (WEB_DISCOVERY_ENABLED && ["searching", "matched", "in_encounter"].includes(s.status)) router.replace(`/matchmaking?squad=${squadId}`);
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
  async function enableLobbyMedia(withCamera = true): Promise<boolean> {
    if (!squadId || videoJoining) return videoJoined;
    if (videoJoined) return true;
    const generation = ++lobbyMediaGenerationRef.current;
    let vc: ReturnType<typeof createVideoClient> | null = null;
    setVideoJoining(true);
    setVideoError(null);
    try {
      const tokenData = await api.lobbyToken(squadId);
      if (generation !== lobbyMediaGenerationRef.current) return false;
      vc = createVideoClient();
      vcRef.current = vc;
      mediaUnsubRef.current?.();
      const offRemote = vc.onRemoteChange(setRemotes);
      const offCapture = vc.onCaptureState?.(state => {
        if (generation !== lobbyMediaGenerationRef.current) return;
        setMicOn(state.audio === "active");
        setCamOn(state.video === "active");
      });
      mediaUnsubRef.current = () => { offRemote(); offCapture?.(); };
      await vc.join(tokenData, { audio: true, video: withCamera });
      if (generation !== lobbyMediaGenerationRef.current) {
        if (vcRef.current === vc) vcRef.current = null;
        await vc.leave().catch(() => {});
        return false;
      }
      await api.setLobbyVideo(squadId, true);
      if (generation !== lobbyMediaGenerationRef.current) {
        if (vcRef.current === vc) vcRef.current = null;
        await Promise.allSettled([vc.leave(), api.setLobbyVideo(squadId, false)]);
        return false;
      }
      setVideoJoined(true);
      return true;
    } catch (e) {
      await vc?.leave().catch(() => {});
      if (vcRef.current === vc) vcRef.current = null;
      if (generation !== lobbyMediaGenerationRef.current) return false;
      setVideoError(describeVideoError(e));
      return false;
    } finally {
      if (generation === lobbyMediaGenerationRef.current) setVideoJoining(false);
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
      mediaUnsubRef.current?.();
      lobbyMediaGenerationRef.current += 1;
      vcRef.current?.leave().catch(() => {});
      void api.setLobbyVideo(squadId, false).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squadId]);

  useEffect(() => {
    if (videoJoined && camOn && localVideoRef.current) {
      try { vcRef.current?.playLocal(localVideoRef.current); } catch {}
    }
  }, [videoJoined, camOn, squad]);

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

  async function toggleMic() {
    const previous = micOn;
    const next = !micOn;
    setMicOn(next);
    setVideoError(null);
    try {
      if (!vcRef.current) throw new Error("Lobby video is not connected yet.");
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
      if (!vcRef.current) throw new Error("Lobby video is not connected yet.");
      await vcRef.current.setCamEnabled(next);
      if (next && localVideoRef.current) vcRef.current?.playLocal(localVideoRef.current);
    } catch (e) {
      setCamOn(previous);
      setVideoError((e as { message?: string })?.message || "Couldn't update camera.");
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
    if (!squadId) return;
    if (!WEB_DISCOVERY_ENABLED) {
      setMatchError("Stranger discovery is unavailable.");
      return;
    }
    // Only members who are actually connected gate the match. An offline member
    // who never marked ready must not permanently trap the leader (mirrors the
    // server's online-only ready-check). online === false means offline;
    // true/undefined counts as online.
    const activeMembers = (squad?.members ?? []).filter(m => m.online !== false);
    const everyoneReady = activeMembers.length > 0 && activeMembers.every(member => member.ready);
    if (!everyoneReady) {
      setMatchError("Everyone online needs to be ready before you find a match.");
      return;
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

  function toggleVibeChip(vibe: string) {
    setSelectedVibes(prev => {
      if (prev.includes(vibe)) return prev.filter(v => v !== vibe);
      if (prev.length >= 5) return prev;
      return [...prev, vibe];
    });
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
    const next = nameDraft.trim().slice(0, 40);
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
    mediaUnsubRef.current?.();
    setRemotes([]);
    const client = vcRef.current;
    vcRef.current = null;
    setVideoJoining(false);
    setVideoJoined(false);
    try { await client?.leave(); } catch {}
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

  const readyCount = squad?.members.filter(m => m.ready).length ?? 0;
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
  const allReady = onlineMembers.length > 0 && onlineMembers.every(m => m.ready);
  const myReady = !!myMember?.ready;
  const closeChat = () => { setChatOpen(false); setSidebarTab("info"); };

  return (
    <div className={`gg-lobby-root gg-screen gg-screen-lobby ${styles.page}`} data-testid="lobby-page">
      <nav className={`nav ${styles.nav}`} aria-label="Lobby navigation">
        <Link href="/home" className="brand" aria-label="Giggle home"><Wordmark /></Link>
      </nav>
      <header className={`lobby-head ${styles.lobbyHead}`}>
        <div className={styles.lobbyHeadCopy}>
          {squad.coverImage && <div aria-label="Squad cover" className={styles.cover} style={{ background: coverBackground(squad.coverImage, coverKind(squad.coverImage, themeId)) }} />}
          <h1 className={`title ${styles.title}`}>{squad.squadName}</h1>
          <p className={`lede ${styles.lede}`}>Invite friends and check your camera before joining a call.</p>
        </div>
        <Button variant="ghost" aria-label="Squad settings" onClick={() => setSettingsOpen(true)}><Icon.settings size={18} />Squad settings{joinReqs.length > 0 ? ` (${joinReqs.length})` : ""}</Button>
      </header>
      {(matchError || connTrouble) && <div role="alert" className={styles.notice}>{matchError || "Connection lost. Reconnecting to your squad…"}<Button variant="ghost" onClick={() => void fetchSquad()}>Retry</Button></div>}
      <div className={`lobby-grid ${styles.layout}`}>
        <section className={`lobby-stage ${styles.stage}`} data-count={memberCount + (canInvite ? 1 : 0)} hidden={isPhone && chatVisible} aria-label="Squad members">
          {squad.members.map((member, i) => {
            const isMe = member.userId === myUserId;
            const remote = remotes.find(r => String(r.uid) === String(member.uid));
            const camLabel = member.online === false && !isMe ? "Offline" : isMe ? (videoJoined ? (camOn ? "" : "Camera off") : "Camera off") : remote?.hasVideo ? "" : "Camera off";
            const roleLabel = member.ready ? "Ready" : member.memberId === squad.leaderMemberId ? "Leader" : "";
            return <article className={`preview gg-person ${isMe ? "self " : ""}${styles.person}`} key={member.memberId} data-testid="lobby-person">
              <PersonAvatar userId={member.userId} name={member.displayName} avatar={member.avatar} isMe={isMe} size="fill" />
              {camLabel && <span className={`cam-off ${styles.mediaStatus}`}>{camLabel}</span>}
              {isMe ? <div ref={localVideoRef} className={styles.video} style={{ opacity: camOn && videoJoined ? 1 : 0 }} /> : <div className={styles.video} style={{ opacity: remote?.hasVideo ? 1 : 0 }} ref={el => { if (el && remote?.hasVideo && member.uid !== undefined) { try { vcRef.current?.playRemote(member.uid, el); } catch { setVideoError("Couldn’t show their video. Try reconnecting your devices."); } } }} />}
              <div className={`preview-meta ${styles.personLabel}`}><span>{isMe ? "You" : member.displayName}</span>{roleLabel && <span className="badge">{roleLabel}</span>}</div>
            </article>;
          })}
          {canInvite && <button className={`preview invite ${styles.emptySeat}`} onClick={() => setInviteSheetOpen(true)}><Icon.plus size={30} /><span>Invite a friend</span></button>}
          <div className={`lobby-controls ${styles.controls}`}>
            {videoJoined ? <>
              <Button variant="secondary" onClick={toggleMic} aria-label={micOn ? "Mute microphone" : "Unmute microphone"}><Icon.mic size={19} />{micOn ? "Mic on" : "Mic off"}</Button>
              <Button variant="secondary" onClick={toggleCam} aria-label={camOn ? "Turn camera off" : "Turn camera on"}><Icon.cam size={19} />{camOn ? "Camera on" : "Camera off"}</Button>
            </> : <Button variant="secondary" loading={videoJoining} onClick={() => void enableLobbyMedia()} aria-label="Enable camera and microphone"><Icon.cam size={19} />Enable camera &amp; mic</Button>}
            <Button variant="secondary" onClick={() => { setChatOpen(true); setSidebarCollapsed(false); setSidebarTab("chat"); }}><Icon.chat size={19} />Chat{unread > 0 ? ` (${unread})` : ""}</Button>
          </div>
          {videoError && <p role="alert" className={styles.error}>{videoError}</p>}
        </section>
        <aside className={`card squad-panel ${styles.sidebar}`} hidden={chatVisible} aria-label="Squad details">
          <div className={`panel-head ${styles.row}`}><h2 className={`card-title ${styles.panelTitle}`}>Your squad</h2><span className={`count ${styles.count}`}>{memberCount} / {MAX_SLOTS}</span></div>
          <div className={`code-box ${styles.code}`}><strong className="code-val">{squad.squadCode}</strong><Button variant="ghost" size="sm" aria-label="Copy squad code" onClick={() => void copyToClipboard(squad.squadCode, () => setCodeCopied(true), "Couldn't copy the code.")}>{codeCopied ? "Copied" : "Copy"}</Button></div>
          <Button variant="secondary" fullWidth disabled={!canInvite} onClick={() => setInviteSheetOpen(true)}><Icon.plus size={18} />Invite friends</Button>
          <div className={`meta-row ${styles.interests}`}><span className={styles.interestLabel}>Interests</span>{currentTags.length ? <span>{currentTags.join(" · ")}</span> : <span className="muted">None added</span>}{isLeader && <button className={`link ${styles.quiet}`} onClick={() => { setSelectedVibes([...currentTags]); setVibeEditorOpen(true); }}>Edit interests</button>}</div>
          <div className={styles.nextStep}>
            <p className="hint">{memberCount === 1 ? "Invite friends or join a call on your own." : `${readyCount} of ${memberCount} ready`}</p>
            <Button variant={myReady ? "secondary" : "primary"} fullWidth loading={settingReady} onClick={handleReady}>{myReady ? "Not ready" : "I'm ready"}</Button>
            {WEB_DISCOVERY_ENABLED && isLeader && <Button fullWidth disabled={!allReady || findingMatch} loading={findingMatch} onClick={handleFindMatch}>Find a squad<Icon.chevron size={18} /></Button>}
            {!isLeader && <p className="muted fine">Your squad leader starts the search when everyone is ready.</p>}
            {isLeader && !allReady && <p className="muted fine">Everyone online needs to mark ready first.</p>}
            <Link href="/home" className={`link ${styles.back}`}>Back home</Link>
          </div>
        </aside>
        <aside className={styles.chat} hidden={!chatVisible} aria-label="Squad chat">
          <ChatPanel scope={{ kind: "lobby", squadId }} title="Squad chat" onClose={closeChat} />
        </aside>
      </div>
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
          {isLeader && <><Button variant="secondary" onClick={() => { setSettingsOpen(false); startRename(); }}>Rename squad</Button><Button variant="secondary" onClick={() => { setSettingsOpen(false); setCoverPickerOpen(true); }}>Change cover</Button></>}
          <label className={styles.field}>Visibility<select value={visibility} disabled={!isLeader || savingVisibility} onChange={e => void handleVisibility(e.target.value as "private" | "open")}><option value="private">Private — join with a code or invite</option><option value="open">Open — listed in Discover</option></select></label>
          <label className={styles.field}>Who can join<select value={joinPolicy} disabled={!isLeader || savingJoinPolicy} onChange={e => void handleJoinPolicy(e.target.value as "open" | "request" | "invite")}><option value="open">Anyone with access</option><option value="request">Ask to join</option><option value="invite">Invited people only</option></select></label>
          {isLeader && joinReqs.length > 0 && <section><h3>Join requests</h3>{reqError && <p role="alert">{reqError}</p>}{joinReqs.map(r => <div className={styles.row} key={r.userId}><span>{r.name}</span><Button size="sm" loading={reqBusy === r.userId} onClick={() => void handleApprove(r.userId)}>Approve</Button><Button size="sm" variant="ghost" disabled={!!reqBusy} onClick={() => void handleDecline(r.userId)}>Decline</Button></div>)}</section>}
          <section className={styles.modalStack}><h3>Members</h3>{squad.members.map(m => <div className={styles.row} key={m.memberId}><span>{m.displayName}{m.memberId === squad.leaderMemberId ? " · Leader" : ""}</span>{isLeader && m.userId !== myUserId && <Button size="sm" variant="ghost" onClick={() => { setSettingsOpen(false); setMemberToRemove(m); }}>Remove</Button>}</div>)}</section>
          <Button variant="danger" onClick={() => { setSettingsOpen(false); setLeaveMenuOpen(true); }}>Leave squad</Button>
        </div>
      </Modal>}
      {editingName && <Modal title="Rename squad" onClose={() => { if (!savingName) setEditingName(false); }} width={420}><form className={styles.modalStack} onSubmit={e => { e.preventDefault(); void saveName(); }}><label className={styles.field}>Squad name<input autoFocus maxLength={40} value={nameDraft} onChange={e => setNameDraft(e.target.value)} /></label>{matchError && <p role="alert">{matchError}</p>}<Button type="submit" loading={savingName}>Save name</Button></form></Modal>}
      {memberToRemove && <Modal title={`Remove ${memberToRemove.displayName}?`} onClose={() => { if (!removingMember) setMemberToRemove(null); }} width={420}><p>They will leave this squad. You can invite them again later.</p><Button variant="danger" loading={removingMember} onClick={handleRemoveMember}>Remove member</Button></Modal>}
      {leaveMenuOpen && <Modal title="Leave this squad?" onClose={() => { if (!leavingSquad) setLeaveMenuOpen(false); }} width={420}><div className={styles.modalStack}><p>{isLeader ? memberCount > 1 ? "Leadership will pass to another member. You can also end the squad for everyone." : "You are the only member. Leaving will close this squad." : "The rest of your squad can keep talking."}</p>{matchError && <p role="alert">{matchError}</p>}<Button variant="secondary" loading={leavingSquad} onClick={handleLeaveSquad}>Leave squad</Button>{isLeader && memberCount > 1 && <Button variant="danger" loading={leavingSquad} onClick={handleDisbandSquad}>End squad for everyone</Button>}</div></Modal>}
      {noCamConfirmOpen && <Modal title="Connect your devices" subtitle="Choose how you want to join the call." onClose={() => { if (!noCamEnabling) setNoCamConfirmOpen(false); }} width={420}><div className={styles.modalStack}>{videoError && <p role="alert" className={styles.error}>{videoError}</p>}<Button loading={noCamEnabling} onClick={async () => { setNoCamEnabling(true); const ok = await enableLobbyMedia(); setNoCamEnabling(false); if (!ok) return; setNoCamConfirmOpen(false); await proceedFindMatch(); }}>Enable camera &amp; mic</Button><Button variant="secondary" loading={noCamEnabling} onClick={async () => { setNoCamEnabling(true); const ok = await enableLobbyMedia(false); setNoCamEnabling(false); if (!ok) return; setNoCamConfirmOpen(false); await proceedFindMatch(); }}>Continue with audio only</Button></div></Modal>}
      {invitePeopleOpen && <InviteToSquad squadId={squadId} squadName={squad.squadName} onClose={() => setInvitePeopleOpen(false)} />}
      {coverPickerOpen && <CoverPicker squadId={squadId} currentCover={squad.coverImage} onClose={() => setCoverPickerOpen(false)} onSaved={async () => { await fetchSquad(); setCoverPickerOpen(false); }} />}
      {vibeEditorOpen && <Modal title="Edit interests" subtitle={`Choose up to ${MAX_VIBES}.`} onClose={() => { if (!savingVibes) setVibeEditorOpen(false); }} width={440}><div className={styles.modalStack}><label className={styles.field}>Find or add an interest<input value={vibeSearch} maxLength={15} onChange={e => setVibeSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomVibe(vibeSearch); } }} /></label>{(vibeWarning || matchError) && <p role="alert" className={styles.error}>{vibeWarning || matchError}</p>}<div className={styles.chips}>{Array.from(new Set([...selectedVibes, ...customVibes, ...CURATED_VIBES])).filter(v => v.toLowerCase().includes(vibeSearch.toLowerCase())).map(v => <button key={v} aria-pressed={selectedVibes.includes(v)} disabled={!selectedVibes.includes(v) && selectedVibes.length >= MAX_VIBES} onClick={() => toggleVibeChip(v)}>{v}</button>)}</div>{vibeSearch.trim() && <Button variant="secondary" onClick={() => addCustomVibe(vibeSearch)}>Add interest</Button>}<Button loading={savingVibes} onClick={saveVibes}>Save interests</Button></div></Modal>}
    </div>
  );
}

export default function LobbyPage() {
  return <Suspense fallback={<div style={{ padding: 40 }}>Loading lobby…</div>}><LobbyInner /></Suspense>;
}
