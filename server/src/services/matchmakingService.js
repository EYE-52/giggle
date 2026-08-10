const { Squad } = require("../models/Squad");
const { Encounter } = require("../models/Encounter");
const User = require("../models/User");
const { generateId } = require("../utils/idGenerator");
const { withMatchmakingLock } = require("../config/redisConfig");
const queueService = require("./queueService");
const socketService = require("./socketService");
const sessionService = require("./sessionService");
const { allUsersHaveAdultAccess } = require("./ageAccessService");
const { MIN_MEMBERS_TO_SEARCH, isStrangerDiscoveryEnabled } = require("../config/appConfig");
const { classifyVibe } = require("../utils/moderation");
const {
  anyBlockedPair,
  anyBlockedPairInState,
  loadBlockState,
} = require("./interactionSafetyService");

// 60s handoff window: matchmaking polling, the match-reveal animation, and
// navigation all eat into this, so 30s was too tight for the 2nd squad to ack
// reliably (caused intermittent ENCOUNTER_EXPIRED / bounce-back to matchmaking).
const ENCOUNTER_ACK_TIMEOUT_MS = 60 * 1000;

const isMatchmakingDebugEnabled = (env = process.env) => {
  return env.MATCHMAKING_DEBUG === "true" || env.NODE_ENV !== "production";
};

const logMatchmakingDebug = (...args) => {
  if (isMatchmakingDebugEnabled()) console.log(...args);
};

const getSquadSize = (squad) => (Array.isArray(squad.members) ? squad.members.length : 0);

const hasMinimumOnlineMembers = (squad, onlineMemberIds, minimum = MIN_MEMBERS_TO_SEARCH) =>
  Array.isArray(squad?.members) && onlineMemberIds.size >= minimum;

const resetInactiveSearchingSquad = async (squad) => {
  squad.status = "idle";
  squad.currentEncounterId = null;
  squad.searchQueuedAt = null;
  await squad.save();
  await queueService.removeFromQueue(squad.squadId);
  socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
};

const rollbackSquadsToIdle = async (squadIds) => {
  await Squad.updateMany(
    { squadId: { $in: squadIds } },
    {
      $set: {
        status: "idle",
        currentEncounterId: null,
        opponentSquadId: null,
        matchedAt: null,
        searchQueuedAt: null,
        "members.$[].inEncounterVideo": false,
      },
    }
  );

  for (const squadId of squadIds) {
    await queueService.removeFromQueue(squadId);
    socketService.emitToSquad(squadId, "SQUAD_UPDATED", {});
  }
};

const scoreCandidate = ({ seeker, candidate, now }) => {
  const seekerSize = seeker.size || getSquadSize(seeker);
  const candidateSize = parseInt(candidate.size) || 0;

  const sizePenalty = Math.abs(seekerSize - candidateSize) * 40;

  const seekerQueuedAt = seeker.queuedAt ? new Date(seeker.queuedAt) : now;
  const candidateQueuedAt = candidate.queuedAt ? new Date(parseInt(candidate.queuedAt)) : now;

  let waitSeconds = Math.max(
    0,
    Math.floor((now.getTime() - Math.min(seekerQueuedAt.getTime(), candidateQueuedAt.getTime())) / 1000)
  );

  const waitBonus = -Math.min(waitSeconds, 60);

  // Tag Bonus: Matching interests reduce the score (better match)
  let tagBonus = 0;
  if (seeker.tags && candidate.tags) {
    const seekerTags = Array.isArray(seeker.tags) ? seeker.tags : (seeker.tags.split?.(',') || []);
    const candidateTags = Array.isArray(candidate.tags) ? candidate.tags : (candidate.tags.split?.(',') || []);
    
    const matches = seekerTags.filter(t => candidateTags.includes(t)).length;
    tagBonus = matches * -30;
  }

  // Reputation Penalty: High disparity in reputation increases the score (worse match)
  const seekerRep = parseInt(seeker.reputationScore) || 100;
  const candidateRep = parseInt(candidate.reputationScore) || 100;
  const repPenalty = Math.abs(seekerRep - candidateRep) * 0.5;

  return sizePenalty + waitBonus + tagBonus + repPenalty;
};

