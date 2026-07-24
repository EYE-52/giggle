"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { SquadCard } from "@/components/SquadCard";
import { SquadPreview } from "@/components/SquadPreview";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Chip } from "@/components/Chip";
import { Button } from "@/components/Button";
import { useViewport } from "@/components/useViewport";
import { api, session, randomSquadName, type PublicSquad } from "@giggle/core";

export default function DiscoverPage() {
  const router = useRouter();
  const { isPhone } = useViewport();

  const [squads, setSquads] = useState<PublicSquad[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [randomLoading, setRandomLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [previewSquad, setPreviewSquad] = useState<PublicSquad | null>(null);
  const [requestNotice, setRequestNotice] = useState<string | null>(null);

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

  // In-page vibe filter chips, derived from the loaded squads' vibes (top 8 by
  // count). Clicking one applies the same filter as the ?vibe= deep link.
  const vibeChips = (() => {
    const counts = new Map<string, { label: string; n: number }>();
    for (const s of squads) {
      for (const t of s.tags ?? []) {
        const key = norm(t);
        if (!key) continue;
        const cur = counts.get(key);
        if (cur) cur.n += 1;
        else counts.set(key, { label: t, n: 1 });
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([key, v]) => ({ key, label: v.label }));
  })();

  function applyVibe(next: string | null) {
    setVibe(next);
    router.replace(next ? `/discover?vibe=${encodeURIComponent(next)}` : "/discover");
  }

  const violet = "var(--accent, var(--violet))";
  const text = "var(--text)";
  const muted = "var(--text-muted)";
  const radiusCard = "var(--radius-card, 20px)";
  const radiusControl = "var(--radius-control, 14px)";
  const fontDisplay = "var(--font-display, var(--font-space-grotesk))";

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
    } catch {
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

  async function handleCreate() {
    setJoinError(null);
    if (!ensureAuthed()) return;
    setCreating(true);
    try {
      const squad = await api.createSquad({ squadName: randomSquadName(), tags: vibe ? [vibe] : [] });
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
        right={loading || hasOpenSquads ? (
          <Button variant="tonal" onClick={handleRandom} disabled={loading} loading={randomLoading}>
            {randomLoading ? "Finding…" : (<><Icon.lightning size={15} color={violet} /> Surprise me</>)}
          </Button>
        ) : undefined}
      />

      {/* Inline join/create error */}
      {joinError && (
        <div role="alert" className="gg-toast" style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--coral-soft)",
          border: "1px solid color-mix(in srgb, var(--coral) 45%, transparent)",
          borderRadius: radiusControl, padding: "10px 14px",
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
          background: "var(--live-soft)",
          border: "1px solid color-mix(in srgb, var(--live, var(--lime)) 45%, transparent)",
          borderRadius: radiusControl, padding: "10px 14px",
          fontSize: 13, fontWeight: 600, color: "var(--text)",
        }}>
          <Icon.send size={14} color="var(--live, var(--lime))" />
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

      {/* Vibe filter chips + result count */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 8 }}>
        <div role="group" aria-label="Filter by vibe" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const, minWidth: 0 }}>
          {vibeChips.length > 0 && (
            <>
              <Chip onClick={() => applyVibe(null)} selected={!vibe}>All</Chip>
              {vibeChips.map(({ key, label }) => (
                <Chip key={key} onClick={() => applyVibe(vibe === key ? null : key)} selected={vibe === key}>
                  {label}
                </Chip>
              ))}
              {/* Deep-linked vibe with no matching chip still shows as selected */}
              {vibe && !vibeChips.some(c => c.key === vibe.toLowerCase()) && (
                <Chip onClick={() => applyVibe(null)} selected>
                  {vibe}
                </Chip>
              )}
            </>
          )}
        </div>
        {/* Kept mounted during load (shimmer) to avoid layout shift. */}
        {loading ? (
          <span className="gg-shimmer" aria-hidden="true" style={{ width: 76, height: 16, borderRadius: 6 }} />
        ) : !error && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text-dim)", fontSize: 13, fontWeight: 600 }}>
            {vibe
              ? `Showing ${shown.length} of ${squads.length} ${squads.length === 1 ? "squad" : "squads"}`
              : `${shown.length} ${shown.length === 1 ? "squad" : "squads"}`}
            {vibe && shown.length === 0 && (
              <button
                onClick={() => applyVibe(null)}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--accent)", fontSize: 13, fontWeight: 700 }}
              >
                — clear filter
              </button>
            )}
          </span>
        )}
      </div>

      {/* Loading skeletons */}
      {loading && (
        <div style={{ display: "grid", gridTemplateColumns: gridCols, gap: 16 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{
              borderRadius: radiusCard, overflow: "hidden",
              border: "var(--control-border, 1px solid var(--border))",
              background: "linear-gradient(180deg, var(--surface-grad-from) 0%, var(--surface-grad-to) 100%)",
            }}>
              <div className="gg-shimmer" style={{ height: 132 }} />
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="gg-shimmer" style={{ height: 18, width: "60%", borderRadius: 6 }} />
                <div className="gg-shimmer" style={{ height: 12, width: "40%", borderRadius: 6 }} />
                <div className="gg-shimmer" style={{ height: 40, borderRadius: 999, marginTop: 4 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error fallback */}
      {!loading && error && (
        <div style={{
          borderRadius: radiusCard, border: "var(--control-border, 1px solid var(--border))",
          background: "var(--surface)", padding: "40px 24px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center",
        }}>
          <div style={{ fontFamily: fontDisplay, fontSize: 17, fontWeight: 700, color: text }}>
            Couldn&apos;t load squads
          </div>
          <div style={{ color: muted, fontSize: 14, maxWidth: 360 }}>
            Something went wrong reaching the squad list. Give it another try.
          </div>
          <Button variant="secondary" onClick={load} style={{ marginTop: 4 }}>
            Retry
          </Button>
        </div>
      )}

      {/* Empty state — compact, one primary action, context-sensitive to the
          vibe filter. No page-dominating dashed box. */}
      {!loading && !error && shown.length === 0 && (
        <EmptyState
          compact={!isPhone}
          icon={<Icon.discover size={20} color="var(--text-dim)" />}
          title={vibe ? `No open “${vibe}” squads right now` : "No open squads right now"}
          body={vibe ? "Start one with this vibe, or clear the filter to browse other live signals." : "Start the first open room and make your squad discoverable."}
          primary={{ label: creating ? "Creating…" : (vibe ? `Create a ${vibe} squad` : "Create a squad"), onClick: handleCreate, disabled: creating }}
          secondary={vibe ? { label: "Clear filter", onClick: () => applyVibe(null) } : undefined}
        />
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
    </div>
  );
}
