"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Logomark } from "@/components/Brand";
import { Button } from "@/components/Button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App route error:", error);
  }, [error]);

  return (
    <div
      role="alert"
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        textAlign: "center",
        padding: "48px 24px",
        background: "var(--bg)",
        color: "var(--text)",
      }}
    >
      <Logomark size={44} />
      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
            fontSize: 26,
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "var(--text)",
          }}
        >
          Something went wrong
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 14.5, color: "var(--text-muted)", maxWidth: 380, lineHeight: 1.5 }}>
          An unexpected error interrupted the party. Try again, or head back home.
        </p>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <Button onClick={() => reset()}>Try again</Button>
        <Link
          href="/home"
          className="gg-press gg-focusable"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 44,
            padding: "0 24px",
            borderRadius: 999,
            border: "1px solid var(--border-strong)",
            background: "transparent",
            color: "var(--text-body)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontWeight: 700,
            fontSize: 15,
          }}
        >
          Home
        </Link>
      </div>
    </div>
  );
}
