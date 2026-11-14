import type { Metadata } from "next";
import { PRIVATE_METADATA } from "@/lib/siteMetadata";

export const metadata: Metadata = {
  ...PRIVATE_METADATA,
  title: "Sign In · Giggle",
  description: "Sign in to Giggle and start meeting new squads.",
};

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
