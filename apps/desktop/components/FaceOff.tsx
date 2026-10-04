"use client";

import type { ReactNode } from "react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { Icon } from "@/components/Icons";
import { session } from "@giggle/core";
import styles from "./FaceOff.module.css";

export const faceOffStyles = styles;

/** Back (or cancel) plus the squad name, matching the lobby bar. */
export function FaceOffBar({ onBack, backLabel, title, busy = false }: { onBack: () => void; backLabel: string; title?: string; busy?: boolean }) {
  return (
    <header className={styles.bar}>
      <button type="button" className={`icon-btn ${styles.iconBtn}`} aria-label={backLabel} onClick={onBack} disabled={busy}><Icon.chevron size={20} /></button>
      <h1 className={styles.title}>{title ?? "\u00a0"}</h1>
    </header>
  );
}

export type FaceOffPerson = { userId?: string; displayName: string; avatar?: string | null };
export type FaceOffSide = { name: string; people: FaceOffPerson[] };

/**
 * The squad-meets-squad screen shared by matchmaking and the match handoff:
 * your squad on one side, the other squad (or the search for one) on the
 * other, a status line and the actions underneath. Phones stack the sides the
 * way the call does: their squad on top, yours below.
 */
export function FaceOff({ mine, theirs, searching = false, status, actions, top }: {
  mine: FaceOffSide | null;
  /** null while searching or loading */
  theirs: FaceOffSide | null;
  searching?: boolean;
  status: ReactNode;
  actions?: ReactNode;
  top?: ReactNode;
}) {
  return (
    <div className={styles.page}>
      {top}
      <div className={styles.arena} data-state={theirs ? "matched" : searching ? "searching" : "loading"} data-count={Math.max(mine?.people.length ?? 3, theirs?.people.length ?? 3)}>
        <Side side={theirs} placeholder={searching ? "Looking for a squad" : ""} kind="theirs" />
        <div className={styles.vs} aria-hidden="true">{theirs ? "vs" : <span className={styles.dots}><i /><i /><i /></span>}</div>
        <Side side={mine} kind="mine" />
      </div>
      <div className={styles.foot}>
        <div role="status" aria-live="polite" className={styles.status}>{status}</div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}

function Side({ side, placeholder = "", kind }: { side: FaceOffSide | null; placeholder?: string; kind: "mine" | "theirs" }) {
  const me = session.user?.id;
  const people = side?.people ?? [];
  const count = side ? Math.max(1, people.length) : 3;
  return (
    <section className={`card ${styles.side}`} data-side={kind} aria-label={side ? side.name : placeholder || "Loading"}>
      <div className={styles.people} data-count={Math.min(count, 8)}>
        {side
          ? people.map((person, index) => (
              <span key={person.userId ?? `${person.displayName}-${index}`} className={styles.face} title={person.displayName}>
                <PersonAvatar userId={person.userId} name={person.displayName} avatar={person.avatar} isMe={!!me && person.userId === me} size="fill" />
              </span>
            ))
          : Array.from({ length: 3 }, (_, index) => <span key={index} className={`${styles.face} ${styles.empty}`} style={{ animationDelay: `${index * 0.35}s` }} />)}
      </div>
      <div className={styles.name}>{side ? side.name : placeholder || " "}</div>
      <div className={`muted ${styles.who}`}>
        {side ? people.map(person => (person.userId && person.userId === me ? "You" : person.displayName)).join(", ") : " "}
      </div>
    </section>
  );
}
