/* Legacy render() and mount/update views share one serial lifecycle.
 * A view may return promises from its hooks, declare styles: [href], and
 * expose ready(el, snapshot, api) for essential assets/its first scene.
 * api.signal aborts on exit. Decorative images never block readiness;
 * essential DOM images opt in with data-game-critical. */

let cur = null;
const styleStates = new WeakMap();

export function currentId() {
  return cur ? cur.id : null;
}

export function isLoaded(gameId) {
  return !!cur && cur.id === gameId;
}

/* Tear down the current view. Safe to call when nothing is mounted. */
/* A rematch remounts the same game in the same playfield. Disposing clears
 * it a network round trip before the next round paints, so the board
 * blinks out. Keep an inert snapshot of the last frame on top until the
 * new view's first paint (or failure) clears it. Canvas, frame and video
 * games are skipped: their clones would show blank or reload. */
// App-wide stylesheets present before any game; anything later is a game's.
const baseStyles = typeof document === 'undefined' ? new Set() : new Set(document.querySelectorAll?.('link[rel="stylesheet"]') || []);
// True from capture until clearing, even if a view's first paint already
// replaced the copy, so duplicated stylesheets are always removed.
let snapshotLive = false;

function holdSnapshot(el) {
  if (!el || !['standard', 'immersive'].includes(el.dataset?.layout) || !el.firstElementChild || el.querySelector?.('canvas, iframe, video')) return;
  if (el.querySelector?.(':scope > .game-retiring') || !el.childNodes || typeof document === 'undefined') return;
  const ghost = document.createElement('div');
  // Carry the body's own classes, data attributes and inline custom
  // properties: views size boards from them, so the copy lays out the same.
  ghost.className = `${el.className || ''} game-retiring`.trim();
  for (const attr of el.attributes || []) if (attr.name.startsWith('data-')) ghost.setAttribute(attr.name, attr.value);
  if (el.style?.cssText) ghost.style.cssText = el.style.cssText;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  for (const node of el.childNodes) ghost.appendChild(node.cloneNode(true));
  // Views remove their own stylesheets on dispose. Add duplicates beside
  // them first, so the styles never drop for a frame; clearing the copy
  // removes the duplicates.
  for (const link of document.querySelectorAll?.('link[rel="stylesheet"]:not([data-retiring])') || []) {
    if (baseStyles.has(link)) continue;
    const copy = link.cloneNode();
    copy.setAttribute('data-retiring', '');
    link.after(copy);
  }
  snapshotLive = true;
  el._ghost = ghost;
  el._ghostHeight = el.offsetHeight;
}
function placeSnapshot(el) {
  const ghost = el?._ghost;
  if (!ghost) return;
  el._ghost = null;
  el.classList?.add('is-retiring');
  if (el._ghostHeight && el.style) el.style.minHeight = el._ghostHeight + 'px';
  el.appendChild(ghost);
}
function clearSnapshot(el) {
  if (!el) return;
  el._ghost = null;
  if (el.classList?.contains('is-retiring') && el.style) el.style.minHeight = '';
  el.classList?.remove('is-retiring');
  for (const ghost of el.querySelectorAll?.(':scope > .game-retiring') || []) ghost.remove();
  if (!snapshotLive) return;
  snapshotLive = false;
  for (const link of document.querySelectorAll?.('link[data-retiring]') || []) link.remove();
}

/* The shell disposes the view and rebuilds the play screen for a new
 * round, replacing the body element itself. Capture the last frame first,
 * then place it in the new body so the swap never blanks. */
export function captureSnapshot(el) {
  holdSnapshot(el);
  const ghost = el?._ghost;
  if (!ghost) return null;
  el._ghost = null;
  return { ghost, height: el._ghostHeight };
}
export function placeCapturedSnapshot(el, snap) {
  if (!el || !snap) return;
  el._ghost = snap.ghost;
  el._ghostHeight = snap.height;
  placeSnapshot(el);
}

// Stylesheets kept across a same-game rematch, adopted by the next round.
let carriedStyles = null;

