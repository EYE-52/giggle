"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { packVideoFeeds } from "@giggle/core";
import styles from "./CallLayoutCheck.module.css";

export type PreviewParticipant = { id: string; cameraOn: boolean; aspectRatio: number };

function SquadFrames({ people, label, pageSize, renderPerson, own = false }: {
  people: PreviewParticipant[];
  label: string;
  pageSize: number;
  renderPerson: (id: string) => ReactNode;
  own?: boolean;
}) {
  const [requestedPage, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(people.length / pageSize));
  const page = Math.min(requestedPage, pageCount - 1);
  const visible = people.slice(page * pageSize, (page + 1) * pageSize);
  const canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  const ratios = visible.map(person => person.cameraOn ? person.aspectRatio : 1).join(",");
  const layout = useMemo(() => packVideoFeeds(ratios ? ratios.split(",").map(Number) : [], size.width, size.height), [ratios, size]);
  return <section className={styles.naturalGroup} data-own={own} aria-label={label}>
    <header className={styles.squadHeading}>
      <span>{label} <small>{people.length}</small></span>
      {pageCount > 1 && <div className={styles.pager}>
        <button disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={`Previous people in ${label}`}>‹</button>
        <span aria-live="polite">{page + 1} / {pageCount}</span>
        <button disabled={page === pageCount - 1} onClick={() => setPage(page + 1)} aria-label={`Next people in ${label}`}>›</button>
      </div>}
    </header>
    <div ref={canvas} className={styles.naturalCanvas}>
      {visible.map((person, index) => {
        const frame = layout.tiles[index];
        return <div key={person.id} className={styles.naturalTile} style={{ left: frame?.x, top: frame?.y, width: frame?.width ?? 0, height: frame?.height ?? 0 }}>
          {renderPerson(person.id)}
        </div>;
      })}
    </div>
  </section>;
}

/** Preview the restored camera-shaped layout before changing the live call UI. */
export function CallPreviewStage({ mine, theirs, renderPerson }: {
  mine: PreviewParticipant[];
  theirs: PreviewParticipant[];
  renderPerson: (id: string) => ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(true);
  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth > 0) setCompact(element.clientWidth < 650);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  return <div ref={host} className={styles.naturalStage} data-compact={compact}>
    <SquadFrames people={theirs} label="The weekend club" pageSize={compact ? 2 : 8} renderPerson={renderPerson} />
    <SquadFrames people={mine} label="Your squad" pageSize={compact ? 2 : 4} renderPerson={renderPerson} own />
  </div>;
}
