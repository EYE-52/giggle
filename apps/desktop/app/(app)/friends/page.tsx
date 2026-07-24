"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Icon } from "@/components/Icons";
import { Avatar } from "@/components/Avatar";
import { AvatarArt } from "@/components/AvatarArt";
import { useViewport } from "@/components/useViewport";
import { Modal } from "@/components/Modal";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { api } from "@giggle/core";
import type { MySquadLite } from "@giggle/core";

// ── Contract types (mirror the backend/core agent's interfaces) ───────────────
interface Friend {
  userId: string;
  name: string;
  image?: string;
  online: boolean;
}
interface FriendRequestUser {
  userId: string;
  name: string;
  image?: string;
  online?: boolean;
}

const violet = "var(--accent, var(--violet))";
const lime = "var(--live, var(--lime))";
const text = "var(--text)";
const muted = "var(--text-muted)";
const dim = "var(--text-dim)";
const radiusTile = "var(--radius-tile, 16px)";
const radiusControl = "var(--radius-control, 14px)";
const radiusPill = "var(--radius-pill, 999px)";
const controlBorder = "var(--control-border, 1px solid var(--border))";
const fontDisplay = "var(--font-display, var(--font-space-grotesk))";
const onAccent = "var(--on-accent, #fff)";
const MAX_SEARCH_QUERY = 64;

/** Avatar that prefers the user's avatar art when present, else initials. */
function UserAvatar({ name, image, size = 44, online }: { name: string; image?: string; size?: number; online?: boolean }) {
  if (image) return <AvatarArt value={image} size={size} online={online} />;
  return <Avatar name={name} size={size} online={online} />;
}

