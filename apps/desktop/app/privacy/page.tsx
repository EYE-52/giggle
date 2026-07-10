import Link from "next/link";
import type { Metadata } from "next";
import { Wordmark } from "@/components/Brand";

export const metadata: Metadata = {
  title: "Privacy · Giggle",
  description: "How Giggle handles data for squad discovery, matching, video sessions, and safety.",
};

const sections = [
  {
    title: "What we collect",
    body: "Account details, squad activity, safety reports, and product usage data needed to run live squad discovery.",
  },
  {
    title: "How we use it",
    body: "We use data to authenticate you, match squads, operate video sessions, improve reliability, and review safety issues.",
  },
  {
    title: "What we do not do",
    body: "We do not sell personal data. Payment processing should run through a configured payment provider before production launch.",
  },
  {
    title: "Your controls",
    body: "You can sign out, leave squads, and contact the team to request account or data deletion.",
  },
];

export default function PrivacyPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#07070B", color: "#F4F4F7", padding: "32px 24px 80px" }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, marginBottom: 72 }}>
          <Wordmark size={22} />
          <Link href="/" style={{ color: "#C2C2D4", textDecoration: "none", fontSize: 14, fontWeight: 700 }}>
            Back home
          </Link>
        </header>

        <p style={{ color: "#3DD6C0", textTransform: "uppercase", letterSpacing: ".16em", fontSize: 12, fontWeight: 800 }}>
          Privacy
        </p>
        <h1 style={{ fontSize: "clamp(44px, 8vw, 88px)", lineHeight: .95, letterSpacing: "-.05em", margin: "12px 0 24px", maxWidth: 760 }}>
          Clear data rules for squad discovery.
        </h1>
        <p style={{ color: "#C2C2D4", fontSize: 18, lineHeight: 1.7, maxWidth: 680, marginBottom: 56 }}>
          This preview policy explains the product behavior implemented in this build. Replace it with reviewed legal copy before public launch.
        </p>

        <section style={{ display: "grid", gap: 18 }}>
          {sections.map((section) => (
            <article key={section.title} style={{ borderTop: "1px solid rgba(255,255,255,.14)", paddingTop: 22 }}>
              <h2 style={{ fontSize: 22, margin: "0 0 8px" }}>{section.title}</h2>
              <p style={{ color: "#A8A8BA", fontSize: 16, lineHeight: 1.7, margin: 0 }}>{section.body}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
