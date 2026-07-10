"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { Wordmark } from "@/components/Brand";
import { ReferralCard } from "@/components/ReferralCard";
import { useViewport } from "@/components/useViewport";
import {
  billing,
  getTokenBalance,
  TOKEN_PERKS,
  PRODUCTS,
  type Entitlements,
} from "@giggle/core";

// ── Token packs ordered by size ────────────────────────────────────────────
const TOKEN_PACKS = [
  PRODUCTS.tokens_starter,
  PRODUCTS.tokens_plus,
  PRODUCTS.tokens_pro,
  PRODUCTS.tokens_mega,
];

// ── Subscription plans ─────────────────────────────────────────────────────
const SUB_PLANS = [
  { id: "premium_monthly", label: "Monthly", price: "Planned", per: "", badge: null, note: "Launch pricing under review" },
  { id: "premium_yearly",  label: "Yearly",  price: "Planned", per: "", badge: "Preview", note: "Annual benefits preview" },
] as const;

export default function PremiumPage() {
  const router = useRouter();
  const { isPhone, isTablet } = useViewport();
  const [entitlements, setEntitlements] = useState<Entitlements>({ premium: false, boosts: {}, activePerks: {} });
  const [tokenBalance, setTokenBalance] = useState(0);
  const [plan, setPlan] = useState<"monthly" | "yearly">("monthly");

  // Button hover states
  const [backHover, setBackHover] = useState(false);
  const [packHover, setPackHover] = useState<string | null>(null);
  const [perkHover, setPerkHover] = useState<string | null>(null);
  const [planTabHover, setPlanTabHover] = useState<string | null>(null);
  const [spendLoading, setSpendLoading] = useState<string | null>(null);

  const sync = useCallback(() => {
    setEntitlements(billing.getEntitlements());
    setTokenBalance(getTokenBalance());
  }, []);

  useEffect(() => {
    sync();
    const unsub = billing.subscribe(() => sync());
    return unsub;
  }, [sync]);

  const violet = "var(--violet)";
  const lime = "var(--lime)";
  const text = "var(--text)";
  const muted = "var(--text-muted)";
  const dim = "var(--text-dim)";
  const surface = "var(--surface)";
  const border = "var(--border)";
  const overlay = "var(--overlay)";
  const canRedeemPerks = billing.canRedeemTokenPerksLocally();

  // Spend a perk via tokens
  async function handleSpendPerk(perkId: string) {
    if (!canRedeemPerks) return;
    setSpendLoading(perkId);
    await new Promise(r => setTimeout(r, 480)); // short feedback delay
    let ok = false;
    if (perkId === "cover_themes") ok = billing.spendOnCoverThemes();
    else if (perkId === "vibe_pack") ok = billing.spendOnVibePack();
    if (!ok) {
      // insufficient — bounce to buy tokens
    }
    sync();
    setSpendLoading(null);
  }

  // Responsive token pack grid: 4-col desktop, 2-col tablet, 1-col phone
  const tokenPackCols = isPhone ? "1fr" : isTablet ? "repeat(2, 1fr)" : "repeat(4, 1fr)";
  // Perks grid: 2-col desktop, 1-col phone
  const perksCols = isPhone ? "1fr" : "repeat(2, 1fr)";

  return (
    <>
      <div className="gg-reveal" style={{ display: "flex", flexDirection: "column", gap: isPhone ? 20 : 24, minHeight: "calc(100vh - 120px)", paddingBottom: 32 }}>

        {/* ── BACK ──────────────────────────────────────────────────── */}
        <div>
          <button
            onClick={() => router.back()}
            onMouseEnter={() => setBackHover(true)}
            onMouseLeave={() => setBackHover(false)}
            className="gg-press"
            style={{
              background: backHover ? "var(--overlay-hover)" : overlay,
              border: backHover ? "1px solid var(--border-strong)" : `1px solid ${border}`,
              borderRadius: 999, padding: "8px 16px", minHeight: 40,
              color: backHover ? text : muted,
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 6,
              transform: backHover ? "translateY(-1px)" : "translateY(0)",
              transition: "transform .14s ease, background .2s var(--ease-ui), border-color .2s var(--ease-ui), color .2s var(--ease-ui)",
            }}
          >
            <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}>
              <Icon.chevron size={14} color={backHover ? text : muted} />
            </span>
            Back
          </button>
        </div>

        {/* ── WALLET HEADER ─────────────────────────────────────────── */}
        <div style={{
          background: "linear-gradient(135deg, var(--violet-soft) 0%, rgba(194,255,61,0.06) 100%)",
          border: `1px solid ${border}`,
          borderRadius: 24,
          padding: isPhone ? "18px 18px" : "24px 32px",
          display: "flex",
          flexDirection: isPhone ? "column" : "row",
          alignItems: isPhone ? "flex-start" : "center",
          justifyContent: "space-between",
          gap: isPhone ? 16 : 24,
          flexWrap: "wrap" as const,
        }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const }}>
              <Wordmark size={24} />
              <h1 style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 24, fontWeight: 800, color: text, letterSpacing: "-0.02em", margin: 0 }}>
                Token Wallet
              </h1>
              {entitlements.premium && (
                <span style={{
                  background: "var(--lime-soft, rgba(194,255,61,0.12))",
                  border: "1px solid var(--lime-border, rgba(194,255,61,0.3))",
                  color: "var(--lime-text)",
                  borderRadius: 999, padding: "3px 10px",
                  fontSize: 11, fontWeight: 800, letterSpacing: "0.08em",
                }}>GIGGLE+ ACTIVE</span>
              )}
            </div>
            <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 14, color: muted }}>
              Tokens power perks inside Giggle. Earn them today through referrals; paid packs are being prepared for launch.
            </div>
          </div>

          {/* Balance pill */}
          <div style={{
            display: "flex", flexDirection: "column", alignItems: isPhone ? "flex-start" : "flex-end", gap: 4,
          }}>
            <div style={{
              display: "flex", alignItems: "baseline", gap: 6,
            }}>
              <span style={{ fontFamily: "var(--font-space-grotesk)", fontSize: isPhone ? 36 : 44, fontWeight: 800, color: text, letterSpacing: "-0.03em", lineHeight: 1 }}>
                {tokenBalance.toLocaleString()}
              </span>
              <span style={{ color: muted, fontSize: 18, fontWeight: 600 }}>tokens</span>
            </div>
            <div style={{ color: dim, fontSize: 12 }}>Your balance</div>
          </div>
        </div>

        {/* ── INVITE FRIENDS (earn tokens) ──────────────────────────── */}
        <ReferralCard />

        {/* ── TOKEN STORE PREVIEW ───────────────────────────────────── */}
        <section>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" as const }}>
            <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 20, fontWeight: 800, color: text, letterSpacing: "-0.02em" }}>
              Token Store Preview
            </div>
            <span style={{
              background: `${violet}1a`, border: `1px solid ${violet}33`,
              color: violet, borderRadius: 999, padding: "3px 10px",
              fontSize: 11, fontWeight: 700,
            }}>Launch prep</span>
            <span style={{ color: muted, fontSize: 13 }}>Pack sizes are previewed here so the economy is clear before checkout goes live.</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: tokenPackCols, gap: 14 }}>
            {TOKEN_PACKS.map(pack => {
              const hovered = packHover === pack.id;
              const total = (pack.tokens ?? 0) + (pack.bonusTokens ?? 0);
              const hasBonus = (pack.bonusTokens ?? 0) > 0;
              return (
                <div
                  key={pack.id}
                  onMouseEnter={() => setPackHover(pack.id)}
                  onMouseLeave={() => setPackHover(null)}
                  style={{
                    background: surface,
                    border: hovered ? "1px solid var(--border-strong)" : `1px solid ${border}`,
                    borderRadius: 20,
                    padding: isPhone ? "18px 14px" : "24px 20px",
                    display: "flex", flexDirection: "column", gap: 16,
                    position: "relative", overflow: "hidden",
                    transition: "transform .18s var(--ease-ui), box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                    transform: hovered ? "translateY(-2px)" : "translateY(0)",
                    boxShadow: hovered ? "0 12px 32px rgba(0,0,0,0.18)" : "none",
                    cursor: "default",
                  }}
                >
                  {/* Top accent bar */}
                  <div style={{
                    position: "absolute", top: 0, left: 0, right: 0, height: 3,
                    background: `linear-gradient(90deg, ${violet}, ${lime})`,
                    borderRadius: "20px 20px 0 0",
                  }} />

                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 15, fontWeight: 700, color: text, letterSpacing: "-0.01em" }}>
                      {pack.name}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                      <span style={{ fontFamily: "var(--font-space-grotesk)", fontSize: isPhone ? 22 : 28, fontWeight: 800, color: text, letterSpacing: "-0.02em" }}>
                        {(pack.tokens ?? 0).toLocaleString()}
                      </span>
                      <span style={{ color: muted, fontSize: 13 }}>tokens</span>
                    </div>
                    {/* Bonus / placeholder row — fixed height to prevent reflow */}
                    <div style={{ minHeight: "1.5em" }}>
                      {hasBonus ? (
                        <span style={{
                          background: "var(--lime-soft, rgba(194,255,61,0.1))",
                          border: "1px solid var(--lime-border, rgba(194,255,61,0.25))",
                          color: "var(--lime-text)",
                          borderRadius: 999, padding: "2px 8px",
                          fontSize: 11, fontWeight: 700,
                          display: "inline-block",
                        }}>
                          +{pack.bonusTokens} bonus = {total.toLocaleString()} total
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "auto", flexWrap: isPhone ? "wrap" as const : "nowrap" as const, gap: 8 }}>
                    <span style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 14, fontWeight: 800, color: muted }}>
                      Planned pack
                    </span>
                    <button
                      disabled
                      style={{
                        padding: "8px 18px", borderRadius: 999, border: `1px solid ${border}`,
                        cursor: "not-allowed",
                        background: overlay,
                        color: dim,
                        fontFamily: "var(--font-space-grotesk)", fontSize: 13, fontWeight: 700,
                        transition: "all .15s ease",
                        minWidth: isPhone ? "100%" : 72,
                        minHeight: 44,
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      Preview
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── SPEND TOKENS ON PERKS ─────────────────────────────────── */}
        <section>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 20, fontWeight: 800, color: text, letterSpacing: "-0.02em" }}>
              Spend on Perks
            </div>
            <div style={{ color: muted, fontSize: 13, marginTop: 4 }}>
              {canRedeemPerks
                ? "Redeem tokens for cosmetics. Premium members will get included cosmetic unlocks when plans launch."
                : "Perk redemption is in launch prep. Tokens are tracked now; server-backed cosmetic unlocks will arrive with checkout."}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: perksCols, gap: 14 }}>
            {TOKEN_PERKS.map(perk => {
              const canAfford = entitlements.premium || tokenBalance >= perk.tokenCost;
              const hovered = perkHover === perk.id;
              const loading = spendLoading === perk.id;
              const need = perk.tokenCost - tokenBalance;
              const IconComp = (Icon as Record<string, React.ComponentType<{ size: number; color: string }>>)[perk.icon] ?? Icon.star;

              return (
                <div
                  key={perk.id}
                  onMouseEnter={() => setPerkHover(perk.id)}
                  onMouseLeave={() => setPerkHover(null)}
                  style={{
                    background: surface,
                    border: hovered ? "1px solid var(--border-strong)" : `1px solid ${border}`,
                    borderRadius: 20,
                    padding: isPhone ? "16px 16px" : "22px 24px",
                    display: "flex", alignItems: isPhone ? "flex-start" : "center", gap: isPhone ? 14 : 20,
                    flexDirection: isPhone ? "column" : "row",
                    transition: "transform .18s var(--ease-ui), box-shadow .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                    transform: hovered ? "translateY(-2px)" : "translateY(0)",
                    boxShadow: hovered ? "0 8px 24px rgba(0,0,0,0.14)" : "none",
                  }}
                >
                  {/* Icon + Text row on phone */}
                  <div style={{ display: "flex", alignItems: "center", gap: 14, width: isPhone ? "100%" : undefined }}>
                    {/* Icon */}
                    <div style={{
                      width: 48, height: 48, flexShrink: 0,
                      borderRadius: 14,
                      background: `${violet}1a`,
                      border: `1px solid ${violet}33`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <IconComp size={22} color={violet} />
                    </div>

                    {/* Text */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 15, fontWeight: 700, color: text, letterSpacing: "-0.01em" }}>
                        {perk.name}
                      </div>
                      <div style={{ color: muted, fontSize: 13, marginTop: 3, lineHeight: 1.4 }}>
                        {perk.description}
                      </div>
                      {/* "need X more" — reserved height so layout doesn't shift */}
                      <div style={{ minHeight: "1.4em", marginTop: 4 }}>
                        {!canAfford ? (
                          <span style={{ color: dim, fontSize: 11, fontWeight: 500 }}>
                            Need {need} more token{need !== 1 ? "s" : ""}
                          </span>
                        ) : entitlements.premium ? (
                          <span style={{ color: "var(--lime-text)", fontSize: 11, fontWeight: 600 }}>
                            Free with Giggle+
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Cost + Redeem */}
                  <div style={{ flexShrink: 0, display: "flex", flexDirection: isPhone ? "row" : "column", alignItems: isPhone ? "center" : "flex-end", justifyContent: isPhone ? "space-between" : undefined, gap: 8, width: isPhone ? "100%" : undefined }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 18, fontWeight: 800, color: text }}>
                        {perk.tokenCost}
                      </span>
                      <span style={{ color: muted, fontSize: 12 }}>tokens</span>
                    </div>
                    <button
                      disabled={!canAfford || !canRedeemPerks || loading}
                      onClick={() => handleSpendPerk(perk.id)}
                      className="gg-press"
                      style={{
                        padding: "8px 18px", borderRadius: 999, minHeight: 40,
                        border: canAfford && canRedeemPerks ? "none" : `1px solid ${border}`,
                        cursor: canAfford && canRedeemPerks && !loading ? "pointer" : "not-allowed",
                        background: canAfford && canRedeemPerks
                          ? (hovered ? `linear-gradient(135deg, #9075ff, #6B4FE0)` : `linear-gradient(135deg, ${violet}, #5B3FD4)`)
                          : overlay,
                        color: canAfford && canRedeemPerks ? "#fff" : dim,
                        fontFamily: "var(--font-space-grotesk)", fontSize: 13, fontWeight: 700,
                        boxShadow: canAfford && canRedeemPerks && hovered ? `0 0 20px -4px ${violet}` : "none",
                        transform: canAfford && canRedeemPerks && hovered && !loading ? "translateY(-1px)" : "translateY(0)",
                        transition: "transform .14s ease, background .2s var(--ease-ui), box-shadow .2s var(--ease-ui)",
                        minWidth: isPhone ? 100 : 90,
                        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
                        opacity: loading ? 0.7 : 1,
                      }}
                    >
                      {loading ? <span className="gg-spinner" /> : !canRedeemPerks ? "Launch prep" : canAfford ? "Redeem" : "Need tokens"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── GIGGLE+ SUBSCRIPTION ──────────────────────────────────── */}
        <section>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const }}>
              <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 20, fontWeight: 800, color: text, letterSpacing: "-0.02em" }}>
                Go unlimited — Giggle+
              </div>
              <span style={{
                background: `${violet}1a`, border: `1px solid ${violet}33`,
                color: violet, borderRadius: 999, padding: "3px 10px",
                fontSize: 11, fontWeight: 700,
              }}>Best value</span>
            </div>
            <div style={{ color: muted, fontSize: 13, marginTop: 4 }}>
              Monthly token stipend + premium cosmetics, all included when plans launch.
            </div>
          </div>

          {entitlements.premium ? (
            <div style={{
              background: "var(--lime-soft, rgba(194,255,61,0.07))",
              border: "1px solid var(--lime-border, rgba(194,255,61,0.25))",
              borderRadius: 20,
              padding: isPhone ? "20px 18px" : "28px 32px",
              display: "flex", alignItems: "center", gap: 16,
            }}>
              <div style={{
                width: 44, height: 44,
                borderRadius: 12,
                background: "var(--lime-soft, rgba(194,255,61,0.18))",
                border: "1px solid var(--lime-border, rgba(194,255,61,0.3))",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <Icon.star size={22} color="var(--lime-text)" fill="var(--lime-text)" />
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 18, fontWeight: 800, color: "var(--lime-text)", letterSpacing: "-0.02em" }}>
                  Giggle+ Active
                </div>
                <div style={{ color: muted, fontSize: 13, marginTop: 3 }}>
                  {entitlements.premiumUntil
                    ? `Renews ${new Date(entitlements.premiumUntil).toLocaleDateString()}`
                    : "All perks unlocked. You receive 200 tokens each billing cycle."}
                </div>
              </div>
            </div>
          ) : (
            <div style={{
              background: surface,
              border: `1px solid ${border}`,
              borderRadius: 24,
              overflow: "hidden",
            }}>
              {/* Plan selector */}
              <div style={{
                display: "flex",
                borderBottom: `1px solid ${border}`,
              }}>
                {SUB_PLANS.map(p => {
                  const active = plan === p.id.replace("premium_", "") as "monthly" | "yearly";
                  const hov = planTabHover === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setPlan(p.id.replace("premium_", "") as "monthly" | "yearly")}
                      onMouseEnter={() => setPlanTabHover(p.id)}
                      onMouseLeave={() => setPlanTabHover(null)}
                      style={{
                        flex: 1, padding: isPhone ? "14px 14px" : "20px 24px",
                        background: active ? `${violet}12` : (hov ? "var(--overlay-hover)" : "transparent"),
                        border: "none",
                        borderRight: p.id === "premium_monthly" ? `1px solid ${border}` : "none",
                        borderBottom: active ? `2px solid ${violet}` : "2px solid transparent",
                        cursor: "pointer",
                        display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start",
                        transition: "background .2s var(--ease-ui), border-color .2s var(--ease-ui)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 15, fontWeight: 700, color: active ? violet : muted }}>
                          {p.label}
                        </span>
                        {p.badge && (
                          <span style={{ background: lime, color: "#0B0B0F", borderRadius: 999, fontSize: 10, fontWeight: 800, padding: "1px 6px" }}>
                            {p.badge}
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                        <span style={{ fontFamily: "var(--font-space-grotesk)", fontSize: isPhone ? 18 : 24, fontWeight: 800, color: active ? text : muted, letterSpacing: "-0.02em" }}>
                          {p.price}
                        </span>
                        <span style={{ color: dim, fontSize: 12 }}>{p.per}</span>
                      </div>
                      <div style={{ color: dim, fontSize: 11 }}>{p.note}</div>
                    </button>
                  );
                })}
              </div>

              {/* Included perks list + CTA */}
              <div style={{
                padding: isPhone ? "20px 16px" : "28px 32px",
                display: "flex",
                flexDirection: isPhone ? "column" : "row",
                gap: isPhone ? 20 : 40,
              }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
                  {[
                    { icon: "lightning" as const, color: violet, label: "200 tokens / month", sub: "Use on any perk, roll over not included" },
                    { icon: "star" as const, color: violet, label: "Member badge", sub: "Stand out across squads and invites" },
                    { icon: "shield" as const, color: "#FFB020", label: "Premium cosmetics", sub: "Exclusive cover themes, vibe packs & badges" },
                    { icon: "hd" as const, color: "#38bdf8", label: "Video polish", sub: "Launch-ready video upgrades preview" },
                  ].map(({ icon, color, label, sub }) => {
                    const IconComp = Icon[icon];
                    return (
                      <div key={label} style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                        <div style={{
                          width: 36, height: 36, flexShrink: 0,
                          borderRadius: 10, background: `${color}1a`, border: `1px solid ${color}33`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <IconComp size={18} color={color} />
                        </div>
                        <div>
                          <div style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 14, fontWeight: 700, color: text }}>{label}</div>
                          <div style={{ color: muted, fontSize: 12, marginTop: 2 }}>{sub}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* CTA */}
                <div style={{
                  flexShrink: 0, display: "flex", flexDirection: "column",
                  justifyContent: "center",
                  alignItems: isPhone ? "stretch" : "flex-end",
                  gap: 12, minWidth: isPhone ? undefined : 180,
                }}>
                  <button
                    disabled
                    style={{
                      padding: "16px 36px", borderRadius: 999, border: `1px solid ${border}`,
                      cursor: "not-allowed",
                      background: overlay,
                      color: dim,
                      fontFamily: "var(--font-space-grotesk)", fontSize: 16, fontWeight: 700,
                      transition: "all .15s ease",
                      whiteSpace: "nowrap" as const,
                      width: isPhone ? "100%" : undefined,
                    }}
                  >
                    Plan preview
                  </button>
                  <div style={{ color: dim, fontSize: 12, textAlign: isPhone ? "center" : "right" as const }}>Subscriptions are in launch prep. Earn tokens by inviting friends today.</div>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
