/* Opt-in game screen controller. Called only from a player gesture: native
 * full screen first, then landscape when supported. No CSS-rotated canvas
 * or forced orientation; unsupported phones retain normal manual rotation.
 * An owner leaving a game releases only the screen state it acquired. */
export function createGameScreen({ doc = document, navigator: nav = globalThis.navigator, orientation = globalThis.screen?.orientation,
  beforeChange = () => {}, notify = () => {}, paint = () => {}, isPortrait = () =>
    globalThis.matchMedia?.('(orientation: portrait)').matches, shouldRotate = () => true } = {}) {
  let alive = true, busy = false, ownsFullscreen = false, ownsLock = false;
  const root = doc.documentElement;
  // iPad Safari can identify itself as a Mac. Keep its manual-rotation hint,
  // but respect an iframe's fullscreen permissions even on iOS.
  const ios = /iPad|iPhone|iPod/.test(nav?.userAgent || '') || (nav?.platform === 'MacIntel' && nav?.maxTouchPoints > 1);
  const safari = /WebKit/.test(nav?.userAgent || '') && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(nav?.userAgent || '');
  const hint = ios && safari && (!doc.defaultView || doc.defaultView.parent === doc.defaultView);
  const state = () => ({ busy, fullscreen: ownsFullscreen && doc.fullscreenElement === root,
    available: (doc.fullscreenEnabled !== false && typeof root.requestFullscreen === 'function') || hint });
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
    paint({ ...state(), busy: false, fullscreen: false });
    // Late successful requests are also unwound by toggle's alive checks.
    void leave();
  }
  return { toggle, state, dispose };
}

/* One invitation per browser, also remembered for this session when storage
 * is blocked. Reading localStorage itself can throw in private/iframe modes. */
export function createGameScreenPrompt({ storage = () => globalThis.localStorage } = {}) {
  const key = 'giggle:game-screen-prompt-dismissed';
  let dismissed = false;
  try { dismissed = storage()?.getItem(key) === '1'; } catch { /* storage unavailable */ }
  return {
    shouldShow: ({ touch, immersive, fullscreen, available }) => !dismissed && touch && immersive && !fullscreen && available,
    dismiss() {
      dismissed = true;
      try { storage()?.setItem(key, '1'); } catch { /* session memory still works */ }
    },
  };
}
