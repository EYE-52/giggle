import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Premium · Giggle",
  description: "Review your token wallet and premium Giggle perks.",
};

export default function PremiumLayout({ children }: { children: React.ReactNode }) {
  return children;
}
