const express = require("express");
const router = express.Router();
const { Squad } = require("../models/Squad");
const { Encounter } = require("../models/Encounter");
const User = require("../models/User");

/**
 * @swagger
 * /stats:
 *   get:
 *     summary: Get live platform stats
 *     tags: [Stats]
 *     security: []
 *     responses:
 *       200:
 *         description: Live stats
 */
router.get("/stats", async (req, res) => {
  try {
    const [squadsTotal, encountersTotal, playersOnline, searching, liveEncounters] = await Promise.all([
      Squad.countDocuments(),
      Encounter.countDocuments(),
      User.countDocuments(),
      Squad.countDocuments({ status: "searching" }),
      Encounter.countDocuments({ status: "active" }),
    ]);

    res.json({
      ok: true,
      data: {
        squadsTotal,
        // Legacy alias for older clients. New UI should use squadsTotal because
        // this is an all-time count, not a presence-backed online count.
        squadsOnline: squadsTotal,
        playersOnline,
        encountersTotal,
        searching,
        liveEncounters,
      },
    });
  } catch (err) {
    console.error("[stats] error:", err);
    res.status(500).json({ ok: false, error: { code: "STATS_ERROR", message: "Failed to fetch stats" } });
  }
});

module.exports = router;
