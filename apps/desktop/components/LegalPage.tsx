import type { ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/Brand";

export interface LegalSection {
  title: string;
  body: ReactNode;
}

/**
 * Shared layout for the legal pages (/privacy, /terms). Server-safe — no
 * client hooks. `accent` colors the eyebrow; `otherLink` renders the bottom
 * cross-link to the sibling document.
 */
export function LegalPage({
  eyebrow,
  accent,
  title,
  intro,
  sections,
  otherLink,
}: {
  eyebrow: string;
  accent: string;
  title: string;
  intro: ReactNode;
  sections: LegalSection[];
  otherLink: { href: string; label: string };
}) {
  return (
    <main data-theme="dark" style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", padding: "32px 24px 80px" }}>
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, marginBottom: 72 }}>
          <Wordmark size={22} />
          <Link href="/" style={{ color: "var(--text-body)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
            Back home
          </Link>
        </header>

        <p style={{ color: accent, textTransform: "uppercase", letterSpacing: ".16em", fontSize: 12, fontWeight: 700 }}>
          {eyebrow}
        </p>
        <h1 style={{ fontSize: "clamp(30px, 6vw, 56px)", fontWeight: 700, lineHeight: 1.02, letterSpacing: "-.03em", margin: "12px 0 24px", maxWidth: 760 }}>
          {title}
        </h1>
        <p style={{ color: "var(--text-body)", fontSize: 17, lineHeight: 1.7, maxWidth: 680, marginBottom: 56 }}>
          {intro}
        </p>

        <section style={{ display: "grid", gap: 18 }}>
          {sections.map((section) => (
            <article key={section.title} style={{ borderTop: "1px solid var(--border-strong)", paddingTop: 22 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>{section.title}</h2>
              <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.7, margin: 0 }}>{section.body}</p>
            </article>
          ))}
        </section>

        <footer style={{ borderTop: "1px solid var(--border-strong)", marginTop: 56, paddingTop: 24 }}>
          <Link href={otherLink.href} style={{ color: "var(--text-body)", textDecoration: "none", fontSize: 14, fontWeight: 600 }}>
            {otherLink.label}
          </Link>
        </footer>
      </div>
    </main>
  );
}
