"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { Avatar } from "@/components/Avatar";
import { AvatarArt } from "@/components/AvatarArt";
import { useViewport } from "@/components/useViewport";
import { api, session } from "@giggle/core";
import type { Friend } from "@giggle/core";

interface Props {
  squadId: string;
  squadName?: string;
  onClose: () => void;
}

// Per-person invite status. "idle" → "inviting" → "invited" | "error".
type InviteState = "idle" | "inviting" | "invited" | "error";

const violet = "var(--violet)";
const lime = "var(--lime)";
const limeText = "var(--lime-text)";
const coral = "var(--coral)";
const text = "var(--text)";
const muted = "var(--text-muted)";
const dim = "var(--text-dim)";
const MAX_SEARCH_QUERY = 64;

/** Prefer the user's avatar art when present, else initials. */
function UserAvatar({ name, image, size = 40, online }: { name: string; image?: string; size?: number; online?: boolean }) {
  if (image) return <AvatarArt value={image} size={size} online={online} />;
  return <Avatar name={name} size={size} online={online} />;
}

export function InviteToSquad({ squadId, squadName, onClose }: Props) {
  const router = useRouter();
  const { isPhone } = useViewport();
  const [tab, setTab] = useState<"friends" | "search">("friends");

  // Friends
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [friendsError, setFriendsError] = useState<string | null>(null);

  // Search
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Friend[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchFocus, setSearchFocus] = useState(false);

  // Per-user invite state + error, keyed by userId (shared across both tabs).
  const [invited, setInvited] = useState<Record<string, InviteState>>({});
  const [inviteErr, setInviteErr] = useState<Record<string, string>>({});

  function ensureAuthed() {
    if (session.isAuthed()) return true;
    const message = "Sign in to continue.";
    setFriendsError(message);
    setSearchError(message);
    router.push("/signin");
    return false;
  }

  // Load friends on mount.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!ensureAuthed()) return;
        const { friends } = await api.listFriends();
        if (alive) setFriends(friends ?? []);
      } catch (e) {
        console.error("listFriends failed:", e);
        if (alive) setFriendsError("Couldn't load your friends.");
      } finally {
        if (alive) setLoadingFriends(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Debounced search (~300ms) when q ≥ 2 chars.
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
        if (!ensureAuthed()) return;
        const { users } = await api.searchUsers(q);
        if (seq === searchSeq.current) {
          setResults(users ?? []);
          setSearched(true);
        }
      } catch (e) {
        console.error("searchUsers failed:", e);
        if (seq === searchSeq.current) {
          setResults([]);
          setSearchError("Search failed — try again.");
        }
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleInvite = useCallback(async (person: Friend) => {
    if (!ensureAuthed()) return;
    const id = person.userId;
    setInvited((s) => ({ ...s, [id]: "inviting" }));
    setInviteErr((s) => { const n = { ...s }; delete n[id]; return n; });
    try {
      const { invited } = await api.inviteUserToSquad(squadId, id);
      setInvited((s) => ({ ...s, [id]: invited ? "invited" : "error" }));
      if (!invited) setInviteErr((s) => ({ ...s, [id]: "Already invited or a member." }));
    } catch (e) {
      console.error("inviteUserToSquad failed:", e);
      setInvited((s) => ({ ...s, [id]: "error" }));
      setInviteErr((s) => ({ ...s, [id]: "Couldn't invite — try again." }));
    }
  }, [squadId]);

  const list = tab === "friends" ? friends : results;

  return (
    <div
      data-theme="dark"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.68)", backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: isPhone ? "flex-end" : "center",
        justifyContent: "center",
        padding: isPhone ? 0 : 20,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={squadName ? `Invite people to ${squadName}` : "Invite people to squad"}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: isPhone ? "24px 24px 0 0" : 24,
          width: isPhone ? "100%" : 460,
          maxWidth: "100%",
          maxHeight: isPhone ? "88vh" : "80vh",
          display: "flex", flexDirection: "column",
          boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
          overflow: "hidden",
          animation: isPhone ? "sheetUp .28s cubic-bezier(.22,1,.36,1)" : "modalIn .2s cubic-bezier(.22,1,.36,1)",
        }}
      >
        <style>{`
          @keyframes modalIn { from { opacity: 0; transform: scale(.96) translateY(8px); } to { opacity: 1; transform: none; } }
          @keyframes sheetUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
          @media (prefers-reduced-motion: reduce) {
            [data-theme="dark"] [role="dialog"] { animation: none !important; }
          }
        `}</style>

        {/* Header */}
        <div style={{ padding: isPhone ? "18px 18px 12px" : "22px 24px 14px", flexShrink: 0 }}>
          {isPhone && (
            <div style={{ width: 40, height: 4, borderRadius: 999, background: "var(--border-strong)", margin: "0 auto 14px" }} />
          )}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Icon.users size={18} color={violet} />
                <h2 style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 19, fontWeight: 800, color: text, margin: 0, letterSpacing: "-0.01em" }}>
                  Invite to squad
                </h2>
              </div>
              {squadName && (
                <div style={{ color: muted, fontSize: 13, fontFamily: "var(--font-inter)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Add people to <span style={{ color: text, fontWeight: 600 }}>{squadName}</span>
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              title="Close"
              aria-label="Close"
              style={{
                flexShrink: 0,
                width: 44, height: 44, borderRadius: 999,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--overlay)", border: "1px solid var(--border)",
                color: muted, cursor: "pointer",
              }}
            >
              <Icon.close size={16} color={muted} strokeWidth={2.2} />
            </button>
          </div>

          {/* Segmented control */}
          <div style={{
            display: "flex", background: "var(--overlay)", border: "1px solid var(--border)",
            borderRadius: 999, padding: 3, gap: 2, marginTop: 16,
          }}>
            {(["friends", "search"] as const).map((t) => {
              const active = tab === t;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  aria-pressed={active}
                  style={{
                    flex: 1, minHeight: 44, padding: "8px 0", borderRadius: 999, border: "none", cursor: "pointer",
                    background: active ? violet : "transparent",
                    color: active ? "#fff" : muted,
                    fontSize: 13, fontWeight: 700, fontFamily: "var(--font-space-grotesk)",
                    transition: "all .15s ease",
                  }}
                >
                  {t === "friends" ? "Friends" : "Search"}
                </button>
              );
            })}
          </div>

          {/* Search box (only on the Search tab) */}
          {tab === "search" && (
            <div style={{ position: "relative", marginTop: 12 }}>
              <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <Icon.discover size={17} color={dim} />
              </span>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value.slice(0, MAX_SEARCH_QUERY))}
                onFocus={() => setSearchFocus(true)}
                onBlur={() => setSearchFocus(false)}
                placeholder="Search anyone by name…"
                maxLength={MAX_SEARCH_QUERY}
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "12px 14px 12px 42px", borderRadius: 12,
                  background: "var(--overlay)",
                  border: searchFocus ? "1px solid var(--violet)" : "1px solid var(--border)",
                  boxShadow: searchFocus ? "0 0 0 3px color-mix(in srgb, var(--violet) 28%, transparent)" : "none",
                  color: text, fontSize: 15, fontFamily: "var(--font-inter)", outline: "none",
                  transition: "box-shadow .18s ease, border-color .18s ease",
                }}
              />
            </div>
          )}
        </div>

        {/* Body */}
        <div style={{
          flex: 1, minHeight: 0, overflowY: "auto",
          padding: isPhone ? "0 14px 22px" : "0 18px 20px",
          display: "flex", flexDirection: "column", gap: 8,
        }}>
          {tab === "friends" ? (
            loadingFriends ? (
              <SkeletonRows />
            ) : friendsError ? (
              <EmptyState>{friendsError}</EmptyState>
            ) : friends.length === 0 ? (
              <EmptyState>No friends yet — use Search to invite anyone.</EmptyState>
            ) : (
              list.map((p) => (
                <PersonRow key={p.userId} person={p} state={invited[p.userId] ?? "idle"} error={inviteErr[p.userId]} onInvite={() => handleInvite(p)} />
              ))
            )
          ) : (
            query.trim().length < 2 ? (
              <EmptyState>Type at least 2 characters to search.</EmptyState>
            ) : searching && results.length === 0 ? (
              <EmptyState><span className="gg-spinner" style={{ marginRight: 8 }} />Searching…</EmptyState>
            ) : searchError ? (
              <EmptyState>{searchError}</EmptyState>
            ) : results.length === 0 && searched ? (
              <EmptyState>No people found for “{query.trim()}”.</EmptyState>
            ) : (
              list.map((p) => (
                <PersonRow key={p.userId} person={p} state={invited[p.userId] ?? "idle"} error={inviteErr[p.userId]} onInvite={() => handleInvite(p)} />
              ))
            )
          )}
        </div>
      </div>
    </div>
  );
}

