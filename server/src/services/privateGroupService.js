const crypto = require("crypto");
const { generateId, generateSquadCode } = require("../utils/idGenerator");
const { hasAdultAccess } = require("./ageAccessService");
const { anyBlockedPair } = require("./interactionSafetyService");
const {
  publicGroupMember,
  resolveGroupMember,
  aliasGroup,
  groupAlias,
  groupHandle,
} = require("./groupIdentityService");
const failure = (status, code, message) =>
  Object.assign(new Error(message), { status, code });
const REQUEST_MS = 10 * 60 * 1000;

// This uses the same distributed admission lock and Mongo transaction as other
// member actions, so double accepts cannot create two different private groups.
function createPrivateGroupService({
  Squad,
  User,
  Request,
  withLock,
  transaction,
  notify = async () => null,
  now = Date.now,
}) {
  const publicRequest = (row, squad, viewerId) => {
    const otherId = row.senderId === viewerId ? row.recipientId : row.senderId;
    const other = squad.members.find(
      (member) => String(member.userId) === otherId,
    );
    return {
      requestId: row.requestId,
      squadId: row.squadId,
      status: row.status,
      expiresAt: row.expiresAt,
      direction: row.senderId === viewerId ? "outgoing" : "incoming",
      communicationMode: squad.communicationMode || "video",
      identityMode: squad.identityMode || "names",
      member: other ? publicGroupMember(squad, other) : null,
      ...(row.status === "accepted"
        ? { resultSquadId: row.resultSquadId }
        : {}),
    };
  };
  async function access(squadId, userId, session) {
    const squad = await Squad.findOne({ squadId }, null, { session });
    if (
      !squad ||
      !squad.members.some((member) => String(member.userId) === userId)
    ) {
      throw failure(404, "NOT_FOUND", "This group is unavailable.");
    }
    return squad;
  }
  async function pairAccess(squad, senderId, recipientId, session) {
    const members = [senderId, recipientId].map((id) =>
      squad.members.find((member) => String(member.userId) === id),
    );
    if (members.some((member) => !member) || senderId === recipientId) {
      throw failure(
        404,
        "NOT_FOUND",
        "That person is no longer in this group.",
      );
    }
    const users = await User.find({ _id: { $in: [senderId, recipientId] } })
      .session(session)
      .lean();
    if (
      users.length !== 2 ||
      users.some((user) => !hasAdultAccess(user)) ||
      (await anyBlockedPair(
        squad.members.map((member) => member.userId),
        { User, session },
      ))
    ) {
      throw failure(
        403,
        "INTERACTION_BLOCKED",
        "This interaction is unavailable.",
      );
    }
    return members;
  }
  async function run(callback) {
    return withLock((signal) =>
      transaction(async (session) => {
        const result = await callback(session);
        if (signal?.aborted) {
          throw signal.error || failure(409, "TRY_AGAIN", "Try again.");
        }
        return result;
      }),
    );
  }
  return {
    async request(squadId, senderId, target) {
      return run(async (session) => {
        const squad = await access(squadId, senderId, session),
          recipient = resolveGroupMember(squad, target);
        if (!recipient) {
          throw failure(404, "NOT_FOUND", "That person is not in this group.");
        }
        const recipientId = String(recipient.userId);
        await pairAccess(squad, senderId, recipientId, session);
        const stamp = now(),
          expiry = new Date(stamp),
          pending = { status: "pending", expiresAt: { $gt: expiry } };
        const existing = await Request.findOne(
          { squadId, senderId, recipientId, ...pending },
          null,
          { session },
        );
        if (existing) {
          return { request: publicRequest(existing, squad, senderId) };
        }
        const [recent, outgoing, incoming] = await Promise.all([
          Request.countDocuments({
            senderId,
            createdAt: { $gt: new Date(stamp - 60_000) },
          }).session(session),
          Request.countDocuments({ senderId, ...pending }).session(session),
          Request.countDocuments({ recipientId, ...pending }).session(session),
        ]);
        if (recent >= 3 || outgoing >= 10 || incoming >= 10) {
          throw failure(
            429,
            "REQUEST_LIMIT",
            "There are too many private requests. Try again later.",
          );
        }
        const row = (
          await Request.create(
            [
              {
                requestId: crypto.randomBytes(18).toString("hex"),
                squadId,
                senderId,
                recipientId,
                status: "pending",
                createdAt: new Date(stamp),
                expiresAt: new Date(stamp + REQUEST_MS),
              },
            ],
            { session },
          )
        )[0];
        const sender = squad.members.find(
          (member) => String(member.userId) === senderId,
        );
        const notification = await notify(
          {
            userId: recipientId,
            type: "private_request",
            requestId: row.requestId,
            title: "Private conversation request",
            body: `${aliasGroup(squad) ? groupAlias(sender) : sender.displayName || "Someone"} wants a private conversation.`,
            fromUserId: senderId,
            fromName: aliasGroup(squad)
              ? groupAlias(sender)
              : sender.displayName,
            squadId,
            ...(aliasGroup(squad)
              ? {
                  publicFromId: groupHandle(squad, sender),
                  publicFromName: groupAlias(sender),
                }
              : {}),
          },
          { session, required: true, emit: false },
        );
        return { request: publicRequest(row, squad, senderId), notification };
      });
    },
    async list(squadId, userId) {
      const squad = await access(squadId, userId);
      const rows = await Request.find({
        squadId,
        expiresAt: { $gt: new Date(now()) },
        $or: [{ senderId: userId }, { recipientId: userId }],
      })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();
      return rows
        .filter(
          (row) =>
            squad.members.some(
              (member) => String(member.userId) === row.senderId,
            ) &&
            squad.members.some(
              (member) => String(member.userId) === row.recipientId,
            ),
        )
        .map((row) => publicRequest(row, squad, userId));
    },
    async respond(requestId, userId, action) {
      return run(async (session) => {
        const row = await Request.findOne({ requestId }, null, { session });
        const actor = action === "cancel" ? row?.senderId : row?.recipientId;
        if (
          !row ||
          actor !== userId ||
          new Date(row.expiresAt).getTime() <= now()
        ) {
          throw failure(
            404,
            "NOT_FOUND",
            "This request is no longer available.",
          );
        }
        const squad = await access(row.squadId, userId, session);
        const [sender, recipient] = await pairAccess(
          squad,
          row.senderId,
          row.recipientId,
          session,
        );
        if (row.status === "accepted" && action === "accept") {
          return { squadId: row.resultSquadId };
        }
        if (row.status !== "pending") {
          throw failure(
            409,
            "REQUEST_CLOSED",
            "This request has already ended.",
          );
        }
        if (action !== "accept") {
          row.status = action === "cancel" ? "cancelled" : "declined";
          await row.save({ session });
          return { status: row.status };
        }
        const squadId = generateId("sq");
        const members = [sender, recipient].map((member, index) => ({
          memberId: generateId("mem"),
          userId: String(member.userId),
          providerAccountId: member.providerAccountId || String(member.userId),
          displayName: aliasGroup(squad)
            ? groupAlias(member)
            : member.displayName,
          ...(aliasGroup(squad) ? { alias: groupAlias(member) } : {}),
          role: index === 0 ? "leader" : "member",
          ready: false,
          inLobbyVideo: false,
          inEncounterVideo: false,
          joinedAt: new Date(now()),
        }));
        await Squad.create(
          [
            {
              squadId,
              squadCode: generateSquadCode(),
              squadName: "Private conversation",
              identityMode: squad.identityMode || "names",
              communicationMode: squad.communicationMode || "video",
              visibility: "private",
              joinPolicy: "invite",
              managedGroup:
                squad.managedGroup ||
                squad.visibility === "open" ||
                aliasGroup(squad),
              authorizedPrincipalPair: [row.senderId, row.recipientId],
              members,
              status: "idle",
            },
          ],
          { session },
        );
        row.status = "accepted";
        row.resultSquadId = squadId;
        await row.save({ session });
        return { squadId };
      });
    },
  };
}
module.exports = { createPrivateGroupService, REQUEST_MS };
