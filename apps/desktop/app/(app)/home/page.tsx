"use client";
import { useState, useEffect } from "react";
import type React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/Button";
import { StatTile } from "@/components/StatTile";
import { Badge } from "@/components/Badge";
import { useToast } from "@/components/Toast";
import type { PublicSquad, MySquadLite } from "@giggle/core";
import { session, api, randomSquadName, coverName, getTokenBalance, billing, formatSquadCodeInput, isValidSquadCode } from "@giggle/core";
import { useViewport } from "@/components/useViewport";
import { useTheme } from "@/components/useTheme";
import { coverKind, coverBackground, coverSwatchBackground, coverInk } from "@/components/covers";

const MY_STATUS_LABEL: Record<string, string> = {
  idle: "Open",
  searching: "Searching",
  matched: "Matched",
  in_encounter: "Live",
};

// A squad earns the wide "promoted" slot only when it has live operational
// state — never by preference. Promote state, not favouritism.
const PROMOTABLE = new Set(["in_encounter", "searching", "matched"]);

// Live/active squads sort first; equal statuses fall back to name so 20s
// refreshes don't shuffle the grid.
const STATUS_RANK: Record<string, number> = { in_encounter: 0, searching: 1, matched: 2, idle: 3 };

// Mirror the friends page's live-presence poll cadence.
const POLL_MS = 20_000;

// Semantic theme tokens (with fallbacks so this page works before/after the
// multi-theme token system lands in globals.css).
const RADIUS_CARD = "var(--radius-card, 20px)";
const RADIUS_TILE = "var(--radius-tile, 16px)";
const RADIUS_CONTROL = "var(--radius-control, 14px)";
const CONTROL_BORDER = "var(--control-border, 1px solid var(--border))";
const SHADOW_CARD = "var(--shadow-card, var(--elev))";
const ACCENT = "var(--accent, var(--violet))";
const LIVE = "var(--live, var(--lime))";
const FONT_DISPLAY = "var(--font-display, var(--font-space-grotesk))";
// Squad tiles render text over a cover image + dark scrim ("stage") — these
// stay light in every theme because the scrim is always dark.
const STAGE = "var(--stage, #1B1420)";
const ON_STAGE = "#F4F4F7";
const ON_STAGE_SOFT = "#E7E7F0";
const ON_STAGE_MUTED = "#C9C9DA";

