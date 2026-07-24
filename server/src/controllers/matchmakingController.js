const { getRequesterIdentity, getSquadAccessContext, isSameMember } = require("../app/squadAccess");
const { Squad } = require("../models/Squad");
const {
  getMatchmakingStatus,
  getEncounterById,
  ackEncounterForSquad,
  endEncounterAndRequeue,
} = require("../services/matchmakingService");
const { hashStringToUid } = require("../services/agoraTokenService");

const getMatchmakingStatusHandler = async (req, res) => {
  const { squadId } = req.params;

  try {
    const status = await getMatchmakingStatus(squadId);
    if (!status) {
      return res.status(404).json({
        ok: false,
        error: { code: "SQUAD_NOT_FOUND", message: "Squad not found" },
      });
    }

    const { squad, queue, match } = status;

    return res.status(200).json({
      ok: true,
      data: {
        squadId: squad.squadId,
        state: squad.status,
        queue,
        match,
      },
    });
  } catch (error) {
    console.error("Error getting matchmaking status:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to get matchmaking status" },
    });
  }
};

const getEncounterHandoffHandler = async (req, res) => {
  const { encounterId } = req.params;
  const identity = getRequesterIdentity(req);

  try {
    const encounter = await getEncounterById(encounterId);
    if (!encounter) {
      return res.status(404).json({
        ok: false,
        error: { code: "ENCOUNTER_NOT_FOUND", message: "Encounter not found" },
      });
    }

    // Multi-squad membership: authorize against THIS encounter's two squads
    // specifically (the user's most-recent squad may be unrelated to it).
    const [squadA, squadB] = await Promise.all([
      Squad.findOne({ squadId: encounter.squadAId }),
      Squad.findOne({ squadId: encounter.squadBId }),
    ]);

    const isInEncounter =
      (squadA && squadA.members.some((m) => isSameMember(m, identity))) ||
      (squadB && squadB.members.some((m) => isSameMember(m, identity)));

    if (!isInEncounter) {
      return res.status(403).json({
        ok: false,
        error: { code: "FORBIDDEN", message: "Not authorized for this encounter" },
      });
    }

    // uid MUST match the RTC token uid so the client can map uid -> member.
    // Computed with the same hash + input (`encounterId:userId`) the token service uses.
    const mapMembers = (members) => (members || []).map(m => ({
      memberId: m.memberId,
      userId: m.userId,
      displayName: m.displayName || m.userId,
      role: m.role,
      uid: hashStringToUid(`${encounter.encounterId}:${m.userId}`),
    }));

    return res.status(200).json({
      ok: true,
      data: {
        encounterId: encounter.encounterId,
        status: encounter.status,
        squadAId: encounter.squadAId,
        squadAName: squadA?.squadName || "Unknown squad",
        squadACover: squadA?.coverImage || null,
        squadAMembers: mapMembers(squadA?.members),
        squadBId: encounter.squadBId,
        squadBName: squadB?.squadName || "Unknown squad",
        squadBCover: squadB?.coverImage || null,
        squadBMembers: mapMembers(squadB?.members),
        ack: Object.fromEntries(encounter.ackBySquad || []),
        expiresAt: encounter.expiresAt,
      },
    });
  } catch (error) {
    console.error("Error getting encounter handoff status:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to get encounter status" },
    });
  }
};

const ackEncounterJoinHandler = async (req, res) => {
  const { encounterId } = req.params;
  const { squadId } = req.body || {};
  const identity = getRequesterIdentity(req);

  if (!squadId || typeof squadId !== "string") {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "squadId is required" },
    });
  }

  try {
    // Multi-squad membership: verify membership in the SPECIFIC squad being
    // acked, not just "the user's one squad".
    const squad = await Squad.findOne({ squadId });
    if (!squad || !squad.members.some((m) => isSameMember(m, identity))) {
      return res.status(403).json({
        ok: false,
        error: { code: "FORBIDDEN", message: "Cannot acknowledge for another squad" },
      });
    }

    const encounter = await getEncounterById(encounterId);
    const result = await ackEncounterForSquad({ encounter, squadId });

    if (result.error) {
      return res.status(result.error.status).json({
        ok: false,
        error: { code: result.error.code, message: result.error.message },
      });
    }

    return res.status(200).json({
      ok: true,
      data: {
        encounterId,
        squadId,
        acknowledged: result.acknowledged,
        allAcked: result.allAcked,
      },
    });
  } catch (error) {
    console.error("Error acknowledging encounter:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to acknowledge encounter" },
    });
  }
};

const skipEncounterHandler = async (req, res) => {
  const { squadId, encounterId } = req.body || {};
  const identity = getRequesterIdentity(req);

  if (!squadId || !encounterId) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "squadId and encounterId are required" },
    });
  }

  try {
    const context = await getSquadAccessContext({ squadId, identity });
    if (context.error) {
      return res.status(context.error.status).json({
        ok: false,
        error: { code: context.error.code, message: context.error.message },
      });
    }

    if (!context.isLeader) {
      return res.status(403).json({
        ok: false,
        error: { code: "LEADER_ONLY", message: "Only squad leader can skip encounter" },
      });
    }

    const encounter = await getEncounterById(encounterId);
    if (!encounter) {
      return res.status(404).json({
        ok: false,
        error: { code: "ENCOUNTER_NOT_FOUND", message: "Encounter not found" },
      });
    }

    if (![encounter.squadAId, encounter.squadBId].includes(squadId)) {
      return res.status(403).json({
        ok: false,
        error: { code: "FORBIDDEN", message: "Squad is not part of this encounter" },
      });
    }

    await endEncounterAndRequeue({ encounter, triggeringSquadId: squadId });

    return res.status(200).json({
      ok: true,
      data: {
        squadId,
        previousEncounterId: encounterId,
        queueStatus: "searching",
      },
    });
  } catch (error) {
    console.error("Error skipping encounter:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to skip encounter" },
    });
  }
};

module.exports = {
  getMatchmakingStatusHandler,
  getEncounterHandoffHandler,
  ackEncounterJoinHandler,
  skipEncounterHandler,
};
