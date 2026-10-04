const express = require("express");
const { issueGameTicket, issueEncounterGameTicket, getGamesConfig } = require("../services/gameBridgeService");
const { anyBlockedPair } = require("../services/interactionSafetyService");
const User = require("../models/User");
const { Squad } = require("../models/Squad");
const { getRequesterIdentity, isSameMember } = require("../app/squadAccess");
const { getEncounterById, getEncounterRosterContext } = require("../services/matchmakingService");
const { requireApiAuth } = require("../middlewares/authMiddleware");
const { requireSquadMemberAccess } = require("../middlewares/squadAccessMiddleware");

const router = express.Router();

// POST /api/squads/:squadId/games/token — mint a 90-second single-use Game
// Night ticket for one verified squad member. requireApiAuth re-checks the
// requester's verified-adult + account gates from the DB on every call, and
// requireSquadMemberAccess re-checks live membership — the parent refreshes
// tickets ~every 60s, so removal/age/account changes take effect within
// ~90s. Identity is derived from the session only; the body is ignored.
const postGameTokenHandler = async (req, res) => {
  try {
    if (!getGamesConfig().enabled) {
      return res.status(503).json({
        ok: false,
        error: { code: "GAMES_UNAVAILABLE", message: "Games are unavailable right now" },
      });
    }

    const { squad, member } = req.squadAccess;
    if (await anyBlockedPair(squad.members.map((candidate) => candidate.userId), { User })) {
      return res.status(403).json({
        ok: false,
        error: { code: "INTERACTION_BLOCKED", message: "This lobby is unavailable" },
      });
    }

    const identity = req.giggleIdentity || {};
    const userId = identity.userId || identity.sub;
    const displayName = member.displayName || identity.name || "Player";
    const { ticket, gameUrl } = issueGameTicket({
      squadId: squad.squadId,
      userId,
      displayName,
    });

    return res.status(200).json({
      ok: true,
      data: { squadId: squad.squadId, gameUrl, ticket },
    });
  } catch (error) {
    if (error.code === "GAMES_UNAVAILABLE") {
      return res.status(503).json({
        ok: false,
        error: { code: "GAMES_UNAVAILABLE", message: "Games are unavailable right now" },
      });
    }
    console.error("Error issuing game ticket:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to issue game ticket" },
    });
  }
};

/**
 * @swagger
 * /squads/{squadId}/games/token:
 *   post:
 *     summary: Issue a single-use Game Night ticket for a squad member
 *     tags: [Squads]
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
 *         description: Game URL + ticket issued
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not a squad member, or interaction blocked
 *       404:
 *         description: Squad not found
 *       503:
 *         description: Games unavailable (not configured)
 */
router.post("/squads/:squadId/games/token", requireApiAuth, requireSquadMemberAccess, postGameTokenHandler);

// POST /api/encounters/:encounterId/games/token — mint a 90-second single-use
// Game Night ticket scoped to the encounter's ONE shared game room. Both
// squads in the call receive tickets for the same namespaced room key, so
// they land in the same game together without leaving/rejoining Agora.
//
// Same safety/access checks as the encounter Agora token route, re-checked
// on every call (the parent renews ~every 60s, so an ended encounter or a
// removed member stops getting tickets within ~90s):
// - requireApiAuth: verified-adult + account gates from the DB
// - live membership in one of the encounter's two squads (server records)
// - requester's squad still points at this encounter (active membership)
// - encounter exists and is active (ended/awaiting_ack cannot mint)
// - no blocked pair across BOTH squads' rosters
// Identity and scope derive from the session + URL + server records only;
// the request body is ignored entirely.
const postEncounterGameTokenHandler = async (req, res) => {
  try {
    if (!getGamesConfig().enabled) {
      return res.status(503).json({
        ok: false,
        error: { code: "GAMES_UNAVAILABLE", message: "Games are unavailable right now" },
      });
    }

    const encounterId = req.params.encounterId;
    if (!encounterId) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_REQUEST", message: "encounterId is required" },
      });
    }

    const encounter = await getEncounterById(encounterId);
    if (!encounter) {
      return res.status(404).json({
        ok: false,
        error: { code: "ENCOUNTER_NOT_FOUND", message: "Encounter not found" },
      });
    }

    const [squadA, squadB] = await Promise.all([
      Squad.findOne({ squadId: encounter.squadAId }),
      Squad.findOne({ squadId: encounter.squadBId }),
    ]);

    // Membership comes before block state so an outsider with an encounter id
    // cannot distinguish a blocked encounter from any other forbidden one.
    const identity = getRequesterIdentity(req);
    const ownSquad =
      squadA && squadA.members.some((member) => isSameMember(member, identity))
        ? squadA
        : squadB && squadB.members.some((member) => isSameMember(member, identity))
          ? squadB
          : null;
    if (!ownSquad) {
      return res.status(403).json({
        ok: false,
        error: { code: "FORBIDDEN", message: "Not authorized for this encounter" },
      });
    }
    const member = ownSquad.members.find((candidate) => isSameMember(candidate, identity));

    if (ownSquad.currentEncounterId !== encounterId) {
      return res.status(403).json({
        ok: false,
        error: { code: "MEMBER_NOT_IN_ENCOUNTER", message: "Member is not in requested encounter" },
      });
    }

    if (encounter.status !== "active") {
      return res.status(409).json({
        ok: false,
        error: {
          code: encounter.status === "ended" ? "ENCOUNTER_ENDED" : "ENCOUNTER_NOT_ACTIVE",
          message: encounter.status === "ended" ? "This call has ended" : "Both squads must join before opening call devices",
        },
      });
    }

    const { allowed } = await getEncounterRosterContext({ encounter, squadA, squadB });
    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: { code: "INTERACTION_BLOCKED", message: "This encounter is unavailable" },
      });
    }

    const userId = identity.userId;
    const displayName = member.displayName || identity.name || "Player";
    const { ticket, gameUrl } = issueEncounterGameTicket({
      encounterId,
      userId,
      displayName,
    });

    return res.status(200).json({
      ok: true,
      data: { encounterId, squadId: ownSquad.squadId, gameUrl, ticket },
    });
  } catch (error) {
    if (error.code === "GAMES_UNAVAILABLE") {
      return res.status(503).json({
        ok: false,
        error: { code: "GAMES_UNAVAILABLE", message: "Games are unavailable right now" },
      });
    }
    console.error("Error issuing encounter game ticket:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to issue game ticket" },
    });
  }
};

/**
 * @swagger
 * /encounters/{encounterId}/games/token:
 *   post:
 *     summary: Issue a single-use Game Night ticket for the encounter's shared game room
 *     tags: [Encounters]
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
 *         description: Game URL + ticket issued (both squads share one room)
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Not in this encounter, or interaction blocked
 *       404:
 *         description: Encounter not found
 *       409:
 *         description: Encounter ended or not active
 *       503:
 *         description: Games unavailable (not configured)
 */
router.post("/encounters/:encounterId/games/token", requireApiAuth, postEncounterGameTokenHandler);

module.exports = router;
module.exports.postGameTokenHandler = postGameTokenHandler;
module.exports.postEncounterGameTokenHandler = postEncounterGameTokenHandler;