const pickBestCandidate = (seeker, candidates) => {
  const now = new Date();
  let best = null;

  for (const candidate of candidates) {
    if (candidate.squadId === seeker.squadId) continue;

    const score = scoreCandidate({ seeker, candidate, now });
    if (!best || score < best.score) {
      best = { candidate, score };
    }
  }

  return best ? best.candidate : null;
};

const getEncounterRosterContext = async ({ encounter, squadA, squadB } = {}) => {
  if (!encounter) return { allowed: false, squadA: null, squadB: null };
  const [loadedA, loadedB] = await Promise.all([
    squadA || Squad.findOne({ squadId: encounter.squadAId }),
    squadB || Squad.findOne({ squadId: encounter.squadBId }),
  ]);
  if (!loadedA || !loadedB) return { allowed: false, squadA: loadedA, squadB: loadedB };
  const userIds = [...loadedA.members, ...loadedB.members].map((member) => member.userId);
  return {
    allowed: !(await anyBlockedPair(userIds, { User })),
    squadA: loadedA,
    squadB: loadedB,
  };
};

const createEncounterForSquads = async (squadA, squadB) => {
  const encounterId = generateId("enc");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ENCOUNTER_ACK_TIMEOUT_MS);

  const encounter = await Encounter.create({
    encounterId,
    squadAId: squadA.squadId,
    squadBId: squadB.squadId,
    status: "awaiting_ack",
    ackBySquad: {
      [squadA.squadId]: false,
      [squadB.squadId]: false,
    },
    matchedAt: now,
    expiresAt,
  });

  squadA.status = "matched";
  squadA.currentEncounterId = encounterId;
  squadA.opponentSquadId = squadB.squadId;
  squadA.matchedAt = now;
  squadA.searchQueuedAt = null;

  squadB.status = "matched";
  squadB.currentEncounterId = encounterId;
  squadB.opponentSquadId = squadA.squadId;
  squadB.matchedAt = now;
  squadB.searchQueuedAt = null;

  await Promise.all([
    squadA.save(),
    squadB.save(),
    queueService.removeFromQueue(squadA.squadId),
    queueService.removeFromQueue(squadB.squadId),
    // Reset lobby session states in Redis
    ...squadA.members.map(m => sessionService.setSessionField(squadA.squadId, m.memberId, 'ready', false)),
    ...squadA.members.map(m => sessionService.setSessionField(squadA.squadId, m.memberId, 'inLobbyVideo', false)),
    ...squadB.members.map(m => sessionService.setSessionField(squadB.squadId, m.memberId, 'ready', false)),
    ...squadB.members.map(m => sessionService.setSessionField(squadB.squadId, m.memberId, 'inLobbyVideo', false)),
  ]);

  // Notify squads via WebSockets
  const matchData = {
    encounterId,
    matchedAt: now,
    expiresAt,
  };

  socketService.emitToSquad(squadA.squadId, "MATCH_FOUND", {
    ...matchData,
    opponentSquadId: squadB.squadId,
    opponentSquadName: squadB.squadName,
  });

  socketService.emitToSquad(squadB.squadId, "MATCH_FOUND", {
    ...matchData,
    opponentSquadId: squadA.squadId,
    opponentSquadName: squadA.squadName,
  });

  return encounter;
};

