/* Authority may finish before a game's final animation does. A game can
 * acknowledge presentation readiness; only a live-to-done transition in
 * this mount may celebrate, never a reconnect or stale child document. */
export function createResultPresentation(celebrate) {
  let current = null, pending = null;
  function ready(instanceId) {
    if (!pending || pending.instanceId !== instanceId || pending.instanceId !== current) return false;
    const result = pending; pending = null;
    celebrate(result);
    return true;
  }
  function observe(previous, snapshot, deferred = false) {
    const instanceId = snapshot?.instanceId;
    if (instanceId !== current) { current = instanceId; pending = null; }
    if (snapshot?.audioBaseline || snapshot?.phase !== 'done') { pending = null; return; }
    if (!instanceId || previous?.instanceId !== instanceId || previous.game !== snapshot.game || previous.phase === 'done') return;
    pending = snapshot;
    if (!deferred) ready(instanceId);
  }
  function reset() { current = null; pending = null; }
  return { observe, ready, reset };
}
