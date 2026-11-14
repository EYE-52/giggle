// Group identity is scoped to one durable group, including its own members.
const { opaqueEncounterId } = require("./encounterIdentityService");
const { normalizeEncounterAlias } = require("../utils/groupIdentityValidation");
const aliasGroup = (squad) => squad?.identityMode === "aliases";
const groupScope = (squad) => `group:${squad.squadId}`;
const groupHandle = (squad, member) =>
  opaqueEncounterId(groupScope(squad), member.userId);
const publicMemberId = (squad, member) =>
  aliasGroup(squad) ? groupHandle(squad, member) : member.memberId;
const publicUserId = (squad, member) =>
  aliasGroup(squad) ? groupHandle(squad, member) : String(member.userId);
const groupAlias = (member) =>
  normalizeEncounterAlias(member?.alias ?? "").value || "Guest";
const publicGroupMember = (squad, member, live = {}) => {
  if (!aliasGroup(squad)) {
    return {
      ...(typeof member?.toObject === "function" ? member.toObject() : member),
      ...live,
    };
  }
  const handle = groupHandle(squad, member);
  return {
    memberId: handle,
    userId: handle,
    callId: handle,
    displayName: groupAlias(member),
    avatar: null,
    anonymous: true,
    role: member.role === "leader" ? "leader" : "member",
    joinedAt: member.joinedAt,
    ready: live.ready ?? member.ready ?? false,
    inLobbyVideo: live.inLobbyVideo ?? member.inLobbyVideo ?? false,
    inEncounterVideo: live.inEncounterVideo ?? member.inEncounterVideo ?? false,
    ...(live.uid != null ? { uid: live.uid } : {}),
    ...(typeof live.online === "boolean" ? { online: live.online } : {}),
    ...(typeof live.screenSharing === "boolean"
      ? {
          screenSharing: live.screenSharing,
          screenSharingExpiresAt: live.screenSharingExpiresAt || 0,
        }
      : {}),
  };
};
const groupFields = (squad, viewerId) => {
  const own = (squad.members || []).find(
    (member) => String(member.userId) === String(viewerId),
  );
  return {
    managedGroup: squad.managedGroup === true,
    modeMutable: false,
    description: squad.description || "",
    publicTopic: squad.publicTopic || "banter",
    language: squad.language || "any",
    isPrivatePair: squad.authorizedPrincipalPair?.length === 2,
    identityMode: squad.identityMode || "names",
    communicationMode: squad.communicationMode || "video",
    ...(own
      ? {
          selfMemberId: publicMemberId(squad, own),
          selfUserId: publicUserId(squad, own),
        }
      : {}),
  };
};
// Resolve only against this group's current server-owned membership. A raw
// account id is never a valid anonymous-room action target.
const resolveGroupMember = (squad, target) =>
  (squad.members || []).find(
    (member) =>
      publicMemberId(squad, member) === target ||
      (aliasGroup(squad)
        ? groupHandle(squad, member) === target
        : String(member.userId) === target),
  );
module.exports = {
  aliasGroup,
  groupScope,
  groupHandle,
  groupAlias,
  publicMemberId,
  publicUserId,
  publicGroupMember,
  groupFields,
  resolveGroupMember,
};
