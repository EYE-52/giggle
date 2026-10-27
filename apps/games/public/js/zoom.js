/* Game size control: a "− 100% +" zoom for the game playfield (#gbody).
 * Inside Giggle the game panel can be small (side layout, floating call,
 * laptops, phones), so players can make the game bigger or smaller. The
 * choice is remembered per device through the seat-aware store (test-table
 * seats keep their own); without a choice a small frame starts smaller so
 * the question and the main action fit.
 *
 * CSS `zoom` scales layout as well as paint, so the zoomed playfield still
 * fills its column without horizontal scroll, and pointer coordinates stay
 * right for canvases and boards (getBoundingClientRect and clientX share the
 * same space). 3D/canvas worlds and framed games keep 100% (see zoomable). */
export const ZOOM_STEPS = Object.freeze([0.8, 0.9, 1, 1.15, 1.3]);
export const ZOOM_KEY = 'pb_zoom';

/* A small frame starts one or two steps smaller. */
export function autoZoom(width, height) {
  const w = Number(width) || 0, h = Number(height) || 0;
  if ((w && w < 400 && h && h < 600) || (h && h < 520)) return 0.8;
  if ((w && w < 520) || (h && h < 560)) return 0.9;
  return 1;
}

export function nearestStep(value) {
  const v = Number(value);
  if (!Number.isFinite(v)) return 1;
  return ZOOM_STEPS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), 1);
}

/* dir: -1 smaller, +1 bigger. Stays at the ends. */
export function stepZoom(value, dir) {
  const i = ZOOM_STEPS.indexOf(nearestStep(value));
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + (dir < 0 ? -1 : 1)))];
}

/* The stored choice wins; otherwise the auto default for this frame. */
export function currentZoom(store, width, height) {
  const saved = Number(store?.get?.(ZOOM_KEY));
  return ZOOM_STEPS.includes(saved) ? saved : autoZoom(width, height);
}

export function percent(value) {
  return Math.round(nearestStep(value) * 100) + '%';
}

/* Only the standard (scrolling) playfield zooms. Full-screen games (boards,
 * 3D worlds, framed games) already fit their board to the viewport: checked
 * at 80% and 130%, zoom only left an empty band or clipped the board, so
 * they keep 100% and show no control. */
export function zoomable(meta) {
  if (!meta) return false;
  if (meta.runtime?.type === 'frame' || meta.layout === 'immersive') return false;
  return meta.renderer !== '3d';
}

/* Markup for the control; data-zoom = -1 | 0 (reset to 100%) | 1. */
export function zoomControlHtml(value, { id = 'gameZoom', extraClass = '' } = {}) {
  const v = nearestStep(value);
  const atMin = v === ZOOM_STEPS[0], atMax = v === ZOOM_STEPS.at(-1);
  return `<div class="game-zoom ${extraClass}" id="${id}" role="group" aria-label="Game size">`
    + `<button type="button" data-zoom="-1" aria-label="Make game smaller"${atMin ? ' disabled' : ''}>−</button>`
    + `<button type="button" data-zoom="0" class="game-zoom-value" aria-label="Game size ${percent(v)}. Reset to 100%">${percent(v)}</button>`
    + `<button type="button" data-zoom="1" aria-label="Make game bigger"${atMax ? ' disabled' : ''}>+</button>`
    + `</div>`;
}
