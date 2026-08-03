import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms · Giggle",
  description: "Ground rules for using Giggle squad discovery, live video, reporting, tokens, and subscriptions.",
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
    title: "Paid products and stores",
    body: "Tokens and Giggle+ provide only the benefits shown at purchase. Prices, billing, cancellation, and refunds also follow the terms of the app store or payment provider used for the purchase and applicable law.",
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
          Effective <time dateTime="2026-08-04">August 4, 2026</time>. Giggle is for verified adults 18+. By using
          Giggle, you agree to these rules for accounts, squads, live video, safety, and paid features.
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
