"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Logomark } from "@/components/Brand";
import { AvatarArt } from "@/components/AvatarArt";
import { Icon } from "@/components/Icons";
import { api, connectSocket, SOCKET_EVENTS, session, getMyAvatar, subscribeAvatar, DEFAULT_AVATAR_ID } from "@giggle/core";
import type { SquadState } from "@giggle/core";
import { useViewport } from "@/components/useViewport";

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
  // Both the socket event and the 2s poll can fire — ensure we reveal/navigate once.
  const revealedRef = useRef(false);
  const revealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Local user's chosen avatar (SSR-safe: read after mount)
  const [myAvatar, setMyAvatar] = useState<string>(DEFAULT_AVATAR_ID);
  useEffect(() => {
    setMyAvatar(getMyAvatar());
    return subscribeAvatar((v) => setMyAvatar(v));
  }, []);

  const violet = "var(--violet)";
  const lime = "var(--lime)";
  const limeText = "var(--lime-text)";
  const textPrimary = "var(--text)";
  const textMuted = "var(--text-muted)";

  // Hover states
  const [statHover, setStatHover] = useState<string | null>(null);
  const [cancelHover, setCancelHover] = useState(false);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  useEffect(() => {
    if (!squadId) return;

    api.getSquad(squadId).then(setSquad).catch(() => {});

    const tick = setInterval(() => setElapsed(e => e + 1), 1000);

    const pollInterval = setInterval(async () => {
      try {
        const status = await api.matchStatus(squadId);
        if (status.state === "matched" && status.match) {
          clearInterval(pollInterval);
          triggerMatchReveal(status.match.encounterId);
        }
      } catch {}
    }, 2000);

    const socket = connectSocket(squadId);
    const onMatchFound = ({ encounterId, opponentSquadName }: { encounterId: string; opponentSquadName?: string }) => {
      clearInterval(pollInterval);
      triggerMatchReveal(encounterId, opponentSquadName);
    };
    socket.on(SOCKET_EVENTS.MATCH_FOUND, onMatchFound);

    return () => {
      clearInterval(tick);
      clearInterval(pollInterval);
      clearRevealTimers();
      socket.off(SOCKET_EVENTS.MATCH_FOUND, onMatchFound);
    };
  }, [squadId, router]);

  function triggerMatchReveal(encounterId: string, opponentName?: string) {
    if (revealedRef.current) return;
    revealedRef.current = true;
    clearRevealTimers();
    setMatchFound({ encounterId, opponentName });
    // Brief mount delay so the animation plays
    revealTimeoutRef.current = setTimeout(() => setMatchVisible(true), 30);
    // Navigate after reveal (~1.6s)
    navigationTimeoutRef.current = setTimeout(() => {
      router.push(`/match?squad=${squadId}&enc=${encounterId}`);
    }, 1650);
  }

  async function handleCancel() {
    if (!squadId) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await api.cancelSearch(squadId);
    } catch (e) {
      console.error("cancelSearch failed:", e);
      setCancelError((e as { message?: string })?.message || "Couldn't cancel search yet.");
      setCancelling(false);
      return;
    }
    router.push(`/lobby?squad=${squadId}`);
  }

  const members = squad?.members ?? [];
  // Orbit tokens for the radar — cap at 4 so they stay evenly spaced and uncrowded.
  const orbitTokens = members.slice(0, 4).map((m, i) => ({
    key: m.memberId ?? `${m.displayName}-${i}`,
    name: m.displayName,
    isMe: session.user?.id ? m.userId === session.user.id : i === 0,
    colorIndex: i,
  }));

  if (!squadId) {
    return (
      <div data-theme="dark" style={{ height: "100%", display: "grid", placeItems: "center", background: "#0B0B0F", padding: 24 }}>
        <div style={{ width: "min(460px, 100%)", background: "linear-gradient(145deg, #1a1228 0%, #0e0e18 100%)", border: "1.5px solid rgba(124,92,255,0.38)", borderRadius: 24, padding: isPhone ? 24 : 32, textAlign: "center", boxShadow: "0 24px 64px rgba(0,0,0,0.55)" }}>
          <div style={{ width: 58, height: 58, borderRadius: 18, margin: "0 auto 16px", display: "grid", placeItems: "center", background: "rgba(124,92,255,0.14)", border: "1px solid rgba(124,92,255,0.3)" }}>
            <Icon.discover size={25} color="var(--lime)" />
          </div>
          <h1 style={{ margin: 0, color: textPrimary, fontFamily: "var(--font-space-grotesk)", fontSize: 25, letterSpacing: "-0.03em" }}>No squad selected</h1>
          <p style={{ margin: "10px 0 22px", color: textMuted, lineHeight: 1.5, fontSize: 14.5 }}>Start matchmaking from a squad lobby so we know who to pair you with.</p>
          <button onClick={() => router.push("/home")} className="gg-press" style={{ minHeight: 44, padding: "0 20px", borderRadius: 999, border: "none", background: "var(--violet)", color: "#fff", fontWeight: 800, cursor: "pointer" }}>Back to home</button>
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
        @keyframes rotateSlow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes breatheGlow {
          0%, 100% { box-shadow: 0 0 32px -4px #7C5CFF, 0 0 0px #7C5CFF; }
          50% { box-shadow: 0 0 52px 2px #7C5CFF, 0 0 80px -10px #7C5CFF55; }
        }
        @keyframes centerFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes sweepSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes ripple {
          0% { transform: scale(0.35); opacity: 0; }
          12% { opacity: 0.7; }
          100% { transform: scale(1); opacity: 0; }
        }
        /* Orbits: wrapper spins, avatar counter-spins to stay upright */
        @keyframes orbitSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes orbitSpinR {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }
        @keyframes orbResolve {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }
        @keyframes pulseDot {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(194,255,61,0.55); }
          50% { opacity: 0.55; box-shadow: 0 0 0 5px rgba(194,255,61,0); }
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
        <div style={{
          position: "fixed", inset: 0, zIndex: 100,
          background: "rgba(11,11,15,0.82)",
          backdropFilter: "blur(12px)",
          animation: "matchRevealBg 0.35s ease",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
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
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase" as const,
              color: "#fff",
            }}>Match Found</div>

            <div style={{
              fontFamily: "var(--font-space-grotesk)",
              fontSize: isPhone ? 28 : 38, fontWeight: 800, color: "#F4F4F7",
              letterSpacing: "-0.03em", lineHeight: 1.1,
            }}>Squad located!</div>

            {matchFound.opponentName && (
              <div style={{
                animation: "opponentSlideIn 0.5s 0.4s both",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
              }}>
                <div style={{ color: "#9A9AB0", fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>You matched with</div>
                <div style={{
                  fontFamily: "var(--font-space-grotesk)",
                  fontSize: 24, fontWeight: 700, color: "#C2FF3D",
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
        {/* ── RADAR HERO — the centerpiece. A fixed, self-contained square so the
            orbiting avatars stay strictly INSIDE it and never collide with the
            title below. Everything else is arranged around this. ── */}
        {(() => {
          const dim = isShortPhone ? 190 : isPhone ? 244 : 380;
          const sweepSize = isShortPhone ? 132 : isPhone ? 168 : 264;     // conic beam disc
          const tokenSize = isShortPhone ? 30 : isPhone ? 34 : 44;
          // Orbit radius kept well inside the square: orbitR + token/2 < dim/2.
          const orbitR = isShortPhone ? 70 : isPhone ? 92 : 148;
          const tokens = orbitTokens.length ? orbitTokens : [{ key: "me", name: "You", isMe: true, colorIndex: 0 }];
          const tokenGrads = [
            "linear-gradient(145deg,#7C5CFF,#5B3FD4)",
            "linear-gradient(145deg,#3DD6C0,#1FA89A)",
            "linear-gradient(145deg,#C2FF3D,#7FA81E)",
            "linear-gradient(145deg,#FF8A5C,#E0633A)",
          ];
          return (
        <div style={{ position: "relative", zIndex: 1, flexShrink: 0, width: dim, height: dim, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* Rippling concentric rings — expand + fade outward on a stagger */}
          {[0, 1].map(i => (
            <div key={`r${i}`} style={{
              position: "absolute", width: dim, height: dim, borderRadius: "50%",
              border: "1.5px solid rgba(124,92,255,0.45)",
              animation: `ripple 3.6s ease-out ${i * 1.8}s infinite`,
            }} />
          ))}

          {/* Rotating conic-gradient SWEEP beam (the radar scan) */}
          <div style={{
            position: "absolute", width: sweepSize, height: sweepSize, borderRadius: "50%",
            background: "conic-gradient(from 0deg, rgba(124,92,255,0) 0deg, rgba(124,92,255,0) 270deg, rgba(124,92,255,0.10) 320deg, rgba(124,92,255,0.45) 352deg, rgba(194,255,61,0.55) 360deg)",
            animation: "sweepSpin 3.6s linear infinite",
            maskImage: "radial-gradient(circle, #000 62%, transparent 63%)",
            WebkitMaskImage: "radial-gradient(circle, #000 62%, transparent 63%)",
          }} />

          {/* Rotating dashed ring */}
          <div style={{
            position: "absolute", width: isShortPhone ? 120 : isPhone ? 156 : 248, height: isShortPhone ? 120 : isPhone ? 156 : 248, borderRadius: "50%",
            border: "2px dashed rgba(124,92,255,0.33)",
            animation: "rotateSlow 9s linear infinite",
          }} />
          {/* Center: Giggle logomark — breathing glow + gentle float */}
          <div style={{ position: "relative", zIndex: 3, animation: "centerFloat 4.5s ease-in-out infinite" }}>
            <div style={{
              width: isShortPhone ? 54 : isPhone ? 64 : 100, height: isShortPhone ? 54 : isPhone ? 64 : 100, borderRadius: "50%",
              background: "radial-gradient(circle at 50% 38%, #1a1330 0%, #0e0e18 100%)",
              border: `2px solid ${violet}`,
              animation: "breatheGlow 2.8s ease-in-out infinite",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Logomark size={isShortPhone ? 30 : isPhone ? 36 : 54} />
            </div>
          </div>

          {/* Orbiting squad avatars — real tokens (your AvatarArt; teammates get a
              polished gradient token with a person glyph, never a bare initial).
              The lane wrapper spins; the token counter-spins to stay upright. */}
          {tokens.map((t, i) => {
            const n = tokens.length;
            const dur = 20 + i * 4;
            return (
              <div key={t.key} aria-hidden style={{
                position: "absolute", width: orbitR * 2, height: orbitR * 2, borderRadius: "50%",
                zIndex: 2, pointerEvents: "none",
                transform: `rotate(${(360 / n) * i}deg)`,
              }}>
                <div style={{ position: "absolute", inset: 0, animation: `orbitSpin ${dur}s linear infinite` }}>
                  <div style={{
                    position: "absolute", top: -tokenSize / 2, left: "50%", marginLeft: -tokenSize / 2,
                    animation: `orbResolve ${dur}s linear infinite`,
                  }}>
                    {t.isMe ? (
                      <div style={{ borderRadius: "50%", boxShadow: "0 0 0 2px rgba(11,11,15,0.92), 0 0 20px -2px rgba(124,92,255,0.75)" }}>
                        <AvatarArt value={myAvatar} size={tokenSize} />
                      </div>
                    ) : (
                      <div title={t.name} style={{
                        width: tokenSize, height: tokenSize, borderRadius: "50%",
                        background: tokenGrads[t.colorIndex % tokenGrads.length],
                        display: "flex", alignItems: "center", justifyContent: "center",
                        border: "1.5px solid rgba(255,255,255,0.16)",
                        boxShadow: "0 0 0 2px rgba(11,11,15,0.92), 0 0 18px -3px rgba(124,92,255,0.6)",
                      }}>
                        <Icon.account size={Math.round(tokenSize * 0.5)} color="#fff" />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
          );
        })()}

        {/* Title + subtitle — clearly below the radar with real breathing room */}
        <div style={{ position: "relative", zIndex: 1, textAlign: "center", display: "flex", flexDirection: "column", gap: 8, maxWidth: 460 }}>
          <h1 style={{ fontFamily: "var(--font-space-grotesk)", fontSize: isShortPhone ? 22 : isPhone ? 26 : 34, fontWeight: 800, color: textPrimary, letterSpacing: "-0.02em", margin: 0 }}>Finding your match…</h1>
          <div style={{ color: textMuted, fontSize: isShortPhone ? 12 : isPhone ? 14 : 16 }}>
            {isShortPhone && elapsed >= 20 ? "Still searching — few squads are live right now." : "Looking for a squad that matches your crew's vibe."}
          </div>
          {/* Reassurance for a lone searcher with no match after ~20s — avoids the
              "stuck forever with no feedback" feeling. The Cancel button below is
              always available as the escape hatch. */}
          {elapsed >= 20 && !matchFound && !isShortPhone && (
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

        {/* ── Stats — one sleek glass readout bar that complements the radar ── */}
        <div style={{
          position: "relative", zIndex: 1,
          display: "flex", alignItems: "stretch",
          background: "rgba(20,18,30,0.55)",
          border: "1px solid rgba(124,92,255,0.20)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderRadius: 18, overflow: "hidden",
          boxShadow: "0 10px 44px -14px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.05)",
          maxWidth: "calc(100vw - 32px)",
          flexWrap: "wrap" as const,
        }}>
          {[
            { label: "Elapsed", value: fmt(elapsed) },
            { label: "Region", value: "Global" },
            { label: "Squad Size", value: `${squad?.members.length ?? "?"} / 4` },
            { label: "Status", value: "Searching" },
          ].map(({ label, value }, i) => (
            <div
              key={label}
              onMouseEnter={() => setStatHover(label)}
              onMouseLeave={() => setStatHover(null)}
              style={{
                position: "relative",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                padding: isShortPhone ? "7px 2px" : isPhone ? "10px 16px" : "14px 28px",
                minWidth: isShortPhone ? 0 : isPhone ? 64 : 92,
                width: isShortPhone ? "25%" : undefined,
                boxSizing: "border-box",
                background: statHover === label ? "rgba(124,92,255,0.10)" : "transparent",
                borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.07)" : "none",
                transition: "background .15s ease",
              }}
            >
              <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: isShortPhone ? 11 : isPhone ? 16 : 21, fontWeight: 700, color: label === "Status" ? limeText : textPrimary, letterSpacing: "-0.02em", display: "inline-flex", alignItems: "center", gap: isShortPhone ? 2 : 7, justifyContent: "center" }}>
                {label === "Status" && (
                  <span style={{
                    width: 9, height: 9, borderRadius: "50%", background: "var(--lime, #C2FF3D)",
                    animation: "pulseDot 1.4s ease-in-out infinite", flexShrink: 0,
                  }} />
                )}
                {value}
              </div>
              <div style={{ color: textMuted, fontSize: isPhone ? 10 : 11, marginTop: 4, letterSpacing: "0.08em", textTransform: "uppercase" as const }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Queue signal — informational only while the squad is already searching. */}
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div
            role="status"
            style={{
              padding: isShortPhone ? "10px 20px" : "14px 36px", borderRadius: 999,
              background: "linear-gradient(135deg, rgba(194,255,61,0.15), rgba(124,92,255,0.25))",
              color: limeText,
              fontFamily: "var(--font-space-grotesk)", fontSize: 15, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 8, justifyContent: "center" as const,
              border: "1px solid var(--lime-border, rgba(194,255,61,0.35))",
              width: isPhone ? "100%" : undefined,
            }}
          >
            <Icon.lightning size={18} color="var(--lime-text, #C2FF3D)" />
            Your signal is live
          </div>
          <div style={{ color: textMuted, fontSize: isShortPhone ? 12 : 13 }}>
            We&apos;ll bring you a compatible squad as soon as one is online.
          </div>
        </div>

        <button
          onClick={handleCancel}
          disabled={cancelling}
          onMouseEnter={() => setCancelHover(true)}
          onMouseLeave={() => setCancelHover(false)}
          style={{
            position: "relative", zIndex: 1,
            padding: "13px 40px", borderRadius: 999, background: cancelHover ? "var(--overlay-hover)" : "transparent",
            border: cancelHover ? "1.5px solid var(--border-strong)" : "1.5px solid var(--border)",
            color: cancelHover ? textPrimary : textMuted,
            fontFamily: "var(--font-space-grotesk)", fontSize: 15, fontWeight: 500,
            cursor: cancelling ? "not-allowed" : "pointer",
            transition: "all .15s ease",
            minWidth: 176,
            width: isPhone ? "100%" : undefined,
            whiteSpace: "nowrap" as const,
            display: "inline-flex" as const,
            alignItems: "center" as const,
            justifyContent: "center" as const,
          }}
        >
          {cancelling ? "Cancelling…" : "Cancel search"}
        </button>
        {cancelError && (
          <div role="alert" style={{
            position: "relative",
            zIndex: 1,
            color: "var(--coral)",
            fontFamily: "var(--font-space-grotesk)",
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
