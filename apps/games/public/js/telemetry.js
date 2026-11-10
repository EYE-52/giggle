/* Small early collector. Never read inputs, text, URLs, names or room state.
 * The observers are separate so this hook also catches module boot failures. */
(() => {
  if (window.GiggleTelemetry) return;
  const crumbs = [], queue = [], seen = new Map();
  const pathGame = /^\/(?:game-assets|games)\/([a-z0-9-]+)\//.exec(location.pathname)?.[1];
  let game = pathGame || 'platform', screen = pathGame ? 'game' : location.pathname.startsWith('/practice') ? 'practice' : location.pathname.startsWith('/same-room') ? 'same-room' : 'home';
  let phase = 'loading', map = '', config, timer = 0, lastInput = Date.now(), sent = 0, budgetAt = lastInput, low = 0;
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'other';
  const cores = navigator.hardwareConcurrency || 4, memory = navigator.deviceMemory || 4;
  const tier = cores <= 4 || memory <= 2 ? 'low' : cores >= 8 && memory >= 8 ? 'high' : 'mid';
  function active() {
    try {
      for (let win = window; win.frameElement; win = win.parent) {
        if (win.frameElement.closest('[hidden], .practice-seat[inert]')) return false;
      }
    } catch { /* Meet is cross-origin. */ }
    return !document.hidden && Date.now() - lastInput < 60000;
  }
  function flush() {
    timer = 0;
    if (!active()) { queue.length = 0; return; }
    if (!config?.reportingEnabled || !queue.length) return;
    const now = Date.now();
    if (now - budgetAt >= 60000) { budgetAt = now; sent = 0; }
    if (sent >= 2) { queue.length = 0; return; }
    const events = queue.splice(0, 10).map(event => ({ ...event, release: config.release?.sourceCommit || config.version || 'unknown' }));
    sent++;
    // Beacon rejection, endpoint errors and offline use never cause retries.
    try { navigator.sendBeacon('/api/telemetry', new Blob([JSON.stringify({ events })], { type: 'application/json' })); } catch { /* best effort */ }
  }
  function capture(type, message = 'unknown', details = {}) {
    if (!active()) return;
    const key = `${type}:${game}:${message}:${details.selector || ''}`, now = Date.now();
    const noisy = ['layout-shift', 'long-task', 'frame-summary'].includes(type);
    if (seen.has(key) && now - seen.get(key) < 10000) return;
    if (seen.size >= 100) seen.delete(seen.keys().next().value);
    seen.set(key, now);
    crumbs.push(type); if (crumbs.length > 8) crumbs.shift();
    if (noisy && Math.random() > .1) return;
    const width = Math.max(1, Math.min(20000, Math.round(innerWidth))), height = Math.max(1, Math.min(20000, Math.round(innerHeight)));
    queue.push({ type, game, message, screen, phase, map, width, height, browser, tier,
      device: /Mobi|Android|iPhone|iPad/.test(ua) ? Math.min(screenWidth(), screenHeight()) >= 600 ? 'tablet' : 'mobile' : 'desktop',
      breadcrumbs: crumbs.slice(), ...details });
    if (queue.length > 10) queue.shift();
    if (!timer) timer = setTimeout(flush, 5000);
  }
  const screenWidth = () => window.screen.width, screenHeight = () => window.screen.height;
  const errorName = value => ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError'].includes(value?.name) ? value.name : 'Error';
  window.addEventListener('error', event => {
    const tag = event.target?.tagName;
    capture(tag ? 'resource-error' : 'runtime-error', tag ? ({ IMG: 'image', SCRIPT: 'script', LINK: 'style', AUDIO: 'audio', VIDEO: 'video' }[tag] || 'asset') : errorName(event.error));
  }, true);
  window.addEventListener('unhandledrejection', event => capture('promise-error', errorName(event.reason)));
  for (const name of ['pointerdown', 'keydown', 'touchstart', 'wheel']) window.addEventListener(name, () => { lastInput = Date.now(); }, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { queue.length = 0; clearTimeout(timer); timer = 0; low = 0; } });
  window.GiggleTelemetry = {
    capture, active,
    configure(value) { config = value; },
    context(next = {}) {
      game = next.game || 'platform'; screen = next.screen || screen; phase = next.phase || phase; map = next.map || '';
      const crumb = `${game}:${map}:${screen}:${phase}`;
      if (crumb !== this.lastContext) { this.lastContext = crumb; crumbs.push(screen, phase); while (crumbs.length > 8) crumbs.shift(); low = 0; }
    },
    frames({ fps, p95 }) {
      if (!active() || game !== 'pocket-karts' || phase !== 'playing') { low = 0; return; }
      low = fps < 30 || p95 > 50 ? low + 1 : 0;
      capture(low >= 2 ? 'low-fps' : 'frame-summary', low >= 2 ? 'sustained' : 'frames', { fps, p95 });
    },
    configPromise: fetch('/config.json', { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      .then(response => response.ok ? response.json() : null).catch(() => null)
      .then(value => { config = value; return value; }),
  };
  import('./telemetry-observers.mjs').catch(() => {});
})();
