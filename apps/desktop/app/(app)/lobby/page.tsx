"use client";
import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { AvatarArt } from "@/components/AvatarArt";
import { Icon } from "@/components/Icons";
import { ChatPanel } from "@/components/ChatPanel";
import { CoverPicker } from "@/components/CoverPicker";
import { ThemeToggle } from "@/components/ThemeToggle";
import { InviteToSquad } from "@/components/InviteToSquad";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { api, connectSocket, SOCKET_EVENTS, session, getMyAvatar, subscribeAvatar, subscribeChat, joinChat, DEFAULT_AVATAR_ID, classifyVibe, tagsAreMature } from "@giggle/core";
import { coverKind, coverBackground, fallbackGradient } from "@/components/covers";
import type { SquadState, JoinRequestUser } from "@giggle/core";
import { createVideoClient } from "@giggle/agora";
import { useViewport } from "@/components/useViewport";
import { useTheme } from "@/components/useTheme";

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

const KEYFRAMES = `
@keyframes tileIn {
  from { opacity: 0; transform: scale(0.92); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes readyGlow {
  0%,100% { box-shadow: 0 0 0 2px #C2FF3D44; }
  50%      { box-shadow: 0 0 0 4px #C2FF3D88, 0 0 24px -4px #C2FF3D66; }
}
@keyframes controlIn {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes lobbyShimmer {
  0%   { background-position: -160% center; }
  100% { background-position: 160% center; }
}

/* ── PREMIUM MICRO-INTERACTION SPEC (shared) ─────────────────────────────
   Tactile press feedback for every control. Scoped to the lobby root class
   (NOT a theme) so it applies in every theme and never leaks elsewhere.
   Press uses !important to beat inline hover transforms; cubic-bezier easing
   for a satisfying spring-out. */
.gg-lobby-root button:not(:disabled) {
  -webkit-tap-highlight-color: transparent;
  transition: transform .14s cubic-bezier(.22,1,.36,1), box-shadow .2s cubic-bezier(.4,0,.2,1), background .2s cubic-bezier(.4,0,.2,1), color .2s cubic-bezier(.4,0,.2,1), border-color .2s cubic-bezier(.4,0,.2,1), filter .2s cubic-bezier(.4,0,.2,1);
}
.gg-lobby-root button:not(:disabled):active {
  transform: scale(.94) !important;
  transition-duration: .06s;
}
.gg-lobby-root button:disabled {
  cursor: not-allowed;
}
.gg-lobby-root button:focus-visible,
.gg-lobby-root [role="button"]:focus-visible,
.gg-lobby-root input:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent, var(--violet, #7C5CFF));
}
.gg-lobby-root [role="button"] { -webkit-tap-highlight-color: transparent; }
.gg-lobby-root [role="button"]:active { transform: scale(.97); }
.gg-lobby-root input {
  transition: border-color .18s cubic-bezier(.4,0,.2,1), box-shadow .18s cubic-bezier(.4,0,.2,1), background .18s cubic-bezier(.4,0,.2,1);
}
.gg-lobby-root input:focus {
  border-color: var(--accent, var(--violet, #7C5CFF)) !important;
  box-shadow: 0 0 0 3px rgba(124,92,255,0.22);
}
@media (prefers-reduced-motion: reduce) {
  .gg-lobby-root *,
  .gg-lobby-root *::before,
  .gg-lobby-root *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
  .gg-lobby-root button:not(:disabled):active,
  .gg-lobby-root [role="button"]:active { transform: none !important; }
}
`;

