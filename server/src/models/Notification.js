const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  // Recipient of the notification.
  userId: { type: String, required: true, index: true },
  type: {
    type: String,
    enum: ["friend_request", "squad_invite", "join_request", "squad_joined", "info"],
    required: true,
  },
  title: { type: String, trim: true, maxlength: 80 },
  body: { type: String, trim: true, maxlength: 180 },
  // Actor who triggered the notification (optional).
  fromUserId: { type: String },
  fromName: { type: String, trim: true, maxlength: 48 },
  // Squad context (present for squad_invite / join_request / squad_joined).
  squadId: { type: String },
  squadCode: { type: String },
  squadName: { type: String, trim: true, maxlength: 32 },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

notificationSchema.index({ userId: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);

const emitNotificationsChanged = (userIds) => {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  try {
    const { emitToUser } = require("../services/socketService");
    for (const userId of new Set(ids.filter(Boolean).map(String))) {
      emitToUser(userId, "notifications_changed");
    }
  } catch (err) {
    console.warn("[notification] change emit failed:", err.message);
  }
};

/**
 * Persist a notification and push it in real-time to the recipient's
 * per-user socket room. Returns the saved doc. Never throws — a failed
 * notification must not break the triggering action.
 */
const createNotification = async (fields) => {
  try {
    const doc = await Notification.create({
      userId: fields.userId,
      type: fields.type,
      title: fields.title,
      body: fields.body,
      fromUserId: fields.fromUserId,
      fromName: fields.fromName,
      squadId: fields.squadId,
      squadCode: fields.squadCode,
      squadName: fields.squadName,
    });

    // Lazy require to avoid a circular dependency (socketService -> models).
    try {
      const { emitToUser } = require("../services/socketService");
      emitToUser(String(fields.userId), "notification", toPublic(doc));
    } catch (emitErr) {
      console.warn("[notification] real-time emit failed:", emitErr.message);
    }

    return doc;
  } catch (err) {
    console.error("[notification] createNotification error:", err);
    return null;
  }
};

/** Delete notifications resolved by their source action. Never breaks that action. */
const deleteNotifications = async (filter, affectedUserIds) => {
  let userIds = affectedUserIds ?? (filter.userId ? [filter.userId] : []);
  if (!affectedUserIds && !filter.userId) {
    try {
      userIds = await Notification.distinct("userId", filter);
    } catch (err) {
      console.warn("[notification] recipient lookup failed:", err.message);
    }
  }
  try {
    const result = await Notification.deleteMany(filter);
    if (result.deletedCount) emitNotificationsChanged(userIds);
    return result;
  } catch (err) {
    console.error("[notification] deleteNotifications error:", err);
    return null;
  }
};

const deleteNotificationsBetweenUsers = (userId, otherUserIds, { session } = {}) => {
  const ids = [...new Set((otherUserIds || []).filter(Boolean).map(String))];
  return Notification.deleteMany(
    {
      $or: [
        { userId: String(userId), fromUserId: { $in: ids } },
        { userId: { $in: ids }, fromUserId: String(userId) },
      ],
    },
    { session }
  );
};

/** Shape a Notification doc into the client contract (id + fields). */
const toPublic = (n) => ({
  id: n._id.toString(),
  type: n.type,
  title: n.title || null,
  body: n.body || null,
  fromUserId: n.fromUserId || null,
  fromName: n.fromName || null,
  squadId: n.squadId || null,
  squadCode: n.squadCode || null,
  squadName: n.squadName || null,
  read: Boolean(n.read),
  createdAt: n.createdAt,
});

module.exports = {
  Notification,
  createNotification,
  deleteNotifications,
  deleteNotificationsBetweenUsers,
  emitNotificationsChanged,
  toPublic,
};
