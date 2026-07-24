const express = require("express");
const { requireApiAuth } = require("../middlewares/authMiddleware");
const { requireSquadMemberAccess } = require("../middlewares/squadAccessMiddleware");
const {
  getMatchmakingStatusHandler,
  getEncounterHandoffHandler,
  ackEncounterJoinHandler,
  skipEncounterHandler,
} = require("../controllers/matchmakingController");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Matchmaking
 *   description: Matchmaking status and encounter handoff
 */

/**
 * @swagger
 * /matchmaking/status/{squadId}:
 *   get:
 *     summary: Get matchmaking status for squad
 *     tags: [Matchmaking]
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
 *         description: Matchmaking status
 */
router.get("/matchmaking/status/:squadId", requireApiAuth, requireSquadMemberAccess, getMatchmakingStatusHandler);

/**
 * @swagger
 * /matchmaking/encounters/{encounterId}:
 *   get:
 *     summary: Get encounter handoff status
 *     tags: [Matchmaking]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: encounterId
 *         schema:
 *           type: string
 *         required: true
 *         description: Encounter ID
 *     responses:
 *       200:
 *         description: Encounter handoff status
 */
router.get("/matchmaking/encounters/:encounterId", requireApiAuth, getEncounterHandoffHandler);

/**
 * @swagger
 * /matchmaking/encounters/{encounterId}/ack:
 *   post:
 *     summary: Acknowledge encounter join
 *     tags: [Matchmaking]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: encounterId
 *         schema:
 *           type: string
 *         required: true
 *         description: Encounter ID
 *     responses:
 *       200:
 *         description: Encounter join acknowledged
 */
router.post("/matchmaking/encounters/:encounterId/ack", requireApiAuth, ackEncounterJoinHandler);

/**
 * @swagger
 * /matchmaking/skip:
 *   post:
 *     summary: Skip encounter and requeue squad (leader only)
 *     tags: [Matchmaking]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Encounter skipped and squad requeued
 */
router.post("/matchmaking/skip", requireApiAuth, skipEncounterHandler);

module.exports = router;
