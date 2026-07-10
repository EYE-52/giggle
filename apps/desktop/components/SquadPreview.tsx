"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { useViewport } from "@/components/useViewport";
import { api, session, resolveCover, type PublicSquad, type SquadState, type SquadMemberState } from "@giggle/core";

// Deterministic tasteful gradient fallback — same palette as SquadCard so the
// preview banner reads as the same visual system as the card it opened from.
const GRADIENTS = [
  "radial-gradient(120% 90% at 20% 10%, rgba(255,92,138,0.55), transparent 55%), radial-gradient(120% 90% at 90% 80%, rgba(124,92,255,0.6), transparent 55%), linear-gradient(160deg, #2a1140, #0b0b0f)",
  "radial-gradient(120% 90% at 80% 10%, rgba(92,140,255,0.5), transparent 55%), radial-gradient(120% 90% at 10% 90%, rgba(61,214,192,0.45), transparent 55%), linear-gradient(160deg, #10243a, #0b0b0f)",
  "radial-gradient(120% 90% at 30% 20%, rgba(194,255,61,0.4), transparent 55%), radial-gradient(120% 90% at 80% 90%, rgba(124,92,255,0.55), transparent 55%), linear-gradient(160deg, #1a2a12, #0b0b0f)",
  "radial-gradient(120% 90% at 70% 15%, rgba(255,176,32,0.45), transparent 55%), radial-gradient(120% 90% at 15% 85%, rgba(255,92,138,0.5), transparent 55%), linear-gradient(160deg, #2e1a10, #0b0b0f)",
];
function gradientFor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

