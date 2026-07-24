"use client";
import type React from "react";
import { useViewport } from "./useViewport";

/**
 * Standard page header used across the signed-in app (Home, Discover, Profile).
 * One consistent skeleton: optional eyebrow, a title, an optional subtitle, and
 * an optional right-hand slot for a primary action or filter controls. Keeping
 * this shared enforces the same vertical rhythm on every page.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
}) {
  const { isPhone } = useViewport();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 24,
        flexWrap: "wrap",
        marginBottom: 22,
      }}
    >
      <div style={{ minWidth: 0, maxWidth: 640 }}>
        {eyebrow && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontSize: 12, /* v3 micro tier (min 12px) */
              fontWeight: 800,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "var(--text-dim)",
              marginBottom: 9,
            }}
          >
            {eyebrow}
          </div>
        )}
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: isPhone ? 26 : 30,
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
            color: "var(--text)",
            textWrap: "balance" as React.CSSProperties["textWrap"],
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            style={{
              margin: "7px 0 0",
              fontSize: 14,
              color: "var(--text-muted)",
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {right && <div style={{ minWidth: 0, maxWidth: "100%" }}>{right}</div>}
    </div>
  );
}
