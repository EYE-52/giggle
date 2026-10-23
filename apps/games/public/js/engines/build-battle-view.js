/* Shared build-battle view helpers: map geometry + status math driven by
 * the server's arena config, so every engine game renders its own layout
 * from the same code. No DOM here — game views own their markup. */

export function zoneCells(zone) {
  const cells = [];
  if (!zone) return cells;
  for (let y = zone.y0; y <= zone.y1; y++) {
    for (let x = zone.x0; x <= zone.x1; x++) cells.push({ x, y });
  }
  return cells;
}

export function cellKey(x, y) {
  return x + ',' + y;
}

export function gridMap(cells) {
  const m = new Map();
  for (const c of cells || []) m.set(cellKey(c.x, c.y), c);
  return m;
}

export function inZone(zone, x, y) {
  return !!zone && x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1;
}

/* Health band for damage styling: full (>60%), hurt (>30%), crit. */
export function hpBand(hp, maxHp) {
  const r = maxHp > 0 ? hp / maxHp : 0;
  if (r > 0.6) return 'full';
  if (r > 0.3) return 'hurt';
  return 'crit';
}

export function hpPct(hp, maxHp) {
  if (!maxHp) return 0;
  return Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
}

/* ms until a weapon is ready again, from the server's absolute readyAt and
 * the client's clock. Server-armed, client-displayed (display only). */
export function cooldownLeft(readyAt, now) {
  if (!readyAt) return 0;
  return Math.max(0, readyAt - (now || Date.now()));
}

export function fmtSeconds(ms) {
  return Math.max(0, Math.ceil(ms / 1000));
}

/* Piece glyphs: blocky paper-fort marks drawn as text (no emoji icons).
 * Games may override per piece id via the `extra` map. */
const GLYPHS = {
  wall: '▦', tower: '♜', cannon: '◉', keep: '♛', core: '⬢',
};

export function pieceGlyph(pieceId, extra) {
  if (extra && extra[pieceId]) return extra[pieceId];
  return GLYPHS[pieceId] || '▣';
}

const WEAPON_GLYPHS = {
  catapult: '➶', firearrow: '➹', trebuchet: '⛭',
};

export function weaponGlyph(weaponId, extra) {
  if (extra && extra[weaponId]) return extra[weaponId];
  return WEAPON_GLYPHS[weaponId] || '✸';
}