const STATUS_LABEL: Record<string, string> = {
  idle: "Open",
  searching: "Searching",
  matched: "Matched",
  in_encounter: "Live",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function SquadPreview({
  squad,
  onClose,
  onJoined,
}: {
  squad: PublicSquad;
  onClose: () => void;
  onJoined: (squadId: string | null, requested: boolean) => void;
}) {
  const router = useRouter();
  const { isPhone } = useViewport();
  const [detail, setDetail] = useState<SquadState | null>(null);
  const [joining, setJoining] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [closeHover, setCloseHover] = useState(false);
  const [btnHover, setBtnHover] = useState(false);

  // Fetch full detail (tags + members + joinPolicy). Fall back to the PublicSquad
  // fields while loading.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Public preview endpoint — works even though we're not a member yet.
        setDetailError(null);
        const d = await api.getSquadPreview(squad.squadId);
        if (alive) setDetail(d);
      } catch (e) {
        console.error("getSquadPreview failed:", e);
        if (alive) setDetailError("Couldn't load live squad details.");
      }
    })();
    return () => { alive = false; };
  }, [squad.squadId]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Merge live detail over the card-level snapshot.
  const tags = detail?.tags ?? squad.tags ?? [];
  const members: SquadMemberState[] = detail?.members ?? [];
  const joinPolicy = detail?.joinPolicy ?? squad.joinPolicy ?? "open";
  const isRequest = joinPolicy === "request";
  const memberCount = members.length || squad.memberCount;
  const maxSlots = detail?.maxSlots ?? squad.maxSlots;
  const statusRaw = detail?.status ?? squad.status;
  const statusLabel = STATUS_LABEL[statusRaw] ?? statusRaw;
  const isLive = statusRaw === "in_encounter";
  const leaderName = squad.leaderName ?? members.find(m => m.role === "leader")?.displayName;
  const isFull = memberCount >= maxSlots;

  const hasCover = !!squad.coverImage;
  // Single CSS `background` value for the cover — real cover when set, else a
  // deterministic per-squad gradient so every card still has a distinct theme.
  // (resolveCover returns a full `background` shorthand, incl. gradients, so we
  // apply it directly rather than wrapping it in url().)
  const coverBg = hasCover
    ? resolveCover(squad.coverImage)
    : gradientFor(squad.squadId || squad.squadName);

  const handleJoin = useCallback(async () => {
    setError(null);
    if (!session.isAuthed()) {
      setError("Sign in to continue.");
      router.push("/signin");
      return;
    }
    setJoining(true);
    try {
      const res = await api.joinSquadById(squad.squadId);
      if (res && "status" in res && res.status === "requested") {
        setRequested(true);
        onJoined(null, true);
        return;
      }
      onJoined((res as SquadState).squadId, false);
    } catch (e: unknown) {
      console.error("joinSquad failed:", e);
      const code = (e as { code?: string })?.code;
      if (code === "SQUAD_FULL" || code === "SQUAD_FULL_UPGRADE") {
        setError(`${squad.squadName} is full — try another squad.`);
      } else {
        setError((e as { message?: string })?.message || "Couldn't join that squad. Try again.");
      }
      setJoining(false);
    }
  }, [squad, onJoined, router]);

  const text = "var(--text)";
  const muted = "var(--text-muted)";

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${squad.squadName} preview`}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: isPhone ? "flex-end" : "center", justifyContent: "center",
        padding: isPhone ? 0 : 24,
        background: "rgba(7,7,11,0.66)", backdropFilter: "blur(6px)",
        animation: "sp-fade .22s var(--ease-entrance)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          position: "relative",
          width: "100%", maxWidth: 560, maxHeight: isPhone ? "92vh" : "88vh",
          display: "flex", flexDirection: "column",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: isPhone ? "22px 22px 0 0" : 22,
          overflow: "hidden",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
          animation: isPhone ? "sp-slide .26s var(--ease-entrance)" : "sp-pop .22s var(--ease-entrance)",
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Close"
          onMouseEnter={() => setCloseHover(true)}
          onMouseLeave={() => setCloseHover(false)}
          className="gg-press"
          style={{
            position: "absolute", top: 12, right: 12, zIndex: 3,
            width: 40, height: 40, borderRadius: 999, border: "none", cursor: "pointer",
            background: closeHover ? "rgba(11,11,15,0.85)" : "rgba(11,11,15,0.55)",
            backdropFilter: "blur(6px)",
            transform: closeHover ? "translateY(-1px)" : "translateY(0)",
            transition: "transform .14s ease, background .2s var(--ease-ui)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Icon.close size={16} color="#E7E7F0" />
        </button>

        {/* ── Banner header — the squad's cover, big + themed ──────── */}
        <div style={{
          position: "relative", height: 208, flexShrink: 0,
          background: "#0b0b0f",
        }}>
          <div style={{
            position: "absolute", inset: 0,
            background: coverBg,
            backgroundSize: "cover", backgroundPosition: "center",
          }} />
          {/* Richer scrim: melts into the surface at the bottom for the name, with
              a gentle top darkening so the status pill + close button stay legible. */}
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, var(--surface) 1%, rgba(7,7,11,0.78) 34%, rgba(7,7,11,0.28) 66%, rgba(7,7,11,0.42) 100%)" }} />

          {/* Status pill */}
          <div style={{
            position: "absolute", top: 12, left: 12,
            display: "inline-flex", alignItems: "center", gap: 5,
            padding: "4px 9px", borderRadius: 999,
            background: "rgba(11,11,15,0.6)",
            border: isLive ? "1px solid rgba(194,255,61,0.5)" : "1px solid rgba(255,255,255,0.18)",
            backdropFilter: "blur(6px)",
          }}>
            {isLive && <span style={{ width: 6, height: 6, borderRadius: 999, background: "#C2FF3D", boxShadow: "0 0 8px #C2FF3D" }} />}
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", color: isLive ? "#C2FF3D" : "#E7E7F0", textTransform: "uppercase" }}>{statusLabel}</span>
          </div>

          {/* Name + leader + member count */}
          <div style={{ position: "absolute", left: 20, right: 20, bottom: 14, display: "flex", alignItems: "flex-end", gap: 12 }}>
            {/* Cover thumbnail chip — reinforces the squad's theme next to its name */}
            <div style={{
              flexShrink: 0, width: 52, height: 52, borderRadius: 14,
              background: coverBg, backgroundSize: "cover", backgroundPosition: "center",
              border: "2px solid rgba(255,255,255,0.16)",
              boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
            }} />
            <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 800, fontSize: 24, color: "#F4F4F7", letterSpacing: "-0.02em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {squad.squadName}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
              <span style={{ fontSize: 13, color: "#C9C9DA" }}>
                {leaderName ? `Led by ${leaderName}` : "Open squad"}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, color: "#C9C9DA", fontWeight: 600 }}>
                <Icon.account size={13} color="#C9C9DA" />
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{memberCount}/{maxSlots}</span>
              </span>
            </div>
            </div>
          </div>
        </div>

        {/* ── Scrollable body ─────────────────────────────────────── */}
        <div style={{ padding: isPhone ? "16px 20px" : "18px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Join-policy badge */}
          {detailError && (
            <div role="alert" className="gg-toast" style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "9px 12px", borderRadius: 12,
              background: "color-mix(in srgb, var(--coral) 12%, var(--surface))",
              border: "1px solid color-mix(in srgb, var(--coral) 38%, transparent)",
              color: "var(--coral)",
              fontSize: 13, fontWeight: 700,
            }}>
              <Icon.flag size={14} color="var(--coral)" />
              <span>{detailError}</span>
            </div>
          )}

          {/* Join-policy badge */}
          <div style={{
            display: "inline-flex", alignSelf: "flex-start", alignItems: "center", gap: 7,
            padding: "5px 12px", borderRadius: 999,
            background: isRequest ? "color-mix(in srgb, var(--amber, #FFB020) 14%, var(--surface))" : "var(--violet-soft)",
            border: isRequest ? "1px solid color-mix(in srgb, var(--amber, #FFB020) 40%, transparent)" : "1px solid rgba(124,92,255,0.3)",
            color: isRequest ? "var(--amber, #FFB020)" : "var(--violet)",
            fontSize: 12.5, fontWeight: 700,
          }}>
            <Icon.shield size={13} color={isRequest ? "var(--amber, #FFB020)" : "var(--violet)"} />
            {isRequest ? "Request to join · leader approves" : "Open · instant"}
          </div>

          {/* Themes / vibes */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
              <Icon.trend size={15} color="var(--lime)" />
              <span style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 14, color: text }}>Vibes</span>
            </div>
            {tags.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {tags.map(tag => (
                  <span key={tag} style={{
                    fontSize: 12.5, fontWeight: 600, color: text,
                    background: "var(--overlay)", border: "1px solid var(--border)",
                    borderRadius: 999, padding: "5px 12px",
                  }}>{tag}</span>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: muted }}>This squad hasn&apos;t set vibes yet.</div>
            )}
          </div>

          {/* Members */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
              <Icon.users size={15} color="var(--violet)" />
              <span style={{ fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 14, color: text }}>
                Members {members.length > 0 && <span style={{ color: muted, fontWeight: 600 }}>· {members.length}</span>}
              </span>
            </div>
            {members.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr" : "1fr 1fr", gap: 10 }}>
                {members.map(m => {
                  const badges: string[] = [];
                  if (m.age) badges.push(String(m.age));
                  if (m.country) badges.push(m.country);
                  if (m.languages && m.languages.length) badges.push(...m.languages.slice(0, 2));
                  return (
                    <div key={m.memberId} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "8px 10px", borderRadius: 12,
                      background: "var(--overlay)", border: "1px solid var(--border)",
                    }}>
                      <div style={{
                        flexShrink: 0, width: 36, height: 36, borderRadius: 999,
                        background: "var(--violet-soft)", color: "var(--violet)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontFamily: "var(--font-space-grotesk)", fontWeight: 800, fontSize: 13,
                      }}>{initials(m.displayName)}</div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.displayName}</span>
                          {m.role === "leader" && <Icon.star size={12} color="var(--lime)" />}
                        </div>
                        {badges.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 3 }}>
                            {badges.map((b, i) => (
                              <span key={i} style={{ fontSize: 10.5, fontWeight: 600, color: muted, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 7px" }}>{b}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 13, color: muted }}>
                {detailError ? "Couldn't load live roster." : "Roster details unavailable."}
              </div>
            )}
          </div>
        </div>

        {/* ── Footer action ───────────────────────────────────────── */}
        <div style={{ padding: isPhone ? "12px 20px 18px" : "14px 24px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          {requested ? (
            <div className="gg-toast" style={{
              display: "flex", alignItems: "center", gap: 10,
              background: "color-mix(in srgb, var(--lime) 14%, var(--surface))",
              border: "1px solid color-mix(in srgb, var(--lime) 45%, transparent)",
              borderRadius: 12, padding: "12px 14px",
              fontSize: 13.5, fontWeight: 600, color: text,
            }}>
              <Icon.send size={15} color="var(--lime)" />
              <span>Request sent — the leader will review it.</span>
            </div>
          ) : (
            <>
              {error && (
                <div role="alert" className="gg-toast" style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
                  fontSize: 13, fontWeight: 600, color: "var(--coral)",
                }}>
                  <Icon.flag size={14} color="var(--coral)" />
                  <span>{error}</span>
                </div>
              )}
              <button
                onClick={handleJoin}
                disabled={joining || isFull}
                onMouseEnter={() => setBtnHover(true)}
                onMouseLeave={() => setBtnHover(false)}
                className="gg-press"
                style={{
                  width: "100%", height: 50, borderRadius: 999, border: "none",
                  cursor: joining || isFull ? "not-allowed" : "pointer",
                  background: isFull ? "var(--overlay)" : (btnHover ? "var(--violet-bright)" : "var(--violet)"),
                  color: isFull ? "var(--text-muted)" : "var(--on-accent)",
                  fontFamily: "var(--font-space-grotesk)", fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em",
                  boxShadow: isFull ? "none" : (btnHover ? "0 0 36px -8px rgba(124,92,255,0.95)" : "0 0 24px -10px rgba(124,92,255,0.8)"),
                  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transform: !isFull && !joining && btnHover ? "translateY(-1px)" : "translateY(0)",
                  transition: "transform .14s ease, box-shadow .2s var(--ease-ui), background .2s var(--ease-ui)",
                  opacity: joining ? 0.85 : 1,
                }}
              >
                {isFull
                  ? "Squad full"
                  : joining
                    ? (<><span className="gg-spinner" /> {isRequest ? "Sending request…" : "Joining…"}</>)
                    : (<><Icon.enter size={16} color="var(--on-accent)" /> {isRequest ? "Request to join" : "Join squad"}</>)}
              </button>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes sp-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes sp-pop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
        @keyframes sp-slide { from { transform: translateY(100%); } to { transform: translateY(0); } }
      `}</style>
    </div>
  );
}
