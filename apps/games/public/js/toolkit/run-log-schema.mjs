export const RUN_EVENTS = new Set(['load-error', 'runtime-error', 'promise-error', 'resource-error', 'socket-close', 'socket-error', 'webgl-lost', 'render-error', 'fire', 'hit', 'ko', 'collision', 'landing']);
const FIELDS = ['durationMs', 'readyMs', 'frameCount', 'sampleWindowFrames', 'frameP50Ms', 'frameP95Ms', 'frameMaxMs', 'longFrames', 'rendererSampleCount', 'renderCpuP95Ms', 'renderCpuMaxMs', 'snapshots', 'snapshotGapMaxMs', 'drawCallsMax', 'trianglesMax', 'geometriesMax', 'texturesMax'];
// The same whitelist protects local storage and the private report inbox.
export function sanitizeRunLog(value, gameIds) {
  if (!value || value.schema !== 1 || typeof value.game !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value.game) || (gameIds && !gameIds.has(value.game))) return null;
  const result = { schema: 1, game: value.game };
  for (const key of FIELDS) {
    const n = value[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100000000) result[key] = Math.round(n * 100) / 100;
  }
  result.counts = {};
  for (const type of RUN_EVENTS) if (Number.isInteger(value.counts?.[type]) && value.counts[type] >= 0 && value.counts[type] <= 1000000) result.counts[type] = value.counts[type];
  result.events = (Array.isArray(value.events) ? value.events.slice(-32) : []).filter(item => RUN_EVENTS.has(item?.type) && typeof item.atMs === 'number' && Number.isFinite(item.atMs) && item.atMs >= 0 && item.atMs <= 86400000).map(item => ({ type: item.type, atMs: Math.round(item.atMs * 100) / 100 }));
  if (value.timings && typeof value.timings === 'object' && !Array.isArray(value.timings)) {
    result.timings = {};
    for (const channel of ['frame', 'render', 'snapshot']) {
      result.timings[channel] = (Array.isArray(value.timings[channel]) ? value.timings[channel].slice(-16) : [])
        .filter(item => item && typeof item.atMs === 'number' && Number.isFinite(item.atMs) && item.atMs >= 0 && item.atMs <= 86400000
          && typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) && item.durationMs >= 0 && item.durationMs <= item.atMs)
        .map(item => ({ atMs: Math.round(item.atMs * 100) / 100, durationMs: Math.round(item.durationMs * 100) / 100 }));
    }
  }
  return result;
}
