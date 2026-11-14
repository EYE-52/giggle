import type { Metadata } from "next";
import { PRIVATE_METADATA } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  ...PRIVATE_METADATA,
  title: "Your character · Giggle",
  description: "Customize your Giggle character with hairstyles, accessories and colors.",
};

export default function CharacterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
