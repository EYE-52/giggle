import type { Metadata } from "next";

export const SITE_NAME = "Giggle Meet";
const DEFAULT_SITE_ORIGIN = "https://www.gigglemeet.com";

// Only an explicit public build setting can change search URLs. Never infer
// canonical hosts from a request, preview URL, referral or invite parameter.
export function canonicalSiteOrigin(value = ""): string {
  if (!value.trim()) return DEFAULT_SITE_ORIGIN;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an HTTPS origin without credentials, a path, query or fragment");
  }
  if (url.hostname === "gigglemeet.com") url.hostname = "www.gigglemeet.com";
  return url.origin;
}

export const SITE_ORIGIN = canonicalSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
export const SITE_LOGO = `${SITE_ORIGIN}/icon.png`;
export const HOME_DESCRIPTION = "Video calls with friends and free multiplayer games. Start a squad on Giggle Meet or play Giggle Games with no account or download.";

export const PUBLIC_PAGES = [
  { path: "/", title: "Giggle Meet — Video calls & games with friends", description: HOME_DESCRIPTION },
  { path: "/safety", title: "Safety · Giggle Meet", description: "Learn about age checks, reporting, blocking and getting help on Giggle Meet." },
  { path: "/support", title: "Support · Giggle Meet", description: "Contact Giggle Meet for account help, age-verification appeals, safety concerns, data export or account deletion." },
  { path: "/privacy", title: "Privacy · Giggle Meet", description: "How Giggle Meet handles account data, age checks, video calls and safety reports, and how to ask about your data." },
  { path: "/terms", title: "Terms · Giggle Meet", description: "Read the terms for Giggle Meet, including adult eligibility, account responsibilities, calls and safety controls." },
] as const;

export function publicPageMetadata(path: typeof PUBLIC_PAGES[number]["path"]): Metadata {
  const page = PUBLIC_PAGES.find(page => page.path === path)!;
  const url = `${SITE_ORIGIN}${page.path}`;
  const images = [{ url: SITE_LOGO, width: 512, height: 512, alt: "Giggle Meet logo" }];
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: { type: "website", siteName: SITE_NAME, title: page.title, description: page.description, url, images },
    twitter: { card: "summary", title: page.title, description: page.description, images },
  };
}

// Clear inherited home metadata as well as excluding the private URL itself.
export const PRIVATE_METADATA: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
};

export const HOME_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", "@id": `${SITE_ORIGIN}/#website`, url: `${SITE_ORIGIN}/`, name: SITE_NAME, alternateName: "Giggle", description: HOME_DESCRIPTION, publisher: { "@id": `${SITE_ORIGIN}/#organization` } },
    { "@type": "Organization", "@id": `${SITE_ORIGIN}/#organization`, name: SITE_NAME, url: `${SITE_ORIGIN}/`, logo: { "@type": "ImageObject", url: SITE_LOGO, width: 512, height: 512 } },
  ],
}).replace(/</g, "\\u003c");
