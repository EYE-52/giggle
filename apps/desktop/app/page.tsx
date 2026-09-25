"use client";
import Link from "next/link";
import { Wordmark } from "@/components/Brand";
import { Icon } from "@/components/Icons";
import { HangoutIllustration } from "@/components/HangoutIllustration";
import styles from "./page.module.css";

export default function LandingPage() {
  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <Link href="/" aria-label="Giggle home"><Wordmark size={30} /></Link>
        <Link href="/signin" className={styles.signin}>Sign in <Icon.enter size={17} color="currentColor" /></Link>
      </header>
      <main>
        <section className={styles.hero} data-testid="giggle-hero">
          <div className={styles.copy}>
            <h1>Good company.<br />Great <em>nonsense.</em></h1>
            <p>Video calls with your friends. Create a squad, share the link, and hang out.</p>
            <Link href="/signin" className={styles.cta}>Start a hangout <Icon.enter size={20} color="currentColor" /></Link>
          </div>
          <div className={styles.art}><HangoutIllustration /></div>
        </section>
      </main>
      <footer className={styles.footer}>
        <div><Wordmark size={23} /><span>Good to be together. For adults 18+.</span></div>
        <nav aria-label="Help and policies"><Link href="/safety">Safety</Link><Link href="/support">Support</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></nav>
      </footer>
    </div>
  );
}
