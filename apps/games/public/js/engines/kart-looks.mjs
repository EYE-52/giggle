/* A player's chosen kart look: paint and animal driver. The server stores
 * it per seat and sends it in the room roster; app.js hands the arena views
 * { driver, color } per pid through the host context, and they fall back
 * to their own colours and the pid hash when a player never chose. Shared
 * by the browser and the server. */

// Same order as KART_DRIVERS in kart-assets.mjs (test/kart-looks.mjs checks).
export const KART_LOOK_DRIVERS = Object.freeze([
  Object.freeze({ id: 'fox', name: 'Fox', blurb: 'Goggles always on', emoji: '🦊' }),
  Object.freeze({ id: 'bunny', name: 'Bunny', blurb: 'Ears in the wind', emoji: '🐰' }),
  Object.freeze({ id: 'panda', name: 'Panda', blurb: 'Red racing suit', emoji: '🐼' }),
  Object.freeze({ id: 'raccoon', name: 'Raccoon', blurb: 'Masked bandit', emoji: '🦝' }),
]);

export const KART_PAINTS = Object.freeze([
  Object.freeze({ id: 'tangerine', name: 'Tangerine', hex: 0xf59539 }),
  Object.freeze({ id: 'cherry', name: 'Cherry', hex: 0xec5765 }),
  Object.freeze({ id: 'bubblegum', name: 'Bubblegum', hex: 0xca49b0 }),
  Object.freeze({ id: 'grape', name: 'Grape', hex: 0xaf7cde }),
  Object.freeze({ id: 'sky', name: 'Sky', hex: 0x5c8ceb }),
  Object.freeze({ id: 'teal', name: 'Teal', hex: 0x21a9af }),
  Object.freeze({ id: 'lime', name: 'Lime', hex: 0x7eb643 }),
  Object.freeze({ id: 'lemon', name: 'Lemon', hex: 0xffd451 }),
]);

/* A clean { paint, driver } or null. Unknown ids are dropped one by one,
 * so a look from a newer client still keeps the half this one knows. */
export function cleanKartLook(look) {
  if (!look || typeof look !== 'object' || Array.isArray(look)) return null;
  const paint = typeof look.paint === 'string' && KART_PAINTS.some(p => p.id === look.paint) ? look.paint : null;
  const driver = typeof look.driver === 'string' && KART_LOOK_DRIVERS.some(d => d.id === look.driver) ? look.driver : null;
  if (!paint && !driver) return null;
  return { ...(paint ? { paint } : {}), ...(driver ? { driver } : {}) };
}

export function kartPaintHex(id) {
  return KART_PAINTS.find(p => p.id === id)?.hex ?? null;
}
