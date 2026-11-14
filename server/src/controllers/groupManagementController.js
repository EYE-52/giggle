const crypto = require("crypto");
const { Squad } = require("../models/Squad");
const User = require("../models/User");
const { anyBlockedPair } = require("../services/interactionSafetyService");
const {
  withSquadAdmissionLock,
  guardSquadWrites,
} = require("../services/squadAdmissionService");
const {
  getRequesterIdentity,
  isSameMember,
  removeSquadMember,
} = require("../app/squadAccess");
const squadController = require("./squadController");
const { groupMetadata } = require("../utils/groupSettingsValidation");
const {
  aliasGroup,
  groupAlias,
  publicMemberId,
  resolveGroupMember,
  groupFields,
} = require("../services/groupIdentityService");
const { isStrangerDiscoveryEnabled } = require("../config/appConfig");
const socketService = require("../services/socketService");
const fail = (status, code, message) =>
  Object.assign(new Error(message), { status, code });
const {
  validGroupInvite: validInvite,
} = require("../utils/groupInviteValidation");
const isMember = (squad, req) =>
  squad.members.some((member) =>
    isSameMember(member, getRequesterIdentity(req)),
  );
const owner = (squad, req) =>
  squad.members.find(
    (member) =>
      member.role === "leader" &&
      isSameMember(member, getRequesterIdentity(req)),
  );
const metadata = async (squad) => ({
  squadId: squad.squadId,
  squadName: squad.squadName,
  ...groupFields(squad),
  visibility: squad.visibility || "private",
  joinPolicy: squad.joinPolicy || "open",
  memberCount: squad.members.length,
  maxSlots: await squadController.getSquadCapacity(squad),
  onlineCount: (
    await require("../services/groupPresenceService").onlineUserIds(
      squad.squadId,
      squad.members.map((member) => member.userId),
    )
  ).size,
});
function handler(work, { leader = false, lock = false } = {}) {
  return async (req, res) => {
    try {
      const run = async (admissionSignal) => {
        const loaded = await Squad.findOne({ squadId: req.params.squadId });
        const squad = lock ? guardSquadWrites(loaded, admissionSignal) : loaded;
        if (!squad) {
          throw fail(404, "NOT_FOUND", "This group is unavailable.");
        }
        if (leader && !owner(squad, req)) {
          throw fail(403, "LEADER_ONLY", "Only the group owner can do that.");
        }
        await work(req, res, squad);
      };
      if (lock) {
        return await withSquadAdmissionLock(req.params.squadId, run);
      }
      return await run();
    } catch (error) {
      if (res.headersSent) return res;
      return res.status(error.status || 503).json({
        ok: false,
        error: {
          code: error.code || "GROUP_UNAVAILABLE",
          message: error.status
            ? error.message
            : "This group could not be updated. Try again.",
        },
      });
    }
  };
}
const state = (req, res, squad) =>
  squadController.getSquadHandler(
    {
      ...req,
      squadAccess: {
        squad,
        leader: squad.members.find((member) => member.role === "leader"),
      },
    },
    res,
  );
