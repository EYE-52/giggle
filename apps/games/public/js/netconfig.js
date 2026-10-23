/* Split-host WebSocket target (pure, node-importable like embed.js).
 *
 * The page fetches public /config.json first (same-origin locally; Vercel
 * rewrites it to the Railway backend) and dials cfg.websocketUrl when it is
 * a safe absolute ws(s) origin. Empty/unset keeps the legacy same-host
 * socket (local preview, no env changes). A FAILED config fetch resolves
 * nothing — the caller must retry without opening any socket, so seats and
 * tickets never go to an unvalidated origin.
 *
 * Validation mirrors the server's publicWebsocketUrl gate: origin form
 * only (no path/query/hash/credentials); ws: only when the caller allows
 * it (the shell passes allowWs for http:// pages, i.e. local development
 * only — an https:// page never dials ws:). Anything else yields ''.
 */

export function isValidWebsocketUrl(value, opts) {
  if (typeof value !== 'string' || !value) return false;
  const allowWs = !!(opts && opts.allowWs);
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && allowWs)) return false;
  if (url.username || url.password) return false;
  if (url.search || url.hash) return false;
  if (url.pathname !== '/' && url.pathname !== '') return false;
  return true;
}

/* Resolve the socket target from public config: the validated override
 * origin, or '' for the legacy same-host socket. Never throws. */
export function wsTargetFromConfig(cfg, opts) {
  const v = cfg && typeof cfg.websocketUrl === 'string' ? cfg.websocketUrl.trim() : '';
  if (!v || !isValidWebsocketUrl(v, opts)) return '';
  return new URL(v).origin;
}