export default function FriendsPage() {
  const { isPhone } = useViewport();
  const { toast } = useToast();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestUser[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Friend[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [requested, setRequested] = useState<Set<string>>(new Set());

  // Inline remove confirmation
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [searchFocus, setSearchFocus] = useState(false);

  // Invite-to-squad flow: pick a squad for a chosen friend.
  const [inviteFriend, setInviteFriend] = useState<Friend | null>(null);

  // ≥2 consecutive refetch failures → surface a small "connection trouble"
  // banner (dismissible; auto-clears on the next successful poll).
  const failCount = useRef(0);
  const [connTrouble, setConnTrouble] = useState(false);

  // Guards in-flight refetches from setting state after unmount (the interval
  // is cleared on unmount, but a pending request can still resolve later).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refetch = useCallback(async () => {
    try {
      const [f, r] = await Promise.all([api.listFriends(), api.friendRequests()]);
      if (!mounted.current) return;
      setFriends(f?.friends ?? []);
      setIncoming(r?.incoming ?? []);
      setOutgoing(r?.outgoing ?? []);
      failCount.current = 0;
      setConnTrouble(false);
    } catch (e) {
      console.error("friends refetch failed:", e);
      failCount.current += 1;
      if (mounted.current && failCount.current >= 2) setConnTrouble(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  // Initial load — auth is gated by the (app) layout.
  useEffect(() => { refetch(); }, [refetch]);

  // Live presence: poll every 20s + on window focus.
  useEffect(() => {
    const id = setInterval(refetch, 20_000);
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refetch]);

  // Debounced search (~300ms)
  const searchSeq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      try {
        const { users } = await api.searchUsers(q);
        if (seq === searchSeq.current) {
          setResults(users ?? []);
          setSearched(true);
        }
      } catch (e) {
        // Mark as searched so the UI shows "no people found" instead of a
        // permanently blank block after a failed search.
        if (seq === searchSeq.current) { setResults([]); setSearched(true); }
        console.error("searchUsers failed:", e);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // ── Actions (optimistic) ───────────────────────────────────────────────────
  async function handleAdd(u: Friend) {
    setRequested((s) => new Set(s).add(u.userId));
    setOutgoing((o) => (o.some((x) => x.userId === u.userId) ? o : [...o, u]));
    try {
      await api.sendFriendRequest(u.userId);
    } catch (e) {
      setRequested((s) => {
        const n = new Set(s);
        n.delete(u.userId);
        return n;
      });
      setOutgoing((o) => o.filter((x) => x.userId !== u.userId));
      toast((e as { message?: string })?.message || "Couldn't send friend request.", "error");
    }
  }

  async function handleAccept(u: FriendRequestUser) {
    setIncoming((i) => i.filter((x) => x.userId !== u.userId));
    setFriends((f) => [{ userId: u.userId, name: u.name, image: u.image, online: !!u.online }, ...f]);
    try {
      await api.acceptFriend(u.userId);
      refetch();
    } catch (e) {
      setIncoming((i) => (i.some((x) => x.userId === u.userId) ? i : [u, ...i]));
      setFriends((f) => f.filter((x) => x.userId !== u.userId));
      toast((e as { message?: string })?.message || "Couldn't accept friend request.", "error");
    }
  }

  async function handleDecline(u: FriendRequestUser) {
    setIncoming((i) => i.filter((x) => x.userId !== u.userId));
    try {
      await api.declineFriend(u.userId);
    } catch (e) {
      setIncoming((i) => (i.some((x) => x.userId === u.userId) ? i : [u, ...i]));
      toast((e as { message?: string })?.message || "Couldn't decline friend request.", "error");
    }
  }

  async function handleRemove(u: Friend) {
    setConfirmRemove(null);
    setFriends((f) => f.filter((x) => x.userId !== u.userId));
    try {
      await api.removeFriend(u.userId);
    } catch (e) {
      setFriends((f) => (f.some((x) => x.userId === u.userId) ? f : [u, ...f]));
      toast((e as { message?: string })?.message || "Couldn't remove friend.", "error");
    }
  }

  // Online friends first, then a stable name (then id) tiebreak so 20s polls
  // don't shuffle equal-status friends.
  const sortedFriends = [...friends].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId);
  });

  const onlineCount = friends.filter((f) => f.online).length;
  const friendIds = new Set(friends.map((f) => f.userId));
  const incomingIds = new Set(incoming.map((u) => u.userId));

  const sectionTitleStyle: React.CSSProperties = {
    fontFamily: fontDisplay,
    fontSize: 17,
    fontWeight: 700,
    color: text,
    margin: 0,
    letterSpacing: "-0.01em",
  };

  return (
    <div className="gg-reveal" style={{ display: "flex", flexDirection: "column", gap: 24, paddingBottom: 40 }}>
      {/* Header */}
      <PageHeader
        title="Friends"
        subtitle={onlineCount > 0 ? `${onlineCount} online now` : "Find people and see who's around."}
      />

      {connTrouble && (
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: radiusControl, border: "1px solid color-mix(in srgb, var(--coral) 45%, transparent)", background: "var(--coral-soft)", color: "var(--coral)", fontSize: 14, fontWeight: 600 }}>
          <span className="gg-spinner" aria-hidden="true" />
          <span style={{ flex: 1 }}>Connection trouble — retrying…</span>
          <button
            onClick={() => setConnTrouble(false)}
            aria-label="Dismiss"
            className="gg-press"
            style={{ width: 32, height: 32, background: "none", border: "none", cursor: "pointer", padding: 0, display: "grid", placeItems: "center" }}
          >
            <Icon.close size={13} color="var(--coral)" />
          </button>
        </div>
      )}

      {/* ── Add friends ──────────────────────────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <Icon.discover size={18} color={dim} />
          </span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, MAX_SEARCH_QUERY))}
            onFocus={() => setSearchFocus(true)}
            onBlur={() => setSearchFocus(false)}
            placeholder="Search by name…"
            maxLength={MAX_SEARCH_QUERY}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "13px 16px 13px 42px",
              borderRadius: radiusControl,
              background: "var(--surface)",
              border: searchFocus ? `1px solid ${violet}` : controlBorder,
              boxShadow: searchFocus ? `0 0 0 3px color-mix(in srgb, ${violet} 30%, transparent)` : "none",
              color: text,
              fontSize: 14,
              fontFamily: "var(--font-inter)",
              outline: "none",
              transition: "box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
            }}
          />
        </div>

        {query.trim() && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {query.trim().length < 2 ? (
              <EmptyHint>Type at least 2 characters to search.</EmptyHint>
            ) : searching && results.length === 0 ? (
              // Skeleton rows matching the result-row height — no spinner jump.
              <div aria-label="Searching" role="status" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="gg-shimmer" style={{ height: 62, borderRadius: radiusControl }} />
                ))}
              </div>
            ) : results.length === 0 && searched ? (
              <EmptyHint>No people found for “{query.trim()}”.</EmptyHint>
            ) : (
              results.map((u) => {
                const isFriend = friendIds.has(u.userId);
                const incomingRequest = incoming.find((i) => i.userId === u.userId);
                const isRequested = !incomingIds.has(u.userId) && (requested.has(u.userId) || outgoing.some((o) => o.userId === u.userId));
                return (
                  <Row key={u.userId} u={u}>
                    {isFriend ? (
                      <Pill tone="muted">Friends</Pill>
                    ) : incomingRequest ? (
                      <div style={{ display: "flex", gap: 8 }}>
                        <ActionButton onClick={() => handleAccept(incomingRequest)} tone="violet">Accept</ActionButton>
                        <ActionButton onClick={() => handleDecline(incomingRequest)} tone="ghost">Decline</ActionButton>
                      </div>
                    ) : isRequested ? (
                      <Pill tone="muted">Requested</Pill>
                    ) : (
                      <ActionButton onClick={() => handleAdd(u)} tone="violet">
                        <Icon.plus size={15} color={onAccent} strokeWidth={2.4} /> Add
                      </ActionButton>
                    )}
                  </Row>
                );
              })
            )}
          </div>
        )}
      </section>

      {/* ── Requests ─────────────────────────────────────────────── */}
      {(incoming.length > 0 || outgoing.length > 0) && (
        <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 style={sectionTitleStyle}>
            Requests {incoming.length > 0 && <span style={{ color: violet }}>· {incoming.length}</span>}
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {incoming.map((u) => (
              <Row key={u.userId} u={u}>
                <div style={{ display: "flex", gap: 8 }}>
                  <ActionButton onClick={() => handleAccept(u)} tone="violet">Accept</ActionButton>
                  <ActionButton onClick={() => handleDecline(u)} tone="ghost">Decline</ActionButton>
                </div>
              </Row>
            ))}
            {outgoing.map((u) => (
              <Row key={`out-${u.userId}`} u={u}>
                <Pill tone="muted">Pending</Pill>
              </Row>
            ))}
          </div>
        </section>
      )}

      {/* ── Your friends ─────────────────────────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={sectionTitleStyle}>Your friends {friends.length > 0 && <span style={{ color: muted }}>· {friends.length}</span>}</h2>

        {loading ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isPhone ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: radiusTile, background: "var(--surface)", border: controlBorder }}>
                <div className="gg-shimmer" style={{ width: 46, height: 46, borderRadius: radiusPill }} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="gg-shimmer" style={{ height: 14, width: "55%", borderRadius: 6 }} />
                  <div className="gg-shimmer" style={{ height: 11, width: "32%", borderRadius: 6 }} />
                </div>
              </div>
            ))}
          </div>
        ) : friends.length === 0 ? (
          <FriendsEmptyState />
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isPhone ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            {sortedFriends.map((f) => (
              <div
                key={f.userId}
                className="gg-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: 14,
                  borderRadius: radiusTile,
                  background: "var(--surface)",
                  border: controlBorder,
                }}
              >
                <UserAvatar name={f.name} image={f.image} size={46} online={f.online} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 14, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {f.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                    <span style={{ width: 7, height: 7, borderRadius: radiusPill, background: f.online ? lime : "var(--border-strong)", boxShadow: f.online ? `0 0 8px ${lime}` : undefined }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: f.online ? "var(--lime-text)" : dim, fontFamily: "var(--font-inter)" }}>
                      {f.online ? "Online" : "Offline"}
                    </span>
                  </div>
                </div>
                {confirmRemove === f.userId ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <ActionButton onClick={() => handleRemove(f)} tone="danger">Remove</ActionButton>
                    <ActionButton onClick={() => setConfirmRemove(null)} tone="ghost">Cancel</ActionButton>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => setInviteFriend(f)}
                    title="Invite to squad"
                    aria-label={`Invite ${f.name} to a squad`}
                    className="gg-press"
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 40, height: 40,
                      borderRadius: radiusPill,
                      background: "var(--accent-soft)",
                      border: "1px solid var(--accent-line)",
                      cursor: "pointer",
                      transition: "transform .14s ease, background .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                    }}
                  >
                    {/* users + plus badge — distinct from the nav's plain users icon */}
                    <span aria-hidden="true" style={{ position: "relative", display: "inline-flex" }}>
                      <Icon.users size={15} color={violet} strokeWidth={2.2} />
                      <span style={{ position: "absolute", top: -5, right: -6, width: 12, height: 12, borderRadius: radiusPill, background: "var(--surface)", boxShadow: `0 0 0 1px ${violet}`, display: "grid", placeItems: "center" }}>
                        <Icon.plus size={8} color={violet} strokeWidth={3} />
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => setConfirmRemove(f.userId)}
                    title="Remove friend"
                    className="gg-press"
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 40, height: 40,
                      borderRadius: radiusPill,
                      background: "var(--overlay)",
                      border: controlBorder,
                      cursor: "pointer",
                      transition: "transform .14s ease, background .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                    }}
                  >
                    <Icon.close size={15} color={muted} strokeWidth={2.2} />
                  </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {inviteFriend && (
        <SquadPickerModal
          friend={inviteFriend}
          isPhone={isPhone}
          onClose={() => setInviteFriend(null)}
        />
      )}
    </div>
  );
}

