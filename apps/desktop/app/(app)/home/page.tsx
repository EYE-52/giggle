"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { SquadCard } from "@/components/SquadCard";
import type { PublicSquad, MySquadLite } from "@giggle/core";
import { session, api, randomSquadName, resolveCover, getTokenBalance, billing, formatSquadCodeInput, isValidSquadCode } from "@giggle/core";
import { useViewport } from "@/components/useViewport";

const MY_STATUS_LABEL: Record<string, string> = {
  idle: "Open",
  searching: "Searching",
  matched: "Matched",
  in_encounter: "Live",
};

const MY_SQUAD_GRADIENTS = [
  "radial-gradient(120% 90% at 20% 10%, rgba(255,92,138,0.55), transparent 55%), radial-gradient(120% 90% at 90% 80%, rgba(124,92,255,0.6), transparent 55%), linear-gradient(160deg, #2a1140, #0b0b0f)",
  "radial-gradient(120% 90% at 80% 10%, rgba(92,140,255,0.5), transparent 55%), radial-gradient(120% 90% at 10% 90%, rgba(61,214,192,0.45), transparent 55%), linear-gradient(160deg, #10243a, #0b0b0f)",
  "radial-gradient(120% 90% at 30% 20%, rgba(194,255,61,0.4), transparent 55%), radial-gradient(120% 90% at 80% 90%, rgba(124,92,255,0.55), transparent 55%), linear-gradient(160deg, #1a2a12, #0b0b0f)",
  "radial-gradient(120% 90% at 70% 15%, rgba(255,176,32,0.45), transparent 55%), radial-gradient(120% 90% at 15% 85%, rgba(255,92,138,0.5), transparent 55%), linear-gradient(160deg, #2e1a10, #0b0b0f)",
];
function mySquadGradient(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return MY_SQUAD_GRADIENTS[h % MY_SQUAD_GRADIENTS.length];
}

const VIBE_OPTIONS = [
  { id: "gaming",     emoji: "🎮", label: "Gaming",     desc: "co-op energy, banter" },
  { id: "chill",      emoji: "😌", label: "Chill",      desc: "low-key hangs" },
  { id: "music",      emoji: "🎵", label: "Music",      desc: "share tracks & tastes" },
  { id: "comedy",     emoji: "😂", label: "Comedy",     desc: "keep it light" },
  { id: "deeptalks",  emoji: "💬", label: "Deep Talks", desc: "real conversations" },
  { id: "latenight",  emoji: "🌙", label: "Late Night", desc: "night-owl crew" },
  { id: "hype",       emoji: "🔥", label: "Hype",       desc: "high energy" },
  { id: "sports",     emoji: "⚽", label: "Sports",     desc: "game day vibes" },
];

