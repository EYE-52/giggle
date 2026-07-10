"use client";
import { useState, useEffect, useCallback } from "react";
import type React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logomark, Wordmark } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { session, setPendingReferral, BACKEND_URL } from "@giggle/core";
import { useViewport } from "@/components/useViewport";

export default function AuthPage() {
  const router = useRouter();
  const { isPhone, isNarrow } = useViewport();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [refCode, setRefCode] = useState<string | null>(null);

  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get("ref");
      if (code) {
        const clean = code.trim().toUpperCase();
        setPendingReferral(clean);
        setRefCode(clean);
      }
    } catch {}
  }, []);

  const devFinish = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      await session.devSignIn();
      router.push("/home");
    } catch (e: any) {
      setErr(e?.message || "Sign in failed. Try again.");
      setLoading(false);
    }
  }, [router]);

  const oauthRedirect = (provider: "google" | "apple") => {
    setErr("");
    const ref = refCode ? `?ref=${encodeURIComponent(refCode)}` : "";
    const base = typeof window !== "undefined" ? window.location.origin : BACKEND_URL;
    window.location.href = `${base}/api/auth/${provider}${ref}`;
  };

  const compact = isPhone || isNarrow;

  return (
    <main style={{ minHeight: "100vh", background: "#07080B", color: "#F7F7FA", position: "relative", overflow: "hidden" }}>
      <style>{`
        @keyframes authFloat { 0%,100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(0,-10px,0); } }
        @media (prefers-reduced-motion: reduce) { .auth-float { animation: none !important; } }
      `}</style>
      <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(900px 520px at 12% 14%, rgba(124,92,255,.34), transparent 62%), radial-gradient(760px 520px at 86% 86%, rgba(194,255,61,.20), transparent 58%), #07080B" }} />
      <div aria-hidden style={{ position: "absolute", inset: 0, opacity: .09, backgroundImage: "linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.05) 1px, transparent 1px)", backgroundSize: "72px 72px", maskImage: "linear-gradient(to bottom, transparent, #000 12%, #000 82%, transparent)" }} />

      <div style={{
        position: "relative", zIndex: 1, minHeight: "100vh",
        display: "grid",
        gridTemplateColumns: compact ? "1fr" : "minmax(0, 1.12fr) minmax(420px, .88fr)",
      }}>
        {!compact && (
          <section style={{ position: "relative", minHeight: "100vh", overflow: "hidden" }}>
            <img src="/landing/group2.jpg" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", filter: "saturate(1.05) contrast(1.04) brightness(.82)" }} />
            <div aria-hidden style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(7,8,11,.18), rgba(7,8,11,.72) 82%, #07080B), linear-gradient(to top, #07080B 0%, transparent 34%)" }} />
            <div style={{ position: "absolute", left: 40, top: 36 }}><Wordmark size={22} /></div>
            <div style={{ position: "absolute", left: 44, right: 56, bottom: 48, display: "grid", gap: 18 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, width: "fit-content", padding: "7px 12px", borderRadius: 999, background: "rgba(7,8,11,.54)", border: "1px solid rgba(255,255,255,.16)", backdropFilter: "blur(10px)", fontSize: 12, fontWeight: 800, letterSpacing: ".12em", color: "#C2FF3D", textTransform: "uppercase" }}>
                <span style={{ width: 7, height: 7, borderRadius: 999, background: "#C2FF3D", boxShadow: "0 0 14px #C2FF3D" }} />
                live squad energy
              </div>
              <h1 style={{ margin: 0, fontFamily: "var(--font-space-grotesk)", fontSize: "clamp(58px, 7vw, 104px)", lineHeight: .88, letterSpacing: "-.055em", maxWidth: 760 }}>
                Meet people with your people.
              </h1>
              <p style={{ margin: 0, maxWidth: 520, color: "#D7D7E5", fontFamily: "var(--font-inter)", fontSize: 18, lineHeight: 1.45 }}>
                Giggle turns meeting new people into a shared moment: form a squad, match by vibe, then go live together.
              </p>
              <div className="auth-float" style={{ marginTop: 10, width: 360, maxWidth: "100%", borderRadius: 20, padding: 12, background: "rgba(12,13,18,.62)", border: "1px solid rgba(255,255,255,.16)", backdropFilter: "blur(18px)", boxShadow: "0 24px 70px -34px #000", animation: "authFloat 4.5s ease-in-out infinite" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, height: 164 }}>
                  {["/landing/sq1.jpg", "/landing/call1.jpg", "/landing/sq3.jpg", "/landing/group1.jpg"].map((src, i) => (
                    <div key={src} style={{ position: "relative", overflow: "hidden", borderRadius: 12, background: "#101116" }}>
                      <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", filter: "brightness(.9)" }} />
                      <span style={{ position: "absolute", left: 8, bottom: 8, width: 8, height: 8, borderRadius: 999, background: i === 3 ? "#C2FF3D" : "#7C5CFF", boxShadow: `0 0 14px ${i === 3 ? "#C2FF3D" : "#7C5CFF"}` }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, color: "#F4F4F7", fontFamily: "var(--font-space-grotesk)", fontWeight: 800 }}>
                  <span>2 squads matched</span>
                  <span style={{ color: "#7FF2DE" }}>live in 0:08</span>
                </div>
              </div>
            </div>
          </section>
        )}

        <section style={{
          minHeight: compact ? "100vh" : undefined,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: compact ? "28px 18px" : "42px 56px",
        }}>
          <div style={{ width: "100%", maxWidth: compact ? 520 : 460 }}>
            {compact && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
                <Wordmark size={21} />
                <Link href="/" style={{ color: "#A9A9BA", textDecoration: "none", fontSize: 14, fontWeight: 700 }}>Preview</Link>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
              <div style={{ position: "relative" }}>
                <div aria-hidden style={{ position: "absolute", inset: -20, borderRadius: 999, background: "radial-gradient(circle, rgba(124,92,255,.45), transparent 68%)", filter: "blur(14px)" }} />
                <span style={{ position: "relative", display: "inline-flex" }}><Logomark size={44} /></span>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#A6FF3F", fontWeight: 900, letterSpacing: ".14em", textTransform: "uppercase" }}>Giggle</div>
                <div style={{ fontSize: 14, color: "#A9A9BA", fontFamily: "var(--font-inter)" }}>Squad-first social video</div>
              </div>
            </div>

            <h2 style={{ margin: 0, fontFamily: "var(--font-space-grotesk)", fontSize: compact ? 42 : 52, lineHeight: .95, letterSpacing: "-.05em" }}>
              Start with your squad.
            </h2>
            <p style={{ margin: "14px 0 28px", color: "#B9B9C8", fontSize: 16, lineHeight: 1.5, fontFamily: "var(--font-inter)" }}>
              Sign in, bring friends, and match into a live room without doing the awkward solo swipe thing.
            </p>

            {refCode && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, background: "rgba(124,92,255,.14)", border: "1px solid rgba(124,92,255,.36)", borderRadius: 14, padding: "12px 14px" }}>
                <Icon.gift size={18} color="#9B83FF" />
                <span style={{ fontSize: 13.5, color: "#ECECF4", lineHeight: 1.35 }}>Invite applied. Sign up and you both get 100 tokens.</span>
              </div>
            )}

            <div style={{ display: "grid", gap: 12 }}>
              <button className="gg-press" onClick={() => oauthRedirect("google")} disabled={loading} style={primaryButton}>
                <Icon.google size={21} /> Continue with Google
              </button>
              <button className="gg-press" onClick={() => oauthRedirect("apple")} disabled={loading} style={secondaryButton}>
                <Icon.apple size={20} /> Continue with Apple
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "1fr 1fr 1fr", gap: 10, marginTop: 18 }}>
              <Benefit icon={<Icon.users size={17} color="#9B83FF" />} title="Bring friends" />
              <Benefit icon={<Icon.star size={16} color="#C2FF3D" fill="#C2FF3D" />} title="Match vibes" />
              <Benefit icon={<Icon.cam size={17} color="#7FF2DE" />} title="Go live" />
            </div>

            <p role={err ? "alert" : undefined} style={{ minHeight: 22, margin: "16px 0 0", color: "#FF8A8A", fontSize: 13, fontWeight: 700, textAlign: "center" }}>{err}</p>

            <div style={{ marginTop: 18, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, color: "#858598", fontSize: 12.5, lineHeight: 1.45, textAlign: "center" }}>
              <p style={{ margin: 0 }}>Free to join. We never post anything.</p>
              <p style={{ margin: 0 }}>
                By continuing you agree to our <Link href="/terms" style={legalLink}>Terms</Link> and <Link href="/privacy" style={legalLink}>Privacy</Link>.
              </p>
              {process.env.NODE_ENV !== "production" && (
                <button className="gg-press" onClick={devFinish} disabled={loading} style={{ marginTop: 8, minHeight: 40, padding: "0 16px", borderRadius: 999, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.03)", color: "#A9A9BA", cursor: "pointer", fontWeight: 800 }}>
                  Use dev account
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Benefit({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, minHeight: 42, padding: "9px 10px", borderRadius: 12, background: "rgba(255,255,255,.045)", border: "1px solid rgba(255,255,255,.09)", color: "#DCDCE8", fontSize: 13, fontWeight: 800 }}>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 9, background: "rgba(255,255,255,.06)", flexShrink: 0 }}>{icon}</span>
      {title}
    </div>
  );
}

const primaryButton: React.CSSProperties = {
  height: 56, borderRadius: 999, border: "none", background: "#F7F7FA", color: "#090A0D",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 12,
  fontSize: 16, fontWeight: 900, cursor: "pointer", boxShadow: "0 18px 42px -22px rgba(124,92,255,.95)",
};

const secondaryButton: React.CSSProperties = {
  height: 56, borderRadius: 999, border: "1px solid rgba(255,255,255,.16)", background: "rgba(255,255,255,.055)", color: "#F4F4F7",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 12,
  fontSize: 16, fontWeight: 900, cursor: "pointer",
};

const legalLink: React.CSSProperties = { color: "#C7C7D6", textUnderlineOffset: 3 };
