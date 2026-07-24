const mongoose = require("mongoose");
const User = require("../models/User");
const { getOnlineUserIds } = require("../services/socketService");
const { createNotification } = require("../models/Notification");
const { firstDisplayName } = require("../utils/identityValidation");

// ── helpers ──────────────────────────────────────────────────────────────
const authedUserId = (req) => req.user?.userId || req.user?.sub;

const isValidId = (id) =>
  typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
const toIdString = (id) => {
  if (!id) return "";
  if (typeof id === "string") return id;
  if (typeof id.toString === "function") return id.toString();
  return "";
};
const hasId = (ids = [], id) => ids.some((value) => toIdString(value) === id);

/** Shape a User doc into the public friend/presence projection. */
const toPublic = (u, onlineSet) => ({
  userId: u._id.toString(),
  name: u.name || null,
  image: u.image || null,
  online: onlineSet ? onlineSet.has(u._id.toString()) : false,
});

const err = (res, status, code, message) =>
  res.status(status).json({ ok: false, error: { code, message } });

// ── GET /api/friends ───────────────────────────────────────────────────────
const listFriends = async (req, res) => {
  try {
    const me = await User.findById(authedUserId(req)).lean();
    if (!me) return err(res, 404, "NOT_FOUND", "User not found");

    const ids = me.friends || [];
    const docs = ids.length
      ? await User.find({ _id: { $in: ids } }, "name image").lean()
      : [];
    const onlineSet = await getOnlineUserIds(docs.map((d) => d._id.toString()));

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

    const incomingIds = me.friendRequestsIncoming || [];
    const outgoingIds = me.friendRequestsOutgoing || [];
    const allIds = [...new Set([...incomingIds, ...outgoingIds])];

    const docs = allIds.length
      ? await User.find({ _id: { $in: allIds } }, "name image").lean()
      : [];
    const byId = new Map(docs.map((d) => [d._id.toString(), d]));
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
        userId: d._id.toString(),
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
    const targetId = req.body?.userId;

    if (!isValidId(targetId)) return err(res, 400, "INVALID_REQUEST", "Valid userId is required");
    if (targetId === myId) return err(res, 400, "INVALID_REQUEST", "Cannot friend yourself");

    const target = await User.findById(targetId, "friends friendRequestsIncoming friendRequestsOutgoing").lean();
    if (!target) return err(res, 404, "NOT_FOUND", "Target user not found");

    const me = await User.findById(myId, "friends friendRequestsOutgoing").lean();
    if (!me) return err(res, 404, "NOT_FOUND", "User not found");

    if (hasId(me.friends, targetId)) {
      return res.json({ ok: true, data: { status: "friends" } });
    }
    if (hasId(me.friendRequestsOutgoing, targetId)) {
      return res.json({ ok: true, data: { status: "requested" } });
    }
    if (hasId(target.friendRequestsIncoming, myId)) {
      return res.json({ ok: true, data: { status: "requested" } });
    }

    // Reciprocal request already pending → auto-accept into friends.
    const reciprocal = hasId(target.friendRequestsOutgoing, myId);
    if (reciprocal) {
      await Promise.all([
        User.updateOne(
          { _id: myId },
          {
            $addToSet: { friends: targetId },
            $pull: { friendRequestsIncoming: targetId, friendRequestsOutgoing: targetId },
          }
        ),
        User.updateOne(
          { _id: targetId },
          {
            $addToSet: { friends: myId },
            $pull: { friendRequestsIncoming: myId, friendRequestsOutgoing: myId },
          }
        ),
      ]);
      return res.json({ ok: true, data: { status: "friends" } });
    }

    // Standard request: add to my outgoing + their incoming.
    await Promise.all([
      User.updateOne({ _id: myId }, { $addToSet: { friendRequestsOutgoing: targetId } }),
      User.updateOne({ _id: targetId }, { $addToSet: { friendRequestsIncoming: myId } }),
    ]);

    const senderName = firstDisplayName(req.user?.name, req.user?.email);
    await createNotification({
      userId: targetId,
      type: "friend_request",
      title: "New friend request",
      body: `${senderName || "Someone"} wants to be friends`,
      fromUserId: myId,
      fromName: senderName,
    });

    return res.json({ ok: true, data: { status: "requested" } });
  } catch (e) {
    console.error("[friends] sendRequest error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to send friend request");
  }
};

// ── POST /api/friends/accept { userId } ──────────────────────────────────────
const acceptRequest = async (req, res) => {
  try {
    const myId = authedUserId(req);
    const targetId = req.body?.userId;
    if (!isValidId(targetId)) return err(res, 400, "INVALID_REQUEST", "Valid userId is required");

    const me = await User.findById(myId, "friendRequestsIncoming").lean();
    if (!me) return err(res, 404, "NOT_FOUND", "User not found");

    if (!hasId(me.friendRequestsIncoming, targetId)) {
      return err(res, 400, "NO_REQUEST", "No incoming friend request from this user");
    }

    const target = await User.findById(targetId, "_id").lean();
    if (!target) return err(res, 404, "NOT_FOUND", "Target user not found");

    await Promise.all([
      User.updateOne(
        { _id: myId },
        {
          $addToSet: { friends: targetId },
          $pull: { friendRequestsIncoming: targetId, friendRequestsOutgoing: targetId },
        }
      ),
      User.updateOne(
        { _id: targetId },
        {
          $addToSet: { friends: myId },
          $pull: { friendRequestsIncoming: myId, friendRequestsOutgoing: myId },
        }
      ),
    ]);
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
    const targetId = req.body?.userId;
    if (!isValidId(targetId)) return err(res, 400, "INVALID_REQUEST", "Valid userId is required");

    const me = await User.findById(myId, "friendRequestsIncoming").lean();
    if (!me) return err(res, 404, "NOT_FOUND", "User not found");
    if (!hasId(me.friendRequestsIncoming, targetId)) {
      return err(res, 400, "NO_REQUEST", "No incoming friend request from this user");
    }

    const target = await User.findById(targetId, "_id").lean();
    if (!target) return err(res, 404, "NOT_FOUND", "Target user not found");

    await Promise.all([
      User.updateOne({ _id: myId }, { $pull: { friendRequestsIncoming: targetId } }),
      User.updateOne({ _id: targetId }, { $pull: { friendRequestsOutgoing: myId } }),
    ]);
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
    const targetId = req.body?.userId;
    if (!isValidId(targetId)) return err(res, 400, "INVALID_REQUEST", "Valid userId is required");

    const me = await User.findById(myId, "friends").lean();
    if (!me) return err(res, 404, "NOT_FOUND", "User not found");
    if (!hasId(me.friends, targetId)) {
      return err(res, 400, "NOT_FRIENDS", "Users are not friends");
    }

    const target = await User.findById(targetId, "_id").lean();
    if (!target) return err(res, 404, "NOT_FOUND", "Target user not found");

    await Promise.all([
      User.updateOne({ _id: myId }, { $pull: { friends: targetId } }),
      User.updateOne({ _id: targetId }, { $pull: { friends: myId } }),
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

    const exclude = [myId, ...(me.friends || [])].map(toIdString).filter(isValidId);
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

    const onlineSet = await getOnlineUserIds(docs.map((d) => d._id.toString()));
    return res.json({
      ok: true,
      data: { users: docs.map((d) => toPublic(d, onlineSet)) },
    });
  } catch (e) {
    console.error("[friends] searchUsers error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to search users");
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
  isValidId,
};
