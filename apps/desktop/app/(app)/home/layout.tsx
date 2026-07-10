import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Home · Giggle",
  description: "Create a squad, pick a vibe, and start meeting new people together.",
};

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
