import * as React from "react";

/**
 * Giggle logomark — three balanced "squad" circles flowing through one cohesive
 * violet→lime gradient, with crisp separators and a soft glow. Clean + scalable.
 */
export function Logomark({ size = 32, glow = true }: { size?: number; glow?: boolean }) {
  const id = React.useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <defs>
        <linearGradient id={`${id}-g`} x1="10" y1="10" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#9278FF" />
          <stop offset="0.55" stopColor="#6C8BFF" />
          <stop offset="1" stopColor="#B7FF2A" />
        </linearGradient>
        {glow && (
          <filter id={`${id}-f`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="1.1" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      {/* crisp separators: each circle gets a thin bg-colored ring so overlaps read clean */}
      <g filter={glow ? `url(#${id}-f)` : undefined}>
        <g stroke="#0B0B0F" strokeWidth="2.4" fill={`url(#${id}-g)`}>
          <circle cx="24" cy="15" r="9.5" />
          <circle cx="15.5" cy="31" r="9.5" />
          <circle cx="32.5" cy="31" r="9.5" />
        </g>
        {/* subtle inner highlight on the top circle for dimension */}
        <circle cx="21" cy="12" r="2.6" fill="#FFFFFF" opacity="0.35" />
      </g>
    </svg>
  );
}

/** Full lockup: logomark + "Giggle" wordmark in Space Grotesk. */
export function Wordmark({ size = 22, mark = true }: { size?: number; mark?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
      {mark && <Logomark size={size * 1.05} />}
      <span
        style={{
          fontFamily: "var(--font-space-grotesk), 'Space Grotesk', sans-serif",
          fontWeight: 700,
          fontSize: size,
          letterSpacing: "-0.02em",
          color: "var(--text, #F4F4F7)",
        }}
      >
        Giggle
      </span>
    </span>
  );
}
