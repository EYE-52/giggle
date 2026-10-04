"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, syncEarnedWallet, type WalletInfo } from "@giggle/core";
import { Icon } from "@/components/Icons";
import { ReferralCard } from "@/components/ReferralCard";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { pollWhileVisible } from "@/lib/poll";
import styles from "./premium.module.css";

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
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [spending, setSpending] = useState(false);
  const [notice, setNotice] = useState("");
  const revision = useRef(0), spendingRef = useRef(false);
  const load = useCallback(async () => {
    if (spendingRef.current) return;
    const version = ++revision.current;
    try {
      const next = await api.getWallet();
      if (version !== revision.current) return;
      setWallet(next); syncEarnedWallet(next); setError("");
    } catch { if (version === revision.current) setError("Couldn't load your credits. Try again."); }
  }, []);
  useEffect(() => {
    void load();
    const stop = pollWhileVisible(load, 15000);
    return () => { revision.current++; stop(); };
  }, [load]);
  async function unlock() {
    if (spendingRef.current) return;
    spendingRef.current = true; revision.current++;
    setSpending(true); setError(""); setNotice("");
    try {
      const next = await api.redeemPlus();
      setWallet(next); syncEarnedWallet(next); setConfirm(false);
      setNotice("Giggle+ is active. Your squads can now have up to eight people.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't unlock Giggle+. Try again.");
      setConfirm(false);
    } finally { spendingRef.current = false; setSpending(false); }
    await load();
  }
  const enough = wallet && wallet.credits >= wallet.plus.cost;
  const expiry = wallet?.premiumUntil ? new Date(wallet.premiumUntil).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null;
  return <div className={`gg-reveal ${styles.page}`}>
    <button type="button" className={styles.back} onClick={() => router.push("/profile")}><Icon.chevron size={16} />Back to profile</button>
    <header className={styles.header}>
      <div><h1>Wallet &amp; Giggle+</h1><p>Earn credits by starting a squad and bringing friends.</p></div>
      <div className={styles.balance} aria-label={wallet ? `${wallet.credits} earned credits` : error ? "Credits unavailable" : "Loading credits"}>
        <span>Earned credits</span><strong>{wallet ? <AnimatedBalance value={wallet.credits} /> : "—"}</strong>
      </div>
    </header>
    {error && <div role="alert" className={styles.error}>{error}<Button size="sm" variant="ghost" onClick={() => void load()}>Retry</Button></div>}
    {notice && <p role="status" className={styles.notice}>{notice}</p>}
    <section className={styles.plus} aria-label="Giggle Plus">
      <div className={styles.plusHeading}><span className={styles.star}><Icon.sparkle size={26} /></span><div><h2>Giggle+</h2><p>{wallet?.premium ? expiry ? `Active until ${expiry}` : "Active" : "Make room for a bigger squad."}</p></div>{wallet?.premium && <span className={styles.active}>Active</span>}</div>
      <ul><li><Icon.users size={18} />Squads with up to eight people</li><li><Icon.sparkle size={18} />Giggle+ badge on your profile</li></ul>
      <div className={styles.unlock}>
        <span>{wallet ? `${wallet.plus.days} days · ${wallet.plus.cost} credits` : error ? "Reward details unavailable" : "Loading reward details…"}</span>
        {wallet?.premium ? <span className={styles.redeemed}><Icon.check size={16} />Unlocked</span> : <Button disabled={!wallet || !enough} onClick={() => setConfirm(true)}><Icon.sparkle size={18} />Unlock Giggle+</Button>}
      </div>
      {wallet && !wallet.premium && !enough && <p className={styles.progress}>{wallet.plus.cost - wallet.credits} more credits to unlock.</p>}
    </section>
    <section className={styles.earn} aria-label="Earn credits">
      <h2>Earn credits</h2>
      {wallet?.rewards.map(reward => <div key={reward.id} className={styles.reward}><span><b>Lead your first squad</b><small>{reward.earned ? "Reward earned" : "Create a squad and invite your friends."}</small></span><strong>{reward.earned ? <><Icon.check size={16} />Earned</> : `+${reward.credits}`}</strong>{!reward.earned && <Button size="sm" variant="secondary" onClick={() => router.push("/home?create=1")}>Create squad</Button>}</div>)}
      <ReferralCard />
    </section>
    {confirm && wallet && <Modal title="Unlock Giggle+?" subtitle={`Use ${wallet.plus.cost} earned credits for ${wallet.plus.days} days. There is no payment or automatic renewal.`} onClose={() => { if (!spending) setConfirm(false); }} closeOnBackdrop={!spending} showClose={!spending}><div className={styles.confirm}><Button variant="ghost" disabled={spending} onClick={() => setConfirm(false)}>Cancel</Button><Button loading={spending} onClick={() => void unlock()}>Use credits</Button></div></Modal>}
  </div>;
}
