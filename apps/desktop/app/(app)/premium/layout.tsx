import type { Metadata } from "next";
import { PRIVATE_METADATA } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  ...PRIVATE_METADATA,
  title: "Wallet · Giggle",
  description: "See your earned credits and redeem a Giggle+ pass.",
};

export default function PremiumLayout({ children }: { children: React.ReactNode }) {
  return children;
}
