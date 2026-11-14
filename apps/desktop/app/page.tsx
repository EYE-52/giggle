"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { LandingActions } from "@/components/LandingActions";
import styles from "./page.module.css";
import { referralSignInHref } from "@/lib/authLinks";
import { HOME_JSON_LD } from "@/lib/siteMetadata";
import { setPendingReferral } from "@giggle/core";
import { parseGamesUrl } from "@/lib/gameBridge";
import { withGameIntent } from "@/lib/gameIntent";

const gamesUrl = parseGamesUrl(process.env.NEXT_PUBLIC_GAMES_URL)?.gamesUrl || "https://play.gigglemeet.com";

export default function LandingPage() {
  const [signInHref, setSignInHref] = useState("/signin");
  useEffect(() => {
    const href = referralSignInHref(window.location.search);
    setSignInHref(href);
    const code = new URL(href, window.location.origin).searchParams.get("ref");
    if (code) setPendingReferral(code);
  }, []);

  return (
    <div className={styles.page}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: HOME_JSON_LD }} />
      <header className={styles.nav}>
        <Link href="/" aria-label="Giggle Meet home" className={styles.brand}><Wordmark size={29} product="Meet" /></Link>
        <nav aria-label="Explore Giggle"><Link href="/discover">Rooms</Link><a className={styles.gamesNav} href={gamesUrl}>Games</a></nav>
        <Link href={signInHref} className={styles.signin}>Sign in <Icon.enter size={17} color="currentColor" /></Link>
      </header>
      <main>
        <section className={styles.hero} data-testid="giggle-hero">
          <div className={styles.copy}>
            <p className={styles.eyebrow}>Group vs group. Or just your group.</p>
            <h1>Good company.<br /><em>Great chaos.<svg viewBox="0 0 360 16" aria-hidden="true"><path d="M4 10C85 0 229 0 354 8M34 14C137 6 257 8 327 12" /></svg></em></h1>
            <p>Meet new groups, catch up with friends, or make it game night.</p>
          </div>
          <div className={styles.art} aria-hidden="true">
            <span className={styles.yourGroup}>Your group<svg viewBox="0 0 75 60"><path d="M8 3C58 3 68 23 57 52m-12-8 12 10 12-13" /></svg></span>
            <img src="/illustrations/giggle-hangout.webp" width={960} height={960} alt="" fetchPriority="high" />
            <span className={styles.theirGroup}>Their group<svg viewBox="0 0 75 60"><path d="M63 3C10 3 8 28 20 52m-12-9 12 11 12-13" /></svg></span>
          </div>
          <div className={styles.actions}>
            <LandingActions gamesUrl={gamesUrl} groupHref="/home?create=1&mode=video&match=1" hrefs={{
              video: "/home?create=1&mode=video",
              voice: "/home?create=1&mode=voice",
              chat: "/home?create=1&mode=chat",
              games: withGameIntent("/home?create=1&mode=video", null, true),
            }} />
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>Adults 18+</span>
        <nav aria-label="Help and policies"><Link href="/safety">Safety</Link><Link href="/support">Support</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
      </footer>
    </div>
  );
}
