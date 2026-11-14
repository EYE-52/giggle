import type { Metadata } from "next";
import { PRIVATE_METADATA } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  ...PRIVATE_METADATA,
  title: "Sign-in status · Giggle",
};

export default function AuthCallbackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