const tryMatchmakeForSquad = async (squad) => {
  if (!squad || squad.status !== "searching") {
    return null;
  }
  logMatchmakingDebug(`[Matchmaking] Starting search for squad: ${squad.squadId} (Region: ${squad.searchRegion})`);

  try {
    return await withMatchmakingLock(async (signal) => {
      let freshSquad = await Squad.findOne({ squadId: squad.squadId });
    if (!freshSquad) {
      console.warn(`[Matchmaking] Seeker squad ${squad.squadId} no longer exists. Purging.`);
      await queueService.removeFromQueue(squad.squadId);
      return null;
    }
    if (freshSquad.status !== "searching") {
      await queueService.removeFromQueue(freshSquad.squadId);
      return null;
    }
    if (!isStrangerDiscoveryEnabled()) {
      await resetInactiveSearchingSquad(freshSquad);
      return null;
    }

    const seekerUserIds = freshSquad.members.map((member) => member.userId);
    const [seekerHasAccess, seekerHasBlockedPair] = await Promise.all([
      allUsersHaveAdultAccess(seekerUserIds, { User }),
      anyBlockedPair(seekerUserIds, { User }),
    ]);
    if (seekerHasBlockedPair || !seekerHasAccess || (freshSquad.tags || []).some((tag) => classifyVibe(tag) !== "ok")) {
      console.warn(`[Matchmaking] Seeker ${freshSquad.squadId} is no longer eligible. Purging from queue.`);
      await resetInactiveSearchingSquad(freshSquad);
      return null;
    }

    const region = freshSquad.searchRegion || "global";
    let candidates = await queueService.getQueuedSquadsByRegion(region);

    // Expansion Logic: If no local candidates, try all regions
    const waitSeconds = freshSquad.searchQueuedAt
      ? Math.floor((Date.now() - new Date(freshSquad.searchQueuedAt).getTime()) / 1000)
      : 0;

    if (!candidates.length || candidates.length <= 1) {
       const needsExpansion = waitSeconds > 10 || !candidates.some(c => c.squadId !== squad.squadId);
       if (needsExpansion) {
         candidates = await queueService.getAllQueuedSquads();
       }
    }

    if (!candidates.length) {
      return null;
    }

    // Sort candidates by score (best first)
    const now = new Date();
    const seeker = {
      squadId: freshSquad.squadId,
      size: getSquadSize(freshSquad),
      queuedAt: freshSquad.searchQueuedAt,
      tags: freshSquad.tags,
      reputationScore: freshSquad.reputationScore,
    };

    const scoredCandidates = candidates
      .filter(c => c.squadId !== seeker.squadId)
      .map(candidate => ({
        candidate,
        score: scoreCandidate({ seeker, candidate, now })
      }))
      .sort((a, b) => a.score - b.score);

    // Iterate through candidates until a valid non-ghost match is found
    for (const item of scoredCandidates) {
      const bestCandidate = item.candidate;

      const [refreshedSquad, freshCandidate] = await Promise.all([
        Squad.findOne({ squadId: freshSquad.squadId }),
        Squad.findOne({ squadId: bestCandidate.squadId }),
      ]);

      if (!refreshedSquad) {
        await queueService.removeFromQueue(freshSquad.squadId);
        return null;
      }
      freshSquad = refreshedSquad;

      if (!freshCandidate) {
        console.warn(`[Matchmaking] Purging ghost candidate from Redis: ${bestCandidate.squadId}`);
        await queueService.removeFromQueue(bestCandidate.squadId);
        continue; // Try next candidate
      }

      if (freshSquad.status !== "searching") {
        await queueService.removeFromQueue(freshSquad.squadId);
        return null;
      }
      if (freshCandidate.status !== "searching") {
        logMatchmakingDebug(`[Matchmaking] Candidate ${freshCandidate.squadId} is already in state: ${freshCandidate.status}. Skipping.`);
        continue;
      }

      const [seekerStillHasAccess, candidateHasAccess] = await Promise.all([
        allUsersHaveAdultAccess(freshSquad.members.map((member) => member.userId), { User }),
        allUsersHaveAdultAccess(freshCandidate.members.map((member) => member.userId), { User }),
      ]);
      if (!seekerStillHasAccess || (freshSquad.tags || []).some((tag) => classifyVibe(tag) !== "ok")) {
        console.warn(`[Matchmaking] Seeker ${freshSquad.squadId} is no longer eligible. Purging from queue.`);
        await resetInactiveSearchingSquad(freshSquad);
        return null;
      }
      if (!candidateHasAccess || (freshCandidate.tags || []).some((tag) => classifyVibe(tag) !== "ok")) {
        console.warn(`[Matchmaking] Candidate ${freshCandidate.squadId} is no longer eligible. Purging from queue.`);
        await resetInactiveSearchingSquad(freshCandidate);
        continue;
      }

      const seekerUserIds = freshSquad.members.map((member) => member.userId);
      const candidateUserIds = freshCandidate.members.map((member) => member.userId);
      const combinedUserIds = [...seekerUserIds, ...candidateUserIds];
      let blockState;
      try {
        blockState = await loadBlockState(combinedUserIds, { User });
      } catch {
        await resetInactiveSearchingSquad(freshSquad);
        return null;
      }
      const seekerHasBlockedPair = anyBlockedPairInState(seekerUserIds, blockState);
      const candidateHasBlockedPair = anyBlockedPairInState(candidateUserIds, blockState);
      const combinedHasBlockedPair = anyBlockedPairInState(combinedUserIds, blockState);
      if (seekerHasBlockedPair) {
        console.warn(`[Matchmaking] Seeker ${freshSquad.squadId} contains a blocked pair. Purging from queue.`);
        await resetInactiveSearchingSquad(freshSquad);
        return null;
      }
      if (candidateHasBlockedPair) {
        console.warn(`[Matchmaking] Candidate ${freshCandidate.squadId} contains a blocked pair. Purging from queue.`);
        await resetInactiveSearchingSquad(freshCandidate);
        continue;
      }
      if (combinedHasBlockedPair) continue;

      // Recheck both sides under the matchmaking lock. Ready/video are admission
      // checks; searching is continuing consent, and live membership prevents a
      // disconnected or depleted squad from being matched.
      const [seekerOnlineMembers, candidateOnlineMembers] = await Promise.all([
        socketService.getOnlineUserIds(freshSquad.members.map((m) => m.userId)),
        socketService.getOnlineUserIds(freshCandidate.members.map((m) => m.userId)),
      ]);
      if (!hasMinimumOnlineMembers(freshSquad, seekerOnlineMembers)) {
        console.warn(`[Matchmaking] Seeker ${freshSquad.squadId} is no longer live. Purging from queue.`);
        await resetInactiveSearchingSquad(freshSquad);
        return null;
      }
      if (!hasMinimumOnlineMembers(freshCandidate, candidateOnlineMembers)) {
        console.warn(`[Matchmaking] Candidate ${freshCandidate.squadId} is no longer live. Purging from queue.`);
        await resetInactiveSearchingSquad(freshCandidate);
        continue;
      }

      if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");
      logMatchmakingDebug(`[Matchmaking] Success! Creating encounter for ${freshSquad.squadId} and ${freshCandidate.squadId}`);
      return await createEncounterForSquads(freshSquad, freshCandidate);
    }

    return null; // No valid candidates found in this cycle
    });
  } catch (err) {
    if (err.name !== 'ExecutionError') {
      console.error("[Matchmaking] Error:", err);
    }
    return null;
  }
};

