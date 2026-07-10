import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Friends · Giggle",
  description: "Find people, manage friends, and invite them into your squads.",
};

export default function FriendsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
