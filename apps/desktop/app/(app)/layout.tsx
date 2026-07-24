"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TopNav } from "@/components/TopNav";
import { ToastProvider } from "@/components/Toast";
import { Logomark } from "@/components/Brand";
import { useViewport } from "@/components/useViewport";
import { session, connectSocket } from "@giggle/core";
import { AgeGate } from "@/components/AgeGate";

const CALLING_ROUTES = ["/lobby", "/encounter", "/matchmaking", "/match"];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isCalling = CALLING_ROUTES.some((r) => pathname === r);
  const { isPhone } = useViewport();
  const [authReady, setAuthReady] = useState(false);
  // Age gate: once auth is ready, block the app until the user has attested a
  // date of birth. `ageConfirmed` is undefined until the backend ships /api/me/age
  // (or for fresh devSignIn users) — treat anything other than an explicit true
  // as "not confirmed" so the gate shows. Cleared once AgeGate reports success.
  const [ageConfirmed, setAgeConfirmed] = useState(false);

  // Auth gate: the whole (app) area requires a session. In production the only
  // way in is real OAuth — unauthenticated users are sent to /signin. In local
  // dev we auto dev-sign-in so the flow stays frictionless (devSignIn is a no-op
  // in production, so this can't be a backdoor live).
  useEffect(() => {
    let cancelled = false;
    async function ensureSession() {
      if (session.isAuthed()) {
        if (!cancelled) {
          setAgeConfirmed(session.ageConfirmed);
          setAuthReady(true);
        }
        return;
      }
      if (process.env.NODE_ENV !== "production") {
        try {
          await session.devSignIn();
          if (!cancelled) {
            setAgeConfirmed(session.ageConfirmed);
            setAuthReady(true);
          }
        } catch {
          if (!cancelled) router.replace("/signin");
        }
      } else {
        router.replace("/signin");
      }
    }
    ensureSession();
    return () => { cancelled = true; };
  }, [router]);

  // Open the authenticated presence socket for the app session so the user
  // counts as "online" app-wide (the backend marks online via the handshake).
  // Not torn down on route changes — kept for the whole app session. Network
  // drops auto-reconnect (socket.io); intentional client disconnects elsewhere
  // (e.g. a page calling disconnectSocket) are re-opened here so presence
  // resumes instead of latching offline for the rest of the session.
  const reconnectTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!authReady || !session.isAuthed()) return;
    const s = connectSocket();
    const onDisconnect = (reason: string) => {
      // socket.io retries every other reason on its own.
      if (reason !== "io client disconnect") return;
      if (reconnectTimer.current != null) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = window.setTimeout(() => {
        reconnectTimer.current = null;
        if (session.isAuthed()) connectSocket();
      }, 400);
    };
    s.on("disconnect", onDisconnect);
    return () => {
      s.off("disconnect", onDisconnect);
      if (reconnectTimer.current != null) window.clearTimeout(reconnectTimer.current);
    };
  }, [authReady]);

  if (!authReady) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg)", color: "var(--text-muted)", fontFamily: "var(--font-space-grotesk)", fontWeight: 700 }}>
        <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <Logomark size={40} />
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span className="gg-spinner" aria-hidden="true" />
            Opening Giggle...
          </div>
        </div>
      </div>
    );
  }

  // Blocking age gate — stands in front of the whole app until a DOB is set.
  if (!ageConfirmed) {
    return (
      <ToastProvider>
        <AgeGate onDone={() => setAgeConfirmed(true)} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--app-bg, var(--bg))", overflow: "hidden" }}>
      {!isCalling && <a className="gg-skip-link" href="#main-content">Skip to content</a>}
      {!isCalling && <TopNav />}
      <main
        id="main-content"
        tabIndex={-1}
        className="gg-app-main"
        style={
          isCalling
            ? {
                flex: 1,
                minHeight: 0,
                width: "100%",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }
            : {
                flex: 1,
                maxWidth: 1200,
                margin: "0 auto",
                width: "100%",
                padding: isPhone ? "20px 16px 40px" : "32px 40px 48px",
                overflowY: "auto",
                boxSizing: "border-box",
              }
        }
      >
        {isCalling ? (
          children
        ) : (
          // No per-pathname key: the entrance reveal runs once on mount instead
          // of re-running on every route change.
          <div
            style={{
              animation: "gg-reveal 0.32s var(--ease-out) both",
            }}
          >
            {children}
          </div>
        )}
      </main>
    </div>
    </ToastProvider>
  );
}
