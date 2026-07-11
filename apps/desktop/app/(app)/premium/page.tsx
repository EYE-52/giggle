"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { ReferralCard } from "@/components/ReferralCard";
import { useViewport } from "@/components/useViewport";
import { billing, getTokenBalance, TOKEN_PERKS, type Entitlements } from "@giggle/core";

export default function PremiumPage() {
  const router = useRouter();
  const { isPhone } = useViewport();
  const [entitlements, setEntitlements] = useState<Entitlements>({ premium: false, activePerks: {} });
  const [tokenBalance, setTokenBalance] = useState(0);
  const [spendLoading, setSpendLoading] = useState<string | null>(null);
  const canRedeemPerks = billing.canRedeemTokenPerksLocally();

  const sync = useCallback(() => {
    setEntitlements(billing.getEntitlements());
    setTokenBalance(getTokenBalance());
  }, []);

  useEffect(() => {
    sync();
    return billing.subscribe(sync);
  }, [sync]);

  async function handleSpendPerk(perkId: string) {
    if (!canRedeemPerks) return;
    setSpendLoading(perkId);
    const ok = perkId === "cover_themes"
      ? billing.spendOnCoverThemes()
      : perkId === "vibe_pack" && billing.spendOnVibePack();
    if (ok) sync();
    setSpendLoading(null);
  }

  return (
    <div className="gg-reveal" style={{ display: "flex", flexDirection: "column", gap: 22, paddingBottom: 40 }}>
      <button onClick={() => router.back()} className="gg-press" style={{ alignSelf: "flex-start", minHeight: 44, display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: "transparent", color: "var(--text-muted)", fontWeight: 650, cursor: "pointer" }}>
        <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}><Icon.chevron size={15} color="var(--text-muted)" /></span>
        Back
      </button>

      <header style={{ display: "flex", alignItems: isPhone ? "flex-start" : "flex-end", justifyContent: "space-between", flexDirection: isPhone ? "column" : "row", gap: 18, paddingBottom: 22, borderBottom: "1px solid var(--border)" }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "var(--font-space-grotesk)", fontSize: isPhone ? 28 : 34, lineHeight: 1, color: "var(--text)" }}>Wallet</h1>
          <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 14 }}>Earn tokens, then spend them on your squad identity.</p>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
          <strong style={{ fontFamily: "var(--font-space-grotesk)", fontSize: 38, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{tokenBalance.toLocaleString()}</strong>
          <span style={{ color: "var(--text-muted)", fontSize: 14 }}>tokens</span>
        </div>
      </header>

      <ReferralCard />

      <section>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-space-grotesk)", fontSize: 19, color: "var(--text)" }}>Token perks</h2>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            {canRedeemPerks ? "Cosmetics are always priced in tokens." : "Perk redemption is in launch prep. Your balance is already tracked."}
          </p>
        </div>
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {TOKEN_PERKS.map(perk => {
            const canAfford = tokenBalance >= perk.tokenCost;
            const loading = spendLoading === perk.id;
            const IconComp = (Icon as Record<string, React.ComponentType<{ size: number; color: string }>>)[perk.icon] ?? Icon.star;
            return (
              <div key={perk.id} style={{ minHeight: 76, display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--overlay)", flexShrink: 0 }}><IconComp size={19} color="var(--violet)" /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 700 }}>{perk.name}</div>
                  <div style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: 2 }}>{perk.description}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ color: "var(--text)", fontWeight: 750, fontSize: 13 }}>{perk.tokenCost} tokens</div>
                  <button
                    disabled={!canAfford || !canRedeemPerks || loading}
                    onClick={() => handleSpendPerk(perk.id)}
                    className="gg-press"
                    style={{ marginTop: 5, minHeight: 36, padding: "0 13px", borderRadius: 9, border: "1px solid var(--border-strong)", background: canAfford && canRedeemPerks ? "var(--violet)" : "transparent", color: canAfford && canRedeemPerks ? "#fff" : "var(--text-dim)", fontSize: 12, fontWeight: 700, cursor: canAfford && canRedeemPerks ? "pointer" : "not-allowed" }}
                  >
                    {loading ? "Unlocking…" : canRedeemPerks ? (canAfford ? "Unlock" : "Need tokens") : "Coming soon"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ padding: isPhone ? 18 : 22, borderRadius: 14, border: "1px solid var(--border-strong)", background: "var(--surface)", display: "flex", flexDirection: isPhone ? "column" : "row", alignItems: isPhone ? "flex-start" : "center", gap: 18 }}>
        <span style={{ width: 44, height: 44, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--violet-soft)", flexShrink: 0 }}><Icon.star size={20} color="var(--lime)" /></span>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-space-grotesk)", fontSize: 18, color: "var(--text)" }}>{entitlements.premium ? "Giggle+ active" : "Giggle+"}</h2>
          <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>Monthly token stipend, member badge, and 15% bonus tokens on packs. Cosmetics still cost tokens.</p>
        </div>
        <span style={{ color: entitlements.premium ? "var(--lime-text)" : "var(--text-dim)", fontSize: 12.5, fontWeight: 700 }}>{entitlements.premium ? "Active" : "Launching soon"}</span>
      </section>
    </div>
  );
}
