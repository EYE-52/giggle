const mongoose = require("mongoose");
const User = require("../models/User");
const { getOnlineUserIds } = require("../services/socketService");
const {
  createNotification,
  deleteNotifications,
  deleteNotificationsBetweenUsers,
  emitNotification,
  emitNotificationsChanged,
} = require("../models/Notification");
const { firstDisplayName } = require("../utils/identityValidation");
const { removeBlockedIdentityFromSharedSquads } = require("../app/squadAccess");
const {
  canonicalUserId,
  relationalIdMatcher,
  hasBlockedPair,
  filterBlockedCandidates,
} = require("../services/interactionSafetyService");

// ── helpers ──────────────────────────────────────────────────────────────
const authedUserId = (req) => canonicalUserId(req.user?.userId || req.user?.sub);

const isValidId = (id) => typeof id === "string" && Boolean(canonicalUserId(id));
const toIdString = canonicalUserId;
const hasId = (ids = [], id) => ids.some((value) => toIdString(value) === id);
const pullMatchers = (ids) => ids.map(relationalIdMatcher).filter(Boolean);
const friendRequestNotificationFilter = (userId, fromUserId) => ({
  userId: relationalIdMatcher(userId),
  type: "friend_request",
  fromUserId: relationalIdMatcher(fromUserId),
});

/** Shape a User doc into the public friend/presence projection. */
const toPublic = (u, onlineSet) => ({
  userId: canonicalUserId(u._id),
  name: u.name || null,
  image: u.image || null,
  online: onlineSet ? onlineSet.has(canonicalUserId(u._id)) : false,
});

const err = (res, status, code, message) =>
  res.status(status).json({ ok: false, error: { code, message } });

// ── GET /api/friends ───────────────────────────────────────────────────────
const listFriends = async (req, res) => {
  try {
    const me = await User.findById(authedUserId(req)).lean();
    if (!me) return err(res, 404, "NOT_FOUND", "User not found");

    const ids = await filterBlockedCandidates(authedUserId(req), me.friends || [], { User });
    const docs = ids.length
      ? await User.find({ _id: { $in: ids } }, "name image").lean()
      : [];
    const onlineSet = await getOnlineUserIds(docs.map((d) => canonicalUserId(d._id)));

    return res.json({
      ok: true,
      data: { friends: docs.map((d) => toPublic(d, onlineSet)) },
    });
  } catch (e) {
    console.error("[friends] listFriends error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to list friends");
  }
};

// ── GET /api/friends/requests ────────────────────────────────────────────────
const listRequests = async (req, res) => {
  try {
    const me = await User.findById(authedUserId(req)).lean();
    if (!me) return err(res, 404, "NOT_FOUND", "User not found");

    const allIds = await filterBlockedCandidates(
      authedUserId(req),
      [...(me.friendRequestsIncoming || []), ...(me.friendRequestsOutgoing || [])],
      { User }
    );
    const allowed = new Set(allIds.map(toIdString));
    const incomingIds = [...new Set(
      (me.friendRequestsIncoming || []).map(toIdString).filter((id) => allowed.has(id))
    )];
    const outgoingIds = [...new Set(
      (me.friendRequestsOutgoing || []).map(toIdString).filter((id) => allowed.has(id))
    )];

    const docs = allIds.length
      ? await User.find({ _id: { $in: allIds } }, "name image").lean()
      : [];
    const byId = new Map(docs.map((d) => [canonicalUserId(d._id), d]));
    const onlineSet = await getOnlineUserIds(allIds);

    const incoming = incomingIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((d) => toPublic(d, onlineSet));
    // outgoing intentionally omits `online` per contract (still harmless if present)
    const outgoing = outgoingIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((d) => ({
        userId: canonicalUserId(d._id),
        name: d.name || null,
        image: d.image || null,
      }));

    return res.json({ ok: true, data: { incoming, outgoing } });
  } catch (e) {
    console.error("[friends] listRequests error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to list requests");
  }
};

