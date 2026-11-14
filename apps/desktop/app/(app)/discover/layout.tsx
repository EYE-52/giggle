import type { Metadata } from "next";
import { PRIVATE_METADATA } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  ...PRIVATE_METADATA,
  title: "Discover · Giggle",
  description: "Browse open squads and find a group that matches your vibe.",
};

export default function DiscoverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
