// Bounded local diagnostics. No names, room codes, inputs, chat, URLs or
// exception messages enter this record. Sending it requires an issue report.
const KEY = 'giggle-run-logs-v1';
import { RUN_EVENTS as EVENTS, sanitizeRunLog } from './run-log-schema.mjs';
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const rounded = value => Math.round(value * 100) / 100;

export function createRunLog({ now = () => performance.now(), storage, requestFrame = globalThis.requestAnimationFrame, cancelFrame = globalThis.cancelAnimationFrame, visible = () => !globalThis.document?.hidden } = {}) {
  try { storage ??= globalThis.localStorage; } catch { storage = null; }
  let current = null, identity = null, raf = 0, lastFrame = 0, lastSave = 0, playableSnapshot = null;
  let history = [];
  try { const text = storage?.getItem(KEY) || '[]'; const saved = text.length < 100000 ? JSON.parse(text) : []; if (Array.isArray(saved)) history = saved.slice(-10).map(item => sanitizeRunLog(item)).filter(Boolean); } catch { /* Private mode or a corrupt local record must not affect play. */ }
  const sample = (list, value) => { if (finite(value)) { list.push(value); if (list.length > 1800) list.shift(); } };
  const percentile = (list, p) => { const sorted = [...list].sort((a, b) => a - b); return sorted.length ? rounded(sorted[Math.ceil(sorted.length * p) - 1]) : 0; };
  // Sparse anomaly spans end at collector observation time, like gameplay events.
  // Frame duration is the RAF scheduler interval; render duration is synchronous
  // CPU submission. Spans support overlap comparisons, not sub-frame causality
  // or GPU timing.
  // Each channel keeps its own latest 16; these are not whole-run histories.
  function span(channel, end, duration) {
    const atMs = end - current.started;
    if (!finite(atMs) || !finite(duration) || duration > atMs || atMs > 86400000) return;
    const list = current.timings[channel];
    list.push({ atMs: rounded(atMs), durationMs: rounded(duration) });
    if (list.length > 16) list.shift();
  }
  function summary() {
    if (!current) return null;
    const { game, started, ended, frames, render, events, counts, drawCallsMax, trianglesMax, geometriesMax, texturesMax, ...stats } = current;
    return sanitizeRunLog({ schema: 1, game, ...stats, durationMs: rounded((ended ?? now()) - started), sampleWindowFrames: frames.length,
      frameP50Ms: percentile(frames, .5), frameP95Ms: percentile(frames, .95),
      ...(current.rendererSampleCount ? { renderCpuP95Ms: percentile(render, .95), drawCallsMax, trianglesMax, geometriesMax, texturesMax } : {}),
      counts: { ...counts }, events: events.map(item => ({ ...item })) });
  }
  function save() {
    const value = summary();
    if (!value) return;
    const records = (current.ended === undefined ? [...history, value] : history).slice(-10);
    try { storage?.setItem(KEY, JSON.stringify(records)); } catch { /* Quota failures leave the current run in memory. */ }
    lastSave = now();
  }
  function frame(time) {
    raf = 0;
    if (!current || current.ended !== undefined) return;
    if (visible() && current.playing) {
      if (lastFrame) {
        const interval = Math.max(0, time - lastFrame);
        sample(current.frames, interval); current.frameCount++;
        current.frameMaxMs = Math.max(current.frameMaxMs, rounded(interval));
        if (interval > 50) { current.longFrames++; span('frame', now(), interval); }
      }
      lastFrame = time;
    } else lastFrame = 0;
    if (now() - lastSave >= 5000) save();
    if (requestFrame) raf = requestFrame(frame);
  }
  function finish() {
    if (!current || current.ended !== undefined) return;
    current.ended = now(); current.playing = false;
    if (raf) cancelFrame?.(raf); raf = 0; lastFrame = 0;
    history = [...history, summary()].slice(-10); save();
  }
  function begin(game, instance) {
    if (identity === instance && current?.game === game) return;
    finish(); identity = instance;
    current = { game, started: now(), playing: false, readyRecorded: false, seen: new Set(), readyMs: 0, frameCount: 0, frameMaxMs: 0, longFrames: 0,
      snapshots: 0, snapshotGapMaxMs: 0, rendererSampleCount: 0, drawCallsMax: 0, trianglesMax: 0, geometriesMax: 0, texturesMax: 0,
      frames: [], render: [], events: [], counts: {}, timings: { frame: [], render: [], snapshot: [] } };
    lastSave = now(); lastFrame = 0; playableSnapshot = null;
    if (requestFrame) raf = requestFrame(frame);
  }
  function snapshot(state) {
    if (!state?.game || !state.instanceId) return;
    begin(state.game, state.instanceId);
    if (current.ended !== undefined) return;
    const time = now();
    const baseline = !current.snapshots || state.audioBaseline;
    for (const accepted of state.events || []) {
      if (current.seen.has(accepted.id)) continue;
      current.seen.add(accepted.id);
      if (!baseline) event(accepted.type);
    }
    while (current.seen.size > 64) current.seen.delete(current.seen.values().next().value);
    if (current.lastSnapshot !== undefined) current.snapshotGapMaxMs = Math.max(current.snapshotGapMaxMs, rounded(time - current.lastSnapshot));
    current.lastSnapshot = time; current.snapshots++;
    const playing = !state.preparing && state.phase !== 'done';
    if (visible() && playing && current.playing && !baseline && playableSnapshot !== null) {
      const gap = time - playableSnapshot;
      if (gap > 100) span('snapshot', time, gap);
    }
    playableSnapshot = visible() && playing ? time : null;
    if (playing && !current.readyRecorded) { current.readyMs = rounded(time - current.started); current.readyRecorded = true; }
    current.playing = playing;
    if (state.phase === 'done') finish();
  }
  function event(type) {
    if (!current || current.ended !== undefined || !EVENTS.has(type)) return;
    current.counts[type] = Math.min(1000000, (current.counts[type] || 0) + 1);
    current.events.push({ type, atMs: rounded(now() - current.started) });
    if (current.events.length > 32) current.events.shift();
  }
  function renderFrame(cpuMs, info) {
    if (!current?.playing || !visible()) return;
    sample(current.render, cpuMs);
    if (finite(cpuMs)) {
      current.renderCpuMaxMs = Math.max(current.renderCpuMaxMs || 0, rounded(cpuMs));
      // CPU scene work and synchronous render submission, never GPU completion.
      if (cpuMs > 16.67) span('render', now(), cpuMs);
    }
    current.rendererSampleCount++;
    for (const [key, value] of [['drawCallsMax', info?.render?.calls], ['trianglesMax', info?.render?.triangles], ['geometriesMax', info?.memory?.geometries], ['texturesMax', info?.memory?.textures]]) {
      if (finite(value)) current[key] = Math.max(current[key], Math.round(value));
    }
  }
  function latest(game) { const records = [...history, summary()].filter(Boolean); return records.reverse().find(item => !game || game === 'platform' || item.game === game) || null; }
  function pause() { if (current) current.playing = false; lastFrame = 0; playableSnapshot = null; }
  const visibility = () => { lastFrame = 0; playableSnapshot = null; };
  return { snapshot, event, renderFrame, finish, save, latest, pause, visibility };
}
