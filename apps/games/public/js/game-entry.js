/* Game detail entry: ?game=id&name=...[&wantsetup=1] from /games/id/ pages.
 *
 * The generated pages are plain GET forms to / — they create nothing by
 * themselves. This module is the ONLY query reader for that flow: pure,
 * node-importable helpers (no window at module scope) plus a tiny one-shot
 * pending slot, mirroring pending-customize.js.
 *
 * Contract (integration owns the shell/server halves in app.js + server.js):
 * - validate against the ACTUAL catalog (registry list), never a hardcoded
 *   id list; name trimmed, 1..16 chars; invalid id/name never auto-creates.
 * - an explicitly submitted valid form creates ONE room, only once the
 *   socket is open AND the catalog has arrived; never auto-starts a game
 *   (friends/minimum gating stays in the lobby, server-enforced).
 * - after the room exists the lobby selects/shows the game and opens its
 *   Howto; wantsetup=1 opens the Customizer when the game is supported.
 * - a bare page visit (no ?game=) has zero effects; embed mode and /r/
 *   links are unaffected (entry applies on / only, standalone only).
 * - an explicit valid query overrides the remembered pb_room autojoin; the
 *   query is cleared after consumption so a refresh never re-creates.
 * - Details links on catalog cards are native <a href="/games/<id>/"> —
 *   detailsHref() allow-lists the id so cards never link unsafe paths.
 */

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ID_LEN = 40;
export const MAX_ENTRY_NAME = 16;

function safeId(id) {
  if (typeof id !== 'string' || id.length < 2 || id.length > MAX_ID_LEN) return null;
  return ID_RE.test(id) ? id : null;
}

/* Native Details URL for a catalog card, or null when the id is unsafe.
 * Cards render a link only when this returns a string. */
export function detailsHref(gameId) {
  const id = safeId(gameId);
  return id ? `/games/${id}/` : null;
}

/* Raw parse of the shell query string. Returns null when no ?game= param
 * is present (bare visit — no effects). Never throws on malformed input. */
export function parseGameEntry(search) {
  let params;
  try {
    params = new URLSearchParams(String(search || ''));
  } catch {
    return null;
  }
  const rawGame = params.get('game');
  if (rawGame === null || rawGame === '') return null;
  const rawName = params.get('name');
  return {
    gameId: String(rawGame || ''),
    name: rawName === null ? '' : String(rawName),
    wantSetup: params.get('wantsetup') === '1',
  };
}

/* Catalog lookup: accepts registry list entries ({id, customizable}) or
 * plain id strings. Returns the matched entry or null. */
function findCatalogEntry(catalog, gameId) {
  if (!Array.isArray(catalog)) return null;
  for (const g of catalog) {
    if (typeof g === 'string') {
      if (g === gameId) return { id: g, customizable: false, unknownCustom: true };
    } else if (g && typeof g === 'object' && g.id === gameId) {
      return g;
    }
  }
  return null;
}

/* Validate a parsed entry against the ACTUAL catalog. Catalog must be the
 * live registry list (non-empty); an empty/not-yet-loaded catalog reports
 * { ok:false, reason:'catalog-pending' } so the caller WAITS instead of
 * treating a good id as invalid. Any other failure reports a stable
 * reason and the caller must NOT create a room. wantsetup on a game
 * without schema degrades to a plain entry (still ok, wantSetup:false). */
export function validateGameEntry(parsed, catalog) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'missing' };
  if (!Array.isArray(catalog) || catalog.length === 0) {
    return { ok: false, reason: 'catalog-pending' };
  }
  const gameId = String(parsed.gameId || '');
  if (!safeId(gameId)) return { ok: false, reason: 'unknown-game' };
  const entry = findCatalogEntry(catalog, gameId);
  if (!entry) return { ok: false, reason: 'unknown-game' };
  const name = String(parsed.name || '').trim();
  if (!name || name.length > MAX_ENTRY_NAME) {
    return { ok: false, reason: 'bad-name' };
  }
  const customizable = entry.unknownCustom ? true : entry.customizable === true;
  const wantSetup = parsed.wantSetup === true && customizable && !entry.unknownCustom
    ? true
    : (parsed.wantSetup === true && entry.unknownCustom ? true : false);
  // String-list catalogs cannot judge schema: preserve the flag so the
  // shell can re-check against the full entry before opening the dialog.
  return { ok: true, gameId, name, wantSetup, customizable };
}

