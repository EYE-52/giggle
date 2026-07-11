"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { Avatar } from "@/components/Avatar";
import { AvatarArt } from "@/components/AvatarArt";
import { useViewport } from "@/components/useViewport";
import { api, session } from "@giggle/core";
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

const violet = "var(--violet)";
const lime = "var(--lime)";
const text = "var(--text)";
const muted = "var(--text-muted)";
const dim = "var(--text-dim)";
const MAX_SEARCH_QUERY = 64;

/** Avatar that prefers the user's avatar art when present, else initials. */
function UserAvatar({ name, image, size = 44, online }: { name: string; image?: string; size?: number; online?: boolean }) {
  if (image) return <AvatarArt value={image} size={size} online={online} />;
  return <Avatar name={name} size={size} online={online} />;
}

export default function FriendsPage() {
  const router = useRouter();
  const { isPhone } = useViewport();

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
  const [authError, setAuthError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function ensureAuthed() {
    if (session.isAuthed()) return true;
    setAuthError("Sign in to continue.");
    router.push("/signin");
    return false;
  }

  const refetch = useCallback(async () => {
    try {
      const [f, r] = await Promise.all([api.listFriends(), api.friendRequests()]);
      setFriends(f?.friends ?? []);
      setIncoming(r?.incoming ?? []);
      setOutgoing(r?.outgoing ?? []);
    } catch (e) {
      console.error("friends refetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    (async () => {
      if (!ensureAuthed()) {
        setLoading(false);
        return;
      }
      refetch();
    })();
  }, [refetch]);

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
        if (!ensureAuthed()) return;
        const { users } = await api.searchUsers(q);
        if (seq === searchSeq.current) {
          setResults(users ?? []);
          setSearched(true);
        }
      } catch (e) {
        if (seq === searchSeq.current) setResults([]);
        console.error("searchUsers failed:", e);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // ── Actions (optimistic) ───────────────────────────────────────────────────
  async function handleAdd(u: Friend) {
    if (!ensureAuthed()) return;
    setActionError(null);
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
      setActionError((e as { message?: string })?.message || "Couldn't send friend request.");
    }
  }

  async function handleAccept(u: FriendRequestUser) {
    if (!ensureAuthed()) return;
    setActionError(null);
    setIncoming((i) => i.filter((x) => x.userId !== u.userId));
    setFriends((f) => [{ userId: u.userId, name: u.name, image: u.image, online: !!u.online }, ...f]);
    try {
      await api.acceptFriend(u.userId);
      refetch();
    } catch (e) {
      setIncoming((i) => (i.some((x) => x.userId === u.userId) ? i : [u, ...i]));
      setFriends((f) => f.filter((x) => x.userId !== u.userId));
      setActionError((e as { message?: string })?.message || "Couldn't accept friend request.");
    }
  }

  async function handleDecline(u: FriendRequestUser) {
    if (!ensureAuthed()) return;
    setActionError(null);
    setIncoming((i) => i.filter((x) => x.userId !== u.userId));
    try {
      await api.declineFriend(u.userId);
    } catch (e) {
      setIncoming((i) => (i.some((x) => x.userId === u.userId) ? i : [u, ...i]));
      setActionError((e as { message?: string })?.message || "Couldn't decline friend request.");
    }
  }

  async function handleRemove(u: Friend) {
    if (!ensureAuthed()) return;
    setActionError(null);
    setConfirmRemove(null);
    setFriends((f) => f.filter((x) => x.userId !== u.userId));
    try {
      await api.removeFriend(u.userId);
    } catch (e) {
      setFriends((f) => (f.some((x) => x.userId === u.userId) ? f : [u, ...f]));
      setActionError((e as { message?: string })?.message || "Couldn't remove friend.");
    }
  }

  // Online friends first, then alphabetical.
  const sortedFriends = [...friends].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const onlineCount = friends.filter((f) => f.online).length;
  const friendIds = new Set(friends.map((f) => f.userId));
  const incomingIds = new Set(incoming.map((u) => u.userId));

  const sectionTitleStyle: React.CSSProperties = {
    fontFamily: "var(--font-space-grotesk)",
    fontSize: 18,
    fontWeight: 700,
    color: text,
    margin: 0,
    letterSpacing: "-0.01em",
  };

  return (
    <div className="gg-reveal" style={{ display: "flex", flexDirection: "column", gap: 24, paddingBottom: 40 }}>
      {/* Header */}
      <div>
        <h1 style={{ fontFamily: "var(--font-space-grotesk)", fontSize: isPhone ? 26 : 30, fontWeight: 800, color: text, margin: 0, letterSpacing: "-0.02em" }}>Friends</h1>
        <div style={{ color: muted, fontSize: 14, fontFamily: "var(--font-inter)" }}>
          {onlineCount > 0 ? `${onlineCount} online now` : "Find people and see who's around."}
        </div>
      </div>

      {authError && (
        <div role="status" style={{ padding: "12px 14px", borderRadius: 14, border: "1px solid color-mix(in srgb, var(--coral) 42%, transparent)", background: "color-mix(in srgb, var(--coral) 11%, transparent)", color: "var(--text)", fontSize: 14 }}>
          {authError}
        </div>
      )}

      {actionError && (
        <div role="alert" style={{ padding: "12px 14px", borderRadius: 14, border: "1px solid color-mix(in srgb, var(--coral) 42%, transparent)", background: "color-mix(in srgb, var(--coral) 11%, transparent)", color: "var(--text)", fontSize: 14 }}>
          {actionError}
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
              borderRadius: 14,
              background: "var(--surface)",
              border: searchFocus ? "1px solid var(--violet)" : "1px solid var(--border)",
              boxShadow: searchFocus ? "0 0 0 3px color-mix(in srgb, var(--violet) 30%, transparent)" : "none",
              color: text,
              fontSize: 15,
              fontFamily: "var(--font-inter)",
              outline: "none",
              transition: "box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
            }}
          />
        </div>

        {query.trim() && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {searching && results.length === 0 ? (
              <EmptyHint><span className="gg-spinner" style={{ marginRight: 8 }} />Searching…</EmptyHint>
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
                        <Icon.plus size={15} color="#fff" strokeWidth={2.4} /> Add
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
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, background: "var(--surface)", border: "1px solid var(--border)" }}>
                <div className="gg-shimmer" style={{ width: 46, height: 46, borderRadius: 999 }} />
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
                  borderRadius: 16,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
              >
                <UserAvatar name={f.name} image={f.image} size={46} online={f.online} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 15, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {f.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 999, background: f.online ? lime : "var(--border-strong)", boxShadow: f.online ? `0 0 8px ${lime}` : undefined }} />
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: f.online ? "var(--lime-text)" : dim, fontFamily: "var(--font-inter)" }}>
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
                      borderRadius: 999,
                      background: "var(--violet-soft)",
                      border: "1px solid var(--violet)",
                      cursor: "pointer",
                      transition: "transform .14s ease, background .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                    }}
                  >
                    <Icon.users size={15} color={violet} strokeWidth={2.2} />
                  </button>
                  <button
                    onClick={() => setConfirmRemove(f.userId)}
                    title="Remove friend"
                    className="gg-press"
                    style={{
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      width: 40, height: 40,
                      borderRadius: 999,
                      background: "var(--overlay)",
                      border: "1px solid var(--border)",
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
        <h3 style={{ margin: 0, color: text, fontFamily: "var(--font-space-grotesk)", fontSize: 15, fontWeight: 750 }}>Your crew starts here</h3>
        <p style={{ margin: "3px 0 0", color: muted, fontSize: 13 }}>Search by name above to send your first request.</p>
      </div>
    </div>
  );
}

