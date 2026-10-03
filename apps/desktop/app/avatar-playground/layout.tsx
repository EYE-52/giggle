import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your character · Giggle",
  description: "Customize your Giggle character with hairstyles, accessories and colors.",
};

export default function CharacterLayout({ children }: { children: React.ReactNode }) {
  return children;
}
