import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Support · Giggle",
  description: "Contact Giggle for account, age-verification, safety, export, or deletion help.",
};

const sections = [
  { title: "Account help", body: <a href="mailto:support@gigglemeet.com?subject=Account%20help" style={{ color: "var(--text-body)" }}>Email account support</a> },
  { title: "Age-verification appeal", body: <a href="mailto:support@gigglemeet.com?subject=Age%20verification%20appeal" style={{ color: "var(--text-body)" }}>Ask for an age-verification review</a> },
  { title: "Safety report", body: <a href="mailto:support@gigglemeet.com?subject=Safety%20report" style={{ color: "var(--text-body)" }}>Contact the safety team</a> },
  { title: "Data export", body: <a href="mailto:support@gigglemeet.com?subject=Data%20export" style={{ color: "var(--text-body)" }}>Request a copy of your account data</a> },
  { title: "Account deletion", body: <a href="mailto:support@gigglemeet.com?subject=Account%20deletion" style={{ color: "var(--text-body)" }}>Request account deletion</a> },
];

export default function SupportPage() {
  return (
    <LegalPage
      eyebrow="Support"
      accent="var(--violet)"
      title="Get help from Giggle."
      intro={
        <>
          Effective <time dateTime="2026-08-04">August 4, 2026</time>. Giggle is for verified users 18+. Choose a
          subject below to open your email app. We may verify your identity before acting on account or data requests.
        </>
      }
      sections={sections}
      links={[
        { href: "/privacy", label: "Privacy" },
        { href: "/terms", label: "Terms" },
        { href: "/safety", label: "Safety" },
      ]}
    />
  );
}
