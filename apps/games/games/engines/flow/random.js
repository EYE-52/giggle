'use strict';
// FNV-1a string seed, then the standard xorshift32 recurrence (13, 17, 5).
// Reproducible variety only. Do not use for secrets or security decisions.
function createRandom(seed, state) {
  let word = 2166136261;
  for (const ch of String(seed)) word = Math.imul(word ^ ch.codePointAt(0), 16777619) >>> 0;
  word = state ?? (word || 0x9e3779b9);
  if (!Number.isInteger(word) || word <= 0 || word > 0xffffffff) throw new Error('Invalid RNG state');
  return {
    next() { word ^= word << 13; word ^= word >>> 17; word ^= word << 5; return (word >>>= 0) / 4294967296; },
    state: () => word,
  };
}
function weighted(rows, weight, random) {
  const weights = rows.map(weight);
  if (weights.some(w => !Number.isFinite(w) || w < 0)) throw new Error('Invalid sampling weight');
  const scale = weights.reduce((a, b) => Math.max(a, b), 0);
  if (!scale) return null;
  const normalized = weights.map(w => w / scale);
  const total = normalized.reduce((a, b) => a + b, 0);
  let ticket = random() * total;
  for (let i = 0; i < rows.length; i++) { ticket -= normalized[i]; if (ticket < 0) return rows[i]; }
  return rows.at(-1);
}
module.exports = { createRandom, weighted };
