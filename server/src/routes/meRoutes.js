const express = require("express");
const { getMyProfile, updateMyProfile, setMyAge } = require("../controllers/authController");
const {
  getAgeVerificationStatus,
  startAgeVerification,
} = require("../controllers/ageVerificationController");
const { requireApiAuth, requireIdentityAuth } = require("../middlewares/authMiddleware");
const { exportAccountHandler, deleteAccountHandler } = require("../controllers/accountController");

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
 *         description: gender, languages, country, name, email
 *   patch:
 *     summary: Update the authed user's profile demographics
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated profile fields
 */
router.get("/me/profile", requireIdentityAuth, getMyProfile);
router.patch("/me/profile", requireApiAuth, updateMyProfile);

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
