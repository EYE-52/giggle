import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms · Giggle",
  description: "Ground rules for using Giggle squads, live video, safety controls and earned credits.",
};

const sections = [
  {
    title: "Eligibility and account accuracy",
    body: "You must be 18 or older, complete required age verification, and provide accurate account information. Do not share access, impersonate someone, or evade an account restriction.",
  },
  {
    title: "Treat people with respect",
    body: "Harassment, threats, hate, stalking, bullying, spam, scams, non-consensual conduct, sexual content, and illegal activity are prohibited. Child sexual abuse material and any sexual exploitation of a minor are strictly prohibited.",
  },
  {
    title: "Squads, video, and safety controls",
    body: "Only join or invite people with permission. Everyone controls their own camera and microphone. Use report and block honestly; false or abusive reports are prohibited.",
  },
  {
    title: "Earned credits and Giggle+",
    body: "Credits are noncash app rewards and cannot be exchanged for money or transferred to another account. You can redeem them for the Giggle+ benefits and duration shown in your Wallet. There are currently no payments or automatic renewals. Do not use fake accounts, spam or fraudulent invitations to earn credits.",
  },
  {
    title: "Availability and enforcement",
    body: "Giggle may change, pause, or discontinue features and cannot guarantee uninterrupted matching or live service. Accounts may be restricted or suspended to enforce these terms, protect people, or meet legal duties.",
  },
  {
    title: "Questions and appeals",
    body: (
      <>
        Contact <a href="mailto:support@gigglemeet.com?subject=Account%20help" style={{ color: "var(--text-body)" }}>support@gigglemeet.com</a> for support or to appeal an account decision.
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      accent="var(--lime)"
      title="Ground rules for meeting safely."
      intro={
        <>
          Updated <time dateTime="2026-10-04">October 4, 2026</time>. Giggle is for adults 18+. By using
          Giggle, you agree to these rules for accounts, squads, live video, safety, and earned credits.
        </>
      }
      sections={sections}
      links={[
        { href: "/privacy", label: "Privacy" },
        { href: "/safety", label: "Safety" },
        { href: "/support", label: "Support" },
      ]}
    />
  );
}
