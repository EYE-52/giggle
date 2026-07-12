"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Logomark } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { setPendingReferral } from "@giggle/core";
import { useViewport } from "@/components/useViewport";

export default function AuthPage() {
  const { isPhone } = useViewport();
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

  const refQuery = refCode ? `?ref=${encodeURIComponent(refCode)}` : "";

  return (
    <main style={{ height: "100dvh", minHeight: 560, position: "relative", overflow: "hidden", display: "grid", placeItems: "center", padding: isPhone ? 16 : 28, fontFamily: "var(--font-inter), Inter, sans-serif", background: "#080a0b", color: "#f4f4f7" }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(90deg, rgba(6,8,9,.94), rgba(6,8,9,.78) 52%, rgba(6,8,9,.58)), url('/img/onboarding-hero.jpg')", backgroundSize: "cover", backgroundPosition: "center", filter: "saturate(.82)" }} />

      <section style={{ position: "relative", width: "100%", maxWidth: 430, padding: isPhone ? 22 : 30, borderRadius: 16, background: "rgba(12,15,16,.88)", border: "1px solid rgba(255,255,255,.12)", backdropFilter: "blur(18px)", boxShadow: "0 28px 80px rgba(0,0,0,.42)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <Logomark size={34} glow={false} />
          <span style={{ fontFamily: "var(--font-space-grotesk), sans-serif", fontWeight: 700, fontSize: 20 }}>Giggle</span>
        </div>

        <h1 style={{ margin: 0, fontFamily: "var(--font-space-grotesk), sans-serif", fontSize: isPhone ? 32 : 40, fontWeight: 700, lineHeight: 1.02, letterSpacing: 0, maxWidth: 330 }}>Meet people with your people.</h1>
        <p style={{ margin: "12px 0 26px", color: "#aaaabc", fontSize: 15, lineHeight: 1.5 }}>Bring a friend, match with another squad, and go live together.</p>

        {refCode && <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16, padding: "10px 12px", borderRadius: 10, background: "rgba(118,87,255,.14)", color: "#d8d1ff", fontSize: 13 }}><Icon.gift size={17} color="#9278ff" /> Invite accepted. You both get 100 tokens.</div>}

        <div style={{ display: "grid", gap: 10 }}>
          <a
            className="gg-press"
            href={`/api/auth/google${refQuery}`}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 11,
              width: "100%", height: 50, borderRadius: 10,
              fontFamily: "inherit", fontWeight: 700, fontSize: 15,
              background: "#FFFFFF", color: "#0B0B0F", border: "none",
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            <Icon.google size={20} /> Continue with Google
          </a>

          <a
            className="gg-press"
            href={`/api/auth/apple${refQuery}`}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 11,
              width: "100%", height: 50, borderRadius: 10,
              fontFamily: "inherit", fontWeight: 700, fontSize: 15,
              background: "rgba(255,255,255,.06)", color: "#f4f4f7", border: "1px solid rgba(255,255,255,.14)",
              cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            <Icon.apple size={19} /> Continue with Apple
          </a>
        </div>

        <p style={{ margin: "18px 0 0", color: "#777789", fontSize: 11.5, lineHeight: 1.5 }}>By continuing, you agree to our <Link href="/terms" style={{ color: "#aaaabc", textDecoration: "underline" }}>Terms</Link> and <Link href="/privacy" style={{ color: "#aaaabc", textDecoration: "underline" }}>Privacy Policy</Link>.</p>

        {process.env.NODE_ENV !== "production" && (
          <a
            className="gg-press"
            href="/home"
            style={{
              background: "transparent",
              border: "none",
              color: "#777789",
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "inherit",
              minHeight: 44,
              padding: 0,
              marginTop: 8,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            Use dev account
          </a>
        )}
      </section>
    </main>
  );
}
