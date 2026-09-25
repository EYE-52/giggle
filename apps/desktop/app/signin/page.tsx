"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logomark } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { session, setPendingReferral, BACKEND_URL } from "@giggle/core";
import { HangoutIllustration } from "@/components/HangoutIllustration";
import community from "@/components/Community.module.css";

type SignInStatus = "idle" | "redirecting" | "dev" | "failed";
const AUTH_NEXT_KEY = "giggle.auth.next";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/home";
  return value;
}

export default function AuthPage() {
  const router = useRouter();
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
    <main className={`gg-landing ${community.auth}`}>
      <div className={`page-head ${community.authIntro}`}>
        <Link href="/" className={community.backLink}>← Back to Giggle</Link>
        <h2 className="title">Your people.<br />Your kind of <em>happy.</em></h2>
        <p className="lede">A little less scrolling. A little more “you had to be there.”</p>
        <div className={community.authArt}><HangoutIllustration /></div>
      </div>
      <section className={`card ${community.authCard}`}>
        <div className={community.authBrand}>
          <Logomark size={34} glow={false} />
          <span className="wordmark">Giggle</span>
        </div>

        <h1 className={community.authHeading}>Sign in to Giggle</h1>
        <p className={community.authSub}>First hello or familiar face. There’s a place for you here.</p>

        {refCode && <div className={community.refNote}><Icon.gift size={17} color="currentColor" /> Invite accepted. You both get 100 tokens.</div>}

        <div style={{ display: "grid", gap: 10 }}>
          <button
            className="gg-press gg-btn btn btn-secondary"
            onClick={() => oauthRedirect("google")}
            disabled={busy}
            style={{ width: "100%", whiteSpace: "nowrap", opacity: busy ? 0.7 : 1, cursor: busy ? "wait" : "pointer" }}
          >
            {status === "redirecting" && activeProvider === "google"
              ? (<><span className="gg-spinner" aria-hidden /> Opening Google...</>)
              : (<><Icon.google size={20} /> Continue with Google</>)}
          </button>

          {/* Apple Sign-In is not configured yet (needs an Apple Developer
              service ID + key on the backend). Re-add the button once
              APPLE_* env vars are set, so we never ship a dead provider. */}
        </div>

        <p className={community.finePrint}>We use your name and email to create your profile. We never post on your behalf.</p>
        {err && (
          <div style={{ marginTop: 12 }}>
            <p role="alert" className={community.authError}>{err}</p>
            <button onClick={() => { setErr(""); setStatus("idle"); }} className={community.retry}>Try again</button>
          </div>
        )}
        <p className={community.finePrint}>By continuing, you agree to our <Link href="/terms" className={community.legalLink}>Terms</Link> and <Link href="/privacy" className={community.legalLink}>Privacy Policy</Link>.</p>

        {process.env.NODE_ENV !== "production" && (
          <div className={community.devBox}>
          <p className={community.devTitle}>Local testing</p>
          <p className={community.finePrint}>Open a test account without Google or age verification. Use another browser profile to test with a second person.</p>
          <button
            className="gg-press gg-btn btn btn-primary"
            onClick={devFinish}
            disabled={busy}
            style={{ width: "100%" }}
          >
            {status === "dev" ? "Opening dev account..." : "Use dev account"}
          </button>
          </div>
        )}
      </section>
    </main>
  );
}
