import { useEffect, useState } from "react";

export type ScreenPresence = { screenSharing?: boolean; screenSharingExpiresAt?: number };
/** Only server-announced, unexpired sources change remote framing. */
export function isScreenSharing(person: ScreenPresence, now = Date.now()): boolean {
  return person.screenSharing === true && (person.screenSharingExpiresAt ?? 0) > now;
}
export function useScreenSharingClock(people: readonly ScreenPresence[]): number {
  const [now, setNow] = useState(() => Date.now());
  const expiry = Math.min(...people.filter(p => p.screenSharing && (p.screenSharingExpiresAt ?? 0) > now).map(p => p.screenSharingExpiresAt!));
  useEffect(() => {
    if (!Number.isFinite(expiry) || expiry <= Date.now()) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, expiry - Date.now()));
    return () => clearTimeout(timer);
  }, [expiry]);
  return Math.max(now, Date.now());
}
export function screenShareError(error: unknown): string {
  const detail = error as { name?: string; code?: string; message?: string } | null;
  const text = `${detail?.name ?? ""} ${detail?.code ?? ""} ${detail?.message ?? ""}`;
  if (/NotAllowed|AbortError|PERMISSION_DENIED|cancel(?:led|ed)|Permission denied/i.test(text)) return "";
  return "Couldn't share your screen. Try again. Check your camera button if it did not restart.";
}
