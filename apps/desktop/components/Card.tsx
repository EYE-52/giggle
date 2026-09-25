"use client";
import { CSSProperties, ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  style?: CSSProperties;
  glow?: boolean;
}

/* Surface colors live in globals.css (.gg-card / .gg-card--glow) so palettes
 * and skins can restyle the card; `card` is the skin-system hook. */
export function Card({ children, style, glow }: CardProps) {
  return (
    <div className={`gg-card card${glow ? " gg-card--glow" : ""}`} style={style}>
      {children}
    </div>
  );
}