export function reset(opts = {}) {
  const previous = cur;
  cur = null; // Detach before user cleanup: dispose may itself reset the host.
  if (previous) {
    previous.controller.abort();
    previous.preparation?.abort();
    for (const resolve of previous.waiters) resolve(null);
    previous.waiters.length = 0;
    previous.untrack?.();
  }
  if (opts.rematch && previous) holdSnapshot(previous.el);
  else if (previous) clearSnapshot(previous.el);
  if (previous && previous.view && typeof previous.view.dispose === 'function') {
    try {
      previous.view.dispose(previous.el);
    } catch (e) {
      console.error('view dispose error', e);
    }
  }
  if (opts.rematch && previous) placeSnapshot(previous.el);
  for (const link of carriedStyles?.links || []) link.remove();
  carriedStyles = null;
  // A rematch snapshot still needs the game's own styles; the next round of
  // the same game adopts them (and removes them when it is reset).
  if (previous?.ownedStyles?.size && (opts.rematch || opts.keepStyles)) carriedStyles = { id: previous.id, links: previous.ownedStyles };
  else for (const link of previous?.ownedStyles || []) link.remove();
}

/* Run fn while keeping keyboard focus (and text selection) stable when
 * the focused element survives the repaint. */
export function withFocus(root, fn) {
  const ae = document.activeElement;
  const inside = ae && root && root.contains(ae) && ae.id;
  const sel = inside && typeof ae.selectionStart === 'number'
    ? { s: ae.selectionStart, e: ae.selectionEnd } : null;
  const result = fn();
  if (inside) {
    const next = document.getElementById(ae.id);
    if (next && root.contains(next) && next !== document.activeElement) {
      try { next.focus({ preventScroll: true }); } catch { next.focus(); }
      if (sel && typeof next.setSelectionRange === 'function') {
        try { next.setSelectionRange(sel.s, sel.e); } catch { /* noop */ }
      }
    }
  }
  return result;
}

function styles() {
  return [...(document.querySelectorAll?.('link[rel="stylesheet"]') || [])];
}

function declaredStyles(active) {
  for (const href of active.view.styles || []) {
    let link = styles().find(link => link.getAttribute('href') === href);
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      active.ownedStyles.add(link); document.head.appendChild(link);
    }
    active.requiredStyles.add(link);
  }
}

function waitFor(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason || new Error('View retired'));
    if (signal.aborted) return aborted();
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

function resource(element, signal, loaded) {
  if (styleStates.get(element) === 'error') return Promise.reject(new Error('Required stylesheet failed to load'));
  if (loaded()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      element.removeEventListener('load', success);
      element.removeEventListener('error', failed);
      signal.removeEventListener('abort', failed);
    };
    const success = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('Required game resource failed to load')); };
    element.addEventListener('load', success, { once: true });
    element.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', failed, { once: true });
    if (signal.aborted) failed();
    else if (loaded()) success(); // Resource may have finished before listeners attached.
  });
}

function usableInput(active, request) {
  return cur === active && active.usable && active.paintedWindow === active.latest.S.w &&
    !active.latest.S.preparing && (!request || request.S.w === active.latest.S.w);
}

function scopedApi(active, request = null) {
  return new Proxy(active.latest.api, { get(target, key) {
    if (key === 'isUsable') return () => usableInput(active, request);
    if (key === 'preparationSignal') return active.preparation?.signal;
    if (key === 'signal') return active.paintController?.signal || active.controller.signal;
    const value = (request?.api || active.latest.api)[key];
    if (typeof value !== 'function') return value;
    return (...args) => {
      if (['send', 'rematch', 'lobby', 'endGame', 'leave', 'configure', 'resultsReady', 'cue', 'audioUnlock'].includes(key) && cur !== active) return false;
      // Same-window progress/heartbeat paints must not discard live input.
      // Gate the action window actually rendered, rather than each snapshot
      // version; new windows still wait for their render/readiness barrier.
      if (key === 'send' && !usableInput(active, request)) return false;
      return value(...args);
    };
  } });
}

function paintOpportunity(signal) {
  return new Promise((resolve, reject) => {
    let frame = null, observer = null, frames = 0, finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      observer?.disconnect();
      signal.removeEventListener('abort', aborted);
      document.removeEventListener?.('visibilitychange', visibility);
      if (error) reject(error); else resolve();
    };
    const aborted = () => finish(signal.reason || new Error('Frame retired'));
    const visibility = () => { if (document.visibilityState === 'hidden') finish(); };
    const tick = () => {
      if (finished) return;
      frame = null;
      if (signal.aborted) return aborted();
      if (document.visibilityState === 'hidden' || ++frames === 2) return finish();
      frame = requestAnimationFrame(tick);
    };
    signal.addEventListener('abort', aborted, { once: true });
    document.addEventListener?.('visibilitychange', visibility);
    if (signal.aborted) aborted();
    else if (document.visibilityState === 'hidden' || inactiveSameOriginFrame() || typeof requestAnimationFrame !== 'function') finish();
    else {
      // Browsers can throttle offscreen iframes while their document stays
      // visible. IntersectionObserver includes ancestor clipping, even when
      // a cross-origin embed prevents reading the parent frame's bounds.
      if (typeof IntersectionObserver === 'function' && document.documentElement) {
        observer = new IntersectionObserver(entries => {
          if (entries.some(entry => !entry.isIntersecting)) finish();
        });
        observer.observe(document.documentElement);
      }
      frame = requestAnimationFrame(tick);
    }
  });
}

