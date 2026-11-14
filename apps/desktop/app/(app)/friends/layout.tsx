import type { Metadata } from "next";
import { PRIVATE_METADATA } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  ...PRIVATE_METADATA,
  title: "Friends · Giggle",
  description: "Find people, manage friends, and invite them into your squads.",
};

export default function FriendsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
