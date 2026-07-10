import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign-in status · Giggle",
};

export default function AuthCallbackLayout({ children }: { children: React.ReactNode }) {
  return children;
}
