"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Logomark } from "@/components/Brand";
import { session } from "@giggle/core";

// Landing page for OAuth / magic-link redirects. The backend sends the user
// here with the JWT in the URL hash (#token=…) or #error=CODE on failure.
export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const finishWithToken = (token: string) => {
      try {
        session.setTokenFromOAuth(token);
        // Clean the token out of the URL before navigating away.
        window.history.replaceState(null, "", window.location.pathname);
        router.replace("/home");
      } catch {
        if (!cancelled) setError("We couldn't complete sign-in. Please try again.");
      }
    };

    const run = async () => {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));

      const hashError = hash.get("error");
      if (hashError) {
        if (!cancelled) setError(friendly(hashError));
        return;
      }

      const token = hash.get("token");
      if (token) {
        finishWithToken(token);
        return;
      }

      if (!cancelled) setError("This sign-in link is invalid or has expired.");
    };

    run();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-2)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, maxWidth: 360, textAlign: "center" }}>
        <Logomark size={48} />
        {error ? (
          <>
            <h1 style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>Sign-in failed</h1>
            <p style={{ fontSize: 14.5, color: "var(--text-muted)", margin: 0, lineHeight: 1.5, fontFamily: "var(--font-inter)" }}>{error}</p>
            <a href="/signin" style={{ minWidth: 44, minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--violet)", fontWeight: 600, fontSize: 14.5, textDecoration: "none", fontFamily: "var(--font-inter)" }}>← Back to sign in</a>
          </>
        ) : (
          <p style={{ fontSize: 15, color: "var(--text-muted)", margin: 0, fontFamily: "var(--font-inter)" }}>Signing you in…</p>
        )}
      </div>
    </div>
  );
}

function friendly(code: string): string {
  if (code.startsWith("MAGIC")) return "This magic link is invalid or has expired. Request a new one.";
  if (code.startsWith("GOOGLE")) return "Google sign-in didn't complete. Please try again.";
  if (code.startsWith("APPLE")) return "Apple sign-in didn't complete. Please try again.";
  return "We couldn't complete sign-in. Please try again.";
}
