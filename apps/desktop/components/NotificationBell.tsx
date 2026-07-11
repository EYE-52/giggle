"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icons";
import { useViewport } from "./useViewport";
import {
  api,
  subscribeNotifications,
  type AppNotification,
  type NotificationType,
} from "@giggle/core";

// ── helpers ──────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  return `${w}w`;
}

// Per-type accent tint + icon. Uses brand vars where sensible, semantic tones otherwise.
function typeStyle(type: NotificationType): { tint: string; icon: (s: number) => React.ReactNode } {
  switch (type) {
    case "friend_request":
      return { tint: "#7C5CFF", icon: (s) => <Icon.users size={s} color="#fff" strokeWidth={2} /> };
    case "squad_invite":
      return { tint: "#38BDF8", icon: (s) => <Icon.users size={s} color="#fff" strokeWidth={2} /> };
    case "join_request":
      return { tint: "#F59E0B", icon: (s) => <Icon.users size={s} color="#fff" strokeWidth={2} /> };
    case "squad_joined":
      return { tint: "#C2FF3D", icon: (s) => <Icon.users size={s} color="#0b0b12" strokeWidth={2.2} /> };
    default:
      return { tint: "#9A9AB0", icon: (s) => <Icon.bell size={s} color="#fff" /> };
  }
}

const REDUCED =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? () => window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : () => false;

// ── small action pill (matches app's tactile/focus conventions) ─────────────

function Pill({
  label,
  onClick,
  variant = "neutral",
  busy = false,
}: {
  label: string;
  onClick: () => void;
  variant?: "primary" | "danger" | "neutral";
  busy?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const bg =
    variant === "primary"
      ? hover
        ? "var(--violet-bright)"
        : "var(--violet)"
      : variant === "danger"
      ? hover
        ? "rgba(255,92,92,0.18)"
        : "rgba(255,92,92,0.10)"
      : hover
      ? "var(--overlay-hover)"
      : "var(--overlay)";
  const color = variant === "primary" ? "#fff" : variant === "danger" ? "#FF7A7A" : "var(--text)";
  const border =
    variant === "primary"
      ? "1px solid transparent"
      : variant === "danger"
      ? "1px solid rgba(255,92,92,0.28)"
      : "1px solid var(--border)";
  return (
    <button
      type="button"
      className="gg-press gg-focusable"
      disabled={busy}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 44,
        padding: "0 12px",
        borderRadius: 999,
        border,
        background: bg,
        color,
        fontSize: 12.5,
        fontWeight: 700,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.7 : 1,
        transition:
          "background-color var(--dur) var(--ease-inout), border-color var(--dur) var(--ease-inout), transform var(--dur) var(--ease-out)",
      }}
    >
      {busy ? <span className="gg-spinner" style={{ width: 13, height: 13 }} /> : label}
    </button>
  );
}

// ── one notification row ────────────────────────────────────────────────────

