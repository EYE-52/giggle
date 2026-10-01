"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/Button";
import { FaceOff, FaceOffBar, faceOffStyles } from "@/components/FaceOff";
import { api, ApiError, session } from "@giggle/core";
import type { EncounterDetail, SquadState } from "@giggle/core";

function isExpiredEncounterError(error: unknown) {
  return error instanceof ApiError && ["ENCOUNTER_EXPIRED", "ENCOUNTER_ENDED", "ENCOUNTER_NOT_FOUND"].includes(error.code);
}

function MatchInner() {
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

  // Searching already said "we want a call": after a short reveal the squad
  // joins on its own. The leader can skip during the reveal.
  const AUTO_JOIN_SECONDS = 3;
  const [autoLeft, setAutoLeft] = useState(AUTO_JOIN_SECONDS);
  const handleJoinRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!encounter || encounter.status !== "awaiting_ack") return;
    setAutoLeft(AUTO_JOIN_SECONDS);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const left = Math.max(0, AUTO_JOIN_SECONDS - Math.floor((Date.now() - startedAt) / 1000));
      setAutoLeft(left);
      if (left === 0) {
        clearInterval(timer);
        if (!navigatedRef.current) handleJoinRef.current();
      }
    }, 250);
    return () => clearInterval(timer);
  }, [encounter]);

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
      }, 150);
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

  handleJoinRef.current = () => { if (!skipping) void handleJoin(); };

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

  const mineIsA = encounter ? encounter.squadAId === squadId : true;
  const myRoster = squad?.members ?? encounterMembers;
  const mySide = encounter || squad ? {
    name: squad?.squadName ?? (encounter ? (mineIsA ? encounter.squadAName : encounter.squadBName) : "Your squad"),
    people: myRoster.map(member => ({ userId: member.userId, displayName: member.displayName, avatar: member.avatar })),
  } : null;
  const theirSide = encounter ? {
    name: mineIsA ? encounter.squadBName : encounter.squadAName,
    people: (mineIsA ? encounter.squadBMembers : encounter.squadAMembers).map(member => ({ userId: member.userId, displayName: member.displayName, avatar: member.avatar })),
  } : null;
  const back = () => { if (isLeader) void handleSkip(); };

  if (loading) {
    return (
      <div aria-busy="true" aria-label="Opening room" style={{ height: "100%" }}>
        <FaceOff top={<FaceOffBar onBack={back} backLabel="Skip this squad" busy />} mine={null} theirs={null} status="Opening the room…" />
      </div>
    );
  }

  if (handoffError || !encounter) {
    return (
      <FaceOff
        top={<FaceOffBar onBack={() => router.push(squadId ? `/lobby?squad=${squadId}` : "/home")} backLabel="Back to lobby" title={mySide?.name} />}
        mine={mySide}
        theirs={null}
        status={handoffExpired ? "That match expired before both squads joined." : handoffError ?? "This room is no longer available."}
        actions={
          <>
            {handoffExpired
              ? <Button onClick={() => router.push(squadId ? `/matchmaking?squad=${squadId}` : "/home")} variant="primary">Find another</Button>
              : <Button onClick={() => window.location.reload()} variant="primary">Retry</Button>}
            <Button onClick={() => router.push(squadId ? `/lobby?squad=${squadId}` : "/home")} variant="secondary">Back to lobby</Button>
          </>
        }
      />
    );
  }

  const status = joinExpired
    ? "This match expired. Finding you another…"
    : joining
      ? `Joining ${theirSide?.name ?? "the call"}…`
      : `Joining in ${autoLeft}…`;

  return (
    <FaceOff
      top={<FaceOffBar onBack={back} backLabel="Skip this squad" title={mySide?.name} busy={!isLeader || skipping || joining} />}
      mine={mySide}
      theirs={theirSide}
      status={<>
        <span role="timer" aria-label={`${countdown} of ${countdownTotal} seconds left to join`}>{status}</span>
        <span aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{srAnnounce}</span>
      </>}
      actions={
        <>
          <Button onClick={handleJoin} loading={joining} disabled={joinExpired} variant="primary">{joinExpired ? "Match expired" : "Join now"}</Button>
          {isLeader && <Button onClick={handleSkip} loading={skipping} disabled={joining} variant="secondary">{skipping ? "Skipping…" : "Skip"}</Button>}
          {actionError && <p role="alert" className={faceOffStyles.alert} style={{ flexBasis: "100%" }}>{actionError}</p>}
        </>
      }
    />
  );
}

export default function MatchPage() {
  return (
    <Suspense fallback={<div style={{ color: "var(--text-muted)", padding: 40 }}>Loading match…</div>}>
      <MatchInner />
    </Suspense>
  );
}
