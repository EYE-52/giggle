import type { Metadata } from "next";
import { PRIVATE_METADATA } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  ...PRIVATE_METADATA,
  title: "Profile · Giggle",
  description: "Manage your Giggle profile, avatar, vibes, and match preferences.",
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