// ── Small building blocks ─────────────────────────────────────────────────────

function FriendsEmptyState() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "18px 0", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--overlay)", flexShrink: 0 }}>
        <Icon.users size={18} color={violet} />
      </div>
      <div>
        <h3 style={{ margin: 0, color: text, fontFamily: fontDisplay, fontSize: 14, fontWeight: 700 }}>Your crew starts here</h3>
        <p style={{ margin: "3px 0 0", color: muted, fontSize: 13 }}>Search by name above to send your first request.</p>
      </div>
    </div>
  );
}

/**
 * Lightweight squad-picker: invite a known friend to one of my squads.
 * - Loads api.mySquads() on open.
 * - 0 squads → "Create a squad first".
 * - 1+ squads → list to pick from; every invite is an explicit click (no
 *   auto-fire even for a single squad — sending on open surprised people).
 */
function SquadPickerModal({ friend, isPhone, onClose }: { friend: Friend; isPhone: boolean; onClose: () => void }) {
  const [squads, setSquads] = useState<MySquadLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // invite status keyed by squadId
  const [status, setStatus] = useState<Record<string, "inviting" | "invited" | "error">>({});
  const [rowErr, setRowErr] = useState<Record<string, string>>({});

  const invite = useCallback(async (squadId: string) => {
    setStatus((s) => ({ ...s, [squadId]: "inviting" }));
    setRowErr((s) => { const n = { ...s }; delete n[squadId]; return n; });
    try {
      const { invited } = await api.inviteUserToSquad(squadId, friend.userId);
      setStatus((s) => ({ ...s, [squadId]: invited ? "invited" : "error" }));
      if (!invited) setRowErr((s) => ({ ...s, [squadId]: "Already invited or a member." }));
    } catch (e) {
      console.error("inviteUserToSquad failed:", e);
      setStatus((s) => ({ ...s, [squadId]: "error" }));
      setRowErr((s) => ({ ...s, [squadId]: "Couldn't invite — try again." }));
    }
  }, [friend.userId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { squads } = await api.mySquads();
        if (!alive) return;
        setSquads(squads ?? []);
      } catch (e) {
        console.error("mySquads failed:", e);
        if (alive) setError("Couldn't load your squads.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <Modal
      onClose={onClose}
      title="Invite to squad"
      subtitle={<>Pick a squad for <span style={{ color: text, fontWeight: 600 }}>{friend.name}</span></>}
      sheet={isPhone}
      width={420}
    >
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {loading ? (
            <EmptyHint><span className="gg-spinner" style={{ marginRight: 8 }} />Loading your squads…</EmptyHint>
          ) : error ? (
            <EmptyHint>{error}</EmptyHint>
          ) : squads.length === 0 ? (
            <div style={{ padding: "24px 12px", textAlign: "center", color: muted, fontSize: 14, fontFamily: "var(--font-inter)" }}>
              Create a squad first — then you can invite {friend.name}.
            </div>
          ) : (
            squads.map((sq) => {
              const st = status[sq.squadId];
              const invited = st === "invited";
              const inviting = st === "inviting";
              return (
                <div key={sq.squadId}>
                  <div className="gg-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: radiusControl, background: "var(--surface)", border: controlBorder }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 14, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sq.squadName}</div>
                      <div style={{ fontSize: 12, color: dim, fontFamily: "var(--font-inter)", marginTop: 1 }}>{sq.memberCount}/{sq.maxSlots} members</div>
                    </div>
                    <button
                      onClick={() => invite(sq.squadId)}
                      disabled={invited || inviting}
                      className="gg-press"
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
                        minHeight: 38, padding: "8px 16px", borderRadius: radiusPill,
                        fontFamily: "var(--font-inter)", fontWeight: 700, fontSize: 14, whiteSpace: "nowrap",
                        cursor: invited || inviting ? "default" : "pointer",
                        border: invited ? `1px solid ${lime}` : "none",
                        background: invited ? `color-mix(in srgb, ${lime} 14%, transparent)` : violet,
                        color: invited ? "var(--lime-text)" : onAccent,
                        transition: "background .2s var(--ease-ui), color .2s var(--ease-ui)",
                      }}
                    >
                      {invited ? (<>Invited <span aria-hidden="true">✓</span></>) : inviting ? "Inviting…" : "Invite"}
                    </button>
                  </div>
                  {rowErr[sq.squadId] && (
                    <div style={{ fontSize: 12, color: "var(--coral)", fontFamily: "var(--font-inter)", padding: "5px 12px 0" }}>{rowErr[sq.squadId]}</div>
                  )}
                </div>
              );
            })
          )}
      </div>
    </Modal>
  );
}

