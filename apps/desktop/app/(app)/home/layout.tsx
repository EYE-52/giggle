import type { Metadata } from "next";
import { PRIVATE_METADATA } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  ...PRIVATE_METADATA,
  title: "Home · Giggle",
  description: "Create a squad, pick a vibe, and start meeting new people together.",
};

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
