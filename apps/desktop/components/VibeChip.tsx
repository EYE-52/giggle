"use client";
import { colors, radii } from "./tokens";
import { CSSProperties } from "react";

interface VibeChipProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

export function VibeChip({ label, active, onClick, style }: VibeChipProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 14px",
        borderRadius: radii.pill,
        background: active ? colors.violetSoft : "transparent",
        border: `1px solid ${active ? colors.violet : colors.border}`,
        color: active ? colors.violet : colors.textSecondary,
        fontFamily: "Inter, sans-serif",
        fontSize: 13,
        fontWeight: 500,
        cursor: onClick ? "pointer" : "default",
        whiteSpace: "nowrap" as const,
        boxSizing: "border-box" as const,
        ...style,
      }}
    >
      {label}
    </button>
  );
}
