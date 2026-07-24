const express = require("express");
const { getMyProfile, updateMyProfile, setMyAge } = require("../controllers/authController");
const { requireApiAuth } = require("../middlewares/authMiddleware");

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
 *         description: gender, age, languages, country, name, email
 *   patch:
 *     summary: Update the authed user's profile demographics
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Updated profile fields
 */
router.get("/me/profile", requireApiAuth, getMyProfile);
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
 *       409:
 *         description: Date of birth already confirmed
 */
router.post("/me/age", requireApiAuth, setMyAge);

module.exports = router;
