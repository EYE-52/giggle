import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lobby · Giggle",
  description: "Gather your squad, set your join policy, and get ready to match.",
};

export default function LobbyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
