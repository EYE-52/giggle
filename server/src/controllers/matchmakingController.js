const { getRequesterIdentity, getSquadAccessContext, isSameMember } = require("../app/squadAccess");
const { Squad } = require("../models/Squad");
const User = require("../models/User");
const {
  getMatchmakingStatus,
  getEncounterById,
  getEncounterRosterContext,
  ackEncounterForSquad,
  endEncounterAndRequeue,
  tryMatchmakeForSquad,
} = require("../services/matchmakingService");
const { hashStringToUid } = require("../services/agoraTokenService");
const socketService = require("../services/socketService");
const { withMatchmakingLock } = require("../config/redisConfig");
const { loadAvatarsByUserId } = require("../utils/avatars");
const { canonicalUserId } = require("../services/interactionSafetyService");

const getMatchmakingStatusHandler = async (req, res) => {
  const { squadId } = req.params;

  try {
    const status = await getMatchmakingStatus(squadId, { squad: req.squadAccess?.squad });
    if (!status) {
      return res.status(404).json({
        ok: false,
        error: { code: "SQUAD_NOT_FOUND", message: "Squad not found" },
      });
    }

    const { squad, queue, match } = status;
    if (status.interactionBlocked) {
      return res.status(403).json({
        ok: false,
        error: { code: "INTERACTION_BLOCKED", message: "This encounter is unavailable" },
      });
    }

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

    const [squadA, squadB] = await Promise.all([
      Squad.findOne({ squadId: encounter.squadAId }),
      Squad.findOne({ squadId: encounter.squadBId }),
    ]);

    // Membership comes before block state so an outsider with an encounter id
    // cannot distinguish a blocked encounter from any other forbidden one.
    const isInEncounter =
      (squadA && squadA.members.some((m) => isSameMember(m, identity))) ||
      (squadB && squadB.members.some((m) => isSameMember(m, identity)));

    if (!isInEncounter) {
      return res.status(403).json({
        ok: false,
        error: { code: "FORBIDDEN", message: "Not authorized for this encounter" },
      });
    }
    const { allowed } = await getEncounterRosterContext({ encounter, squadA, squadB });
    if (!allowed) {
      return res.status(403).json({
        ok: false,
        error: { code: "INTERACTION_BLOCKED", message: "This encounter is unavailable" },
      });
    }

    // One batched avatar lookup for both rosters; avatar is null on failure.
    const avatars = await loadAvatarsByUserId(
      [...(squadA?.members || []), ...(squadB?.members || [])].map((m) => m.userId),
      { User }
    );

    // uid MUST match the RTC token uid so the client can map uid -> member.
    // Computed with the same hash + input (`encounterId:userId`) the token service uses.
    const mapMembers = (members) => (members || []).map(m => ({
      memberId: m.memberId,
      userId: m.userId,
      displayName: m.displayName || m.userId,
      role: m.role,
      uid: hashStringToUid(`${encounter.encounterId}:${m.userId}`),
      avatar: avatars.get(canonicalUserId(m.userId)) ?? null,
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
    let encounter = await getEncounterById(encounterId);
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

    // Verify membership in this encounter squad before any block-specific
    // response. The user's most-recent squad may be unrelated.
    const squad = await Squad.findOne({ squadId });
    if (!squad || !squad.members.some((m) => isSameMember(m, identity))) {
      return res.status(403).json({
        ok: false,
        error: { code: "FORBIDDEN", message: "Cannot acknowledge for another squad" },
      });
    }

    const outcome = await withMatchmakingLock(async (signal) => {
      encounter = await getEncounterById(encounterId);
      if (!encounter) {
        return { error: { status: 404, code: "ENCOUNTER_NOT_FOUND", message: "Encounter not found" } };
      }
      if (![encounter.squadAId, encounter.squadBId].includes(squadId)) {
        return { error: { status: 403, code: "FORBIDDEN", message: "Squad is not part of this encounter" } };
      }
      const [squadA, squadB] = await Promise.all([
        Squad.findOne({ squadId: encounter.squadAId }),
        Squad.findOne({ squadId: encounter.squadBId }),
      ]);
      const lockedSquad = squadId === encounter.squadAId ? squadA : squadB;
      if (!lockedSquad || !lockedSquad.members.some((m) => isSameMember(m, identity))) {
        return { error: { status: 403, code: "FORBIDDEN", message: "Cannot acknowledge for another squad" } };
      }
      const context = await getEncounterRosterContext({ encounter, squadA, squadB });
      if (!context.allowed) {
        return { error: { status: 403, code: "INTERACTION_BLOCKED", message: "This encounter is unavailable" } };
      }
      if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");
      const result = await ackEncounterForSquad({ encounter, squadId, emitRealtime: false });
      if (result.error) return { error: result.error, realtime: result.realtime };
      return {
        realtime: result.realtime,
        data: {
          encounterId,
          squadId,
          acknowledged: result.acknowledged,
          allAcked: result.allAcked,
        },
      };
    });

    if (outcome.realtime?.close) {
      socketService.closeEncounterRoom(encounterId);
    }
    if (outcome.realtime?.activate) {
      socketService.emitToSquad(encounter.squadAId, "ENCOUNTER_ACTIVE", { encounterId });
      socketService.emitToSquad(encounter.squadBId, "ENCOUNTER_ACTIVE", { encounterId });
    }
    if (outcome.error) {
      return res.status(outcome.error.status).json({
        ok: false,
        error: { code: outcome.error.code, message: outcome.error.message },
      });
    }
    return res.status(200).json({ ok: true, data: outcome.data });
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
    const outcome = await withMatchmakingLock(async (signal) => {
      const context = await getSquadAccessContext({ squadId, identity });
      if (context.error) return { error: context.error };
      if (!context.isLeader) return { error: { status: 403, code: "LEADER_ONLY", message: "Only squad leader can skip encounter" } };
      const encounter = await getEncounterById(encounterId);
      if (!encounter) return { error: { status: 404, code: "ENCOUNTER_NOT_FOUND", message: "Encounter not found" } };
      if (![encounter.squadAId, encounter.squadBId].includes(squadId)) return { error: { status: 403, code: "FORBIDDEN", message: "Squad is not part of this encounter" } };
      // A retry must never reset a squad which has already entered another call.
      if (encounter.status === "ended") return { queueStatus: context.squad?.status === "idle" ? "idle" : "searching" };
      if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");
      const requeuedSquad = await endEncounterAndRequeue({ encounter, triggeringSquadId: squadId, matchImmediately: false });
      return { requeuedSquad, queueStatus: requeuedSquad?.squadId === squadId ? "searching" : "idle" };
    });
    if (outcome.error) return res.status(outcome.error.status).json({ ok: false, error: { code: outcome.error.code, message: outcome.error.message } });
    const response = res.status(200).json({ ok: true, data: { squadId, previousEncounterId: encounterId, queueStatus: outcome.queueStatus } });
    // The matcher owns the same lock. Run it only after the transition releases it.
    if (outcome.requeuedSquad) await tryMatchmakeForSquad(outcome.requeuedSquad);
    return response;
  } catch (error) {
    console.error("Error skipping encounter:", error);
    if (res.headersSent) return;
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
