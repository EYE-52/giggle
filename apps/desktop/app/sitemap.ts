import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, SITE_ORIGIN } from "@/lib/siteMetadata";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map(page => ({ url: `${SITE_ORIGIN}${page.path}` }));
}
