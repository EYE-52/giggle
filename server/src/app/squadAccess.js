const { Squad } = require("../models/Squad");
const { deleteNotifications } = require("../models/Notification");
const {
  canonicalUserId,
  relationalIdMatcher,
} = require("../services/interactionSafetyService");

const getRequesterIdentity = (req) => {
  const identity = req.user || req.giggleIdentity || {};
  const userId = identity.userId || identity.sub;
  const providerAccountId = identity.providerAccountId || userId;

  return {
    userId,
    providerAccountId,
    name: identity.name,
    email: identity.email,
    image: identity.image,
    isPremium: identity.isPremium || false,
  };
};

const identityIdString = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value.toString === "function") return value.toString();
  return "";
};

const hasIdentityId = (items = [], targetId, key) => {
  const target = identityIdString(targetId);
  if (!target) return false;

  return items.some((item) => {
    const value = key ? item?.[key] : item;
    return identityIdString(value) === target;
  });
};

const isSameMember = (member, identity) => {
  if (!member || !identity) return false;

  if (identity.userId && identityIdString(member.userId) === identityIdString(identity.userId)) return true;
  if (
    identity.providerAccountId &&
    identityIdString(member.providerAccountId) === identityIdString(identity.providerAccountId)
  ) {
    return true;
  }

  return false;
};

// Returns the requester's own member.joinedAt timestamp inside a squad (ms),
// used to order multiple memberships by "most recently joined".
const memberJoinedAtMs = (squad, identity) => {
  const member = squad.members.find((candidate) => isSameMember(candidate, identity));
  if (member && member.joinedAt) {
    const ts = new Date(member.joinedAt).getTime();
    if (!Number.isNaN(ts)) return ts;
  }
  // Fall back to squad creation time so a squad always sorts deterministically.
  return squad.createdAt ? new Date(squad.createdAt).getTime() : 0;
};

// Find ALL squads the identity belongs to, sorted newest-first by the
// requester's own membership (most recently joined/created first).
const findSquadsForIdentity = async ({ userId, providerAccountId, excludeSquadId } = {}) => {
  const orConditions = [];

  if (userId) {
    orConditions.push({ userId });
  }

  if (providerAccountId) {
    orConditions.push({ providerAccountId });
  }

  if (orConditions.length === 0) {
    return [];
  }

  const query = {
    members: {
      $elemMatch: {
        $or: orConditions,
      },
    },
  };

  if (excludeSquadId) {
    query.squadId = { $ne: excludeSquadId };
  }

  const identity = { userId, providerAccountId };
  const squads = await Squad.find(query);
  return squads.sort((a, b) => memberJoinedAtMs(b, identity) - memberJoinedAtMs(a, identity));
};

// Convenience for flows that just need "the user's current squad": now returns
// the MOST-RECENT membership (a user may belong to many squads simultaneously).
const findSquadForIdentity = async ({ userId, providerAccountId, excludeSquadId } = {}) => {
  const squads = await findSquadsForIdentity({ userId, providerAccountId, excludeSquadId });
  return squads.length > 0 ? squads[0] : null;
};

const getSquadAccessContext = async ({ squadId, identity }) => {
  const squad = await Squad.findOne({ squadId });
  if (!squad) {
    return { error: { status: 404, code: "SQUAD_NOT_FOUND", message: "Squad not found" } };
  }

  const memberIndex = squad.members.findIndex((member) => isSameMember(member, identity));
  if (memberIndex === -1) {
    return { error: { status: 403, code: "FORBIDDEN", message: "Not a member of this squad" } };
  }

  const member = squad.members[memberIndex];
  const leaderIndex = squad.members.findIndex((candidate) => candidate.role === "leader");
  const leader = leaderIndex >= 0 ? squad.members[leaderIndex] : null;

  return {
    squad,
    member,
    memberIndex,
    leader,
    isLeader: member.role === "leader",
  };
};

const deleteSquadAndNotifications = async (squad) => {
  await deleteNotifications({ squadId: squad.squadId });
  await squad.deleteOne();
};

const persistSquadAfterMemberRemoval = async (squad, { removedMemberRole }) => {
  let squadDeleted = false;
  let newLeaderMemberId = null;

  if (squad.members.length === 0) {
    await deleteSquadAndNotifications(squad);
    squadDeleted = true;
  } else {
    if (removedMemberRole === "leader") {
      squad.members[0].role = "leader";
      newLeaderMemberId = squad.members[0].memberId;
    } else {
      const currentLeader = squad.members.find((member) => member.role === "leader");
      newLeaderMemberId = currentLeader ? currentLeader.memberId : null;
    }

    await squad.save();
  }

  return { squadDeleted, newLeaderMemberId };
};

