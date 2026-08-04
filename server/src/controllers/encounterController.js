const { getRequesterIdentity, getSquadAccessContext } = require("../app/squadAccess");
const { createEncounterRtcToken } = require("../services/agoraTokenService");
const {
  getEncounterById,
  getEncounterRosterContext,
  endEncounterToIdle,
  endEncounterAndRequeue,
  endEncounterAsymmetric,
} = require("../services/matchmakingService");

const normalizeEncounterId = (payload = {}) => {
  return payload.encounterId || payload.meetingId || null;
};

const issueEncounterTokenHandler = async (req, res) => {
  const { squadId } = req.body || {};
  const encounterId = normalizeEncounterId(req.body);
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

    const { squad, member } = context;
    if (squad.currentEncounterId !== encounterId) {
      return res.status(403).json({
        ok: false,
        error: { code: "MEMBER_NOT_IN_ENCOUNTER", message: "Member is not in requested encounter" },
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
        error: { code: "MEMBER_NOT_IN_ENCOUNTER", message: "Member is not part of this encounter" },
      });
    }
    if (!(await getEncounterRosterContext({ encounter })).allowed) {
      return res.status(403).json({
        ok: false,
        error: { code: "INTERACTION_BLOCKED", message: "This encounter is unavailable" },
      });
    }

    const tokenPayload = createEncounterRtcToken({
      encounterId,
      userId: member.userId,
    });

    return res.status(200).json({
      ok: true,
      data: {
        encounterId,
        squadId,
        memberId: member.memberId,
        ...tokenPayload,
      },
    });
  } catch (error) {
    if (error.message === "AGORA_NOT_CONFIGURED") {
      return res.status(500).json({
        ok: false,
        error: {
          code: "AGORA_NOT_CONFIGURED",
          message: "Agora server credentials are missing",
        },
      });
    }

    console.error("Error issuing encounter token:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to issue encounter token" },
    });
  }
};

const disconnectEncounterHandler = async (req, res) => {
  const { squadId } = req.body || {};
  const encounterId = normalizeEncounterId(req.body);
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

    const { member, squad } = context;
    if (squad.currentEncounterId !== encounterId) {
      return res.status(409).json({
        ok: false,
        error: { code: "NOT_IN_ENCOUNTER", message: "Squad is not in the provided encounter" },
      });
    }

    const encounter = await getEncounterById(encounterId);
    if (!encounter) {
      return res.status(404).json({
        ok: false,
        error: { code: "ENCOUNTER_NOT_FOUND", message: "Encounter not found" },
      });
    }

    // End the current encounter: 
    // - The disconnecting squad goes to IDLE
    // - The other squad goes to SEARCHING
    await endEncounterAsymmetric({ encounter, disconnectingSquadId: squadId });

    return res.status(200).json({
      ok: true,
      data: {
        encounterId,
        memberId: member.memberId,
        disconnected: true,
        squadStatus: "idle",
      },
    });
  } catch (error) {
    console.error("Error disconnecting encounter:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to disconnect encounter" },
    });
  }
};

module.exports = {
  issueEncounterTokenHandler,
  disconnectEncounterHandler,
};
