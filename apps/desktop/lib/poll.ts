/**
 * setInterval that skips ticks while the tab is hidden and runs once as soon
 * as the tab becomes visible again. Keeps background tabs from hammering the
 * API while still refreshing immediately when the user comes back.
 * Returns a cleanup function.
 */
export function pollWhileVisible(fn: () => unknown, ms: number): () => void {
  const tick = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    void fn();
  };
  const timer = setInterval(tick, ms);
  const onVisible = () => {
    if (!document.hidden) void fn();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
