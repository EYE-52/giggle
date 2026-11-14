/** Keep referral rewards attached to both landing-page sign-in actions. */
export function referralSignInHref(search: string): string {
  const code = new URLSearchParams(search).get("ref")?.trim().toUpperCase();
  const game = new URLSearchParams(search).get("game");
  const params = new URLSearchParams(code ? {ref:code} : {});
  if (game && game.length <= 48 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(game)) params.set("next", "/home?" + new URLSearchParams({game}));
  if (!params.has("next") && new URLSearchParams(search).get("games") === "1") params.set("next", "/home?games=1");
  return params.size ? `/signin?${params}` : "/signin";
}
