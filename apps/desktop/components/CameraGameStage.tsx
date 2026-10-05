"use client";
import { useLayoutEffect, useMemo, useState, type RefObject } from "react";
import { arrangeCameraStage } from "@/lib/cameraStage";
import type { GameCameraScene } from "@/lib/gameBridge";
import styles from "./CameraGameStage.module.css";

export function CameraGameCaption({ scene }: { scene: GameCameraScene | null }) {
  return <div className={styles.caption} data-testid="camera-game-caption" role="status" aria-live="polite">
    <span aria-hidden="true">✦</span><strong>{scene?.caption || "Your friends are the playfield"}</strong>
  </div>;
}

export function useCameraTiles(ref: RefObject<HTMLElement | null>, ids: string[], featured: string | null, active: boolean) {
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setBounds(old => old.width === width && old.height === height ? old : { width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el); measure();
    return () => observer.disconnect();
  }, [ref, active]);
  const key = ids.join("|");
  return useMemo(() => new Map(arrangeCameraStage(key ? key.split("|") : [], bounds.width, Math.max(1, bounds.height - 44), featured)
    .map(tile => [tile.id, { left: tile.x, top: tile.y + 44, width: tile.width, height: tile.height }])), [key, bounds, featured]);
}
