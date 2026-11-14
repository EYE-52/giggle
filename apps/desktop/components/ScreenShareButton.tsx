"use client";
import { useRef, useState } from "react";
import type { CaptureState, VideoClient } from "@giggle/agora";
import { screenShareError } from "@/lib/screenShareView";
import { Icon } from "./Icons";
import styles from "./ScreenShareButton.module.css";

/** Call start directly from the gesture: waiting for other work loses picker permission. */
export function ScreenShareButton({ client, capture, disabled, onStart, onStop, onError }: {
  client: VideoClient | null; capture: CaptureState; disabled?: boolean;
  onStart: () => Promise<void>; onStop: () => Promise<void>; onError: (message: string) => void;
}) {
  const [pending, setPending] = useState(false), busy = useRef(false);
  if (!client?.supportsScreenShare) return null;
  const active = capture.screen === "active", label = active ? "Stop sharing" : "Share screen";
  function toggle() {
    if (busy.current || disabled || capture.screen === "pending") return;
    busy.current = true; setPending(true); onError("");
    // Do not put an await before this invocation.
    const settled = () => { busy.current = false; setPending(false); };
    try {
      const request = active ? onStop() : onStart();
      void request.catch(error => onError(screenShareError(error))).finally(settled);
    } catch (error) { onError(screenShareError(error)); settled(); }
  }
  return <button type="button" className={styles.button} data-screen-share data-active={active || undefined}
    aria-label={label} aria-pressed={active} aria-busy={pending || capture.screen === "pending"}
    disabled={disabled || pending || capture.screen === "pending"} onClick={toggle}>
    <Icon.screenShare size={20} weight="regular" color="currentColor" /><span className={styles.fullLabel}>{label}</span><span className={styles.shortLabel} aria-hidden="true">{active ? "Stop" : "Share"}</span>
  </button>;
}
