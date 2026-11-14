/** A game slug is a selection only. It grants no room, seat or host access.
 * The embedded game's current catalogue makes the final availability check. */
export function safeGameId(value: unknown): string | null {
  return typeof value === "string" && value.length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) ? value : null;
}
export function readGameIntent(search: string): string | null {
  return safeGameId(new URLSearchParams(search).get("game"));
}
export function readGamesIntent(search: string): boolean {
  const params = new URLSearchParams(search);
  return !!readGameIntent(search) || params.get("games") === "1";
}
export function withGameIntent(path: string, gameId: string | null, openGames = false): string {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f]/.test(path)) return "/home";
  const url = new URL(path, "https://meet.invalid");
  const id = safeGameId(gameId);
  url.searchParams.delete("game"); url.searchParams.delete("games");
  if (id) url.searchParams.set("game", id);
  else if (openGames) url.searchParams.set("games", "1");
  return url.pathname + url.search + url.hash;
}
export function gameMeetPath(gameId: string | null, adult = false): string {
  return withGameIntent(adult ? "/adult/create" : "/home", gameId, true);
}
