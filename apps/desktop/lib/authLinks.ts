/** Keep referral rewards attached to both landing-page sign-in actions. */
export function referralSignInHref(search: string): string {
  const code = new URLSearchParams(search).get("ref")?.trim().toUpperCase();
  return code ? `/signin?${new URLSearchParams({ ref: code })}` : "/signin";
}
