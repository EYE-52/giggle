/* Game-document adapter. This is room plumbing, never a rendering API. */
export const GAME_PROTOCOL = 'giggle-game-v1';
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function frameEntry(gameId, runtime) {
  if (!ID.test(gameId) || gameId.length < 2 || gameId.length > 40 || runtime?.type !== 'frame') return null;
  const entry = runtime.entry;
  if (typeof entry !== 'string' || !entry.endsWith('.html') || entry.length > 160 ||
      !entry.split('/').every(p => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(p) && p !== '.' && p !== '..')) return null;
  return `/game-assets/${gameId}/${entry}`;
}
export function isGameMessage(event, source, origin, session) {
  const d = event?.data;
  return event?.source === source && source != null && event.origin === origin &&
    d && typeof d === 'object' && !Array.isArray(d) && d.protocol === GAME_PROTOCOL && d.session === session;
}
export function envelope(session, type, fields = {}) {
  return { ...fields, protocol: GAME_PROTOCOL, session, type };
}
export function currentAction(message, state) {
  return !!state && message.instanceId === state.instanceId && message.window === state.w &&
    !state.spectator;
}
