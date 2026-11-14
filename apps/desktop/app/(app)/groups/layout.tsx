import type { Metadata } from "next";
import { PRIVATE_METADATA } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  ...PRIVATE_METADATA,
  title: "Groups · Giggle Meet",
};

export default function GroupsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
