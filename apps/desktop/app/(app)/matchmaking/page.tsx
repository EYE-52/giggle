"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/Icons";
import { api, connectSocket, SOCKET_EVENTS } from "@giggle/core";
import type { SquadState } from "@giggle/core";
import { useViewport } from "@/components/useViewport";
import { Button } from "@/components/Button";
import { StatTile } from "@/components/StatTile";
import { AvatarStack } from "@/components/Avatar";

function MatchmakingInner() {
  const { height, isPhone } = useViewport();
  const isShortPhone = isPhone && height <= 650;
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
  const progressLabel = elapsed < 4
    ? "Checking active squads"
    : elapsed < 10
      ? "Matching your squad's vibes"
      : "Finding the strongest live match";
  const squadMemberNames = squad?.members.map(member => member.displayName) ?? [];
  const squadMemberSummary = squadMemberNames.length <= 3
    ? squadMemberNames.join(" · ")
    : `${squadMemberNames.slice(0, 2).join(" · ")} +${squadMemberNames.length - 2}`;

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
    // Navigate after reveal (~2s — leaves time for the SR announcement to land)
    navigationTimeoutRef.current = setTimeout(() => {
      router.push(`/match?squad=${squadId}&enc=${encounterId}`);
    }, 2000);
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

  const signalSize = isShortPhone ? 48 : isPhone ? 56 : 64;

  return (
    <div style={{
      height: "100%", minHeight: 0, width: "100%", background: "var(--bg)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: isShortPhone ? "flex-start" : "center",
      gap: isShortPhone ? 10 : isPhone ? 18 : 28,
      padding: isShortPhone ? "10px 16px" : isPhone ? "20px 16px" : "24px",
      boxSizing: "border-box", overflowX: "hidden", overflowY: isPhone ? "auto" : "hidden", position: "relative",
    }}>
      {matchFound && (
        <div role="status" aria-live="assertive" style={{ position: "fixed", inset: 0, zIndex: 100, background: "var(--overlay-strong)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <span style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" as const, border: 0 }}>Match found — starting now.</span>
          <div aria-hidden style={{ width: "min(400px, 100%)", background: "var(--surface)", border: "1px solid var(--accent-line)", borderRadius: "var(--radius-card, 20px)", padding: isPhone ? "28px 24px" : "40px 48px", textAlign: "center", boxShadow: "var(--shadow-pop)", display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
            <div style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 999, padding: "6px 14px", fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "var(--accent)" }}>Match found</div>
            <div style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: isPhone ? 22 : 30, fontWeight: 700, color: textPrimary, letterSpacing: "-0.03em", lineHeight: 1.1 }}>Squad located!</div>
            {matchFound.opponentName && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                <div style={{ color: textMuted, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>You matched with</div>
                <div style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>{matchFound.opponentName}</div>
              </div>
            )}
            <div style={{ color: textMuted, fontSize: 14 }}>Heading to the encounter…</div>
          </div>
        </div>
      )}

      <div aria-hidden style={{ width: signalSize, height: signalSize, borderRadius: "50%", display: "grid", placeItems: "center", flexShrink: 0, background: "var(--accent-soft)", border: "1px solid var(--accent-line)" }}>
        <Icon.discover size={isShortPhone ? 22 : 26} color="var(--accent)" />
      </div>

      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 8, maxWidth: 460 }}>
        <h1 style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: isShortPhone ? 22 : isPhone ? 22 : 30, fontWeight: 700, color: textPrimary, letterSpacing: "-0.02em", margin: 0 }}>Finding your match…</h1>
        <div style={{ color: textMuted, fontSize: isShortPhone ? 12 : 14 }}>
          {isShortPhone && elapsed >= 20 ? "Still searching — few squads are live right now." : "Looking for a squad that matches your crew's vibe."}
        </div>
        {elapsed >= 20 && !matchFound && !isShortPhone && !showLongSearch && (
          <div style={{ marginTop: 4, maxWidth: 420, alignSelf: "center", padding: isPhone ? "10px 16px" : "12px 20px", borderRadius: "var(--radius-control, 14px)", background: "var(--surface)", border: "1px solid var(--border)", color: textMuted, fontSize: 14, lineHeight: 1.5 }}>
            Still searching — not many squads are live right now. Hang tight, or invite a friend.
          </div>
        )}
      </div>

      <section aria-label="Your squad" style={{ width: "min(520px, calc(100vw - 32px))", minHeight: isShortPhone ? 52 : 60, padding: isShortPhone ? "8px 10px" : "10px 12px", borderRadius: "var(--radius-control, 14px)", border: "1px solid var(--border)", background: "var(--surface)", display: "flex", alignItems: "center", gap: 12, boxSizing: "border-box" }}>
        {squad ? (
          <>
            <AvatarStack names={squadMemberNames} size={isShortPhone ? 26 : 30} total={squadMemberNames.length} max={isPhone ? 3 : 4} />
            <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
              <div style={{ color: textPrimary, fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{squad.squadName}</div>
              <div style={{ marginTop: 2, color: textMuted, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{squadMemberSummary}</div>
            </div>
            <span style={{ flexShrink: 0, color: "var(--live)", fontSize: 12, fontWeight: 700 }}>{squadMemberNames.length} together</span>
          </>
        ) : (
          <span style={{ color: textMuted, fontSize: 13 }}>Keeping your squad together…</span>
        )}
      </section>

      {showLongSearch && (
        <div role="status" style={{ width: "min(440px, calc(100vw - 32px))", background: "var(--surface)", border: "var(--control-border)", borderRadius: "var(--radius-card, 20px)", padding: isShortPhone ? "12px 14px" : isPhone ? "16px 18px" : "18px 22px", boxShadow: "var(--shadow-card)", display: "flex", flexDirection: "column", gap: 12, textAlign: "center" }}>
          <div style={{ color: textPrimary, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 17, fontWeight: 700, lineHeight: 1.4 }}>Still looking — no squads are free right now.</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" as const }}>
            <Button variant="tonal" size="sm" onClick={() => setLongSearchBaseline(elapsed)}>Keep waiting</Button>
            <Button variant="secondary" size="sm" onClick={() => router.push("/friends")}>Invite friends</Button>
            <Button variant="ghost" size="sm" onClick={handleCancel} loading={cancelling}>Back to lobby</Button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: isShortPhone ? 8 : 12, justifyContent: "center", maxWidth: "min(720px, calc(100vw - 32px))", flexWrap: "wrap" as const }}>
        <StatTile label="Elapsed" value={fmt(elapsed)} />
        <StatTile label="Status" live={!!matchFound} value={matchFound ? "Found!" : pollFailures >= 3 ? "Reconnecting…" : "Searching"} />
      </div>

      {squadError && !squad && (
        <button onClick={() => fetchSquad(false)} style={{ padding: 0, border: "none", background: "transparent", color: "var(--accent)", fontSize: 12, fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}>Retry squad details</button>
      )}

      {pollFailures >= 3 && !matchFound && (
        <div role="status" style={{ padding: "8px 18px", borderRadius: 999, background: "var(--coral-soft)", border: "1px solid color-mix(in srgb, var(--coral) 35%, transparent)", color: "var(--coral)", fontSize: 13, fontWeight: 600, textAlign: "center", maxWidth: "calc(100vw - 32px)" }}>
          Reconnecting to matchmaking… your squad is still in the queue.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <div role="status" aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 9, justifyContent: "center", color: textMuted, fontFamily: "var(--font-body)", fontSize: isShortPhone ? 13 : 14, fontWeight: 500, letterSpacing: "0.01em" }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, flexShrink: 0, background: "var(--live)" }} />
          <span>{progressLabel}<span style={{ opacity: 0.7 }}>…</span></span>
        </div>
        <div style={{ color: "color-mix(in srgb, var(--text-muted) 78%, transparent)", fontSize: isShortPhone ? 12 : 13 }}>We&apos;ll bring you a compatible squad as soon as one is online.</div>
      </div>

      <Button onClick={handleCancel} loading={cancelling} variant="ghost" style={{ minWidth: 176, width: isPhone ? "100%" : undefined }}>
        {cancelError ? "Try cancel again" : "Cancel search"}
      </Button>
      {cancelError && (
        <div role="alert" style={{ color: "var(--coral)", fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 13, fontWeight: 700, textAlign: "center", maxWidth: 360 }}>
          {cancelError}
        </div>
      )}
    </div>
  );
}

export default function MatchmakingPage() {
  return (
    <Suspense fallback={<div style={{ color: "var(--text-muted)", padding: 40 }}>Loading…</div>}>
      <MatchmakingInner />
    </Suspense>
  );
}
