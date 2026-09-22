"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logomark } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { session, setPendingReferral, BACKEND_URL } from "@giggle/core";
import { useViewport } from "@/components/useViewport";

type SignInStatus = "idle" | "redirecting" | "dev" | "failed";
const AUTH_NEXT_KEY = "giggle.auth.next";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/home";
  return value;
}

export default function AuthPage() {
  const router = useRouter();
  const { isPhone } = useViewport();
  const [status, setStatus] = useState<SignInStatus>("idle");
  const [activeProvider, setActiveProvider] = useState<"google" | "apple" | null>(null);
  const [err, setErr] = useState("");
  const [refCode, setRefCode] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState("/home");
  const busy = status === "redirecting" || status === "dev";

  // Redirect watchdog: the OAuth handoff is a full-page navigation, so if we're
  // still here 8s after starting it, something is stuck — recover to idle.
  useEffect(() => {
    if (status !== "redirecting") return;
    const id = window.setTimeout(() => {
      setStatus("idle");
      setActiveProvider(null);
      setErr("Taking longer than expected — try again.");
    }, 8000);
    return () => window.clearTimeout(id);
  }, [status]);

  // Capture an inbound invite code (?ref=CODE) and remember it through signup.
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get("ref");
      const continuation = safeNextPath(new URLSearchParams(window.location.search).get("next"));
      setNextPath(continuation);
      sessionStorage.setItem(AUTH_NEXT_KEY, continuation);
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
    setStatus("dev"); setErr("");
    try {
      await session.devSignIn();
      router.push(nextPath);
    } catch (error: unknown) {
      setErr(error instanceof Error ? error.message : "Sign in failed. Try again.");
      setStatus("failed");
    }
  }, [nextPath, router]);

  // Real OAuth: full-page redirect to the Express backend, which redirects to
  // Google consent and then back to /auth/callback#token=<jwt>.
  const oauthRedirect = async (provider: "google" | "apple") => {
    setErr("");
    setStatus("redirecting");
    setActiveProvider(provider);
    const ref = refCode ? `?ref=${encodeURIComponent(refCode)}` : "";
    // Same-origin so the flow goes through this domain's /api/auth proxy →
    // Google's consent screen shows gigglemeet.com (not the backend host).
    // Falls back to BACKEND_URL during SSR where window is unavailable.
    const base = typeof window !== "undefined" ? window.location.origin : BACKEND_URL;
    const destination = `${base}/api/auth/${provider}${ref}`;
    try {
      const response = await fetch(destination, {
        method: "GET",
        credentials: "same-origin",
        redirect: "manual",
        cache: "no-store",
      });
      const handoffReady = response.ok
        || response.type === "opaqueredirect"
        || (response.status >= 300 && response.status < 400);
      if (!handoffReady) {
        const failure = await response.json().catch(() => null);
        if (failure?.error?.code === "PROVIDER_NOT_CONFIGURED") {
          setErr(process.env.NODE_ENV !== "production"
            ? "Google sign-in is not configured locally. Use the dev account below to test the app."
            : "Google sign-in is unavailable right now. Please try again later.");
          setStatus("failed");
          setActiveProvider(null);
          return;
        }
        throw new Error("AUTH_UNAVAILABLE");
      }
      window.location.assign(destination);
    } catch {
      setErr(`We couldn't reach ${provider === "google" ? "Google" : "Apple"} sign-in. Check your connection and try again.`);
      setStatus("failed");
      setActiveProvider(null);
    }
  };

  return (
    <main style={{ minHeight: "100svh", position: "relative", overflow: "auto", display: "grid", placeItems: "center", padding: isPhone ? 16 : 28, fontFamily: "var(--font-inter), Inter, sans-serif", background: "var(--bg)", color: "var(--text)" }}>


      <section style={{ position: "relative", width: "100%", maxWidth: 430, padding: isPhone ? 22 : 30, borderRadius: "var(--radius-card, 20px)", background: "var(--surface)", border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <Logomark size={34} glow={false} />
          <span style={{ fontFamily: "var(--font-display, var(--font-space-grotesk)), sans-serif", fontWeight: 700, fontSize: 20 }}>Giggle</span>
        </div>

        <h1 style={{ margin: 0, fontFamily: "var(--font-display, var(--font-space-grotesk)), sans-serif", fontSize: 30, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-0.02em", maxWidth: 330 }}>Sign in to Giggle</h1>
        <p style={{ margin: "12px 0 24px", color: "var(--text-body)", fontSize: 14, lineHeight: 1.5 }}>Create an account or return to your squad.</p>

        {refCode && <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 16, padding: "10px 12px", borderRadius: "var(--radius-control, 14px)", background: "color-mix(in srgb, var(--accent, var(--violet, #7657FF)) 14%, transparent)", color: "var(--accent)", fontSize: 13 }}><Icon.gift size={17} color="var(--violet-bright)" /> Invite accepted. You both get 100 tokens.</div>}

        <div style={{ display: "grid", gap: 10 }}>
          <button
            className="gg-press"
            onClick={() => oauthRedirect("google")}
            disabled={busy}
            style={{
              display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 11,
              width: "100%", height: 50, borderRadius: "var(--radius-control, 14px)",
              fontFamily: "inherit", fontWeight: 600, fontSize: 14,
              background: "#FFFFFF", color: "#1f1f1f", border: "1px solid var(--border-strong)",
              boxShadow: "var(--shadow-sm)",
              cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {status === "redirecting" && activeProvider === "google"
              ? (<><span className="gg-spinner" aria-hidden /> Opening Google...</>)
              : (<><Icon.google size={20} /> Continue with Google</>)}
          </button>

          {/* Apple Sign-In is not configured yet (needs an Apple Developer
              service ID + key on the backend). Re-add the button once
              APPLE_* env vars are set, so we never ship a dead provider. */}
        </div>

        <p style={{ margin: "12px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.45 }}>We use your name and email to create your profile. We never post on your behalf.</p>
        {err && (
          <div style={{ marginTop: 12 }}>
            <p role="alert" style={{ margin: 0, color: "var(--coral, #ff7979)", fontSize: 13, lineHeight: 1.45 }}>{err}</p>
            <button onClick={() => { setErr(""); setStatus("idle"); }} style={{ minHeight: 44, padding: 0, border: 0, background: "transparent", color: "var(--accent)", font: "600 13px var(--font-inter), sans-serif", cursor: "pointer" }}>Try again</button>
          </div>
        )}
        <p style={{ margin: "16px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>By continuing, you agree to our <Link href="/terms" style={{ color: "var(--text-body)", textDecoration: "underline" }}>Terms</Link> and <Link href="/privacy" style={{ color: "var(--text-body)", textDecoration: "underline" }}>Privacy Policy</Link>.</p>

        {process.env.NODE_ENV !== "production" && (
          <div style={{ marginTop: 20, padding: 16, borderRadius: "var(--radius-control, 14px)", background: "var(--overlay)", border: "1px solid var(--border)" }}>
          <p style={{ margin: "0 0 6px", fontSize: 14, fontWeight: 700 }}>Local testing</p>
          <p style={{ margin: "0 0 12px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>Open a test account without Google or age verification. Use another browser profile to test with a second person.</p>
          <button
            className="gg-press"
            onClick={devFinish}
            disabled={busy}
            style={{
              background: "var(--accent)",
              border: "none",
              color: "var(--on-accent)",
              cursor: "pointer",
              fontSize: 14,
              fontFamily: "inherit",
              minHeight: 44,
              padding: "0 16px",
              width: "100%",
              borderRadius: "var(--radius-control, 14px)",
            }}
          >
            {status === "dev" ? "Opening dev account..." : "Use dev account"}
          </button>
          </div>
        )}
      </section>
    </main>
  );
}
