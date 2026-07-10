import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Matchmaking · Giggle",
  description: "Find another squad with the same energy.",
};

export default function MatchmakingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