// ── POST /api/friends/request { userId } ─────────────────────────────────────
const sendRequest = async (req, res) => {
  try {
    const myId = authedUserId(req);
    const rawTargetId = req.body?.userId;

    if (!isValidId(rawTargetId)) return err(res, 400, "INVALID_REQUEST", "Valid userId is required");
    const targetId = canonicalUserId(rawTargetId);
    if (targetId === myId) return err(res, 400, "INVALID_REQUEST", "Cannot friend yourself");
    const senderName = firstDisplayName(req.user?.name, req.user?.email);
    const result = await mongoose.connection.transaction(async (session) => {
      const target = await User.findById(
        targetId,
        "friends friendRequestsIncoming friendRequestsOutgoing blockedUserIds",
        { session }
      ).lean();
      if (!target) return { error: [404, "NOT_FOUND", "Target user not found"] };

      const me = await User.findById(
        myId,
        "friends friendRequestsOutgoing blockedUserIds",
        { session }
      ).lean();
      if (!me) return { error: [404, "NOT_FOUND", "User not found"] };
      if (hasBlockedPair(me, target)) {
        return {
          error: [403, "INTERACTION_BLOCKED", "Friend requests are unavailable for this account"],
        };
      }

      if (hasId(me.friends, targetId)) return { status: "friends" };
      if (hasId(me.friendRequestsOutgoing, targetId)) return { status: "requested" };
      if (hasId(target.friendRequestsIncoming, myId)) return { status: "requested" };

      const targetIds = relationalIdMatcher(targetId);
      const myIds = relationalIdMatcher(myId);
      if (hasId(target.friendRequestsOutgoing, myId)) {
        await User.updateOne(
          { _id: myId },
          {
            $addToSet: { friends: targetId },
            $pull: { friendRequestsIncoming: targetIds, friendRequestsOutgoing: targetIds },
          },
          { session }
        );
        await User.updateOne(
          { _id: targetId },
          {
            $addToSet: { friends: myId },
            $pull: { friendRequestsIncoming: myIds, friendRequestsOutgoing: myIds },
          },
          { session }
        );
        await deleteNotifications(
          friendRequestNotificationFilter(myId, targetId),
          [myId],
          { session, required: true, emit: false }
        );
        return { status: "friends", notificationsChanged: [myId] };
      }

      await User.updateOne(
        { _id: myId },
        { $addToSet: { friendRequestsOutgoing: targetId } },
        { session }
      );
      await User.updateOne(
        { _id: targetId },
        { $addToSet: { friendRequestsIncoming: myId } },
        { session }
      );
      const notification = await createNotification({
        userId: targetId,
        type: "friend_request",
        title: "New friend request",
        body: `${senderName || "Someone"} wants to be friends`,
        fromUserId: myId,
        fromName: senderName,
      }, { session, required: true, emit: false });
      return { status: "requested", notification };
    });

    if (result.error) return err(res, ...result.error);
    if (result.notification) emitNotification(result.notification);
    if (result.notificationsChanged) emitNotificationsChanged(result.notificationsChanged);
    return res.json({ ok: true, data: { status: result.status } });
  } catch (e) {
    console.error("[friends] sendRequest error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to send friend request");
  }
};

// ── POST /api/friends/accept { userId } ──────────────────────────────────────
const acceptRequest = async (req, res) => {
  try {
    const myId = authedUserId(req);
    const rawTargetId = req.body?.userId;
    if (!isValidId(rawTargetId)) return err(res, 400, "INVALID_REQUEST", "Valid userId is required");
    const targetId = canonicalUserId(rawTargetId);

    const result = await mongoose.connection.transaction(async (session) => {
      const me = await User.findById(
        myId,
        "friendRequestsIncoming blockedUserIds",
        { session }
      ).lean();
      if (!me) return { error: [404, "NOT_FOUND", "User not found"] };

      if (!hasId(me.friendRequestsIncoming, targetId)) {
        return { error: [400, "NO_REQUEST", "No incoming friend request from this user"] };
      }

      const target = await User.findById(targetId, "_id blockedUserIds", { session }).lean();
      if (!target) return { error: [404, "NOT_FOUND", "Target user not found"] };
      if (hasBlockedPair(me, target)) {
        return {
          error: [403, "INTERACTION_BLOCKED", "Friend requests are unavailable for this account"],
        };
      }

      const targetIdMatcher = relationalIdMatcher(targetId);
      const myIdMatcher = relationalIdMatcher(myId);
      await User.updateOne(
        { _id: myId },
        {
          $addToSet: { friends: targetId },
          $pull: {
            friendRequestsIncoming: targetIdMatcher,
            friendRequestsOutgoing: targetIdMatcher,
          },
        },
        { session }
      );
      await User.updateOne(
        { _id: targetId },
        {
          $addToSet: { friends: myId },
          $pull: { friendRequestsIncoming: myIdMatcher, friendRequestsOutgoing: myIdMatcher },
        },
        { session }
      );
      await deleteNotifications(
        friendRequestNotificationFilter(myId, targetId),
        [myId],
        { session, required: true, emit: false }
      );
      return { status: "friends" };
    });

    if (result.error) return err(res, ...result.error);
    emitNotificationsChanged([myId]);
    return res.json({ ok: true, data: { status: "friends" } });
  } catch (e) {
    console.error("[friends] acceptRequest error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to accept friend request");
  }
};

