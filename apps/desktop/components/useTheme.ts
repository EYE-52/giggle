"use client";
import { useSyncExternalStore } from "react";
import { THEMES, type ThemeId } from "@/components/ThemeToggle";

/**
 * Live current theme id, read from <html data-theme="…">.
 * - SSR-safe: server snapshot is "together" (theme-init.js sets the real value
 *   before first paint, so hydration settles immediately).
 * - Subscribes via MutationObserver so theme switches re-render consumers.
 */

function readTheme(): ThemeId {
  if (typeof document === "undefined") return "together";
  const t = document.documentElement.getAttribute("data-theme");
  return THEMES.some((x) => x.id === t) ? (t as ThemeId) : "together";
}

function subscribe(onChange: () => void): () => void {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(subscribe, readTheme, () => "together" as ThemeId);
}
