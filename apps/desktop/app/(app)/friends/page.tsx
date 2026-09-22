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
import { pollWhileVisible } from "@/lib/poll";

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
  const [loadError, setLoadError] = useState<string | null>(null);

  // Search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Friend[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRetry, setSearchRetry] = useState(0);
  const [requested, setRequested] = useState<Set<string>>(new Set());

  // Inline remove confirmation
  const [manageUser, setManageUser] = useState<{ user: Friend | FriendRequestUser; isFriend: boolean } | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<Friend | FriendRequestUser | null>(null);
  const [blocking, setBlocking] = useState(false);
  const [searchFocus, setSearchFocus] = useState(false);

  // Invite-to-squad flow: pick a squad for a chosen friend.
  const [inviteFriend, setInviteFriend] = useState<Friend | null>(null);

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
      setLoadError(null);
    } catch {
      if (mounted.current) setLoadError("Couldn't load your friends.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  // Initial load — auth is gated by the (app) layout.
  useEffect(() => { refetch(); }, [refetch]);

  // Live presence: poll every 20s + on window focus.
  useEffect(() => {
    const stopPolling = pollWhileVisible(refetch, 20_000);
    const onFocus = () => refetch();
    window.addEventListener("focus", onFocus);
    return () => {
      stopPolling();
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
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      try {
        const { users } = await api.searchUsers(q);
        if (seq === searchSeq.current) {
          setResults(users ?? []);
          setSearched(true);
          setSearchError(null);
        }
      } catch {
        if (seq === searchSeq.current) {
          setResults([]);
          setSearched(false);
          setSearchError("Couldn't search for people.");
        }
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, searchRetry]);

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
    setManageUser(null);
    setFriends((f) => f.filter((x) => x.userId !== u.userId));
    try {
      await api.removeFriend(u.userId);
    } catch (e) {
      setFriends((f) => (f.some((x) => x.userId === u.userId) ? f : [u, ...f]));
      toast((e as { message?: string })?.message || "Couldn't remove friend.", "error");
    }
  }

  async function handleBlock() {
    if (!confirmBlock || blocking) return;
    setBlocking(true);
    try {
      await api.blockUsers([confirmBlock.userId]);
      const blockedId = confirmBlock.userId;
      setFriends((items) => items.filter((item) => item.userId !== blockedId));
      setIncoming((items) => items.filter((item) => item.userId !== blockedId));
      setOutgoing((items) => items.filter((item) => item.userId !== blockedId));
      setResults((items) => items.filter((item) => item.userId !== blockedId));
      setRequested((items) => {
        const next = new Set(items);
        next.delete(blockedId);
        return next;
      });
      setConfirmBlock(null);
      toast(`${confirmBlock.name} blocked.`, "success");
    } catch (e) {
      toast((e as { message?: string })?.message || "Couldn't block that account.", "error");
    } finally {
      setBlocking(false);
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
  const showFirstRun = !loading && !loadError && friends.length === 0 && incoming.length === 0 && outgoing.length === 0;

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
        subtitle={showFirstRun ? "Search by display name to add a friend." : onlineCount > 0 ? `${onlineCount} online now` : "Your friends and friend requests."}
      />

      {loadError && (
        <div role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 10px 10px 14px", borderRadius: radiusControl, border: "1px solid color-mix(in srgb, var(--coral) 45%, transparent)", background: "var(--coral-soft)", color: "var(--text-body)", fontSize: 14 }}>
          <span>{loadError} Check your connection and try again.</span>
          <Button variant="ghost" size="sm" onClick={() => { setLoadError(null); setLoading(true); void refetch(); }}>Retry</Button>
        </div>
      )}

      {/* ── Add friends ──────────────────────────────────────────── */}
      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {showFirstRun && (
          <div style={{ paddingTop: isPhone ? 8 : 16 }}>
            <div style={{ color: violet, fontSize: 11, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase" }}>Friends</div>
            <h2 style={{ margin: "8px 0 6px", color: text, fontFamily: fontDisplay, fontSize: isPhone ? 28 : 34, lineHeight: 1.1, fontWeight: 800 }}>Add friends.</h2>
            <p style={{ margin: 0, maxWidth: 520, color: muted, fontSize: 14, lineHeight: 1.55 }}>Search their display name to send a friend request and see when they’re online.</p>
          </div>
        )}
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <Icon.discover size={18} color={dim} />
          </span>
          <input
            aria-label="Search people by name"
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
            {searchError ? (
              <div role="alert" style={{ minHeight: 52, padding: "8px 10px 8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderRadius: radiusControl, border: "1px solid color-mix(in srgb, var(--coral) 45%, transparent)", color: "var(--text-body)", fontSize: 13 }}>
                <span>{searchError}</span>
                <Button variant="ghost" size="sm" onClick={() => setSearchRetry((value) => value + 1)}>Retry search</Button>
              </div>
            ) : query.trim().length < 2 ? (
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
                    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                    {isFriend ? (
                      <Pill tone="muted">Friends</Pill>
                    ) : incomingRequest ? (
                      <>
                        <ActionButton onClick={() => handleAccept(incomingRequest)} tone="violet">Accept</ActionButton>
                        <ActionButton onClick={() => handleDecline(incomingRequest)} tone="ghost">Decline</ActionButton>
                      </>
                    ) : isRequested ? (
                      <Pill tone="muted">Requested</Pill>
                    ) : (
                      <ActionButton onClick={() => handleAdd(u)} tone="violet">
                        <Icon.plus size={15} color={onAccent} strokeWidth={2.4} /> Add
                      </ActionButton>
                    )}
                    <MoreButton name={u.name} onClick={() => setManageUser({ user: u, isFriend })} />
                    </div>
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
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <ActionButton onClick={() => handleAccept(u)} tone="violet">Accept</ActionButton>
                  <ActionButton onClick={() => handleDecline(u)} tone="ghost">Decline</ActionButton>
                  <MoreButton name={u.name} onClick={() => setManageUser({ user: u, isFriend: false })} />
                </div>
              </Row>
            ))}
            {outgoing.map((u) => (
              <Row key={`out-${u.userId}`} u={u}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <Pill tone="muted">Pending</Pill>
                  <MoreButton name={u.name} onClick={() => setManageUser({ user: u, isFriend: false })} />
                </div>
              </Row>
            ))}
          </div>
        </section>
      )}

      {/* ── Your friends ─────────────────────────────────────────── */}
      {!showFirstRun && (!loadError || friends.length > 0) && (!query.trim() || friends.length > 0) && (
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
                    <span style={{ width: 7, height: 7, borderRadius: radiusPill, background: f.online ? lime : "var(--border-strong)" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: f.online ? "var(--lime-text)" : dim, fontFamily: "var(--font-inter)" }}>
                      {f.online ? "Online" : "Offline"}
                    </span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <Button size="sm" variant="secondary" onClick={() => setInviteFriend(f)} aria-label={`Invite ${f.name} to a squad`}>
                    Invite
                  </Button>
                  <MoreButton name={f.name} onClick={() => setManageUser({ user: f, isFriend: true })} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {inviteFriend && (
        <SquadPickerModal
          friend={inviteFriend}
          isPhone={isPhone}
          onClose={() => setInviteFriend(null)}
        />
      )}
      {manageUser && (
        <Modal onClose={() => setManageUser(null)} title={manageUser.user.name} subtitle="Manage this person">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {manageUser.isFriend && (
              <Button variant="secondary" fullWidth onClick={() => void handleRemove(manageUser.user as Friend)}>
                Remove friend
              </Button>
            )}
            <Button
              variant="danger"
              fullWidth
              onClick={() => {
                setConfirmBlock(manageUser.user);
                setManageUser(null);
              }}
            >
              Block {manageUser.user.name}
            </Button>
          </div>
        </Modal>
      )}
      {confirmBlock && (
        <Modal
          onClose={() => { if (!blocking) setConfirmBlock(null); }}
          title={<>Block {confirmBlock.name}?</>}
          subtitle="This removes your friendship and pending requests. You can unblock them later from Profile."
          sheet={isPhone}
          width={420}
        >
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Button variant="ghost" onClick={() => setConfirmBlock(null)} disabled={blocking}>Cancel</Button>
            <Button variant="danger" onClick={handleBlock} loading={blocking}>Block</Button>
          </div>
        </Modal>
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
        <h3 style={{ margin: 0, color: text, fontFamily: fontDisplay, fontSize: 14, fontWeight: 700 }}>No friends yet</h3>
        <p style={{ margin: "3px 0 0", color: muted, fontSize: 13 }}>Search above to send a request.</p>
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
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px 12px",
        padding: "10px 14px",
        borderRadius: radiusControl,
        background: "var(--surface)",
        border: controlBorder,
      }}
    >
      <UserAvatar name={u.name} image={u.image} size={40} online={!!u.online} />
      <div style={{ minWidth: 0, flex: "1 1 110px" }}>
        <div style={{ fontFamily: fontDisplay, fontWeight: 700, fontSize: 14, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {u.name}
        </div>
        {u.online && (
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--lime-text)", fontFamily: "var(--font-inter)", marginTop: 1 }}>Online</div>
        )}
      </div>
      <div style={{ marginLeft: "auto" }}>{children}</div>
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

function MoreButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick} aria-label={`More options for ${name}`} style={{ width: 44, padding: 0, color: muted }}>
      <Icon.more size={20} />
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