export default function HomePage() {
  const router = useRouter();
  const themeId = useTheme();
  const { toast } = useToast();
  const { isPhone, isTablet } = useViewport();
  const [squadCode, setSquadCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [squadCodeFocused, setSquadCodeFocused] = useState(false);
  const [stats, setStats] = useState<{ liveEncounters: number } | null>(null);
  const [mySquads, setMySquads] = useState<MySquadLite[]>([]);
  const [mySquadsLoading, setMySquadsLoading] = useState(true);
  const [trending, setTrending] = useState<PublicSquad[] | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [tokenBal, setTokenBal] = useState(0);
  const [openHoveredId, setOpenHoveredId] = useState<string | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

  // Poll discover so "Open signals" and the Live-signals rail stay live.
  useEffect(() => {
    let alive = true;
    const fetchTrending = () => {
      api.discoverSquads()
        .then((d) => { if (alive) setTrending(d.squads ?? []); })
        .catch(() => { if (alive) setTrending((prev) => prev ?? []); });
    };
    fetchTrending();
    const id = setInterval(fetchTrending, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    setTokenBal(getTokenBalance());
    return billing.subscribe(() => setTokenBal(getTokenBalance()));
  }, []);

  // Poll stats so "Live now" stays live; fetch errors keep the previous value
  // (or the initial null → "—"), never a misleading 0.
  useEffect(() => {
    let alive = true;
    const fetchStats = () => {
      api.getStats()
        .then(data => { if (alive) setStats(data); })
        .catch(() => {/* keep last value — strip shows a dash while null */});
    };
    fetchStats();
    const id = setInterval(fetchStats, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { squads } = await api.mySquads();
        if (alive) setMySquads(squads ?? []);
      } catch {/* not signed in / none yet — section renders its empty state */}
      finally { if (alive) setMySquadsLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function handleLeaveSquad(squadId: string, asLeader: boolean) {
    const previousSquads = mySquads;
    setMySquads(prev => prev.filter(s => s.squadId !== squadId));
    setRemoveConfirmId(null);
    try {
      // Leaders "delete" (disband the whole squad); members just leave.
      if (asLeader) await api.disbandSquad(squadId);
      else await api.leaveSquad(squadId);
      toast(asLeader ? "Squad deleted." : "You left the squad.", "success");
    } catch (e) {
      setMySquads(previousSquads);
      toast((e as { message?: string })?.message || (asLeader ? "Couldn't delete that squad." : "Couldn't leave that squad."), "error");
    }
  }

  function ensureAuthed() {
    if (session.isAuthed()) return true;
    toast("Sign in to continue.", "error");
    router.push("/signin");
    return false;
  }

  async function handleCreate() {
    if (!ensureAuthed()) return;
    setCreating(true);
    try {
      const squad = await api.createSquad({ squadName: randomSquadName(), tags: [] });
      router.push(`/lobby?squad=${squad.squadId}`);
    } catch (e: unknown) {
      console.error("createSquad failed:", e);
      toast((e as { message?: string })?.message || "Couldn't create a squad. Please try again.", "error");
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin() {
    const normalizedSquadCode = formatSquadCodeInput(squadCode);
    setSquadCode(normalizedSquadCode);
    if (!isValidSquadCode(normalizedSquadCode)) {
      toast("Enter a squad code in the format ABC-123.", "error");
      return;
    }
    if (!ensureAuthed()) return;
    setJoining(true);
    try {
      const squad = await api.joinSquad({ squadCode: normalizedSquadCode });
      if ("status" in squad && squad.status === "requested") {
        toast("Request sent — the leader will review it.", "success");
        return;
      }
      router.push(`/lobby?squad=${squad.squadId}`);
    } catch (e: unknown) {
      console.error("joinSquad failed:", e);
      toast((e as { message?: string })?.message || "Couldn't join — check the code and try again.", "error");
    } finally {
      setJoining(false);
    }
  }

  async function handleJoinTrending(sq: PublicSquad) {
    if (joiningId) return; // a join is already in flight
    setJoiningId(sq.squadId);
    try {
      const res = await api.joinSquadById(sq.squadId);
      if ("status" in res && res.status === "requested") {
        toast("Request sent — the leader will review it.", "success");
        setJoiningId(null);
        return;
      }
      router.push(`/lobby?squad=${res.squadId}`);
    } catch (e: unknown) {
      toast((e as { message?: string })?.message || "Couldn't join that squad.", "error");
      setJoiningId(null);
    }
  }

  const firstName = (session.user?.name || "").split(" ")[0];
  const promoted = mySquads.find(s => PROMOTABLE.has(s.status)) ?? null;
  const restSquads = mySquads
    .filter(s => s !== promoted)
    .sort((a, b) =>
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      a.squadName.localeCompare(b.squadName));
  const openSignals = trending?.length ?? 0;
  const leavingSquad = removeConfirmId ? mySquads.find(s => s.squadId === removeConfirmId) ?? null : null;
  // Squads you already belong to must never offer "Join" in the live rail —
  // they open the lobby instead (mirrors the squad-preview membership fix).
  const mySquadIdSet = new Set(mySquads.map(s => s.squadId));

  return (
    <div className="gg-reveal" style={{ display: "flex", flexDirection: "column", paddingBottom: 48, maxWidth: 1120, width: "100%", margin: "0 auto" }}>

      {/* ── GREETING + LIVE STRIP ─────────────────────────────────── */}
      <PageHeader
        title={firstName ? <>Hey, {firstName}.</> : "Welcome back."}
        subtitle="Pick up where your squad left off."
        right={
          <div aria-label="Live activity" style={{ display: "flex", alignItems: "stretch", gap: isPhone ? 8 : 12, flexWrap: "wrap" }}>
            <StatTile label="Your squads" value={mySquadsLoading ? "—" : String(mySquads.length)} />
            <StatTile label="Open signals" value={trending === null ? "—" : String(openSignals)} />
            <StatTile label="Live now" value={stats === null ? "—" : String(stats.liveEncounters)} live />
          </div>
        }
      />

      <div aria-label="Squad actions" style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <Button variant="tonal" onClick={handleCreate} loading={creating} style={{ height: 46 }}>
          {!creating && <Icon.plus size={17} color="var(--accent)" />}
          {creating ? "Creating…" : "Create squad"}
        </Button>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, flex: isPhone ? "1 1 100%" : "0 1 310px", minWidth: isPhone ? 0 : 260 }}>
          <div style={{ display: "flex", alignItems: "stretch", height: 46, borderRadius: "var(--radius-control, 14px)", border: squadCodeFocused ? `1px solid ${ACCENT}` : "var(--control-border, 1px solid var(--border-strong))", boxShadow: squadCodeFocused ? `0 0 0 3px color-mix(in srgb, ${ACCENT} 14%, transparent)` : "none", background: "var(--surface)", overflow: "hidden", transition: "border-color .2s var(--ease-ui), box-shadow .2s var(--ease-ui)" }}>
            <input
              aria-label="Squad invite code"
              aria-describedby="squad-code-hint"
              value={squadCode}
              onChange={e => setSquadCode(formatSquadCodeInput(e.target.value))}
              onKeyDown={e => { if (e.key === "Enter") handleJoin(); }}
              placeholder="Join with code"
              autoCapitalize="characters" autoComplete="off" spellCheck={false} inputMode="text"
              onFocus={() => setSquadCodeFocused(true)} onBlur={() => setSquadCodeFocused(false)}
              style={{ minWidth: 0, flex: 1, height: "100%", background: "transparent", border: "none", outline: "none", color: "var(--text)", padding: "0 14px", fontSize: 14, fontFamily: "var(--font-inter)" }}
            />
            <button aria-label="Join squad" onClick={handleJoin} disabled={joining || !isValidSquadCode(squadCode)} className="gg-press" style={{ flexShrink: 0, width: 48, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", border: "none", borderLeft: "1px solid var(--border-strong)", background: "var(--overlay)", cursor: joining || !isValidSquadCode(squadCode) ? "not-allowed" : "pointer", opacity: joining || !isValidSquadCode(squadCode) ? 0.45 : 1, transition: "opacity .2s var(--ease-ui)" }}>
              {joining ? <span className="gg-spinner" /> : <Icon.enter size={18} color="var(--text)" />}
            </button>
          </div>
          <span id="squad-code-hint" style={{ fontSize: 12, fontWeight: 500, color: "var(--text-dim)", paddingLeft: 2 }}>
            Code looks like ABC-123
          </span>
        </div>
      </div>

      {/* ── DASHBOARD: your squads (main) + live signals (rail) ───── */}
      <div style={{ display: "grid", gridTemplateColumns: isTablet ? "1fr" : "1.55fr 1fr", gap: 24, alignItems: isTablet ? "start" : "stretch" }}>
        {/* MAIN — your squads */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
            <Icon.account size={18} color={ACCENT} />
            <h2 style={sectionTitle}>Your squads</h2>
            {mySquads.length > 0 && <span style={{ fontSize: 13, color: "var(--text-dim)", fontWeight: 600 }}>{mySquads.length}</span>}
            {mySquads.length > 0 && (
              <button onClick={() => router.push("/discover")} style={linkBtn}>Find more →</button>
            )}
          </div>

          {mySquadsLoading ? (
            <div aria-label="Loading your squads" style={{ height: 160, boxSizing: "border-box", padding: 16, borderRadius: RADIUS_CARD, border: CONTROL_BORDER, background: "var(--surface)", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
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
                  onHover={setOpenHoveredId}
                  onOpen={() => router.push(`/lobby?squad=${promoted.squadId}`)}
                  onAskLeave={() => setRemoveConfirmId(promoted.squadId)}
                />
              )}
              {restSquads.length > 0 && (
                <div style={{ marginTop: promoted ? 12 : 0, background: "var(--surface)", border: CONTROL_BORDER, borderRadius: RADIUS_CARD, boxShadow: SHADOW_CARD, padding: 6 }}>
                  {restSquads.map(s => (
                    <SquadRow
                      key={s.squadId}
                      squad={s}
                      hovered={openHoveredId === s.squadId}
                      onHover={setOpenHoveredId}
                      onOpen={() => router.push(`/lobby?squad=${s.squadId}`)}
                      onAskLeave={() => setRemoveConfirmId(s.squadId)}
                    />
                  ))}
                </div>
              )}
              {/* Ghost card — fills the dead area under a short squad list on
                  desktop and gives the column a natural next action. */}
              <button
                onClick={() => router.push("/discover")}
                className="gg-press gg-row"
                style={{
                  marginTop: 12, width: "100%", minHeight: 56, boxSizing: "border-box",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  borderRadius: RADIUS_TILE, border: "1px dashed var(--border-strong)",
                  background: "transparent", color: "var(--text-muted)", cursor: "pointer",
                  fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 14,
                }}
              >
                <span aria-hidden="true">＋</span> Browse open squads
              </button>
            </>
          )}
        </div>

        {/* RAIL — live signals + find a match. Flexes to match the squads
            column height so a short squad list doesn't leave a dead viewport. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Find-a-Match CTA — the page's single primary action (spec 07). */}
          <div style={{ background: "linear-gradient(135deg, var(--accent) 0%, #7C5CFF 55%, #9F7BFF 100%)", borderRadius: RADIUS_CARD, color: "#fff", padding: 20, boxShadow: "0 10px 28px -10px color-mix(in srgb, var(--accent) 55%, transparent)" }}>
            <h2 style={{ margin: 0, fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", color: "#fff" }}>Ready to giggle?</h2>
            <p style={{ margin: "5px 0 14px", fontSize: 13, color: "rgba(255,255,255,0.85)", lineHeight: 1.5 }}>Match your squad with another crew on live video.</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const led = mySquads.find(s => s.myRole === "leader") ?? promoted ?? mySquads[0];
                router.push(led ? `/lobby?squad=${led.squadId}` : "/discover");
              }}
              style={{ background: "#fff", color: "var(--accent)", border: "none", boxShadow: "none" }}
            >
              Find a Match
            </Button>
          </div>

          <div style={{ flex: isTablet ? undefined : 1, background: "var(--surface)", border: CONTROL_BORDER, borderRadius: RADIUS_CARD, boxShadow: SHADOW_CARD, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "15px 16px 12px" }}>
              <Icon.trend size={18} color={LIVE} />
              <h2 style={sectionTitle}>Live signals</h2>
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
                const rowJoining = joiningId === sq.squadId;
                const isMember = mySquadIdSet.has(sq.squadId);
                // A join elsewhere is in flight: handleJoinTrending will refuse
                // (single-flight), so non-member rows must not look clickable.
                // Member rows just navigate, so they stay active.
                const blocked = !isMember && !!joiningId;
                const activateRow = () => { if (blocked) return; isMember ? router.push(`/lobby?squad=${sq.squadId}`) : handleJoinTrending(sq); };
                return (
                  <div key={sq.squadId} onClick={activateRow} role="button" tabIndex={blocked ? -1 : 0}
                    aria-disabled={blocked || undefined}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activateRow(); } }}
                    className="gg-focusable"
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", borderTop: "1px solid var(--border)", cursor: blocked ? "default" : "pointer", pointerEvents: blocked ? "none" : undefined, opacity: rowJoining ? 0.6 : (blocked ? 0.75 : 1), background: openHoveredId === `signal-${sq.squadId}` ? "var(--surface-2)" : "transparent", transition: "background .18s var(--ease-ui), opacity .2s var(--ease-ui)" }}
                    onMouseEnter={() => setOpenHoveredId(`signal-${sq.squadId}`)}
                    onMouseLeave={() => setOpenHoveredId(null)}>
                    <span style={{ width: 38, height: 38, borderRadius: RADIUS_CONTROL, flexShrink: 0, background: coverBackground(sq.coverImage, coverKind(sq.coverImage, themeId)), filter: coverKind(sq.coverImage, themeId) === "dark" ? "saturate(0.8) brightness(0.85)" : undefined, boxShadow: "inset 0 0 0 1px var(--border)" }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sq.squadName}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
                        {(sq.tags ?? []).slice(0, 2).map(t => (
                          <span key={t} style={{ fontSize: 12, fontWeight: 600, color: "var(--text-body)", background: "var(--overlay)", borderRadius: 6, padding: "1px 7px" }}>{t}</span>
                        ))}
                        {(!sq.tags || sq.tags.length === 0) && <span style={{ fontSize: 12, color: "var(--text-dim)" }}>No vibes</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>{isMember ? "Joined" : `${spots} spot${spots !== 1 ? "s" : ""}`}</div>
                      <span className="gg-press" style={{ display: "inline-block", marginTop: 5, height: 28, lineHeight: "28px", padding: "0 12px", borderRadius: "var(--radius-pill, 999px)", background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 700, fontSize: 12 }}>
                        {isMember ? "Open" : (joiningId === sq.squadId ? "…" : "Join")}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Leave / delete-squad confirmation dialog (leaders delete, members leave) */}
      {leavingSquad && (() => {
        const isLeader = leavingSquad.myRole === "leader";
        return (
        <Modal
          onClose={() => setRemoveConfirmId(null)}
          ariaLabel={isLeader ? "Delete squad" : "Leave squad"}
          showClose={false}
          width={360}
        >
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isLeader ? "Delete" : "Leave"} “{leavingSquad.squadName}”?
          </div>
          <p style={{ margin: "8px 0 18px", fontSize: 14, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {isLeader
              ? "This permanently deletes the squad for everyone in it. This can't be undone."
              : "You'll drop out of this squad. You can rejoin later with an invite."}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button variant="ghost" onClick={() => setRemoveConfirmId(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => handleLeaveSquad(leavingSquad.squadId, isLeader)}>{isLeader ? "Delete squad" : "Leave"}</Button>
          </div>
        </Modal>
      ); })()}
    </div>
  );
}

/* ── Squad row — spec 07 list row: 44px cover thumb, 14/600 name, 12 muted
   meta, status Badge on the right. Hover = --surface-2 fill. ─────────────── */
function SquadRow({
  squad, hovered, onHover, onOpen, onAskLeave,
}: {
  squad: MySquadLite;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onOpen: () => void;
  onAskLeave: () => void;
}) {
  const themeId = useTheme();
  const isLive = squad.status === "in_encounter";
  const tone = isLive ? "live" : squad.status === "idle" ? "open" : "info";
  const label = isLive ? "LIVE" : (MY_STATUS_LABEL[squad.status] ?? squad.status).toUpperCase();
  const meta = [
    ...(squad.tags ?? []).slice(0, 2),
    squad.leaderName ? `led by ${squad.leaderName}` : (squad.myRole === "leader" ? "led by you" : `${squad.memberCount}/${squad.maxSlots} members`),
  ].join(" · ");
  return (
    <div
      onClick={onOpen}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      onMouseEnter={() => onHover(squad.squadId)}
      onMouseLeave={() => onHover(null)}
      className="gg-focusable"
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: 10, borderRadius: RADIUS_CONTROL,
        cursor: "pointer", background: hovered ? "var(--surface-2)" : "transparent",
        transition: "background .15s var(--ease-ui)",
      }}
    >
      <span style={{ width: 44, height: 44, borderRadius: RADIUS_CONTROL, flexShrink: 0, background: coverBackground(squad.coverImage, coverKind(squad.coverImage, themeId)), boxShadow: "inset 0 0 0 1px var(--border)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{squad.squadName}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meta}</div>
      </div>
      <Badge tone={tone}>{label}</Badge>
      <button onClick={e => { e.stopPropagation(); onAskLeave(); }} aria-label={`Leave ${squad.squadName}`} title="Leave squad" className="gg-press" style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", display: "grid", placeItems: "center" }}>
        <Icon.close size={12} color="var(--text-muted)" />
      </button>
    </div>
  );
}

/* ── Squad tile — cover-driven, with a visible (supportive) theme label ───── */
function SquadTile({
  squad, promoted = false, hovered, onHover, onOpen, onAskLeave,
}: {
  squad: MySquadLite;
  promoted?: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onOpen: () => void;
  onAskLeave: () => void;
}) {
  const themeId = useTheme();
  const statusLabel = MY_STATUS_LABEL[squad.status] ?? squad.status;
  const isLive = squad.status === "in_encounter";
  const theme = coverName(squad.coverImage) ?? "Aurora";
  // Photos always render with the dark "stage" scrim + light text; generated
  // gradient covers flip to bright pastels + ink text on light themes.
  const kind = coverKind(squad.coverImage, themeId);
  const ink = coverInk(kind);
  const onStage = kind === "light" ? ink.text : ON_STAGE;
  const onStageSoft = kind === "light" ? ink.textSoft : ON_STAGE_SOFT;
  const onStageMuted = kind === "light" ? ink.textMuted : ON_STAGE_MUTED;
  const stage = kind === "light" ? "#FFFFFF" : STAGE;

  return (
    <div
      onClick={onOpen}
      role="button" tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      onMouseEnter={() => onHover(squad.squadId)}
      onMouseLeave={() => onHover(null)}
      className="gg-focusable gg-press-card"
      style={{
        position: "relative", overflow: "hidden", borderRadius: RADIUS_CARD, cursor: "pointer",
        minHeight: promoted ? undefined : 160,
        padding: promoted ? "20px 22px" : 15,
        border: hovered ? "1px solid var(--border-strong)" : CONTROL_BORDER,
        boxShadow: hovered ? "0 16px 40px -22px rgba(0,0,0,0.7)" : SHADOW_CARD,
        transform: hovered ? "translateY(-3px)" : "translateY(0)",
        transition: "transform .18s var(--ease-ui), box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
        display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 12,
      }}
    >
      {/* cover + legibility scrim — the cover reads as a moody, muted backdrop
          (identity, not glare): desaturated + a strong dark gradient. */}
      <div style={{ position: "absolute", inset: 0, background: coverBackground(squad.coverImage, kind), filter: kind === "dark" ? "saturate(0.9) brightness(0.8)" : undefined }} />
      <div style={{ position: "absolute", inset: 0, background: `linear-gradient(to top, color-mix(in srgb, ${stage} 94%, transparent) 18%, color-mix(in srgb, ${stage} 58%, transparent) 58%, color-mix(in srgb, ${stage} 20%, transparent) 100%)` }} />

      {/* top row: status + members + theme + leave */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", borderRadius: 7, background: `color-mix(in srgb, ${stage} 62%, transparent)`, boxShadow: isLive ? `inset 0 0 0 1px color-mix(in srgb, ${LIVE} 50%, transparent)` : (kind === "light" ? "inset 0 0 0 1px rgba(27,20,32,0.16)" : "inset 0 0 0 1px rgba(255,255,255,0.14)") }}>
            {isLive && <span style={{ width: 6, height: 6, borderRadius: "var(--radius-pill, 999px)", background: LIVE, boxShadow: `0 0 8px ${LIVE}` }} />}
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: isLive ? LIVE : onStageSoft, textTransform: "uppercase" }}>{isLive ? "Live now" : statusLabel}</span>
          </span>
          {theme && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: onStageMuted }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: coverSwatchBackground(squad.coverImage, kind), boxShadow: kind === "light" ? "inset 0 0 0 1px rgba(27,20,32,0.25)" : "inset 0 0 0 1px rgba(255,255,255,0.35)" }} />
              {theme}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: onStageMuted }}>
            <Icon.account size={12} color={onStageSoft} />
            <span style={{ fontSize: 12, fontWeight: 700, color: onStageSoft, fontVariantNumeric: "tabular-nums" }}>{squad.memberCount}/{squad.maxSlots}</span>
          </span>
          <button onClick={e => { e.stopPropagation(); onAskLeave(); }} aria-label={`Leave ${squad.squadName}`} title="Leave squad" className="gg-press" style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", display: "grid", placeItems: "center" }}>
            <Icon.close size={13} color={onStageSoft} />
          </button>
        </div>
      </div>

      {/* bottom: name + vibes + open */}
      <div style={{ position: "relative", display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: promoted ? 22 : 18, color: onStage, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{squad.squadName}</div>
          <div style={{ fontSize: 12, color: onStageMuted, marginTop: 2 }}>
            {squad.leaderName ? `Led by ${squad.leaderName}` : (squad.myRole === "leader" ? "You lead this" : "Your squad")}
          </div>
          {squad.tags && squad.tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 0, marginTop: 8, color: onStageMuted }}>
              {squad.tags.slice(0, promoted ? 4 : 2).map((t, index, visibleTags) => (
                <span key={t} style={{ fontSize: 11, fontWeight: 600 }}>
                  {t}{index < visibleTags.length - 1 ? <span aria-hidden style={{ margin: "0 7px", opacity: 0.55 }}>·</span> : null}
                </span>
              ))}
            </div>
          )}
        </div>
        <button onClick={e => { e.stopPropagation(); onOpen(); }} className="gg-press" style={{ flexShrink: 0, height: 40, padding: "0 18px", borderRadius: "var(--radius-pill, 999px)", border: "none", cursor: "pointer", background: ACCENT, color: "var(--on-accent, #fff)", fontFamily: "var(--font-inter)", fontWeight: 700, fontSize: 14, boxShadow: `0 0 18px -8px color-mix(in srgb, ${ACCENT} 80%, transparent)` }}>
          {isLive ? "Rejoin" : "Open"}
        </button>
      </div>
    </div>
  );
}

const sectionTitle: React.CSSProperties = {
  margin: 0, fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 17, color: "var(--text)", letterSpacing: "-0.01em",
};
const linkBtn: React.CSSProperties = {
  background: "none", border: "none", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: "0 2px", transition: "color .2s var(--ease-ui)",
};
