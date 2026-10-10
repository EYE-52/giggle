"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { arrangeFocusCall, CROP_LIMIT, MAX_WEIGHT, normalizeVideoRatio, videoCrop, type FocusPerson } from "@giggle/core";
import styles from "./FocusVideoStage.module.css";
import { arrangeCameraStage } from "@/lib/cameraStage";
import type { GameCameraScene } from "@/lib/gameBridge";

/** What a tile needs to offer "bigger / smaller / keep this size" for its person. */
export type TileSizeControls = {
  weight: number;
  pinned: boolean;
  canGrow: boolean;
  canShrink: boolean;
  grow: () => void;
  shrink: () => void;
  /** Double-click: 1× → 2× → 4× → 1×. */
  cycle: () => void;
  togglePin: () => void;
  /** Fill the tile (light crop) or show the whole picture (the shapes differ too much to crop). */
  fit: "crop" | "fit";
};

/**
 * The call stage: every person's video fills a same-size tile in their squad's
 * block (their squad left/top, yours right/bottom). Each viewer can make someone
 * bigger or smaller (everyone else re-flows) or keep someone at their current size
 * (nothing anyone else does resizes them). Zoom and pins are local to this viewer.
 *
 * Every tile is a sibling in one list keyed by person, so layout changes only move
 * existing media hosts; they never remount video or restart the call.
 */
