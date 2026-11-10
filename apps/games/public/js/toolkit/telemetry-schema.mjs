// Deliberately no free text, raw URLs, stacks, DOM ids/classes, or user agent.
// Both collectors and the server reduce diagnostics to these safe labels.
export const TYPES = ['runtime-error', 'promise-error', 'resource-error', 'load-error', 'load-timeout', 'load-slow', 'load-retry', 'socket-close', 'socket-open', 'socket-loop', 'layout-shift', 'long-task', 'low-fps', 'frame-summary', 'render-error', 'webgl-lost'];
export const MESSAGES = ['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError', 'AggregateError', 'unknown', 'image', 'script', 'style', 'audio', 'video', 'asset', 'failed', 'timeout', 'slow', 'retry', 'disconnected', 'reconnected', 'loop', 'unstable', 'blocked', 'sustained', 'frames', 'context-lost'];
export const SCREENS = ['home', 'lobby', 'practice', 'game', 'embed', 'guide', 'same-room'];
export const PHASES = ['home', 'lobby', 'loading', 'playing', 'done'];
const FIELDS = new Set(['type', 'game', 'message', 'selector', 'release', 'screen', 'phase', 'width', 'height', 'device', 'browser', 'tier', 'map', 'breadcrumbs', 'value', 'p95', 'fps']);
const fail = () => { throw new Error('Invalid telemetry event.'); };
export function sanitizeMessage(value) { return MESSAGES.includes(value) ? value : 'unknown'; }
export function sanitizeSelector(value) {
  // Structural selectors identify the shifting box without recording names
  // in text, ids, classes, data attributes or inline styles.
  return typeof value === 'string' && value.length <= 200 && /^(?:[a-z]{1,16}:nth-of-type\([1-9]\d{0,3}\))(?:>(?:[a-z]{1,16}:nth-of-type\([1-9]\d{0,3}\))){0,3}$/.test(value) ? value : '';
}
export function validateEvent(input, games, maps = new Set()) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !FIELDS.has(key))) fail();
  if (!TYPES.includes(input.type) || (input.game !== 'platform' && !games.has(input.game)) ||
    !SCREENS.includes(input.screen) || !PHASES.includes(input.phase) ||
    typeof input.release !== 'string' || input.release.length > 80 || !/^(unknown|[0-9a-f]{40}|\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?)$/.test(input.release) ||
    !['mobile', 'tablet', 'desktop'].includes(input.device) || !['low', 'mid', 'high'].includes(input.tier) ||
    !['Chrome', 'Firefox', 'Safari', 'Edge', 'other'].includes(input.browser)) fail();
  for (const key of ['width', 'height']) if (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > 20000) fail();
  if (input.message !== undefined && (typeof input.message !== 'string' || input.message.length > 256)) fail();
  if (input.selector !== undefined && (typeof input.selector !== 'string' || input.selector.length > 200)) fail();
  if (input.map !== undefined && (typeof input.map !== 'string' || input.map.length > 64)) fail();
  if (input.breadcrumbs !== undefined && (!Array.isArray(input.breadcrumbs) || input.breadcrumbs.length > 8 || input.breadcrumbs.some(x => !TYPES.includes(x) && !SCREENS.includes(x) && !PHASES.includes(x)))) fail();
  const result = { type: input.type, game: input.game, message: sanitizeMessage(input.message), selector: sanitizeSelector(input.selector),
    release: input.release, screen: input.screen, phase: input.phase, width: input.width, height: input.height,
    device: input.device, browser: input.browser, tier: input.tier, map: input.game === 'pocket-karts' && maps.has(input.map) ? input.map : '', breadcrumbs: input.breadcrumbs || [] };
  for (const key of ['value', 'p95', 'fps']) if (input[key] !== undefined) {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < 0 || input[key] > 1000000) fail();
    result[key] = Math.round(input[key] * 100) / 100;
  }
  return result;
}
