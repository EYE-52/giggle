"use client";
import { useEffect, useState } from "react";

/**
 * Light/Dark theme toggle. Flips `data-theme` on <html> and persists to
 * localStorage. The initial theme is applied pre-paint by the inline script
 * in app/layout.tsx, so this only syncs + handles user toggles.
 */
export function ThemeToggle({ size = 34 }: { size?: number }) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const t = (document.documentElement.getAttribute("data-theme") as "dark" | "light") || "dark";
    setTheme(t);
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("giggle.theme", next); } catch {}
  };

  const isDark = theme === "dark";
  return (
    <button
      onClick={toggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: hovered ? "var(--overlay-hover)" : "var(--overlay)",
        border: "1px solid var(--border)",
        cursor: "pointer",
        transition:
          "background-color var(--dur) var(--ease-inout), border-color var(--dur) var(--ease-inout), transform var(--dur) var(--ease-out)",
        color: "var(--text-muted)",
      }}
    >
      <span
        style={{
          position: "relative",
          width: 18,
          height: 18,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* moon */}
        <svg
          width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{
            position: "absolute",
            opacity: isDark ? 1 : 0,
            transform: isDark ? "rotate(0deg) scale(1)" : "rotate(-90deg) scale(0.6)",
            transition: "opacity 0.28s var(--ease-inout), transform 0.28s var(--ease-out)",
          }}
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        {/* sun */}
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          style={{
            position: "absolute",
            opacity: isDark ? 0 : 1,
            transform: isDark ? "rotate(90deg) scale(0.6)" : "rotate(0deg) scale(1)",
            transition: "opacity 0.28s var(--ease-inout), transform 0.28s var(--ease-out)",
          }}
        >
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      </span>
    </button>
  );
}
