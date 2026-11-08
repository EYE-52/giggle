/* Explicit manifest opt-in. Seat caps exclude spectator places. */
export function sameRoomSupport(game) {
  if (!game || ![true, 'handoff'].includes(game.sameRoom)) return null;
  const max = Math.min(20, game.maxPlayers, game.seats || 20);
  return Number.isInteger(max) && max >= 2 ? { min: 2, max, handoff: game.sameRoom === 'handoff' } : null;
}

export const LOCAL_AVATARS = Object.freeze(['🦊', '🐸', '🐼', '🐙', '🦁', '🐨', '🐯', '🐧', '🐵', '🦄', '🐝', '🦋', '🐢', '🐳', '🦉', '🐞', '🐰', '🐻', '🦜', '🦔']);