export function FocusVideoStage({ mine, theirs, mineLabel, theirsLabel, renderParticipant, videoOn = {}, selfId, cameraScene }: {
  mine: string[];
  theirs: string[];
  mineLabel: string;
  theirsLabel: string;
  renderParticipant: (id: string, size: TileSizeControls) => ReactNode;
  /** Whose camera is on; their tiles follow their camera's shape. */
  videoOn?: Record<string, boolean>;
  /** The viewer: their own tile stays smaller than the people they are talking to. */
  selfId?: string;
  cameraScene?: GameCameraScene | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  // Each camera's shape, read from its <video> as frames arrive (and when a phone rotates).
  const [ratios, setRatios] = useState<Record<string, number>>({});
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const bound = new Set<HTMLVideoElement>();
    const measure = () => {
      const next: Record<string, number> = {};
      element.querySelectorAll<HTMLElement>("[data-participant-id]").forEach(cell => {
        const video = cell.querySelector<HTMLVideoElement>("[data-media-host] video");
        if (video && video.videoWidth > 0 && video.videoHeight > 0) next[cell.dataset.participantId!] = normalizeVideoRatio(video.videoWidth / video.videoHeight);
      });
      setRatios(previous => {
        const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
        for (const key of keys) if (Math.abs((previous[key] ?? 0) - (next[key] ?? 0)) > 0.02) return next;
        return previous;
      });
    };
    const bind = () => {
      element.querySelectorAll<HTMLVideoElement>("[data-media-host] video").forEach(video => {
        if (bound.has(video)) return;
        bound.add(video);
        video.addEventListener("loadedmetadata", measure);
        video.addEventListener("resize", measure);
      });
      measure();
    };
    const observer = new MutationObserver(bind);
    observer.observe(element, { childList: true, subtree: true });
    bind();
    return () => {
      observer.disconnect();
      bound.forEach(video => { video.removeEventListener("loadedmetadata", measure); video.removeEventListener("resize", measure); });
    };
  }, []);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [pins, setPins] = useState<Record<string, { width: number; height: number }>>({});
  // Tiles glide only in response to a zoom or pin; first layout, resizes and people
  // joining snap into place (nothing slides around while the window changes size).
  const [animating, setAnimating] = useState(false);
  const animTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glide = () => {
    setAnimating(true);
    if (animTimer.current) clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setAnimating(false), 450);
  };
  useEffect(() => () => { if (animTimer.current) clearTimeout(animTimer.current); }, []);

  // forget zoom/pins for people who left
  const ids = [...mine, ...theirs].join("|");
  useEffect(() => {
    const present = new Set(ids.split("|"));
    const keep = <T,>(record: Record<string, T>) => {
      const next = Object.fromEntries(Object.entries(record).filter(([id]) => present.has(id)));
      return Object.keys(next).length === Object.keys(record).length ? record : next;
    };
    setWeights(keep);
    setPins(keep);
  }, [ids]);

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      // No animation frames here: browsers pause them for a call tab in the background.
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      if (width <= 0 || height <= 0) return;
      // Rotation/viewport changes must snap even during a previous zoom or pin glide.
      // Removing the transition rule can leave an already-running CSS transition alive.
      element.querySelectorAll<HTMLElement>("[data-participant-id]").forEach(cell => {
        cell.getAnimations().forEach(animation => {
          if ('transitionProperty' in animation && ["left", "top", "width", "height"].includes(String(animation.transitionProperty))) animation.cancel();
        });
      });
      if (animTimer.current) { clearTimeout(animTimer.current); animTimer.current = null; }
      setAnimating(false);
      setBounds(previous => (previous.width === width && previous.height === height ? previous : { width, height }));
    });
    observer.observe(element);
    const initial = element.getBoundingClientRect();
    setBounds({ width: Math.floor(initial.width), height: Math.floor(initial.height) });
    return () => observer.disconnect();
  }, []);

  // The call re-renders every second (timer, speaking); the layout only follows
  // real changes: who is here, whose camera is on, camera shapes, zoom, pins, size.
  const videoKey = Object.keys(videoOn).filter(id => videoOn[id]).sort().join("|");
  const aspectOf = useCallback((id: string) => (videoKey.split("|").includes(id) ? ratios[id] ?? null : null), [videoKey, ratios]);
  const toPerson = useCallback((id: string): FocusPerson => ({ id, weight: weights[id] ?? 1, pinned: pins[id] ?? null, aspect: aspectOf(id), self: id === selfId }), [weights, pins, aspectOf, selfId]);
  const mineKey = mine.join("|"), theirsKey = theirs.join("|");
  const layout = useMemo(
    () => cameraScene
      ? { tiles: arrangeCameraStage([...mine, ...theirs], bounds.width, bounds.height, cameraScene.mode === "spotlight" ? cameraScene.featured : null), stacked: false }
      : arrangeFocusCall(mineKey ? mineKey.split("|").map(toPerson) : [], theirsKey ? theirsKey.split("|").map(toPerson) : [], bounds.width, bounds.height),
    [mineKey, theirsKey, toPerson, bounds.width, bounds.height, cameraScene],
  );
  const tileById = useMemo(() => new Map(layout.tiles.map(tile => [tile.id, tile])), [layout]);

  const controlsFor = (id: string): TileSizeControls => {
    const weight = weights[id] ?? 1;
    const pinned = !!pins[id];
    const set = (value: number) => { glide(); setWeights(previous => ({ ...previous, [id]: Math.max(1, Math.min(MAX_WEIGHT, value)) })); };
    return {
      weight,
      pinned,
      canGrow: !pinned && weight < MAX_WEIGHT,
      canShrink: !pinned && weight > 1,
      grow: () => set(weight * 2),
      shrink: () => set(weight / 2),
      cycle: () => { if (!pinned) set(weight >= MAX_WEIGHT ? 1 : weight * 2); },
      fit: (() => { const tile = tileById.get(id); return tile && videoCrop(tile.width, tile.height, aspectOf(id)) > CROP_LIMIT ? "fit" : "crop"; })(),
      togglePin: () => { glide(); setPins(previous => {
        const next = { ...previous };
        if (next[id]) delete next[id];
        else {
          const tile = tileById.get(id);
          if (tile) next[id] = { width: Math.round(tile.width), height: Math.round(tile.height) };
        }
        return next;
      }); },
    };
  };

  const group = (side: "mine" | "theirs", people: string[], label: string) => (
    <div role="group" aria-label={`${label} · ${people.length}`} className={styles.group} data-side={side}>
      {people.map(id => {
        const tile = tileById.get(id);
        const size = controlsFor(id);
        return (
          <div
            key={id}
            className={`${styles.cell} vcell`}
            data-participant-id={id}
            data-side={side}
            data-camera-featured={cameraScene?.mode === "spotlight" && cameraScene.featured === id || undefined}
            data-weight={size.weight}
            data-pinned={size.pinned || undefined}
            // edge marks let the floating header and controls push labels clear
            data-edge-top={tile && tile.y <= 2 ? "" : undefined}
            data-edge-bottom={tile && tile.y + tile.height >= bounds.height - 2 ? "" : undefined}
            style={{ left: tile?.x ?? 0, top: tile?.y ?? 0, width: tile?.width ?? 1, height: tile?.height ?? 1 }}
          >
            {renderParticipant(id, size)}
          </div>
        );
      })}
    </div>
  );

  return (
    <div ref={host} className={`${styles.stage} vstage`} data-adaptive-video-stage data-focus-stage data-stacked={layout.stacked || undefined} data-animating={animating || undefined}>
      {group("theirs", theirs, theirsLabel)}
      {group("mine", mine, mineLabel)}
    </div>
  );
}