// ── Building blocks ───────────────────────────────────────────────────────────

function PersonRow({ person, state, error, onInvite }: { person: Friend; state: InviteState; error?: string; onInvite: () => void }) {
  const invited = state === "invited";
  const inviting = state === "inviting";
  return (
    <div>
      <div
        className="gg-row"
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 12px", borderRadius: 14,
          background: "var(--overlay)", border: "1px solid var(--border)",
        }}
      >
        <UserAvatar name={person.name} image={person.image} size={40} online={person.online} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 14.5, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {person.name}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: person.online ? lime : "var(--border-strong)", boxShadow: person.online ? `0 0 8px ${lime}` : undefined }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: person.online ? limeText : dim, fontFamily: "var(--font-inter)" }}>
              {person.online ? "Online" : "Offline"}
            </span>
          </div>
        </div>
        <button
          onClick={onInvite}
          disabled={invited || inviting}
          className="gg-press"
          style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5,
            minHeight: 38, padding: "8px 16px", borderRadius: 999,
            fontFamily: "var(--font-inter)", fontWeight: 700, fontSize: 13.5,
            whiteSpace: "nowrap",
            cursor: invited || inviting ? "default" : "pointer",
            border: invited ? "1px solid var(--lime)" : "none",
            background: invited ? "color-mix(in srgb, var(--lime) 14%, transparent)" : inviting ? "color-mix(in srgb, var(--violet) 50%, transparent)" : violet,
            color: invited ? limeText : "#fff",
            transition: "background .18s ease, color .18s ease, border-color .18s ease",
          }}
        >
          {invited ? "Invited ✓" : inviting ? "Inviting…" : (<><Icon.plus size={14} color="#fff" strokeWidth={2.4} /> Invite</>)}
        </button>
      </div>
      {error && (
        <div style={{ fontSize: 12, color: coral, fontFamily: "var(--font-inter)", padding: "5px 12px 0" }}>{error}</div>
      )}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      padding: "28px 16px", textAlign: "center",
      color: muted, fontSize: 14, fontFamily: "var(--font-inter)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      {children}
    </div>
  );
}

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 14, background: "var(--overlay)", border: "1px solid var(--border)" }}>
          <div className="gg-shimmer" style={{ width: 40, height: 40, borderRadius: 999 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="gg-shimmer" style={{ height: 13, width: "55%", borderRadius: 6 }} />
            <div className="gg-shimmer" style={{ height: 10, width: "30%", borderRadius: 6 }} />
          </div>
          <div className="gg-shimmer" style={{ height: 34, width: 84, borderRadius: 999 }} />
        </div>
      ))}
    </>
  );
}
