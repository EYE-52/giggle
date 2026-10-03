function hasActivePremium(user, now = Date.now()) {
  if (!user?.isPremium) return false;
  if (!user.premiumExpiresAt) return true;
  const expires = new Date(user.premiumExpiresAt).getTime();
  return Number.isFinite(expires) && expires > now;
}
module.exports = { hasActivePremium };
