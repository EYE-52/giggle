import type { Metadata } from "next";
import { PRIVATE_METADATA } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  ...PRIVATE_METADATA,
  title: "Lobby · Giggle",
  description: "Gather your squad, set your join policy, and get ready to match.",
};

export default function LobbyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
