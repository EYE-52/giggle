"use client";
import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { AvatarArt } from "@/components/AvatarArt";
import { Icon } from "@/components/Icons";
import { ChatPanel } from "@/components/ChatPanel";
import { CoverPicker } from "@/components/CoverPicker";
import { InviteToSquad } from "@/components/InviteToSquad";
import { api, connectSocket, SOCKET_EVENTS, session, resolveCover, getMyAvatar, subscribeAvatar, subscribeChat, joinChat, billing, DEFAULT_AVATAR_ID } from "@giggle/core";
import type { SquadState, JoinRequestUser } from "@giggle/core";
import { createVideoClient } from "@giggle/agora";
import { useViewport } from "@/components/useViewport";

const avatarColors = ["#7C5CFF", "#3DD6C0", "#FF8A5C", "#C2FF3D"];

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

// Deterministic tasteful gradient fallback for squads with no cover set — gives
// each one a distinct identity even before a cover is chosen. Same palette family
// as SquadPreview so the two surfaces read as one visual system.
const FALLBACK_GRADIENTS = [
  "radial-gradient(120% 90% at 20% 10%, rgba(255,92,138,0.55), transparent 55%), radial-gradient(120% 90% at 90% 80%, rgba(124,92,255,0.6), transparent 55%), linear-gradient(160deg, #2a1140, #0b0b0f)",
  "radial-gradient(120% 90% at 80% 10%, rgba(92,140,255,0.5), transparent 55%), radial-gradient(120% 90% at 10% 90%, rgba(61,214,192,0.45), transparent 55%), linear-gradient(160deg, #10243a, #0b0b0f)",
  "radial-gradient(120% 90% at 30% 20%, rgba(194,255,61,0.4), transparent 55%), radial-gradient(120% 90% at 80% 90%, rgba(124,92,255,0.55), transparent 55%), linear-gradient(160deg, #1a2a12, #0b0b0f)",
  "radial-gradient(120% 90% at 70% 15%, rgba(255,176,32,0.45), transparent 55%), radial-gradient(120% 90% at 15% 85%, rgba(255,92,138,0.5), transparent 55%), linear-gradient(160deg, #2e1a10, #0b0b0f)",
];
function fallbackGradient(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return FALLBACK_GRADIENTS[h % FALLBACK_GRADIENTS.length];
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
   Tactile press feedback for every control. Scoped to the dark calling root
   so we never leak into other surfaces. Press uses !important to beat inline
   hover transforms; cubic-bezier easing for a satisfying spring-out. */
[data-theme="dark"] button:not(:disabled) {
  -webkit-tap-highlight-color: transparent;
  transition: transform .14s cubic-bezier(.22,1,.36,1), box-shadow .2s cubic-bezier(.4,0,.2,1), background .2s cubic-bezier(.4,0,.2,1), color .2s cubic-bezier(.4,0,.2,1), border-color .2s cubic-bezier(.4,0,.2,1), filter .2s cubic-bezier(.4,0,.2,1);
}
[data-theme="dark"] button:not(:disabled):active {
  transform: scale(.94) !important;
  transition-duration: .06s;
}
[data-theme="dark"] button:disabled {
  cursor: not-allowed;
}
[data-theme="dark"] button:focus-visible,
[data-theme="dark"] [role="button"]:focus-visible,
[data-theme="dark"] input:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px #0B0B0F, 0 0 0 4px var(--violet, #7C5CFF);
}
[data-theme="dark"] [role="button"] { -webkit-tap-highlight-color: transparent; }
[data-theme="dark"] [role="button"]:active { transform: scale(.97); }
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
  [data-theme="dark"] button:not(:disabled):active,
  [data-theme="dark"] [role="button"]:active { transform: none !important; }
}
`;

function LobbyInner() {
  const { isPhone, isNarrow } = useViewport();
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
  const [leavingSquad, setLeavingSquad] = useState(false);

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
  const [isPremium, setIsPremium] = useState(false);
  const [upgradeTileHovered, setUpgradeTileHovered] = useState(false);
  useEffect(() => {
    const check = () => setIsPremium(billing.isPremium());
    check();
    return billing.subscribe(check);
  }, []);

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
  function addCustomVibe(raw: string) {
    const v = raw.trim().replace(/\s+/g, " ");
    if (!v || v.length > 24) return;
    const lower = v.toLowerCase();
    // Already selected? no-op. Otherwise add (respecting the per-squad cap).
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
  const [unread, setUnread] = useState(0);
  const [railHover, setRailHover] = useState<string | null>(null);
  const chatVisibleRef = useRef(false);

  const vcRef = useRef<ReturnType<typeof createVideoClient> | null>(null);
  const localVideoRef = useRef<HTMLDivElement>(null);
  const joinStartedRef = useRef(false);
  const [videoJoined, setVideoJoined] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Hover states
  const [inviteHovered, setInviteHovered] = useState(false);
  const [inviteTileHovered, setInviteTileHovered] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [leaveHovered, setLeaveHovered] = useState(false);
  const [micHovered, setMicHovered] = useState(false);
  const [camHovered, setCamHovered] = useState(false);
  const [readyHovered, setReadyHovered] = useState(false);
  const [findMatchHovered, setFindMatchHovered] = useState(false);
  const [editVibesHovered, setEditVibesHovered] = useState(false);
  const [changeCoverHovered, setChangeCoverHovered] = useState(false);
  const [boostHovered, setBoostHovered] = useState(false);
  const [copyCodeHovered, setCopyCodeHovered] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [vibeSaveHovered, setVibeSaveHovered] = useState(false);
  const [vibeCancelHovered, setVibeCancelHovered] = useState(false);
  const [vibeChipHovered, setVibeChipHovered] = useState<string | null>(null);

  const violet = "var(--violet)";
  const lime = "var(--lime)";
  const limeText = "var(--lime-text)";
  const coral = "var(--coral)";
  const textPrimary = "var(--text)";
  const textMuted = "var(--text-muted)";
  const textTertiary = "var(--text-dim)";

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
    } catch (e) {
      console.error("getSquad failed:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!squadId) { setLoading(false); return; }
    fetchSquad();

    const socket = connectSocket(squadId);
    socket.on(SOCKET_EVENTS.SQUAD_UPDATED, fetchSquad);

    if (!joinStartedRef.current) {
      joinStartedRef.current = true;
      (async () => {
        try {
          await api.setLobbyVideo(squadId, true);
          const tokenData = await api.lobbyToken(squadId);
          const vc = createVideoClient();
          vcRef.current = vc;
          await vc.join(tokenData, { audio: true, video: true });
          setVideoJoined(true);
        } catch (e) {
          console.error("Lobby video join failed (non-fatal):", e);
          setVideoError(describeVideoError(e));
        }
      })();
    }

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
    } catch (e) {
      console.error("joinRequests failed:", e);
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

  async function handleInvite() {
    if (!squad) return;
    const text = `Join my Giggle squad — enter code ${squad.squadCode} at ${typeof window !== "undefined" ? window.location.origin : "giggle"}`;
    await copyToClipboard(
      text,
      () => {
        setInviteCopied(true);
        setTimeout(() => setInviteCopied(false), 1800);
      },
      "Couldn't copy invite link. Select and copy the squad code instead.",
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
    setFindingMatch(true);
    setMatchError(null);
    try {
      await api.setReady(squadId, true);
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

  const readyCount = squad?.members.filter(m => m.ready).length ?? 0;
  const memberCount = squad?.members.length ?? 0;
  // Capacity comes from the backend: 4 free, up to 8 when the leader is premium.
  const MAX_SLOTS = (squad as { maxSlots?: number } | null)?.maxSlots ?? 4;

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, color: textMuted, fontSize: 16 }}>
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
          boxShadow: "var(--elev)",
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
          <h1 style={{ margin: 0, color: textPrimary, fontFamily: "var(--font-space-grotesk)", fontSize: isPhone ? 26 : 30, lineHeight: 1.08, letterSpacing: "-0.02em" }}>
            This lobby link is no longer active
          </h1>
          <p style={{ margin: "10px auto 0", maxWidth: 410, color: textMuted, fontSize: 14.5, lineHeight: 1.5 }}>
            The squad may have ended, changed, or been opened from an old invite. Start fresh or browse live squads.
          </p>
          <div style={{ display: "flex", flexDirection: isPhone ? "column" : "row", justifyContent: "center", gap: 10, marginTop: 22 }}>
            <button
              onClick={() => router.push("/home")}
              className="gg-press"
              style={{
                minHeight: 44,
                borderRadius: 999,
                border: "none",
                background: violet,
                color: "#fff",
                fontWeight: 800,
                padding: "0 20px",
                cursor: "pointer",
              }}
            >
              Go home
            </button>
            <button
              onClick={() => router.push("/discover")}
              className="gg-press"
              style={{
                minHeight: 44,
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: "var(--overlay)",
                color: textPrimary,
                fontWeight: 800,
                padding: "0 20px",
                cursor: "pointer",
              }}
            >
              Browse squads
            </button>
          </div>
        </div>
      </div>
    );
  }

  const currentTags = normalizeVibeLabels(squad.tags?.length ? squad.tags : ["🎮 Gaming", "🌙 Late Night", "🎵 Music"]);

  // ── Squad cover identity ──────────────────────────────────────────────
  // hasCover: leader has explicitly chosen a cover. When absent we fall back to
  // a deterministic per-squad gradient so the squad still feels themed. Both
  // resolve to a CSS `background` value ready for inline styles.
  const hasCover = !!squad.coverImage;
  const coverBg = hasCover
    ? resolveCover(squad.coverImage)
    : fallbackGradient(squad.squadId || squad.squadName);
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
  const showInviteTile = memberCount < MAX_SLOTS;
  // Free squad at its 4-seat cap → show a premium upsell tile in the grid instead.
  const showUpgradeTile = !showInviteTile && MAX_SLOTS === 4 && memberCount >= MAX_SLOTS && !isPremium;
  const emptySlots = (showInviteTile || showUpgradeTile) ? 1 : 0;
  const tileCount = Math.max(memberCount + emptySlots, 1);
  // Scale columns with the squad size so up to 8 tiles stay elegant:
  // 1→1, 2-4→2, 5-6→3, 7-8→4 columns.
  const gridCols = tileCount <= 1 ? 1 : tileCount <= 4 ? 2 : tileCount <= 6 ? 3 : 4;
  const gridRows = Math.ceil(tileCount / gridCols);
  // Effective layout (phone caps at 2 cols); rows derived so tiles fill the stage.
  const effCols = isPhone ? Math.min(gridCols, 2) : gridCols;
  const effRows = Math.ceil(tileCount / effCols);

  const allReady = memberCount > 0 && readyCount === memberCount;
  const myReady = !!myMember?.ready;

  // ── Reusable surfaces (shared by phone sheet + expanded desktop panel) ──
  const infoCard = (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: "16px",
      display: "flex", flexDirection: "column", gap: 12,
    }}>
      {/* Squad identity: cover thumbnail + name so the panel is themed too */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {coverThumb(38)}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 14, fontWeight: 800, color: textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {squad.squadName}
          </div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: textTertiary, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>Squad Info</div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {[
          { label: "Members", value: `${memberCount} / ${MAX_SLOTS}`, color: textPrimary },
          { label: "Ready", value: `${readyCount} / ${memberCount}`, color: allReady ? limeText : textPrimary },
        ].map(row => (
          <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: textTertiary, fontSize: 12 }}>{row.label}</span>
            <span style={{ color: row.color, fontSize: 12, fontWeight: 600 }}>{row.value}</span>
          </div>
        ))}

        {/* Visibility toggle */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 9, borderTop: "1px solid var(--border)" }}>
          <span style={{ color: textTertiary, fontSize: 12 }}>Visibility</span>
          <div style={{ display: "flex", background: "var(--overlay)", borderRadius: 999, padding: 2, gap: 2, opacity: isLeader ? 1 : 0.6 }}
            title={isLeader ? undefined : "Only the squad leader can change visibility"}>
            {(["private", "open"] as const).map(v => (
              <button key={v} onClick={() => handleVisibility(v)} disabled={!isLeader || savingVisibility} style={{
                minHeight: 44, padding: "0 12px", borderRadius: 999, border: "none",
                cursor: isLeader && !savingVisibility ? "pointer" : "not-allowed",
                fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                background: visibility === v ? (v === "open" ? "var(--lime)" : "var(--violet)") : "transparent",
                color: visibility === v ? (v === "open" ? "#0B0B0F" : "#fff") : textTertiary,
                transition: "all 0.15s",
              }}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {!isLeader && (
          <div style={{ fontSize: 11, color: textTertiary, lineHeight: 1.5 }}>
            Only the squad leader can change visibility.
          </div>
        )}
        {visibility === "open" && (
          <div style={{ fontSize: 11, color: textTertiary, lineHeight: 1.5 }}>
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
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                  background: joinPolicy === v ? (v === "open" ? "var(--lime)" : "var(--violet)") : "transparent",
                  color: joinPolicy === v ? (v === "open" ? "#0B0B0F" : "#fff") : textTertiary,
                  transition: "all 0.15s",
                }}>
                  {v === "open" ? "Open" : v === "request" ? "Request" : "Invite-only"}
                </button>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: 11, fontWeight: 700, color: joinPolicy === "open" ? limeText : violet }}>
              {joinPolicy === "open" ? "Open" : joinPolicy === "request" ? "Request" : "Invite-only"}
            </span>
          )}
        </div>
        {isLeader && (
          <div style={{ fontSize: 11, color: textTertiary, lineHeight: 1.5 }}>
            Open: anyone can join instantly. Request: you approve who joins. Invite-only: only people you invite can join.
          </div>
        )}
        {isLeader && joinPolicy === "invite" && (
          <div style={{ fontSize: 11, color: violet, lineHeight: 1.5, fontWeight: 600 }}>
            Share your invite code below to bring people in — it's the only way to join this squad.
          </div>
        )}
      </div>

      {/* Join requests (leader only, only when pending) */}
      {isLeader && joinReqs.length > 0 && (
        <div style={{
          display: "flex", flexDirection: "column", gap: 8,
          paddingTop: 12, borderTop: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 11, fontWeight: 700, color: textPrimary, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>
              Join Requests
            </span>
            <span style={{
              fontSize: 9, fontWeight: 800, borderRadius: 999, padding: "1px 7px",
              background: "var(--violet-soft)", color: violet, border: "1px solid var(--violet)",
            }}>{joinReqs.length}</span>
          </div>
          {reqError && (
            <div style={{ fontSize: 11, color: coral, lineHeight: 1.4 }}>{reqError}</div>
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
                    <div style={{ fontSize: 10, color: textTertiary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dem}</div>
                  )}
                </div>
                <button
                  onClick={() => handleApprove(r.userId)}
                  disabled={busy}
                  title="Approve"
                  style={{
                    padding: "5px 10px", borderRadius: 8, border: "none",
                    cursor: busy ? "not-allowed" : "pointer",
                    background: "var(--lime)", color: "#0B0B0F", fontSize: 11, fontWeight: 800,
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
                    color: coral, fontSize: 11, fontWeight: 800,
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
                background: isOffline ? "var(--text-dim)" : "var(--lime)",
                boxShadow: isOffline ? "none" : "0 0 6px var(--lime)",
              }} />
              <Avatar name={member.displayName} size={28} colorIndex={i} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {member.displayName}
                {isThisLeader && <span style={{ color: limeText, fontSize: 10, fontWeight: 700, marginLeft: 4 }}>★</span>}
                {isOffline && (
                  <span style={{ color: textTertiary, fontSize: 10, fontWeight: 600, marginLeft: 6 }}>Offline</span>
                )}
                {dem && (
                  <span style={{ color: textTertiary, fontSize: 10, fontWeight: 500, marginLeft: 6 }}>{dem}</span>
                )}
              </span>
              <span style={{
                fontSize: 9, fontWeight: 700, borderRadius: 4, padding: "2px 6px",
                background: member.ready ? "var(--lime-soft, rgba(194,255,61,0.09))" : "var(--overlay)",
                color: member.ready ? limeText : textTertiary,
                border: `1px solid ${member.ready ? "var(--lime-border, rgba(194,255,61,0.2))" : "var(--border)"}`,
              }}>{member.ready ? "READY" : "WAIT"}</span>
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
          background: invitePeopleHovered ? "var(--violet)" : "var(--violet-soft)",
          border: "1px solid var(--violet)",
          color: invitePeopleHovered ? "#fff" : violet,
          fontFamily: "var(--font-space-grotesk)", fontSize: 12, fontWeight: 800,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          transition: "all .15s ease",
        }}
        title="Invite friends or search for anyone"
      >
        <Icon.users size={14} color={invitePeopleHovered ? "#fff" : violet} />
        Invite people
      </button>

      {/* Boost Squad */}
      <button
        onClick={() => router.push("/premium")}
        onMouseEnter={() => setBoostHovered(true)}
        onMouseLeave={() => setBoostHovered(false)}
        style={{
          minHeight: 44, padding: "0 14px", borderRadius: 12, border: "none", cursor: "pointer",
          background: "linear-gradient(135deg, var(--violet), var(--lime))",
          color: "#0B0B0F",
          fontFamily: "var(--font-space-grotesk)", fontSize: 12, fontWeight: 800,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          boxShadow: boostHovered ? "0 0 24px -4px var(--violet)" : "0 0 12px -6px var(--violet)",
          filter: boostHovered ? "brightness(1.12)" : "none",
          transition: "all .15s ease",
        }}
        title="Get matched 3x faster"
      >
        ✦ Boost Squad
      </button>
    </div>
  );

  const inviteCard = (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: "16px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 13, fontWeight: 700, color: textPrimary, letterSpacing: "0.04em", textTransform: "uppercase" as const }}>Invite Code</div>
      <div style={{
        background: "var(--lime-soft, rgba(194,255,61,0.04))", border: "1px solid var(--lime-border, rgba(194,255,61,0.13))",
        borderRadius: 10, padding: "10px 12px",
        fontFamily: "monospace", fontSize: 22, fontWeight: 800, color: limeText,
        letterSpacing: "0.14em", textAlign: "center" as const,
      }}>
        {squad.squadCode}
      </div>
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
        {codeCopied ? "Copied!" : "Copy Code"}
      </button>
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
      {/* Full calling layout: flex column filling viewport. The calling experience
          stays DARK in both themes (like every video app) so the stage and the
          floating side panel share one uniform background — no light/dark seam. */}
      <div data-theme="dark" style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0B0B0F", overflow: "hidden" }}>

        {/* ── COMPACT HEADER — themed with the squad's own cover ── */}
        <div style={{
          position: "relative",
          display: "flex", alignItems: "center", gap: 12,
          padding: isPhone ? "10px 12px" : "12px 20px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          backdropFilter: "blur(12px)",
          flexShrink: 0,
          zIndex: 10,
          flexWrap: "wrap" as const,
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
            {/* Legibility scrim: darker toward the left where name/code sit, and a
                bottom-up wash so text never fights the cover. */}
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(90deg, rgba(11,11,15,0.92) 0%, rgba(11,11,15,0.72) 45%, rgba(11,11,15,0.5) 100%)",
            }} />
            <div style={{
              position: "absolute", inset: 0,
              background: "linear-gradient(180deg, rgba(11,11,15,0.35) 0%, rgba(11,11,15,0.55) 100%)",
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
          <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: isPhone ? "1 1 auto" : undefined }}>
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
                    color: textPrimary, fontFamily: "var(--font-space-grotesk)",
                    fontSize: 15, fontWeight: 800, outline: "none",
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
                    background: "var(--violet)", color: "#fff", fontSize: 14, fontWeight: 900, lineHeight: 1,
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
                <h1 style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 17, fontWeight: 800, color: textPrimary, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {squad.squadName}
                </h1>
                {isLeader && (
                  <button
                    onClick={startRename}
                    onMouseEnter={() => setRenameHovered(true)}
                    onMouseLeave={() => setRenameHovered(false)}
                    title="Rename squad"
                    aria-label="Rename squad"
                    style={{
                      width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                      cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: renameHovered ? "var(--overlay-hover)" : "var(--overlay)",
                      border: "1px solid var(--border)",
                      transition: "all .15s ease",
                    }}
                  >
                    <Icon.settings size={12} color={renameHovered ? violet : textMuted} />
                  </button>
                )}
              </>
            )}
            <span style={{
              background: "var(--lime-soft, rgba(194,255,61,0.09))", color: limeText, border: "1px solid var(--lime-border, rgba(194,255,61,0.27))",
              borderRadius: 999, padding: "2px 10px", fontFamily: "monospace",
              fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", flexShrink: 0,
            }}>{squad.squadCode}</span>
          </div>

          {/* Vibe tags */}
          <div style={{ position: "relative", zIndex: 1, display: isPhone ? "none" : "flex", gap: 6, alignItems: "center", flex: 1, overflow: "hidden", minWidth: 0 }}>
            {currentTags.slice(0, 3).map(tag => (
              <span key={tag} style={{
                background: "var(--violet-soft)", color: violet, borderRadius: 999,
                padding: "3px 10px", fontSize: 11, fontWeight: 500, whiteSpace: "nowrap",
              }}>{tag}</span>
            ))}
            {isLeader && (
              <button
                onClick={() => { setVibeEditorOpen(true); setSelectedVibes(normalizeVibeLabels(currentTags)); }}
                onMouseEnter={() => setEditVibesHovered(true)}
                onMouseLeave={() => setEditVibesHovered(false)}
                title="Edit vibes"
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  background: editVibesHovered ? "var(--overlay-hover)" : "var(--overlay)",
                  border: "1.5px dashed var(--border-strong)",
                  borderRadius: 999, padding: "3px 10px", fontSize: 11, color: textMuted,
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
            {isLeader && (
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
                border: `1px solid ${chatVisible ? "var(--violet)" : "var(--border)"}`,
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
            <button
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
            </button>
            <button
              onClick={handleLeaveSquad}
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
        <div style={{ display: "flex", flexDirection: isPhone ? "column" : "row" as const, flex: 1, minHeight: 0, overflow: "hidden" }}>

          {/* ── VIDEO STAGE — stays dark in both themes ── */}
          <div style={{
            flex: 1, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center",
            background: "#0B0B0F",
            position: "relative",
            padding: isPhone ? "12px 12px 160px" : "24px 24px 16px",
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
                opacity: 0.2,
              }} />
              <div style={{
                position: "absolute", inset: 0,
                background: "radial-gradient(ellipse at 50% 40%, rgba(11,11,15,0.55) 0%, rgba(11,11,15,0.88) 70%, #0B0B0F 100%)",
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
                border: "1px solid var(--coral)",
                borderRadius: 12, padding: "9px 12px 9px 14px",
                boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
              }}>
                <span style={{
                  width: 7, height: 7, borderRadius: 999, background: coral, flexShrink: 0,
                }} />
                <span style={{ fontSize: 13, fontWeight: 500, color: textPrimary, lineHeight: 1.4 }}>
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
            {/* Slim "ready room" hint — fills the otherwise-dead space above the
                tiles with intent while the single squad is still assembling. */}
            {showInviteTile && (
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
                  fontFamily: "var(--font-space-grotesk)", fontSize: 12.5, fontWeight: 600,
                  letterSpacing: "0.04em",
                  background: "linear-gradient(90deg, #C9C9DA 0%, #C9C9DA 38%, #F4F4F7 50%, #C9C9DA 62%, #C9C9DA 100%)",
                  backgroundSize: "220% auto",
                  WebkitBackgroundClip: "text", backgroundClip: "text",
                  WebkitTextFillColor: "transparent", color: "#C9C9DA",
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
              gap: 12,
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
                      borderRadius: 16,
                      overflow: "hidden",
                      // Desktop fills the grid cell; phone uses a fixed aspect ratio.
                      ...(isPhone ? { aspectRatio: "4 / 3" } : { height: "100%" }),
                      background: `linear-gradient(145deg, ${avatarColors[i % 4]}22 0%, #0D0D12 100%)`,
                      border: isReady
                        ? `2px solid #C2FF3D66`
                        : "1.5px solid rgba(255,255,255,0.08)",
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
                      background: `radial-gradient(ellipse at center, ${avatarColors[i % 4]}18 0%, transparent 70%)`,
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
                        background: "#C2FF3D", color: "#0B0B0F",
                        fontSize: 9, fontWeight: 800, borderRadius: 6,
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
                          fontFamily: "var(--font-space-grotesk)", fontSize: 12, fontWeight: 600,
                          color: "#F4F4F7",
                          maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {member.displayName}{isMe ? " (You)" : ""}
                        </span>
                        {isOffline && (
                          <span style={{
                            display: "flex", alignItems: "center", gap: 4,
                            background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
                            border: "1px solid rgba(255,255,255,0.14)",
                            borderRadius: 999, fontSize: 9, fontWeight: 800,
                            color: "#C9C9DA", padding: "2px 7px", letterSpacing: "0.06em",
                          }}>
                            <span style={{ width: 6, height: 6, borderRadius: 999, background: "#9A9AB0" }} />
                            OFFLINE
                          </span>
                        )}
                        {isReady && (
                          <span style={{
                            background: "rgba(194,255,61,0.13)", border: "1px solid rgba(194,255,61,0.33)",
                            borderRadius: 999, fontSize: 9, fontWeight: 800,
                            color: "#C2FF3D", padding: "2px 6px", letterSpacing: "0.06em",
                          }}>✓ READY</span>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        {/* For the local user these are interactive toggles; for
                            others they're read-only status indicators. */}
                        {(() => {
                          const on = isMe ? micOn : member.inLobbyVideo;
                          const common: React.CSSProperties = {
                            width: 44, height: 44, borderRadius: 999, border: "none", padding: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: on ? "rgba(124,92,255,0.6)" : "rgba(255,92,92,0.55)",
                          };
                          const icon = <Icon.mic size={16} color={on ? "#fff" : "#FFD7D7"} />;
                          return isMe ? (
                            <button onClick={toggleMic} title={micOn ? "Mute mic" : "Unmute mic"}
                              style={{ ...common, cursor: "pointer", transition: "transform .12s ease" }}
                              onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.9)")}
                              onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
                              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                            >{icon}</button>
                          ) : <span style={common}>{icon}</span>;
                        })()}
                        {(() => {
                          const on = isMe ? camOn : member.inLobbyVideo;
                          const common: React.CSSProperties = {
                            width: 44, height: 44, borderRadius: 999, border: "none", padding: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: on ? "rgba(124,92,255,0.6)" : "rgba(255,92,92,0.55)",
                          };
                          const icon = <Icon.cam size={16} color={on ? "#fff" : "#FFD7D7"} />;
                          return isMe ? (
                            <button onClick={toggleCam} title={camOn ? "Turn off camera" : "Turn on camera"}
                              style={{ ...common, cursor: "pointer", transition: "transform .12s ease" }}
                              onMouseDown={(e) => (e.currentTarget.style.transform = "scale(0.9)")}
                              onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
                              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                            >{icon}</button>
                          ) : <span style={common}>{icon}</span>;
                        })()}
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
                    borderRadius: 16,
                    border: `1.5px dashed ${inviteTileHovered ? "var(--violet)" : "rgba(255,255,255,0.12)"}`,
                    background: inviteTileHovered ? "var(--violet-soft)" : "rgba(255,255,255,0.015)",
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
                  <Icon.plus size={22} color={inviteTileHovered ? "var(--violet)" : "#9A9AB0"} />
                  <div style={{ fontSize: 13, fontWeight: 600, color: inviteTileHovered ? "var(--violet)" : "#9A9AB0" }}>Invite a friend</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{MAX_SLOTS - memberCount} {MAX_SLOTS - memberCount === 1 ? "spot" : "spots"} open</div>
                </div>
              )}

              {/* Premium upsell tile — a FREE squad sitting at its 4-seat cap.
                  Slots into the grid like a tile; nudges the leader to unlock
                  more seats. Hidden for premium squads (genuinely full at 8). */}
              {showUpgradeTile && (
                <div
                  onClick={() => router.push("/premium")}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") router.push("/premium"); }}
                  onMouseEnter={() => setUpgradeTileHovered(true)}
                  onMouseLeave={() => setUpgradeTileHovered(false)}
                  style={{
                    borderRadius: 16,
                    border: `1.5px solid ${upgradeTileHovered ? "var(--violet)" : "rgba(124,92,255,0.35)"}`,
                    background: upgradeTileHovered
                      ? "linear-gradient(145deg, rgba(124,92,255,0.28) 0%, rgba(124,92,255,0.08) 100%)"
                      : "linear-gradient(145deg, rgba(124,92,255,0.18) 0%, rgba(124,92,255,0.04) 100%)",
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: 8, textAlign: "center" as const, padding: 14,
                    boxSizing: "border-box",
                    width: "100%", minWidth: 0, minHeight: 0,
                    cursor: "pointer",
                    ...(isPhone ? { aspectRatio: "4 / 3" } : { height: "100%" }),
                    transition: "all .15s ease",
                    boxShadow: upgradeTileHovered ? "0 0 28px -6px var(--violet)" : "none",
                    animation: `tileIn 0.35s ease ${memberCount * 0.06}s forwards`,
                  }}
                >
                  <span style={{
                    fontSize: 18, fontWeight: 900, color: violet, lineHeight: 1,
                  }}>✦</span>
                  <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 14, fontWeight: 800, color: textPrimary }}>Unlock 4 more seats</div>
                  <div style={{ fontSize: 11.5, color: textMuted, lineHeight: 1.4, maxWidth: 180 }}>Upgrade to Giggle+ for squads up to 8.</div>
                  <span style={{
                    marginTop: 4, padding: "6px 16px", borderRadius: 999,
                    background: "var(--violet)", color: "#fff",
                    fontSize: 12, fontWeight: 800, fontFamily: "var(--font-space-grotesk)",
                  }}>Upgrade</span>
                </div>
              )}
            </div>

            {/* ── CONTROL BAR (centered floating pill) ── */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center" as const, gap: 10,
              background: "rgba(22,22,30,0.92)",
              backdropFilter: "blur(16px)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 999,
              padding: "10px 16px",
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
              {/* Mic */}
              <button
                onClick={toggleMic}
                onMouseEnter={() => setMicHovered(true)}
                onMouseLeave={() => setMicHovered(false)}
                title={micOn ? "Mute mic" : "Unmute mic"}
                style={{
                  width: isPhone ? 44 : 50, height: isPhone ? 44 : 50, borderRadius: 999, border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: micOn
                    ? (micHovered ? "rgba(124,92,255,0.35)" : "rgba(124,92,255,0.2)")
                    : (micHovered ? "rgba(255,92,92,0.35)" : "rgba(255,92,92,0.25)"),
                  transition: "all .15s ease",
                  transform: micHovered ? "scale(1.08)" : "scale(1)",
                }}
              >
                <Icon.mic size={20} color={micOn ? "#7C5CFF" : "#FF5C5C"} />
              </button>

              {/* Cam */}
              <button
                onClick={toggleCam}
                onMouseEnter={() => setCamHovered(true)}
                onMouseLeave={() => setCamHovered(false)}
                title={camOn ? "Turn off camera" : "Turn on camera"}
                style={{
                  width: isPhone ? 44 : 50, height: isPhone ? 44 : 50, borderRadius: 999, border: "none", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: camOn
                    ? (camHovered ? "rgba(124,92,255,0.35)" : "rgba(124,92,255,0.2)")
                    : (camHovered ? "rgba(255,92,92,0.35)" : "rgba(255,92,92,0.25)"),
                  transition: "all .15s ease",
                  transform: camHovered ? "scale(1.08)" : "scale(1)",
                }}
              >
                <Icon.cam size={20} color={camOn ? "#7C5CFF" : "#FF5C5C"} />
              </button>

              {/* Divider */}
              <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.1)", margin: "0 2px" }} />

              {/* Ready toggle */}
              <button
                onClick={handleReady}
                disabled={settingReady}
                onMouseEnter={() => setReadyHovered(true)}
                onMouseLeave={() => setReadyHovered(false)}
                title="Toggle ready"
                style={{
                  height: isPhone ? 44 : 50, borderRadius: 999, border: "none", cursor: "pointer",
                  padding: "0 20px",
                  display: "flex", alignItems: "center", gap: 7,
                  background: readyHovered ? "rgba(194,255,61,0.17)" : "rgba(194,255,61,0.09)",
                  color: "#C2FF3D",
                  fontWeight: 700, fontSize: 14,
                  transition: "all .15s ease",
                  transform: readyHovered ? "scale(1.04)" : "scale(1)",
                  minWidth: 110,
                  whiteSpace: "nowrap" as const,
                }}
              >
                {settingReady ? "…" : myReady ? "Ready" : "Mark ready"}
              </button>

              {/* Find a Match (leader only) */}
              {isLeader && (
                <>
                  <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.1)", margin: "0 2px" }} />
                  <button
                    onClick={handleFindMatch}
                    disabled={findingMatch}
                    onMouseEnter={() => setFindMatchHovered(true)}
                    onMouseLeave={() => setFindMatchHovered(false)}
                    style={{
                      height: isPhone ? 44 : 50, borderRadius: 999, border: "none", cursor: findingMatch ? "not-allowed" : "pointer",
                      padding: "0 28px",
                      display: "flex", alignItems: "center", gap: 8,
                      background: "var(--violet)",
                      color: "#fff",
                      fontFamily: "var(--font-space-grotesk)", fontSize: 15, fontWeight: 800,
                      boxShadow: findMatchHovered
                        ? "0 0 40px -4px var(--violet), 0 0 0 3px var(--violet-soft)"
                        : "0 0 24px -6px var(--violet)",
                      transition: "all .15s ease",
                      transform: findMatchHovered ? "scale(1.04)" : "scale(1)",
                      minWidth: 162,
                      whiteSpace: "nowrap" as const,
                    }}
                  >
                    <Icon.discover size={18} color="#fff" />
                    {findingMatch ? "Starting…" : "Find a Match"}
                  </button>
                </>
              )}
            </div>
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
                background: "color-mix(in srgb, var(--coral) 12%, var(--surface))",
                border: "1px solid color-mix(in srgb, var(--coral) 38%, transparent)",
                color: "var(--coral)",
                fontSize: 12.5,
                fontWeight: 700,
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
              borderTop: "1px solid var(--border)",
              margin: 0,
              overflowY: "auto",
              padding: "16px 14px 28px",
              gap: 12,
            } as React.CSSProperties}>
              {infoCard}
              {inviteCard}
              {chatOpen && (
                <div style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
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
                  border: "1px solid var(--border)",
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
                      color: violet, fontSize: 12, fontWeight: 800, fontFamily: "var(--font-space-grotesk)",
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
                    <span style={{ fontSize: 10, fontWeight: 700, color: allReady ? limeText : textTertiary }}>{readyCount}/{memberCount}</span>
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
                      ? <span style={{ color: "#0B0B0F", fontSize: 16, fontWeight: 900, lineHeight: 1 }}>✓</span>
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
                        minWidth: 15, height: 15, padding: "0 3px", borderRadius: 999,
                        background: "var(--coral)", color: "#fff",
                        fontSize: 9, fontWeight: 800, lineHeight: "15px", textAlign: "center" as const,
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
                            background: active ? "var(--violet)" : "transparent",
                            color: active ? "#fff" : textMuted,
                            fontSize: 12, fontWeight: 700, fontFamily: "var(--font-space-grotesk)",
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
                      {infoCard}
                      {inviteCard}
                    </div>
                  ) : (
                    <div style={{
                      flex: 1, minHeight: 0,
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
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
              <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 18, fontWeight: 700, color: textPrimary }}>Edit Squad Vibes</div>
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

            {(() => {
              const q = vibeSearch.trim().toLowerCase();
              const all = Array.from(new Set([...selectedVibes, ...customVibes, ...CURATED_VIBES]));
              const filtered = q ? all.filter(v => v.toLowerCase().includes(q)) : all;
              const exact = all.some(v => v.toLowerCase() === q);
              const canCreate = q.length > 0 && !exact && selectedVibes.length < MAX_VIBES;
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
                          border: `1.5px solid ${active ? "var(--violet)" : "var(--border-strong)"}`,
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
                <button
                  onClick={() => setVibeEditorOpen(false)}
                  onMouseEnter={() => setVibeCancelHovered(true)}
                  onMouseLeave={() => setVibeCancelHovered(false)}
                  style={{
                    padding: "10px 20px", borderRadius: 999,
                    background: vibeCancelHovered ? "var(--overlay-hover)" : "transparent",
                    border: "1px solid var(--border)", color: textMuted, fontSize: 14,
                    cursor: "pointer", transition: "all .15s ease",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveVibes}
                  disabled={savingVibes}
                  onMouseEnter={() => setVibeSaveHovered(true)}
                  onMouseLeave={() => setVibeSaveHovered(false)}
                  style={{
                    padding: "10px 20px", borderRadius: 999, background: "var(--violet)", border: "none",
                    color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
                    boxShadow: vibeSaveHovered ? "0 0 32px -4px var(--violet)" : "0 0 20px -6px var(--violet)",
                    transition: "all .15s ease",
                    minWidth: 120,
                    whiteSpace: "nowrap" as const,
                  }}
                >
                  {savingVibes ? "Saving…" : "Save Vibes"}
                </button>
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