function inactiveSameOriginFrame() {
  try {
    // Resource/view readiness above still runs in full. Only an onscreen
    // paint opportunity is unnecessary for a deliberately inactive seat.
    return !!document.defaultView?.frameElement?.closest?.('[hidden], [inert]');
  } catch { return false; } // Cross-origin parents keep the normal observer.
}

// Kart warm-up is optional work, not the lifetime of the mounted game.
// Observe late rejection too, but release readiness at the soft deadline.
function preparationWait(active,promise,signal) {
  if(active.id!=='pocket-karts')return waitFor(promise,signal);
  const preparation=active.preparation.signal;
  return waitFor(new Promise((resolve,reject)=>{
    const release=()=>{preparation.removeEventListener('abort',release);resolve();};
    preparation.addEventListener('abort',release,{once:true});
    Promise.resolve(promise).then(value=>{preparation.removeEventListener('abort',release);resolve(value);},error=>{
      preparation.removeEventListener('abort',release);reject(error);
    });
    if(preparation.aborted)release();
  }),signal);
}

async function usableFrame(active, request, api) {
  const signal = active.paintController.signal;
  declaredStyles(active);
  const links = styles().filter(link => !active.initialStyles.has(link) || active.requiredStyles.has(link));
  await Promise.all(links.map(link => resource(link, signal, () => !!link.sheet || styleStates.get(link) === 'load')));
  // Layout initiates any fonts used by the freshly rendered prompt.
  active.el.getBoundingClientRect?.();
  if (document.fonts?.ready) await preparationWait(active, document.fonts.ready, signal);
  for (const img of active.el.querySelectorAll?.('img[data-game-critical]') || []) {
    await resource(img, signal, () => img.complete);
    if (!img.naturalWidth) throw new Error('Required game image failed to load');
    if (img.decode) await waitFor(img.decode(), signal);
  }
  if (typeof active.view.ready === 'function') {
    const ready = await waitFor(active.view.ready(active.el, request.S, api), signal);
    if (ready === false) throw new Error('Game view is not ready');
  }
  // Visible content gets two pre-paint callbacks, providing one paint
  // opportunity. Hidden tabs and offscreen embedded frames still completed
  // all resources/render/ready above, but cannot require throttled paint
  // callbacks to release everyone else's turn.
  await paintOpportunity(signal);
}

