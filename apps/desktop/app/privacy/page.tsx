import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

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
    body: "We do not sell personal data. We do not post to your connected accounts without your permission.",
  },
  {
    title: "Your controls",
    body: (
      <>
        You can sign out, leave squads, and contact the team at{" "}
        <a href="mailto:support@gigglemeet.com" style={{ color: "var(--text-body)" }}>support@gigglemeet.com</a>{" "}
        to request account or data deletion.
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      accent="var(--teal)"
      title="Clear data rules for squad discovery."
      intro={
        <>
          Effective <time dateTime="2026-07-12">July 12, 2026</time>. This notice explains how Giggle handles
          information used for accounts, squad matching, live video, and safety.
        </>
      }
      sections={sections}
      otherLink={{ href: "/terms", label: "Read our Terms →" }}
    />
  );
}
