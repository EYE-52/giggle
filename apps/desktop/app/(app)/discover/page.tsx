"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { SquadCard } from "@/components/SquadCard";
import { SquadPreview } from "@/components/SquadPreview";
import { PageHeader } from "@/components/PageHeader";
import { useViewport } from "@/components/useViewport";
import { api, session, randomSquadName, VIBES, type PublicSquad } from "@giggle/core";

export default function DiscoverPage() {
  const router = useRouter();
  const { isPhone, isTablet } = useViewport();

  const [squads, setSquads] = useState<PublicSquad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [randomLoading, setRandomLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [previewSquad, setPreviewSquad] = useState<PublicSquad | null>(null);
  const [requestNotice, setRequestNotice] = useState<string | null>(null);
  const [ctaHover, setCtaHover] = useState(false);
  const [retryHover, setRetryHover] = useState(false);

  // Optional ?vibe=<name> deep-link (from Home's Trending Vibes) → filter to
  // open squads that share that vibe.
  const [vibe, setVibe] = useState<string | null>(null);
  useEffect(() => {
    try {
      const v = new URLSearchParams(window.location.search).get("vibe");
      if (v) setVibe(v);
    } catch {}
  }, []);
  const norm = (t: string) => t.replace(/^[^\w]+/, "").trim().toLowerCase();
  const shown = vibe
    ? squads.filter(s => (s.tags ?? []).some(t => norm(t) === vibe.toLowerCase()))
    : squads;
  const hasOpenSquads = squads.length > 0;
  const hasMatchingSquads = shown.length > 0;

  const violet = "var(--violet)";
  const text = "var(--text)";
  const muted = "var(--text-muted)";

  function ensureAuthed() {
    if (session.isAuthed()) return true;
    setJoinError("Sign in to continue.");
    router.push("/signin");
    return false;
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const { squads } = await api.discoverSquads();
      setSquads(squads ?? []);
    } catch (e) {
      console.error("discoverSquads failed:", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function goToLobby(squadId: string) {
    router.push(`/lobby?squad=${squadId}`);
  }

  async function handleRandom() {
    setJoinError(null);
    if (!ensureAuthed()) return;
    setRandomLoading(true);
    try {
      const squad = await api.joinRandomSquad();
      goToLobby(squad.squadId);
    } catch (e: any) {
      // Being in other squads is no longer a blocker — only real failures land here.
      console.error("joinRandomSquad failed:", e);
      setJoinError(e?.message || "Couldn't find a squad right now. Try again.");
      setRandomLoading(false);
    }
  }

  // Two-step join: the card opens a preview; the preview performs the actual
  // join/request and reports back here.
  function handlePreview(squad: PublicSquad) {
    setJoinError(null);
    setRequestNotice(null);
    setPreviewSquad(squad);
  }

  function handleJoined(squadId: string | null, requested: boolean) {
    setPreviewSquad(null);
    if (requested || !squadId) {
      setRequestNotice("Request sent — the leader will review it.");
      return;
    }
    goToLobby(squadId);
  }

  function selectVibe(next: string | null) {
    setVibe(next);
    try {
      const params = new URLSearchParams(window.location.search);
      if (next) params.set("vibe", next);
      else params.delete("vibe");
      const query = params.toString();
      window.history.replaceState(null, "", query ? `/discover?${query}` : "/discover");
    } catch {}
  }

  function handleHeaderAction() {
    if (vibe && shown.length) {
      handlePreview(shown[Math.floor(Math.random() * shown.length)]);
      return;
    }
    void handleRandom();
  }

  async function handleCreate() {
    setJoinError(null);
    if (!ensureAuthed()) return;
    setCreating(true);
    try {
      const squad = await api.createSquad({ squadName: randomSquadName(), tags: vibe ? [vibe] : [], visibility: "open" });
      goToLobby(squad.squadId);
    } catch (e: any) {
      console.error("createSquad failed:", e);
      setJoinError(e?.message || "Couldn't create a squad. Try again.");
      setCreating(false);
    }
  }

  const gridCols = isPhone ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))";

  return (
    <div className="gg-reveal" style={{ display: "flex", flexDirection: "column", gap: 24, paddingBottom: 40 }}>
      {/* Header — cards own the page; the header carries only a light secondary
          action (join a random open squad) when there's live inventory. */}
      <PageHeader
        title="Discover squads"
        subtitle="Find a crew that matches your mood. Preview before joining."
        right={hasMatchingSquads ? (
          <button
            onClick={handleHeaderAction}
            disabled={randomLoading}
            onMouseEnter={() => setCtaHover(true)}
            onMouseLeave={() => setCtaHover(false)}
            className="gg-press"
            style={{
              height: 44, padding: "0 16px", borderRadius: 10, border: "1px solid var(--border-strong)", cursor: randomLoading ? "wait" : "pointer",
              background: ctaHover ? "var(--overlay-hover)" : "transparent", color: "var(--text)",
              fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 14,
              opacity: randomLoading ? 0.75 : 1,
              display: "inline-flex", alignItems: "center", gap: 8,
            }}
          >
            {randomLoading ? (<><span className="gg-spinner" /> Finding…</>) : (<><Icon.lightning size={15} color="var(--violet)" /> {vibe ? "Preview match" : "Join random"}</>)}
          </button>
        ) : undefined}
      />

      {/* Inline join/create error */}
      {joinError && (
        <div role="alert" className="gg-toast" style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "color-mix(in srgb, var(--coral) 12%, var(--surface))",
          border: "1px solid color-mix(in srgb, var(--coral) 45%, transparent)",
          borderRadius: 12, padding: "10px 14px",
          fontSize: 13, fontWeight: 600, color: "var(--coral)",
        }}>
          <Icon.flag size={14} color="var(--coral)" />
          <span style={{ flex: 1 }}>{joinError}</span>
          <button
            onClick={() => setJoinError(null)}
            aria-label="Dismiss"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--coral)", padding: 0, display: "flex" }}
          >
            <Icon.close size={14} color="var(--coral)" />
          </button>
        </div>
      )}

      {/* Request-sent toast (request-policy squads) */}
      {requestNotice && (
        <div role="status" className="gg-toast" style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "color-mix(in srgb, var(--lime) 12%, var(--surface))",
          border: "1px solid color-mix(in srgb, var(--lime) 45%, transparent)",
          borderRadius: 12, padding: "10px 14px",
          fontSize: 13, fontWeight: 600, color: "var(--text)",
        }}>
          <Icon.send size={14} color="var(--lime)" />
          <span style={{ flex: 1 }}>{requestNotice}</span>
          <button
            onClick={() => setRequestNotice(null)}
            aria-label="Dismiss"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0, display: "flex" }}
          >
            <Icon.close size={14} color="var(--text-muted)" />
          </button>
        </div>
      )}

      {/* Visible filters keep the discovery model understandable without a deep link. */}
      <div style={{ display: "flex", alignItems: isPhone ? "stretch" : "center", justifyContent: "space-between", flexDirection: isPhone ? "column" : "row", gap: 12 }}>
        <div aria-label="Filter squads by vibe" style={{ display: "flex", gap: 8, overflowX: isPhone ? "auto" : "visible", flexWrap: isPhone ? "nowrap" : "wrap", paddingBottom: isPhone ? 4 : 0, scrollbarWidth: "none" }}>
          {["All", ...VIBES].map(option => {
            const selected = option === "All" ? !vibe : vibe?.toLowerCase() === option.toLowerCase();
            return (
              <button
                key={option}
                type="button"
                aria-pressed={selected}
                onClick={() => selectVibe(option === "All" ? null : option)}
                className="gg-press"
                style={{
                  flexShrink: 0, minHeight: 40, padding: "0 14px", borderRadius: 10,
                  border: selected ? "1px solid var(--violet)" : "1px solid var(--border)",
                  background: selected ? "var(--violet-soft)" : "transparent",
                  color: selected ? "var(--text)" : "var(--text-muted)", cursor: "pointer",
                  fontFamily: "var(--font-inter)", fontSize: 13, fontWeight: selected ? 700 : 600,
                }}
              >
                {option}
              </button>
            );
          })}
        </div>
        {!loading && !error && (
          <span style={{ color: "var(--text-dim)", fontSize: 13, fontWeight: 600 }}>
            {shown.length} {shown.length === 1 ? "squad" : "squads"}
          </span>
        )}
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 16 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{
              borderRadius: 20, overflow: "hidden",
              border: "1px solid var(--border)",
              background: "linear-gradient(180deg, var(--surface-grad-from) 0%, var(--surface-grad-to) 100%)",
            }}>
              <Shimmer style={{ height: 132 }} />
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <Shimmer style={{ height: 18, width: "60%", borderRadius: 6 }} />
                <Shimmer style={{ height: 12, width: "40%", borderRadius: 6 }} />
                <Shimmer style={{ height: 40, borderRadius: 999, marginTop: 4 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error fallback */}
      {!loading && error && (
        <div style={{
          borderRadius: 20, border: "1px solid var(--border)",
          background: "var(--surface)", padding: "40px 24px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center",
        }}>
          <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 17, fontWeight: 700, color: text }}>
            Couldn&apos;t load squads
          </div>
          <div style={{ color: muted, fontSize: 14, maxWidth: 360 }}>
            Something went wrong reaching the squad list. Give it another try.
          </div>
          <button
            onClick={load}
            onMouseEnter={() => setRetryHover(true)}
            onMouseLeave={() => setRetryHover(false)}
            className="gg-press"
            style={{
              marginTop: 4, height: 42, padding: "0 24px", borderRadius: 999, border: "none", cursor: "pointer",
              background: retryHover ? "var(--violet-bright)" : violet,
              color: "var(--on-accent)", fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 14,
              transform: retryHover ? "translateY(-1px)" : "translateY(0)",
              transition: "transform .14s ease, box-shadow .2s var(--ease-ui), background .2s var(--ease-ui)",
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty inventory is the page state, not a small card floating in it. */}
      {!loading && !error && shown.length === 0 && (
        <section style={{ minHeight: isPhone ? 420 : "calc(100dvh - 310px)", display: "grid", placeItems: "center", textAlign: "center", padding: isPhone ? "34px 8px 54px" : "52px 24px", boxSizing: "border-box", borderTop: "1px solid var(--border)" }}>
          <div style={{ width: "100%", maxWidth: isTablet ? 560 : 620 }}>
            <span style={{ display: "grid", placeItems: "center", width: 42, height: 42, margin: "0 auto 18px", borderRadius: 12, border: "1px solid var(--border-strong)", color: "var(--violet)" }}>
              <Icon.discover size={19} color="var(--violet)" />
            </span>
            <h2 style={{ margin: 0, color: text, fontFamily: "var(--font-space-grotesk)", fontSize: isPhone ? 28 : 36, lineHeight: 1.08, fontWeight: 800 }}>
              {vibe ? `No ${vibe} squads live.` : "Be the first signal."}
            </h2>
            <p style={{ margin: "12px auto 24px", maxWidth: 480, color: muted, fontSize: isPhone ? 14 : 15, lineHeight: 1.6 }}>
              {vibe
                ? (hasOpenSquads ? "Start one with this vibe, or explore every squad currently open." : "Start one with this vibe and invite people who match your energy.")
                : "Open a room people can discover, invite your crew, and set the vibe for whoever joins next."}
            </p>
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button onClick={handleCreate} disabled={creating} className="gg-press" style={{ minHeight: 46, padding: "0 20px", border: "none", borderRadius: 11, background: violet, color: "var(--on-accent)", cursor: creating ? "wait" : "pointer", fontFamily: "var(--font-inter)", fontSize: 14, fontWeight: 750, boxShadow: "0 10px 28px -16px var(--violet)", opacity: creating ? 0.78 : 1 }}>
                {creating ? "Opening squad…" : (vibe ? `Start an open ${vibe} squad` : "Start an open squad")}
              </button>
              {vibe && hasOpenSquads && (
                <button onClick={() => selectVibe(null)} className="gg-press" style={{ minHeight: 44, padding: "0 12px", border: "none", background: "transparent", color: "var(--text-body)", cursor: "pointer", fontSize: 13.5, fontWeight: 650 }}>
                  Explore all squads
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Squad grid */}
      {!loading && !error && shown.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 16 }}>
          {shown.map(squad => (
            <SquadCard
              key={squad.squadId}
              squad={squad}
              onPreview={handlePreview}
            />
          ))}
        </div>
      )}

      {/* Two-step join preview modal */}
      {previewSquad && (
        <SquadPreview
          squad={previewSquad}
          onClose={() => setPreviewSquad(null)}
          onJoined={handleJoined}
        />
      )}

      <style>{`@keyframes squad-shimmer { 0% { background-position: -400px 0; } 100% { background-position: 400px 0; } }`}</style>
    </div>
  );
}

function Shimmer({ style }: { style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "linear-gradient(90deg, var(--overlay) 0px, var(--overlay-hover) 200px, var(--overlay) 400px)",
      backgroundSize: "800px 100%",
      animation: "squad-shimmer 1.4s ease-in-out infinite",
      ...style,
    }} />
  );
}
