"use client";
import { useState, useEffect } from "react";

/** Match the call CSS; games plus chat need a single stage on tablets. */
export function chatUsesStage(width: number, height: number, games: boolean, lobby = false) {
  return width <= (lobby ? 720 : 699) || (!lobby && width <= 950 && height <= 500) || (games && width < 1180);
}

/** A keyboard changes the visual viewport without always resizing the page.
 * Browser pinch zoom owns its own viewport; it must not shrink the call twice. */
export function visualViewportInset(height: number, viewport: Pick<VisualViewport, "height" | "offsetTop" | "scale"> | null) {
  if (!viewport || !Number.isFinite(height) || !Number.isFinite(viewport.height) || !Number.isFinite(viewport.offsetTop) || viewport.scale > 1.01) return 0;
  return Math.max(0, Math.min(height, height - viewport.height - viewport.offsetTop));
}

/**
 * Responsive viewport hook. SSR-safe: starts at a desktop default (matches the
 * static prerender), then syncs to the real width after mount. Use the booleans
 * to collapse multi-column layouts on tablet/phone.
 */
export function useViewport() {
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(900);
  const [viewportInset, setViewportInset] = useState(0);
  useEffect(() => {
    const onResize = () => {
      setWidth(window.innerWidth);
      setHeight(window.innerHeight);
      setViewportInset(visualViewportInset(window.innerHeight, window.visualViewport));
    };
    onResize();
    window.addEventListener("resize", onResize);
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", onResize);
    viewport?.addEventListener("scroll", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      viewport?.removeEventListener("resize", onResize);
      viewport?.removeEventListener("scroll", onResize);
    };
  }, []);
  return {
    width,
    height,
    viewportInset,
    isPhone: width <= 640,
    isTablet: width <= 980,
    isDesktop: width > 980,
    isWide: width >= 1440,
    isNarrow: width <= 980,
  };
}