/**
 * Lightweight squad-picker: invite a known friend to one of my squads.
 * - Loads api.mySquads() on open.
 * - 0 squads → "Create a squad first".
 * - 1 squad → invites directly on open (no picker needed).
 * - 2+ squads → list to pick from; each row invites on click.
 */
function SquadPickerModal({ friend, isPhone, onClose }: { friend: Friend; isPhone: boolean; onClose: () => void }) {
  const router = useRouter();
  const [squads, setSquads] = useState<MySquadLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // invite status keyed by squadId
  const [status, setStatus] = useState<Record<string, "inviting" | "invited" | "error">>({});
  const [rowErr, setRowErr] = useState<Record<string, string>>({});

  const invite = useCallback(async (squadId: string) => {
    if (!session.isAuthed()) {
      setError("Sign in to continue.");
      router.push("/signin");
      return;
    }
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
  }, [friend.userId, router]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!session.isAuthed()) {
          setError("Sign in to continue.");
          router.push("/signin");
          return;
        }
        const { squads } = await api.mySquads();
        const list = squads ?? [];
        if (!alive) return;
        setSquads(list);
        // Exactly one squad → invite immediately, no picking required.
        if (list.length === 1) invite(list[0].squadId);
      } catch (e) {
        console.error("mySquads failed:", e);
        if (alive) setError("Couldn't load your squads.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [invite, router]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
        display: "flex", alignItems: isPhone ? "flex-end" : "center", justifyContent: "center",
        padding: isPhone ? 0 : 20,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Invite ${friend.name} to a squad`}
        style={{
          background: "var(--surface)", border: "1px solid var(--border-strong)",
          borderRadius: isPhone ? "24px 24px 0 0" : 22,
          width: isPhone ? "100%" : 420, maxWidth: "100%", maxHeight: isPhone ? "82vh" : "76vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{ padding: "20px 22px 12px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 18, fontWeight: 800, color: text, letterSpacing: "-0.01em" }}>Invite to squad</div>
            <div style={{ color: muted, fontSize: 13, fontFamily: "var(--font-inter)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Pick a squad for <span style={{ color: text, fontWeight: 600 }}>{friend.name}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="gg-press"
            style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--overlay)", border: "1px solid var(--border)", cursor: "pointer" }}
          >
            <Icon.close size={16} color={muted} strokeWidth={2.2} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 16px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
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
                  <div className="gg-row" style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 14.5, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sq.squadName}</div>
                      <div style={{ fontSize: 12, color: dim, fontFamily: "var(--font-inter)", marginTop: 1 }}>{sq.memberCount}/{sq.maxSlots} members</div>
                    </div>
                    <button
                      onClick={() => invite(sq.squadId)}
                      disabled={invited || inviting}
                      className="gg-press"
                      style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
                        minHeight: 38, padding: "8px 16px", borderRadius: 999,
                        fontFamily: "var(--font-inter)", fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap",
                        cursor: invited || inviting ? "default" : "pointer",
                        border: invited ? "1px solid var(--lime)" : "none",
                        background: invited ? "color-mix(in srgb, var(--lime) 14%, transparent)" : violet,
                        color: invited ? "var(--lime-text)" : "#fff",
                      }}
                    >
                      {invited ? "Invited ✓" : inviting ? "Inviting…" : "Invite"}
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
      </div>
    </div>
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
        borderRadius: 14,
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <UserAvatar name={u.name} image={u.image} size={40} online={!!u.online} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 14.5, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
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

function ActionButton({ children, onClick, tone }: { children: React.ReactNode; onClick: () => void; tone: "violet" | "ghost" | "danger" }) {
  const styles: Record<string, React.CSSProperties> = {
    violet: { background: violet, color: "#fff", border: "none" },
    ghost: { background: "transparent", color: muted, border: "1px solid var(--border)" },
    danger: { background: "var(--coral)", color: "#fff", border: "none" },
  };
  return (
    <button
      onClick={onClick}
      className="gg-press"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        minHeight: 40,
        padding: "8px 14px",
        borderRadius: 999,
        fontFamily: "var(--font-inter)",
        fontWeight: 600,
        fontSize: 13.5,
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "transform .14s ease, background .2s var(--ease-ui), border-color .2s var(--ease-ui), color .2s var(--ease-ui)",
        ...styles[tone],
      }}
    >
      {children}
    </button>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "muted" }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "7px 14px",
        borderRadius: 999,
        fontFamily: "var(--font-inter)",
        fontWeight: 600,
        fontSize: 13,
        color: dim,
        background: "var(--overlay)",
        border: "1px solid var(--border)",
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
