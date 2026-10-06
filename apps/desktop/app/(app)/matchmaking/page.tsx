"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icons";
import { api, connectSocket, SOCKET_EVENTS } from "@giggle/core";
import type { SquadState } from "@giggle/core";
import { useViewport } from "@/components/useViewport";
import { Button } from "@/components/Button";
import { FaceOff, FaceOffBar, faceOffStyles } from "@/components/FaceOff";
import { SquadCallPanel } from "@/components/SquadCallPanel";

function MatchmakingInner() {
  const { isPhone } = useViewport();
  const router = useRouter();
  const params = useSearchParams();
  const squadId = params.get("squad") ?? "";

  const [elapsed, setElapsed] = useState(0);
  const [squad, setSquad] = useState<SquadState | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [matchFound, setMatchFound] = useState<{ encounterId: string; opponentName?: string } | null>(null);
  // Consecutive matchStatus poll failures — after ≥3 we surface a reconnect note.
  const [pollFailures, setPollFailures] = useState(0);
  const pollFailuresRef = useRef(0);
  // getSquad failed even after one auto-retry — offer a manual retry link.
  const [squadError, setSquadError] = useState(false);
  // Long-search branch card: shown when (elapsed - baseline) ≥ 75s of searching.
  // "Keep waiting" bumps the baseline so the card returns after another 75s.
  const [longSearchBaseline, setLongSearchBaseline] = useState(0);
  const showLongSearch = !matchFound && elapsed - longSearchBaseline >= 75;
  // Both the socket event and the 2s poll can fire — ensure we reveal/navigate once.
  const revealedRef = useRef(false);
  // Set the instant the user cancels — makes the poll/socket stop triggering a
  // match reveal so a late in-flight response can't re-add or resurrect the search.
  const cancelledRef = useRef(false);
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // getSquad silent auto-retry timer — cleared on unmount so the retry can't
  // setState after the page is gone.
  const squadRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearRevealTimers() {
    if (navigationTimeoutRef.current) {
      clearTimeout(navigationTimeoutRef.current);
      navigationTimeoutRef.current = null;
    }
  }

  const textPrimary = "var(--text)";
  const textMuted = "var(--text-muted)";
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const progressLabel = elapsed < 10 ? "Looking for a squad" : "Still looking";

  useEffect(() => {
    if (!squadId) return;

    // Load squad; on failure attempt one silent auto-retry before surfacing "?".
    fetchSquad(true);

    const tick = setInterval(() => setElapsed(e => e + 1), 1000);
    let active = true;
    let pollTimeout: ReturnType<typeof setTimeout> | null = null;
    const stopPolling = () => {
      if (pollTimeout) clearTimeout(pollTimeout);
      pollTimeout = null;
    };
    function schedulePoll() {
      if (active && !revealedRef.current) {
        pollTimeout = setTimeout(pollStatus, 2000);
      }
    }
    async function pollStatus() {
      if (!active || revealedRef.current) return;
      // Keep the timer alive while cancellation is pending so a failed cancel
      // can resume polling, but never accept a late match during that window.
      if (cancelledRef.current) {
        schedulePoll();
        return;
      }
      try {
        const status = await api.matchStatus(squadId);
        if (!active || revealedRef.current) return;
        if (cancelledRef.current) {
          schedulePoll();
          return;
        }
        // Poll succeeded — recover silently from any reconnect state.
        if (pollFailuresRef.current > 0) {
          pollFailuresRef.current = 0;
          setPollFailures(0);
        }
        if (status.match?.encounterId) {
          stopPolling();
          triggerMatchReveal(status.match.encounterId);
          return;
        }
        // Not queued (e.g. the server could not requeue after a call): this
        // squad belongs in its lobby, not on a search that is not happening.
        if ((status as { state?: string }).state === "idle") {
          stopPolling();
          router.replace(`/lobby?squad=${squadId}`);
          return;
        }
      } catch {
        if (!active) return;
        if (!cancelledRef.current) {
          pollFailuresRef.current += 1;
          setPollFailures(pollFailuresRef.current);
        }
      }
      schedulePoll();
    }
    schedulePoll();

    const socket = connectSocket(squadId);
    const onMatchFound = ({ encounterId, opponentSquadName }: { encounterId: string; opponentSquadName?: string }) => {
      if (cancelledRef.current) return;
      stopPolling();
      triggerMatchReveal(encounterId, opponentSquadName);
    };
    socket.on(SOCKET_EVENTS.MATCH_FOUND, onMatchFound);

    return () => {
      active = false;
      clearInterval(tick);
      stopPolling();
      clearRevealTimers();
      if (squadRetryTimeoutRef.current) {
        clearTimeout(squadRetryTimeoutRef.current);
        squadRetryTimeoutRef.current = null;
      }
      socket.off(SOCKET_EVENTS.MATCH_FOUND, onMatchFound);
    };
  }, [squadId, router]);

  function fetchSquad(autoRetry = false) {
    setSquadError(false);
    api.getSquad(squadId).then(s => {
      setSquad(s);
      setSquadError(false);
    }).catch(() => {
      if (autoRetry) {
        // One silent auto-retry before showing the "?" + retry link.
        squadRetryTimeoutRef.current = setTimeout(() => fetchSquad(false), 1500);
      } else {
        setSquadError(true);
      }
    });
  }

  function triggerMatchReveal(encounterId: string, opponentName?: string) {
    if (revealedRef.current) return;
    revealedRef.current = true;
    clearRevealTimers();
    setMatchFound({ encounterId, opponentName });
    // The handoff screen shares this layout, so go straight there.
    navigationTimeoutRef.current = setTimeout(() => {
      router.push(`/match?squad=${squadId}&enc=${encounterId}`);
    }, 250);
  }

  async function handleCancel() {
    // No cancelling once the match reveal/navigation has started.
    if (!squadId || cancelling || revealedRef.current) return;
    // Flip the cancelled flag FIRST so the poll/socket immediately stop and can't
    // re-add the search while the backend call is in flight.
    cancelledRef.current = true;
    setCancelling(true);
    setCancelError(null);
    try {
      await api.cancelSearch(squadId);
      router.push(`/lobby?squad=${squadId}`);
    } catch {
      cancelledRef.current = false;
      setCancelling(false);
      setCancelError("Couldn't cancel search. Your squad is still in the queue.");
    }
  }

  if (!squadId) {
    return (
      <div style={{ height: "100%", display: "grid", placeItems: "center", background: "var(--bg)", padding: 24 }}>
        <div style={{ width: "min(460px, 100%)", background: "var(--surface)", border: "var(--control-border)", borderRadius: "var(--radius-card, 20px)", padding: isPhone ? 24 : 32, textAlign: "center", boxShadow: "var(--shadow-card)" }}>
          <div style={{ width: 58, height: 58, borderRadius: "var(--radius-control, 14px)", margin: "0 auto 16px", display: "grid", placeItems: "center", background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
            <Icon.discover size={25} color="var(--accent)" />
          </div>
          <h1 style={{ margin: 0, color: textPrimary, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em" }}>No squad selected</h1>
          <p style={{ margin: "10px 0 22px", color: textMuted, lineHeight: 1.5, fontSize: 14 }}>Start matchmaking from a squad lobby so we know who to pair you with.</p>
          <Button onClick={() => router.push("/home")} variant="primary">Back to home</Button>
        </div>
      </div>
    );
  }

  const mine = squad ? {
    name: squad.squadName,
    people: squad.members.map(member => ({ userId: member.userId, uid: member.uid, displayName: member.displayName, avatar: member.avatar })),
  } : null;
  const status = matchFound
    ? `Found ${matchFound.opponentName ?? "a squad"}…`
    : pollFailures >= 3
      ? "Reconnecting… your squad is still in the queue."
      : showLongSearch
        ? `Not many squads are live right now · ${fmt(elapsed)}`
        : `${progressLabel} · ${fmt(elapsed)}`;

  return (
    <FaceOff
      top={<FaceOffBar onBack={handleCancel} backLabel="Back to lobby" title={squad?.squadName} busy={cancelling || !!matchFound} />}
      mine={mine}
      mineContent={mine && <SquadCallPanel squadId={squadId} people={mine.people} />}
      theirs={null}
      searching
      status={status}
      actions={
        <>
          {showLongSearch && <Button variant="primary" onClick={() => setLongSearchBaseline(elapsed)}>Keep waiting</Button>}
          {showLongSearch && <Button variant="secondary" onClick={() => router.push("/friends")}>Invite friends</Button>}
          <Button onClick={handleCancel} loading={cancelling} disabled={!!matchFound} variant={showLongSearch ? "ghost" : "secondary"}>
            {cancelError ? "Try cancel again" : "Cancel search"}
          </Button>
          {cancelError && <p role="alert" className={faceOffStyles.alert} style={{ flexBasis: "100%" }}>{cancelError}</p>}
          {squadError && !squad && <button type="button" className={faceOffStyles.link} onClick={() => fetchSquad(false)}>Retry squad details</button>}
        </>
      }
    />
  );
}

export default function MatchmakingPage() {
  return (
    <Suspense fallback={<div style={{ color: "var(--text-muted)", padding: 40 }}>Loading…</div>}>
      <MatchmakingInner />
    </Suspense>
  );
}
