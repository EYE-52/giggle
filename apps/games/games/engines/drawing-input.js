'use strict';

// Doodle Guess and Draw Phone use the same bounded, normalized stroke format.
function normalizeStroke(stroke) {
  if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)) return null;
  if (!Array.isArray(stroke.pts) || stroke.pts.length < 2 || stroke.pts.length > 200) return null;
  const pts = [];
  for (const point of stroke.pts) {
    if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
    pts.push(point.map((value) => Math.max(0, Math.min(1, value))));
  }
  return {
    pts,
    color: typeof stroke.color === 'string' && stroke.color ? stroke.color.slice(0, 16) : '#111',
    size: Number.isFinite(stroke.size) ? Math.max(1, Math.min(30, stroke.size)) : 4,
  };
}

module.exports = { normalizeStroke };
