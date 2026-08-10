"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AvatarStack } from "@/components/Avatar";
import { useViewport } from "@/components/useViewport";
import { Button } from "@/components/Button";
import { api, ApiError, session } from "@giggle/core";
import type { EncounterDetail, SquadState } from "@giggle/core";

function isExpiredEncounterError(error: unknown) {
  return error instanceof ApiError && ["ENCOUNTER_EXPIRED", "ENCOUNTER_ENDED", "ENCOUNTER_NOT_FOUND"].includes(error.code);
}

function MatchInner() {
  const { isPhone } = useViewport();
  const router = useRouter();
  const params = useSearchParams();
  const squadId = params.get("squad") ?? "";
  const encId = params.get("enc") ?? "";

  const [encounter, setEncounter] = useState<EncounterDetail | null>(null);
  const [squad, setSquad] = useState<SquadState | null>(null);
  const [loading, setLoading] = useState(true);
  const [handoffError, setHandoffError] = useState<string | null>(null);
  const [handoffExpired, setHandoffExpired] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [countdown, setCountdown] = useState(1);
  const [countdownTotal, setCountdownTotal] = useState(1);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const joinNavTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expiredNavTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against double-navigation (manual action + countdown auto-skip).
  const navigatedRef = useRef(false);
  function clearDeferredNavigation() {
    if (joinNavTimeoutRef.current) {
      clearTimeout(joinNavTimeoutRef.current);
      joinNavTimeoutRef.current = null;
    }
    if (expiredNavTimeoutRef.current) {
      clearTimeout(expiredNavTimeoutRef.current);
      expiredNavTimeoutRef.current = null;
    }
  }
  const navigate = (path: string) => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    clearDeferredNavigation();
    router.push(path);
  };

  const encounterMembers = encounter
    ? (encounter.squadAId === squadId ? encounter.squadAMembers : encounter.squadBMembers)
    : [];
  // The encounter roster preserves leader authority if the secondary squad
  // detail request fails while the handoff itself is still available.
  const myMember = squad?.members.find(m => m.userId === session.user?.id)
    ?? encounterMembers.find(m => m.userId === session.user?.id);
  const isLeader = !!myMember && myMember.role === "leader";
  const isLeaderRef = useRef(false);
  useEffect(() => { isLeaderRef.current = isLeader; }, [isLeader]);

  const textPrimary = "var(--text)";
  const textMuted = "var(--text-muted)";

  useEffect(() => {
    // Reached without the required params (e.g. direct URL) — recover instead of
    // showing a broken handoff and redirecting to an empty ?squad=.
    if (!encId || !squadId) { router.replace(squadId ? `/matchmaking?squad=${squadId}` : "/home"); return; }
    let cancelled = false;
    setLoading(true);
    setHandoffError(null);
    setHandoffExpired(false);
    Promise.all([
      api.getEncounter(encId),
      api.getSquad(squadId).catch(() => null),
    ]).then(([encounterData, squadData]) => {
      if (cancelled) return;
      if (encounterData.status === "active") {
        navigate(`/encounter?squad=${squadId}&enc=${encId}`);
        return;
      }
      const deadline = Date.parse(encounterData.expiresAt);
      if (!Number.isFinite(deadline)) throw new Error("Match timing is unavailable. Try again.");
      const secondsLeft = Math.ceil((deadline - Date.now()) / 1000);
      if (encounterData.status === "ended" || secondsLeft <= 0) {
        setHandoffExpired(true);
        setHandoffError("This match handoff has expired.");
        setLoading(false);
        return;
      }
      setEncounter(encounterData);
      if (squadData) setSquad(squadData);
      setCountdown(secondsLeft);
      setCountdownTotal(secondsLeft);
      setLoading(false);
      // Recalculate from the server deadline so background-tab throttling cannot
      // make the UI claim more handoff time than actually remains.
      tickRef.current = setInterval(() => {
        setCountdown(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
      }, 1000);
    }).catch((error: unknown) => {
      if (cancelled) return;
      const expired = isExpiredEncounterError(error);
      setHandoffExpired(expired);
      setHandoffError(expired ? "This match handoff has expired." : error instanceof Error ? error.message : "Couldn't load this match.");
      setLoading(false);
    });
    return () => {
      cancelled = true;
      if (tickRef.current) clearInterval(tickRef.current);
      clearDeferredNavigation();
    };
  }, [encId, squadId, router]);

  // On countdown expiry: leader issues the skip, everyone returns to matchmaking.
  useEffect(() => {
    if (countdown > 0) return;
    if (tickRef.current) clearInterval(tickRef.current);
    let cancelled = false;
    (async () => {
      if (isLeaderRef.current && squadId && encId) {
        try {
          await api.skip(squadId, encId);
        } catch (e) {
          if (!cancelled) {
            setActionError((e as { message?: string })?.message || "Couldn't refresh this match yet.");
          }
          return;
        }
      }
      if (!cancelled) navigate(`/matchmaking?squad=${squadId}`);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, squadId, encId]);

  const [joinExpired, setJoinExpired] = useState(false);

  // SR countdown announcements — throttled to 10s / 5s / expiry only, so the
  // live region doesn't chatter every second.
  const [srAnnounce, setSrAnnounce] = useState("");
  useEffect(() => {
    if (countdown === 10) setSrAnnounce("10 seconds remaining");
    else if (countdown === 5) setSrAnnounce("5 seconds remaining");
    else if (countdown === 0) setSrAnnounce("Time expired — returning to search");
  }, [countdown]);

  async function handleJoin() {
    if (!encId || !squadId || joining) return;
    setActionError(null);
    setJoinExpired(false);
    // Don't clear the countdown timer yet — only stop it once the ack SUCCEEDS.
    // If the ack fails (e.g. server handoff TTL expired), the countdown's
    // expiry effect still runs as a fallback so the user is never stranded.
    setJoining(true);
    try {
      await api.ackEncounter(encId, squadId);
      // Ack confirmed — now it's safe to stop the auto-skip countdown.
      if (tickRef.current) clearInterval(tickRef.current);
      clearDeferredNavigation();
      joinNavTimeoutRef.current = setTimeout(() => {
        navigate(`/encounter?squad=${squadId}&enc=${encId}`);
      }, 520);
    } catch (error: unknown) {
      setJoining(false);
      if (isExpiredEncounterError(error)) {
        setJoinExpired(true);
        clearDeferredNavigation();
        expiredNavTimeoutRef.current = setTimeout(() => {
          navigate(`/matchmaking?squad=${squadId}`);
        }, 1500);
        return;
      }
      setActionError(error instanceof Error ? error.message : "Couldn't join this encounter yet.");
    }
  }

  async function handleSkip() {
    if (!squadId || !encId) return;
    // Skip is leader-only — non-leaders shouldn't call it (it would bounce the squad).
    if (!isLeader) return;
    setSkipping(true);
    setActionError(null);
    try {
      await api.skip(squadId, encId);
    } catch (e) {
      setActionError((e as { message?: string })?.message || "Couldn't skip this match yet.");
      setSkipping(false);
      return;
    }
    if (tickRef.current) clearInterval(tickRef.current);
    navigate(`/matchmaking?squad=${squadId}`);
  }

  const mySquadName = squad?.squadName ?? (encounter
    ? (encounter.squadAId === squadId ? encounter.squadAName : encounter.squadBName)
    : "Your Squad");
  const pairedSquadName = encounter
    ? (encounter.squadAId === squadId ? encounter.squadBName : encounter.squadAName)
    : "Another squad";
  const myMembers = (squad?.members ?? encounterMembers).map(m => m.displayName);
  const opponentMembers = (encounter
    ? (encounter.squadAId === squadId ? encounter.squadBMembers : encounter.squadAMembers)
    : null
  )?.map((m: { displayName: string }) => m.displayName) ?? [];
  // Vibe chip — derive from the squad's real tags rather than hardcoded text.
  const vibeLabel = (squad?.tags && squad.tags.length > 0)
    ? squad.tags.slice(0, 2).join(" & ")
    : null;
  const rosterLabel = `${mySquadName}: ${myMembers.join(", ")}. ${pairedSquadName}: ${opponentMembers.join(", ")}`;

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Opening room" style={{ minHeight: "100%", background: "var(--bg)", display: "grid", placeItems: "center", padding: 24, boxSizing: "border-box" }}>
        <div style={{ width: "min(460px, 100%)", background: "var(--surface)", border: "var(--control-border)", borderRadius: "var(--radius-card, 20px)", padding: 24, textAlign: "center", boxShadow: "var(--shadow-card)" }}>
          <div className="gg-shimmer" style={{ width: 48, height: 48, borderRadius: "50%", margin: "0 auto 16px" }} />
          <h1 style={{ margin: 0, color: textPrimary, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700 }}>Preparing your room</h1>
          <p style={{ margin: "10px 0 0", color: textMuted, lineHeight: 1.5, fontSize: 14 }}>Bringing both squads together…</p>
        </div>
      </div>
    );
  }

  if (handoffError || !encounter) {
    return (
      <div style={{ minHeight: "100%", display: "grid", placeItems: "center", background: "var(--bg)", padding: 24 }}>
        <div style={{ width: "min(460px, 100%)", textAlign: "center", background: "var(--surface)", border: "var(--control-border)", borderRadius: "var(--radius-card, 20px)", padding: 24, boxShadow: "var(--shadow-card)" }}>
          <h1 style={{ margin: 0, color: textPrimary, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em" }}>{handoffExpired ? "Match expired" : "Couldn't open room"}</h1>
          <p style={{ margin: "10px 0 22px", color: textMuted, lineHeight: 1.5, fontSize: 14 }}>{handoffError ?? "This room is no longer available."}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            {handoffExpired ? <Button onClick={() => router.push(squadId ? `/matchmaking?squad=${squadId}` : "/home")} variant="primary">Find another</Button> : <Button onClick={() => window.location.reload()} variant="primary">Retry</Button>}
            <Button onClick={() => router.push("/home")} variant="secondary">Home</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100%", background: "var(--bg)", display: "grid", placeItems: "center", padding: isPhone ? "16px" : "24px", boxSizing: "border-box", overflowY: "auto" }}>
      <section style={{ width: "min(640px, 100%)", background: "var(--surface)", border: "var(--control-border)", borderRadius: "var(--radius-card, 20px)", padding: isPhone ? "20px" : "28px", boxShadow: "var(--shadow-card)", display: "flex", flexDirection: "column", gap: isPhone ? 18 : 24, textAlign: "center" }}>
        <header style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <span style={{ borderRadius: "var(--radius-pill, 999px)", padding: "5px 10px", background: "var(--accent-soft)", border: "1px solid var(--accent-line)", color: "var(--accent)", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Room ready</span>
          <h1 style={{ margin: 0, color: textPrimary, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: isPhone ? 24 : 30, fontWeight: 700, letterSpacing: "-0.03em" }}>Your squads can join now</h1>
          {vibeLabel && <div style={{ color: textMuted, fontSize: 13 }}>Shared vibe · {vibeLabel}</div>}
        </header>

        <div role="group" aria-label={rosterLabel} style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr" : "1fr 1fr", gap: 12, textAlign: "left" }}>
          <div style={{ minWidth: 0, padding: "14px", borderRadius: "var(--radius-tile, 16px)", background: "var(--overlay)", border: "var(--control-border)", display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ color: textMuted, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Your squad</span>
            <div style={{ color: textPrimary, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 18, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mySquadName}</div>
            <AvatarStack names={myMembers} size={32} total={myMembers.length} max={4} />
          </div>
          <div style={{ minWidth: 0, padding: "14px", borderRadius: "var(--radius-tile, 16px)", background: "var(--overlay)", border: "var(--control-border)", display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ color: textMuted, fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>Joining you</span>
            <div style={{ color: textPrimary, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 18, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pairedSquadName}</div>
            <AvatarStack names={opponentMembers} size={32} total={opponentMembers.length} max={4} />
          </div>
        </div>

        <div role="timer" aria-label={`${countdown} of ${countdownTotal} seconds remaining`} style={{ alignSelf: "center", borderRadius: "var(--radius-pill, 999px)", padding: "8px 14px", background: "var(--live-soft)", color: "var(--text)", fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" as const }}>
          Starts in {countdown}s
        </div>
        <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" as const, border: 0 }}>{srAnnounce}</div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <Button onClick={handleJoin} loading={joining} disabled={joinExpired} variant="primary" style={{ width: isPhone ? "100%" : 220 }}>
            {joinExpired ? "Match expired" : joining ? "Joining…" : "Join room"}
          </Button>
          {joinExpired && <div style={{ color: "var(--coral)", fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 13, width: isPhone ? "100%" : 220 }}>This match expired — finding you another…</div>}
          {actionError && <div role="alert" style={{ color: "var(--coral)", fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 13, fontWeight: 700, width: isPhone ? "100%" : 220, textAlign: "center", lineHeight: 1.35 }}>{actionError}</div>}
          {isLeader ? <Button onClick={handleSkip} loading={skipping} variant="ghost" style={{ width: isPhone ? "100%" : 220 }}>{skipping ? "Skipping…" : `Skip (${countdown}s)`}</Button> : <div style={{ color: textMuted, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 13, width: isPhone ? "100%" : 220, textAlign: "center", padding: "8px 0" }}>Waiting for your leader to start — or join now ({countdown}s)</div>}
        </div>
      </section>
    </div>
  );
}

export default function MatchPage() {
  return (
    <Suspense fallback={<div style={{ color: "var(--text-muted)", padding: 40 }}>Loading match…</div>}>
      <MatchInner />
    </Suspense>
  );
}
