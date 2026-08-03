const { Squad } = require("../models/Squad");
const { deleteNotifications } = require("../models/Notification");

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

module.exports = {
  getRequesterIdentity,
  hasIdentityId,
  isSameMember,
  findSquadForIdentity,
  findSquadsForIdentity,
  getSquadAccessContext,
  deleteSquadAndNotifications,
  persistSquadAfterMemberRemoval,
};