function Row({
  n,
  onResolve,
  onDismiss,
}: {
  n: AppNotification;
  onResolve: (id: string) => void; // called after markRead; keeps item visible
  onDismiss: (id: string) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const ts = typeStyle(n.type);
  const dim = n.read;

  const markRead = useCallback(async () => {
    try {
      await api.markNotificationRead(n.id);
      onResolve(n.id);
      return true;
    } catch {
      return false;
    }
  }, [n.id, onResolve]);

  const accept = async () => {
    if (!n.fromUserId) return;
    setBusy("accept");
    setActionError(null);
    try {
      await api.acceptFriend(n.fromUserId);
      if (!(await markRead())) throw new Error("MARK_READ_FAILED");
      setResolved("Accepted");
    } catch {
      setActionError("Couldn't accept this friend request.");
      setBusy(null);
    }
  };
  const decline = async () => {
    if (!n.fromUserId) return;
    setBusy("decline");
    setActionError(null);
    try {
      await api.declineFriend(n.fromUserId);
      if (!(await markRead())) throw new Error("MARK_READ_FAILED");
      setResolved("Declined");
    } catch {
      setActionError("Couldn't decline this friend request.");
      setBusy(null);
    }
  };
  const join = async () => {
    if (!n.squadCode) return;
    setBusy("join");
    setActionError(null);
    try {
      const res = await api.joinSquad({ squadCode: n.squadCode });
      if (!(await markRead())) throw new Error("MARK_READ_FAILED");
      if ("status" in res && res.status === "requested") {
        setResolved("Requested");
      } else {
        onDismiss(n.id);
        router.push(`/lobby?squad=${res.squadId}`);
      }
    } catch {
      setActionError("Couldn't join this squad invite.");
      setBusy(null);
    }
  };
  const dismiss = async () => {
    setBusy("dismiss");
    setActionError(null);
    try {
      await api.dismissNotification(n.id);
    } catch {
      try {
        await api.markNotificationRead(n.id);
      } catch {
        setActionError("Couldn't dismiss this notification.");
        setBusy(null);
        return;
      }
    }
    onDismiss(n.id);
  };
  const openLobby = async () => {
    if (!n.squadId) return;
    try {
      await api.markNotificationRead(n.id);
    } catch {
      setActionError("Couldn't open this notification.");
      return;
    }
    onDismiss(n.id);
    router.push(`/lobby?squad=${n.squadId}`);
  };

  // Rows that navigate on tap (join_request / squad_joined / info)
  const tapNavigates = n.type === "join_request";
  const tapDismisses = n.type === "squad_joined" || n.type === "info";

  const rowClickable = tapNavigates || tapDismisses;
  const onRowClick = tapNavigates ? openLobby : tapDismisses ? dismiss : undefined;

  return (
    <div
      role={rowClickable ? "button" : undefined}
      tabIndex={rowClickable ? 0 : undefined}
      onClick={onRowClick}
      onKeyDown={
        rowClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRowClick?.();
              }
            }
          : undefined
      }
      className={rowClickable ? "gg-press-card gg-focusable" : undefined}
      style={{
        display: "flex",
        gap: 11,
        padding: "12px 14px",
        borderRadius: 12,
        cursor: rowClickable ? "pointer" : "default",
        opacity: dim ? 0.55 : 1,
        transition: "opacity var(--dur) var(--ease-inout), background-color var(--dur) var(--ease-inout)",
      }}
    >
      {/* type icon + tinted dot */}
      <div style={{ position: "relative", flexShrink: 0 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: `color-mix(in srgb, ${ts.tint} 22%, transparent)`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              borderRadius: 6,
              background: ts.tint,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {ts.icon(13)}
          </div>
        </div>
        {!n.read && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              width: 9,
              height: 9,
              borderRadius: 999,
              background: ts.tint,
              boxShadow: "0 0 0 2px var(--surface)",
            }}
          />
        )}
      </div>

      {/* content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontWeight: 700,
              fontSize: 13.5,
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {n.title}
          </span>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--text-muted)", flexShrink: 0 }}>
            {relTime(n.createdAt)}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4 }}>{n.body}</div>

        {/* actions */}
        {!resolved && n.type === "friend_request" && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Pill label="Accept" variant="primary" busy={busy === "accept"} onClick={accept} />
            <Pill label="Decline" variant="danger" busy={busy === "decline"} onClick={decline} />
          </div>
        )}
        {!resolved && n.type === "squad_invite" && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <Pill label="Join" variant="primary" busy={busy === "join"} onClick={join} />
            <Pill label="Dismiss" variant="neutral" busy={busy === "dismiss"} onClick={dismiss} />
          </div>
        )}
        {resolved && (
          <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{resolved}</div>
        )}
        {actionError && (
          <div role="alert" style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "var(--coral)" }}>
            {actionError}
          </div>
        )}
      </div>
    </div>
  );
}

// ── live toast (glass card near bell) ───────────────────────────────────────

