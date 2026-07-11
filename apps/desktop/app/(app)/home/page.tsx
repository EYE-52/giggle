"use client";
import { useState, useEffect } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { EmptyState } from "@/components/EmptyState";
import type { PublicSquad, MySquadLite } from "@giggle/core";
import { session, api, randomSquadName, resolveCover, coverName, coverSwatch, getTokenBalance, billing, formatSquadCodeInput, isValidSquadCode } from "@giggle/core";
import { useViewport } from "@/components/useViewport";

const MY_STATUS_LABEL: Record<string, string> = {
  idle: "Open",
  searching: "Searching",
  matched: "Matched",
  in_encounter: "Live",
};

// A squad earns the wide "promoted" slot only when it has live operational
// state — never by preference. Promote state, not favouritism.
const PROMOTABLE = new Set(["in_encounter", "searching", "matched"]);

export default function HomePage() {
  const router = useRouter();
  const { isPhone, isTablet } = useViewport();
  const [squadCode, setSquadCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [squadCodeFocused, setSquadCodeFocused] = useState(false);
  const [stats, setStats] = useState<{ liveEncounters: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mySquads, setMySquads] = useState<MySquadLite[]>([]);
  const [mySquadsLoading, setMySquadsLoading] = useState(true);
  const [trending, setTrending] = useState<PublicSquad[] | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [tokenBal, setTokenBal] = useState(0);
  const [openHoveredId, setOpenHoveredId] = useState<string | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.discoverSquads()
      .then((d) => { if (alive) setTrending(d.squads ?? []); })
      .catch(() => { if (alive) setTrending([]); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setTokenBal(getTokenBalance());
    return billing.subscribe(() => setTokenBal(getTokenBalance()));
  }, []);

  useEffect(() => {
    api.getStats()
      .then(data => setStats(data))
      .catch(() => {/* keep null — strip shows a dash */});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { squads } = await api.mySquads();
        setMySquads(squads ?? []);
      } catch {/* not signed in / none yet — section renders its empty state */}
      finally { setMySquadsLoading(false); }
    })();
  }, []);

  async function handleLeaveSquad(squadId: string) {
    const previousSquads = mySquads;
    setActionError(null);
    setMySquads(prev => prev.filter(s => s.squadId !== squadId));
    setRemoveConfirmId(null);
    try {
      await api.leaveSquad(squadId);
    } catch (e) {
      setMySquads(previousSquads);
      setActionError((e as { message?: string })?.message || "Couldn't leave that squad.");
    }
  }

  function ensureAuthed() {
    if (session.isAuthed()) return true;
    setActionError("Sign in to continue.");
    router.push("/signin");
    return false;
  }

  async function handleCreate() {
    setActionError(null);
    if (!ensureAuthed()) return;
    setCreating(true);
    try {
      const squad = await api.createSquad({ squadName: randomSquadName(), tags: [] });
      router.push(`/lobby?squad=${squad.squadId}`);
    } catch (e: unknown) {
      console.error("createSquad failed:", e);
      setActionError((e as { message?: string })?.message || "Couldn't create a squad. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin() {
    const normalizedSquadCode = formatSquadCodeInput(squadCode);
    setSquadCode(normalizedSquadCode);
    if (!isValidSquadCode(normalizedSquadCode)) {
      setActionError("Enter a squad code in the format ABC-123.");
      return;
    }
    setActionError(null);
    if (!ensureAuthed()) return;
    setJoining(true);
    try {
      const squad = await api.joinSquad({ squadCode: normalizedSquadCode });
      if ("status" in squad && squad.status === "requested") {
        setActionError("Request sent — the leader will review it.");
        return;
      }
      router.push(`/lobby?squad=${squad.squadId}`);
    } catch (e: unknown) {
      console.error("joinSquad failed:", e);
      setActionError((e as { message?: string })?.message || "Couldn't join — check the code and try again.");
    } finally {
      setJoining(false);
    }
  }

  async function handleJoinTrending(sq: PublicSquad) {
    setJoiningId(sq.squadId);
    try {
      const res = await api.joinSquadById(sq.squadId);
      if ("status" in res && res.status === "requested") {
        setActionError("Request sent — the leader will review it.");
        setJoiningId(null);
        return;
      }
      router.push(`/lobby?squad=${res.squadId}`);
    } catch (e: unknown) {
      setActionError((e as { message?: string })?.message || "Couldn't join that squad.");
      setJoiningId(null);
    }
  }

  const firstName = (session.user?.name || "").split(" ")[0];
  const promoted = mySquads.find(s => PROMOTABLE.has(s.status)) ?? null;
  const restSquads = mySquads.filter(s => s !== promoted);
  const openSignals = trending?.length ?? 0;

  return (
    <div className="gg-reveal" style={{ display: "flex", flexDirection: "column", paddingBottom: 48 }}>

      {/* ── GREETING + LIVE STRIP ─────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap", marginBottom: 26 }}>
        <div style={{ minWidth: 0, maxWidth: 560 }}>
          <h1 style={{ margin: 0, fontFamily: "var(--font-space-grotesk)", fontWeight: 800, fontSize: isPhone ? 26 : 30, color: "var(--text)", letterSpacing: "-0.02em", lineHeight: 1.05 }}>
            {firstName ? <>Hey, {firstName}.</> : "Welcome back."}
          </h1>
          <p style={{ margin: "7px 0 0", fontSize: isPhone ? 14 : 14.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Pick up where your squad left off.
          </p>
        </div>
        <div aria-label="Live activity" style={{ display: "flex", alignItems: "center", gap: isPhone ? 16 : 24 }}>
          {[
            { k: "Your squads", v: mySquadsLoading ? "—" : String(mySquads.length), live: false },
            { k: "Open signals", v: trending === null ? "—" : String(openSignals), live: false },
            { k: "Live now", v: String(stats?.liveEncounters ?? 0), live: true },
          ].map((s, i) => (
            <div key={s.k} style={{ display: "flex", alignItems: "baseline", gap: 7, paddingLeft: i > 0 ? 20 : 0, borderLeft: i > 0 ? "1px solid var(--border)" : "none" }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)" }}>{s.k}</span>
              <span style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 800, fontSize: 18, color: s.live ? "var(--lime-text)" : "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                {s.v}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div aria-label="Squad actions" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 28 }}>
        <button onClick={handleCreate} disabled={creating} className="gg-press" style={{ ...primaryBtn, width: "auto", height: 46, padding: "0 20px", borderRadius: 11, opacity: creating ? 0.8 : 1 }}>
          <Icon.plus size={17} color="#fff" />
          {creating ? "Creating…" : "Create squad"}
        </button>
        <div style={{ display: "flex", flex: isPhone ? "1 1 100%" : "0 1 310px", minWidth: isPhone ? 0 : 260 }}>
          <input
            aria-label="Squad invite code"
            value={squadCode}
            onChange={e => { setSquadCode(formatSquadCodeInput(e.target.value)); if (actionError) setActionError(null); }}
            onKeyDown={e => { if (e.key === "Enter") handleJoin(); }}
            placeholder="Join with code"
            autoCapitalize="characters" autoComplete="off" spellCheck={false} inputMode="text"
            onFocus={() => setSquadCodeFocused(true)} onBlur={() => setSquadCodeFocused(false)}
            style={{ minWidth: 0, flex: 1, height: 46, borderRadius: "11px 0 0 11px", background: "transparent", border: squadCodeFocused ? "1px solid var(--violet)" : "1px solid var(--border-strong)", outline: "none", color: "var(--text)", padding: "0 14px", fontSize: 13.5, fontFamily: "var(--font-inter)" }}
          />
          <button aria-label="Join squad" onClick={handleJoin} disabled={joining || !isValidSquadCode(squadCode)} className="gg-press" style={{ width: 48, height: 46, borderRadius: "0 11px 11px 0", border: "1px solid var(--border-strong)", borderLeft: 0, background: "var(--overlay)", cursor: "pointer", opacity: joining || !isValidSquadCode(squadCode) ? 0.45 : 1 }}>
            {joining ? <span className="gg-spinner" /> : <Icon.enter size={18} color="var(--text)" />}
          </button>
        </div>
      </div>

      {/* Inline action error */}
      {actionError && (
        <div role="alert" className="gg-toast" style={{ display: "flex", alignItems: "center", gap: 8, background: "color-mix(in srgb, var(--coral) 12%, var(--surface))", border: "1px solid color-mix(in srgb, var(--coral) 45%, transparent)", borderRadius: 12, padding: "10px 14px", fontSize: 13, fontWeight: 600, color: "var(--coral)", marginBottom: 22 }}>
          <Icon.flag size={14} color="var(--coral)" />
          <span style={{ flex: 1 }}>{actionError}</span>
          <button onClick={() => setActionError(null)} aria-label="Dismiss" style={{ width: 44, height: 44, margin: "-10px -10px -10px 0", background: "none", border: "none", cursor: "pointer", color: "var(--coral)", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon.close size={14} color="var(--coral)" />
          </button>
        </div>
      )}

      {/* ── DASHBOARD: your squads (main) + live signals (rail) ───── */}
      <div style={{ display: "grid", gridTemplateColumns: isTablet ? "1fr" : "1.55fr 1fr", gap: 22, alignItems: "start" }}>
        {/* MAIN — your squads */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
            <Icon.account size={18} color="var(--violet)" />
            <h2 style={sectionTitle}>Your squads</h2>
            {mySquads.length > 0 && <span style={{ fontSize: 12.5, color: "var(--text-dim)", fontWeight: 600 }}>{mySquads.length}</span>}
            {mySquads.length > 0 && (
              <button onClick={() => router.push("/discover")} style={linkBtn}>Find more</button>
            )}
          </div>

          {mySquadsLoading ? (
            <div aria-label="Loading your squads" style={{ height: 160, boxSizing: "border-box", padding: 16, borderRadius: 18, border: "1px solid var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span className="gg-shimmer" style={{ width: 70, height: 22, borderRadius: 7 }} />
                <span className="gg-shimmer" style={{ width: 44, height: 22, borderRadius: 7 }} />
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 18 }}>
                <div style={{ flex: 1, display: "grid", gap: 8 }}>
                  <span className="gg-shimmer" style={{ width: "42%", minWidth: 120, height: 20, borderRadius: 6 }} />
                  <span className="gg-shimmer" style={{ width: "28%", minWidth: 84, height: 12, borderRadius: 5 }} />
                </div>
                <span className="gg-shimmer" style={{ width: 76, height: 40, borderRadius: 999 }} />
              </div>
            </div>
          ) : mySquads.length === 0 ? (
            <EmptyState
              icon={<Icon.account size={20} color="var(--text-dim)" />}
              title="No squads yet"
              body="Open your first room above, or browse open squads looking for members right now."
              primary={{ label: "Browse open squads", onClick: () => router.push("/discover") }}
            />
          ) : (
            <>
              {promoted && (
                <SquadTile
                  squad={promoted}
                  promoted
                  hovered={openHoveredId === promoted.squadId}
                  confirming={removeConfirmId === promoted.squadId}
                  onHover={setOpenHoveredId}
                  onOpen={() => router.push(`/lobby?squad=${promoted.squadId}`)}
                  onAskLeave={() => setRemoveConfirmId(promoted.squadId)}
                  onCancelLeave={() => setRemoveConfirmId(null)}
                  onLeave={() => handleLeaveSquad(promoted.squadId)}
                />
              )}
              <div style={{ display: "grid", gridTemplateColumns: isPhone || restSquads.length === 1 ? "1fr" : "1fr 1fr", gap: 14, marginTop: promoted ? 14 : 0 }}>
                {restSquads.map(s => (
                  <SquadTile
                    key={s.squadId}
                    squad={s}
                    hovered={openHoveredId === s.squadId}
                    confirming={removeConfirmId === s.squadId}
                    onHover={setOpenHoveredId}
                    onOpen={() => router.push(`/lobby?squad=${s.squadId}`)}
                    onAskLeave={() => setRemoveConfirmId(s.squadId)}
                    onCancelLeave={() => setRemoveConfirmId(null)}
                    onLeave={() => handleLeaveSquad(s.squadId)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* RAIL — live signals + find a match */}
        <div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, boxShadow: "var(--elev)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "15px 16px 12px" }}>
              <Icon.trend size={18} color="var(--lime)" />
              <h2 style={{ ...sectionTitle, fontSize: 16 }}>Live signals</h2>
              <button onClick={() => router.push("/discover")} style={{ ...linkBtn, marginLeft: "auto" }}>View all</button>
            </div>
            {trending === null ? (
              [0, 1, 2].map(i => <div key={i} className="gg-shimmer" style={{ height: 62, borderTop: "1px solid var(--border)" }} />)
            ) : trending.length === 0 ? (
              <div style={{ padding: "16px", borderTop: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13 }}>
                No open squads right now.
              </div>
            ) : (
              trending.slice(0, 5).map(sq => {
                const spots = Math.max(0, sq.maxSlots - sq.memberCount);
                return (
                  <div key={sq.squadId} onClick={() => handleJoinTrending(sq)} role="button" tabIndex={0}
                    onKeyDown={e => { if (e.key === "Enter") handleJoinTrending(sq); }}
                    className="gg-focusable"
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: "1px solid var(--border)", cursor: "pointer" }}>
                    <span style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, background: resolveCover(sq.coverImage), filter: "saturate(0.8) brightness(0.85)", boxShadow: "inset 0 0 0 1px var(--border)" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sq.squadName}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                        {(sq.tags ?? []).slice(0, 2).map(t => (
                          <span key={t} style={{ fontSize: 11, fontWeight: 600, color: "var(--text-body)", background: "var(--overlay)", borderRadius: 6, padding: "1px 7px" }}>{t}</span>
                        ))}
                        {(!sq.tags || sq.tags.length === 0) && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>No vibes</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{spots} spot{spots !== 1 ? "s" : ""}</div>
                      <span className="gg-press" style={{ display: "inline-block", marginTop: 5, height: 28, lineHeight: "28px", padding: "0 12px", borderRadius: 999, background: "var(--overlay)", color: "var(--text)", boxShadow: "inset 0 0 0 1px var(--border-strong)", fontWeight: 700, fontSize: 12 }}>
                        {joiningId === sq.squadId ? "…" : "Join"}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {mySquads.length > 0 && (
            <button onClick={() => router.push(`/lobby?squad=${(promoted || mySquads[0]).squadId}`)} className="gg-press" style={{ marginTop: 12, width: "100%", height: 46, border: "1px solid var(--border-strong)", borderRadius: 12, background: "transparent", color: "var(--text)", fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>
              Find a Match
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Squad tile — cover-driven, with a visible (supportive) theme label ───── */
function SquadTile({
  squad, promoted = false, hovered, confirming, onHover, onOpen, onAskLeave, onCancelLeave, onLeave,
}: {
  squad: MySquadLite;
  promoted?: boolean;
  hovered: boolean;
  confirming: boolean;
  onHover: (id: string | null) => void;
  onOpen: () => void;
  onAskLeave: () => void;
  onCancelLeave: () => void;
  onLeave: () => void;
}) {
  const statusLabel = MY_STATUS_LABEL[squad.status] ?? squad.status;
  const isLive = squad.status === "in_encounter";
  const theme = coverName(squad.coverImage) ?? "Aurora";

  return (
    <div
      onClick={onOpen}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      onMouseEnter={() => onHover(squad.squadId)}
      onMouseLeave={() => onHover(null)}
      className="gg-focusable gg-press-card"
      style={{
        position: "relative", overflow: "hidden", borderRadius: 18, cursor: "pointer",
        minHeight: promoted ? undefined : 160,
        padding: promoted ? "20px 22px" : 15,
        border: hovered ? "1px solid var(--border-strong)" : "1px solid var(--border)",
        boxShadow: hovered ? "0 16px 40px -22px rgba(0,0,0,0.7)" : "var(--elev)",
        transform: hovered ? "translateY(-3px)" : "translateY(0)",
        transition: "transform .18s var(--ease-ui), box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
        display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 12,
      }}
    >
      {/* cover + legibility scrim — the cover reads as a moody, muted backdrop
          (identity, not glare): desaturated + a strong dark gradient. */}
      <div style={{ position: "absolute", inset: 0, background: resolveCover(squad.coverImage), filter: "saturate(0.9) brightness(0.8)" }} />
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(8,8,11,0.94) 18%, rgba(8,8,11,0.58) 58%, rgba(8,8,11,0.2) 100%)" }} />

      {/* top row: status + members + theme + leave */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", borderRadius: 7, background: "rgba(8,8,11,0.62)", boxShadow: isLive ? "inset 0 0 0 1px rgba(183,255,42,0.5)" : "inset 0 0 0 1px rgba(255,255,255,0.14)" }}>
            {isLive && <span style={{ width: 6, height: 6, borderRadius: 999, background: "#C2FF3D", boxShadow: "0 0 8px #C2FF3D" }} />}
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", color: isLive ? "#C2FF3D" : "#E7E7F0", textTransform: "uppercase" }}>{isLive ? "Live now" : statusLabel}</span>
          </span>
          {theme && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#C9C9DA" }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: coverSwatch(squad.coverImage), boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.35)" }} />
              {theme}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "#C9C9DA" }}>
            <Icon.account size={12} color="#E7E7F0" />
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#E7E7F0", fontVariantNumeric: "tabular-nums" }}>{squad.memberCount}/{squad.maxSlots}</span>
          </span>
          <button onClick={e => { e.stopPropagation(); onAskLeave(); }} aria-label={`Leave ${squad.squadName}`} title="Leave squad" className="gg-press" style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", display: "grid", placeItems: "center" }}>
            <Icon.close size={13} color="#E7E7F0" />
          </button>
        </div>
      </div>

      {confirming && (
        <div onClick={e => e.stopPropagation()} className="gg-toast" style={{ position: "absolute", inset: 0, zIndex: 5, background: "rgba(7,7,11,0.86)", backdropFilter: "blur(4px)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 16, textAlign: "center" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#F4F4F7" }}>Leave “{squad.squadName}”?</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onCancelLeave} className="gg-press" style={{ minHeight: 44, padding: "0 16px", borderRadius: 999, border: "1px solid var(--border)", background: "transparent", color: "#C9C9DA", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
            <button onClick={onLeave} className="gg-press" style={{ minHeight: 44, padding: "0 16px", borderRadius: 999, border: "none", background: "var(--coral)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Leave</button>
          </div>
        </div>
      )}

      {/* bottom: name + vibes + open */}
      <div style={{ position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: promoted ? 22 : 18, color: "#F4F4F7", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{squad.squadName}</div>
          <div style={{ fontSize: 12, color: "#C9C9DA", marginTop: 2 }}>
            {squad.leaderName ? `Led by ${squad.leaderName}` : (squad.myRole === "leader" ? "You lead this" : "Your squad")}
          </div>
          {squad.tags && squad.tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 0, marginTop: 8, color: "#C9C9DA" }}>
              {squad.tags.slice(0, promoted ? 4 : 2).map((t, index, visibleTags) => (
                <span key={t} style={{ fontSize: 11, fontWeight: 600 }}>
                  {t}{index < visibleTags.length - 1 ? <span aria-hidden style={{ margin: "0 7px", color: "#777789" }}>·</span> : null}
                </span>
              ))}
            </div>
          )}
        </div>
        <button onClick={e => { e.stopPropagation(); onOpen(); }} className="gg-press" style={{ flexShrink: 0, height: 40, padding: "0 18px", borderRadius: 999, border: "none", cursor: "pointer", background: "var(--violet)", color: "#fff", fontFamily: "var(--font-inter)", fontWeight: 700, fontSize: 13.5, boxShadow: "0 0 18px -8px rgba(118,87,255,0.8)" }}>
          {isLive ? "Rejoin" : "Open"}
        </button>
      </div>
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  margin: 0, fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 18, color: "var(--text)", letterSpacing: "-0.01em",
};
const linkBtn: React.CSSProperties = {
  background: "none", border: "none", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "0 2px",
};
const primaryBtn: React.CSSProperties = {
  width: "100%", height: 44, border: "none", borderRadius: 999, background: "var(--violet)", color: "#fff",
  fontFamily: "var(--font-inter)", fontWeight: 700, fontSize: 14, cursor: "pointer",
  boxShadow: "0 0 22px -8px rgba(118,87,255,0.8)",
  whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
};
