const express = require("express");
const router = express.Router();
const { getSquadCoverImageHandler } = require("../controllers/coverController");

/**
 * @swagger
 * /covers/{squadId}/{hash}:
 *   get:
 *     summary: Get a squad's uploaded cover image
 *     description: >
 *       Public and immutable. Squad responses carry this URL (with the current
 *       cover's content hash) in place of the uploaded image data.
 *     tags: [Squads]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: squadId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: hash
 *         required: true
 *         schema:
 *           type: string
 *           pattern: '^[a-f0-9]{16}$'
 *     responses:
 *       200:
 *         description: Cover image bytes
 *       404:
 *         description: No such cover
 */
router.get("/covers/:squadId/:hash", getSquadCoverImageHandler);

module.exports = router;
