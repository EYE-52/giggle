"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logomark } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { api, connectSocket, SOCKET_EVENTS } from "@giggle/core";
import type { SquadState } from "@giggle/core";
import { useViewport } from "@/components/useViewport";
import { Button } from "@/components/Button";
import { StatTile } from "@/components/StatTile";

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
  const [matchVisible, setMatchVisible] = useState(false);
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
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // getSquad silent auto-retry timer — cleared on unmount so the retry can't
  // setState after the page is gone.
  const squadRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearRevealTimers() {
    if (revealTimeoutRef.current) {
      clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = null;
    }
    if (navigationTimeoutRef.current) {
      clearTimeout(navigationTimeoutRef.current);
      navigationTimeoutRef.current = null;
    }
  }

  const violet = "var(--accent, var(--violet))";
  const textPrimary = "var(--text)";
  const textMuted = "var(--text-muted)";


  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const progressLabel = elapsed < 4
    ? "Checking active squads"
    : elapsed < 10
      ? "Matching your squad's vibes"
      : "Finding the strongest live match";

  useEffect(() => {
    if (!squadId) return;

    // Load squad; on failure attempt one silent auto-retry before surfacing "?".
    fetchSquad(true);

    const tick = setInterval(() => setElapsed(e => e + 1), 1000);

    const pollInterval = setInterval(async () => {
      // Once the user has cancelled, stop polling entirely — a late "matched"
      // response must not resurrect the search or trigger a reveal.
      if (cancelledRef.current) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const status = await api.matchStatus(squadId);
        if (cancelledRef.current) return;
        // Poll succeeded — recover silently from any reconnect state.
        if (pollFailuresRef.current > 0) {
          pollFailuresRef.current = 0;
          setPollFailures(0);
        }
        if (status.state === "matched" && status.match) {
          clearInterval(pollInterval);
          triggerMatchReveal(status.match.encounterId);
        }
      } catch {
        pollFailuresRef.current += 1;
        setPollFailures(pollFailuresRef.current);
      }
    }, 2000);

    const socket = connectSocket(squadId);
    const onMatchFound = ({ encounterId, opponentSquadName }: { encounterId: string; opponentSquadName?: string }) => {
      if (cancelledRef.current) return;
      clearInterval(pollInterval);
      triggerMatchReveal(encounterId, opponentSquadName);
    };
    socket.on(SOCKET_EVENTS.MATCH_FOUND, onMatchFound);

    return () => {
      clearInterval(tick);
      clearInterval(pollInterval);
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
    // Brief mount delay so the animation plays
    revealTimeoutRef.current = setTimeout(() => setMatchVisible(true), 30);
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
    // Stop the local timers right away — don't wait for unmount cleanup.
    clearRevealTimers();
    if (squadRetryTimeoutRef.current) {
      clearTimeout(squadRetryTimeoutRef.current);
      squadRetryTimeoutRef.current = null;
    }
    // Best-effort: ask the backend to leave the queue, but ALWAYS return to the
    // lobby afterwards — a failed/slow dequeue call must never trap the user on
    // this screen. (The lobby re-syncs queue state, so a stale entry self-heals.)
    try {
      await api.cancelSearch(squadId);
    } catch {
      // swallow — we navigate regardless
    }
    router.push(`/lobby?squad=${squadId}`);
  }

  if (!squadId) {
    return (
      <div data-theme="dark" style={{ height: "100%", display: "grid", placeItems: "center", background: "#0B0B0F", padding: 24 }}>
        <div style={{ width: "min(460px, 100%)", background: "linear-gradient(145deg, #1a1228 0%, #0e0e18 100%)", border: "1.5px solid rgba(124,92,255,0.38)", borderRadius: 24, padding: isPhone ? 24 : 32, textAlign: "center", boxShadow: "0 24px 64px rgba(0,0,0,0.55)" }}>
          <div style={{ width: 58, height: 58, borderRadius: 18, margin: "0 auto 16px", display: "grid", placeItems: "center", background: "rgba(124,92,255,0.14)", border: "1px solid rgba(124,92,255,0.3)" }}>
            <Icon.discover size={25} color="var(--lime)" />
          </div>
          <h1 style={{ margin: 0, color: textPrimary, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700, letterSpacing: "-0.03em" }}>No squad selected</h1>
          <p style={{ margin: "10px 0 22px", color: textMuted, lineHeight: 1.5, fontSize: 14 }}>Start matchmaking from a squad lobby so we know who to pair you with.</p>
          <Button onClick={() => router.push("/home")} variant="primary">Back to home</Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes radarPulse {
          0% { transform: scale(1); opacity: 0.55; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes breatheGlow {
          0%, 100% { box-shadow: 0 0 32px -4px #7C5CFF, 0 0 0px #7C5CFF; }
          50% { box-shadow: 0 0 52px 2px #7C5CFF, 0 0 80px -10px #7C5CFF55; }
        }
        /* The radar sweep + its glowing leading edge share ONE clock so they
           stay perfectly locked together as they rotate. */
        @keyframes sweepSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        /* Blips: a faint contact that fades up then out, on a stagger. */
        @keyframes blipPulse {
          0%, 100% { transform: scale(0.6); opacity: 0; }
          8% { opacity: 0.9; }
          45% { transform: scale(1); opacity: 0.55; }
          70% { opacity: 0; }
        }
        @keyframes statusDot {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(163,230,53,0.5); }
          50% { opacity: 0.4; box-shadow: 0 0 0 5px rgba(163,230,53,0); }
        }
        @keyframes matchRevealBg {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes matchRevealCard {
          0% { transform: translate(-50%, -50%) scale(0.7); opacity: 0; }
          55% { transform: translate(-50%, -50%) scale(1.04); opacity: 1; }
          80% { transform: translate(-50%, -50%) scale(0.98); }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }
        @keyframes opponentSlideIn {
          from { transform: translateY(28px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }

        /* ── PREMIUM MICRO-INTERACTION SPEC (shared) ── */
        [data-theme="dark"] button:not(:disabled) {
          -webkit-tap-highlight-color: transparent;
          transition: transform .14s cubic-bezier(.22,1,.36,1), box-shadow .2s cubic-bezier(.4,0,.2,1), background .2s cubic-bezier(.4,0,.2,1), color .2s cubic-bezier(.4,0,.2,1), border-color .2s cubic-bezier(.4,0,.2,1), filter .2s cubic-bezier(.4,0,.2,1);
        }
        [data-theme="dark"] button:not(:disabled):active {
          transform: scale(.94) !important;
          transition-duration: .06s;
        }
        [data-theme="dark"] button:disabled { cursor: not-allowed; }
        [data-theme="dark"] button:focus-visible {
          outline: none;
          box-shadow: 0 0 0 2px #0B0B0F, 0 0 0 4px var(--violet, #7C5CFF);
        }
        @media (prefers-reduced-motion: reduce) {
          [data-theme="dark"] *,
          [data-theme="dark"] *::before,
          [data-theme="dark"] *::after {
            animation-duration: .001ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: .001ms !important;
          }
          [data-theme="dark"] button:not(:disabled):active { transform: none !important; }
        }
      `}</style>

      {/* Match-found overlay */}
      {matchFound && (
        <div role="status" aria-live="assertive" style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(11,11,15,0.82)",
          backdropFilter: "blur(12px)",
          animation: "matchRevealBg 0.35s ease",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {/* SR announcement — visually hidden, read via the aria-live overlay */}
          <span style={{
            position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
            overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" as const, border: 0,
          }}>Match found — starting now.</span>
          <div aria-hidden style={{
            position: "absolute", top: "50%", left: "50%",
            animation: matchVisible ? "matchRevealCard 0.65s cubic-bezier(0.34,1.56,0.64,1) both" : "none",
            background: "linear-gradient(145deg, #1a1228 0%, #0e0e18 100%)",
            border: "1.5px solid rgba(124,92,255,0.53)",
            borderRadius: 28,
            padding: isPhone ? "28px 24px" : "40px 48px",
            textAlign: "center",
            boxShadow: "0 0 80px -16px #7C5CFF, 0 24px 64px rgba(0,0,0,0.6)",
            minWidth: isPhone ? "calc(100vw - 48px)" : 320,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 20,
          }}>
            {/* Shimmer badge */}
            <div style={{
              background: "linear-gradient(90deg, rgba(124,92,255,0.2), rgba(124,92,255,0.6), rgba(194,255,61,0.53), rgba(124,92,255,0.6), rgba(124,92,255,0.2))",
              backgroundSize: "200% auto",
              animation: "shimmer 1.4s linear infinite",
              borderRadius: 999,
              padding: "6px 20px",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase" as const,
              color: "#fff",
            }}>Match Found</div>

            <div style={{
              fontFamily: "var(--font-display, var(--font-space-grotesk))",
              fontSize: isPhone ? 22 : 30, fontWeight: 700, color: "#F4F4F7",
              letterSpacing: "-0.03em", lineHeight: 1.1,
            }}>Squad located!</div>

            {matchFound.opponentName && (
              <div style={{
                animation: "opponentSlideIn 0.5s 0.4s both",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              }}>
                <div style={{ color: "#9A9AB0", fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>You matched with</div>
                <div style={{
                  fontFamily: "var(--font-display, var(--font-space-grotesk))",
                  fontSize: 22, fontWeight: 700, color: "var(--lime-text, #C2FF3D)",
                }}>{matchFound.opponentName}</div>
              </div>
            )}

            <div style={{
              color: "#9A9AB0", fontSize: 14,
              animation: "opponentSlideIn 0.5s 0.6s both",
            }}>Heading to the encounter…</div>

            {/* Animated dots */}
            <div style={{ display: "flex", gap: 6, animation: "opponentSlideIn 0.4s 0.8s both" }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: "#7C5CFF",
                  animation: `radarPulse 1.2s ${i * 0.2}s ease-in-out infinite`,
                }} />
              ))}
            </div>
          </div>
        </div>
      )}

      <div data-theme="dark" style={{
        height: "100%",
        minHeight: 0,
        width: "100%",
        background: "#0B0B0F",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: isShortPhone ? 10 : isPhone ? 18 : 28,
        padding: isShortPhone ? "10px 16px" : isPhone ? "20px 16px" : "24px",
        boxSizing: "border-box",
        overflow: "hidden",
        position: "relative",
      }}>
        {/* ── RADAR HERO — a clean, perfectly-centered scanning radar. Concentric
            rings + spoke grid + dot-grid for depth, a smooth conic-gradient sweep
            with a soft fading trail and a glowing leading edge, and the Giggle
            logomark centered as the squad's identity. All layers are the SAME
            centered square so nothing drifts or misaligns. ── */}
        {(() => {
          const dim = isShortPhone ? 190 : isPhone ? 244 : 340;
          // Concentric ring diameters as a fraction of the outer disc.
          const rings = [1, 0.7, 0.4];
          const centerSize = isShortPhone ? 58 : isPhone ? 66 : 96;
          // Two deterministic "contacts" — fixed positions, staggered pulse.
          const blips = [
            { x: 0.70, y: 0.32, delay: "0.4s" },
            { x: 0.30, y: 0.66, delay: "2.1s" },
          ];
          // Every rotating layer shares this duration so they stay locked.
          const sweep = "5.2s";
          return (
        <div aria-hidden style={{ position: "relative", zIndex: 1, flexShrink: 0, width: dim, height: dim, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* Soft violet glow behind the whole radar */}
          <div style={{
            position: "absolute", width: dim * 1.05, height: dim * 1.05, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(124,92,255,0.20) 0%, rgba(124,92,255,0.06) 42%, transparent 68%)",
            filter: "blur(2px)",
          }} />

          {/* Dot-grid + radial spoke lines, masked to a disc and faded at the rim */}
          <div style={{
            position: "absolute", width: dim, height: dim, borderRadius: "50%",
            backgroundImage: [
              "repeating-conic-gradient(from 0deg, rgba(124,92,255,0.10) 0deg 0.4deg, transparent 0.4deg 30deg)",
              "radial-gradient(rgba(124,92,255,0.16) 1px, transparent 1.6px)",
            ].join(","),
            backgroundSize: `auto, ${isPhone ? 16 : 20}px ${isPhone ? 16 : 20}px`,
            maskImage: "radial-gradient(circle, #000 58%, transparent 74%)",
            WebkitMaskImage: "radial-gradient(circle, #000 58%, transparent 74%)",
          }} />

          {/* Concentric rings — statically centered, perfectly aligned */}
          {rings.map((f, i) => (
            <div key={`ring${i}`} style={{
              position: "absolute", width: dim * f, height: dim * f, borderRadius: "50%",
              border: `1px solid rgba(124,92,255,${0.34 - i * 0.06})`,
            }} />
          ))}

          {/* The SWEEP — a conic gradient with a soft fading trail. Masked to a
              disc so it reads as a beam fanning out from the centre. */}
          <div style={{
            position: "absolute", width: dim, height: dim, borderRadius: "50%",
            background: "conic-gradient(from 0deg, rgba(124,92,255,0) 0deg, rgba(124,92,255,0) 235deg, rgba(124,92,255,0.05) 285deg, rgba(124,92,255,0.22) 336deg, rgba(163,230,53,0.42) 357deg, rgba(163,230,53,0.55) 360deg)",
            maskImage: "radial-gradient(circle, #000 0%, #000 57%, transparent 72%)",
            WebkitMaskImage: "radial-gradient(circle, #000 0%, #000 57%, transparent 72%)",
            animation: `sweepSpin ${sweep} linear infinite`,
          }} />

          {/* Glowing leading edge — a thin line pinned to the sweep's front, on
              the SAME clock so it tracks the beam exactly */}
          <div style={{
            position: "absolute", width: dim, height: dim, animation: `sweepSpin ${sweep} linear infinite`,
          }}>
            <div style={{
              position: "absolute", left: "50%", top: 0, height: "50%", width: 2,
              transformOrigin: "bottom center", transform: "translateX(-50%)",
              background: "linear-gradient(to top, rgba(163,230,53,0) 0%, rgba(163,230,53,0.35) 60%, rgba(163,230,53,0.9) 100%)",
              boxShadow: "0 0 10px 1px rgba(163,230,53,0.5)",
              borderRadius: 2,
            }} />
          </div>

          {/* Deterministic scan contacts (blips) */}
          {blips.map((b, i) => (
            <div key={`blip${i}`} style={{
              position: "absolute", left: `${b.x * 100}%`, top: `${b.y * 100}%`,
              width: 7, height: 7, marginLeft: -3.5, marginTop: -3.5, borderRadius: "50%",
              background: "var(--lime, #A3E635)",
              boxShadow: "0 0 8px 1px rgba(163,230,53,0.7)",
              animation: `blipPulse 5.2s ${b.delay} ease-in-out infinite`,
            }} />
          ))}

          {/* Center: Giggle logomark — the squad identity, with a breathing glow */}
          <div style={{ position: "relative", zIndex: 3 }}>
            <div style={{
              width: centerSize, height: centerSize, borderRadius: "50%",
              background: "radial-gradient(circle at 50% 38%, #16112a 0%, #0d0c14 100%)",
              border: `1.5px solid ${violet}`,
              animation: "breatheGlow 3.2s ease-in-out infinite",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Logomark size={isShortPhone ? 30 : isPhone ? 34 : 48} />
            </div>
          </div>
        </div>
          );
        })()}

        {/* Title + subtitle — clearly below the radar with real breathing room */}
        <div style={{ position: "relative", zIndex: 1, textAlign: "center", display: "flex", flexDirection: "column", gap: 8, maxWidth: 460 }}>
          <h1 style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: isShortPhone ? 22 : isPhone ? 22 : 30, fontWeight: 700, color: textPrimary, letterSpacing: "-0.02em", margin: 0 }}>Finding your match…</h1>
          <div style={{ color: textMuted, fontSize: isShortPhone ? 12 : 14 }}>
            {isShortPhone && elapsed >= 20 ? "Still searching — few squads are live right now." : "Looking for a squad that matches your crew's vibe."}
          </div>
          {/* Reassurance for a lone searcher with no match after ~20s — avoids the
              "stuck forever with no feedback" feeling. The Cancel button below is
              always available as the escape hatch. */}
          {elapsed >= 20 && !matchFound && !isShortPhone && !showLongSearch && (
            <div style={{
              marginTop: 4,
              maxWidth: 420,
              alignSelf: "center",
              padding: isPhone ? "10px 16px" : "12px 20px",
              borderRadius: 14,
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: textMuted,
              fontSize: 14,
              lineHeight: 1.5,
            }}>
              Still searching — not many squads are live right now. Hang tight, or invite a friend.
            </div>
          )}
        </div>

        {/* ── Long-search branch card — after 75s with no match, offer clear paths
            forward. Search keeps running unless the user bails. ── */}
        {showLongSearch && (
          <div role="status" style={{
            position: "relative", zIndex: 2,
            width: "min(440px, calc(100vw - 32px))",
            background: "linear-gradient(145deg, #1a1228 0%, #0e0e18 100%)",
            border: "1.5px solid rgba(124,92,255,0.38)",
            borderRadius: "var(--radius-card, 20px)",
            padding: isShortPhone ? "12px 14px" : isPhone ? "16px 18px" : "18px 22px",
            boxShadow: "0 18px 50px rgba(0,0,0,0.5)",
            display: "flex", flexDirection: "column", gap: 12, textAlign: "center",
          }}>
            <div style={{ color: textPrimary, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 17, fontWeight: 700, lineHeight: 1.4 }}>
              Still looking — no squads are free right now.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" as const }}>
              <Button variant="tonal" size="sm" onClick={() => setLongSearchBaseline(elapsed)}>Keep waiting</Button>
              <Button variant="secondary" size="sm" onClick={() => router.push("/friends")}>Invite friends</Button>
              <Button variant="ghost" size="sm" onClick={handleCancel} loading={cancelling}>Back to lobby</Button>
            </div>
          </div>
        )}

        {/* ── Stats — v3 StatTile row (spec 04) ── */}
        <div style={{
          position: "relative", zIndex: 1,
          display: "flex", gap: isShortPhone ? 8 : 12, justifyContent: "center",
          maxWidth: "min(720px, calc(100vw - 32px))",
          flexWrap: "wrap" as const,
        }}>
          <StatTile label="Elapsed" value={fmt(elapsed)} />
          <StatTile
            label="Squad size"
            value={
              <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8 }}>
                {`${squad?.members.length ?? "?"} / ${squad?.maxSlots ?? 4}`}
                {squadError && !squad && (
                  <button
                    onClick={() => fetchSquad(false)}
                    style={{
                      padding: 0, border: "none", background: "transparent",
                      color: "var(--accent, var(--violet-bright))", fontSize: 12, fontWeight: 700,
                      fontFamily: "var(--font-body)",
                      textDecoration: "underline", cursor: "pointer",
                    }}
                  >Retry</button>
                )}
              </span>
            }
          />
          <StatTile
            label="Status"
            live={!!matchFound}
            value={matchFound ? "Found!" : pollFailures >= 3 ? "Reconnecting…" : "Searching"}
          />
        </div>

        {/* Reconnect note — after ≥3 consecutive poll failures; clears itself on success. */}
        {pollFailures >= 3 && !matchFound && (
          <div role="status" style={{
            position: "relative", zIndex: 1,
            padding: "8px 18px", borderRadius: 999,
            background: "var(--coral-soft)",
            border: "1px solid color-mix(in srgb, var(--coral) 35%, transparent)",
            color: "var(--coral)",
            fontSize: 13, fontWeight: 600, textAlign: "center",
            maxWidth: "calc(100vw - 32px)",
          }}>
            Reconnecting to matchmaking… your squad is still in the queue.
          </div>
        )}

        {/* Queue signal — AMBIENT status, not an action. A small pulsing live dot
            + muted rotating copy. Deliberately borderless / no button chrome so it
            can never be mistaken for something tappable. */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <div
            role="status"
            aria-live="polite"
            style={{
              display: "inline-flex", alignItems: "center", gap: 9, justifyContent: "center",
              color: textMuted,
              fontFamily: "var(--font-body)", fontSize: isShortPhone ? 13 : 14, fontWeight: 500,
              letterSpacing: "0.01em",
            }}
          >
            <span aria-hidden style={{
              width: 8, height: 8, borderRadius: 999, flexShrink: 0,
              background: "var(--live, #A3E635)",
              animation: "statusDot 1.6s ease-in-out infinite",
            }} />
            <span>{progressLabel}<span style={{ opacity: 0.7 }}>…</span></span>
          </div>
          <div style={{ color: "color-mix(in srgb, var(--text-muted) 78%, transparent)", fontSize: isShortPhone ? 12 : 13 }}>
            We&apos;ll bring you a compatible squad as soon as one is online.
          </div>
        </div>

        <Button
          onClick={handleCancel}
          loading={cancelling}
          variant="ghost"
          style={{ position: "relative", zIndex: 1, minWidth: 176, width: isPhone ? "100%" : undefined }}
        >
          {cancelError ? "Try cancel again" : "Cancel search"}
        </Button>
        {cancelError && (
          <div role="alert" style={{
            position: "relative",
            zIndex: 1,
            color: "var(--coral)",
            fontFamily: "var(--font-display, var(--font-space-grotesk))",
            fontSize: 13,
            fontWeight: 700,
            textAlign: "center",
            maxWidth: 360,
          }}>
            {cancelError}
          </div>
        )}
      </div>
    </>
  );
}

export default function MatchmakingPage() {
  return (
    <Suspense fallback={<div style={{ color: "var(--text-muted)", padding: 40 }}>Loading…</div>}>
      <MatchmakingInner />
    </Suspense>
  );
}