async function drive(active) {
  const signal = active.controller.signal;
  // Skip optional kart GPU work after 24s. Required downloads and
  // the real first frame still hold readiness; the server keeps waiting.
  const kart = active.id === 'pocket-karts';
  // A first visit downloads code, styles and art with a cold cache; 10s failed on slower links.
  const limitMs = kart ? 24000 : active.latest?.meta?.renderer === '3d' ? 28000 : 20000;
  const timeout = setTimeout(() => {
    if (kart) active.preparation.abort();
    else active.controller.abort(new Error('Game preparation timed out'));
  }, limitMs);
  try {
    if (!active.view) {
      const meta = active.latest.meta;
      const mod = await waitFor(meta?.runtime?.type === 'frame'
        ? import('./game-frame.js').then(({ createGameFrame }) => ({ default: createGameFrame(active.id, meta.runtime) }))
        : import('./games/' + active.id + '.js'), signal);
      if (cur !== active) return;
      if (!mod?.default) throw new Error('Game module has no view');
      active.view = mod.default;
      declaredStyles(active);
      await Promise.all([...active.requiredStyles].map(link => resource(link, signal, () => !!link.sheet || styleStates.get(link) === 'load')));
      if (typeof active.view.mount === 'function') await waitFor(active.view.mount(active.el, active.api), signal);
    }
    while (cur === active && active.painted !== active.version) {
      const request = active.latest;
      const api = scopedApi(active, request);
      const paintController = active.paintController = new AbortController();
      const retired = () => paintController.abort(signal.reason);
      signal.addEventListener('abort', retired, { once: true });
      try {
        const method = active.view.update || active.view.render;
        if (typeof method !== 'function') throw new Error('Game view has no render hook');
        await waitFor(withFocus(active.el, () => method.call(active.view, active.el, request.S, api)), paintController.signal);
        active.painted = request.version;
        active.paintedWindow = request.S.w;
        clearSnapshot(active.el);
        if (cur !== active) return;
        if (active.painted !== active.version) continue;
        if (!active.usable || (request.S.preparing && active.readyWindow !== request.S.w)) {
          await usableFrame(active, request, api);
          if (cur !== active || active.painted !== active.version) continue;
          active.usable = true;
          if (request.S.preparing && active.readyWindow !== request.S.w) {
            active.readyWindow = request.S.w;
            request.api.ready?.({ instanceId: request.S.instanceId, window: request.S.w });
          }
        }
        if (cur === active && active.painted === active.version && request.S.w === active.latest.S.w &&
            typeof active.view.usabilityChanged === 'function') {
          const usable = usableInput(active, request);
          if (active.notifiedWindow !== request.S.w || active.notifiedUsable !== usable) {
            active.notifiedWindow = request.S.w;
            active.notifiedUsable = usable;
            await waitFor(withFocus(active.el, () => active.view.usabilityChanged(active.el, request.S, api)), paintController.signal);
          }
        }
      } catch (e) {
        if (!signal.aborted && paintController.signal.aborted && active.latest.S.w !== request.S.w) continue;
        throw e;
      } finally {
        signal.removeEventListener('abort', retired);
        if (active.paintController === paintController) active.paintController = null;
      }
    }
  } catch (e) {
    if (cur === active) {
      console.error('view preparation error', e);
      const { api, S } = active.latest;
      const failure = { gameId: active.id, instanceId: S.instanceId, window: S.w, error: e.message };
      reset();
      // Disposal may clear the mount element. Let the shell paint recovery
      // controls only after all cleanup, using the captured current tokens.
      api.loadError?.(failure);
    }
  } finally {
    clearTimeout(timeout);
    active.running = false;
    const value = cur === active ? active.view : null;
    for (const resolve of active.waiters.splice(0)) resolve(value);
  }
}

/* Resolves to the live view, or null on failure/retirement. Concurrent
 * snapshots coalesce to the latest; async hooks never overlap. */
export function show(el, gameId, S, api, meta) {
  if (!el) return Promise.resolve(null);
  if (!cur || cur.id !== gameId || cur.el !== el || cur.instanceId !== S.instanceId) {
    if (cur) reset({ rematch: cur.id === gameId && cur.el === el && cur.instanceId !== S.instanceId });
    const active = cur = { id: gameId, instanceId: S.instanceId, el, view: null, controller: new AbortController(), preparation: new AbortController(),
      version: 0, painted: 0, usable: false, running: false, waiters: [], ownedStyles: new Set(), requiredStyles: new Set(), initialStyles: new Set(styles()) };
    if (carriedStyles?.id === gameId) for (const link of carriedStyles.links) active.ownedStyles.add(link);
    else for (const link of carriedStyles?.links || []) link.remove();
    carriedStyles = null;
    const tracked = event => {
      if (event.target?.tagName === 'LINK' && event.target.rel === 'stylesheet') styleStates.set(event.target, event.type);
    };
    document.addEventListener?.('load', tracked, true);
    document.addEventListener?.('error', tracked, true);
    active.untrack = () => {
      document.removeEventListener?.('load', tracked, true);
      document.removeEventListener?.('error', tracked, true);
    };
    // Hooks may retain the API after mount. Retired views cannot send into
    // a replacement instance, even if their async work finishes later.
  }
  const active = cur;
  if (active.latest && active.latest.S.w !== S.w) active.paintController?.abort();
  if (gameId === 'pocket-karts' && Array.isArray(S.events)) {
    // Poses coalesce to the latest snapshot; unique combat events must
    // survive snapshots arriving during async imports/render/readiness.
    const previous = active.latest;
    const events = new Map((S.audioBaseline ? [] : previous?.S.events || []).map(event => [event.id, event]));
    for (const event of S.events) events.set(event.id, event);
    S = { ...S, events: [...events.values()].slice(-32),
      audioBaseline: !!S.audioBaseline || !!(previous?.S.audioBaseline && previous.version > active.painted) };
  }
  active.latest = { S, api, meta, version: ++active.version };
  if (!active.api) active.api = scopedApi(active);
  const pending = new Promise(resolve => active.waiters.push(resolve));
  if (!active.running) { active.running = true; void drive(active); }
  return pending;
}
