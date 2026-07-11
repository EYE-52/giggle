"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TopNav } from "@/components/TopNav";
import { useViewport } from "@/components/useViewport";
import { session, connectSocket } from "@giggle/core";

const CALLING_ROUTES = ["/lobby", "/encounter", "/matchmaking", "/match"];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isCalling = CALLING_ROUTES.some((r) => pathname === r);
  const { isPhone } = useViewport();
  const [authReady, setAuthReady] = useState(false);

  // Auth gate: the whole (app) area requires a session. In production the only
  // way in is real OAuth — unauthenticated users are sent to /signin. In local
  // dev we auto dev-sign-in so the flow stays frictionless (devSignIn is a no-op
  // in production, so this can't be a backdoor live).
  useEffect(() => {
    let cancelled = false;
    async function ensureSession() {
      if (session.isAuthed()) {
        if (!cancelled) setAuthReady(true);
        return;
      }
      if (process.env.NODE_ENV !== "production") {
        try {
          await session.devSignIn();
          if (!cancelled) setAuthReady(true);
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

  // Open the authenticated presence socket once for the app session so the user
  // counts as "online" app-wide (the backend marks online via the handshake).
  // Not torn down on route changes — kept for the whole app session.
  const presenceConnected = useRef(false);
  useEffect(() => {
    if (presenceConnected.current) return;
    if (authReady && session.isAuthed()) {
      presenceConnected.current = true;
      connectSocket();
    }
  }, [authReady]);

  if (!authReady) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg)", color: "var(--text-muted)", fontFamily: "var(--font-space-grotesk)", fontWeight: 700 }}>
        Opening Giggle...
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg)", overflow: "hidden" }}>
      {!isCalling && <a className="gg-skip-link" href="#main-content">Skip to content</a>}
      {!isCalling && <TopNav />}
      <main
        id="main-content"
        tabIndex={-1}
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
          <div
            key={pathname}
            style={{
              animation: "fadeUp 0.32s var(--ease-out) both",
            }}
          >
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
