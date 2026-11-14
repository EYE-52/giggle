import type { MetadataRoute } from "next";
import { SITE_ORIGIN } from "@/lib/siteMetadata";

export default function robots(): MetadataRoute.Robots {
  // Private HTML stays crawlable so engines can read its noindex metadata.
  // Account and room access remains controlled by the existing auth checks.
  return { rules: { userAgent: "*", allow: "/", disallow: "/api/" }, sitemap: `${SITE_ORIGIN}/sitemap.xml` };
}
