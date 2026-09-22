import Link from "next/link";
import { Wordmark } from "@/components/Brand";
import { Icon } from "@/components/Icons";

export default function LandingPage() {
  return (
    <div className="gg-welcome">
      <header className="gg-welcome-nav">
        <Link href="/" aria-label="Giggle home"><Wordmark /></Link>
        <Link href="/signin" className="gg-welcome-signin">Sign in <Icon.enter size={18} color="currentColor" /></Link>
      </header>
      <main className="gg-welcome-main" data-testid="giggle-hero">
        <section className="gg-welcome-copy">
          <h1>Meet new people.<br />Bring your friends<span>.</span></h1>
          <p>Start with your squad. Meet another, live on video.</p>
          <div className="gg-welcome-adults"><Icon.shield size={19} color="currentColor" /> For adults 18+</div>
          <Link href="/signin" className="gg-welcome-start">Create your account <Icon.enter size={20} color="currentColor" /></Link>
        </section>
        <div className="gg-welcome-photos" aria-label="Illustration of a group video call using sample photos">
          {['sq1', 'sq2', 'sq3', 'alex'].map((name, i) => <img key={name} src={`/img/call-preview/${name}.jpg`} alt="" className={`gg-welcome-photo-${i}`} />)}
          <span>Sample photos</span>
        </div>
      </main>
      <footer className="gg-welcome-footer">
        <span>Giggle · Group video calls</span>
        <nav aria-label="Help and policies">
          <Link href="/safety">Safety</Link><Link href="/support">Support</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link>
        </nav>
      </footer>
    </div>
  );
}
