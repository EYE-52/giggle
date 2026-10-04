"use client";
import type React from "react";
import { Button } from "./Button";
import styles from "./EmptyState.module.css";

/* Layout lives here; surfaces and actions use the active skin's shared paint. */
export function EmptyState({
  icon,
  title,
  body,
  primary,
  secondary,
  compact = false,
  accentColor = "var(--accent)",
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  primary?: { label: string; onClick: () => void; disabled?: boolean };
  secondary?: { label: string; onClick: () => void; disabled?: boolean };
  /** When true, renders as a single tight row (for rails/panels). */
  compact?: boolean;
  /** Optional icon color; the surrounding material still follows the skin. */
  accentColor?: string;
}) {
  return (
    <div className={`card ${styles.root} ${compact ? styles.compact : ""}`}>
      {icon && <div className={styles.icon} style={{ color: accentColor }} aria-hidden="true">{icon}</div>}
      <div className={styles.copy}>
        <div className={styles.title}>{title}</div>
        {body && <div className={styles.body}>{body}</div>}
      </div>
      {(primary || secondary) && (
        <div className={styles.actions}>
          {secondary && <Button size="sm" variant="secondary" onClick={secondary.onClick} disabled={secondary.disabled}>{secondary.label}</Button>}
          {primary && <Button size="sm" onClick={primary.onClick} disabled={primary.disabled}>{primary.label}</Button>}
        </div>
      )}
    </div>
  );
}
