const express = require("express");
const { requireApiAuth } = require("../middlewares/authMiddleware");
const {
  getSuggestStatusHandler,
  suggestAvatarHandler,
} = require("../controllers/avatarMatchController");

const router = express.Router();

/**
 * @swagger
 * /me/avatar/suggest/status:
 *   get:
 *     summary: Feature flag, quota and budget state for photo avatar matching
 *     tags: [Avatar]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: "{ enabled, remainingToday, remainingMonth }"
 */
router.get("/me/avatar/suggest/status", requireApiAuth, getSuggestStatusHandler);

/**
 * @swagger
 * /me/avatar/suggest:
 *   post:
 *     summary: Suggest avatar configurations from one selfie (flag-gated)
 *     tags: [Avatar]
 *     security:
 *       - bearerAuth: []
 *     description: >
 *       Accepts a JPEG data URL plus an optional validated base character
 *       config and a client UUID v4 requestId. Rate/quota/budget capped; the
 *       same requestId replays the stored result for 24 hours.
 *     responses:
 *       200:
 *         description: match with 3 configs, or a no_face/multiple_faces/unclear_photo status
 */
router.post("/me/avatar/suggest", requireApiAuth, suggestAvatarHandler);

module.exports = router;
