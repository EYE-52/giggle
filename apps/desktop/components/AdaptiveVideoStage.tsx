"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { arrangeVideoCall, normalizeVideoRatio, type Tile } from "@giggle/core";
import styles from "./AdaptiveVideoStage.module.css";

export type AdaptiveParticipant = { id: string; cameraOn: boolean; aspectRatio?: number };

function CameraCell({ person, tile, onRatio, children }: {
  person: AdaptiveParticipant;
  tile?: Tile;
  onRatio: (id: string, ratio: number) => void;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let video: HTMLVideoElement | null = null;
    const report = () => {
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        onRatio(person.id, normalizeVideoRatio(video.videoWidth / video.videoHeight));
      }
    };
    const bind = () => {
      const next = element.querySelector<HTMLVideoElement>("[data-media-host] video");
      if (video !== next) {
        video?.removeEventListener("loadedmetadata", report);
        video?.removeEventListener("resize", report);
        video = next;
        video?.addEventListener("loadedmetadata", report);
        video?.addEventListener("resize", report);
      }
      report();
    };
    const observer = new MutationObserver(bind);
    observer.observe(element, { childList: true, subtree: true });
    bind();
    return () => {
      observer.disconnect();
      video?.removeEventListener("loadedmetadata", report);
      video?.removeEventListener("resize", report);
    };
  }, [person.id, onRatio]);
  return <div ref={host} className={styles.cell} data-participant-id={person.id} style={{
    left: tile?.x ?? 0, top: tile?.y ?? 0, width: tile?.width ?? 1, height: tile?.height ?? 1,
  }}>{children}</div>;
}

/** Layout changes only move existing media hosts; they never restart the call. */
export function AdaptiveVideoStage({ mine, theirs, mineLabel, theirsLabel, renderParticipant }: {
  mine: AdaptiveParticipant[];
  theirs: AdaptiveParticipant[];
  mineLabel: string;
  theirsLabel: string;
  renderParticipant: (id: string) => ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const ids = JSON.stringify([...mine, ...theirs].map(p => p.id));
  useEffect(() => {
    const current = new Set<string>(JSON.parse(ids));
    setRatios(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => current.has(id))));
  }, [ids]);
  const onRatio = useCallback((id: string, ratio: number) => {
    setRatios(previous => Math.abs((previous[id] ?? 0) - ratio) < 0.01 ? previous : { ...previous, [id]: ratio });
  }, []);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      // React batches the observer update. Do not wait for animation frames:
      // browsers can pause them while a call tab is in the background.
      const width = Math.floor(entry.contentRect.width);
      const height = Math.floor(entry.contentRect.height);
      if (width <= 0 || height <= 0) return;
      setBounds(previous => previous.width === width && previous.height === height ? previous : { width, height });
    });
    observer.observe(element);
    const initial = element.getBoundingClientRect();
    setBounds({ width: Math.floor(initial.width), height: Math.floor(initial.height) });
    return () => observer.disconnect();
  }, []);
  const mineRatios = JSON.stringify(mine.map(p => p.cameraOn ? ratios[p.id] ?? normalizeVideoRatio(p.aspectRatio) : 1));
  const theirRatios = JSON.stringify(theirs.map(p => p.cameraOn ? ratios[p.id] ?? normalizeVideoRatio(p.aspectRatio) : 1));
  const layout = useMemo(() => arrangeVideoCall(JSON.parse(mineRatios), JSON.parse(theirRatios), bounds.width, bounds.height),
    [mineRatios, theirRatios, bounds.width, bounds.height]);
  return <div ref={host} className={styles.stage} data-adaptive-video-stage>
    <div className={styles.groups} style={{ flexDirection: layout.stacked ? "column" : "row", justifyContent: "center", gap: layout.gap }}>
      {([
        { id: "theirs", people: theirs, label: theirsLabel, box: layout.theirs },
        { id: "mine", people: mine, label: mineLabel, box: layout.mine },
      ] as const).map(group => <section key={group.id} className={styles.group} aria-label={group.label}
        style={{ display: group.people.length ? "block" : "none", width: group.box.width, height: group.box.height }}>
        <div className={styles.label} style={{ height: layout.label }}><span>{group.label}</span><span>{group.people.length}</span></div>
        <div className={styles.feeds} style={{ top: layout.label }}>
          {group.people.map((person, index) => <CameraCell key={person.id} person={person} tile={group.box.tiles[index]} onRatio={onRatio}>
            {renderParticipant(person.id)}
          </CameraCell>)}
        </div>
      </section>)}
    </div>
  </div>;
}
