const express = require("express");
const { exchangeAuth, getMyReferral } = require("../controllers/authController");
const {
  googleStart,
  googleCallback,
  appleStart,
  appleCallback,
  emailStart,
  emailVerify,
} = require("../controllers/oauthController");
const { requireApiAuth } = require("../middlewares/authMiddleware");

const router = express.Router();

// Apple posts a small form_post callback. Keep parsing flat and tightly bounded.
const appleFormParser = express.urlencoded({
  extended: false,
  limit: "16kb",
  parameterLimit: 8,
});

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication & user sync APIs
 */

/**
 * @swagger
 * /auth/exchange:
 *   post:
 *     summary: Exchange NextAuth session user for backend JWT
 *     description: |
 *       This endpoint is called after successful Google login via NextAuth.
 *       It syncs the user with backend DB (find-or-create) and returns a backend JWT.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 example: user@gmail.com
 *               name:
 *                 type: string
 *                 example: Himanshu
 *               image:
 *                 type: string
 *                 example: https://lh3.googleusercontent.com/a/photo.jpg
 *     responses:
 *       200:
 *         description: Successfully generated backend JWT
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       example: 65f1a2b3c4d5e6f7a8b9c0d1
 *                     email:
 *                       type: string
 *                       example: user@gmail.com
 *                     name:
 *                       type: string
 *                       example: Himanshu
 *                     image:
 *                       type: string
 *                       example: https://lh3.googleusercontent.com/a/photo.jpg
 *       400:
 *         description: Missing or invalid input
 *       500:
 *         description: Internal server error
 */
router.post("/exchange", exchangeAuth);

/**
 * @swagger
 * /auth/me/referral:
 *   get:
 *     summary: Get the authed user's referral code and stats
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Referral code, invite count, and token balance
 */
router.get("/me/referral", requireApiAuth, getMyReferral);

// ── Real auth providers (public — no requireApiAuth; under the auth limiter) ──
// Google OAuth (Authorization Code)
router.get("/google", googleStart);
router.get("/google/callback", googleCallback);

// Sign in with Apple (form_post)
router.get("/apple", appleStart);
router.post("/apple/callback", appleFormParser, appleCallback);

// Email magic link
router.post("/email/start", emailStart);
router.get("/email/verify", emailVerify);

module.exports = router;