// ── POST /api/friends/decline { userId } ─────────────────────────────────────
const declineRequest = async (req, res) => {
  try {
    const myId = authedUserId(req);
    const rawTargetId = req.body?.userId;
    if (!isValidId(rawTargetId)) return err(res, 400, "INVALID_REQUEST", "Valid userId is required");
    const targetId = canonicalUserId(rawTargetId);

    const me = await User.findById(myId, "friendRequestsIncoming").lean();
    if (!me) return err(res, 404, "NOT_FOUND", "User not found");
    if (!hasId(me.friendRequestsIncoming, targetId)) {
      return err(res, 400, "NO_REQUEST", "No incoming friend request from this user");
    }

    const target = await User.findById(targetId, "_id").lean();
    if (!target) return err(res, 404, "NOT_FOUND", "Target user not found");

    const targetIdMatcher = relationalIdMatcher(targetId);
    const myIdMatcher = relationalIdMatcher(myId);
    await Promise.all([
      User.updateOne({ _id: myId }, { $pull: { friendRequestsIncoming: targetIdMatcher } }),
      User.updateOne({ _id: targetId }, { $pull: { friendRequestsOutgoing: myIdMatcher } }),
    ]);
    await deleteNotifications(friendRequestNotificationFilter(myId, targetId), [myId]);
    return res.json({ ok: true, data: { status: "declined" } });
  } catch (e) {
    console.error("[friends] declineRequest error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to decline friend request");
  }
};

// ── POST /api/friends/remove { userId } ──────────────────────────────────────
const removeFriend = async (req, res) => {
  try {
    const myId = authedUserId(req);
    const rawTargetId = req.body?.userId;
    if (!isValidId(rawTargetId)) return err(res, 400, "INVALID_REQUEST", "Valid userId is required");
    const targetId = canonicalUserId(rawTargetId);

    const me = await User.findById(myId, "friends").lean();
    if (!me) return err(res, 404, "NOT_FOUND", "User not found");
    if (!hasId(me.friends, targetId)) {
      return err(res, 400, "NOT_FRIENDS", "Users are not friends");
    }

    const target = await User.findById(targetId, "_id").lean();
    if (!target) return err(res, 404, "NOT_FOUND", "Target user not found");

    const targetIdMatcher = relationalIdMatcher(targetId);
    const myIdMatcher = relationalIdMatcher(myId);
    await Promise.all([
      User.updateOne({ _id: myId }, { $pull: { friends: targetIdMatcher } }),
      User.updateOne({ _id: targetId }, { $pull: { friends: myIdMatcher } }),
    ]);
    return res.json({ ok: true, data: { status: "removed" } });
  } catch (e) {
    console.error("[friends] removeFriend error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to remove friend");
  }
};

// ── GET /api/users/search?q= ─────────────────────────────────────────────────
const searchUsers = async (req, res) => {
  try {
    const myId = authedUserId(req);
    const q = (req.query?.q || "").toString().trim();
    if (q.length < 2) {
      return err(res, 400, "INVALID_REQUEST", "Query must be at least 2 characters");
    }
    if (q.length > 64) {
      return err(res, 400, "INVALID_REQUEST", "Query must be 64 characters or fewer");
    }

    const me = await User.findById(myId, "friends").lean();
    if (!me) return err(res, 404, "NOT_FOUND", "User not found");

    const exclude = [...new Set([myId, ...(me.friends || [])].map(toIdString).filter(Boolean))];
    // Case-insensitive substring (prefix included) match on name.
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const docs = await User.find(
      {
        _id: { $nin: exclude },
        name: { $regex: escaped, $options: "i" },
      },
      "name image"
    )
      .limit(20)
      .lean();

    const allowedIds = new Set(await filterBlockedCandidates(myId, docs.map((d) => d._id), { User }));
    const visibleDocs = docs.filter((doc) => allowedIds.has(canonicalUserId(doc._id)));
    const onlineSet = await getOnlineUserIds(visibleDocs.map((d) => canonicalUserId(d._id)));
    return res.json({
      ok: true,
      data: { users: visibleDocs.map((d) => toPublic(d, onlineSet)) },
    });
  } catch (e) {
    console.error("[friends] searchUsers error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to search users");
  }
};