const previewGroup = handler(async (req, res, squad) => {
  const member = isMember(squad, req);
  if (
    !member &&
    (squad.visibility !== "open"
      ? !validInvite(squad, req.body?.invite)
      : !isStrangerDiscoveryEnabled())
  ) {
    throw fail(404, "NOT_FOUND", "This group is unavailable.");
  }
  const id = getRequesterIdentity(req).userId;
  if ((squad.bannedMembers || []).some((member) => member.userId === id)) {
    throw fail(404, "NOT_FOUND", "This group is unavailable.");
  }
  if (
    await anyBlockedPair(
      [...squad.members.map((member) => member.userId), id],
      { User },
    )
  ) {
    throw fail(404, "NOT_FOUND", "This group is unavailable.");
  }
  const own = squad.members.find((member) => String(member.userId) === id),
    pending = (squad.joinRequests || []).some(
      (request) => String(request.userId) === id,
    );
  return res.json({
    ok: true,
    data: {
      ...(await metadata(squad)),
      viewerMembership: own
        ? own.role === "leader"
          ? "owner"
          : "member"
        : pending
          ? "pending"
          : "none",
    },
  });
});
// The shared dealer reloads, checks the raw invite and commits admission under
// one lock. Do not acquire this wrapper's lock before delegating.
const joinGroup = (req, res) => squadController.joinSquadHandler(req, res);
const updateGroup = handler(
  async (req, res, squad) => {
    const input = req.body || {};
    if (
      (input.identityMode !== undefined &&
        input.identityMode !== (squad.identityMode || "names")) ||
      (input.communicationMode !== undefined &&
        input.communicationMode !== (squad.communicationMode || "video"))
    ) {
      throw fail(
        400,
        "MODE_IMMUTABLE",
        "Create a new group to change its identity or call mode.",
      );
    }
    const settings = groupMetadata(input, true);
    if (settings.error) {
      throw fail(400, "INVALID_GROUP_SETTINGS", settings.error);
    }
    if (input.squadName !== undefined) {
      if (
        typeof input.squadName !== "string" ||
        input.squadName.trim().length < 2 ||
        input.squadName.trim().length > 32
      ) {
        throw fail(
          400,
          "INVALID_SQUAD_NAME",
          "Use a name from 2 to 32 characters.",
        );
      }
      squad.squadName = input.squadName.trim();
    }
    if (input.visibility !== undefined) {
      if (!["private", "open"].includes(input.visibility)) {
        throw fail(400, "INVALID_VISIBILITY", "Choose a valid visibility.");
      }
      if (input.visibility === "open" && !isStrangerDiscoveryEnabled()) {
        throw fail(503, "DISCOVERY_DISABLED", "Public groups are unavailable.");
      }
      if (
        squad.authorizedPrincipalPair?.length &&
        input.visibility !== "private"
      ) {
        throw fail(403, "PAIR_ONLY", "This conversation stays private.");
      }
      squad.visibility = input.visibility;
    }
    if (input.joinPolicy !== undefined) {
      if (!["open", "request", "invite"].includes(input.joinPolicy)) {
        throw fail(400, "INVALID_JOIN_POLICY", "Choose a valid join policy.");
      }
      if (
        squad.authorizedPrincipalPair?.length &&
        input.joinPolicy !== "invite"
      ) {
        throw fail(403, "PAIR_ONLY", "This conversation stays invite-only.");
      }
      squad.joinPolicy = input.joinPolicy;
    }
    Object.assign(squad, settings.value);
    await squad.save();
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
    return state(req, res, squad);
  },
  { leader: true, lock: true },
);
const groupInvite = handler(
  async (req, res, squad) => {
    if (!isMember(squad, req)) {
      throw fail(404, "NOT_FOUND", "This group is unavailable.");
    }
    if (
      req.body?.rotate !== undefined &&
      typeof req.body.rotate !== "boolean"
    ) {
      throw fail(400, "INVALID_REQUEST", "Rotate must be true or false.");
    }
    if (req.body?.rotate && !owner(squad, req)) {
      throw fail(
        403,
        "LEADER_ONLY",
        "Only the group owner can replace an invite.",
      );
    }
    if (!squad.groupInvite || req.body?.rotate) {
      squad.groupInvite = crypto.randomBytes(32).toString("hex");
      await squad.save();
    }
    return res.json({ ok: true, data: { invite: squad.groupInvite } });
  },
  { lock: true },
);
const groupBans = handler(
  async (req, res, squad) =>
    res.json({
      ok: true,
      data: {
        bans: (squad.bannedMembers || []).map((member) => ({
          memberId: publicMemberId(squad, member),
          displayName: aliasGroup(squad)
            ? groupAlias(member)
            : member.displayName || "Member",
          bannedAt: member.bannedAt,
          avatar: null,
        })),
      },
    }),
  { leader: true },
);
const banGroupMember = handler(
  async (req, res, squad) => {
    const target = resolveGroupMember(squad, req.params.memberId);
    if (!target) {
      const old = (squad.bannedMembers || []).find(
        (member) => publicMemberId(squad, member) === req.params.memberId,
      );
      if (old) {
        return res.json({ ok: true, data: { status: "banned" } });
      }
      throw fail(404, "NOT_FOUND", "That person is not in this group.");
    }
    if (target.role === "leader") {
      throw fail(
        409,
        "LEADER_CANNOT_BE_BANNED",
        "The group owner cannot be banned.",
      );
    }
    if (!squad.bannedMembers) {
      squad.bannedMembers = [];
    }
    if (
      !squad.bannedMembers.some(
        (member) => String(member.userId) === String(target.userId),
      )
    ) {
      squad.bannedMembers.push({
        memberId: target.memberId,
        userId: target.userId,
        displayName: target.displayName,
        alias: target.alias,
        bannedAt: new Date(),
      });
    }
    await squad.save();
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
    await removeSquadMember(squad, squad.members.indexOf(target));
    return res.json({ ok: true, data: { status: "banned" } });
  },
  { leader: true, lock: true },
);
const unbanGroupMember = handler(
  async (req, res, squad) => {
    const index = (squad.bannedMembers || []).findIndex(
      (member) => publicMemberId(squad, member) === req.params.memberId,
    );
    if (index < 0) {
      throw fail(404, "NOT_FOUND", "This ban is unavailable.");
    }
    squad.bannedMembers.splice(index, 1);
    await squad.save();
    return res.json({ ok: true, data: { status: "unbanned" } });
  },
  { leader: true, lock: true },
);
const cancelGroupJoin = handler(
  async (req, res, squad) => {
    const user = getRequesterIdentity(req).userId;
    squad.joinRequests = (squad.joinRequests || []).filter(
      (request) => String(request.userId) !== user,
    );
    await squad.save();
    await require("../models/Notification").deleteNotifications({
      squadId: squad.squadId,
      type: "join_request",
      fromUserId: user,
    });
    socketService.emitToSquad(squad.squadId, "SQUAD_UPDATED", {});
    return res.json({ ok: true, data: { status: "cancelled" } });
  },
  { lock: true },
);
const leaveGroup = handler(
  async (req, res, squad) => {
    const user = getRequesterIdentity(req).userId,
      index = squad.members.findIndex(
        (member) => String(member.userId) === user,
      );
    if (index < 0) {
      throw fail(404, "NOT_FOUND", "You are no longer in this group.");
    }
    const own = squad.members[index];
    if (own.role === "leader" && squad.members.length > 1) {
      const next = resolveGroupMember(squad, req.body?.transferToMemberId);
      if (!next || next === own) {
        throw fail(
          409,
          "OWNER_TRANSFER_REQUIRED",
          "Choose the next group owner before leaving.",
        );
      }
      own.role = "member";
      next.role = "leader";
      await squad.save();
    }
    await removeSquadMember(squad, index);
    return res.json({ ok: true, data: { status: "left" } });
  },
  { lock: true },
);
// The legacy endpoint now owns the fresh owner check and renewed lock too.
const deleteGroup = (req, res) => squadController.disbandSquadHandler(req, res);
module.exports = {
  previewGroup,
  joinGroup,
  updateGroup,
  groupInvite,
  groupBans,
  banGroupMember,
  unbanGroupMember,
  cancelGroupJoin,
  leaveGroup,
  deleteGroup,
  validInvite,
};
