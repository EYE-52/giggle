import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Match · Giggle",
  description: "Review your squad match and move into a live encounter.",
};

export default function MatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