const getMatchmakingStatus = async (squadId) => {
  const squad = await Squad.findOne({ squadId });
  if (!squad) {
    return null;
  }

  let match = null;
  let interactionBlocked = false;
  if (squad.currentEncounterId) {
    const encounter = await Encounter.findOne({ encounterId: squad.currentEncounterId });
    if (encounter) {
      const opponentSquadId = encounter.squadAId === squadId ? encounter.squadBId : encounter.squadAId;
      const opponentSquad = await Squad.findOne({ squadId: opponentSquadId });
      const context = await getEncounterRosterContext({
        encounter,
        squadA: encounter.squadAId === squadId ? squad : opponentSquad,
        squadB: encounter.squadBId === squadId ? squad : opponentSquad,
      });
      interactionBlocked = !context.allowed;
      if (context.allowed) {
        match = {
          encounterId: encounter.encounterId,
          opponentSquadId,
          ownSquadName: squad.squadName,
          opponentSquadName: opponentSquad?.squadName || "Unknown squad",
          matchedAt: encounter.matchedAt,
          status: encounter.status,
        };
      }
    }
  }

  return {
    squad,
    queue:
      squad.status === "searching"
        ? {
            region: squad.searchRegion || "global",
            size: getSquadSize(squad),
            queuedAt: squad.searchQueuedAt,
            waitSeconds: squad.searchQueuedAt
              ? Math.max(0, Math.floor((Date.now() - new Date(squad.searchQueuedAt).getTime()) / 1000))
              : 0,
          }
        : null,
    match,
    interactionBlocked,
  };
};

const getEncounterById = async (encounterId) => {
  return Encounter.findOne({ encounterId });
};

