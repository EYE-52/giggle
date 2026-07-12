import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile · Giggle",
  description: "Manage your Giggle profile, avatar, vibes, and account details.",
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
