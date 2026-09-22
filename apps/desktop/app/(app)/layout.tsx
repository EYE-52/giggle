"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TopNav } from "@/components/TopNav";
import { ToastProvider } from "@/components/Toast";
import { Logomark } from "@/components/Brand";
import { session, connectSocket, getMyAvatar } from "@giggle/core";
import { AvatarPicker } from "@/components/AvatarPicker";
import { reconcileMyAvatar } from "@/lib/avatarSync";
import { AgeGate } from "@/components/AgeGate";
import { WEB_DISCOVERY_ENABLED } from "@/lib/discovery";
import { IdentityOnlyAccount } from "@/components/IdentityOnlyAccount";

const CALLING_ROUTES = ["/lobby", "/encounter", "/matchmaking", "/match"];
const DISCOVERY_ROUTES = ["/discover", "/matchmaking", "/match"];
const AVATAR_PROMPTED_KEY = "giggle.avatarPrompted";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isCalling = CALLING_ROUTES.some((r) => pathname === r);
  const discoveryRouteDisabled = !WEB_DISCOVERY_ENABLED && DISCOVERY_ROUTES.includes(pathname);
  const [authReady, setAuthReady] = useState(false);
  const [hasAdultAccess, setHasAdultAccess] = useState(false);
  const identityOnlyAccess = authReady && session.hasIdentityOnlyAccess;
  const identityRouteBlocked = identityOnlyAccess && session.accountStatus !== "active" && pathname !== "/profile";
  const identityProfile = identityOnlyAccess && pathname === "/profile";
  const [avatarPrompt, setAvatarPrompt] = useState(false);

  // Auth gate: the whole (app) area requires a session. In production the only
  // way in is real OAuth — unauthenticated users are sent to /signin. In local
  // dev we auto dev-sign-in so the flow stays frictionless (devSignIn is a no-op
  // in production, so this can't be a backdoor live).
  useEffect(() => {
    let cancelled = false;
    async function ensureSession() {
      if (session.isAuthed()) {
        await session.syncAgeFromServer();
        if (!cancelled) {
          setHasAdultAccess(session.hasAdultAccess);
          setAuthReady(true);
        }
        return;
      }
      if (process.env.NODE_ENV !== "production") {
        try {
          await session.devSignIn();
          await session.syncAgeFromServer();
          if (!cancelled) {
            setHasAdultAccess(session.hasAdultAccess);
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

  useEffect(() => {
    if (identityRouteBlocked) router.replace("/profile");
    else if (discoveryRouteDisabled) router.replace("/home");
  }, [discoveryRouteDisabled, identityRouteBlocked, router]);

  // Sync the shared avatar once adult access is confirmed; people who have
  // never picked one get a one-time picker (never over a call).
  useEffect(() => {
    if (!authReady || !hasAdultAccess) return;
    const neverPicked = reconcileMyAvatar(session.user?.avatar);
    let prompted = false;
    try { prompted = localStorage.getItem(AVATAR_PROMPTED_KEY) === "1"; } catch {}
    if (neverPicked && !prompted) setAvatarPrompt(true);
  }, [authReady, hasAdultAccess]);

  function closeAvatarPrompt() {
    setAvatarPrompt(false);
    try { localStorage.setItem(AVATAR_PROMPTED_KEY, "1"); } catch {}
  }

  // Open the authenticated presence socket for the app session so the user
  // counts as "online" app-wide (the backend marks online via the handshake).
  // Not torn down on route changes — kept for the whole app session. Network
  // drops auto-reconnect (socket.io); intentional client disconnects elsewhere
  // (e.g. a page calling disconnectSocket) are re-opened here so presence
  // resumes instead of latching offline for the rest of the session.
  const reconnectTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!authReady || !hasAdultAccess || !session.isAuthed()) return;
    const s = connectSocket();
    const onDisconnect = (reason: string) => {
      // socket.io retries every other reason on its own.
      if (reason !== "io client disconnect") return;
      if (reconnectTimer.current != null) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = window.setTimeout(() => {
        reconnectTimer.current = null;
        if (session.isAuthed() && session.hasAdultAccess) connectSocket();
      }, 400);
    };
    s.on("disconnect", onDisconnect);
    return () => {
      s.off("disconnect", onDisconnect);
      if (reconnectTimer.current != null) window.clearTimeout(reconnectTimer.current);
    };
  }, [authReady, hasAdultAccess]);

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

  if (identityRouteBlocked) {
    return <div role="status" aria-live="polite">Opening account controls…</div>;
  }

  if (identityProfile) {
    return (
      <ToastProvider>
        <IdentityOnlyAccount
          onReturnToVerification={session.accountStatus === "active" ? () => router.replace("/home") : undefined}
        />
      </ToastProvider>
    );
  }

  if (!hasAdultAccess) {
    return (
      <ToastProvider>
        <AgeGate
          onDone={() => setHasAdultAccess(true)}
          onManageAccount={() => router.push("/profile")}
        />
      </ToastProvider>
    );
  }

  if (discoveryRouteDisabled) {
    return (
      <div role="status" aria-live="polite" style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "var(--bg)", color: "var(--text-muted)" }}>
        Stranger discovery is unavailable.
      </div>
    );
  }

  return (
    <ToastProvider>
    <div className={pathname === "/encounter" ? "gg-call-theme" : undefined} style={{ height: "100dvh", display: "flex", flexDirection: "column", background: "var(--app-bg, var(--bg))", overflow: "hidden" }}>
      {!isCalling && <a className="gg-skip-link" href="#main-content">Skip to content</a>}
      {!isCalling && <TopNav />}
      <main
        id="main-content"
        tabIndex={-1}
        className={`gg-app-main${isCalling ? " gg-app-main--calling" : ""}`}
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
                minHeight: 0,
                width: "100%",
                overflowY: "auto",
                // Full-width scroller so the scrollbar sits on the window edge;
                // the centered column lives in .gg-app-container.
                scrollbarGutter: "stable both-edges",
              }
        }
      >
        {isCalling ? (
          children
        ) : (
          // No per-pathname key: the entrance reveal runs once on mount instead
          // of re-running on every route change.
          <div className="gg-app-container" style={{ animation: "gg-reveal 0.32s var(--ease-out) both" }}>
            {children}
          </div>
        )}
      </main>
      {avatarPrompt && !isCalling && (
        <AvatarPicker
          current={getMyAvatar(session.user?.id)}
          title="Pick your avatar"
          subtitle="This is how friends and squads will see you. You can change it anytime in your profile."
          onClose={closeAvatarPrompt}
        />
      )}
    </div>
    </ToastProvider>
  );
}