const ackEncounterForSquad = async ({ encounter, squadId, emitRealtime = true }) => {
  if (!encounter) {
    return { error: { status: 404, code: "ENCOUNTER_NOT_FOUND", message: "Encounter not found" } };
  }

  if (encounter.status === "ended") {
    return { error: { status: 409, code: "ENCOUNTER_ENDED", message: "Encounter is no longer active" } };
  }

  if (![encounter.squadAId, encounter.squadBId].includes(squadId)) {
    return { error: { status: 403, code: "FORBIDDEN", message: "Squad is not part of this encounter" } };
  }

  // The deadline gates the handoff only. Once both squads acknowledged, a
  // later member opening the same active encounter must be idempotent rather
  // than ending the live call because the old handoff timestamp has passed.
  if (encounter.status === "active") {
    return { acknowledged: true, allAcked: true, encounter };
  }

  if (!isStrangerDiscoveryEnabled()) {
    await endEncounterToIdle({ encounter, emitRealtime });
    return {
      error: { status: 503, code: "DISCOVERY_DISABLED", message: "Stranger discovery is temporarily unavailable" },
      realtime: { close: true },
    };
  }

  if (new Date(encounter.expiresAt).getTime() < Date.now()) {
    encounter.status = "ended";
    encounter.endedAt = new Date();
    await encounter.save();
    if (emitRealtime) socketService.closeEncounterRoom(encounter.encounterId);
    return {
      error: { status: 409, code: "ENCOUNTER_EXPIRED", message: "Encounter handoff expired" },
      realtime: { close: true },
    };
  }

  encounter.ackBySquad.set(squadId, true);

  const allAcked = Boolean(encounter.ackBySquad.get(encounter.squadAId)) && Boolean(encounter.ackBySquad.get(encounter.squadBId));

  if (allAcked) {
    encounter.status = "active";

    await Squad.updateMany(
      { squadId: { $in: [encounter.squadAId, encounter.squadBId] } },
      {
        $set: {
          status: "in_encounter",
        },
      }
    );

    if (emitRealtime) {
      socketService.emitToSquad(encounter.squadAId, "ENCOUNTER_ACTIVE", { encounterId: encounter.encounterId });
      socketService.emitToSquad(encounter.squadBId, "ENCOUNTER_ACTIVE", { encounterId: encounter.encounterId });
    }
  }

  await encounter.save();

  return {
    acknowledged: true,
    allAcked,
    encounter,
    realtime: allAcked ? { activate: true } : null,
  };
};

const endEncounterAndRequeue = async ({ encounter, triggeringSquadId }) => {
  if (!isStrangerDiscoveryEnabled()) {
    await endEncounterToIdle({ encounter });
    return null;
  }

  const squadIds = [encounter.squadAId, encounter.squadBId];
  encounter.status = "ended";
  encounter.endedAt = new Date();
  await encounter.save();

  // Notify squads that encounter ended
  socketService.emitToSquad(encounter.squadAId, "ENCOUNTER_ENDED", { encounterId: encounter.encounterId });
  socketService.emitToSquad(encounter.squadBId, "ENCOUNTER_ENDED", { encounterId: encounter.encounterId });
  socketService.closeEncounterRoom(encounter.encounterId);

  // Clear encounter state and set both squads to searching with no encounter
  const now = new Date();
  await Squad.updateMany(
    { squadId: { $in: squadIds } },
    {
      $set: {
        status: "searching",
        currentEncounterId: null,
        opponentSquadId: null,
        matchedAt: null,
        searchQueuedAt: now,
        "members.$[].inEncounterVideo": false,
      },
    }
  );

  // Add back to Redis queue
  const squads = await Squad.find({ squadId: { $in: squadIds } });
  const requeuedSquadIds = [];
  try {
    for (const s of squads) {
      const canRequeue =
        !(s.tags || []).some((tag) => classifyVibe(tag) !== "ok") &&
        await allUsersHaveAdultAccess(s.members.map((member) => member.userId), { User }) &&
        !(await anyBlockedPair(s.members.map((member) => member.userId), { User }));
      if (!canRequeue) {
        await rollbackSquadsToIdle([s.squadId]);
        continue;
      }
      await queueService.addToQueue(s.squadId, getSquadSize(s), s.searchRegion, s.tags, s.reputationScore);
      requeuedSquadIds.push(s.squadId);
      // Reset encounter video state in Redis
      for (const m of s.members) {
        await sessionService.setSessionField(s.squadId, m.memberId, 'inEncounterVideo', false);
      }
    }
  } catch (error) {
    await rollbackSquadsToIdle(squadIds);
    throw error;
  }

  const triggeringSquad = squads.find(
    (s) => s.squadId === triggeringSquadId && requeuedSquadIds.includes(s.squadId)
  ) || squads.find((s) => requeuedSquadIds.includes(s.squadId));
  if (!triggeringSquad) {
    return null;
  }

  await tryMatchmakeForSquad(triggeringSquad);

  return triggeringSquad;
};

