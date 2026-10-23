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
export function reset() {
  const previous = cur;
  cur = null; // Detach before user cleanup: dispose may itself reset the host.
  if (previous) {
    previous.controller.abort();
    for (const resolve of previous.waiters) resolve(null);
    previous.waiters.length = 0;
    previous.untrack?.();
  }
  if (previous && previous.view && typeof previous.view.dispose === 'function') {
    try {
      previous.view.dispose(previous.el);
    } catch (e) {
      console.error('view dispose error', e);
    }
  }
  for (const link of previous?.ownedStyles || []) link.remove();
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
    else if (document.visibilityState === 'hidden' || typeof requestAnimationFrame !== 'function') finish();
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

async function usableFrame(active, request, api) {
  const signal = active.paintController.signal;
  declaredStyles(active);
  const links = styles().filter(link => !active.initialStyles.has(link) || active.requiredStyles.has(link));
  await Promise.all(links.map(link => resource(link, signal, () => !!link.sheet || styleStates.get(link) === 'load')));
  // Layout initiates any fonts used by the freshly rendered prompt.
  active.el.getBoundingClientRect?.();
  if (document.fonts?.ready) await waitFor(document.fonts.ready, signal);
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
  const timeout = setTimeout(() => active.controller.abort(new Error('Game preparation timed out')), 10000);
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
    reset();
    const active = cur = { id: gameId, instanceId: S.instanceId, el, view: null, controller: new AbortController(),
      version: 0, painted: 0, usable: false, running: false, waiters: [], ownedStyles: new Set(), requiredStyles: new Set(), initialStyles: new Set(styles()) };
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
