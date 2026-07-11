"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AvatarStack } from "@/components/Avatar";
import { useViewport } from "@/components/useViewport";
import { api, session, resolveCover } from "@giggle/core";
import type { EncounterDetail, SquadState } from "@giggle/core";

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
  const [actionError, setActionError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinPressed, setJoinPressed] = useState(false);
  const [skipping, setSkipping] = useState(false);
  // Start at 20s (not 30) — the server handoff TTL is shorter than 30s, so a
  // 30s client countdown lets users click after the ack already expired.
  const [countdown, setCountdown] = useState(20);
  const [joinHovered, setJoinHovered] = useState(false);
  const [skipHovered, setSkipHovered] = useState(false);
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

  // Leader detection — only the squad leader may call the leader-only skip.
  const myMember = squad?.members.find(m => m.userId === session.user?.id);
  const isLeader = !!myMember && myMember.role === "leader";
  const isLeaderRef = useRef(false);
  useEffect(() => { isLeaderRef.current = isLeader; }, [isLeader]);

  const violet = "var(--violet)";
  const lime = "var(--lime)";
  const limeText = "var(--lime-text)";
  const textPrimary = "var(--text)";
  const textMuted = "var(--text-muted)";

  useEffect(() => {
    // Reached without the required params (e.g. direct URL) — recover instead of
    // showing a broken VS screen and redirecting to an empty ?squad=.
    if (!encId || !squadId) { router.replace(squadId ? `/matchmaking?squad=${squadId}` : "/home"); return; }
    let cancelled = false;
    setLoading(true);
    setHandoffError(null);
    Promise.all([
      api.getEncounter(encId),
      api.getSquad(squadId).catch(() => null),
    ]).then(([encounterData, squadData]) => {
      if (cancelled) return;
      setEncounter(encounterData);
      if (squadData) setSquad(squadData);
      setLoading(false);
      // Keep the updater pure — only decrement. Side-effects (skip/navigate) on
      // expiry are handled in the effect below, never inside a state updater
      // (calling router.push() during a render-phase updater triggers React's
      // "setState while rendering a different component" error).
      tickRef.current = setInterval(() => setCountdown(c => (c <= 0 ? 0 : c - 1)), 1000);
    }).catch(() => {
      if (cancelled) return;
      setHandoffError("This match handoff has expired.");
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

  async function handleJoin() {
    if (!encId || !squadId || joining) return;
    setActionError(null);
    // Don't clear the countdown timer yet — only stop it once the ack SUCCEEDS.
    // If the ack fails (e.g. server handoff TTL expired), the countdown's
    // expiry effect still runs as a fallback so the user is never stranded.
    setJoining(true);
    setJoinPressed(true);
    try {
      await api.ackEncounter(encId, squadId);
      // Ack confirmed — now it's safe to stop the auto-skip countdown.
      if (tickRef.current) clearInterval(tickRef.current);
      clearDeferredNavigation();
      // Brief join animation plays (~500ms), then navigate
      joinNavTimeoutRef.current = setTimeout(() => {
        navigate(`/encounter?squad=${squadId}&enc=${encId}`);
      }, 520);
    } catch (e) {
      // Handoff expired / ack rejected — don't dead-end on a failing button.
      // Show a clear message and auto-redirect to matchmaking for a fresh match.
      console.error("ackEncounter failed:", e);
      setJoinPressed(false);
      setJoinExpired(true);
      clearDeferredNavigation();
      expiredNavTimeoutRef.current = setTimeout(() => {
        navigate(`/matchmaking?squad=${squadId}`);
      }, 1500);
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

  const mySquadName = squad?.squadName ?? encounter?.squadAName ?? "Your Squad";
  const opponentName = encounter
    ? (encounter.squadAId === squadId ? encounter.squadBName : encounter.squadAName)
    : "Finding opponent…";
  const myCover = encounter
    ? (encounter.squadAId === squadId ? encounter.squadACover : encounter.squadBCover)
    : null;
  const opponentCover = encounter
    ? (encounter.squadAId === squadId ? encounter.squadBCover : encounter.squadACover)
    : null;

  const myMembers = squad?.members.map(m => m.displayName) ?? [];
  const opponentMembers = (encounter
    ? (encounter.squadAId === squadId ? encounter.squadBMembers : encounter.squadAMembers)
    : null
  )?.map((m: { displayName: string }) => m.displayName) ?? [];

  // Vibe chip — derive from the squad's real tags rather than hardcoded text.
  const vibeLabel = (squad?.tags && squad.tags.length > 0)
    ? squad.tags.slice(0, 2).join(" & ")
    : null;

  // Countdown ring
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const progress = countdown / 20;

  if (loading) {
    return (
      <div data-theme="dark" style={{ minHeight: "100%", display: "grid", placeItems: "center", background: "var(--bg)", color: "var(--text-muted)", fontFamily: "var(--font-space-grotesk)", fontWeight: 800 }}>
        Opening match...
      </div>
    );
  }

  if (handoffError || !encounter) {
    return (
      <div data-theme="dark" style={{ minHeight: "100%", display: "grid", placeItems: "center", background: "var(--bg)", padding: 24 }}>
        <div style={{ width: "min(460px, 100%)", textAlign: "center", background: "linear-gradient(155deg, var(--surface-grad-from), var(--surface-grad-to))", border: "1px solid var(--border-strong)", borderRadius: 20, padding: 24, boxShadow: "var(--elev)" }}>
          <h1 style={{ margin: 0, color: "var(--text)", fontFamily: "var(--font-space-grotesk)", fontSize: 24, letterSpacing: "-0.03em" }}>Match expired</h1>
          <p style={{ margin: "10px 0 22px", color: "var(--text-muted)", lineHeight: 1.5, fontSize: 14.5 }}>{handoffError ?? "This match is no longer available."}</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => router.push(squadId ? `/matchmaking?squad=${squadId}` : "/home")} className="gg-press" style={{ height: 42, padding: "0 18px", borderRadius: 999, border: "none", background: "var(--violet)", color: "#fff", fontWeight: 800, cursor: "pointer" }}>Find another</button>
            <button onClick={() => router.push("/home")} className="gg-press" style={{ height: 42, padding: "0 18px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--overlay)", color: "var(--text)", fontWeight: 800, cursor: "pointer" }}>Home</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes slideLeft { from { transform: translateX(-60px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes slideRight { from { transform: translateX(60px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes popIn { 0% { transform: translate(-50%, -50%) scale(0.6); opacity: 0; } 60% { transform: translate(-50%, -50%) scale(1.08); } 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; } }
        @keyframes fadeUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes joinFlash {
          0% { transform: translate(-50%, -50%) scale(1); }
          30% { transform: translate(-50%, -50%) scale(1.12); }
          60% { transform: translate(-50%, -50%) scale(0.96); }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
        }
        @keyframes squadRushLeft {
          0% { transform: translateX(0); opacity: 1; }
          100% { transform: translateX(40%); opacity: 0; }
        }
        @keyframes squadRushRight {
          0% { transform: translateX(0); opacity: 1; }
          100% { transform: translateX(-40%); opacity: 0; }
        }
        @keyframes panelFade {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes vibeChipIn {
          from { transform: translateY(12px) scale(0.92); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        /* ── PREMIUM MICRO-INTERACTION SPEC (shared) ── */
        .match-fx button:not(:disabled) {
          -webkit-tap-highlight-color: transparent;
          transition: transform .14s cubic-bezier(.22,1,.36,1), box-shadow .2s cubic-bezier(.4,0,.2,1), background .2s cubic-bezier(.4,0,.2,1), color .2s cubic-bezier(.4,0,.2,1), border-color .2s cubic-bezier(.4,0,.2,1), filter .2s cubic-bezier(.4,0,.2,1);
        }
        .match-fx button:not(:disabled):active {
          transform: scale(.94) !important;
          transition-duration: .06s;
        }
        .match-fx button:disabled { cursor: not-allowed; }
        .match-fx button:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px var(--bg, #0B0B0F), 0 0 0 4px var(--violet, #7C5CFF);
        }
        @media (prefers-reduced-motion: reduce) {
          .match-fx *,
          .match-fx *::before,
          .match-fx *::after {
            animation-duration: .001ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .001ms !important;
          }
          .match-fx button:not(:disabled):active { transform: none !important; }
        }
        @media (max-width: 640px) and (max-height: 680px) {
          .match-squad-panel { min-height: 140px !important; }
          .match-center { gap: 10px !important; padding: 12px 0 !important; }
          .match-vs { width: 52px !important; height: 52px !important; }
          .match-card { gap: 10px !important; padding: 14px 16px !important; }
          .match-countdown { display: none !important; }
        }
      `}</style>

      <div className="match-fx" style={{
        position: "relative",
        display: "grid", gridTemplateColumns: isPhone ? "1fr" : "1fr 1fr",
        height: "100%", minHeight: 0,
        borderRadius: 0, overflowX: "hidden", overflowY: isPhone ? "auto" : "hidden",
        border: "none",
      }}>
        {/* YOUR SQUAD panel */}
        <div className="match-squad-panel" style={{
          position: "relative", minHeight: isPhone ? 200 : 520,
          gridRow: isPhone ? 1 : undefined,
          background: "#0e0b1e",
          animation: joinPressed ? "squadRushLeft 0.5s ease-in both" : "slideLeft 0.55s ease both",
          display: "flex", flexDirection: "column", justifyContent: "flex-end",
        }}>
          <div style={{ position: "absolute", inset: 0, background: resolveCover(myCover), filter: "saturate(.85) brightness(.7)" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(9,7,18,.96) 6%, rgba(9,7,18,.55) 48%, rgba(9,7,18,.2) 100%)" }} />
          {/* Subtle glow */}
          <div style={{
            position: "absolute", inset: 0,
            background: "radial-gradient(ellipse 60% 50% at 30% 60%, rgba(124,92,255,0.09) 0%, transparent 70%)",
          }} />
          <div style={{ position: "relative", padding: isPhone ? "20px 20px" : "32px 40px" }}>
            <div style={{ color: "#9A9AB0", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" as const, marginBottom: 6 }}>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#7C5CFF", marginRight: 6, animation: "pulse 2s ease infinite", verticalAlign: "middle" }} />
              Your Squad
            </div>
            <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: isPhone ? 22 : 34, fontWeight: 800, color: "#F4F4F7", marginBottom: 10 }}>{mySquadName}</div>
            <AvatarStack names={myMembers} size={32} extra={0} />
          </div>
        </div>

        {/* OPPONENT panel */}
        <div className="match-squad-panel" style={{
          position: "relative", minHeight: isPhone ? 200 : 520,
          gridRow: isPhone ? 3 : undefined,
          background: "#0b1510",
          animation: joinPressed ? "squadRushRight 0.5s ease-in both" : "slideRight 0.55s 0.12s both",
          display: "flex", flexDirection: "column", justifyContent: "flex-end",
        }}>
          <div style={{ position: "absolute", inset: 0, background: resolveCover(opponentCover), filter: "saturate(.85) brightness(.7)" }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(6,14,9,.96) 6%, rgba(6,14,9,.55) 48%, rgba(6,14,9,.2) 100%)" }} />
          <div style={{
            position: "absolute", inset: 0,
            background: "radial-gradient(ellipse 60% 50% at 70% 60%, rgba(194,255,61,0.07) 0%, transparent 70%)",
          }} />
          <div style={{ position: "relative", padding: isPhone ? "20px 20px" : "32px 40px" }}>
            <div style={{ color: "#C2FF3D", fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase" as const, marginBottom: 6 }}>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#C2FF3D", marginRight: 6, animation: "pulse 2s 0.5s ease infinite", verticalAlign: "middle" }} />
              Opponent
            </div>
            <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: isPhone ? 22 : 34, fontWeight: 800, color: "#F4F4F7", marginBottom: 10 }}>{opponentName}</div>
            <AvatarStack names={opponentMembers} size={32} extra={0} />
          </div>
        </div>

        {/* Central VS + action card overlay */}
        <div className="match-center" style={{
          position: isPhone ? "relative" : "absolute",
          top: isPhone ? undefined : "50%",
          left: isPhone ? undefined : "50%",
          gridColumn: isPhone ? "1 / -1" : undefined,
          gridRow: isPhone ? 2 : undefined,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: isPhone ? "center" : undefined, gap: 20,
          zIndex: 20,
          padding: isPhone ? "24px 0" : undefined,
          animation: isPhone
            ? (joinPressed ? "panelFade 0.5s ease both" : "fadeUp 0.45s 0.15s both")
            : (joinPressed ? "joinFlash 0.5s ease both" : "popIn 0.65s 0.25s both"),
        }}>
          {/* VS circle */}
          <div className="match-vs" style={{
            width: 72, height: 72, borderRadius: "50%",
            background: "var(--bg)",
            border: "1px solid var(--border-strong)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-space-grotesk)", fontSize: 20, fontWeight: 800, color: textPrimary,
            boxShadow: "0 8px 28px rgba(0,0,0,.36)",
          }}>VS</div>

          {/* Match Found card */}
          <div className="match-card" style={{
            background: "rgba(18,22,21,.96)", border: "1px solid var(--border-strong)",
            backdropFilter: "blur(16px)", borderRadius: 16,
            padding: isPhone ? "20px 20px" : "28px 36px", textAlign: "center",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
            minWidth: isPhone ? "calc(100vw - 48px)" : 296,
            boxShadow: "0 18px 50px rgba(0,0,0,.42)",
          }}>
            <div style={{
              fontFamily: "var(--font-space-grotesk)", fontSize: 26, fontWeight: 800,
              color: textPrimary, letterSpacing: "-0.5px",
            }}>Match found</div>

            {/* Vibe chip — only when we have real squad tags */}
            {vibeLabel && (
              <div style={{
                borderRadius: 0, padding: 0,
                fontSize: 13, fontWeight: 600, color: textMuted,
                animation: "vibeChipIn 0.4s 0.55s both",
              }}>
                Vibe match · {vibeLabel}
              </div>
            )}

            {/* Countdown ring */}
            <div className="match-countdown" style={{ position: "relative", width: 80, height: 80 }}>
              <svg width="80" height="80" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r={radius} fill="none" stroke="var(--border)" strokeWidth="6" />
                <circle cx="40" cy="40" r={radius} fill="none" stroke={lime} strokeWidth="6"
                  strokeDasharray={`${circumference * progress} ${circumference}`}
                  strokeLinecap="round" transform="rotate(-90 40 40)"
                  style={{ transition: "stroke-dasharray 0.9s linear" }}
                />
              </svg>
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "var(--font-space-grotesk)", fontSize: 22, fontWeight: 700, color: textPrimary,
              }}>{countdown}</div>
            </div>

            {/* Join button — fixed width, no reflow */}
            <button
              onClick={handleJoin}
              disabled={joining}
              onMouseEnter={() => setJoinHovered(true)}
              onMouseLeave={() => setJoinHovered(false)}
              style={{
                width: isPhone ? "100%" : 220, padding: "15px 0", borderRadius: 10, border: "none",
                background: joining ? "rgba(118,87,255,.55)" : joinHovered ? "var(--violet-bright)" : "var(--violet)",
                color: "#fff",
                fontFamily: "var(--font-space-grotesk)", fontSize: 16, fontWeight: 700,
                cursor: joining ? "not-allowed" : "pointer",
                transition: "background 0.2s ease, box-shadow 0.2s ease, transform 0.12s ease",
                boxShadow: "none",
                transform: joinHovered && !joining ? "scale(1.03)" : "scale(1)",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {joinExpired ? "Match expired" : joining ? (
                <>
                  <span style={{
                    display: "inline-block", width: 14, height: 14, borderRadius: "50%",
                    border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff",
                    animation: "rotateSlow 0.7s linear infinite",
                  }} />
                  Joining…
                </>
              ) : "Join Encounter"}
            </button>

            {joinExpired && (
              <div style={{
                color: limeText, fontFamily: "var(--font-space-grotesk)", fontSize: 13,
                width: isPhone ? "100%" : 220, textAlign: "center",
                animation: "pulse 1.2s ease infinite",
              }}>
                This match expired — finding you another…
              </div>
            )}

            {actionError && (
              <div role="alert" style={{
                color: "var(--coral)",
                fontFamily: "var(--font-space-grotesk)",
                fontSize: 13,
                fontWeight: 700,
                width: isPhone ? "100%" : 220,
                textAlign: "center",
                lineHeight: 1.35,
              }}>
                {actionError}
              </div>
            )}

            {isLeader ? (
              <button
                onClick={handleSkip}
                disabled={skipping}
                onMouseEnter={() => setSkipHovered(true)}
                onMouseLeave={() => setSkipHovered(false)}
                style={{
                  background: "transparent", border: "none",
                  color: skipHovered ? textPrimary : textMuted,
                  cursor: skipping ? "not-allowed" : "pointer",
                  fontFamily: "var(--font-space-grotesk)", fontSize: 14,
                  transition: "color .15s ease",
                  width: isPhone ? "100%" : 220,
                  whiteSpace: "nowrap" as const,
                  display: "inline-flex" as const,
                  alignItems: "center" as const,
                  justifyContent: "center" as const,
                  padding: "8px 0",
                }}
              >{skipping ? "Skipping…" : `Skip (${countdown}s)`}</button>
            ) : (
              <div style={{
                color: textMuted, fontFamily: "var(--font-space-grotesk)", fontSize: 13,
                width: isPhone ? "100%" : 220, textAlign: "center", padding: "8px 0",
              }}>
                Auto-continues in {countdown}s
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Spinner keyframe needed inline for the joining spinner */}
      <style>{`
        @keyframes rotateSlow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </>
  );
}

export default function MatchPage() {
  return (
    <Suspense fallback={<div style={{ color: "var(--text-muted)", padding: 40 }}>Loading match…</div>}>
      <MatchInner />
    </Suspense>
  );
}
