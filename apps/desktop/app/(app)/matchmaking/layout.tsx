import type { Metadata } from "next";
import { PRIVATE_METADATA } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  ...PRIVATE_METADATA,
  title: "Matchmaking · Giggle",
  description: "Find another squad with the same energy.",
};

export default function MatchmakingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
