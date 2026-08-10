import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Safety · Giggle",
  description: "How to report, block, and get help while using Giggle.",
};

const sections = [
  {
    title: "Adults only",
    body: "Giggle is an adult service. Access to squads, matching, chat, and live video requires an account that meets the age gate and completes required verification.",
  },
  {
    title: "Report and block",
    body: "Report conduct that breaks the rules and block people you do not want to contact. Reports are reviewed separately from the person you report. Blocking is available without filing a report.",
  },
  {
    title: "Prohibited conduct and content",
    body: "Harassment, threats, hate, stalking, bullying, scams, sexual content, non-consensual conduct, illegal activity, and attempts to evade safety controls are prohibited.",
  },
  {
    title: "Urgent danger",
    body: "If someone faces immediate danger, contact local emergency services. Giggle support is not an emergency service. Preserve relevant details without sharing harmful material further.",
  },
  {
    title: "Child-safety escalation",
    body: (
      <>
        Child sexual abuse material and sexual exploitation of minors are strictly prohibited. Do not download, copy, or redistribute suspected material. Report it in Giggle, email{" "}
        <a href="mailto:support@gigglemeet.com?subject=Safety%20report" style={{ color: "var(--text-body)" }}>support@gigglemeet.com</a>, and contact the appropriate local child-protection or law-enforcement authority.
      </>
    ),
  },
  {
    title: "Appeals and contact",
    body: (
      <>
        Email <a href="mailto:support@gigglemeet.com?subject=Account%20appeal" style={{ color: "var(--text-body)" }}>support@gigglemeet.com</a> to appeal an account action or ask a safety question.
      </>
    ),
  },
];

export default function SafetyPage() {
  return (
    <LegalPage
      eyebrow="Safety"
      accent="var(--pink)"
      title="Tools and rules for safer encounters."
      intro={
        <>
          Effective <time dateTime="2026-08-04">August 4, 2026</time>. Giggle is for verified adults 18+. These
          rules explain how to act, report harm, block contact, and seek help.
        </>
      }
      sections={sections}
      links={[
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
        { href: "/support", label: "Support" },
      ]}
    />
  );
}
