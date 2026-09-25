"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { arrangeFocusCall, MAX_WEIGHT, type FocusPerson } from "@giggle/core";
import styles from "./FocusVideoStage.module.css";

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
export function FocusVideoStage({ mine, theirs, mineLabel, theirsLabel, renderParticipant }: {
  mine: string[];
  theirs: string[];
  mineLabel: string;
  theirsLabel: string;
  renderParticipant: (id: string, size: TileSizeControls) => ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
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
      setBounds(previous => (previous.width === width && previous.height === height ? previous : { width, height }));
    });
    observer.observe(element);
    const initial = element.getBoundingClientRect();
    setBounds({ width: Math.floor(initial.width), height: Math.floor(initial.height) });
    return () => observer.disconnect();
  }, []);

  const toPerson = useCallback((id: string): FocusPerson => ({ id, weight: weights[id] ?? 1, pinned: pins[id] ?? null }), [weights, pins]);
  const layout = useMemo(
    () => arrangeFocusCall(mine.map(toPerson), theirs.map(toPerson), bounds.width, bounds.height),
    [mine, theirs, toPerson, bounds.width, bounds.height],
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
            data-weight={size.weight}
            data-pinned={size.pinned || undefined}
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