const endEncounterToIdle = async ({ encounter, emitRealtime = true }) => {
  const squadIds = [encounter.squadAId, encounter.squadBId];

  encounter.status = "ended";
  encounter.endedAt = new Date();
  await encounter.save();

  if (emitRealtime) {
    socketService.emitToSquad(encounter.squadAId, "ENCOUNTER_ENDED", { encounterId: encounter.encounterId });
    socketService.emitToSquad(encounter.squadBId, "ENCOUNTER_ENDED", { encounterId: encounter.encounterId });
    socketService.closeEncounterRoom(encounter.encounterId);
  }

  // Clear encounter state and inEncounterVideo flags for all members
  await Squad.updateMany(
    { squadId: { $in: squadIds } },
    {
      $set: {
        status: "idle",
        currentEncounterId: null,
        opponentSquadId: null,
        matchedAt: null,
        searchQueuedAt: null,
        "members.$[].inEncounterVideo": false,
      },
    }
  );

  // Sync Redis
  for (const squadId of squadIds) {
    const squad = await Squad.findOne({ squadId });
    if (squad) {
      for (const m of squad.members) {
        await sessionService.setSessionField(squadId, m.memberId, 'inEncounterVideo', false);
      }
    }
  }
};

const endEncounterAsymmetric = async ({ encounter, disconnectingSquadId }) => {
  const otherSquadId = encounter.squadAId === disconnectingSquadId ? encounter.squadBId : encounter.squadAId;
  const encounterWasEnded = encounter.status === "ended";

  const idleState = {
    status: "idle",
    currentEncounterId: null,
    opponentSquadId: null,
    matchedAt: null,
    searchQueuedAt: null,
    "members.$[].inEncounterVideo": false,
  };

  // Both resets are guarded by the old encounter id. A failed write leaves the
  // encounter retryable; a later retry cannot clobber a squad that has already
  // joined a newer encounter.
  await Squad.updateOne(
    { squadId: disconnectingSquadId, currentEncounterId: encounter.encounterId },
    { $set: idleState }
  );
  const otherReset = await Squad.updateOne(
    { squadId: otherSquadId, currentEncounterId: encounter.encounterId },
    { $set: idleState }
  );

  if (!encounterWasEnded) {
    encounter.status = "ended";
    encounter.endedAt = new Date();
    await encounter.save();
  }

  // Notify only after both durable squad transitions and the encounter write.
  const endedPayload = {
    encounterId: encounter.encounterId,
    reason: "squad_disconnected",
    endedBySquadId: disconnectingSquadId,
  };
  socketService.emitToSquad(encounter.squadAId, "ENCOUNTER_ENDED", endedPayload);
  socketService.emitToSquad(encounter.squadBId, "ENCOUNTER_ENDED", endedPayload);
  socketService.closeEncounterRoom(encounter.encounterId);

  const otherSquad = await Squad.findOne({ squadId: otherSquadId });
  const otherWasResetNow = (otherReset?.matchedCount ?? otherReset?.n ?? 0) > 0;
  if (!isStrangerDiscoveryEnabled()) {
    await queueService.removeFromQueue(otherSquadId);
  } else if (otherWasResetNow && otherSquad?.status === "idle" && !otherSquad.currentEncounterId) {
    try {
      const canRequeue =
        !(otherSquad.tags || []).some((tag) => classifyVibe(tag) !== "ok") &&
        await allUsersHaveAdultAccess(otherSquad.members.map((member) => member.userId), { User }) &&
        !(await anyBlockedPair(otherSquad.members.map((member) => member.userId), { User }));
      if (!canRequeue) {
        await queueService.removeFromQueue(otherSquadId);
      } else {
        const now = new Date();
        const promoted = await Squad.updateOne(
          { squadId: otherSquadId, status: "idle", currentEncounterId: null },
          { $set: { ...idleState, status: "searching", searchQueuedAt: now } }
        );
        if ((promoted?.matchedCount ?? promoted?.n ?? 1) > 0) {
          otherSquad.status = "searching";
          otherSquad.searchQueuedAt = now;
          otherSquad.currentEncounterId = null;
          otherSquad.opponentSquadId = null;
          otherSquad.matchedAt = null;
          await queueService.addToQueue(
            otherSquad.squadId,
            getSquadSize(otherSquad),
            otherSquad.searchRegion,
            otherSquad.tags,
            otherSquad.reputationScore
          );
          // Sync Redis for other squad
          for (const m of otherSquad.members) {
            await sessionService.setSessionField(otherSquadId, m.memberId, 'inEncounterVideo', false);
          }
          // Start matching for them immediately
          await tryMatchmakeForSquad(otherSquad);
        }
      }
    } catch (error) {
      await rollbackSquadsToIdle([otherSquadId]);
      throw error;
    }
  }

  const disconnectingSquad = await Squad.findOne({ squadId: disconnectingSquadId });
  if (disconnectingSquad) {
    const cleanupResults = await Promise.allSettled(disconnectingSquad.members.map((member) =>
      sessionService.clearMemberSession(disconnectingSquadId, member.memberId)
    ));
    for (const result of cleanupResults) {
      if (result.status === "rejected") {
        console.error("[Matchmaking] Post-encounter session cleanup failed:", result.reason);
      }
    }
  }
};

