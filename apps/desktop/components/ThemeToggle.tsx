"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Theme registry — ONE entry here + one [data-theme] CSS block in
 * app/globals.css (+ the id in public/theme-init.js) adds a theme.
 * `bg`/`accent` power the tiny color-dot preview in the menu.
 * `coverStyle` picks which squad-cover gradient family the theme uses
 * (see components/covers.ts): "dark" moody covers vs "light" pastel covers.
 */
export const THEMES = [
  // Ids stay "dark"/"light" for localStorage compat; labels are the v3 names.
  { id: "dark", label: "Midnight", bg: "#0E0D12", accent: "#6D52FF", coverStyle: "dark" },
  { id: "light", label: "Cloud", bg: "#F7F7F9", accent: "#5B3DF5", coverStyle: "light" },
  { id: "tangerine", label: "Tangerine Pop", bg: "#E7EFFF", accent: "#FF521F", coverStyle: "light" },
] as const;

export type ThemeId = (typeof THEMES)[number]["id"];

function applyTheme(id: ThemeId) {
  document.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem("giggle.theme", id);
  } catch {}
}

function ThemeDot({ bg, accent, size = 16 }: { bg: string; accent: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: 6,
        background: bg,
        boxShadow: "inset 0 0 0 1px var(--border-strong)",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          right: 2,
          bottom: 2,
          width: size * 0.45,
          height: size * 0.45,
          borderRadius: 999,
          background: accent,
        }}
      />
    </span>
  );
}

/**
 * Theme menu button (replaces the old moon/sun toggle; keeps the export
 * name so call sites don't change). Opens a small popover listing all
 * registered themes with a color-dot preview. Accessible: aria-expanded,
 * menuitemradio + aria-checked, arrow-key navigation, Escape and
 * click-outside close, focus returns to the trigger.
 */
export function ThemeToggle({ size = 44 }: { size?: number }) {
  const [theme, setTheme] = useState<ThemeId>("dark");
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const t = document.documentElement.getAttribute("data-theme") as ThemeId | null;
    if (t && THEMES.some((x) => x.id === t)) setTheme(t);
  }, []);

  // Position the portaled menu under the trigger; recompute on open, and close
  // on scroll/resize so it never floats detached from a moved trigger.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    const onScrollResize = () => setOpen(false);
    window.addEventListener("resize", onScrollResize);
    window.addEventListener("scroll", onScrollResize, true);
    return () => {
      window.removeEventListener("resize", onScrollResize);
      window.removeEventListener("scroll", onScrollResize, true);
    };
  }, [open]);

  // Close on outside click / Escape while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Move focus to the active theme's item when the menu opens.
  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, THEMES.findIndex((t) => t.id === theme));
    itemRefs.current[idx]?.focus();
  }, [open, theme]);

  const select = (id: ThemeId) => {
    setTheme(id);
    applyTheme(id);
    setOpen(false);
    btnRef.current?.focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const idx = itemRefs.current.findIndex((el) => el === document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const dir = e.key === "ArrowDown" ? 1 : -1;
      const next = (idx + dir + THEMES.length) % THEMES.length;
      itemRefs.current[next]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      itemRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      itemRefs.current[THEMES.length - 1]?.focus();
    }
  };

  const active = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={`Theme: ${active.label}. Choose theme`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose theme"
        className="gg-press gg-focusable"
        style={{
          width: size,
          height: size,
          borderRadius: 10,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: open || hovered ? "var(--overlay-hover)" : "var(--overlay)",
          border: "var(--control-border)",
          cursor: "pointer",
          transition:
            "background-color var(--dur) var(--ease-inout), border-color var(--dur) var(--ease-inout), transform var(--dur) var(--ease-out)",
          color: open || hovered ? "var(--text)" : "var(--text-muted)",
        }}
      >
        {/* palette / swatch glyph */}
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <path d="M12 22a10 10 0 1 1 10-10c0 2.2-1.8 3-3.5 3H16a2.5 2.5 0 0 0-1.8 4.2c.5.6.3 1.8-.7 2.3-.5.3-1 .5-1.5.5z" />
          <circle cx="7.5" cy="11.5" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="11" cy="7.5" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="15.5" cy="9" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      </button>

      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Choose theme"
          className="gg-reveal"
          onKeyDown={onMenuKeyDown}
          style={{
            position: "fixed",
            top: pos.top,
            right: pos.right,
            zIndex: 1300,
            minWidth: 178,
            padding: 6,
            background: "var(--surface)",
            border: "var(--control-border)",
            borderRadius: "var(--radius-control)",
            boxShadow: "var(--shadow-pop)",
          }}
        >
          {THEMES.map((t, i) => {
            const selected = t.id === theme;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => select(t.id)}
                className="gg-focusable"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  minHeight: 40,
                  padding: "0 10px",
                  borderRadius: "calc(var(--radius-control) - 6px)",
                  border: "none",
                  background: selected ? "var(--overlay-hover)" : "transparent",
                  color: "var(--text)",
                  fontFamily: "var(--font-body)",
                  fontSize: 13.5,
                  fontWeight: selected ? 800 : 600,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <ThemeDot bg={t.bg} accent={t.accent} />
                <span style={{ flex: 1 }}>{t.label}</span>
                {selected && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)"
                    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