function Row({ u, children }: { u: Friend | FriendRequestUser; children: React.ReactNode }) {
  return (
    <div
      className="gg-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderRadius: radiusControl,
        background: "var(--surface)",
        border: controlBorder,
      }}
    >
      <UserAvatar name={u.name} image={u.image} size={40} online={!!u.online} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 14, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {u.name}
        </div>
        {u.online && (
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--lime-text)", fontFamily: "var(--font-inter)", marginTop: 1 }}>Online</div>
        )}
      </div>
      {children}
    </div>
  );
}

/* v3 mapping: violet→primary, ghost→ghost, danger→tonal-coral danger (spec 03). */
function ActionButton({ children, onClick, tone }: { children: React.ReactNode; onClick: () => void; tone: "violet" | "ghost" | "danger" }) {
  const variant = tone === "violet" ? "primary" : tone;
  return (
    <Button variant={variant} size="sm" onClick={onClick}>
      {children}
    </Button>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "muted" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "7px 14px",
        borderRadius: radiusPill,
        fontFamily: "var(--font-inter)",
        fontWeight: 600,
        fontSize: 13,
        color: dim,
        background: "var(--overlay)",
        border: controlBorder,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ padding: "12px 4px", color: muted, fontSize: 14, fontFamily: "var(--font-inter)" }}>{children}</div>
  );
}
