/* Opt-in game screen controller. Called only from a player gesture: native
 * full screen first, then landscape when supported. No CSS-rotated canvas
 * or forced orientation; unsupported phones retain normal manual rotation.
 * An owner leaving a game releases only the screen state it acquired. */
export function createGameScreen({ doc = document, orientation = globalThis.screen?.orientation,
  beforeChange = () => {}, notify = () => {}, paint = () => {}, isPortrait = () =>
    globalThis.matchMedia?.('(orientation: portrait)').matches, shouldRotate = () => true } = {}) {
  let alive = true, busy = false, ownsFullscreen = false, ownsLock = false;
  const root = doc.documentElement;
  const state = () => ({ busy, fullscreen: ownsFullscreen && doc.fullscreenElement === root });
  function unlock() {
    if (!ownsLock) return;
    ownsLock = false;
    try { orientation?.unlock?.(); } catch { /* browser already released it */ }
  }
  function changed() {
    if (!alive) return;
    if (doc.fullscreenElement !== root) { unlock(); ownsFullscreen = false; }
    beforeChange();
    paint(state());
  }
  doc.addEventListener('fullscreenchange', changed);
  async function leave() {
    unlock();
    if (ownsFullscreen && doc.fullscreenElement === root) {
      try { await doc.exitFullscreen(); } catch { /* system escape still works */ }
    }
    ownsFullscreen = false;
  }
  async function toggle() {
    if (!alive || busy) return;
    busy = true;
    beforeChange();
    paint(state());
    try {
      if (state().fullscreen) { await leave(); return; }
      // A host call or another viewer owns its own full-screen surface.
      // Do not replace that surface or acquire a lock on its behalf.
      if (!doc.fullscreenElement && doc.fullscreenEnabled !== false && root.requestFullscreen) {
        try {
          await root.requestFullscreen();
          ownsFullscreen = doc.fullscreenElement === root;
        } catch { /* denied or unavailable: manual rotation remains useful */ }
      }
      if (!alive) { await leave(); return; }
      const rotate = shouldRotate();
      if (ownsFullscreen && rotate && orientation?.lock) {
        try {
          await orientation.lock('landscape');
          ownsLock = true;
        } catch { /* supported API, unsupported context/device */ }
      }
      if (!alive) { await leave(); return; }
      if (rotate && !ownsLock && isPortrait()) notify('Turn your phone sideways. If it stays upright, turn off rotation lock.');
      else if (!ownsFullscreen && !doc.fullscreenElement) notify('Full screen is unavailable here. You can still play in this window.');
    } finally {
      busy = false;
      if (alive) paint(state());
    }
  }
  function dispose() {
    if (!alive) return;
    alive = false;
    doc.removeEventListener('fullscreenchange', changed);
    // Late successful requests are also unwound by toggle's alive checks.
    void leave();
  }
  return { toggle, state, dispose };
}
