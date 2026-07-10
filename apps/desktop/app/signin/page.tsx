"use client";
import { useState, useEffect, useCallback, type ReactElement } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logomark } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { session, setPendingReferral, BACKEND_URL } from "@giggle/core";
import { useViewport } from "@/components/useViewport";

export default function AuthPage() {
  const router = useRouter();
  const { isPhone } = useViewport();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [refCode, setRefCode] = useState<string | null>(null);

  // Capture an inbound invite code (?ref=CODE) and remember it through signup.
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

  // Dev sign-in mints a UNIQUE per-browser-profile identity (not a shared fixed
  // email), so two windows are two different users — required for 2-squad testing.
  // session.devSignIn() still consumes any captured ?ref via the shared sign-in path.
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

  // Real OAuth: full-page redirect to the Express backend, which redirects to
  // Google consent and then back to /auth/callback#token=<jwt>.
  const oauthRedirect = (provider: "google" | "apple") => {
    setErr("");
    const ref = refCode ? `?ref=${encodeURIComponent(refCode)}` : "";
    // Same-origin so the flow goes through this domain's /api/auth proxy →
    // Google's consent screen shows gigglemeet.com (not the backend host).
    // Falls back to BACKEND_URL during SSR where window is unavailable.
    const base = typeof window !== "undefined" ? window.location.origin : BACKEND_URL;
    window.location.href = `${base}/api/auth/${provider}${ref}`;
  };

  const props: { icon: keyof typeof Icon; tint: string; text: string }[] = [
    { icon: "users", tint: "var(--violet)", text: "Bring your whole squad" },
    { icon: "star", tint: "var(--lime)", text: "Matched by your vibe" },
    { icon: "cam", tint: "var(--teal)", text: "Live group video" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-2)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden", padding: isPhone ? "24px 16px" : 24 }}>
      {/* Ambient drifting aurora + faint grain — cinematic, respects reduced-motion */}
      <style>{`
        @keyframes authAurora {
          0%,100% { transform: translate(0,0) scale(1); }
          50%     { transform: translate(26px,-22px) scale(1.1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .auth-aurora { animation: none !important; }
        }
      `}</style>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }} aria-hidden>
        <div className="auth-aurora" style={{ position: "absolute", width: 620, height: 620, borderRadius: "50%", top: "-16%", left: "-10%", background: "radial-gradient(circle, rgba(124,92,255,0.42), transparent 64%)", filter: "blur(56px)", animation: "authAurora 17s ease-in-out infinite" }} />
        <div className="auth-aurora" style={{ position: "absolute", width: 560, height: 560, borderRadius: "50%", bottom: "-18%", right: "-10%", background: "radial-gradient(circle, rgba(61,214,192,0.30), transparent 64%)", filter: "blur(60px)", animation: "authAurora 23s ease-in-out infinite reverse" }} />
        <div className="auth-aurora" style={{ position: "absolute", width: 460, height: 460, borderRadius: "50%", top: "36%", right: "16%", background: "radial-gradient(circle, rgba(194,255,61,0.20), transparent 64%)", filter: "blur(64px)", animation: "authAurora 19s ease-in-out infinite" }} />
        {/* faint grain */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.05, mixBlendMode: "overlay",
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }} />
      </div>

      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 392, display: "flex", flexDirection: "column", alignItems: "center", gap: isPhone ? 16 : 20 }}>
        {/* Logomark with soft glow halo */}
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div aria-hidden style={{ position: "absolute", width: 120, height: 120, borderRadius: "50%", background: "radial-gradient(circle, rgba(124,92,255,0.45), transparent 70%)", filter: "blur(20px)" }} />
          <div style={{ position: "relative" }}><Logomark size={58} /></div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <h1 style={{ fontFamily: "var(--font-space-grotesk)", fontSize: isPhone ? 30 : 36, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.03em", margin: 0, textAlign: "center", lineHeight: 1.05 }}>
            Meet in squads.
          </h1>
          <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0, textAlign: "center", fontFamily: "var(--font-inter)", lineHeight: 1.4 }}>
            The social way to meet new people — together, never alone.
          </p>
        </div>

        {refCode && (
          <div style={{
            width: "100%",
            display: "flex", alignItems: "center", gap: 10,
            background: "linear-gradient(135deg, var(--violet-soft) 0%, rgba(194,255,61,0.08) 100%)",
            border: "1px solid rgba(124,92,255,0.3)",
            borderRadius: 14, padding: "12px 16px",
          }}>
            <Icon.gift size={20} color="var(--violet)" />
            <div style={{ fontSize: 13.5, color: "var(--text)", fontFamily: "var(--font-inter)", lineHeight: 1.4 }}>
              You were invited! Sign up and <strong>you both get 100 tokens</strong>.
            </div>
          </div>
        )}

        {/* Glass card — hugs its content */}
        <div style={{
          width: "100%",
          background: "color-mix(in srgb, var(--surface) 82%, transparent)",
          border: "1px solid var(--border-strong)",
          borderRadius: 22,
          padding: isPhone ? 18 : 24,
          display: "flex", flexDirection: "column", gap: 16,
          backdropFilter: "blur(16px)",
          boxShadow: "0 24px 60px -24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}>
          <button
            className="gg-press"
            onClick={() => oauthRedirect("google")}
            disabled={loading}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 11,
              width: "100%", height: 52, borderRadius: 999,
              fontFamily: "var(--font-inter)", fontWeight: 600, fontSize: 15.5,
              background: "#FFFFFF", color: "#0B0B0F", border: "none",
              cursor: "pointer", whiteSpace: "nowrap",
              boxShadow: "0 8px 24px -10px rgba(124,92,255,0.55), 0 2px 8px rgba(0,0,0,0.25)",
              transition: "transform 0.18s var(--ease-out), box-shadow 0.18s var(--ease-out)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 14px 34px -10px rgba(124,92,255,0.75), 0 3px 10px rgba(0,0,0,0.3)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 8px 24px -10px rgba(124,92,255,0.55), 0 2px 8px rgba(0,0,0,0.25)"; }}
          >
            <Icon.google size={20} /> Continue with Google
          </button>

          <button
            className="gg-press"
            onClick={() => oauthRedirect("apple")}
            disabled={loading}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 11,
              width: "100%", height: 52, borderRadius: 999,
              fontFamily: "var(--font-inter)", fontWeight: 600, fontSize: 15.5,
              background: "rgba(255,255,255,0.04)", color: "var(--text)", border: "1px solid var(--border-strong)",
              cursor: "pointer", whiteSpace: "nowrap",
              boxShadow: "0 8px 24px -16px rgba(0,0,0,0.8)",
              transition: "transform 0.18s var(--ease-out), background 0.18s var(--ease-out)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = ""; e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
          >
            <Icon.apple size={19} /> Continue with Apple
          </button>

          {/* Value props */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 2 }}>
            {props.map((p) => {
              const IconCmp = Icon[p.icon] as (props: { size?: number; color?: string }) => ReactElement;
              return (
                <div key={p.text} style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                    background: `color-mix(in srgb, ${p.tint} 14%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${p.tint} 28%, transparent)`,
                  }}>
                    <IconCmp size={16} color={p.tint} />
                  </span>
                  <span style={{ fontSize: 13.5, color: "var(--text-muted)", fontFamily: "var(--font-inter)" }}>{p.text}</span>
                </div>
              );
            })}
          </div>

          <p style={{ fontSize: 12.5, color: "var(--coral)", margin: 0, lineHeight: 1.4, fontFamily: "var(--font-inter)", minHeight: "1.4em", visibility: err ? "visible" : "hidden", textAlign: "center" }}>{err || " "}</p>
        </div>

        {/* Trust + legal microcopy */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, textAlign: "center" }}>
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: 0, fontFamily: "var(--font-inter)" }}>
            Free to join — we'll never post anything.
          </p>
          <p style={{ fontSize: 11.5, color: "var(--text-dim)", margin: 0, fontFamily: "var(--font-inter)", lineHeight: 1.5 }}>
            By continuing you agree to our{" "}
            <Link href="/terms" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 44, minHeight: 36, color: "var(--text-muted)", textDecoration: "underline", textUnderlineOffset: 2 }}>Terms</Link>
            {" "}&amp;{" "}
            <Link href="/privacy" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 48, minHeight: 36, color: "var(--text-muted)", textDecoration: "underline", textUnderlineOffset: 2 }}>Privacy</Link>.
          </p>
        </div>

        {/* Dev-only escape hatch — compiled OUT of production builds. */}
        {process.env.NODE_ENV !== "production" && (
          <button
            className="gg-press"
            onClick={devFinish}
            disabled={loading}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-dim)",
              cursor: "pointer",
              fontSize: 12.5,
              fontFamily: "var(--font-inter)",
              minHeight: 42,
              padding: "0 16px",
              borderRadius: 999,
              transition: "all 0.15s var(--ease-out)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--overlay-hover)"; e.currentTarget.style.color = "var(--text-muted)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-dim)"; }}
          >
            Use dev account
          </button>
        )}
      </div>
    </div>
  );
}
