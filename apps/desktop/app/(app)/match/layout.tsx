import type { Metadata } from "next";
import { PRIVATE_METADATA } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  ...PRIVATE_METADATA,
  title: "Match · Giggle",
  description: "Review your squad match and move into a live encounter.",
};

export default function MatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
