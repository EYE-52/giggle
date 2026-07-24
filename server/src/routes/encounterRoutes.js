const express = require("express");
const { requireApiAuth } = require("../middlewares/authMiddleware");
const { issueEncounterTokenHandler, disconnectEncounterHandler } = require("../controllers/encounterController");

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Encounters
 *   description: Encounter video lifecycle and token issuance
 */

/**
 * @swagger
 * /encounters/token:
 *   post:
 *     summary: Issue Agora token for encounter channel
 *     tags: [Encounters]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Encounter token issued
 */
router.post("/encounters/token", requireApiAuth, issueEncounterTokenHandler);

/**
 * @swagger
 * /encounters/disconnect:
 *   post:
 *     summary: Disconnect from encounter and return squads to idle
 *     tags: [Encounters]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Encounter disconnected
 */
router.post("/encounters/disconnect", requireApiAuth, disconnectEncounterHandler);

module.exports = router;
