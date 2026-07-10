"use client";
import { colors, radii } from "./tokens";
import { CSSProperties, ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  style?: CSSProperties;
  glow?: boolean;
}

export function Card({ children, style, glow }: CardProps) {
  return (
    <div
      style={{
        background: colors.surface,
        borderRadius: radii.card,
        border: `1px solid ${colors.border}`,
        padding: 24,
        boxShadow: glow ? "0 0 34px -6px rgba(124,92,255,0.4)" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
