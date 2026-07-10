import Link from "next/link";
import type { Metadata } from "next";
import { Wordmark } from "@/components/Brand";

export const metadata: Metadata = {
  title: "Terms · Giggle",
  description: "Ground rules for using Giggle squad discovery, live video, reporting, and preview payments.",
};

const sections = [
  {
    title: "Use Giggle with respect",
    body: "You are responsible for your behavior in squads, chats, video rooms, and safety reports.",
  },
  {
    title: "Keep people safe",
    body: "Harassment, impersonation, spam, illegal activity, and abuse of reporting tools are not allowed.",
  },
  {
    title: "Preview payments",
    body: "Current checkout flows are product previews unless a real payment processor is configured for the build.",
  },
  {
    title: "Service changes",
    body: "Giggle may change matching, squad, moderation, and premium features as the product evolves.",
  },
];

export default function TermsPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#07070B", color: "#F4F4F7", padding: "32px 24px 80px" }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, marginBottom: 72 }}>
          <Wordmark size={22} />
          <Link href="/" style={{ color: "#C2C2D4", textDecoration: "none", fontSize: 14, fontWeight: 700 }}>
            Back home
          </Link>
        </header>

        <p style={{ color: "#C2FF3D", textTransform: "uppercase", letterSpacing: ".16em", fontSize: 12, fontWeight: 800 }}>
          Terms
        </p>
        <h1 style={{ fontSize: "clamp(44px, 8vw, 88px)", lineHeight: .95, letterSpacing: "-.05em", margin: "12px 0 24px", maxWidth: 760 }}>
          Ground rules for meeting in squads.
        </h1>
        <p style={{ color: "#C2C2D4", fontSize: 18, lineHeight: 1.7, maxWidth: 680, marginBottom: 56 }}>
          These preview terms describe expected product rules. Replace them with reviewed legal copy before public launch.
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
