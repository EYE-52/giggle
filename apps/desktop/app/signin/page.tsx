"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Logomark } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { session, setPendingReferral, getPendingReferral, BACKEND_URL } from "@giggle/core";
import styles from "./signin.module.css";

type SignInStatus = "idle" | "redirecting" | "dev" | "failed";
type OAuthAttempt = { controller: AbortController; watchdog: number };
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
  const oauthAttempt = useRef<OAuthAttempt | null>(null);
  const mounted = useRef(true);
  const busy = status === "redirecting" || status === "dev";

  const cancelOAuth = useCallback(() => {
    const attempt = oauthAttempt.current;
    oauthAttempt.current = null;
    if (attempt) {
      window.clearTimeout(attempt.watchdog);
      attempt.controller.abort();
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelOAuth();
    };
  }, [cancelOAuth]);

  // Capture an inbound invite code (?ref=CODE) and remember it through signup.
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get("ref")?.trim() || getPendingReferral();
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
    cancelOAuth();
    setStatus("dev"); setErr("");
    try {
      await session.devSignIn();
      if (!mounted.current) return;
      router.push(nextPath);
    } catch (error: unknown) {
      if (!mounted.current) return;
      setErr(error instanceof Error ? error.message : "Sign in failed. Try again.");
      setStatus("failed");
    }
  }, [nextPath, router, cancelOAuth]);

  // Real OAuth: full-page redirect to the Express backend, which redirects to
  // Google consent and then back to /auth/callback#token=<jwt>.
  const oauthRedirect = async (provider: "google" | "apple") => {
    cancelOAuth();
    const attempt: OAuthAttempt = { controller: new AbortController(), watchdog: 0 };
    oauthAttempt.current = attempt;
    const isCurrent = () => mounted.current && oauthAttempt.current === attempt && !attempt.controller.signal.aborted;
    // A timed-out request is retired before the form unlocks. Even if a server
    // ignores cancellation, its late response cannot redirect a newer attempt.
    attempt.watchdog = window.setTimeout(() => {
      if (!isCurrent()) return;
      cancelOAuth();
      setStatus("idle");
      setActiveProvider(null);
      setErr("Taking longer than expected — try again.");
    }, 8000);
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
        signal: attempt.controller.signal,
      });
      if (!isCurrent()) return;
      const handoffReady = response.ok
        || response.type === "opaqueredirect"
        || (response.status >= 300 && response.status < 400);
      if (!handoffReady) {
        const failure = await response.json().catch(() => null);
        if (!isCurrent()) return;
        if (failure?.error?.code === "PROVIDER_NOT_CONFIGURED") {
          cancelOAuth();
          setErr(process.env.NODE_ENV !== "production"
            ? "Google sign-in is not configured locally. Use the dev account below to test the app."
            : "Google sign-in is unavailable right now. Please try again later.");
          setStatus("failed");
          setActiveProvider(null);
          return;
        }
        throw new Error("AUTH_UNAVAILABLE");
      }
      window.clearTimeout(attempt.watchdog);
      window.location.assign(destination);
    } catch {
      if (!isCurrent()) return;
      cancelOAuth();
      setErr(`We couldn't reach ${provider === "google" ? "Google" : "Apple"} sign-in. Check your connection and try again.`);
      setStatus("failed");
      setActiveProvider(null);
    }
  };

  return (
    <main className={styles.screen} data-testid="signin-page">
      <Link href="/" className={styles.backLink}><Icon.chevron size={18} /> Back to Giggle</Link>
      <div className={styles.content}>
        <section className={styles.card} aria-labelledby="signin-title" aria-busy={busy}>
          <div className={styles.brand} aria-label="Giggle"><Logomark size={40} /><span>giggle</span></div>
          <div className={styles.intro}>
            <h1 id="signin-title" className={styles.heading}>Sign in to Giggle</h1>
            <p className={styles.description}>Sign in or create an account with Google.</p>
          </div>

          {refCode && <p className={styles.refNote}><Icon.gift size={18} /> Using a friend&apos;s invite.</p>}

          <button type="button" className={styles.primary} onClick={() => oauthRedirect("google")} disabled={busy} aria-describedby="signin-profile-note">
            {status === "redirecting" && activeProvider === "google"
              ? (<><span className="gg-spinner" aria-hidden /> Opening Google…</>)
              : (<><Icon.google size={20} /> Continue with Google</>)}
          </button>
          {/* Apple Sign-In is not configured yet (needs an Apple Developer
              service ID + key on the backend). Re-add the button once
              APPLE_* env vars are set, so we never ship a dead provider. */}

          <p id="signin-profile-note" className={styles.profileNote}>We use your name and email to create your profile. We never post on your behalf.</p>
          {status === "redirecting" && <p className={styles.handoff} role="status">Opening Google sign-in…</p>}
          {err && <div className={styles.errorBox}>
            <p role="alert" className={styles.error}>{err}</p>
            <button type="button" onClick={() => { setErr(""); setStatus("idle"); }} className={styles.retry}>Try again</button>
          </div>}

          <div className={styles.legal}>
            <p>By continuing, you agree to our:</p>
            <div className={styles.legalLinks}><Link href="/terms">Terms</Link><Link href="/privacy">Privacy Policy</Link></div>
          </div>

          {process.env.NODE_ENV !== "production" && <div className={styles.devBox}>
            <p className={styles.devTitle}>Local testing</p>
            <p className={styles.devNote}>Open a test account without Google.</p>
            <button type="button" className={styles.secondary} onClick={devFinish} disabled={busy}>
              {status === "dev" ? "Opening dev account…" : "Use dev account"}
            </button>
          </div>}
        </section>
      </div>
    </main>
  );
}
