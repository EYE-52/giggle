import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Profile · Giggle",
  description: "Manage your Giggle profile, avatar, vibes, and match preferences.",
};

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children;
}
