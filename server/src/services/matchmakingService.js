const { Squad } = require("../models/Squad");
const mongoose = require("mongoose");
const { Encounter } = require("../models/Encounter");
const User = require("../models/User");
const { generateId } = require("../utils/idGenerator");
const { withMatchmakingLock, runAsSingleReplica, assertMatchmakingLease } = require("../config/redisConfig");
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

const settleMatchmakingEffects = async operations => {
  const results = await Promise.allSettled(operations);
  const failed = results.find(result => result.status === "rejected");
  if (failed) throw failed.reason;
};

const getSquadSize = (squad) => (Array.isArray(squad.members) ? squad.members.length : 0);

const hasMinimumOnlineMembers = (squad, onlineMemberIds, minimum = MIN_MEMBERS_TO_SEARCH) =>
  Array.isArray(squad?.members) && onlineMemberIds.size >= minimum;

const resetInactiveSearchingSquad = async (squad, { signal, admission } = {}) => {
  assertMatchmakingLease(signal);
  const result = await Squad.updateOne({
    squadId: squad.squadId, status: "searching", currentEncounterId: null,
    searchQueuedAt: squad.searchQueuedAt,
    __v: squad.__v == null ? { $exists: false } : squad.__v,
  }, { $set: { status: "idle", currentEncounterId: null, searchQueuedAt: null }, $inc: { __v: 1 } });
  if ((result.matchedCount ?? result.n ?? 0) !== 1) return false;
  squad.status = "idle";
  squad.currentEncounterId = null;
  squad.searchQueuedAt = null;
  assertMatchmakingLease(signal);
  if (admission) await queueService.removeIfAdmission(squad.squadId, admission);
  socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
  return true;
};

const rollbackSquadsToIdle = async (squads, { signal, admissions = new Map() } = {}) => {
  // A lost lease may already have a new owner. Leave its repair to a fresh
  // scoped attempt rather than resetting state from this stale routine.
  if (signal?.aborted) return;
  for (const squad of squads) {
    assertMatchmakingLease(signal);
    const reset = await Squad.updateOne({
      squadId: squad.squadId, status: "searching", currentEncounterId: null,
      searchQueuedAt: squad.searchQueuedAt,
      __v: squad.__v == null ? { $exists: false } : squad.__v,
      ...(squad.lastEncounterId ? { lastEncounterId: squad.lastEncounterId } : {}),
    }, { $set: {
      status: "idle", currentEncounterId: null, opponentSquadId: null,
      matchedAt: null, searchQueuedAt: null, "members.$[].inEncounterVideo": false,
    }, $inc: { __v: 1 } });
    if ((reset.matchedCount ?? reset.n ?? 0) !== 1 || signal?.aborted) continue;
    const admissionId = admissions.get(squad.squadId);
    if (admissionId) await queueService.removeFromQueue(squad.squadId, { admissionId });
    if (!signal?.aborted) socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
  }
};

const IDLE_ENCOUNTER_STATE = {
  status: "idle",
  currentEncounterId: null,
  opponentSquadId: null,
  matchedAt: null,
  searchQueuedAt: null,
  "members.$[].inEncounterVideo": false,
};

// Only one ender may move an encounter to "ended" (skip, End, sweeper, a late
// ack). Returns false when another path already ended it, or when `fromStatus`
// is given and the encounter has since left that status.
const markEncounterEnded = async (encounter, { fromStatus } = {}) => {
  const endedAt = new Date();
  const ended = await Encounter.findOneAndUpdate(
    { encounterId: encounter.encounterId, status: fromStatus || { $ne: "ended" } },
    { $set: { status: "ended", endedAt } },
    { new: true }
  );
  if (!ended) return false;
  encounter.status = "ended";
  encounter.endedAt = endedAt;
  return true;
};

