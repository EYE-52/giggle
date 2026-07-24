import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms · Giggle",
  description: "Ground rules for using Giggle squad discovery, live video, reporting, tokens, and subscriptions.",
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
    title: "Tokens and Giggle+",
    body: "Tokens are Giggle's in-app spend currency for eligible cosmetics. Giggle+ provides the benefits shown at purchase; cosmetics still cost tokens unless stated otherwise.",
  },
  {
    title: "Service changes",
    body: "Giggle may change matching, squad, moderation, and premium features as the product evolves.",
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      accent="var(--lime)"
      title="Ground rules for meeting in squads."
      intro={
        <>
          Effective <time dateTime="2026-07-12">July 12, 2026</time>. By using Giggle, you agree to these rules
          for accounts, squads, live video, safety, and paid features.
        </>
      }
      sections={sections}
      otherLink={{ href: "/privacy", label: "Read our Privacy Policy →" }}
    />
  );
}
