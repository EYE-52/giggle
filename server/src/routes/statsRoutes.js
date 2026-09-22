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
// Public, non-personalised counters: cache per process for a short window and
// share one in-flight computation so bursts of landing-page traffic cost at most
// one set of Mongo counts per replica per STATS_CACHE_TTL_MS.
const STATS_CACHE_TTL_MS = 30 * 1000;
let statsCache = { data: null, expiresAt: 0 };
let statsInFlight = null;

const computeStats = async () => {
  const [squadsTotal, encountersTotal, playersOnline, searching, liveEncounters] = await Promise.all([
    // Whole-collection totals use collection metadata instead of scanning.
    Squad.estimatedDocumentCount(),
    Encounter.estimatedDocumentCount(),
    User.estimatedDocumentCount(),
    Squad.countDocuments({ status: "searching" }),
    Encounter.countDocuments({ status: "active" }),
  ]);

  return {
    squadsTotal,
    // Legacy alias for older clients. New UI should use squadsTotal because
    // this is an all-time count, not a presence-backed online count.
    squadsOnline: squadsTotal,
    playersOnline,
    encountersTotal,
    searching,
    liveEncounters,
  };
};

const getCachedStats = async () => {
  if (statsCache.data && Date.now() < statsCache.expiresAt) return statsCache.data;
  if (!statsInFlight) {
    statsInFlight = computeStats()
      .then((data) => {
        statsCache = { data, expiresAt: Date.now() + STATS_CACHE_TTL_MS };
        return data;
      })
      .finally(() => {
        statsInFlight = null;
      });
  }
  return statsInFlight;
};

router.get("/stats", async (req, res) => {
  try {
    const data = await getCachedStats();
    res.json({ ok: true, data });
  } catch (err) {
    console.error("[stats] error:", err);
    res.status(500).json({ ok: false, error: { code: "STATS_ERROR", message: "Failed to fetch stats" } });
  }
});

module.exports = router;
