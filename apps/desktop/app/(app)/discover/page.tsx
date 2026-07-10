"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { SquadCard } from "@/components/SquadCard";
import { SquadPreview } from "@/components/SquadPreview";
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
  const primaryCtaCreates = vibe ? !hasMatchingSquads : !hasOpenSquads;

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

  function handlePrimaryCta() {
    if (primaryCtaCreates) { void handleCreate(); return; }
    if (vibe && shown[0]) { handlePreview(shown[0]); return; }
    void handleRandom();
  }

  const gridCols = isPhone ? "1fr" : "repeat(auto-fill, minmax(280px, 1fr))";

  return (
    <div className="gg-reveal" style={{ display: "flex", flexDirection: "column", gap: 24, paddingBottom: 40 }}>
      {/* Header */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Icon.discover size={24} color={violet} />
          <h1 style={{ fontFamily: "var(--font-space-grotesk)", fontSize: isPhone ? 26 : 28, fontWeight: 800, color: text, margin: 0, letterSpacing: "-0.02em" }}>Discover</h1>
        </div>
        <div style={{ color: muted, fontSize: 14, fontFamily: "var(--font-inter)" }}>
          Browse open squads looking for members right now.
        </div>
      </div>

      {/* ── PRIMARY CTA — create or join based on live inventory ───── */}
      <div style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 22,
        padding: isPhone ? "22px 20px" : "28px 32px",
        background: "linear-gradient(135deg, rgba(124,92,255,0.16) 0%, var(--surface-grad-to) 55%, rgba(194,255,61,0.08) 100%)",
        border: "1px solid var(--violet-soft)",
        boxShadow: "0 0 70px -24px rgba(124,92,255,0.4)",
        display: "flex",
        flexDirection: isPhone ? "column" : "row",
        alignItems: isPhone ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: isPhone ? 18 : 24,
      }}>
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Icon.lightning size={15} color={violet} />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: violet }}>
              {primaryCtaCreates ? "Start the signal" : "Live inventory"}
            </span>
          </div>
          <h2 style={{ margin: "0 0 6px", fontFamily: "var(--font-space-grotesk)", fontWeight: 800, fontSize: isPhone ? 22 : 26, color: text, letterSpacing: "-0.02em" }}>
            {primaryCtaCreates ? (vibe ? `Create a ${vibe} squad` : "Create the first open squad") : (vibe ? `Join a ${vibe} squad` : "Join a live open squad")}
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: muted, lineHeight: 1.5, maxWidth: 440 }}>
            {primaryCtaCreates
              ? (vibe ? "No matching open room is available right now. Start one with this vibe and let people join you." : "No open rooms are available right now. Start one, set a vibe, and let people join you.")
              : (vibe ? "Preview a matching open room, or browse the filtered signals below." : "Drop into an open room instantly, or browse the signals below.")}
          </p>
        </div>
        <button
          onClick={handlePrimaryCta}
          disabled={primaryCtaCreates ? creating : randomLoading}
          onMouseEnter={() => setCtaHover(true)}
          onMouseLeave={() => setCtaHover(false)}
          className="gg-press"
          style={{
            position: "relative",
            flexShrink: 0,
            width: isPhone ? "100%" : undefined,
            height: 50,
            padding: "0 32px",
            borderRadius: 999,
            border: "none",
            cursor: (primaryCtaCreates ? creating : randomLoading) ? "wait" : "pointer",
            background: ctaHover ? "var(--violet-bright)" : violet,
            color: "var(--on-accent)",
            fontFamily: "var(--font-space-grotesk)",
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: "-0.01em",
            boxShadow: ctaHover ? "0 0 40px -6px rgba(124,92,255,0.95)" : "0 0 28px -8px rgba(124,92,255,0.8)",
            transform: ctaHover && !randomLoading ? "translateY(-1px)" : "translateY(0)",
            transition: "transform .14s ease, box-shadow .2s var(--ease-ui), background .2s var(--ease-ui)",
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
            opacity: (primaryCtaCreates ? creating : randomLoading) ? 0.85 : 1,
          }}
        >
          {primaryCtaCreates
            ? (creating ? (<><span className="gg-spinner" /> Creating...</>) : (<><Icon.plus size={16} color="var(--on-accent)" /> Create squad</>))
            : (randomLoading ? (<><span className="gg-spinner" /> Finding a squad...</>) : (<><Icon.lightning size={16} color="var(--on-accent)" /> {vibe ? "Preview match" : "Join random squad"}</>))}
        </button>
      </div>

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

      {/* ── OPEN SQUADS ───────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
          <Icon.trend size={18} color="var(--lime)" />
          <h2 style={{ margin: 0, fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 18, color: text, letterSpacing: "-0.01em" }}>
            {vibe ? "Open squads" : "Open squads"}
          </h2>
          {vibe && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, background: "var(--violet-soft)", border: "1px solid rgba(124,92,255,0.3)", color: "var(--violet)", borderRadius: 999, padding: "4px 8px 4px 12px", fontSize: 13, fontWeight: 700 }}>
              {vibe}
              <button
                onClick={() => { setVibe(null); try { window.history.replaceState(null, "", "/discover"); } catch {} }}
                aria-label="Clear vibe filter"
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--violet)", padding: 0, display: "flex" }}
              >
                <Icon.close size={13} color="var(--violet)" />
              </button>
            </span>
          )}
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

      {/* Empty state */}
      {!loading && !error && shown.length === 0 && (
        <div style={{
          borderRadius: 20, border: "1px dashed var(--border-strong)",
          background: "var(--surface)", padding: "48px 24px",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 16, textAlign: "center",
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16, background: "var(--violet-soft)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon.discover size={26} color={violet} />
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 18, fontWeight: 700, color: text, marginBottom: 4 }}>
              {vibe ? `No open “${vibe}” squads right now` : "No open squads right now"}
            </div>
            <div style={{ color: muted, fontSize: 14, maxWidth: 380 }}>
              {vibe ? "Start one with this vibe, or clear the filter to browse other live signals." : "Start the first open room and make your squad discoverable."}
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="gg-press"
              style={{
                height: 44, padding: "0 24px", borderRadius: 999, border: "none",
                cursor: creating ? "wait" : "pointer",
                background: violet, color: "var(--on-accent)",
                fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 14,
                boxShadow: "0 0 24px -8px rgba(124,92,255,0.8)",
                opacity: creating ? 0.85 : 1,
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              {creating ? <span className="gg-spinner" /> : <Icon.plus size={15} color="var(--on-accent)" />}
              {creating ? "Creating…" : "Create a squad"}
            </button>
            {hasOpenSquads && !vibe && (
              <button
                onClick={handleRandom}
                disabled={randomLoading}
                className="gg-press"
                style={{
                  height: 44, padding: "0 24px", borderRadius: 999,
                  border: "1px solid var(--border-strong)", cursor: randomLoading ? "wait" : "pointer",
                  background: "transparent", color: text,
                  fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 14,
                  opacity: randomLoading ? 0.85 : 1,
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {randomLoading ? (<><span className="gg-spinner" /> Finding...</>) : "Join random"}
              </button>
            )}
          </div>
        </div>
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
