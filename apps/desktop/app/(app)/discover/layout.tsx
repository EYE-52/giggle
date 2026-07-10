import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Discover · Giggle",
  description: "Browse open squads and find a group that matches your vibe.",
};

export default function DiscoverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