// Frees squads still pointing at an encounter that is over. Guarded by the
// encounter id so a squad that already moved on is never clobbered.
const releaseSquadsFromEncounter = async (
  encounter,
  { squadIds = [encounter.squadAId, encounter.squadBId], emitRealtime = true } = {}
) => {
  // Callers hold the matchmaking lock through this Mongo/Redis transition.
  for (const squadId of squadIds) {
    const filter = { squadId, currentEncounterId: encounter.encounterId };
    const squad = await Squad.findOne(filter);
    if (!squad) continue;
    // Redis first: a failure leaves the old encounter pointer retryable.
    // Never clear a former opponent's flags after it has moved to a new call.
    for (const m of squad.members) {
      await sessionService.setSessionField(squadId, m.memberId, 'inEncounterVideo', false);
    }
    await Squad.updateOne(filter, { $set: IDLE_ENCOUNTER_STATE });
    if (emitRealtime) socketService.emitToSquad(squadId, "SQUAD_UPDATED", {});
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

const createEncounterForSquads = async (squadA, squadB, signal, admissions = new Map()) => {
  const encounterId = generateId("enc");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ENCOUNTER_ACK_TIMEOUT_MS);

  const encounterData = {
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
  };

  // Compare member/user/role identities without embedded-document field-order
  // equality or live media flags. The version fences admission documents too.
  const snapshot = squad => ({
    squadId: squad.squadId,
    status: "searching",
    currentEncounterId: null,
    members: { $size: squad.members.length, $all: squad.members.map(member => ({
      $elemMatch: { memberId: member.memberId, userId: member.userId, role: member.role },
    })) },
    ...(squad.__v == null ? {} : { __v: squad.__v }),
  });
  const snapshots = [snapshot(squadA), snapshot(squadB)];
  assertMatchmakingLease(signal);
  const encounter = await mongoose.connection.transaction(async session => {
    assertMatchmakingLease(signal);
    for (const [index, squad] of [squadA, squadB].entries()) {
      const opponent = index === 0 ? squadB : squadA;
      const result = await Squad.updateOne(snapshots[index], { $set: {
        status: "matched", currentEncounterId: encounterId,
        opponentSquadId: opponent.squadId, matchedAt: now, searchQueuedAt: null,
      }, $inc: { __v: 1 } }, { session });
      assertMatchmakingLease(signal);
      if ((result.matchedCount ?? result.n ?? 0) !== 1) {
        throw Object.assign(new Error("Matchmaking squad snapshot changed"), { code: "MATCH_SNAPSHOT_CHANGED" });
      }
    }
    const [created] = await Encounter.create([encounterData], { session });
    assertMatchmakingLease(signal);
    return created;
  });
  assertMatchmakingLease(signal);

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

  await settleMatchmakingEffects([
    queueService.removeIfAdmission(squadA.squadId, admissions.get(squadA.squadId)),
    queueService.removeIfAdmission(squadB.squadId, admissions.get(squadB.squadId)),
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
    if (!isStrangerDiscoveryEnabled()) {
      return await withMatchmakingLock(async signal => {
        const admission = await queueService.getQueueAdmission(squad.squadId);
        const current = await Squad.findOne({ squadId: squad.squadId });
        assertMatchmakingLease(signal);
        if (current?.status === "searching") await resetInactiveSearchingSquad(current, { signal, admission });
        else await queueService.removeIfAdmission(squad.squadId, admission);
        return null;
      }, { squadIds: [squad.squadId] });
    }
    let freshSquad = await Squad.findOne({ squadId: squad.squadId });
    if (!freshSquad || freshSquad.status !== "searching") return null;
    const region = freshSquad.searchRegion || "global";
    const candidateOptions = { seekerId: freshSquad.squadId };
    let candidates = await queueService.getQueuedSquadsByRegion(region, candidateOptions);

    // Expand into one rotating region after a wait or an empty local window.
    const waitSeconds = freshSquad.searchQueuedAt
      ? Math.floor((Date.now() - new Date(freshSquad.searchQueuedAt).getTime()) / 1000)
      : 0;

    if (waitSeconds > 10 || !candidates.some(c => c.squadId !== squad.squadId)) {
      const expanded = await queueService.getAllQueuedSquads(candidateOptions);
      candidates = [...new Map([...candidates, ...expanded].map(candidate => [candidate.squadId, candidate])).values()];
    }

    if (!candidates.length) {
      return await withMatchmakingLock(async signal => {
        const admission = await queueService.getQueueAdmission(squad.squadId);
        const current = await Squad.findOne({ squadId: squad.squadId });
        if (!current || current.status !== "searching") return null;
        const ids = current.members.map(member => member.userId);
        const [allowed, blocked] = await Promise.all([
          allUsersHaveAdultAccess(ids, { User }), anyBlockedPair(ids, { User }),
        ]);
        assertMatchmakingLease(signal);
        if (!allowed || blocked || (current.tags || []).some(tag => classifyVibe(tag) !== "ok")) {
          await resetInactiveSearchingSquad(current, { signal, admission });
        }
        return null;
      }, { squadIds: [squad.squadId], retryCount: 0 });
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

      try {
        const outcome = await withMatchmakingLock(async (signal) => {
      assertMatchmakingLease(signal);
      const [seekerAdmission, candidateAdmission] = await Promise.all([
        queueService.getQueueAdmission(squad.squadId), queueService.getQueueAdmission(bestCandidate.squadId),
      ]);
      const admissions = new Map([[squad.squadId, seekerAdmission], [bestCandidate.squadId, candidateAdmission]]);
      const [refreshedSquad, freshCandidate] = await Promise.all([
        Squad.findOne({ squadId: freshSquad.squadId }),
        Squad.findOne({ squadId: bestCandidate.squadId }),
      ]);

      if (!refreshedSquad) {
        await queueService.removeIfAdmission(freshSquad.squadId, seekerAdmission);
        return { stop: true };
      }
      freshSquad = refreshedSquad;

      if (!freshCandidate) {
        console.warn(`[Matchmaking] Purging ghost candidate from Redis: ${bestCandidate.squadId}`);
        await queueService.removeIfAdmission(bestCandidate.squadId, candidateAdmission);
        return null; // Try next candidate
      }

      if (freshSquad.status !== "searching") {
        await queueService.removeIfAdmission(freshSquad.squadId, seekerAdmission);
        return { stop: true };
      }
      if (!isStrangerDiscoveryEnabled()) {
        await resetInactiveSearchingSquad(freshSquad, { signal, admission: seekerAdmission });
        return { stop: true };
      }
      if (freshSquad.lastEncounterId && freshSquad.lastEncounterId === freshCandidate.lastEncounterId &&
          Date.now() - new Date(freshSquad.lastEncounterEndedAt).getTime() < 120_000) return null;
      if (freshCandidate.status !== "searching") {
        logMatchmakingDebug(`[Matchmaking] Candidate ${freshCandidate.squadId} is already in state: ${freshCandidate.status}. Skipping.`);
        await queueService.removeIfAdmission(freshCandidate.squadId, candidateAdmission);
        return null;
      }

      const [seekerStillHasAccess, candidateHasAccess] = await Promise.all([
        allUsersHaveAdultAccess(freshSquad.members.map((member) => member.userId), { User }),
        allUsersHaveAdultAccess(freshCandidate.members.map((member) => member.userId), { User }),
      ]);
      if (!seekerStillHasAccess || (freshSquad.tags || []).some((tag) => classifyVibe(tag) !== "ok")) {
        console.warn(`[Matchmaking] Seeker ${freshSquad.squadId} is no longer eligible. Purging from queue.`);
        await resetInactiveSearchingSquad(freshSquad, { signal, admission: seekerAdmission });
        return { stop: true };
      }
      if (!candidateHasAccess || (freshCandidate.tags || []).some((tag) => classifyVibe(tag) !== "ok")) {
        console.warn(`[Matchmaking] Candidate ${freshCandidate.squadId} is no longer eligible. Purging from queue.`);
        await resetInactiveSearchingSquad(freshCandidate, { signal, admission: candidateAdmission });
        return null;
      }

      const seekerUserIds = freshSquad.members.map((member) => member.userId);
      const candidateUserIds = freshCandidate.members.map((member) => member.userId);
      const combinedUserIds = [...seekerUserIds, ...candidateUserIds];
      let blockState;
      try {
        blockState = await loadBlockState(combinedUserIds, { User });
      } catch {
        await resetInactiveSearchingSquad(freshSquad, { signal, admission: seekerAdmission });
        return { stop: true };
      }
      const seekerHasBlockedPair = anyBlockedPairInState(seekerUserIds, blockState);
      const candidateHasBlockedPair = anyBlockedPairInState(candidateUserIds, blockState);
      const combinedHasBlockedPair = anyBlockedPairInState(combinedUserIds, blockState);
      if (seekerHasBlockedPair) {
        console.warn(`[Matchmaking] Seeker ${freshSquad.squadId} contains a blocked pair. Purging from queue.`);
        await resetInactiveSearchingSquad(freshSquad, { signal, admission: seekerAdmission });
        return { stop: true };
      }
      if (candidateHasBlockedPair) {
        console.warn(`[Matchmaking] Candidate ${freshCandidate.squadId} contains a blocked pair. Purging from queue.`);
        await resetInactiveSearchingSquad(freshCandidate, { signal, admission: candidateAdmission });
        return null;
      }
      if (combinedHasBlockedPair) return null;

      // Recheck both sides under the matchmaking lock. Ready/video are admission
      // checks; searching is continuing consent, and live membership prevents a
      // disconnected or depleted squad from being matched.
      const [seekerOnlineMembers, candidateOnlineMembers] = await Promise.all([
        socketService.getOnlineUserIds(freshSquad.members.map((m) => m.userId)),
        socketService.getOnlineUserIds(freshCandidate.members.map((m) => m.userId)),
      ]);
      if (!hasMinimumOnlineMembers(freshSquad, seekerOnlineMembers)) {
        console.warn(`[Matchmaking] Seeker ${freshSquad.squadId} is no longer live. Purging from queue.`);
        await resetInactiveSearchingSquad(freshSquad, { signal, admission: seekerAdmission });
        return { stop: true };
      }
      if (!hasMinimumOnlineMembers(freshCandidate, candidateOnlineMembers)) {
        console.warn(`[Matchmaking] Candidate ${freshCandidate.squadId} is no longer live. Purging from queue.`);
        await resetInactiveSearchingSquad(freshCandidate, { signal, admission: candidateAdmission });
        return null;
      }

      if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");
      logMatchmakingDebug(`[Matchmaking] Success! Creating encounter for ${freshSquad.squadId} and ${freshCandidate.squadId}`);
      return await createEncounterForSquads(freshSquad, freshCandidate, signal, admissions);
        }, { squadIds: [squad.squadId, bestCandidate.squadId], retryCount: 0 });
        if (outcome?.stop) return null;
        if (outcome) return outcome;
      } catch (error) {
        // A busy oldest candidate must not stall all other pairs.
        if (error.name === "ExecutionError" || error.code === "MATCH_SNAPSHOT_CHANGED") continue;
        throw error;
      }
    }

    return null; // No valid candidates found in this cycle
  } catch (err) {
    if (err.name !== 'ExecutionError') {
      console.error("[Matchmaking] Error:", err);
    }
    return null;
  }
};

// Read-only status snapshot. Callers that already loaded the squad (e.g. the
// squad-access middleware) pass it in to avoid a second full-document fetch.
const getMatchmakingStatus = async (squadId, { squad: preloadedSquad } = {}) => {
  const squad =
    preloadedSquad && preloadedSquad.squadId === squadId
      ? preloadedSquad
      : await Squad.findOne({ squadId }).select("-coverImage").lean();
  if (!squad) {
    return null;
  }

  let match = null;
  let interactionBlocked = false;
  if (squad.currentEncounterId) {
    const encounter = await Encounter.findOne({ encounterId: squad.currentEncounterId }).lean();
    // An ended encounter is never a match to reveal or rejoin.
    if (encounter && encounter.status !== "ended") {
      const opponentSquadId = encounter.squadAId === squadId ? encounter.squadBId : encounter.squadAId;
      const opponentSquad = await Squad.findOne({ squadId: opponentSquadId })
        .select("squadId squadName members.userId")
        .lean();
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

const ackEncounterForSquad = async ({ encounter, squadId, emitRealtime = true, signal }) => {
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
    // Free both squads too: nothing else moves a squad out of "matched" once
    // its encounter has ended.
    await endEncounterToIdle({ encounter, emitRealtime });
    return {
      error: { status: 409, code: "ENCOUNTER_EXPIRED", message: "Encounter handoff expired" },
      realtime: { close: true },
    };
  }

  const acknowledgements = new Map(encounter.ackBySquad);
  acknowledgements.set(squadId, true);
  const allAcked = Boolean(acknowledgements.get(encounter.squadAId)) && Boolean(acknowledgements.get(encounter.squadBId));
  let updated;
  try {
    assertMatchmakingLease(signal);
    updated = await mongoose.connection.transaction(async session => {
      for (const id of [encounter.squadAId, encounter.squadBId]) {
        assertMatchmakingLease(signal);
        const result = await Squad.updateOne(
          { squadId: id, status: "matched", currentEncounterId: encounter.encounterId },
          { $set: { status: allAcked ? "in_encounter" : "matched" }, $inc: { __v: 1 } },
          { session }
        );
        if ((result.matchedCount ?? result.n ?? 0) !== 1) {
          throw Object.assign(new Error("Encounter squad changed"), { code: "ACK_STATE_CHANGED" });
        }
      }
      const result = await Encounter.findOneAndUpdate(
        { encounterId: encounter.encounterId, status: "awaiting_ack" },
        { $set: { [`ackBySquad.${squadId}`]: true, ...(allAcked ? { status: "active" } : {}) } },
        { new: true, session }
      );
      if (!result) throw Object.assign(new Error("Encounter changed"), { code: "ACK_STATE_CHANGED" });
      assertMatchmakingLease(signal);
      return result;
    });
  } catch (error) {
    if (error.code !== "ACK_STATE_CHANGED") throw error;
    return { error: { status: 409, code: "ENCOUNTER_CHANGED", message: "Encounter is no longer available" } };
  }
  encounter.ackBySquad = acknowledgements;
  encounter.status = updated.status;
  if (allAcked && emitRealtime) {
    socketService.emitToSquad(encounter.squadAId, "ENCOUNTER_ACTIVE", { encounterId: encounter.encounterId });
    socketService.emitToSquad(encounter.squadBId, "ENCOUNTER_ACTIVE", { encounterId: encounter.encounterId });
  }

  return {
    acknowledged: true,
    allAcked,
    encounter,
    realtime: allAcked ? { activate: true } : null,
  };
};

const endEncounterAndRequeue = async ({ encounter, triggeringSquadId, matchImmediately = true, signal }) => {
  if (!isStrangerDiscoveryEnabled()) {
    await endEncounterToIdle({ encounter });
    return null;
  }

  const squadIds = [encounter.squadAId, encounter.squadBId];
  // A handoff that timed out says nothing about a squad that never acked (it
  // may have closed the app), so only the skipping squad and squads that did
  // ack go back to searching.
  const handoffExpired =
    encounter.status === "awaiting_ack" && new Date(encounter.expiresAt).getTime() < Date.now();
  const searchingSquadIds = handoffExpired
    ? squadIds.filter((squadId) => squadId === triggeringSquadId || Boolean(encounter.ackBySquad?.get?.(squadId)))
    : squadIds;
  const idleSquadIds = squadIds.filter((squadId) => !searchingSquadIds.includes(squadId));

  // Another ender (End, the sweeper, a late ack) already won: never requeue.
  if (!(await markEncounterEnded(encounter))) return null;

  socketService.closeEncounterRoom(encounter);

  // Clear encounter state and set squads to searching with no encounter. The
  // encounter-id guard keeps a squad that already left this call (e.g. a
  // concurrent End) out of the queue.
  const now = new Date();
  await Squad.updateMany(
    { squadId: { $in: searchingSquadIds }, currentEncounterId: encounter.encounterId },
    {
      $set: {
        status: "searching",
        lastEncounterId: encounter.encounterId,
        lastEncounterEndedAt: now,
        currentEncounterId: null,
        opponentSquadId: null,
        matchedAt: null,
        searchQueuedAt: now,
        "members.$[].inEncounterVideo": false,
      },
      $inc: { __v: 1 },
    }
  );
  if (idleSquadIds.length) {
    await releaseSquadsFromEncounter(encounter, { squadIds: idleSquadIds });
  }

  // Add back to Redis queue only the squads this call moved to searching.
  const squads = (await Squad.find({ squadId: { $in: searchingSquadIds } })).filter(
    (s) => s.status === "searching" && !s.currentEncounterId && s.lastEncounterId === encounter.encounterId
  );
  const requeuedSquadIds = [];
  const admissions = new Map();
  try {
    for (const s of squads) {
      const canRequeue =
        !(s.tags || []).some((tag) => classifyVibe(tag) !== "ok") &&
        await allUsersHaveAdultAccess(s.members.map((member) => member.userId), { User }) &&
        !(await anyBlockedPair(s.members.map((member) => member.userId), { User }));
      if (!canRequeue) {
        await rollbackSquadsToIdle([s], { signal, admissions });
        continue;
      }
      assertMatchmakingLease(signal);
      const admissionId = await queueService.addToQueue(s.squadId, getSquadSize(s), s.searchRegion, s.tags, s.reputationScore);
      admissions.set(s.squadId, admissionId);
      requeuedSquadIds.push(s.squadId);
      // Reset encounter video state in Redis
      for (const m of s.members) {
        await sessionService.setSessionField(s.squadId, m.memberId, 'inEncounterVideo', false);
      }
    }
  } catch (error) {
    await rollbackSquadsToIdle(squads, { signal, admissions });
    throw error;
  }

  // Publish only after queue admission so every squad member follows the same state.
  for (const squadId of squadIds) {
    socketService.emitToSquad(squadId, "ENCOUNTER_ENDED", {
      encounterId: encounter.encounterId,
      reason: "next_squad",
      queueStatus: requeuedSquadIds.includes(squadId) ? "searching" : "idle",
    });
  }

  const triggeringSquad = squads.find(
    (s) => s.squadId === triggeringSquadId && requeuedSquadIds.includes(s.squadId)
  ) || squads.find((s) => requeuedSquadIds.includes(s.squadId));
  if (!triggeringSquad) {
    return null;
  }

  if (matchImmediately) await tryMatchmakeForSquad(triggeringSquad);

  return triggeringSquad;
};

const endEncounterToIdle = async ({ encounter, emitRealtime = true }) => {
  // Squads are released even when another path already ended the encounter,
  // so a squad left pointing at a dead encounter is repaired here too.
  await markEncounterEnded(encounter);

  if (emitRealtime) {
    socketService.emitToSquad(encounter.squadAId, "ENCOUNTER_ENDED", { encounterId: encounter.encounterId });
    socketService.emitToSquad(encounter.squadBId, "ENCOUNTER_ENDED", { encounterId: encounter.encounterId });
    socketService.closeEncounterRoom(encounter);
  }

  // Clear encounter state and inEncounterVideo flags for all members
  await releaseSquadsFromEncounter(encounter, { emitRealtime });
};

const didMatch = (result) => (result?.matchedCount ?? result?.n ?? 0) > 0;

const endEncounterAsymmetric = async ({ encounter, disconnectingSquadId, shouldEnd }) => {
  const otherSquadId = encounter.squadAId === disconnectingSquadId ? encounter.squadBId : encounter.squadAId;
  const squadIds = [encounter.squadAId, encounter.squadBId];
  let didEnd = false;

  const idleState = IDLE_ENCOUNTER_STATE;

  // The transition holds the matchmaking lock so a concurrent skip or ack
  // cannot interleave with it. Matching takes the same lock, so it runs only
  // after the transition has released it.
  const squadToMatch = await withMatchmakingLock(async (signal) => {
    encounter = await Encounter.findOne({ encounterId: encounter.encounterId });
    if (!encounter || ![encounter.squadAId, encounter.squadBId].includes(disconnectingSquadId)) return null;
    const disconnectingSquad = await Squad.findOne({ squadId: disconnectingSquadId });
    if (shouldEnd && !(await shouldEnd({ encounter, disconnectingSquad }))) return null;
    assertMatchmakingLease(signal);
    didEnd = true;
    if (disconnectingSquad?.currentEncounterId === encounter.encounterId) {
      await settleMatchmakingEffects(disconnectingSquad.members.map(member =>
        sessionService.setSessionField(disconnectingSquadId, member.memberId, 'inEncounterVideo', false)
      ));
      assertMatchmakingLease(signal);
    }
    // Both resets are guarded by the old encounter id. A failed write leaves the
    // encounter retryable; a later retry cannot clobber a squad that has already
    // joined a newer encounter.
    const disconnectingReset = await Squad.updateOne(
      { squadId: disconnectingSquadId, currentEncounterId: encounter.encounterId },
      { $set: idleState }
    );
    assertMatchmakingLease(signal);
    const otherReset = await Squad.updateOne(
      { squadId: otherSquadId, currentEncounterId: encounter.encounterId },
      { $set: idleState }
    );
    assertMatchmakingLease(signal);
    if (!didMatch(disconnectingReset)) {
      // A skip that won the race already requeued this squad. End still means
      // stop, so take it back out of the search that skip started.
      const pulledFromSearch = await Squad.updateOne(
        {
          squadId: disconnectingSquadId,
          status: "searching",
          currentEncounterId: null,
          lastEncounterId: encounter.encounterId,
        },
        { $set: idleState }
      );
      if (didMatch(pulledFromSearch)) await queueService.removeFromQueue(disconnectingSquadId);
    }

    // No-op when another path already ended it.
    await markEncounterEnded(encounter);

    // Notify only after both durable squad transitions and the encounter write.
    const endedPayload = {
      encounterId: encounter.encounterId,
      reason: "squad_disconnected",
      endedBySquadId: disconnectingSquadId,
    };
    socketService.emitToSquad(encounter.squadAId, "ENCOUNTER_ENDED", endedPayload);
    socketService.emitToSquad(encounter.squadBId, "ENCOUNTER_ENDED", endedPayload);
    socketService.closeEncounterRoom(encounter);

    const otherSquad = await Squad.findOne({ squadId: otherSquadId });
    const otherWasResetNow = didMatch(otherReset);
    if (!isStrangerDiscoveryEnabled()) {
      await queueService.removeFromQueue(otherSquadId);
    } else if (otherWasResetNow && otherSquad?.status === "idle" && !otherSquad.currentEncounterId) {
      let promotedSearch;
      const admissions = new Map();
      try {
        const canRequeue =
          !(otherSquad.tags || []).some((tag) => classifyVibe(tag) !== "ok") &&
          await allUsersHaveAdultAccess(otherSquad.members.map((member) => member.userId), { User }) &&
          !(await anyBlockedPair(otherSquad.members.map((member) => member.userId), { User }));
        if (!canRequeue) {
          await queueService.removeFromQueue(otherSquadId);
        } else {
          const now = new Date();
          if (signal.aborted) throw signal.error || new Error("Matchmaking lock was lost");
          const promoted = await Squad.updateOne(
            { squadId: otherSquadId, status: "idle", currentEncounterId: null },
            { $set: { ...idleState, status: "searching", searchQueuedAt: now }, $inc: { __v: 1 } }
          );
          if ((promoted?.matchedCount ?? promoted?.n ?? 1) > 0) {
            otherSquad.status = "searching";
            otherSquad.searchQueuedAt = now;
            otherSquad.currentEncounterId = null;
            otherSquad.opponentSquadId = null;
            otherSquad.matchedAt = null;
            promotedSearch = { squadId: otherSquad.squadId, searchQueuedAt: now, lastEncounterId: otherSquad.lastEncounterId,
              __v: (otherSquad.__v || 0) + 1 };
            const admissionId = await queueService.addToQueue(
              otherSquad.squadId,
              getSquadSize(otherSquad),
              otherSquad.searchRegion,
              otherSquad.tags,
              otherSquad.reputationScore
            );
            admissions.set(otherSquadId, admissionId);
            assertMatchmakingLease(signal);
            // Sync Redis for other squad
            for (const m of otherSquad.members) {
              await sessionService.setSessionField(otherSquadId, m.memberId, 'inEncounterVideo', false);
            }
            // Start matching for them as soon as the lock is released
            return otherSquad;
          }
        }
      } catch (error) {
        if (promotedSearch) await rollbackSquadsToIdle([promotedSearch], { signal, admissions });
        throw error;
      }
    }
    return null;
  }, { squadIds });

  if (!didEnd) return false;

  if (squadToMatch) await tryMatchmakeForSquad(squadToMatch);

  // Do not delete broad member sessions after releasing the pair lease.
  // Socket disconnect cleanup separately fences current presence/media owners.
  return true;
};

// ── Stuck-encounter sweeper ──────────────────────────────────────────────────
// Encounters created in "awaiting_ack" expire if both squads never ack. When
// that happens the squads can stay stuck in "matched" with a currentEncounterId
// pointing at the dead encounter. This sweeper periodically ends expired
// awaiting_ack encounters and frees those squads back to "idle". It also frees
// any squad still pointing at an encounter that some other path already ended.
const ENCOUNTER_SWEEP_PAGE_SIZE = 50;
const sweepCursors = { expired: null, repair: null };
const sweepStuckEncounters = async () => {
  try {
    const expiredPage = after => Encounter.find({
      status: "awaiting_ack", expiresAt: { $lt: new Date() },
      ...(after ? { $or: [
        { expiresAt: { $gt: after.expiresAt } },
        { expiresAt: after.expiresAt, encounterId: { $gt: after.encounterId } },
      ] } : {}),
    }).sort({ expiresAt: 1, encounterId: 1 }).limit(ENCOUNTER_SWEEP_PAGE_SIZE);
    let expired = await expiredPage(sweepCursors.expired);
    if (!expired.length && sweepCursors.expired) expired = await expiredPage(null);
    const lastExpired = expired.at(-1);
    sweepCursors.expired = lastExpired ? { expiresAt: lastExpired.expiresAt, encounterId: lastExpired.encounterId } : null;

    // Repair only bounded live pointers, never page through ended history.
    const repairPage = after => Squad.find({
      status: { $in: ["matched", "in_encounter"] }, currentEncounterId: { $ne: null },
      ...(after ? { squadId: { $gt: after } } : {}),
    }).select("squadId currentEncounterId").sort({ squadId: 1 }).limit(ENCOUNTER_SWEEP_PAGE_SIZE).lean();
    let pointing = await repairPage(sweepCursors.repair);
    if (!pointing.length && sweepCursors.repair) pointing = await repairPage(null);
    sweepCursors.repair = pointing.at(-1)?.squadId || null;
    const encounterIds = [...new Set(pointing.map(squad => squad.currentEncounterId))];
    const ended = encounterIds.length ? await Encounter.find({ encounterId: { $in: encounterIds }, status: "ended" }) : [];
    const encounters = [...new Map([...expired, ...ended].map(encounter => [encounter.encounterId, encounter])).values()];
    let swept = 0;
    for (const item of encounters) {
      try {
        swept += await withMatchmakingLock(async signal => {
          const encounter = await Encounter.findOne({ encounterId: item.encounterId });
          if (!encounter) return 0;
          assertMatchmakingLease(signal);
          if (encounter.status === "ended") {
            await releaseSquadsFromEncounter(encounter);
            return 0;
          }
          if (encounter.status !== "awaiting_ack" || new Date(encounter.expiresAt).getTime() >= Date.now()) return 0;
          if (!(await markEncounterEnded(encounter, { fromStatus: "awaiting_ack" }))) return 0;
          assertMatchmakingLease(signal);
          socketService.emitToSquad(encounter.squadAId, "ENCOUNTER_ENDED", { encounterId: encounter.encounterId });
          socketService.emitToSquad(encounter.squadBId, "ENCOUNTER_ENDED", { encounterId: encounter.encounterId });
          socketService.closeEncounterRoom(encounter);
          await releaseSquadsFromEncounter(encounter);
          return 1;
        }, { squadIds: [item.squadAId, item.squadBId], retryCount: 0 });
      } catch (error) {
        if (error.name !== "ExecutionError") throw error;
      }
    }
    return swept;
  } catch (err) {
    console.error("[Sweeper] Error sweeping stuck encounters:", err);
    return 0;
  }
};

// Turning stranger discovery off must also stop searches already in flight;
// otherwise those squads sit in "searching" with nothing to match them.
const stopSearchesWhileDiscoveryDisabled = async () => {
  if (isStrangerDiscoveryEnabled()) return 0;
  try {
    return await withMatchmakingLock(async () => {
      const [searching, queued] = await Promise.all([
        Squad.find({ status: "searching" }).select("squadId").lean(),
        queueService.getAllQueuedSquads(),
      ]);
      const searchingIds = searching.map((squad) => squad.squadId);
      if (searchingIds.length) {
        await Squad.updateMany(
          { squadId: { $in: searchingIds }, status: "searching" },
          { $set: { status: "idle", searchQueuedAt: null } }
        );
      }
      const queuedIds = new Set([...searchingIds, ...queued.map((entry) => entry.squadId)]);
      for (const squadId of queuedIds) {
        await queueService.removeFromQueue(squadId);
      }
      for (const squadId of searchingIds) {
        socketService.emitToSquad(squadId, "SQUAD_UPDATED", {});
      }
      if (searchingIds.length) {
        logMatchmakingDebug(`[Sweeper] Discovery disabled: stopped ${searchingIds.length} search(es)`);
      }
      return searchingIds.length;
    });
  } catch (err) {
    console.error("[Sweeper] Error stopping searches while discovery is disabled:", err);
    return 0;
  }
};

// Matching otherwise runs only when a search starts or a call ends, so two
// squads that missed each other (a failed attempt, the post-skip cooldown)
// would wait forever. Retry the longest-waiting searches each tick.
const SEARCH_RETRY_BATCH_SIZE = 25;
const retrySearchingSquads = async ({ limit = SEARCH_RETRY_BATCH_SIZE } = {}) => {
  if (!isStrangerDiscoveryEnabled()) return 0;
  try {
    const cursor = await queueService.getRetryCursor();
    const findBatch = (after) => Squad.find({
      status: "searching",
      ...(after ? { $or: [
        after.queuedAt === null ? {searchQueuedAt: {$type: "date"}} : { searchQueuedAt: { $gt: new Date(after.queuedAt) } },
        { searchQueuedAt: after.queuedAt === null ? null : new Date(after.queuedAt), squadId: { $gt: after.squadId } },
      ] } : {}),
    })
      .select("squadId status searchQueuedAt")
      .sort({ searchQueuedAt: 1, squadId: 1 })
      .limit(Math.floor(Math.min(SEARCH_RETRY_BATCH_SIZE, Math.max(1, Number(limit) || SEARCH_RETRY_BATCH_SIZE))))
      .lean();
    let searching = await findBatch(cursor);
    if (!searching.length && cursor) searching = await findBatch(null);
    if (searching.length) await queueService.setRetryCursor(searching[searching.length - 1]);
    // A single searcher has nobody to match with.
    if (!searching.length || (!cursor && searching.length < 2)) return 0;

    const matchedSquadIds = new Set();
    let matches = 0;
    for (const squad of searching) {
      if (matchedSquadIds.has(squad.squadId)) continue;
      const encounter = await tryMatchmakeForSquad(squad);
      if (encounter) {
        matches += 1;
        matchedSquadIds.add(encounter.squadAId);
        matchedSquadIds.add(encounter.squadBId);
      }
    }
    return matches;
  } catch (err) {
    console.error("[Sweeper] Error retrying searching squads:", err);
    return 0;
  }
};

const runMatchmakingMaintenance = async () => {
  await sweepStuckEncounters();
  await stopSearchesWhileDiscoveryDisabled();
  await retrySearchingSquads();
};

const STUCK_ENCOUNTER_SWEEP_INTERVAL_MS = 30 * 1000;
let sweepTimer = null;

// Lease slightly shorter than the interval so exactly one replica sweeps per tick.
const STUCK_ENCOUNTER_SWEEP_LEASE_MS = STUCK_ENCOUNTER_SWEEP_INTERVAL_MS - 5 * 1000;

const runEncounterSweepTick = () =>
  runAsSingleReplica("encounter-sweeper", STUCK_ENCOUNTER_SWEEP_LEASE_MS, runMatchmakingMaintenance)
    .catch((err) => {
      console.error("[Sweeper] Skipped stuck-encounter sweep (leader lease unavailable):", err.message);
    });

const startEncounterSweeper = () => {
  if (sweepTimer) return sweepTimer;
  sweepTimer = setInterval(runEncounterSweepTick, STUCK_ENCOUNTER_SWEEP_INTERVAL_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
  logMatchmakingDebug(`[Sweeper] Stuck-encounter sweeper started (every ${STUCK_ENCOUNTER_SWEEP_INTERVAL_MS / 1000}s)`);
  return sweepTimer;
};

const stopEncounterSweeper = () => {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
};

module.exports = {
  hasMinimumOnlineMembers,
  createEncounterForSquads,
  scoreCandidate,
  tryMatchmakeForSquad,
  sweepStuckEncounters,
  stopSearchesWhileDiscoveryDisabled,
  retrySearchingSquads,
  runMatchmakingMaintenance,
  startEncounterSweeper,
  stopEncounterSweeper,
  getMatchmakingStatus,
  getEncounterById,
  getEncounterRosterContext,
  ackEncounterForSquad,
  endEncounterAndRequeue,
  endEncounterToIdle,
  endEncounterAsymmetric,
  releaseSquadsFromEncounter,
  isMatchmakingDebugEnabled,
};
