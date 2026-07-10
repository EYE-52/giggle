import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In · Giggle",
  description: "Sign in to Giggle and start meeting new squads.",
};

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