const removeSquadMember = async (squad, memberIndex) => {
  const removedMember = squad?.members?.[memberIndex];
  if (!removedMember) return null;
  const { Encounter } = require("../models/Encounter");
  const queueService = require("../services/queueService");
  const sessionService = require("../services/sessionService");
  const socketService = require("../services/socketService");

  const wasSearching = squad.status === "searching";
  const encounterId = squad.currentEncounterId;
  const willDeleteSquad = squad.members.length === 1;

  // Keep the persisted membership in place until every fallible cleanup step
  // succeeds. A failed block/leave can then retry and find the same member,
  // while access is revoked as the first security boundary.
  socketService.revokeUserRealtimeAccess({
    userId: removedMember.userId,
    squadId: squad.squadId,
    encounterId,
  });
  await sessionService.clearMemberSession(squad.squadId, removedMember.memberId);

  if (wasSearching) await queueService.removeFromQueue(squad.squadId);

  if (willDeleteSquad && encounterId) {
    const encounter = await Encounter.findOne({ encounterId });
    if (encounter) {
      const { endEncounterAsymmetric } = require("../services/matchmakingService");
      await endEncounterAsymmetric({ encounter, disconnectingSquadId: squad.squadId });
    }
  }

  squad.members.splice(memberIndex, 1);
  if (wasSearching && squad.members.length > 0) {
    squad.status = "idle";
    squad.searchQueuedAt = null;
  }

  const persisted = await persistSquadAfterMemberRemoval(squad, {
    removedMemberRole: removedMember.role,
  });
  socketService.emitToUser(removedMember.userId, "SQUAD_UPDATED", {
    squadId: squad.squadId,
    removed: true,
  });
  if (!persisted.squadDeleted) {
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
  }

  return { ...persisted, removedMember };
};

const removeBlockedIdentityFromSharedSquads = async ({ blockerId, blockedUserIds }) => {
  const socketService = require("../services/socketService");
  const blocker = canonicalUserId(blockerId);
  const targets = new Set((blockedUserIds || []).map(canonicalUserId).filter(Boolean));
  if (!blocker || targets.size !== (blockedUserIds || []).length) {
    throw new Error("Invalid blocked squad cleanup ids");
  }

  const participantIds = [blocker, ...targets];
  const exactSquads = await Squad.find({ "members.userId": { $in: participantIds } });
  // ponytail: union this scan with the indexed results until all pre-canonical
  // mixed-case member IDs are migrated, then delete the regex query.
  const participantMatchers = participantIds.map(relationalIdMatcher);
  const legacySquads = await Squad.find({ "members.userId": { $in: participantMatchers } });
  const squadsById = new Map();
  for (const squad of [...exactSquads, ...legacySquads]) {
    const key = squad?._id?.toString?.() || squad?.squadId;
    if (key) squadsById.set(key, squad);
  }
  const squads = [...squadsById.values()];
  let removedMemberships = 0;

  for (const squad of squads) {
    const memberIds = new Set((squad.members || []).map((member) => canonicalUserId(member.userId)));
    const blockerIsMember = memberIds.has(blocker);
    const targetIsMember = [...targets].some((targetId) => memberIds.has(targetId));
    const pendingIds = new Set();
    if (blockerIsMember) for (const targetId of targets) pendingIds.add(targetId);
    if (targetIsMember) pendingIds.add(blocker);

    const beforeInvites = (squad.invitedUserIds || []).length;
    const beforeRequests = (squad.joinRequests || []).length;
    squad.invitedUserIds = (squad.invitedUserIds || []).filter(
      (userId) => !pendingIds.has(canonicalUserId(userId))
    );
    squad.joinRequests = (squad.joinRequests || []).filter(
      (request) => !pendingIds.has(canonicalUserId(request?.userId))
    );
    const pendingChanged =
      squad.invitedUserIds.length !== beforeInvites || squad.joinRequests.length !== beforeRequests;

    if (blockerIsMember && targetIsMember) {
      const blockerIndex = squad.members.findIndex(
        (member) => canonicalUserId(member.userId) === blocker
      );
      if (blockerIndex >= 0) {
        await removeSquadMember(squad, blockerIndex);
        removedMemberships += 1;
      }
    } else if (pendingChanged) {
      await squad.save();
      socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
    }
  }

  return { removedMemberships };
};

module.exports = {
  getRequesterIdentity,
  hasIdentityId,
  isSameMember,
  findSquadForIdentity,
  findSquadsForIdentity,
  getSquadAccessContext,
  deleteSquadAndNotifications,
  persistSquadAfterMemberRemoval,
  removeSquadMember,
  removeBlockedIdentityFromSharedSquads,
};
