"use client";
import { useSyncExternalStore } from "react";

/**
 * Live resolved color mode ("light" | "dark"), read from
 * <html data-mode="…"> (set by lib/look.ts / theme-init.js from the saved
 * skin+palette+mode look). Used by cover styling to pick dark/bright squad
 * cover gradients.
 * - SSR-safe: server snapshot is "light" (theme-init.js sets the real value
 *   before first paint, so hydration settles immediately).
 * - Subscribes via MutationObserver so look switches re-render consumers.
 */

export type ResolvedThemeMode = "light" | "dark";

function readMode(): ResolvedThemeMode {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-mode") === "dark" ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
  return () => obs.disconnect();
}

export function useTheme(): ResolvedThemeMode {
  return useSyncExternalStore(subscribe, readMode, () => "light" as ResolvedThemeMode);
}