const normalizeBlockTargets = (value, myId) => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  if (!value.every(isValidId)) return null;
  const ids = value.map(canonicalUserId);
  if (new Set(ids).size !== ids.length || ids.includes(myId)) return null;
  return ids;
};

// ── POST /api/users/block { userIds } ───────────────────────────────────────
const blockUsers = async (req, res) => {
  const myId = authedUserId(req);
  const userIds = normalizeBlockTargets(req.body?.userIds, myId);
  if (!userIds) return err(res, 400, "INVALID_REQUEST", "Provide 1 to 8 unique valid account ids");

  try {
    const targets = await User.find({ _id: { $in: userIds } }, "_id").lean();
    if (targets.length !== userIds.length) {
      return err(res, 404, "NOT_FOUND", "One or more accounts were not found");
    }

    await mongoose.connection.transaction(async (session) => {
      const targetIdMatchers = { $in: pullMatchers(userIds) };
      const myIdMatcher = relationalIdMatcher(myId);
      await User.updateOne(
        { _id: myId },
        {
          $addToSet: { blockedUserIds: { $each: userIds } },
          $pull: {
            friends: targetIdMatchers,
            friendRequestsIncoming: targetIdMatchers,
            friendRequestsOutgoing: targetIdMatchers,
          },
        },
        { session }
      );
      await User.updateMany(
        { _id: { $in: userIds } },
        {
          $pull: {
            friends: myIdMatcher,
            friendRequestsIncoming: myIdMatcher,
            friendRequestsOutgoing: myIdMatcher,
          },
        },
        { session }
      );
      await deleteNotificationsBetweenUsers(myId, userIds, { session });
    });
    await removeBlockedIdentityFromSharedSquads({ blockerId: myId, blockedUserIds: userIds });
    emitNotificationsChanged([myId, ...userIds]);
    return res.json({ ok: true, data: { status: "blocked", userIds } });
  } catch (e) {
    console.error("[friends] blockUsers error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to block accounts");
  }
};

// ── DELETE /api/users/:userId/block ─────────────────────────────────────────
const unblockUser = async (req, res) => {
  const myId = authedUserId(req);
  const rawUserId = req.params?.userId;
  if (!isValidId(rawUserId)) {
    return err(res, 400, "INVALID_REQUEST", "A valid account id is required");
  }
  const userId = canonicalUserId(rawUserId);
  if (userId === myId) {
    return err(res, 400, "INVALID_REQUEST", "A valid account id is required");
  }

  try {
    const target = await User.findById(userId, "_id").lean();
    if (!target) return err(res, 404, "NOT_FOUND", "Account not found");
    await User.updateOne(
      { _id: myId },
      { $pull: { blockedUserIds: relationalIdMatcher(userId) } }
    );
    return res.json({ ok: true, data: { status: "unblocked", userId } });
  } catch (e) {
    console.error("[friends] unblockUser error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to unblock account");
  }
};

// ── GET /api/me/blocks ──────────────────────────────────────────────────────
const listBlockedUsers = async (req, res) => {
  try {
    const me = await User.findById(authedUserId(req), "blockedUserIds").lean();
    if (!me) return err(res, 404, "NOT_FOUND", "User not found");
    const ids = [...new Set((me.blockedUserIds || []).map(toIdString).filter(Boolean))];
    const docs = ids.length
      ? await User.find({ _id: { $in: ids } }, "name image").lean()
      : [];
    return res.json({
      ok: true,
      data: {
        accounts: docs.map((user) => ({
          userId: canonicalUserId(user._id),
          name: user.name || null,
          image: user.image || null,
        })),
      },
    });
  } catch (e) {
    console.error("[friends] listBlockedUsers error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to list blocked accounts");
  }
};

module.exports = {
  listFriends,
  listRequests,
  sendRequest,
  acceptRequest,
  declineRequest,
  removeFriend,
  searchUsers,
  blockUsers,
  unblockUser,
  listBlockedUsers,
  isValidId,
};
