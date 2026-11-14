import type { Metadata } from "next";
import { PRIVATE_METADATA } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  ...PRIVATE_METADATA,
  title: "Encounter · Giggle",
  description: "Meet another squad in a live Giggle encounter.",
};

export default function EncounterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
