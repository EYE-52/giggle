import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Wallet · Giggle",
  description: "See your earned credits and redeem a Giggle+ pass.",
};

export default function PremiumLayout({ children }: { children: React.ReactNode }) {
  return children;
}
