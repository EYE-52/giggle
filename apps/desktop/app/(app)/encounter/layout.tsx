import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Encounter · Giggle",
  description: "Meet another squad in a live Giggle encounter.",
};

export default function EncounterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