function LiveToast({
  n,
  onOpen,
  onClose,
  isPhone,
}: {
  n: AppNotification;
  onOpen: () => void;
  onClose: () => void;
  isPhone: boolean;
}) {
  const ts = typeStyle(n.type);
  useEffect(() => {
    if (REDUCED()) {
      const t = setTimeout(onClose, 5000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [n.id, onClose]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="gg-toast gg-press-card gg-focusable"
      style={{
        position: "fixed",
        top: isPhone ? 72 : 72,
        right: isPhone ? 8 : 16,
        left: isPhone ? 8 : "auto",
        zIndex: 80,
        maxWidth: isPhone ? "none" : 340,
        display: "flex",
        gap: 10,
        alignItems: "flex-start",
        padding: "12px 14px",
        borderRadius: 14,
        cursor: "pointer",
        background: "color-mix(in srgb, var(--surface) 88%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--border-strong)",
        boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 9,
          flexShrink: 0,
          background: ts.tint,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {ts.icon(15)}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{n.title}</div>
        <div
          style={{
            fontSize: 12,
            color: "var(--text-muted)",
            marginTop: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
          }}
        >
          {n.body}
        </div>
      </div>
    </div>
  );
}

// ── main bell ────────────────────────────────────────────────────────────────

export function NotificationBell() {
  const { isPhone } = useViewport();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [toast, setToast] = useState<AppNotification | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.listNotifications();
      setItems(res.notifications);
      setUnread(res.unread);
    } catch {
      /* offline / not signed in — leave state as-is */
    }
  }, []);

  // initial load + 45s poll fallback
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 45000);
    return () => clearInterval(t);
  }, [load]);

  // live socket push
  useEffect(() => {
    return subscribeNotifications((n) => {
      setItems((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev]));
      if (!n.read) setUnread((u) => u + 1);
      setToast(n);
    });
  }, []);

  // close on outside click / escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const openPanel = useCallback(() => {
    setOpen(true);
    setToast(null);
    setPanelError(null);
    void (async () => {
      const previousUnread = unread;
      const previousItems = items;
      try {
        await api.markNotificationsRead();
        setUnread(0);
        setItems((prev) => prev.map((p) => ({ ...p, read: true })));
      } catch {
        setUnread(previousUnread);
        setItems(previousItems);
        setPanelError("Couldn't mark notifications read. Check your connection.");
      }
    })();
  }, [items, unread]);

  const toggle = () => (open ? setOpen(false) : openPanel());

  const markAllRead = async () => {
    const previousUnread = unread;
    const previousItems = items;
    setPanelError(null);
    try {
      await api.markNotificationsRead();
      setUnread(0);
      setItems((prev) => prev.map((p) => ({ ...p, read: true })));
    } catch {
      setUnread(previousUnread);
      setItems(previousItems);
      setPanelError("Couldn't mark notifications read. Check your connection.");
    }
  };

  const onResolveRow = useCallback((id: string) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, read: true } : p)));
    setUnread((u) => Math.max(0, u - 1));
  }, []);
  const onDismissRow = useCallback((id: string) => {
    setItems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const badge = unread > 0 ? (unread > 9 ? "9+" : String(unread)) : null;

  const panelStyle: React.CSSProperties = isPhone
    ? {
        position: "fixed",
        top: 64,
        left: 0,
        right: 0,
        maxHeight: "calc(100vh - 64px)",
        borderRadius: "0 0 18px 18px",
      }
    : {
        position: "absolute",
        top: "calc(100% + 10px)",
        right: 0,
        width: 380,
        maxHeight: "min(560px, calc(100vh - 96px))",
        borderRadius: 16,
      };

  return (
    <div ref={wrapRef} style={{ position: "relative", marginLeft: isPhone ? 2 : 4 }}>
      {/* bell button */}
      <button
        type="button"
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className="gg-press gg-focusable"
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 8,
          minWidth: 44,
          minHeight: 44,
          width: 44,
          height: 44,
          borderRadius: 999,
          background: open || hover ? "var(--overlay-hover)" : "var(--overlay)",
          border: open || hover ? "1px solid var(--border-strong)" : "1px solid var(--border)",
          cursor: "pointer",
          transition:
            "background-color var(--dur) var(--ease-inout), border-color var(--dur) var(--ease-inout), transform var(--dur) var(--ease-out)",
        }}
      >
        <Icon.bell size={18} color={open || hover ? "var(--violet)" : "var(--text-muted)"} />
        {badge && (
          <span
            aria-label={`${unread} unread`}
            style={{
              position: "absolute",
              top: 2,
              right: 2,
              minWidth: 16,
              height: 16,
              padding: "0 4px",
              borderRadius: 999,
              background: "var(--violet)",
              color: "#fff",
              fontSize: 10,
              fontWeight: 800,
              lineHeight: "16px",
              textAlign: "center",
              boxShadow: "0 0 0 2px var(--bg)",
              fontFamily: "var(--font-space-grotesk)",
            }}
          >
            {badge}
          </span>
        )}
      </button>

      {/* live toast */}
      {toast && !open && (
        <LiveToast
          n={toast}
          isPhone={isPhone}
          onOpen={openPanel}
          onClose={() => setToast(null)}
        />
      )}

      {/* panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="gg-reveal"
          style={{
            ...panelStyle,
            zIndex: 70,
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px 12px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ fontWeight: 800, fontSize: 15, color: "var(--text)" }}>Notifications</span>
            {items.some((i) => !i.read) && (
              <button
                type="button"
                className="gg-focusable"
                onClick={markAllRead}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--violet)",
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: "4px 6px",
                  borderRadius: 8,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* list */}
          <div style={{ overflowY: "auto", padding: 6 }}>
            {panelError && (
              <div role="alert" style={{ margin: "6px 8px 8px", color: "var(--coral)", fontSize: 12.5, fontWeight: 700 }}>
                {panelError}
              </div>
            )}
            {items.length === 0 ? (
              <div
                style={{
                  padding: "40px 20px",
                  textAlign: "center",
                  color: "var(--text-muted)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 10, opacity: 0.6 }}>
                  <Icon.bell size={30} color="var(--text-muted)" />
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>You&apos;re all caught up</div>
                <div style={{ fontSize: 12.5, marginTop: 3 }}>New activity will show up here.</div>
              </div>
            ) : (
              items.map((n) => <Row key={n.id} n={n} onResolve={onResolveRow} onDismiss={onDismissRow} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}
