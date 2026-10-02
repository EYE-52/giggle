"use client";

import type { ReactNode } from "react";
import styles from "./CallNotice.module.css";

/**
 * One themed message card for call states (missing link, unavailable, ended,
 * waiting). It is a skin `card`: the active skin paints it, the palette colours
 * it and the skin's fonts set its type. Actions are themed Buttons.
 */
export function CallNotice({ icon, title, children, actions, overlay = false, busy = false, role }: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** Sits over the live call (a dimmed backdrop of the theme's page colour). */
  overlay?: boolean;
  /** Shows the theme's spinner instead of an icon. */
  busy?: boolean;
  role?: "status" | "alert";
}) {
  return (
    <div className={overlay ? styles.overlay : styles.page} role={role}>
      <section className={`card ${styles.card}`} aria-busy={busy || undefined}>
        {busy ? <span className={styles.spinner} aria-hidden="true" /> : icon ? <span className={styles.icon} aria-hidden="true">{icon}</span> : null}
        <h1 className={styles.title}>{title}</h1>
        {children && <div className={`muted ${styles.body}`}>{children}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </section>
    </div>
  );
}
