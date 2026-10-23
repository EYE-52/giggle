/* Deferred customize intent: home cards offer Customize for supported
 * games. Inside a room the dialog opens at once; on home the intent waits
 * for the name ticket + room create, then the first room snapshot opens
 * the chosen game's dialog. Pure + tiny so node can test it. */

let pendingId = null;

export function setPendingCustomize(id) {
  pendingId = id || null;
}

export function peekPendingCustomize() {
  return pendingId;
}

/* Consume once: the first room snapshot after create owns it. */
export function takePendingCustomize() {
  const v = pendingId;
  pendingId = null;
  return v;
}

/* Decide what a Customize tap means. Never invents schema: games without
 * one report action 'none' and render no button at all. */
export function decideCustomizeIntent({ inRoom, name, gameId, customizable }) {
  if (!customizable || !gameId) return { action: 'none' };
  if (inRoom) return { action: 'open', gameId };
  const nm = String(name || '').trim();
  if (!nm) return { action: 'name-needed', gameId };
  return { action: 'create', name: nm.slice(0, 16), gameId };
}
