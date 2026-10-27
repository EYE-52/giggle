/* A semantic game event is audible once in its live instance. A cold,
 * muted, hidden or reconnect-baseline event is consumed, never queued. */
export function createGameCuePlayer(play, state, context) {
  const seen = new Set();
  let instance = null;
  return (name, options = {}) => {
    const current = state(), env = context();
    if (!current?.instanceId || current.game !== env.game || !env.connected) return false;
    if (instance !== current.instanceId) { seen.clear(); instance = current.instanceId; }
    const id = options.id;
    if (typeof id !== 'string' || id.length > 240 || !id.startsWith(instance + ':')) return false;
    const key = name + ':' + id;
    if (seen.has(key)) return false;
    seen.add(key);
    if (seen.size > 512) seen.delete(seen.values().next().value);
    if (current.preparing || current.audioBaseline || env.hidden || env.pending) return false;
    return play(name, options) === true;
  };
}
