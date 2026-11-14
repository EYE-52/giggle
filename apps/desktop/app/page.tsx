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
            <h1>Good company.<span>Great <em>nonsense.</em></span></h1>
            <p>Your friends meet their friends. Catch up, crack up, and bring a game along for the ride.</p>
          </div>
          <div className={styles.art} aria-hidden="true">
            <img src="/illustrations/giggle-hangout.webp" width={960} height={960} alt="" fetchPriority="high" />
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
