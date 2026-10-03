const User = require("../models/User");
const { hasActivePremium } = require("../utils/premium");
const PLUS_COST = 200;
const PLUS_DAYS = 7;
const ACTIVITY_REWARDS = Object.freeze({ first_squad: 25 });

function walletView(user) {
  return {
    credits: Math.max(0, user.tokens || 0),
    premium: hasActivePremium(user),
    premiumUntil: user.premiumExpiresAt ? new Date(user.premiumExpiresAt).toISOString() : null,
    plus: { id: "giggle_plus", cost: PLUS_COST, days: PLUS_DAYS },
    rewards: Object.entries(ACTIVITY_REWARDS).map(([id, credits]) => ({ id, credits, earned: (user.earnedRewardIds || []).includes(id) })),
  };
}

async function creditActivity(userId, rewardId) {
  const credits = ACTIVITY_REWARDS[rewardId];
  if (!userId || !credits) return false;
  // One atomic update: retries/concurrent requests cannot award this twice.
  const result = await User.updateOne({ _id: userId, earnedRewardIds: { $ne: rewardId } }, {
    $addToSet: { earnedRewardIds: rewardId }, $inc: { tokens: credits },
  });
  return result.modifiedCount === 1;
}

async function redeemPlus(userId) {
  const now = new Date();
  const premiumExpiresAt = new Date(now.getTime() + PLUS_DAYS * 86400000);
  // Debit and grant together. An active pass or insufficient balance never spends.
  const user = await User.findOneAndUpdate({
    _id: userId, tokens: { $gte: PLUS_COST },
    $or: [{ isPremium: { $ne: true } }, { premiumExpiresAt: { $lte: now } }],
  }, { $inc: { tokens: -PLUS_COST }, $set: { isPremium: true, premiumExpiresAt } }, { new: true });
  if (user) return { wallet: walletView(user) };
  const current = await User.findById(userId);
  if (!current) return { error: "NOT_FOUND" };
  return { error: hasActivePremium(current) ? "PLUS_ACTIVE" : "INSUFFICIENT_CREDITS" };
}
module.exports = { walletView, creditActivity, redeemPlus, PLUS_COST, PLUS_DAYS };