function LobbyInner() {
  const { isPhone, isNarrow } = useViewport();
  const themeId = useTheme();
  const router = useRouter();
  const params = useSearchParams();
  const squadId = params.get("squad") ?? "";

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
  const [connTroubleDismissed, setConnTroubleDismissed] = useState(false);
  const [leavingSquad, setLeavingSquad] = useState(false);
  const [leaveMenuOpen, setLeaveMenuOpen] = useState(false);

  // Cover picker
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);

  // Invite people modal (friends + user search). Any member can open it.
  const [invitePeopleOpen, setInvitePeopleOpen] = useState(false);
  const [invitePeopleHovered, setInvitePeopleHovered] = useState(false);

  // Squad name rename (leader only)
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [renameHovered, setRenameHovered] = useState(false);

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
  const [pendingMatureVibe, setPendingMatureVibe] = useState<string | null>(null);
  // Non-adults can't create adult rooms: they confirmed a DOB at signup, so we
  // trust session.isAdult and hard-block instead of offering an 18+ opt-in.
  const [matureBlocked, setMatureBlocked] = useState<string | null>(null);
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
    setMatureBlocked(null);
    const verdict = classifyVibe(v);
    if (verdict === "blocked") {
      setVibeWarning("That vibe isn't allowed. Try something that keeps Giggle welcoming for everyone.");
      return;
    }
    if (verdict === "mature") {
      // Adult vibe → turns the squad into an adult room. Minors (per their
      // signup DOB) are hard-blocked; adults get the confirm-first flow.
      if (!session.isAdult) {
        setMatureBlocked(v);
        return;
      }
      setPendingMatureVibe(v);
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

  // Local user's chosen avatar (SSR-safe: read after mount)
  const [myAvatar, setMyAvatarState] = useState<string>(DEFAULT_AVATAR_ID);
  useEffect(() => {
    setMyAvatarState(getMyAvatar());
    return subscribeAvatar((v) => setMyAvatarState(v));
  }, []);

  // Squad chat
  const [chatOpen, setChatOpen] = useState(false); // phone docked chat sheet
  const [chatHovered, setChatHovered] = useState(false);

  // Collapsible sidebar (desktop) + integrated chat
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"info" | "chat">("info");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [railHover, setRailHover] = useState<string | null>(null);
  const chatVisibleRef = useRef(false);

  const vcRef = useRef<ReturnType<typeof createVideoClient> | null>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const [videoJoined, setVideoJoined] = useState(false);
  const [videoJoining, setVideoJoining] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Hover states
  const [inviteHovered, setInviteHovered] = useState(false);
  const [inviteTileHovered, setInviteTileHovered] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [copyLinkHovered, setCopyLinkHovered] = useState(false);
  const [leaveHovered, setLeaveHovered] = useState(false);
  const [micHovered, setMicHovered] = useState(false);
  const [camHovered, setCamHovered] = useState(false);
  const [readyHovered, setReadyHovered] = useState(false);
  const [editVibesHovered, setEditVibesHovered] = useState(false);
  const [changeCoverHovered, setChangeCoverHovered] = useState(false);
  const [boostHovered, setBoostHovered] = useState(false);
  const [copyCodeHovered, setCopyCodeHovered] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [vibeChipHovered, setVibeChipHovered] = useState<string | null>(null);

  const violet = "var(--accent, var(--violet))";
  const lime = "var(--lime)";
  const limeText = "var(--lime-text)";
  const coral = "var(--coral)";
  // ── CHROME text tiers ───────────────────────────────────────────────────
  // The lobby now RESPECTS THE ACTIVE THEME (Meet/Zoom light-mode model): the
  // room chrome + canvas adopt theme tokens; only the video TILES stay dark.
  // These drive header / sidebar / control-bar / modal text, so they are theme
  // tokens (light in Cloud, plum in Midnight, ink in Tangerine). Tile-internal
  // text keeps its own light-on-dark literals inline (do NOT theme those).
  const textPrimary = "var(--text)";
  const textMuted = "var(--text-body)";
  const textTertiary = "var(--text-muted)";
  // Chrome hairline (header / sidebar / panels) — themed, not a stage literal.
  const ON_STAGE_HAIRLINE = "var(--border)";

  async function fetchSquad() {
    if (!squadId) return;
    try {
      const s = await api.getSquad(squadId);
      setSquad(s);
      const vis = (s as { visibility?: "private" | "open" }).visibility;
      if (vis === "open" || vis === "private") setVisibility(vis);
      const jp = (s as { joinPolicy?: "open" | "request" | "invite" }).joinPolicy;
      if (jp === "open" || jp === "request" || jp === "invite") setJoinPolicy(jp);
      if (s.tags?.length) {
        setSelectedVibes(normalizeVibeLabels(s.tags));
      }
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
    setConnTroubleDismissed(false);
  }
  function pollFailed() {
    pollFailsRef.current += 1;
    if (pollFailsRef.current >= 2) setConnTrouble(true);
  }

  // Returns true only if the camera/mic actually joined — callers that gate a
  // follow-up action (e.g. the "Enable camera" match flow) must not proceed on
  // a swallowed failure.
  async function enableLobbyMedia(): Promise<boolean> {
    if (!squadId || videoJoining) return videoJoined;
    if (videoJoined) return true;
    setVideoJoining(true);
    setVideoError(null);
    try {
      const tokenData = await api.lobbyToken(squadId);
      const vc = createVideoClient();
      vcRef.current = vc;
      await vc.join(tokenData, { audio: true, video: true });
      await api.setLobbyVideo(squadId, true);
      setVideoJoined(true);
      return true;
    } catch (e) {
      await vcRef.current?.leave().catch(() => {});
      vcRef.current = null;
      setVideoError(describeVideoError(e));
      return false;
    } finally {
      setVideoJoining(false);
    }
  }

  useEffect(() => {
    if (!squadId) { setLoading(false); return; }
    fetchSquad();

    const socket = connectSocket(squadId);
    socket.on(SOCKET_EVENTS.SQUAD_UPDATED, fetchSquad);

    return () => {
      socket.off(SOCKET_EVENTS.SQUAD_UPDATED, fetchSquad);
      vcRef.current?.leave().catch(() => {});
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
      if (m.squadId != null && m.squadId !== squadId) return;
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
    const poll = setInterval(fetchJoinRequests, 15000);
    return () => {
      socket.off(SOCKET_EVENTS.SQUAD_UPDATED, onUpdate);
      clearInterval(poll);
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
    if (!squadId) return;
    setSettingReady(true);
    setMatchError(null);
    try {
      const myM = (session.user?.id
        ? squad?.members.find(m => m.userId === session.user!.id)
        : undefined) ?? squad?.members[0];
      const currentReady = myM?.ready ?? false;
      await api.setReady(squadId, !currentReady);
      await fetchSquad();
    } catch (e) {
      setMatchError((e as { message?: string })?.message || "Couldn't update ready status.");
    } finally {
      setSettingReady(false);
    }
  }

  async function handleFindMatch() {
    if (!squadId) return;
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
      await api.setLobbyVideo(squadId, true);
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

  async function handleLeaveSquad() {
    if (!squadId || leavingSquad) return;
    setLeavingSquad(true);
    setMatchError(null);
    try {
      await api.leaveSquad(squadId);
      router.push("/home");
    } catch (e) {
      console.error("leaveSquad failed:", e);
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

  const currentTags = normalizeVibeLabels(squad.tags?.length ? squad.tags : ["🎮 Gaming", "🌙 Late Night", "🎵 Music"]);
  // Adult room? Any of the squad's real tags is a mature vibe. Drives the 18+ badge.
  const squadIsAdult = tagsAreMature(squad.tags ?? []);
  const adultBadge = (
    <span
      title="Adult squad — 18+ vibes"
      aria-label="18 plus, adult squad"
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
        background: "var(--coral-soft, rgba(255,92,92,0.14))",
        color: "var(--coral-text, var(--coral, #FF5C5C))",
        border: "1px solid color-mix(in srgb, var(--coral, #FF5C5C) 40%, transparent)",
        borderRadius: 999, padding: "2px 9px", fontSize: 12, fontWeight: 700, letterSpacing: "0.02em",
      }}
    >
      <span aria-hidden>🔞</span> 18+
    </span>
  );

  // ── Squad cover identity ──────────────────────────────────────────────
  // hasCover: leader has explicitly chosen a cover. When absent we fall back to
  // a deterministic per-squad gradient so the squad still feels themed. Both
  // resolve to a CSS `background` value ready for inline styles.
  const hasCover = !!squad.coverImage;
  // The header is now themed, so covers follow the ACTIVE theme again (bright
  // pastel twins in light themes, moody variants in Midnight) — same
  // theme-aware resolution the dashboard uses. Photos keep their dark scrim.
  const coverStyleKind = coverKind(squad.coverImage, themeId);
  const coverBg = hasCover
    ? coverBackground(squad.coverImage, coverStyleKind)
    : fallbackGradient(squad.squadId || squad.squadName, coverStyleKind);
  // Small reusable cover thumbnail (used by the header + Squad Info panel).
  const coverThumb = (size: number) => (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size * 0.28), flexShrink: 0,
      background: coverBg, backgroundSize: "cover", backgroundPosition: "center",
      border: "1.5px solid var(--border-strong)",
      boxShadow: "0 0 12px -4px rgba(124,92,255,0.5)",
    }} />
  );

  // Show real members + a SINGLE "invite a friend" affordance (not a full grid
  // of empty slots — that looks broken when only 1–2 people are present). Once
  // the squad is full, no invite tile. Grid sizes to exactly what we render.
  const canInvite = memberCount < MAX_SLOTS;
  const showInviteTile = canInvite && !isNarrow;
  const emptySlots = showInviteTile ? 1 : 0;
  const tileCount = Math.max(memberCount + emptySlots, 1);
  // Scale columns with the squad size so up to 8 tiles stay elegant:
  // 1→1, 2-4→2, 5-6→3, 7-8→4 columns.
  const gridCols = tileCount <= 1 ? 1 : tileCount <= 4 ? 2 : tileCount <= 6 ? 3 : 4;
  const gridRows = Math.ceil(tileCount / gridCols);
  // Effective layout (phone caps at 2 cols); rows derived so tiles fill the stage.
  const effCols = isPhone ? Math.min(gridCols, 2) : gridCols;
  const effRows = Math.ceil(tileCount / effCols);

  // Match readiness is gated on ONLINE members only — an offline member who
  // never marked ready must not block the leader (mirrors the server check).
  const onlineMembers = (squad?.members ?? []).filter(m => m.online !== false);
  const onlineReadyCount = onlineMembers.filter(m => m.ready).length;
  const allReady = onlineMembers.length > 0 && onlineReadyCount === onlineMembers.length;
  const myReady = !!myMember?.ready;
  // Who's holding up the match — only online members can act, so offline ones
  // (who can't respond) never appear in the "waiting on…" helper.
  const notReadyNames = onlineMembers.filter(m => !m.ready).map(m => m.displayName);
  const notReadyLabel = notReadyNames.length <= 2
    ? notReadyNames.join(", ")
    : `${notReadyNames.slice(0, 2).join(", ")} +${notReadyNames.length - 2}`;

  // ── Reusable surfaces (shared by phone sheet + expanded desktop panel) ──
  const infoCard = (
    <div style={{
      padding: 16,
      display: "flex", flexDirection: "column", gap: 12,
      borderBottom: "1px solid var(--border)",
    }}>
      {/* Squad identity: cover thumbnail + name so the panel is themed too */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {coverThumb(38)}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 14, fontWeight: 700, color: textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {squad.squadName}
            </div>
            {squadIsAdult && adultBadge}
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: textTertiary, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>Squad Info</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {[
          { label: "Members", value: `${memberCount} / ${MAX_SLOTS}`, color: textPrimary },
          { label: "Ready", value: `${readyCount} / ${memberCount}`, color: allReady ? limeText : textPrimary },
        ].map(row => (
          <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: textTertiary, fontSize: 12 }}>{row.label}</span>
            <span
              role={row.label === "Ready" ? "status" : undefined}
              aria-live={row.label === "Ready" ? "polite" : undefined}
              style={{ color: row.color, fontSize: 12, fontWeight: 600 }}
            >
              {row.value}
            </span>
          </div>
        ))}

        <button
          onClick={() => setSettingsOpen(open => !open)}
          aria-expanded={settingsOpen}
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 44, padding: "0 2px", border: "none", borderTop: "1px solid var(--border)", background: "transparent", color: textPrimary, cursor: "pointer" }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700 }}><Icon.settings size={14} color={textMuted} /> Room settings</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: textTertiary, fontSize: 12 }}>
            {visibility === "open" ? "Open" : "Private"} · {joinPolicy === "request" ? "Approval" : joinPolicy === "invite" ? "Invite only" : "Instant join"}
            <span style={{ transform: settingsOpen ? "rotate(90deg)" : "none", display: "flex" }}><Icon.chevron size={14} color={textMuted} /></span>
          </span>
        </button>

        {settingsOpen && <>
        {isNarrow && isLeader && (
          <button
            onClick={() => { setVibeEditorOpen(true); setSelectedVibes(normalizeVibeLabels(currentTags)); }}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 44, padding: "0 2px", border: "none", borderTop: "1px solid var(--border)", background: "transparent", color: textPrimary, cursor: "pointer" }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 700 }}><Icon.settings size={14} color={textMuted} /> Edit vibes</span>
            <span style={{ maxWidth: "55%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: textTertiary, fontSize: 12 }}>{currentTags.join(" · ") || "None set"}</span>
          </button>
        )}
        {/* Visibility toggle */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 9, borderTop: "1px solid var(--border)" }}>
          <span style={{ color: textTertiary, fontSize: 12 }}>Visibility</span>
          <div style={{ display: "flex", background: "var(--overlay)", borderRadius: 999, padding: 2, gap: 2, opacity: isLeader ? 1 : 0.6 }}
            title={isLeader ? undefined : "Only the squad leader can change visibility"}>
            {(["private", "open"] as const).map(v => (
              <button key={v} onClick={() => handleVisibility(v)} disabled={!isLeader || savingVisibility} style={{
                minHeight: 44, padding: "0 12px", borderRadius: 999, border: "none",
                cursor: isLeader && !savingVisibility ? "pointer" : "not-allowed",
                fontSize: 12, fontWeight: 700, letterSpacing: "0.04em",
                background: visibility === v ? (v === "open" ? "var(--lime)" : "var(--accent, var(--violet))") : "transparent",
                color: visibility === v ? (v === "open" ? "#0B0B0F" : "#fff") : textTertiary,
                transition: "all 0.15s",
              }}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {!isLeader && (
          <div style={{ fontSize: 12, color: textTertiary, lineHeight: 1.5 }}>
            Only the squad leader can change visibility.
          </div>
        )}
        {visibility === "open" && (
          <div style={{ fontSize: 12, color: textTertiary, lineHeight: 1.5 }}>
            Open lets strangers fill empty slots — find more matches.
          </div>
        )}

        {/* Join policy: leaders toggle Open/Request/Invite-only; others see the current mode */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 9, borderTop: "1px solid var(--border)" }}>
          <span style={{ color: textTertiary, fontSize: 12 }}>Join</span>
          {isLeader ? (
            <div style={{ display: "flex", background: "var(--overlay)", borderRadius: 999, padding: 2, gap: 2 }}>
              {(["open", "request", "invite"] as const).map(v => (
                <button key={v} onClick={() => handleJoinPolicy(v)} disabled={savingJoinPolicy} style={{
                  minHeight: 44, padding: "0 12px", borderRadius: 999, border: "none",
                  cursor: savingJoinPolicy ? "not-allowed" : "pointer",
                  fontSize: 12, fontWeight: 700, letterSpacing: "0.04em",
                  background: joinPolicy === v ? (v === "open" ? "var(--lime)" : "var(--accent, var(--violet))") : "transparent",
                  color: joinPolicy === v ? (v === "open" ? "#0B0B0F" : "#fff") : textTertiary,
                  transition: "all 0.15s",
                }}>
                  {v === "open" ? "Open" : v === "request" ? "Request" : "Invite-only"}
                </button>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: 12, fontWeight: 700, color: joinPolicy === "open" ? limeText : violet }}>
              {joinPolicy === "open" ? "Open" : joinPolicy === "request" ? "Request" : "Invite-only"}
            </span>
          )}
        </div>
        {isLeader && (
          <div style={{ fontSize: 12, color: textTertiary, lineHeight: 1.5 }}>
            Open: anyone can join instantly. Request: you approve who joins. Invite-only: only people you invite can join.
          </div>
        )}
        {isLeader && joinPolicy === "invite" && (
          <div style={{ fontSize: 12, color: violet, lineHeight: 1.5, fontWeight: 600 }}>
            Share your invite code below to bring people in — it's the only way to join this squad.
          </div>
        )}
        </>}
      </div>

      {/* Join requests (leader only, only when pending) */}
      {isLeader && joinReqs.length > 0 && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 8,
          paddingTop: 12, borderTop: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 12, fontWeight: 700, color: textPrimary, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>
              Join Requests
            </span>
            <Badge tone="info" style={{ borderRadius: 999 }}>{joinReqs.length}</Badge>
          </div>
          {reqError && (
            <div style={{ fontSize: 12, color: coral, lineHeight: 1.4 }}>{reqError}</div>
          )}
          {joinReqs.map((r, i) => {
            const dem = [
              r.age != null ? String(r.age) : null,
              r.country || null,
              ...(r.languages?.slice(0, 2) ?? []),
            ].filter(Boolean).join(" · ");
            const busy = reqBusy === r.userId;
            return (
              <div key={r.userId} style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "var(--overlay)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "8px 10px",
              }}>
                <Avatar name={r.name} size={28} colorIndex={i} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                  {dem && (
                    <div style={{ fontSize: 12, color: textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dem}</div>
                  )}
                </div>
                <button
                  onClick={() => handleApprove(r.userId)}
                  disabled={busy}
                  title="Approve"
                  style={{
                    padding: "5px 10px", borderRadius: 8, border: "none",
                    cursor: busy ? "not-allowed" : "pointer",
                    background: "var(--lime)", color: "#0B0B0F", fontSize: 12, fontWeight: 700,
                    opacity: busy ? 0.6 : 1, transition: "all .15s ease",
                  }}
                >✓</button>
                <button
                  onClick={() => handleDecline(r.userId)}
                  disabled={busy}
                  title="Decline"
                  style={{
                    padding: "5px 10px", borderRadius: 8,
                    cursor: busy ? "not-allowed" : "pointer",
                    background: "transparent", border: "1px solid var(--coral-border, rgba(255,92,92,0.27))",
                    color: coral, fontSize: 12, fontWeight: 700,
                    opacity: busy ? 0.6 : 1, transition: "all .15s ease",
                  }}
                >×</button>
              </div>
            );
          })}
        </div>
      )}

      {/* Member rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 4, borderTop: "1px solid var(--border)" }}>
        {squad.members.map((member, i) => {
          const isThisLeader = member.memberId === squad.leaderMemberId;
          // Local user is always present. A remote member is offline ONLY when
          // online === false (true/undefined → render as online, so older data
          // never makes everyone look offline).
          const isThisMe = session.user?.id ? member.userId === session.user.id : i === 0;
          const isOffline = !isThisMe && member.online === false;
          const dem = [
            member.age != null ? String(member.age) : null,
            member.country || null,
            ...(member.languages?.slice(0, 2) ?? []),
          ].filter(Boolean).join(" · ");
          return (
            <div key={member.memberId} style={{ display: "flex", alignItems: "center", gap: 8, opacity: isOffline ? 0.6 : 1 }}>
              {/* Presence dot: teal when online, muted grey when offline */}
              <span title={isOffline ? "Offline" : "Online"} style={{
                width: 8, height: 8, borderRadius: 999, flexShrink: 0,
                background: isOffline ? "var(--text-dim)" : "var(--live, var(--lime))",
                boxShadow: isOffline ? "none" : "0 0 6px var(--lime)",
              }} />
              <Avatar name={member.displayName} size={28} colorIndex={i} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {member.displayName}
                {isThisLeader && <span style={{ color: violet, fontSize: 12, fontWeight: 700, marginLeft: 4 }}>★</span>}
                {isOffline && (
                  <span style={{ color: textTertiary, fontSize: 12, fontWeight: 600, marginLeft: 6 }}>Offline</span>
                )}
                {dem && (
                  <span style={{ color: textTertiary, fontSize: 12, fontWeight: 500, marginLeft: 6 }}>{dem}</span>
                )}
              </span>
              <Badge tone={member.ready ? "live" : "full"}>{member.ready ? "READY" : "WAIT"}</Badge>
            </div>
          );
        })}
      </div>

      {/* Invite people — friends list + search any user (any member can invite) */}
      <button
        onClick={() => setInvitePeopleOpen(true)}
        onMouseEnter={() => setInvitePeopleHovered(true)}
        onMouseLeave={() => setInvitePeopleHovered(false)}
        style={{
          minHeight: 44, padding: "0 14px", borderRadius: 12, cursor: "pointer",
          background: invitePeopleHovered ? "var(--accent, var(--violet))" : "var(--violet-soft)",
          border: "1px solid var(--violet)",
          color: invitePeopleHovered ? "#fff" : violet,
          fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 12, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          transition: "all .15s ease",
        }}
        title="Invite friends or search for anyone"
      >
        <Icon.users size={14} color={invitePeopleHovered ? "#fff" : violet} />
        Invite people
      </button>

      {/* Boost — demoted to a subtle upsell. The lobby's job is to gather the
          squad and start matching; monetization shouldn't compete with that. */}
      <button
        onClick={() => router.push("/premium")}
        onMouseEnter={() => setBoostHovered(true)}
        onMouseLeave={() => setBoostHovered(false)}
        style={{
          minHeight: 36, padding: "0 6px", border: "none", cursor: "pointer", background: "none",
          color: boostHovered ? textPrimary : textTertiary,
          fontSize: 12, fontWeight: 600,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          transition: "color .15s ease",
        }}
        title="Giggle+ — monthly tokens and cosmetic perks"
      >
        <Icon.star size={12} color={boostHovered ? "var(--lime-text)" : "var(--text-dim)"} />
        Unlock covers &amp; perks with Giggle+
      </button>
    </div>
  );

  const inviteCard = (
    <div style={{
      padding: 16,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 13, fontWeight: 700, color: textPrimary, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>Invite people</div>
      <div style={{
        background: "var(--surface-2)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "10px 12px",
        fontFamily: "monospace", fontSize: 22, fontWeight: 700, color: "var(--text)",
        letterSpacing: "0.14em", textAlign: "center" as const,
      }}>
        {squad.squadCode}
      </div>
      {/* Primary: share a link that joins + opens the lobby in one tap. */}
      <button
        onClick={() => void copyToClipboard(
          inviteUrl,
          () => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1800); },
          "Couldn't copy the invite link. Copy the code instead.",
        )}
        onMouseEnter={() => setCopyLinkHovered(true)}
        onMouseLeave={() => setCopyLinkHovered(false)}
        style={{
          width: "100%", minHeight: 44, padding: "0 12px", borderRadius: 9,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
          background: linkCopied ? "var(--live)" : "var(--accent, var(--violet))",
          border: "1px solid transparent",
          color: linkCopied ? "#0B0B0F" : "var(--on-accent, #fff)", fontSize: 13, fontWeight: 700, cursor: "pointer",
          opacity: copyLinkHovered && !linkCopied ? 0.92 : 1,
          transition: "all .15s ease",
        }}
      >
        <Icon.enter size={15} color={linkCopied ? "#0B0B0F" : "var(--on-accent, #fff)"} />
        {linkCopied ? "Invite link copied!" : "Copy invite link"}
      </button>
      <button
        onClick={() => void copyToClipboard(
          squad.squadCode,
          () => {
            setCodeCopied(true);
            setTimeout(() => setCodeCopied(false), 1800);
          },
          "Couldn't copy squad code. Select the code and copy it manually.",
        )}
        onMouseEnter={() => setCopyCodeHovered(true)}
        onMouseLeave={() => setCopyCodeHovered(false)}
        style={{
          width: "100%", minHeight: 44, padding: "0 12px", borderRadius: 9,
          background: codeCopied ? "var(--lime)" : copyCodeHovered ? "var(--overlay-hover)" : "transparent",
          border: codeCopied ? "1px solid var(--lime)" : copyCodeHovered ? "1px solid var(--border-strong)" : "1px solid var(--border)",
          color: codeCopied ? "#0B0B0F" : textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer",
          transition: "all .15s ease",
        }}
      >
        {codeCopied ? "Copied!" : "Copy code instead"}
      </button>
    </div>
  );

  const infoPanel = (
    <div style={{ background: "var(--surface)", border: `1px solid ${ON_STAGE_HAIRLINE}`, borderRadius: 14, overflow: "hidden" }}>
      {infoCard}
      {inviteCard}
    </div>
  );

  const chatSurface = (
    <ChatPanel
      scope={{ kind: "lobby", squadId }}
      title="Squad Chat"
      onClose={isPhone ? () => setChatOpen(false) : () => setSidebarTab("info")}
    />
  );

  return (
    <>
      <style>{KEYFRAMES}</style>
      {/* Full calling layout: flex column filling viewport. The room chrome +
          canvas RESPECT the active theme (Meet/Zoom light-mode model); only the
          video tiles stay dark. `.gg-lobby-root` scopes the press micro-
          interactions to this subtree in every theme. */}
      <div className="gg-lobby-root" style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)", overflow: "hidden" }}>

        {/* ── COMPACT HEADER — themed with the squad's own cover ── */}
        <div style={{
          position: "relative",
          display: "flex", alignItems: "center", gap: 12,
          padding: isPhone ? "8px 10px" : "12px 20px",
          background: "var(--surface)",
          borderBottom: `1px solid ${ON_STAGE_HAIRLINE}`,
          backdropFilter: "blur(12px)",
          flexShrink: 0,
          zIndex: 10,
          flexWrap: isPhone ? "nowrap" as const : "wrap" as const,
          overflow: "hidden",
        }}>
          {/* Cover banner backdrop — the squad's cover, tinted + scrimmed so the
              header instantly reads as THIS squad's theme while the controls
              on top stay fully legible. */}
          <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
            <div style={{
              position: "absolute", inset: 0,
              background: coverBg, backgroundSize: "cover", backgroundPosition: "center",
              opacity: 0.42,
            }} />
            {/* Legibility scrim: themed wash (var(--surface)) toward the left where
                name/code sit, so the header reads as this squad's cover tint while
                staying legible in EVERY theme (light in Cloud, plum in Midnight). */}
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(90deg, var(--surface) 0%, color-mix(in srgb, var(--surface) 74%, transparent) 45%, color-mix(in srgb, var(--surface) 52%, transparent) 100%)",
            }} />
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(180deg, color-mix(in srgb, var(--surface) 32%, transparent) 0%, color-mix(in srgb, var(--surface) 54%, transparent) 100%)",
            }} />
          </div>

          {/* Cover thumbnail — the squad's identity chip. Leaders with no cover
              yet get a subtle "set a cover" affordance layered on top. */}
          <button
            onClick={isLeader ? () => setCoverPickerOpen(true) : undefined}
            title={isLeader ? (hasCover ? "Change cover" : "Set a cover") : undefined}
            aria-label={isLeader ? (hasCover ? "Change cover" : "Set a cover") : undefined}
            style={{
              position: "relative", zIndex: 1,
              width: 44, height: 44, padding: 0, borderRadius: 12, flexShrink: 0,
              background: coverBg, backgroundSize: "cover", backgroundPosition: "center",
              border: "1.5px solid var(--border-strong)",
              boxShadow: "0 0 12px -4px rgba(124,92,255,0.5)",
              cursor: isLeader ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {isLeader && !hasCover && (
              <span style={{
                position: "absolute", inset: 0, borderRadius: 12,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(11,11,15,0.45)",
              }}>
                <Icon.plus size={16} color="#F4F4F7" />
              </span>
            )}
          </button>

          {/* Squad name + code */}
          <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: isPhone ? "column" : "row", alignItems: isPhone ? "flex-start" : "center", gap: isPhone ? 2 : 8, minWidth: 0, flex: isPhone ? "1 1 auto" : undefined }}>
            {editingName ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <input
                  autoFocus
                  value={nameDraft}
                  maxLength={32}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveName();
                    else if (e.key === "Escape") setEditingName(false);
                  }}
                  placeholder="Squad name"
                  style={{
                    height: 32, width: isPhone ? 140 : 200, boxSizing: "border-box",
                    padding: "0 12px", borderRadius: 9,
                    background: "var(--overlay)", border: "1px solid var(--violet)",
                    color: textPrimary, fontFamily: "var(--font-display, var(--font-space-grotesk))",
                    fontSize: 14, fontWeight: 700, outline: "none",
                  }}
                />
                <button
                  onClick={saveName}
                  disabled={savingName}
                  title="Save name"
                  aria-label="Save name"
                  style={{
                    width: 30, height: 30, borderRadius: 8, border: "none", flexShrink: 0,
                    cursor: savingName ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--accent, var(--violet))", color: "#fff", fontSize: 14, fontWeight: 700, lineHeight: 1,
                  }}
                >✓</button>
                <button
                  onClick={() => setEditingName(false)}
                  title="Cancel"
                  aria-label="Cancel rename"
                  style={{
                    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                    cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--overlay)", border: "1px solid var(--border)",
                    color: textMuted, fontSize: 16, lineHeight: 1,
                  }}
                >×</button>
              </div>
            ) : (
              <>
                {isLeader && isPhone ? (
                  <button onClick={startRename} aria-label="Rename squad" style={{ maxWidth: "100%", padding: 0, border: 0, background: "transparent", fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 14, fontWeight: 700, color: textPrimary, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer" }}>
                    {squad.squadName}
                  </button>
                ) : (
                  <h1 style={{ maxWidth: "100%", fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 17, fontWeight: 700, color: textPrimary, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {squad.squadName}
                  </h1>
                )}
                {isLeader && !isPhone && (
                  <button
                    onClick={startRename}
                    onMouseEnter={() => setRenameHovered(true)}
                    onMouseLeave={() => setRenameHovered(false)}
                    title="Rename squad"
                    aria-label="Rename squad"
                    style={{
                      width: 32, height: 32, flexShrink: 0, padding: 0,
                      cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "transparent", border: "none",
                      transition: "all .15s ease",
                    }}
                  >
                    <Icon.edit size={16} color={renameHovered ? violet : textMuted} />
                  </button>
                )}
              </>
            )}
            <span style={{
              background: "var(--surface-2)", color: "var(--text)", border: "1px solid var(--border)",
              borderRadius: 999, padding: "2px 10px", fontFamily: "monospace",
              fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", flexShrink: 0,
            }}>{squad.squadCode}</span>
            {squadIsAdult && adultBadge}
          </div>

          {/* Vibe tags */}
          <div style={{ position: "relative", zIndex: 1, display: isPhone ? "none" : "flex", gap: 6, alignItems: "center", flex: 1, overflow: "hidden", minWidth: 0 }}>
            {currentTags.slice(0, 3).map(tag => (
              <span key={tag} style={{
                background: "var(--violet-soft)", color: violet, borderRadius: 999,
                padding: "3px 10px", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
              }}>{tag}</span>
            ))}
            {isLeader && !isNarrow && (
              <button
                onClick={() => { setVibeEditorOpen(true); setSelectedVibes(normalizeVibeLabels(currentTags)); }}
                onMouseEnter={() => setEditVibesHovered(true)}
                onMouseLeave={() => setEditVibesHovered(false)}
                title="Edit vibes"
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: editVibesHovered ? "var(--overlay-hover)" : "var(--overlay)",
                  border: "1.5px dashed var(--border-strong)",
                  borderRadius: 999, padding: "3px 10px", fontSize: 12, color: textMuted,
                  cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap",
                  transition: "all .15s ease",
                }}
              >
                <Icon.settings size={11} color={textMuted} />
                Edit vibes
              </button>
            )}
          </div>

          {/* Right actions */}
          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {/* Theme switcher — the shared TopNav is hidden on lobby/encounter, so
                surface the theme menu here too (keeps all themes reachable in-squad). */}
            <ThemeToggle size={isPhone ? 44 : 34} />
            {isLeader && !isNarrow && (
              <button
                onClick={() => setCoverPickerOpen(true)}
                onMouseEnter={() => setChangeCoverHovered(true)}
                onMouseLeave={() => setChangeCoverHovered(false)}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: changeCoverHovered ? "var(--overlay-hover)" : "var(--overlay)",
                  border: "1px solid var(--border)",
                  borderRadius: 999, minHeight: isPhone ? 44 : undefined, padding: isPhone ? "0 14px" : "5px 12px", fontSize: 12, color: textMuted,
                  cursor: "pointer", fontWeight: 500,
                  transition: "all .15s ease",
                }}
              >
                <Icon.settings size={11} color={textMuted} />
                Cover
              </button>
            )}
            <button
              onClick={() => {
                if (isPhone) { setChatOpen(o => !o); }
                else { setSidebarCollapsed(false); setSidebarTab("chat"); }
              }}
              onMouseEnter={() => setChatHovered(true)}
              onMouseLeave={() => setChatHovered(false)}
              title="Squad chat"
              aria-pressed={chatVisible}
              style={{
                position: "relative",
                display: "flex", alignItems: "center", gap: 4,
                minWidth: isPhone ? 44 : undefined,
                minHeight: isPhone ? 44 : undefined,
                padding: isPhone ? "0 14px" : "5px 12px", borderRadius: 999,
                background: chatVisible
                  ? "var(--violet-soft)"
                  : (chatHovered ? "var(--overlay-hover)" : "var(--overlay)"),
                border: `1px solid ${chatVisible ? "var(--accent, var(--violet))" : "var(--border)"}`,
                color: chatVisible ? violet : textMuted, fontSize: 12, fontWeight: 600,
                cursor: "pointer", transition: "all .15s ease",
              }}
            >
              <Icon.chat size={13} color={chatVisible ? violet : textMuted} />
              {isPhone ? "" : "Chat"}
              {unread > 0 && !chatVisible && (
                <span style={{
                  position: "absolute", top: -3, right: -3,
                  minWidth: 8, height: 8, borderRadius: 999,
                  background: "var(--coral)", border: "1.5px solid var(--surface)",
                }} />
              )}
            </button>
            {!isNarrow && <button
              onClick={handleInvite}
              onMouseEnter={() => setInviteHovered(true)}
              onMouseLeave={() => setInviteHovered(false)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                minHeight: isPhone ? 44 : undefined,
                padding: isPhone ? "0 14px" : "5px 12px", borderRadius: 999,
                background: inviteCopied ? "var(--lime)" : inviteHovered ? "var(--overlay-hover)" : "var(--overlay)",
                border: "1px solid var(--border)", color: inviteCopied ? "#0B0B0F" : textMuted, fontSize: 12, fontWeight: 600,
                cursor: "pointer", transition: "all .15s ease",
              }}
            >
              <Icon.plus size={12} color={inviteCopied ? "#0B0B0F" : textMuted} />
              {inviteCopied ? "Copied!" : "Invite"}
            </button>}
            <button
              onClick={() => { if (isLeader) setLeaveMenuOpen(true); else handleLeaveSquad(); }}
              disabled={leavingSquad}
              onMouseEnter={() => setLeaveHovered(true)}
              onMouseLeave={() => setLeaveHovered(false)}
              style={{
                minHeight: isPhone ? 44 : undefined,
                padding: isPhone ? "0 14px" : "5px 14px", borderRadius: 999,
                background: leaveHovered ? "rgba(255,92,92,0.15)" : "transparent",
                border: `1px solid var(--coral-border, rgba(255,92,92,0.27))`, color: coral, fontSize: 12, fontWeight: 700,
                cursor: "pointer", transition: "all .15s ease",
              }}
            >
              {leavingSquad ? "Leaving…" : "Leave"}
            </button>
          </div>
        </div>

        {/* ── MAIN AREA: stage + side panel ── */}
        <div style={{ display: "flex", flexDirection: isPhone ? "column" : "row" as const, flex: 1, minHeight: 0, overflow: isPhone ? "auto" : "hidden" }}>

          {/* ── VIDEO STAGE — themed canvas; only the tiles on it stay dark ── */}
          <div style={{
            flex: isPhone ? "0 0 auto" : 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            background: "var(--bg)",
            position: "relative",
            padding: isPhone ? "10px 10px 12px" : "24px 24px 16px",
            minHeight: isPhone ? 320 : 0,
            overflow: isPhone ? "auto" as const : "hidden" as const,
            gap: 0,
          }}>
            {/* STAGE BACKDROP — the squad's own cover, scrimmed hard so it reads
                as a subtle ambient "ready room" identity, never overpowering the
                tiles. Same cover-identity idea used in the encounter. */}
            <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none" }}>
              <div style={{
                position: "absolute", inset: 0,
                background: coverBg,
                backgroundSize: "cover", backgroundPosition: "center",
                opacity: 0.14,
              }} />
              {/* Vignette that fades the cover into the THEMED canvas (var(--bg))
                  so the ambient identity works in light + dark themes alike. */}
              <div style={{
                position: "absolute", inset: 0,
                background: "radial-gradient(ellipse at 50% 40%, transparent 0%, color-mix(in srgb, var(--bg) 62%, transparent) 55%, var(--bg) 100%)",
              }} />
            </div>
            {/* Video failure banner — non-blocking, dismissible. Chat/controls
                stay fully usable; the avatar fallback already covers tiles. */}
            {videoError && (
              <div style={{
                position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
                zIndex: 30, maxWidth: "calc(100% - 24px)",
                display: "flex", alignItems: "center", gap: 10,
                background: "var(--surface)",
                backgroundImage: "linear-gradient(var(--coral-soft), var(--coral-soft))",
                border: "1px solid color-mix(in srgb, var(--coral) 38%, transparent)",
                borderRadius: 12, padding: "9px 12px 9px 14px",
                boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
              }}>
                <span style={{
                  width: 7, height: 7, borderRadius: 999, background: coral, flexShrink: 0,
                }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--coral)", lineHeight: 1.4 }}>
                  {videoError}
                </span>
                <button
                  onClick={() => setVideoError(null)}
                  title="Dismiss"
                  aria-label="Dismiss"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: textMuted, fontSize: 16, lineHeight: 1, padding: "0 2px",
                    display: "flex", alignItems: "center",
                  }}
                >
                  ×
                </button>
              </div>
            )}
            {/* Poll-failure banner — shown after ≥2 consecutive fetch failures */}
            {connTrouble && !connTroubleDismissed && (
              <div role="status" style={{
                position: "absolute", top: videoError ? 64 : 12, left: "50%", transform: "translateX(-50%)",
                zIndex: 30, maxWidth: "calc(100% - 24px)",
                display: "flex", alignItems: "center", gap: 10,
                background: "var(--surface)",
                border: "1px solid color-mix(in srgb, var(--amber) 45%, transparent)",
                borderRadius: 12, padding: "9px 12px 9px 14px",
                boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
              }}>
                <span style={{
                  width: 7, height: 7, borderRadius: 999, background: "var(--amber)", flexShrink: 0,
                }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: textPrimary, lineHeight: 1.4 }}>
                  Connection trouble — retrying…
                </span>
                <button
                  onClick={() => setConnTroubleDismissed(true)}
                  title="Dismiss"
                  aria-label="Dismiss connection notice"
                  style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: textMuted, fontSize: 16, lineHeight: 1, padding: "0 2px",
                    display: "flex", alignItems: "center",
                  }}
                >
                  ×
                </button>
              </div>
            )}
            {/* Slim "ready room" hint — fills the otherwise-dead space above the
                tiles with intent while the single squad is still assembling. */}
            {canInvite && (
              <div style={{
                position: "relative", zIndex: 1, flexShrink: 0,
                display: "flex", alignItems: "center", gap: 8,
                marginBottom: 16,
                animation: "controlIn 0.4s ease 0.2s forwards", opacity: 0,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: 999, background: limeText,
                  boxShadow: `0 0 8px ${limeText}`,
                  animation: "readyGlow 2.5s ease-in-out infinite",
                }} />
                <span style={{
                  fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 13, fontWeight: 600,
                  letterSpacing: "0.04em",
                  // Themed shimmer so it reads on the themed canvas in every theme.
                  background: "linear-gradient(90deg, var(--text-muted) 0%, var(--text-muted) 38%, var(--text) 50%, var(--text-muted) 62%, var(--text-muted) 100%)",
                  backgroundSize: "220% auto",
                  WebkitBackgroundClip: "text", backgroundClip: "text",
                  WebkitTextFillColor: "transparent", color: "var(--text-muted)",
                  animation: "lobbyShimmer 2.8s linear infinite",
                }}>
                  Waiting for your squad…
                  <span style={{ color: textMuted, fontWeight: 500 }}>
                    {" "}{MAX_SLOTS - memberCount} of {MAX_SLOTS} {MAX_SLOTS - memberCount === 1 ? "spot" : "spots"} open
                  </span>
                </span>
              </div>
            )}
            {/* Tile grid — sizes to content (tiles derive height from width via
                aspect-ratio) and is centered in the stage. We must NOT stretch
                rows to the full stage height: a tall 1fr row + aspect-ratio tiles
                forces an enormous min-content width that collapses the columns.
                Capped tighter than the stage so the cluster reads as a tight
                group rather than a sprawling, half-empty call. */}
            <div style={{
              position: "relative",
              zIndex: 1,
              display: "grid",
              gridTemplateColumns: `repeat(${effCols}, minmax(0, 1fr))`,
              // Phone: auto rows + flexShrink:0 so tiles keep their aspect size and
              //   the stage SCROLLS (no row-collapse → no overlap).
              // Desktop: rows divide the stage HEIGHT (1fr) and the grid fills it
              //   (flex:1); tiles fill their cells so nothing overflows and the
              //   control bar below always stays on-screen.
              gridTemplateRows: `repeat(${effRows}, ${isPhone ? "auto" : "minmax(0, 1fr)"})`,
              ...(isPhone ? { flexShrink: 0 } : { flex: 1 }),
              gap: 16,
              width: "100%",
              maxWidth: effCols <= 1 ? 720 : effCols >= 4 ? 1320 : 1180,
              margin: "0 auto",
              minHeight: 0,
            }}>
              {squad.members.map((member, i) => {
                const isThisLeader = member.memberId === squad.leaderMemberId;
                const isMe = session.user?.id ? member.userId === session.user.id : i === 0;
                // Local user is always present; a remote member is offline ONLY
                // when online === false (true/undefined renders normally).
                const isOffline = !isMe && member.online === false;
                // Offline members are never shown with a live/ready accent.
                const isReady = member.ready && !isOffline;
                return (
                  <div
                    key={member.memberId}
                    style={{
                      position: "relative",
                      borderRadius: "var(--radius-tile, 16px)",
                      overflow: "hidden",
                      // Desktop fills the grid cell; phone uses a fixed aspect ratio.
                      ...(isPhone ? { aspectRatio: "4 / 3" } : { height: "100%" }),
                      background: "var(--stage-2, #2A2135)",
                      border: isReady
                        ? "2px solid color-mix(in srgb, var(--live, #A3E635) 40%, transparent)"
                        : "1px solid rgba(255,255,255,0.10)",
                      // delay baked into the shorthand — never mix `animation` with `animationDelay`
                      animation: isReady
                        ? `tileIn 0.35s ease ${i * 0.06}s forwards, readyGlow 2.5s ease-in-out ${i * 0.06}s infinite`
                        : `tileIn 0.35s ease ${i * 0.06}s forwards`,
                      opacity: 0,
                      boxSizing: "border-box",
                      width: "100%",
                      minWidth: 0,
                      minHeight: 0,
                      // OFFLINE state: dim the whole tile so it clearly reads as
                      // "not here right now" without disappearing. We use filter
                      // (not opacity) because the tileIn animation drives opacity
                      // 0→1 with `forwards`, which would override an inline opacity.
                      ...(isOffline ? { filter: "brightness(0.6)" } : null),
                    }}
                  >
                    {/* Avatar fallback — ALWAYS rendered underneath so the tile is
                        never an empty black box (e.g. camera off, denied, or not
                        yet joined). The live camera layer sits on top of it. */}
                    <div style={{
                      position: "absolute", inset: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      zIndex: 1,
                      // Flat --stage-2 tile (from the parent) — no cover/color
                      // gradients behind the avatar; clean and even in all themes.
                      // Desaturate the avatar/backdrop for offline members.
                      ...(isOffline ? { filter: "grayscale(0.85)" } : null),
                    }}>
                      {isMe
                        ? <AvatarArt value={myAvatar} size={72} />
                        : <Avatar name={member.displayName} size={72} colorIndex={i} />}
                    </div>

                    {/* Local camera — transparent layer Agora injects video into;
                        only opaque-covers the avatar once actually streaming. */}
                    {isMe && (
                      <div
                        ref={localVideoRef}
                        style={{
                          position: "absolute", inset: 0,
                          background: "transparent",
                          opacity: camOn && videoJoined ? 1 : 0,
                          transition: "opacity .25s",
                          zIndex: 2,
                        }}
                      />
                    )}

                    {/* LEAD badge */}
                    {isThisLeader && (
                      <span style={{
                        position: "absolute", top: 10, left: 10, zIndex: 4,
                        background: "rgba(11,11,15,0.6)", backdropFilter: "blur(4px)",
                        border: "1px solid rgba(255,255,255,0.18)",
                        color: "#F4F3F7",
                        fontSize: 12, fontWeight: 700, borderRadius: 6,
                        padding: "2px 7px", letterSpacing: "0.08em",
                      }}>LEAD</span>
                    )}

                    {/* Bottom overlay: name + status icons */}
                    <div style={{
                      position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 5,
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "20px 10px 10px",
                      background: "linear-gradient(transparent, rgba(0,0,0,0.72))",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{
                          background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
                          borderRadius: 6, padding: "3px 8px",
                          fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 12, fontWeight: 600,
                          color: "#F4F4F7",
                          maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {member.displayName}{isMe ? " (You)" : ""}
                        </span>
                        {!isNarrow && isOffline && (
                          <Badge tone="full" style={{ borderRadius: 999 }}>OFFLINE</Badge>
                        )}
                        {!isNarrow && isReady && (
                          <Badge tone="live" style={{ borderRadius: 999 }}>READY</Badge>
                        )}
                        {!isNarrow && !isReady && !isOffline && (
                          <Badge tone="full" style={{ borderRadius: 999 }}>NOT READY</Badge>
                        )}
                      </div>
                      <div style={{ display: isNarrow ? "none" : "flex", gap: 4 }}>
                        {isMe ? (
                          /* Local user — real interactive mic/cam toggles, but
                             only once lobby media is actually connected. Before
                             that they'd show a fake "on" state and error on tap;
                             the control bar's "Enable camera & mic" is the path. */
                          !videoJoined ? null :
                          <>
                            {(() => {
                              const common: React.CSSProperties = {
                                width: 44, height: 44, borderRadius: "var(--radius-control, 14px)", border: "none", padding: 0,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                /* Neutral glass when on, coral when off — green is reserved for READY. */
                                background: micOn ? "rgba(255,255,255,0.14)" : "color-mix(in srgb, var(--coral) 70%, transparent)",
                                boxShadow: micOn ? "inset 0 0 0 1px rgba(255,255,255,0.18)" : "none",
                              };
                              return (
                                <button onClick={toggleMic} title={micOn ? "Mute mic" : "Unmute mic"}
                                  aria-label={micOn ? "Mute mic" : "Unmute mic"} aria-pressed={micOn}
                                  style={{ ...common, cursor: "pointer", transition: "transform .12s ease" }}
                                  onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.9)")}
                                  onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
                                  onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                                ><Icon.mic size={16} color="#fff" /></button>
                              );
                            })()}
                            {(() => {
                              const common: React.CSSProperties = {
                                width: 44, height: 44, borderRadius: "var(--radius-control, 14px)", border: "none", padding: 0,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                background: camOn ? "rgba(255,255,255,0.14)" : "color-mix(in srgb, var(--coral) 70%, transparent)",
                                boxShadow: camOn ? "inset 0 0 0 1px rgba(255,255,255,0.18)" : "none",
                              };
                              return (
                                <button onClick={toggleCam} title={camOn ? "Turn off camera" : "Turn on camera"}
                                  aria-label={camOn ? "Turn off camera" : "Turn on camera"} aria-pressed={camOn}
                                  style={{ ...common, cursor: "pointer", transition: "transform .12s ease" }}
                                  onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.9)")}
                                  onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
                                  onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                                ><Icon.cam size={16} color="#fff" /></button>
                              );
                            })()}
                          </>
                        ) : (
                          /* Remote members: the backend only tells us whether
                             they're in lobby video — show ONE honest "in call"
                             indicator instead of two fake mic+cam icons. */
                          <span
                            title={member.inLobbyVideo ? "In lobby video" : "Not in lobby video"}
                            aria-label={member.inLobbyVideo ? "In lobby video" : "Not in lobby video"}
                            style={{
                              width: 44, height: 44, borderRadius: "var(--radius-control, 14px)", border: "none", padding: 0,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              background: member.inLobbyVideo ? "rgba(124,92,255,0.6)" : "rgba(255,255,255,0.10)",
                            }}
                          >
                            <Icon.cam size={16} color={member.inLobbyVideo ? "#fff" : "#9A9AB0"} />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Single "invite a friend" affordance (hidden once squad is full) */}
              {showInviteTile && (
                <div
                  onClick={handleInvite}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleInvite(); }}
                  onMouseEnter={() => setInviteTileHovered(true)}
                  onMouseLeave={() => setInviteTileHovered(false)}
                  style={{
                    borderRadius: "var(--radius-tile, 16px)",
                    // Placeholder is a dark "screen" like the video tiles in every theme.
                    border: `1.5px dashed ${inviteTileHovered ? "var(--accent, var(--violet))" : "rgba(255,255,255,0.12)"}`,
                    background: inviteTileHovered ? "color-mix(in srgb, var(--accent, var(--violet)) 24%, var(--stage-2, #2A2135))" : "var(--stage-2, #2A2135)",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
                    boxSizing: "border-box",
                    width: "100%",
                    minWidth: 0,
                    minHeight: 0,
                    cursor: "pointer",
                    ...(isPhone ? { aspectRatio: "4 / 3" } : { height: "100%" }),
                    transition: "all .15s ease",
                    animation: `tileIn 0.35s ease ${memberCount * 0.06}s forwards`,
                  }}
                >
                  <Icon.plus size={22} color={inviteTileHovered ? "var(--accent, var(--violet))" : "#9A9AB0"} />
                  <div style={{ fontSize: 13, fontWeight: 600, color: inviteTileHovered ? "var(--accent, var(--violet))" : "#9A9AB0" }}>Invite a friend</div>
                  <div style={{ fontSize: 12, color: "#7B7B90" }}>{MAX_SLOTS - memberCount} {MAX_SLOTS - memberCount === 1 ? "spot" : "spots"} open</div>
                </div>
              )}

            </div>

            {/* ── CONTROL BAR (centered floating pill) ── */}
            <div data-testid="lobby-readiness" style={{
              display: "flex", alignItems: "center", justifyContent: "center" as const, gap: 10,
              background: "var(--surface)",
              backdropFilter: "blur(16px)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-card, 20px)",
              padding: isPhone ? "8px 10px" : "10px 16px",
              marginTop: isPhone ? 0 : 32,
              animation: "controlIn 0.4s ease 0.3s forwards",
              opacity: 0,
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              flexShrink: 0,
              flexWrap: "wrap" as const,
              position: "relative" as const,
              bottom: undefined,
              left: undefined,
              transform: undefined,
              maxWidth: isPhone ? "calc(100vw - 20px)" : undefined,
              zIndex: 1,
            }}>
              {videoJoined ? (
                <>
                  <button
                    onClick={toggleMic}
                    onMouseEnter={() => setMicHovered(true)}
                    onMouseLeave={() => setMicHovered(false)}
                    title={micOn ? "Mute microphone" : "Unmute microphone"}
                    aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
                    aria-pressed={micOn}
                    className="gg-press"
                    style={{
                      width: isPhone ? 44 : 50, height: isPhone ? 44 : 50, borderRadius: "var(--radius-control, 14px)", border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      /* On = themed neutral, off = coral. Green stays reserved for READY. */
                      background: micOn
                        ? (micHovered ? "var(--overlay-hover)" : "var(--surface-2)")
                        : (micHovered ? "color-mix(in srgb, var(--coral) 90%, transparent)" : "var(--coral)"),
                      boxShadow: micOn ? "inset 0 0 0 1px var(--border-strong)" : "none",
                      transition: "all .15s ease",
                      transform: micHovered ? "scale(1.08)" : "scale(1)",
                    }}
                  >
                    <Icon.mic size={20} color={micOn ? "var(--text)" : "#fff"} />
                  </button>
                  <button
                    onClick={toggleCam}
                    onMouseEnter={() => setCamHovered(true)}
                    onMouseLeave={() => setCamHovered(false)}
                    title={camOn ? "Turn off camera" : "Turn on camera"}
                    aria-label={camOn ? "Turn off camera" : "Turn on camera"}
                    aria-pressed={camOn}
                    className="gg-press"
                    style={{
                      width: isPhone ? 44 : 50, height: isPhone ? 44 : 50, borderRadius: "var(--radius-control, 14px)", border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: camOn
                        ? (camHovered ? "var(--overlay-hover)" : "var(--surface-2)")
                        : (camHovered ? "color-mix(in srgb, var(--coral) 90%, transparent)" : "var(--coral)"),
                      boxShadow: camOn ? "inset 0 0 0 1px var(--border-strong)" : "none",
                      transition: "all .15s ease",
                      transform: camHovered ? "scale(1.08)" : "scale(1)",
                    }}
                  >
                    <Icon.cam size={20} color={camOn ? "var(--text)" : "#fff"} />
                  </button>
                  <div style={{ width: 1, height: 28, background: "var(--border)", margin: "0 2px" }} />
                </>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flex: isPhone ? "1 0 100%" : undefined }}>
                  <span style={{ maxWidth: 150, color: textMuted, fontSize: 12, lineHeight: 1.25 }}>
                    Used in this lobby and live encounters.
                  </span>
                  <Button
                    onClick={enableLobbyMedia}
                    loading={videoJoining}
                    variant="secondary"
                    aria-label="Enable camera and microphone"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {!videoJoining && <Icon.cam size={17} color="var(--accent, var(--violet))" />}
                    {videoJoining ? "Enabling…" : "Enable camera & mic"}
                  </Button>
                </div>
              )}

              {/* Ready toggle */}
              <button
                onClick={handleReady}
                disabled={settingReady}
                onMouseEnter={() => setReadyHovered(true)}
                onMouseLeave={() => setReadyHovered(false)}
                title="Toggle ready"
                aria-pressed={myReady}
                className="gg-press"
                style={{
                  height: isPhone ? 44 : 50, borderRadius: "var(--radius-btn, 999px)", border: "none", cursor: "pointer",
                  padding: "0 20px",
                  display: "flex", alignItems: "center", gap: 7,
                  // v3 tonal button; filled --live when ready — an unambiguous "on" state.
                  background: myReady
                    ? "var(--live, var(--lime))"
                    : readyHovered ? "var(--accent-line)" : "var(--accent-soft)",
                  color: myReady ? "var(--live-contrast, #0B0B12)" : "var(--accent, var(--violet))",
                  fontWeight: 600, fontSize: 14,
                  transition: "all .15s ease",
                  transform: readyHovered ? "scale(1.04)" : "scale(1)",
                  minWidth: 110,
                  whiteSpace: "nowrap" as const,
                  boxShadow: myReady ? "0 0 20px -6px var(--live, var(--lime))" : "none",
                }}
              >
                {settingReady ? "…" : myReady ? "✓ Ready" : "Mark ready"}
              </button>

              {/* Find a Match (leader only) */}
              {isLeader && (
                <>
                  {!isPhone && <div style={{ width: 1, height: 28, background: "var(--border)", margin: "0 2px" }} />}
                  <Button
                    onClick={handleFindMatch}
                    disabled={!allReady}
                    loading={findingMatch}
                    variant="primary"
                    aria-label="Find a Match"
                    style={{
                      height: isPhone ? 44 : 50,
                      minWidth: isPhone ? 0 : 162,
                      flex: isPhone ? "1 0 100%" : undefined,
                    }}
                  >
                    {!findingMatch && <Icon.discover size={18} color="var(--on-accent, #fff)" />}
                    {findingMatch ? "Starting…" : allReady ? "Find a Match" : "Waiting for everyone"}
                  </Button>
                </>
              )}
            </div>
            {/* Why Find-a-Match is disabled — names of who we're waiting on */}
            {isLeader && !allReady && onlineMembers.length > 0 && (
              <div role="status" aria-live="polite" style={{
                alignSelf: "center",
                marginTop: 8,
                maxWidth: isPhone ? "calc(100vw - 28px)" : 520,
                fontSize: 12,
                color: textMuted,
                textAlign: "center" as const,
                lineHeight: 1.4,
                position: "relative" as const,
                zIndex: 1,
              }}>
                {onlineReadyCount} of {onlineMembers.length} ready{notReadyNames.length > 0 ? ` — waiting on ${notReadyLabel}` : ""}
              </div>
            )}
            {matchError && (
              <div role="alert" className="gg-toast" style={{
                alignSelf: "center",
                marginTop: 10,
                maxWidth: isPhone ? "calc(100vw - 28px)" : 520,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 12px",
                borderRadius: 999,
                background: "var(--coral-soft)",
                border: "1px solid color-mix(in srgb, var(--coral) 38%, transparent)",
                color: "var(--coral)",
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.25,
              }}>
                <Icon.flag size={14} color="var(--coral)" />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{matchError}</span>
                <button onClick={() => setMatchError(null)} aria-label="Dismiss match error" style={{ border: "none", background: "transparent", color: "var(--coral)", cursor: "pointer", display: "flex", padding: 0 }}>
                  <Icon.close size={14} color="var(--coral)" />
                </button>
              </div>
            )}
          </div>

          {/* ── RIGHT SIDE PANEL ── */}
          {isPhone ? (
            /* PHONE: docked sheet (unchanged behavior) — info + invite, chat gated by toggle. */
            <div style={{
              width: "100%",
              flexShrink: 0,
              maxHeight: "45vh",
              display: "flex",
              flexDirection: "column",
              background: "var(--surface)",
              borderTop: `1px solid ${ON_STAGE_HAIRLINE}`,
              margin: 0,
              overflowY: "auto",
              padding: "12px 10px 20px",
              gap: 12,
            } as React.CSSProperties}>
              {infoPanel}
              {chatOpen && (
                <div style={{
                  background: "var(--surface)",
                  border: `1px solid ${ON_STAGE_HAIRLINE}`,
                  borderRadius: 16,
                  overflow: "hidden",
                  display: "flex", flexDirection: "column",
                  minHeight: 240,
                  height: 300,
                }}>
                  {chatSurface}
                </div>
              )}
            </div>
          ) : (
            /* DESKTOP: collapsible panel. The width transition lets the video stage
               (flex:1) reclaim freed space smoothly. */
            <div style={{
              width: sidebarCollapsed ? 64 : 304,
              flexShrink: 0,
              transition: "width 0.22s ease",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            } as React.CSSProperties}>

              {sidebarCollapsed ? (
                /* ── COLLAPSED: slim glassy info RAIL ── */
                <div style={{
                  width: "100%", boxSizing: "border-box", flex: 1,
                  margin: "4px 0 12px 0",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                  padding: "12px 0",
                  background: "var(--surface)",
                  border: `1px solid ${ON_STAGE_HAIRLINE}`,
                  borderRadius: 18,
                  backdropFilter: "blur(12px)",
                  boxShadow: "0 8px 32px -12px rgba(0,0,0,0.45)",
                }}>
                  {/* Member count pill */}
                  <div title={`${memberCount} of ${MAX_SLOTS} in squad`} style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                  }}>
                    <div style={{
                      minWidth: 38, padding: "5px 0", borderRadius: 999, textAlign: "center" as const,
                      background: "var(--violet-soft)", border: "1px solid var(--violet)",
                      color: violet, fontSize: 12, fontWeight: 700, fontFamily: "var(--font-display, var(--font-space-grotesk))",
                    }}>{memberCount}/{MAX_SLOTS}</div>
                  </div>

                  {/* Ready status dot */}
                  <div title={allReady ? "Everyone ready" : `${readyCount} of ${memberCount} ready`} style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                  }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: 999,
                      background: allReady ? "var(--lime)" : "var(--overlay)",
                      border: `1.5px solid ${allReady ? "var(--lime)" : "var(--border-strong)"}`,
                      boxShadow: allReady ? "0 0 10px var(--lime)" : "none",
                    }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: allReady ? limeText : textTertiary }}>{readyCount}/{memberCount}</span>
                  </div>

                  <div style={{ width: 28, height: 1, background: "var(--border)" }} />

                  {/* Copy invite code */}
                  <button
                    onClick={() => void copyToClipboard(
                      squad.squadCode,
                      () => {
                        setCodeCopied(true);
                        setTimeout(() => setCodeCopied(false), 1800);
                      },
                      "Couldn't copy squad code. Select the code and copy it manually.",
                    )}
                    onMouseEnter={() => setRailHover("copy")}
                    onMouseLeave={() => setRailHover(null)}
                    title={codeCopied ? "Copied!" : `Copy code ${squad.squadCode}`}
                    style={{
                      width: 40, height: 40, borderRadius: 12, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: codeCopied ? "var(--lime)" : railHover === "copy" ? "var(--overlay-hover)" : "var(--overlay)",
                      border: `1px solid ${codeCopied ? "var(--lime)" : "var(--border)"}`,
                      transition: "all .15s ease",
                    }}
                  >
                    {codeCopied
                      ? <span style={{ color: "#0B0B0F", fontSize: 16, fontWeight: 700, lineHeight: 1 }}>✓</span>
                      : <Icon.copy size={16} color={textMuted} />}
                  </button>

                  {/* Chat (expands to chat tab) with unread dot */}
                  <button
                    onClick={() => { setSidebarCollapsed(false); setSidebarTab("chat"); }}
                    onMouseEnter={() => setRailHover("chat")}
                    onMouseLeave={() => setRailHover(null)}
                    title="Squad chat"
                    style={{
                      position: "relative",
                      width: 40, height: 40, borderRadius: 12, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: railHover === "chat" ? "var(--overlay-hover)" : "var(--overlay)",
                      border: "1px solid var(--border)",
                      transition: "all .15s ease",
                    }}
                  >
                    <Icon.chat size={16} color={textMuted} />
                    {unread > 0 && (
                      <span style={{
                        position: "absolute", top: -3, right: -3,
                        minWidth: 18, height: 18, padding: "0 4px", borderRadius: 999,
                        background: "var(--coral)", color: "#fff",
                        fontSize: 12, fontWeight: 700, lineHeight: "18px", textAlign: "center" as const,
                        border: "1.5px solid var(--surface)",
                      }}>{unread > 9 ? "9+" : unread}</span>
                    )}
                  </button>

                  <div style={{ flex: 1 }} />

                  {/* Expand chevron */}
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    onMouseEnter={() => setRailHover("expand")}
                    onMouseLeave={() => setRailHover(null)}
                    title="Expand panel"
                    style={{
                      width: 40, height: 40, borderRadius: 12, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: railHover === "expand" ? "var(--overlay-hover)" : "var(--overlay)",
                      border: "1px solid var(--border)",
                      transition: "all .15s ease",
                    }}
                  >
                    {/* points left = "open out" */}
                    <span style={{ display: "flex", transform: "rotate(180deg)" }}>
                      <Icon.chevron size={16} color={textMuted} />
                    </span>
                  </button>
                </div>
              ) : (
                /* ── EXPANDED: header (tabs + collapse) then Info or Chat ── */
                <div style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "4px 12px 12px 4px",
                  display: "flex", flexDirection: "column", minHeight: 0, gap: 10,
                  flex: 1,
                }}>
                  {/* Top bar: segmented Info/Chat control + collapse chevron */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <div style={{
                      flex: 1, display: "flex", background: "var(--overlay)",
                      border: "1px solid var(--border)", borderRadius: 999, padding: 3, gap: 2,
                    }}>
                      {(["info", "chat"] as const).map(tab => {
                        const active = sidebarTab === tab;
                        return (
                          <button key={tab} onClick={() => setSidebarTab(tab)} style={{
                            position: "relative",
                            flex: 1, padding: "6px 0", borderRadius: 999, border: "none", cursor: "pointer",
                            background: active ? "var(--accent, var(--violet))" : "transparent",
                            color: active ? "#fff" : textMuted,
                            fontSize: 12, fontWeight: 700, fontFamily: "var(--font-display, var(--font-space-grotesk))",
                            transition: "all .15s ease",
                          }}>
                            {tab === "info" ? "Info" : "Chat"}
                            {tab === "chat" && unread > 0 && !active && (
                              <span style={{
                                position: "absolute", top: 4, right: 14,
                                width: 7, height: 7, borderRadius: 999, background: "var(--coral)",
                              }} />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={() => setSidebarCollapsed(true)}
                      onMouseEnter={() => setRailHover("collapse")}
                      onMouseLeave={() => setRailHover(null)}
                      title="Collapse panel"
                      style={{
                        width: 34, height: 34, borderRadius: 10, cursor: "pointer", flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: railHover === "collapse" ? "var(--overlay-hover)" : "var(--overlay)",
                        border: "1px solid var(--border)",
                        transition: "all .15s ease",
                      }}
                    >
                      {/* points right = "close in" */}
                      <Icon.chevron size={16} color={textMuted} />
                    </button>
                  </div>

                  {sidebarTab === "info" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", minHeight: 0, flex: 1, paddingRight: 2 }}>
                      {infoPanel}
                    </div>
                  ) : (
                    <div style={{
                      flex: 1, minHeight: 0,
                      background: "var(--surface)",
                      border: `1px solid ${ON_STAGE_HAIRLINE}`,
                      borderRadius: 16,
                      overflow: "hidden",
                      display: "flex", flexDirection: "column",
                    }}>
                      {chatSurface}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── MODALS ── */}
      {leaveMenuOpen && (
        <Modal
          onClose={() => { if (!leavingSquad) setLeaveMenuOpen(false); }}
          title="Leave this squad?"
          ariaLabel="Leave or delete squad"
          width={400}
        >
          <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.5 }}>
            You lead this squad. You can hand it off and leave, or delete it entirely.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Button variant="secondary" fullWidth disabled={leavingSquad} onClick={handleLeaveSquad}>
              Leave &amp; hand off to another member
            </Button>
            <Button variant="danger" fullWidth loading={leavingSquad} onClick={handleDisbandSquad}>
              Delete squad for everyone
            </Button>
            <Button variant="ghost" fullWidth disabled={leavingSquad} onClick={() => setLeaveMenuOpen(false)}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
      {noCamConfirmOpen && (
        <Modal
          onClose={() => { if (!noCamEnabling) setNoCamConfirmOpen(false); }}
          title="Your camera is off"
          subtitle="Others won't see you in the encounter."
          ariaLabel="Camera is off confirmation"
          width={400}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {videoError && (
              <div role="alert" style={{
                fontSize: 13,
                lineHeight: 1.4,
                color: "var(--danger)",
                background: "var(--danger-soft, rgba(255,90,90,0.12))",
                border: "1px solid var(--danger)",
                borderRadius: 10,
                padding: "8px 10px",
              }}>
                {videoError}
              </div>
            )}
            <Button
              fullWidth
              loading={noCamEnabling || findingMatch}
              onClick={async () => {
                setNoCamEnabling(true);
                let ok = false;
                try {
                  ok = await enableLobbyMedia();
                } finally {
                  setNoCamEnabling(false);
                }
                // Camera failed to enable — keep the modal open so the user
                // sees the error and can retry or explicitly continue without.
                if (!ok) return;
                setNoCamConfirmOpen(false);
                await proceedFindMatch();
              }}
            >
              Enable camera
            </Button>
            <Button
              fullWidth
              variant="ghost"
              disabled={noCamEnabling}
              onClick={async () => {
                setNoCamConfirmOpen(false);
                await proceedFindMatch();
              }}
            >
              Continue without camera
            </Button>
          </div>
        </Modal>
      )}

      {invitePeopleOpen && (
        <InviteToSquad
          squadId={squad.squadId}
          squadName={squad.squadName}
          onClose={() => setInvitePeopleOpen(false)}
        />
      )}

      {coverPickerOpen && (
        <CoverPicker
          squadId={squadId}
          currentCover={squad.coverImage}
          onClose={() => setCoverPickerOpen(false)}
          onSaved={async () => { await fetchSquad(); setCoverPickerOpen(false); }}
        />
      )}

      {vibeEditorOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={e => { if (e.target === e.currentTarget) setVibeEditorOpen(false); }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 24, padding: "32px 28px", width: isPhone ? "calc(100vw - 32px)" : 440, display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 18, fontWeight: 700, color: textPrimary }}>Edit Squad Vibes</div>
              <button onClick={() => setVibeEditorOpen(false)} style={{ background: "none", border: "none", color: textMuted, cursor: "pointer", fontSize: 20, lineHeight: 1 }}>
                <Icon.close size={18} color={textMuted} />
              </button>
            </div>
            <div style={{ color: textMuted, fontSize: 13 }}>Pick up to {MAX_VIBES} vibes — search the list or create your own.</div>

            {/* Search / create box */}
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <Icon.discover size={16} color={textTertiary} />
              </span>
              <input
                value={vibeSearch}
                onChange={(e) => setVibeSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && vibeSearch.trim()) addCustomVibe(vibeSearch); }}
                placeholder="Search or create a vibe…"
                maxLength={24}
                style={{
                  width: "100%", boxSizing: "border-box", height: 42,
                  padding: "0 14px 0 38px", borderRadius: 12,
                  background: "var(--overlay)", border: "1px solid var(--border)",
                  color: textPrimary, fontSize: 14, fontFamily: "var(--font-inter)", outline: "none",
                }}
              />
            </div>

            {/* Moderation: blocked-vibe warning */}
            {vibeWarning && (
              <div role="alert" style={{
                display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 12px", borderRadius: 10,
                background: "var(--coral-soft, rgba(229,72,77,0.12))", border: "1px solid color-mix(in srgb, var(--coral) 40%, transparent)",
                color: "var(--coral)", fontSize: 13, lineHeight: 1.4,
              }}>
                {vibeWarning}
              </div>
            )}

            {/* Moderation: minors can't create adult rooms (trusts signup DOB). */}
            {matureBlocked && (
              <div role="alert" aria-label="Adults only" style={{
                display: "flex", flexDirection: "column", gap: 8, padding: "14px 14px", borderRadius: 12,
                background: "var(--coral-soft, rgba(255,92,92,0.12))", border: "1px solid color-mix(in srgb, var(--coral, #FF5C5C) 45%, transparent)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: textPrimary }}>
                  <span aria-hidden style={{ fontSize: 16 }}>🔞</span> Adults only — you must be 18+ to add this vibe
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: textMuted }}>
                  <b style={{ color: textPrimary }}>“{matureBlocked}”</b> would make this an adult squad. Your account isn&apos;t marked 18+, so you can&apos;t add it.
                </div>
                <button
                  onClick={() => setMatureBlocked(null)}
                  style={{ alignSelf: "flex-start", minHeight: 36, padding: "0 14px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: textMuted, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  Got it
                </button>
              </div>
            )}

            {/* Moderation: 18+ age gate for adult vibes */}
            {pendingMatureVibe && (
              <div role="alertdialog" aria-label="Adult vibe confirmation" style={{
                display: "flex", flexDirection: "column", gap: 10, padding: "14px 14px", borderRadius: 12,
                background: "var(--amber-soft, rgba(245,158,11,0.12))", border: "1px solid color-mix(in srgb, var(--amber, #F59E0B) 45%, transparent)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: textPrimary }}>
                  <span aria-hidden style={{ fontSize: 16 }}>🔞</span> Adults only (18+)
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: textMuted }}>
                  Adding <b style={{ color: textPrimary }}>“{pendingMatureVibe}”</b> makes this an adult squad — it’ll only be matched with other squads whose members have confirmed they’re 18+. Keep it consensual and follow the community rules.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => { const v = pendingMatureVibe; setPendingMatureVibe(null); if (v) commitVibe(v); }}
                    className="gg-press"
                    style={{ flex: 1, minHeight: 40, borderRadius: 10, border: "none", background: "var(--accent, var(--violet))", color: "var(--on-accent, #fff)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
                  >
                    Add it
                  </button>
                  <button
                    onClick={() => setPendingMatureVibe(null)}
                    style={{ flex: 1, minHeight: 40, borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: textMuted, fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {(() => {
              const q = vibeSearch.trim().toLowerCase();
              const all = Array.from(new Set([...selectedVibes, ...customVibes, ...CURATED_VIBES]));
              const filtered = q ? all.filter(v => v.toLowerCase().includes(q)) : all;
              const exact = all.some(v => v.toLowerCase() === q);
              const canCreate = q.length > 0 && !exact && selectedVibes.length < MAX_VIBES && !pendingMatureVibe && !matureBlocked && !vibeWarning;
              return (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 200, overflowY: "auto" }}>
                  {canCreate && (
                    <button
                      onClick={() => addCustomVibe(vibeSearch)}
                      style={{
                        borderRadius: 999, padding: "7px 14px", fontSize: 14, fontWeight: 600,
                        cursor: "pointer", border: "1.5px dashed var(--violet)",
                        background: "var(--violet-soft)", color: violet,
                        display: "inline-flex", alignItems: "center", gap: 6,
                      }}
                    >
                      <Icon.plus size={13} color={violet} /> Create “{vibeSearch.trim()}”
                    </button>
                  )}
                  {filtered.map(vibe => {
                    const active = selectedVibes.some(v => v.toLowerCase() === vibe.toLowerCase());
                    const hovered = vibeChipHovered === vibe;
                    return (
                      <button
                        key={vibe}
                        onClick={() => toggleVibeChip(vibe)}
                        onMouseEnter={() => setVibeChipHovered(vibe)}
                        onMouseLeave={() => setVibeChipHovered(null)}
                        disabled={!active && selectedVibes.length >= MAX_VIBES}
                        style={{
                          borderRadius: 999, padding: "7px 16px", fontSize: 14, fontWeight: 500,
                          cursor: active || selectedVibes.length < MAX_VIBES ? "pointer" : "not-allowed",
                          border: `1.5px solid ${active ? "var(--accent, var(--violet))" : "var(--border-strong)"}`,
                          background: active ? "var(--violet-soft)" : "var(--overlay)",
                          color: active ? violet : textMuted,
                          transition: "all 0.15s",
                          filter: hovered ? "brightness(1.15)" : "none",
                        }}
                      >
                        {vibe}
                      </button>
                    );
                  })}
                  {filtered.length === 0 && !canCreate && (
                    <span style={{ color: textTertiary, fontSize: 13, padding: "6px 2px" }}>No vibes match — type to create one.</span>
                  )}
                </div>
              );
            })()}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ color: textTertiary, fontSize: 12 }}>{selectedVibes.length}/{MAX_VIBES} selected</span>
              <div style={{ display: "flex", gap: 10 }}>
                <Button onClick={() => setVibeEditorOpen(false)} variant="ghost">Cancel</Button>
                <Button onClick={saveVibes} loading={savingVibes} variant="primary" style={{ minWidth: 120 }}>
                  {savingVibes ? "Saving…" : "Save Vibes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function LobbyPage() {
  return (
    <Suspense fallback={<div style={{ color: "var(--text-muted)", padding: 40 }}>Loading…</div>}>
      <LobbyInner />
    </Suspense>
  );
}
