"use client";
import { useState, useEffect } from "react";

/**
 * Responsive viewport hook. SSR-safe: starts at a desktop default (matches the
 * static prerender), then syncs to the real width after mount. Use the booleans
 * to collapse multi-column layouts on tablet/phone.
 */
export function useViewport() {
  const [width, setWidth] = useState(1280);
  const [height, setHeight] = useState(900);
  useEffect(() => {
    const onResize = () => {
      setWidth(window.innerWidth);
      setHeight(window.innerHeight);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return {
    width,
    height,
    isPhone: width <= 640,
    isTablet: width <= 980,
    isNarrow: width <= 980,
  };
}
