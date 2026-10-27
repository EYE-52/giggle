/**
 * setInterval that skips ticks while the tab is hidden and runs once as soon
 * as the tab becomes visible again. Keeps background tabs from hammering the
 * API while still refreshing immediately when the user comes back. A slow
 * refresh must finish before another tick can start one.
 * Returns a cleanup function.
 */
export function pollWhileVisible(fn: () => unknown, ms: number): () => void {
  let pending = false;
  let stopped = false;
  const tick = async () => {
    if (stopped || pending || (typeof document !== "undefined" && document.hidden)) return;
    pending = true;
    try {
      await fn();
    } catch (error) {
      console.error("Visible poll failed:", error);
    } finally {
      pending = false;
    }
  };
  const timer = setInterval(tick, ms);
  document.addEventListener("visibilitychange", tick);
  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", tick);
  };
}
