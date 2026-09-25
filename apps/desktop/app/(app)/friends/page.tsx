"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { Icon } from "@/components/Icons";
import { PersonAvatar } from "@/components/PersonAvatar";
import { useViewport } from "@/components/useViewport";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { api } from "@giggle/core";
import type { MySquadLite } from "@giggle/core";
import { pollWhileVisible } from "@/lib/poll";
import styles from "./friends.module.css";

// ── Contract types (mirror the backend/core agent's interfaces) ───────────────
interface Friend {
  userId: string;
  name: string;
  image?: string;
  avatar?: string | null;
  online: boolean;
}
interface FriendRequestUser {
  userId: string;
  name: string;
  image?: string;
  avatar?: string | null;
  online?: boolean;
}

const MAX_SEARCH_QUERY = 64;

/** The person's shared illustrated avatar (or their seeded default).
 * `wrapClassName="pa"` puts the mock's `.pa` hook on the presence wrapper so
 * the ported skins can frame/size friend avatars in either presence state. */
function UserAvatar({ userId, name, avatar, size = 44, online }: { userId: string; name: string; avatar?: string | null; size?: number | "fill"; online?: boolean }) {
  return <PersonAvatar userId={userId} name={name} avatar={avatar} size={size} online={online} wrapClassName="pa" />;
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

  return (
    <div className={`gg-reveal gg-screen gg-screen-friends ${styles.screen}`}>
      {/* Header (mock .page-head) */}
      <div className={`page-head ${styles.head}`}>
        <h1 className={`title ${styles.headTitle}`}>Your people</h1>
        <p className={`lede ${styles.headLede}`}>
          {showFirstRun
            ? "Every good hangout starts with a hello. Find a friend by their display name."
            : onlineCount > 0
              ? `${onlineCount} online now`
              : "Familiar faces. More reasons to hang out."}
        </p>
      </div>

      {loadError && (
        <div role="alert" className={styles.alert}>
          <span>{loadError} Check your connection and try again.</span>
          <Button variant="ghost" size="sm" onClick={() => { setLoadError(null); setLoading(true); void refetch(); }}>Retry</Button>
        </div>
      )}

      {/* ── Add friends ──────────────────────────────────────────── */}
      <section className={`gg-friends-search ${styles.addSection}`}>
        {showFirstRun && (
          <div className={styles.firstRun}>
            <div className={styles.firstKicker}>Friends</div>
            <h2 className={styles.firstTitle}>Add friends.</h2>
            <p className={styles.firstLede}>Search their display name to send a friend request and see when they’re online.</p>
          </div>
        )}
        <div className={`search ${styles.search}`}>
          <Icon.discover size={18} />
          <input
            className={`input ${styles.searchInput}`}
            aria-label="Search people by name"
            value={query}
            onChange={(e) => setQuery(e.target.value.slice(0, MAX_SEARCH_QUERY))}
            placeholder="Search by name…"
            maxLength={MAX_SEARCH_QUERY}
          />
        </div>

        {query.trim() && (
          <ul className={`friend-list ${styles.list}`}>
            {searchError ? (
              <li>
                <div role="alert" className={styles.alertSlim}>
                  <span>{searchError}</span>
                  <Button variant="ghost" size="sm" onClick={() => setSearchRetry((value) => value + 1)}>Retry search</Button>
                </div>
              </li>
            ) : query.trim().length < 2 ? (
              <li><EmptyHint>Type at least 2 characters to search.</EmptyHint></li>
            ) : searching && results.length === 0 ? (
              // Skeleton rows matching the result-row height — no spinner jump.
              <li aria-label="Searching" role="status" className={styles.skeletons}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className={`gg-shimmer ${styles.skeleton}`} />
                ))}
              </li>
            ) : results.length === 0 && searched ? (
              <li><EmptyHint>No people found for “{query.trim()}”.</EmptyHint></li>
            ) : (
              results.map((u) => {
                const isFriend = friendIds.has(u.userId);
                const incomingRequest = incoming.find((i) => i.userId === u.userId);
                const isRequested = !incomingIds.has(u.userId) && (requested.has(u.userId) || outgoing.some((o) => o.userId === u.userId));
                return (
                  <Row key={u.userId} u={u} request={!!incomingRequest}>
                    {isFriend ? (
                      <Pill>Friends</Pill>
                    ) : incomingRequest ? (
                      <>
                        <ActionButton onClick={() => handleAccept(incomingRequest)} tone="violet">Accept</ActionButton>
                        <ActionButton onClick={() => handleDecline(incomingRequest)} tone="ghost">Decline</ActionButton>
                      </>
                    ) : isRequested ? (
                      <Pill>Requested</Pill>
                    ) : (
                      <ActionButton onClick={() => handleAdd(u)} tone="violet">
                        <Icon.plus size={15} strokeWidth={2.4} /> Add
                      </ActionButton>
                    )}
                    <MoreButton name={u.name} onClick={() => setManageUser({ user: u, isFriend })} />
                  </Row>
                );
              })
            )}
          </ul>
        )}
      </section>

      {/* ── Requests ─────────────────────────────────────────────── */}
      {(incoming.length > 0 || outgoing.length > 0) && (
        <section className={`gg-friends-requests ${styles.section}`}>
          <h2 className={styles.sectionTitle}>
            Requests {incoming.length > 0 && <span className={styles.sectionTitleAccent}>· {incoming.length}</span>}
          </h2>
          <ul className={`friend-list ${styles.list}`}>
            {incoming.map((u) => (
              <Row key={u.userId} u={u} request>
                <ActionButton onClick={() => handleAccept(u)} tone="violet">Accept</ActionButton>
                <ActionButton onClick={() => handleDecline(u)} tone="ghost">Decline</ActionButton>
                <MoreButton name={u.name} onClick={() => setManageUser({ user: u, isFriend: false })} />
              </Row>
            ))}
            {outgoing.map((u) => (
              <Row key={`out-${u.userId}`} u={u}>
                <Pill>Pending</Pill>
                <MoreButton name={u.name} onClick={() => setManageUser({ user: u, isFriend: false })} />
              </Row>
            ))}
          </ul>
        </section>
      )}

      {/* ── Your friends ─────────────────────────────────────────── */}
      {!showFirstRun && (!loadError || friends.length > 0) && (!query.trim() || friends.length > 0) && (
      <section className={`gg-friends-main ${styles.section}`}>
        <h2 className={styles.sectionTitle}>Your friends {friends.length > 0 && <span className={styles.sectionTitleMuted}>· {friends.length}</span>}</h2>

        {loading ? (
          <div className={styles.gridSkeletons}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={styles.gridSkeleton}>
                <span className={`gg-shimmer av`} />
                <div className={styles.skeletonLines}>
                  <i className="gg-shimmer" style={{ height: 14, width: "55%" }} />
                  <i className="gg-shimmer" style={{ height: 11, width: "32%" }} />
                </div>
              </div>
            ))}
          </div>
        ) : friends.length === 0 ? (
          <FriendsEmptyState />
        ) : (
          <ul className={`friend-list ${styles.listGrid}`}>
            {sortedFriends.map((f) => (
              <li
                key={f.userId}
                className={`friend gg-row ${styles.cardRow}`}
              >
                <UserAvatar userId={f.userId} name={f.name} avatar={f.avatar} size="fill" online={f.online} />
                <div className={styles.rowCopy}>
                  <b>{f.name}</b>
                  <small className={f.online ? "on" : undefined}>{f.online ? "Online" : "Offline"}</small>
                </div>
                <span className={`pair ${styles.pair}`}>
                  <Button size="sm" variant="secondary" onClick={() => setInviteFriend(f)} aria-label={`Invite ${f.name} to a squad`}>
                    Invite
                  </Button>
                  <MoreButton name={f.name} onClick={() => setManageUser({ user: f, isFriend: true })} />
                </span>
              </li>
            ))}
          </ul>
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
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>
        <Icon.users size={18} />
      </div>
      <div>
        <h3 className={styles.emptyTitle}>No friends yet</h3>
        <p className={styles.emptyLede}>Search above to send a request.</p>
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
      subtitle={<>Pick a squad for <b>{friend.name}</b></>}
      sheet={isPhone}
      width={420}
    >
      <div className={styles.pickerStack}>
          {loading ? (
            <EmptyHint><span className="gg-spinner" style={{ marginRight: 8 }} />Loading your squads…</EmptyHint>
          ) : error ? (
            <EmptyHint>{error}</EmptyHint>
          ) : squads.length === 0 ? (
            <div className={styles.pickerEmpty}>
              Create a squad first — then you can invite {friend.name}.
            </div>
          ) : (
            squads.map((sq) => {
              const st = status[sq.squadId];
              const invited = st === "invited";
              const inviting = st === "inviting";
              return (
                <div key={sq.squadId}>
                  <div className={`gg-row ${styles.pickerRow}`}>
                    <div className={styles.pickerCopy}>
                      <div className={styles.pickerName}>{sq.squadName}</div>
                      <div className={styles.pickerMeta}>{sq.memberCount}/{sq.maxSlots} members</div>
                    </div>
                    <Button size="sm" variant="primary" onClick={() => invite(sq.squadId)} disabled={invited || inviting}>
                      {invited ? (<>Invited <span aria-hidden="true">✓</span></>) : inviting ? "Inviting…" : "Invite"}
                    </Button>
                  </div>
                  {rowErr[sq.squadId] && (
                    <div className={styles.rowError}>{rowErr[sq.squadId]}</div>
                  )}
                </div>
              );
            })
          )}
      </div>
    </Modal>
  );
}

/**
 * One person row (mock `.friend`): avatar in a `.pa` presence wrapper, a
 * name/status block (`b` + `small`), and the action cluster (`.pair`).
 * `request` marks incoming requests (mock `.friend.request`).
 */
function Row({ u, children, request = false }: { u: Friend | FriendRequestUser; children: React.ReactNode; request?: boolean }) {
  return (
    <li
      className={`friend gg-row ${request ? "request " : ""}${styles.row}`}
    >
      <UserAvatar userId={u.userId} name={u.name} avatar={u.avatar} size="fill" online={!!u.online} />
      <div className={styles.rowCopy}>
        <b>{u.name}</b>
        {u.online && <small className="on">Online</small>}
      </div>
      <span className={`pair ${styles.pair}`}>{children}</span>
    </li>
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
    <Button size="sm" variant="ghost" onClick={onClick} aria-label={`More options for ${name}`} className={styles.more}>
      <Icon.more size={20} />
    </Button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className={styles.pill}>{children}</span>;
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.hint}>{children}</div>
  );
}
