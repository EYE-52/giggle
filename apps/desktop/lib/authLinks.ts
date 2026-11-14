/** Keep referral rewards attached to both landing-page sign-in actions. */
export function referralSignInHref(search: string): string {
  const code = new URLSearchParams(search).get("ref")?.trim().toUpperCase();
  const query = new URLSearchParams(search);
  const intent = new URLSearchParams();
  if (query.get("create") === "1") {
    intent.set("create", "1");
    const mode = query.get("mode");
    const matching = query.get("match") === "1";
    intent.set("mode", !matching && (mode === "chat" || mode === "voice") ? mode : "video");
    if (matching) intent.set("match", "1");
  }
  const game = query.get("game");
  if (game && game.length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(game)) intent.set("game", game);
  else if (query.get("games") === "1") intent.set("games", "1");
  const params = new URLSearchParams(code ? {ref:code} : {});
  if (intent.size) params.set("next", "/home?" + intent);
  return params.size ? `/signin?${params}` : "/signin";
}

/** Continue to a local page after sign-in; referral text cannot change the destination. */
export function authContinuationHref(path: string): string {
  const safe = path.startsWith("/") && !path.startsWith("//") && !/[\\\u0000-\u001f]/.test(path) ? path : "/home";
  const target = new URL(safe, "https://meet.invalid");
  const params = new URLSearchParams({next:target.pathname + target.search + target.hash});
  const ref = target.searchParams.get("ref")?.trim().toUpperCase();
  if (ref) params.set("ref", ref);
  return `/signin?${params}`;
}