// ── Stuck-encounter sweeper ──────────────────────────────────────────────────
// Encounters created in "awaiting_ack" expire if both squads never ack. When
// that happens the squads can stay stuck in "matched" with a currentEncounterId
// pointing at the dead encounter. This sweeper periodically ends expired
// awaiting_ack encounters and frees those squads back to "idle".
const sweepStuckEncounters = async () => {
  try {
    const now = new Date();
    const stuck = await Encounter.find({ status: "awaiting_ack", expiresAt: { $lt: now } });
    if (!stuck.length) return 0;

    let freedSquads = 0;
    for (const encounter of stuck) {
      encounter.status = "ended";
      encounter.endedAt = now;
      await encounter.save();

      // Notify any connected clients so they bounce out of the handoff UI.
      socketService.emitToSquad(encounter.squadAId, "ENCOUNTER_ENDED", { encounterId: encounter.encounterId });
      socketService.emitToSquad(encounter.squadBId, "ENCOUNTER_ENDED", { encounterId: encounter.encounterId });
      socketService.closeEncounterRoom(encounter.encounterId);

      for (const squadId of [encounter.squadAId, encounter.squadBId]) {
        const squad = await Squad.findOne({ squadId });
        // Only reset squads still stuck on THIS dead encounter.
        if (!squad || squad.status !== "matched" || squad.currentEncounterId !== encounter.encounterId) {
          continue;
        }
        squad.status = "idle";
        squad.currentEncounterId = null;
        squad.opponentSquadId = null;
        squad.matchedAt = null;
        squad.searchQueuedAt = null;
        await squad.save();
        await queueService.removeFromQueue(squadId);
        socketService.emitToSquad(squadId, "SQUAD_UPDATED", {});
        freedSquads += 1;
      }
    }

    logMatchmakingDebug(`[Sweeper] Ended ${stuck.length} stuck awaiting_ack encounter(s); freed ${freedSquads} squad(s) to idle`);
    return stuck.length;
  } catch (err) {
    console.error("[Sweeper] Error sweeping stuck encounters:", err);
    return 0;
  }
};

const STUCK_ENCOUNTER_SWEEP_INTERVAL_MS = 30 * 1000;
let sweepTimer = null;

const startEncounterSweeper = () => {
  if (sweepTimer) return sweepTimer;
  sweepTimer = setInterval(sweepStuckEncounters, STUCK_ENCOUNTER_SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
  logMatchmakingDebug(`[Sweeper] Stuck-encounter sweeper started (every ${STUCK_ENCOUNTER_SWEEP_INTERVAL_MS / 1000}s)`);
  return sweepTimer;
};

module.exports = {
  hasMinimumOnlineMembers,
  scoreCandidate,
  tryMatchmakeForSquad,
  sweepStuckEncounters,
  startEncounterSweeper,
  getMatchmakingStatus,
  getEncounterById,
  getEncounterRosterContext,
  ackEncounterForSquad,
  endEncounterAndRequeue,
  endEncounterToIdle,
  endEncounterAsymmetric,
  isMatchmakingDebugEnabled,
};
