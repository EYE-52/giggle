/* Public navigation only. These links carry no room code, seat token or ticket.
 * Supply the deployment's configured Meet origin, never a query-string URL. */
export function safeGameId(value) {
  return typeof value === 'string' && value.length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : null;
}
function meetOrigin(base) {
  try {
    const url = new URL(base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch { return null; }
}
export function playInMeetHref(base, gameId, {adult = false} = {}) {
  const origin = meetOrigin(base), game = safeGameId(gameId);
  const selection = game ? new URLSearchParams({game}) : gameId == null ? new URLSearchParams({games:'1'}) : null;
  return origin && selection ? `${origin}${adult ? '/adult/create' : '/home'}?${selection}` : null;
}
export function addCallHref(base, {adult = false} = {}) {
  const origin = meetOrigin(base);
  return origin ? origin + (adult ? '/adult/create' : '/home') : null;
}
/* Final selection is checked against the live catalogue after real bridge auth.
 * A selection never creates, starts or takes over a game by itself. */
export function selectedGame(search, catalog) {
  if (typeof URLSearchParams !== 'function') return {requested:false, game:null};
  const raw = new URLSearchParams(search).get('game');
  if (raw === null) return {requested:false, game:null};
  const id = safeGameId(raw);
  return {requested:true, game:id && catalog.some(game => game.id === id) ? id : null};
}
