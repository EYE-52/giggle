const express = require("express");
const { getMyProfile, updateMyProfile, setMyAge } = require("../controllers/authController");
const {
  getAgeVerificationStatus,
  startAgeVerification,
} = require("../controllers/ageVerificationController");
const { requireApiAuth, requireIdentityAuth } = require("../middlewares/authMiddleware");
const { exportAccountHandler, deleteAccountHandler } = require("../controllers/accountController");
const { getWallet, redeemWalletPerk } = require("../controllers/walletController");

const router = express.Router();

/**
 * @swagger
 * /me/profile:
 *   get:
 *     summary: Get the authed user's profile demographics
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: gender, languages, country, name, email, avatar
 *   patch:
 *     summary: Update the authed user's profile demographics
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Accepts gender, languages, country, vibes and avatar (an illustrated
 *       avatar id from utils/avatars.js; null or "" clears it).
 *       Also accepts anonymousInEncounters (boolean) and encounterAlias
 *       (2-24 letters, numbers, spaces or . _ ' -; null or "" clears it):
 *       when anonymous, other squads see only the alias (or a stable
 *       "Guest NNNN" fallback), never the real name or avatar.
 *     responses:
 *       200:
 *         description: Updated profile fields
 */
router.get("/me/profile", requireIdentityAuth, getMyProfile);
router.patch("/me/profile", requireApiAuth, updateMyProfile);
router.get("/me/wallet", requireApiAuth, getWallet);
router.post("/me/wallet/redeem", requireApiAuth, redeemWalletPerk);

/**
 * @swagger
 * /me/age:
 *   post:
 *     summary: Set the authed user's self-attested date of birth (set-once)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ isAdult, ageConfirmed }"
 */
router.post("/me/age", requireIdentityAuth, setMyAge);
router.post("/me/age/verification-session", requireIdentityAuth, startAgeVerification);
router.get("/me/age/verification-status", requireIdentityAuth, getAgeVerificationStatus);
router.get("/me/export", requireIdentityAuth, exportAccountHandler);
router.delete("/me/account", requireIdentityAuth, deleteAccountHandler);

module.exports = router;
