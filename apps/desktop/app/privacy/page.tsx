import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy · Giggle",
  description: "How Giggle handles data for squad discovery, matching, video sessions, and safety.",
};

const sections = [
  {
    title: "Account and profile data",
    body: "We use account details such as your email, display name, profile image, preferences, country, language, account status, and product activity to provide and secure Giggle.",
  },
  {
    title: "Age assurance",
    body: "Your date of birth is private and is used to derive eligibility gates. Yoti performs the verification check. Giggle keeps only a minimized receipt with the result, method, threshold, provider references, policy version, and timestamps; Giggle does not keep the selfie or identity document used by Yoti.",
  },
  {
    title: "Squads, friends, messages, and live media",
    body: "We process squad and friend relationships, invitations, notifications, and matching activity. Live encounter chat is transient. Live audio and video are carried by Agora and are not recorded by Giggle.",
  },
  {
    title: "Safety and service providers",
    body: "We retain submitted safety reports and related review actions. Providers help us with identity, age assurance, hosting, communications, storage, and live media, and receive only the information needed for their role.",
  },
  {
    title: "Retention and your rights",
    body: (
      <>
        We keep information only while needed for the service, safety, disputes, and legal duties. Contact{" "}
        <a href="mailto:support@gigglemeet.com?subject=Privacy%20request" style={{ color: "var(--text-body)" }}>support@gigglemeet.com</a>{" "}
        to request access, export, correction, or deletion. We verify requests and apply the rights and exceptions available where you live.
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      accent="var(--teal)"
      title="How Giggle handles your information."
      intro={
        <>
          Effective <time dateTime="2026-08-04">August 4, 2026</time>. This notice explains how Giggle handles
          information for accounts, matching, live services, and safety. Giggle is for verified users 18+.
        </>
      }
      sections={sections}
      links={[
        { href: "/terms", label: "Terms" },
        { href: "/safety", label: "Safety" },
        { href: "/support", label: "Support" },
      ]}
    />
  );
}