export default function HomePage() {
  const router = useRouter();
  const { isPhone, isTablet } = useViewport();
  const [squadCode, setSquadCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [selectedVibes, setSelectedVibes] = useState<string[]>([]);
  const [createHovered, setCreateHovered] = useState(false);
  const [joinHovered, setJoinHovered] = useState(false);
  const [viewAllHovered, setViewAllHovered] = useState(false);
  const [findSquadHovered, setFindSquadHovered] = useState(false);
  const [hoveredStat, setHoveredStat] = useState<string | null>(null);
  const [hoveredStep, setHoveredStep] = useState<string | null>(null);
  const [squadCodeFocused, setSquadCodeFocused] = useState(false);
  const [stats, setStats] = useState<{ squadsTotal: number; squadsOnline?: number; playersOnline: number; encountersTotal: number; searching: number; liveEncounters: number } | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [mySquads, setMySquads] = useState<MySquadLite[]>([]);
  const [trending, setTrending] = useState<PublicSquad[] | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [tokenBal, setTokenBal] = useState(0);

  // Real "Trending Vibes" — derived from the OPEN squads available right now.
  useEffect(() => {
    let alive = true;
    api.discoverSquads()
      .then((d) => { if (alive) setTrending(d.squads ?? []); })
      .catch(() => { if (alive) setTrending([]); });
    return () => { alive = false; };
  }, []);

  // Aggregate open squads by vibe → the trending vibes (each groups N open squads).
  const trendingVibes = (() => {
    if (!trending) return null;
    const counts = new Map<string, number>();
    for (const sq of trending) {
      for (const raw of sq.tags ?? []) {
        const v = raw.replace(/^[^\w]+/, "").trim();
        if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  })();

  const VIBE_GRADIENTS = [
    "linear-gradient(135deg, #7C5CFF, #5C8CFF)",
    "linear-gradient(135deg, #FF5C8A, #FF8A5C)",
    "linear-gradient(135deg, #3DD6C0, #5C8CFF)",
    "linear-gradient(135deg, #C2FF3D, #3DD6C0)",
    "linear-gradient(135deg, #9B7CFF, #FF5C8A)",
    "linear-gradient(135deg, #FFC65C, #FF5C8A)",
  ];

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
  useEffect(() => {
    setTokenBal(getTokenBalance());
    return billing.subscribe(() => setTokenBal(getTokenBalance()));
  }, []);
  const [openHoveredId, setOpenHoveredId] = useState<string | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);

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

  function fmtNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  }

  useEffect(() => {
    try {
      const stored = localStorage.getItem("giggle.vibes");
      if (stored) setSelectedVibes(JSON.parse(stored));
    } catch {}
  }, []);

  useEffect(() => {
    api.getStats()
      .then(data => setStats(data))
      .catch(() => {/* keep null — fallback rendered below */})
      .finally(() => setStatsLoading(false));
  }, []);

  useEffect(() => {
    // Guarded: api.mySquads may not exist yet (parallel backend work) — and a
    // missing method throws synchronously, so wrap the whole call.
    (async () => {
      try {
        const { squads } = await api.mySquads();
        setMySquads(squads ?? []);
      } catch {/* not signed in, none yet, or endpoint not live — section just won't render */}
    })();
  }, []);

  function toggleVibe(id: string) {
    setSelectedVibes(prev => {
      const next = prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id];
      try { localStorage.setItem("giggle.vibes", JSON.stringify(next)); } catch {}
      return next;
    });
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
      // Multi-membership is allowed — always create a brand-new squad.
      const selectedVibeLabels = VIBE_OPTIONS
        .filter((vibe) => selectedVibes.includes(vibe.id))
        .map((vibe) => vibe.label);
      const squad = await api.createSquad({ squadName: randomSquadName(), tags: selectedVibeLabels });
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

  return (
    <div className="gg-reveal" style={{ display: "flex", flexDirection: "column", gap: 0, paddingBottom: 40 }}>

      {/* ── COMMAND CENTER GREETING ───────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: isPhone ? "column" : "row", alignItems: isPhone ? "flex-start" : "center", justifyContent: "space-between", paddingBottom: isPhone ? 16 : 18, gap: isPhone ? 10 : 18 }}>
        <div style={{ maxWidth: 720 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 10px", borderRadius: 999, background: "color-mix(in srgb, var(--lime) 10%, transparent)", border: "1px solid color-mix(in srgb, var(--lime) 28%, transparent)", color: "var(--lime-text)", fontFamily: "var(--font-space-grotesk)", fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--lime)", boxShadow: "0 0 10px var(--lime)" }} />
            Squad Control Room
          </div>
          <h1 style={{ margin: 0, fontFamily: "var(--font-space-grotesk)", fontWeight: 800, fontSize: isPhone ? 24 : 28, color: "var(--text)", letterSpacing: "-0.02em", lineHeight: 1.12 }}>
            Build your squad, set the signal, go live.
          </h1>
          <p style={{ margin: "6px 0 0", fontSize: isPhone ? 13.5 : 14.5, color: "var(--text-muted)", lineHeight: 1.45, maxWidth: 540 }}>
            Open a room, invite your people, and match with another crew when everyone is ready.
          </p>
        </div>
        {/* Token wallet chip (real, live balance) */}
        <button
          onClick={() => router.push("/premium")}
          className="gg-press"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, minHeight: 40, background: "var(--violet-soft)", border: "1px solid rgba(124,92,255,0.3)", borderRadius: 999, padding: "8px 16px", flexShrink: 0, cursor: "pointer", transition: "transform .14s ease, background .2s var(--ease-ui), border-color .2s var(--ease-ui)" }}
          title="Your tokens — tap to top up"
        >
          <Icon.star size={16} color="var(--lime)" />
          <span style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 14, color: "var(--lime-text)" }}>{tokenBal.toLocaleString()} tokens</span>
        </button>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: isPhone ? "1fr" : "repeat(3, 1fr)",
        gap: 10,
        marginBottom: 24,
      }}>
        {[
          { label: "Active squads", value: mySquads.length || "None", hint: mySquads.length ? "Resume a room below" : "Create your first room" },
          { label: "Open signals", value: trending?.length ?? "Syncing", hint: "Public squads looking for members" },
          { label: "Live now", value: stats?.liveEncounters ?? 0, hint: "Encounters currently running" },
        ].map((item) => (
          <div key={item.label} style={{ background: "linear-gradient(155deg, var(--surface-grad-from), var(--surface-grad-to))", border: "1px solid var(--border)", borderRadius: 14, padding: "13px 14px", boxShadow: "var(--elev)" }}>
            <div style={{ color: "var(--text-dim)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>{item.label}</div>
            <div style={{ marginTop: 5, color: "var(--text)", fontFamily: "var(--font-space-grotesk)", fontSize: 22, fontWeight: 800, letterSpacing: "-0.03em" }}>{item.value}</div>
            <div style={{ marginTop: 2, color: "var(--text-muted)", fontSize: 12.5 }}>{item.hint}</div>
          </div>
        ))}
      </div>

      {/* ── YOUR SQUADS ──────────────────────────────────────────── */}
      {mySquads.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <Icon.account size={18} color="var(--violet)" />
            <h2 style={{ ...cardTitle, fontSize: 18 }}>Your squads</h2>
            <span style={{ color: "var(--text-dim)", fontSize: 13, fontWeight: 600 }}>
              {mySquads.length}
            </span>
          </div>
          <div style={{
            display: "grid",
            gridTemplateColumns: isPhone ? "1fr" : "repeat(auto-fill, minmax(260px, 1fr))",
            gap: 14,
          }}>
            {mySquads.map(s => {
              const statusLabel = MY_STATUS_LABEL[s.status] ?? s.status;
              const isLive = s.status === "in_encounter";
              const hovered = openHoveredId === s.squadId;
              const bg = s.coverImage
                ? `linear-gradient(to top, rgba(7,7,11,0.94) 10%, rgba(7,7,11,0.4) 55%, rgba(7,7,11,0.2)), ${resolveCover(s.coverImage)}`
                : mySquadGradient(s.squadId || s.squadName);
              return (
                <div
                  key={s.squadId}
                  onClick={() => router.push(`/lobby?squad=${s.squadId}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(`/lobby?squad=${s.squadId}`); } }}
                  onMouseEnter={() => setOpenHoveredId(s.squadId)}
                  onMouseLeave={() => setOpenHoveredId(null)}
                  className="gg-focusable gg-press-card"
                  style={{
                    position: "relative",
                    minHeight: 130,
                    borderRadius: 18,
                    overflow: "hidden",
                    padding: 16,
                    background: bg,
                    border: hovered ? "1px solid var(--border-strong)" : "1px solid var(--border)",
                    boxShadow: hovered ? "0 14px 36px rgba(0,0,0,0.32)" : "var(--elev)",
                    transform: hovered ? "translateY(-2px) scale(1.01)" : "translateY(0) scale(1)",
                    transition: "transform .18s var(--ease-ui), box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  {/* Status + member pills */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: 5,
                      padding: "4px 9px", borderRadius: 999,
                      background: "rgba(11,11,15,0.6)",
                      border: isLive ? "1px solid rgba(194,255,61,0.5)" : "1px solid rgba(255,255,255,0.18)",
                      backdropFilter: "blur(6px)",
                    }}>
                      {isLive && <span style={{ width: 6, height: 6, borderRadius: 999, background: "#C2FF3D", boxShadow: "0 0 8px #C2FF3D" }} />}
                      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", color: isLive ? "#C2FF3D" : "#E7E7F0", textTransform: "uppercase" }}>{statusLabel}</span>
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 5,
                        padding: "4px 9px", borderRadius: 999,
                        background: "rgba(11,11,15,0.6)",
                        border: "1px solid rgba(255,255,255,0.18)",
                        backdropFilter: "blur(6px)",
                      }}>
                        <Icon.account size={12} color="#E7E7F0" />
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#E7E7F0", fontVariantNumeric: "tabular-nums" }}>
                          {s.memberCount}/{s.maxSlots}
                        </span>
                      </span>
                      {/* Leave / remove this squad */}
                      <button
                        onClick={e => { e.stopPropagation(); setRemoveConfirmId(s.squadId); }}
                        aria-label={`Leave ${s.squadName}`}
                        title="Leave squad"
                        className="gg-press"
                        style={{
                          flexShrink: 0,
                          width: 44, height: 44, borderRadius: 999, border: "1px solid rgba(255,255,255,0.18)",
                          background: "rgba(11,11,15,0.6)", backdropFilter: "blur(6px)", cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        <Icon.close size={13} color="#E7E7F0" />
                      </button>
                    </div>
                  </div>

                  {/* Leave confirmation overlay */}
                  {removeConfirmId === s.squadId && (
                    <div
                      onClick={e => e.stopPropagation()}
                      className="gg-toast"
                      style={{
                        position: "absolute", inset: 0, zIndex: 5,
                        background: "rgba(7,7,11,0.86)", backdropFilter: "blur(4px)",
                        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 16, textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#F4F4F7" }}>Leave “{s.squadName}”?</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setRemoveConfirmId(null)} className="gg-press" style={{ minHeight: 44, padding: "0 16px", borderRadius: 999, border: "1px solid var(--border)", background: "transparent", color: "#C9C9DA", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
                        <button onClick={() => handleLeaveSquad(s.squadId)} className="gg-press" style={{ minHeight: 44, padding: "0 16px", borderRadius: 999, border: "none", background: "var(--coral)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Leave</button>
                      </div>
                    </div>
                  )}

                  {/* Name + Open */}
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 18, color: "#F4F4F7", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {s.squadName}
                      </div>
                      <div style={{ fontSize: 12, color: "#C9C9DA", marginTop: 2 }}>
                        {s.leaderName ? `Led by ${s.leaderName}` : (s.myRole === "leader" ? "You lead this" : "Your squad")}
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); router.push(`/lobby?squad=${s.squadId}`); }}
                      className="gg-press"
                      style={{
                        flexShrink: 0,
                        height: 40, padding: "0 18px", borderRadius: 999, border: "none",
                        cursor: "pointer",
                        background: hovered ? "var(--violet-bright)" : "var(--violet)",
                        color: "#fff",
                        fontFamily: "var(--font-inter)", fontWeight: 700, fontSize: 13.5,
                        boxShadow: hovered ? "0 0 26px -6px rgba(124,92,255,0.95)" : "0 0 18px -8px rgba(124,92,255,0.8)",
                        transition: "transform .14s ease, box-shadow .2s var(--ease-ui), background .2s var(--ease-ui)",
                      }}
                    >
                      Open
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── PRIMARY ACTIONS + TRENDING VIBES ─────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: isTablet ? "1fr" : "minmax(0,1fr) minmax(0,1.15fr)", gap: 24, alignItems: "stretch" }}>
        {/* LEFT — Create + Join */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Create a Squad */}
          <section style={{
            ...card,
            background: "linear-gradient(165deg, color-mix(in srgb, var(--violet) 14%, var(--surface)), var(--surface))",
            boxShadow: "var(--elev), 0 0 40px -20px rgba(124,92,255,0.25)",
            border: "1px solid var(--violet-soft)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={iconTile}>
                <Icon.plus size={20} color="var(--on-accent)" strokeWidth={2.6} />
              </div>
              <h2 style={cardTitle}>Create a Squad</h2>
            </div>
            <p style={cardBody}>Start a new vibe. Invite your crew or open it up to the city.</p>
            <button
              onClick={handleCreate}
              disabled={creating}
              onMouseEnter={() => setCreateHovered(true)}
              onMouseLeave={() => setCreateHovered(false)}
              className="gg-press"
              style={{
                ...primaryBtn,
                background: createHovered ? "var(--violet-bright)" : "var(--violet)",
                boxShadow: createHovered ? "0 0 32px -6px rgba(124,92,255,0.95)" : "0 0 24px -8px rgba(124,92,255,0.8)",
                transform: createHovered && !creating ? "translateY(-1px)" : "translateY(0)",
                transition: "transform .14s ease, box-shadow .2s var(--ease-ui), background .2s var(--ease-ui)",
                opacity: creating ? 0.85 : 1,
              }}
            >
              {creating ? (<><span className="gg-spinner" /> Creating…</>) : "Create Squad"}
            </button>
          </section>

          {/* Join with Code */}
          <section style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ ...iconTile, background: "var(--overlay)", border: "1px solid var(--border)", boxShadow: "none" }}>
                <Icon.enter size={18} color="#9A9AB0" />
              </div>
              <h2 style={cardTitle}>Join with Code</h2>
            </div>
            <p style={cardBody}>Got an invite? Enter the access code to drop in.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                value={squadCode}
                onChange={e => {
                  setSquadCode(formatSquadCodeInput(e.target.value));
                  if (actionError) setActionError(null);
                }}
                onKeyDown={e => { if (e.key === "Enter") handleJoin(); }}
                placeholder="ENTER-CODE"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                onFocus={() => setSquadCodeFocused(true)}
                onBlur={() => setSquadCodeFocused(false)}
                style={{
                  flex: 1, height: 44, borderRadius: 12,
                  background: "var(--overlay)",
                  border: squadCodeFocused ? "1px solid var(--violet)" : "1px solid var(--border-strong)",
                  boxShadow: squadCodeFocused ? "0 0 0 3px color-mix(in srgb, var(--violet) 30%, transparent)" : "none",
                  outline: "none",
                  color: "var(--text)", padding: "0 14px", fontSize: 14,
                  letterSpacing: "0.12em", fontFamily: "var(--font-space-grotesk)",
                  transition: "box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                }}
              />
              <button
                onClick={handleJoin}
                disabled={joining || !isValidSquadCode(squadCode)}
                onMouseEnter={() => setJoinHovered(true)}
                onMouseLeave={() => setJoinHovered(false)}
                className="gg-press"
                style={{
                  ...primaryBtn, width: "auto", padding: "0 20px", height: 44,
                  background: joinHovered ? "var(--violet-bright)" : "var(--violet)",
                  transition: "transform .14s ease, box-shadow .2s var(--ease-ui), background .2s var(--ease-ui)",
                  transform: joinHovered && !joining ? "translateY(-1px)" : "translateY(0)",
                  minWidth: 72,
                  opacity: joining || !isValidSquadCode(squadCode) ? 0.55 : 1,
                  whiteSpace: "nowrap" as const,
                  display: "inline-flex" as const,
                  alignItems: "center" as const,
                  justifyContent: "center" as const,
                }}
              >
                {joining ? <span className="gg-spinner" /> : "Enter"}
              </button>
            </div>
          </section>

          {/* Inline action error */}
          {actionError && (
            <div role="alert" className="gg-toast" style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "color-mix(in srgb, var(--coral) 12%, var(--surface))",
              border: "1px solid color-mix(in srgb, var(--coral) 45%, transparent)",
              borderRadius: 12, padding: "10px 14px",
              fontSize: 13, fontWeight: 600, color: "var(--coral)",
            }}>
              <Icon.flag size={14} color="var(--coral)" />
              <span style={{ flex: 1 }}>{actionError}</span>
              <button
                onClick={() => setActionError(null)}
                aria-label="Dismiss"
                style={{ width: 44, height: 44, margin: "-10px -10px -10px 0", background: "none", border: "none", cursor: "pointer", color: "var(--coral)", padding: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                <Icon.close size={14} color="var(--coral)" />
              </button>
            </div>
          )}
        </div>

        {/* RIGHT — Trending Vibes + Live Stats */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Trending Vibes header + cards */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "var(--text-dim)", textTransform: "uppercase" }}>Open squads by signal</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <Icon.trend size={18} color="var(--lime)" />
                  <h2 style={{ ...cardTitle, fontSize: 18 }}>Live Signals</h2>
                </div>
              </div>
              <button
                onClick={() => router.push("/discover")}
                onMouseEnter={() => setViewAllHovered(true)}
                onMouseLeave={() => setViewAllHovered(false)}
                style={{ minWidth: 44, minHeight: 44, padding: "0 2px 0 12px", background: "none", border: "none", color: viewAllHovered ? "var(--text)" : "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "color .15s ease" }}
              >View All</button>
            </div>
            {/* Vibe categories, each grouping the OPEN squads that share it.
                Click a vibe → Discover filtered to that vibe's open squads. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {trendingVibes === null ? (
                [0, 1, 2, 3].map(i => (
                  <div key={i} className="gg-shimmer" style={{ borderRadius: 16, height: 84, border: "1px solid var(--border)" }} />
                ))
              ) : trendingVibes.length > 0 ? (
                trendingVibes.map(([vibe, count], i) => (
                  <button
                    key={vibe}
                    onClick={() => router.push(`/discover?vibe=${encodeURIComponent(vibe)}`)}
                    onMouseEnter={() => setHoveredStat(`vibe-${vibe}`)}
                    onMouseLeave={() => setHoveredStat(null)}
                    className="gg-press-card"
                    style={{
                      position: "relative", overflow: "hidden",
                      borderRadius: 16, height: 84, padding: "14px 16px", textAlign: "left",
                      border: hoveredStat === `vibe-${vibe}` ? "1px solid var(--border-strong)" : "1px solid var(--border)",
                      cursor: "pointer",
                      background: "var(--surface)",
                      transform: hoveredStat === `vibe-${vibe}` ? "translateY(-2px)" : "none",
                      boxShadow: hoveredStat === `vibe-${vibe}` ? "0 10px 28px rgba(0,0,0,0.28)" : "var(--elev)",
                      transition: "transform .18s var(--ease-ui), box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                      display: "flex", flexDirection: "column", justifyContent: "space-between",
                    }}
                  >
                    {/* accent swatch */}
                    <div style={{ position: "absolute", inset: 0, opacity: 0.16, background: VIBE_GRADIENTS[i % VIBE_GRADIENTS.length] }} />
                    <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 4, background: VIBE_GRADIENTS[i % VIBE_GRADIENTS.length] }} />
                    <span style={{ position: "relative", fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 16, color: "var(--text)" }}>{vibe}</span>
                    <span style={{ position: "relative", fontSize: 12.5, color: "var(--text-muted)", fontWeight: 600 }}>
                      {count} open {count === 1 ? "squad" : "squads"}
                    </span>
                  </button>
                ))
              ) : (
                <div style={{
                  gridColumn: "1 / -1", borderRadius: 16, padding: "28px 24px",
                  border: "1px dashed var(--border)", background: "var(--surface)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, textAlign: "center",
                }}>
                  <Icon.trend size={22} color="var(--text-dim)" />
                  <div style={{ color: "var(--text-muted)", fontSize: 14, fontWeight: 600 }}>No open squads live right now</div>
                  <div style={{ color: "var(--text-dim)", fontSize: 12.5 }}>Create a squad, add vibes, and open it up.</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── SECTION DIVIDER ───────────────────────────────────────── */}
      <div style={{ ...hairlineDivider, marginTop: isPhone ? 20 : 28 }} />

      {/* ── STATS STRIP ───────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, padding: isPhone ? "20px 0" : "24px 0" }}>
        {[
          { value: statsLoading ? "…" : stats ? fmtNum(stats.squadsTotal) : "—", label: "SQUADS FORMED", key: "squadsTotal" },
          { value: statsLoading ? "…" : stats ? fmtNum(stats.liveEncounters) : "—", label: "LIVE NOW", key: "liveEncounters" },
          { value: statsLoading ? "…" : stats ? fmtNum(stats.encountersTotal) : "—", label: "ENCOUNTERS TOTAL", key: "encountersTotal" },
        ].map(({ value, label, key }, i) => (
          <div key={key} style={{ display: "flex", alignItems: "stretch", gap: 0 }}>
            {i > 0 && (
              <div style={{ width: 1, background: "var(--border)", alignSelf: "stretch", margin: isPhone ? "0 16px" : "0 32px" }} />
            )}
            <div
              onMouseEnter={() => setHoveredStat(key)}
              onMouseLeave={() => setHoveredStat(null)}
              style={{ textAlign: "center", cursor: "default", transition: "opacity .15s ease", opacity: hoveredStat && hoveredStat !== key ? 0.5 : 1, maxWidth: isPhone ? 92 : undefined }}
            >
              <div style={{
                fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: isPhone ? 26 : 32, lineHeight: 1,
                color: "var(--text)", letterSpacing: "0",
                fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum" 1',
                transition: "color .15s ease",
              }}>
                {value}
              </div>
              <div style={{ marginTop: 6, fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", color: "var(--text-dim)", textTransform: "uppercase" as const }}>
                {label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── SECTION DIVIDER ───────────────────────────────────────── */}
      <div style={hairlineDivider} />

      {/* ── HOW GIGGLE WORKS — editorial borderless columns ───────── */}
      <section style={{ padding: isPhone ? "32px 0" : "40px 0" }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Icon.lightning size={15} color="var(--violet)" />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" as const, color: "var(--violet)" }}>How it works</span>
          </div>
          <h2 style={{ margin: 0, fontFamily: "var(--font-space-grotesk)", fontWeight: 800, fontSize: 26, color: "var(--text)", letterSpacing: "-0.02em" }}>
            Three steps to your people.
          </h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr" : "repeat(3, 1fr)", gap: isPhone ? 32 : 0 }}>
          {[
            { icon: <Icon.plus size={18} color="var(--on-accent)" />, step: "01", title: "Squad up", body: "Create a squad or join one with a code. Bring your friends or go solo — we'll fill the rest.", accent: "var(--violet)" },
            { icon: <Icon.star size={18} color="#0B0B0F" />, step: "02", title: "Match by vibe", body: "Pick your vibe tags and we pair you with another squad who shares your energy. No random strangers — genuine fits.", accent: "var(--lime)" },
            { icon: <Icon.cam size={18} color="var(--on-accent)" />, step: "03", title: "Go live", body: "Jump into a group video call and just hang. Rate the vibe, discover new people, keep the good ones.", accent: "var(--coral)" },
          ].map(({ icon, step, title, body, accent }, i) => (
            <div key={step} style={{ display: "flex", gap: 0 }}>
              {i > 0 && !isPhone && (
                <div style={{ width: 1, background: "var(--hairline)", flexShrink: 0, margin: "0 40px 0 0" }} />
              )}
              <div
                onMouseEnter={() => setHoveredStep(step)}
                onMouseLeave={() => setHoveredStep(null)}
                style={{
                  flex: 1,
                  paddingRight: !isPhone && i < 2 ? 40 : 0,
                  paddingLeft: i > 0 ? 0 : 0,
                  transition: "opacity .2s ease",
                  opacity: hoveredStep && hoveredStep !== step ? 0.5 : 1,
                  cursor: "default",
                }}
              >
                {/* Step number — big faint accent */}
                <div style={{
                  fontFamily: "var(--font-space-grotesk)", fontWeight: 900, fontSize: 46, lineHeight: 1,
                  color: accent, opacity: 0.12, letterSpacing: "0", fontVariantNumeric: "tabular-nums",
                  marginBottom: 12, userSelect: "none",
                }}>
                  {step}
                </div>
                {/* Icon */}
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: accent === "var(--lime)" ? accent : `color-mix(in srgb, ${accent} 80%, transparent)`,
                  boxShadow: `0 0 16px -4px ${accent}99`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 14,
                }}>
                  {icon}
                </div>
                <h3 style={{ margin: "0 0 8px", fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 19, color: "var(--text)", lineHeight: 1.25, letterSpacing: "-0.01em" }}>
                  {title}
                </h3>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: "var(--text-muted)", maxWidth: 280 }}>
                  {body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── SECTION DIVIDER ───────────────────────────────────────── */}
      <div style={hairlineDivider} />

      {/* ── WHAT'S A VIBE? + VIBE PICKER — open two-column ───────── */}
      <section style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr" : "minmax(0,1fr) minmax(0,1.1fr)", gap: isPhone ? 28 : 44, alignItems: "start", padding: isPhone ? "32px 0" : "40px 0" }}>
        {/* LEFT — explainer prose */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <Icon.discover size={14} color="var(--lime)" />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" as const, color: "var(--lime-text)" }}>Vibes</span>
          </div>
          <h2 style={{ margin: "0 0 12px", fontFamily: "var(--font-space-grotesk)", fontWeight: 800, fontSize: 24, color: "var(--text)", letterSpacing: "-0.02em", lineHeight: 1.25 }}>
            What's a vibe?
          </h2>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--text-body)", maxWidth: 460 }}>
            Vibes are interest &amp; energy tags — they tell Giggle what kind of hang you're looking for. We match your squad with another crew who shares them, so you skip the awkward intros and get straight to the good stuff.
          </p>
        </div>

        {/* RIGHT — vibe picker */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Icon.pin size={14} color="var(--violet)" />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase" as const, color: "var(--violet)" }}>Pick your vibes</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {VIBE_OPTIONS.map(v => {
              const active = selectedVibes.includes(v.id);
              return (
                <button key={v.id} onClick={() => toggleVibe(v.id)} title={`${v.emoji} ${v.label} — ${v.desc}`} className="gg-press" style={{
                  display: "flex", alignItems: "center", gap: 6, minHeight: 40,
                  padding: "8px 16px", borderRadius: 999, cursor: "pointer",
                  background: active ? "var(--violet-soft)" : "var(--overlay)",
                  border: active ? "1px solid rgba(124,92,255,0.5)" : "1px solid var(--border)",
                  color: active ? "var(--violet)" : "var(--text-muted)",
                  fontWeight: 600, fontSize: 13,
                  boxShadow: active ? "0 0 18px -6px rgba(124,92,255,0.5)" : "none",
                  transition: "transform .14s ease, box-shadow .2s var(--ease-ui), background .2s var(--ease-ui), border-color .2s var(--ease-ui), color .2s var(--ease-ui)",
                  fontFamily: "var(--font-inter)",
                }}>
                  <span style={{ fontSize: 14 }}>{v.emoji}</span>
                  {v.label}
                </button>
              );
            })}
          </div>
          <p style={{ margin: "14px 0 0", fontSize: 12, color: "var(--violet)", fontWeight: 600, display: "flex", alignItems: "center", gap: 5, minHeight: "1.5em", visibility: selectedVibes.length > 0 ? "visible" : "hidden" }}>
            <Icon.shield size={12} color="var(--violet)" /> {selectedVibes.length > 0 ? `${selectedVibes.length} vibe${selectedVibes.length > 1 ? "s" : ""} saved — your matches will reflect this.` : " "}
          </p>
        </div>
      </section>

      {/* ── SECTION DIVIDER ───────────────────────────────────────── */}
      <div style={hairlineDivider} />

      {/* ── FIND A SQUAD CTA — finishing banner ───────────────────── */}
      <div style={{
        marginTop: isPhone ? 28 : 32,
        padding: isPhone ? "24px 22px" : "28px 32px",
        borderRadius: 20,
        background: "linear-gradient(135deg, rgba(124,92,255,0.08) 0%, var(--surface-grad-to) 50%, rgba(194,255,61,0.06) 100%)",
        border: "1px solid var(--hairline)",
        boxShadow: "0 0 80px -20px rgba(124,92,255,0.2), 0 0 60px -30px rgba(194,255,61,0.15)",
        display: "flex", flexDirection: isPhone ? "column" : "row", alignItems: isPhone ? "flex-start" : "center", justifyContent: "space-between",
        gap: isPhone ? 16 : 0,
        position: "relative",
        overflow: "hidden",
      }}>
        {/* Ambient glow */}
        <div style={{
          position: "absolute", inset: 0,
          background: "radial-gradient(ellipse 60% 80% at 10% 50%, rgba(124,92,255,0.07), transparent 70%), radial-gradient(ellipse 40% 60% at 90% 50%, rgba(194,255,61,0.05), transparent 70%)",
          pointerEvents: "none",
        }} />
        <div style={{ position: "relative" }}>
          <h2 style={{ margin: "0 0 6px", fontFamily: "var(--font-space-grotesk)", fontWeight: 800, fontSize: 22, color: "var(--text)", letterSpacing: "-0.02em" }}>
            Ready to find your people?
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-muted)", lineHeight: 1.5 }}>
            Browse open squads looking for members right now.
          </p>
        </div>
        <button
          onClick={() => router.push("/discover")}
          onMouseEnter={() => setFindSquadHovered(true)}
          onMouseLeave={() => setFindSquadHovered(false)}
          className="gg-press"
          style={{
            position: "relative",
            background: findSquadHovered ? "#D4FF6E" : "var(--lime)",
            color: "#0B0B0F",
            border: "none",
            borderRadius: 999,
            fontFamily: "var(--font-space-grotesk)",
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
            boxShadow: findSquadHovered ? "0 0 48px -6px rgba(194,255,61,0.8), 0 0 24px -12px rgba(194,255,61,0.6)" : "0 0 32px -8px rgba(194,255,61,0.5)",
            height: 46,
            padding: "0 28px",
            display: "flex", alignItems: "center", gap: 8,
            flexShrink: 0,
            transform: findSquadHovered ? "translateY(-1px)" : "translateY(0)",
            transition: "transform .14s ease, box-shadow .2s var(--ease-ui), background .2s var(--ease-ui)",
            letterSpacing: "-0.01em",
          }}
        >
          <Icon.discover size={15} color="#0B0B0F" />
          Find a Squad
        </button>
      </div>

    </div>
  );
}

const hairlineDivider: React.CSSProperties = {
  height: 1,
  background: "linear-gradient(90deg, transparent, var(--border), transparent)",
  flexShrink: 0,
};

const card: React.CSSProperties = {
  background: "linear-gradient(180deg, var(--surface-grad-from) 0%, var(--surface-grad-to) 100%)",
  border: "1px solid var(--border)",
  borderRadius: 18,
  padding: 20,
  boxShadow: "var(--elev)",
};
const iconTile: React.CSSProperties = {
  width: 40, height: 40, borderRadius: 12,
  background: "var(--violet)",
  display: "flex", alignItems: "center", justifyContent: "center",
  boxShadow: "0 0 18px -2px rgba(124,92,255,0.7)",
  flexShrink: 0,
};
const cardTitle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-space-grotesk)",
  fontWeight: 700, fontSize: 19,
  color: "var(--text)", letterSpacing: "-0.01em",
};
const cardBody: React.CSSProperties = { margin: "0 0 14px", fontSize: 13, lineHeight: 1.5, color: "var(--text-muted)" };
const primaryBtn: React.CSSProperties = {
  width: "100%", height: 44, border: "none", borderRadius: 999,
  background: "var(--violet)", color: "var(--on-accent)",
  fontFamily: "var(--font-inter)", fontWeight: 600, fontSize: 14,
  cursor: "pointer", boxShadow: "0 0 24px -8px rgba(124,92,255,0.8)",
  whiteSpace: "nowrap" as const, display: "inline-flex" as const, alignItems: "center" as const, justifyContent: "center" as const,
};
