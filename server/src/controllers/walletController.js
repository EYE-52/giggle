const User = require("../models/User");
const { walletView, redeemPlus, creditActivity } = require("../services/walletService");
const { Squad } = require("../models/Squad");

async function getWallet(req, res) {
  res.set("Cache-Control", "private, no-store");
  try {
    const userId = req.user.userId || req.user.sub;
    let user = await User.findById(userId).select("tokens isPremium premiumExpiresAt earnedRewardIds");
    if (!user) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Account not found" } });
    if (!(user.earnedRewardIds || []).includes("first_squad") && await Squad.exists({ members: { $elemMatch: { userId, role: "leader" } } })) {
      await creditActivity(userId, "first_squad");
      user = await User.findById(userId).select("tokens isPremium premiumExpiresAt earnedRewardIds");
      if (!user) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Account not found" } });
    }
    return res.json({ ok: true, data: walletView(user) });
  } catch {
    return res.status(503).json({ ok: false, error: { code: "WALLET_UNAVAILABLE", message: "Couldn't load your credits. Try again." } });
  }
}
async function redeemWalletPerk(req, res) {
  res.set("Cache-Control", "private, no-store");
  if (req.body?.perkId !== "giggle_plus") return res.status(400).json({ ok: false, error: { code: "INVALID_PERK", message: "Choose an available reward" } });
  try {
    const result = await redeemPlus(req.user.userId || req.user.sub);
    if (result.error) return res.status(409).json({ ok: false, error: { code: result.error, message: result.error === "PLUS_ACTIVE" ? "Your Giggle+ pass is already active." : "You don't have enough credits yet." } });
    return res.json({ ok: true, data: result.wallet });
  } catch {
    return res.status(503).json({ ok: false, error: { code: "REDEMPTION_UNAVAILABLE", message: "Couldn't unlock Giggle+. Check your wallet and try again." } });
  }
}
module.exports = { getWallet, redeemWalletPerk };