/* Entry applies on the home path, standalone only. Embed mode keeps its
 * ticket flow; /r/CODE links keep their room — both ignore ?game=. */
export function shouldHandleGameEntry({ parsed, pathname, embedEnabled }) {
  if (!parsed) return false;
  if (embedEnabled === true) return false;
  const p = String(pathname || '/');
  if (p !== '/' && p !== '' && p !== '/index.html') return false;
  return true;
}

/* An explicit VALID query overrides the remembered pb_room autojoin. */
export function entryOverridesAutojoin(validated) {
  return !!validated && validated.ok === true;
}

/* Strip the entry params after consumption (preserving embed/parentOrigin
 * and any other keys) so a refresh never re-creates. Returns the new
 * search string ('' when empty, else leading '?'). */
export function stripGameEntryParams(search) {
  let params;
  try {
    params = new URLSearchParams(String(search || ''));
  } catch {
    return '';
  }
  params.delete('game');
  params.delete('name');
  params.delete('wantsetup');
  const s = params.toString();
  return s ? `?${s}` : '';
}

/* Decide the ONE create. Pure so the shell and tests share it:
 * - invalid/missing -> { action:'none' }
 * - already consumed or already in a room -> { action:'none' }
 * - socket down or catalog not ready -> { action:'wait' }
 * - otherwise -> { action:'create', name, gameId, wantSetup }
 * Never returns a start action: the lobby/host gates starting. */
export function decideGameEntryCreate({ validated, wsReady, catalogReady, inRoom, consumed }) {
  if (!validated || validated.ok !== true) return { action: 'none' };
  if (consumed === true) return { action: 'none' };
  if (inRoom === true) return { action: 'none' };
  if (wsReady !== true || catalogReady !== true) return { action: 'wait' };
  return {
    action: 'create',
    name: validated.name,
    gameId: validated.gameId,
    wantSetup: validated.wantSetup === true,
  };
}

/* After the room exists, the lobby shows the chosen game: open its Howto,
 * or the Customizer when wantsetup was requested AND the game supports
 * it. Returns { action:'show', gameId, open } where open is
 * 'customizer'|'howto', or { action:'none' } when there is nothing to do. */
export function decideGameEntryShow({ pending, inLobby, catalog }) {
  if (!pending || typeof pending.gameId !== 'string') return { action: 'none' };
  if (inLobby !== true) return { action: 'none' };
  const entry = findCatalogEntry(Array.isArray(catalog) ? catalog : [], pending.gameId);
  if (!entry) return { action: 'none' };
  const supported = entry.unknownCustom ? true : entry.customizable === true;
  const open = pending.wantSetup === true && supported ? 'customizer' : 'howto';
  // String-list catalogs preserve intent; the shell re-checks support.
  if (pending.wantSetup === true && !supported) return { action: 'show', gameId: pending.gameId, open: 'howto' };
  return { action: 'show', gameId: pending.gameId, open };
}

/* One-shot pending slot: the boot query is parsed once, consumed once.
 * setPendingGameEntry stores a validated entry (or null to clear);
 * takePendingGameEntry consumes it exactly once. */
let pendingEntry = null;

export function setPendingGameEntry(entry) {
  pendingEntry = entry && typeof entry === 'object' ? entry : null;
}

export function peekPendingGameEntry() {
  return pendingEntry;
}

export function takePendingGameEntry() {
  const v = pendingEntry;
  pendingEntry = null;
  return v;
}
