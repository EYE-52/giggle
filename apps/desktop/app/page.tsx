"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import styles from "./page.module.css";
import { referralSignInHref } from "@/lib/authLinks";
import { HOME_JSON_LD } from "@/lib/siteMetadata";
import { setPendingReferral } from "@giggle/core";
import { parseGamesUrl } from "@/lib/gameBridge";
import { gameMeetPath } from "@/lib/gameIntent";

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
        <Link href="/" aria-label="Giggle home"><Wordmark size={28} /></Link>
        <nav aria-label="Giggle apps">
          <a href="#games">Games</a>
        </nav>
        <Link href={signInHref} className={styles.signin}>Sign in <Icon.enter size={17} color="currentColor" /></Link>
      </header>
      <main>
        <section className={styles.hero} data-testid="giggle-hero">
          <div className={styles.copy} id="meet">
            <h1>Good company.<br /><em>Great times.</em></h1>
            <p>Video calls that bring your people closer.<br className={styles.desktopBreak} /> Catch up, share your screen, or turn the call into game night.</p>
            <Link href={signInHref} className={styles.startCall}><Icon.cam size={21} color="currentColor" />Start a call<Icon.arrowRight size={19} color="currentColor" /></Link>
            <span className={styles.inviteNote}>Send a link. Bring everyone together.</span>
          </div>
          <section className={styles.games} id="games" aria-labelledby="games-title">
            <div className={styles.gameCopy}>
              <span className={styles.productName}><Icon.dice size={20} color="currentColor" />Giggle Games</span>
              <h2 id="games-title">A little friendly competition.</h2>
              <p>Play party games, draw, or race karts together. Open a game inside your call or play in a standalone room.</p>
            </div>
            <div className={styles.gameActions}>
              <Link href={gameMeetPath(null)} className={styles.inCall}>Play in a call<Icon.arrowRight size={18} color="currentColor" /></Link>
              <a href={gamesUrl}>Play games only<Icon.arrowRight size={17} color="currentColor" /></a>
            </div>
          </section>
        </section>
      </main>
      <footer className={styles.footer}>
        <p>Good to be together. Meet is for adults 18+.</p>
        <nav aria-label="Help and policies"><Link href="/safety">Safety</Link><Link href="/support">Support</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
      </footer>
    </div>
  );
}
