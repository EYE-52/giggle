const express = require("express");
const { getLobbyTokenHandler } = require("../controllers/agoraController");
const { requireApiAuth } = require("../middlewares/authMiddleware");
const { requireSquadMemberAccess } = require("../middlewares/squadAccessMiddleware");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Agora
 *   description: Agora RTC token issuance
 */

/**
 * @swagger
 * /agora/lobby-token/{squadId}:
 *   post:
 *     summary: Issue Agora RTC token for squad lobby channel
 *     tags: [Agora]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: squadId
 *         schema:
 *           type: string
 *         required: true
 *         description: Squad ID
 *     responses:
 *       200:
 *         description: Lobby token issued
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not a squad member
 *       404:
 *         description: Squad not found
 *       500:
 *         description: Agora misconfigured or internal error
 */
router.post("/agora/lobby-token/:squadId", requireApiAuth, requireSquadMemberAccess, getLobbyTokenHandler);

module.exports = router;
