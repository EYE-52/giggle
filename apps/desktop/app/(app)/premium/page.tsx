"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icons";
import { ReferralCard } from "@/components/ReferralCard";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useViewport } from "@/components/useViewport";
import { billing, getTokenBalance, TOKEN_PERKS, type Entitlements, type TokenPerk } from "@giggle/core";

/** Animates the displayed balance toward `value` over ~400ms (spend feedback). */
function AnimatedBalance({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const DUR = 400;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / DUR);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplay(Math.round(from + (value - from) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display.toLocaleString()}</>;
}

export default function PremiumPage() {
  const router = useRouter();
  const { isPhone } = useViewport();
  const { toast } = useToast();
  const [entitlements, setEntitlements] = useState<Entitlements>({ premium: false, activePerks: {} });
  const [tokenBalance, setTokenBalance] = useState(0);
  const [balanceLoaded, setBalanceLoaded] = useState(false);
  const [confirmPerk, setConfirmPerk] = useState<TokenPerk | null>(null);
  const [spendLoading, setSpendLoading] = useState(false);
  const referralRef = useRef<HTMLDivElement | null>(null);
  const canRedeemPerks = billing.canRedeemTokenPerksLocally();

  const sync = useCallback(() => {
    setEntitlements(billing.getEntitlements());
    setTokenBalance(getTokenBalance());
    setBalanceLoaded(true);
  }, []);

  useEffect(() => {
    sync();
    return billing.subscribe(sync);
  }, [sync]);

  const scrollToReferral = useCallback(() => {
    referralRef.current?.scrollIntoView({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "auto" : "smooth",
      block: "start",
    });
  }, []);

  function confirmSpend(perk: TokenPerk) {
    if (!canRedeemPerks) return;
    setSpendLoading(true);
    const ok = perk.id === "cover_themes"
      ? billing.spendOnCoverThemes()
      : perk.id === "vibe_pack" && billing.spendOnVibePack();
    setSpendLoading(false);
    setConfirmPerk(null);
    if (ok) {
      sync();
      toast(`${perk.name} unlocked`, "success");
    } else {
      toast(`Couldn't unlock ${perk.name}. Please try again.`, "error");
    }
  }

  const comingSoonDescId = "perk-coming-soon-desc";

  return (
    <div className="gg-reveal" style={{ display: "flex", flexDirection: "column", gap: 22, paddingBottom: 40 }}>
      <button onClick={() => router.push("/home")} className="gg-press" style={{ alignSelf: "flex-start", minHeight: 44, display: "inline-flex", alignItems: "center", gap: 7, border: "none", background: "transparent", color: "var(--text-muted)", fontWeight: 600, cursor: "pointer" }}>
        <span style={{ transform: "rotate(180deg)", display: "inline-flex" }}><Icon.chevron size={15} color="var(--text-muted)" /></span>
        Back
      </button>

      <header style={{ display: "flex", alignItems: isPhone ? "flex-start" : "flex-end", justifyContent: "space-between", flexDirection: isPhone ? "column" : "row", gap: 18, paddingBottom: 22, borderBottom: "1px solid var(--border)" }}>
        <div>
          <h1 style={{ margin: 0, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 30, fontWeight: 700, lineHeight: 1, color: "var(--text)" }}>Wallet</h1>
          <p style={{ margin: "8px 0 0", color: "var(--text-muted)", fontSize: 14 }}>Earn tokens, then spend them on your squad identity.</p>
        </div>
        {/* Balance — StatTile-style presentation (v3 spec 04) */}
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-control, 14px)", padding: "12px 16px", minWidth: 118, boxShadow: "var(--shadow-sm)", boxSizing: "border-box" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>Balance</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
            {balanceLoaded ? (
              <strong style={{ fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 38, fontWeight: 700, lineHeight: 1.15, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                <AnimatedBalance value={tokenBalance} />
              </strong>
            ) : (
              <span className="gg-shimmer" aria-hidden style={{ display: "inline-block", width: 92, height: 38, borderRadius: 10 }} />
            )}
            <span style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 600 }}>tokens</span>
          </div>
        </div>
      </header>

      <div ref={referralRef} style={{ scrollMarginTop: 16 }}>
        <ReferralCard />
      </div>

      <section>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 22, fontWeight: 700, color: "var(--text)" }}>Token perks</h2>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            {canRedeemPerks ? "Cosmetics are always priced in tokens." : "Perk redemption is in launch prep. Your balance is already tracked."}
          </p>
        </div>
        {!canRedeemPerks && (
          <p id={comingSoonDescId} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", margin: -1, padding: 0, border: 0 }}>
            Perk redemption launches soon
          </p>
        )}
        <div style={{ borderTop: "1px solid var(--border)" }}>
          {TOKEN_PERKS.map(perk => {
            const canAfford = tokenBalance >= perk.tokenCost;
            const needsTokens = canRedeemPerks && !canAfford;
            const IconComp = (Icon as Record<string, React.ComponentType<{ size: number; color: string }>>)[perk.icon] ?? Icon.star;
            const priceAndAction = (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, ...(isPhone ? { width: "100%", justifyContent: "space-between" } : { flexDirection: "column" as const, alignItems: "flex-end", gap: 5 }) }}>
                <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 13 }}>{perk.tokenCost} tokens</div>
                {canRedeemPerks ? (
                  canAfford ? (
                    <Button size="sm" onClick={() => setConfirmPerk(perk)}>Unlock</Button>
                  ) : (
                    <span style={{ display: "inline-flex", alignItems: "center", minHeight: 28, padding: "0 12px", borderRadius: 999, background: "var(--amber-soft)", color: "var(--amber)", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                      Need tokens
                    </span>
                  )
                ) : (
                  <span title="Perk redemption launches soon">
                    <Button size="sm" variant="secondary" disabled aria-describedby={comingSoonDescId}>
                      Coming soon
                    </Button>
                  </span>
                )}
              </div>
            );
            return (
              <div key={perk.id} style={{ borderBottom: "1px solid var(--border)", padding: "12px 0" }}>
                <div style={{ minHeight: isPhone ? 0 : 64, display: "flex", flexDirection: isPhone ? "column" : "row", alignItems: isPhone ? "stretch" : "center", gap: isPhone ? 12 : 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0 }}>
                    <span style={{ width: 40, height: 40, borderRadius: "var(--radius-control, 14px)", display: "grid", placeItems: "center", background: "var(--overlay)", border: "var(--control-border, 1px solid var(--border))", flexShrink: 0 }}><IconComp size={19} color="var(--accent, var(--violet))" /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 700 }}>{perk.name}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>{perk.description}</div>
                    </div>
                  </div>
                  {priceAndAction}
                </div>
                {needsTokens && (
                  <button
                    onClick={scrollToReferral}
                    className="gg-press"
                    style={{ marginTop: 4, minHeight: 32, padding: 0, border: "none", background: "transparent", color: "var(--accent, var(--violet))", fontSize: 12, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    Earn tokens by inviting friends ↑
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ padding: isPhone ? 18 : 24, borderRadius: "var(--radius-card, 20px)", border: "1px solid var(--border-strong)", background: "var(--surface)", boxShadow: "var(--shadow-card, var(--elev))", display: "flex", flexDirection: isPhone ? "column" : "row", alignItems: isPhone ? "flex-start" : "center", gap: 18 }}>
        <span style={{ width: 44, height: 44, borderRadius: "var(--radius-control, 14px)", display: "grid", placeItems: "center", background: "var(--violet-soft)", flexShrink: 0 }}><Icon.star size={20} color="var(--live, var(--lime))" /></span>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-display, var(--font-space-grotesk))", fontSize: 17, fontWeight: 700, color: "var(--text)" }}>{entitlements.premium ? "Giggle+ active" : "Giggle+"}</h2>
          <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>Monthly token stipend + 15% bonus tokens on packs. Cosmetics still cost tokens.</p>
        </div>
        <span style={{ color: entitlements.premium ? "var(--lime-text)" : "var(--text-dim)", fontSize: 12, fontWeight: 700 }}>{entitlements.premium ? "Active" : "Launching soon"}</span>
      </section>

      {confirmPerk && (
        <Modal
          onClose={() => setConfirmPerk(null)}
          title={`Unlock ${confirmPerk.name}?`}
          subtitle={`This spends ${confirmPerk.tokenCost} tokens from your balance.`}
        >
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
            <Button variant="ghost" onClick={() => setConfirmPerk(null)}>Cancel</Button>
            <Button loading={spendLoading} onClick={() => confirmSpend(confirmPerk)}>Unlock</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
