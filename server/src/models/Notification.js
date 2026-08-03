const mongoose = require("mongoose");
const { relationalIdMatcher } = require("../services/interactionSafetyService");

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

const emitNotification = (doc) => {
  try {
    const { emitToUser } = require("../services/socketService");
    emitToUser(String(doc.userId), "notification", toPublic(doc));
  } catch (err) {
    console.warn("[notification] real-time emit failed:", err.message);
  }
};

/**
 * Persist a notification and push it in real-time to the recipient's
 * per-user socket room. Returns the saved doc. Transactional callers can mark
 * persistence as required so their surrounding action rolls back on failure.
 */
const createNotification = async (fields, { session, required = false, emit = true } = {}) => {
  try {
    const payload = {
      userId: fields.userId,
      type: fields.type,
      title: fields.title,
      body: fields.body,
      fromUserId: fields.fromUserId,
      fromName: fields.fromName,
      squadId: fields.squadId,
      squadCode: fields.squadCode,
      squadName: fields.squadName,
    };
    const doc = session
      ? (await Notification.create([payload], { session }))[0]
      : await Notification.create(payload);

    if (emit) emitNotification(doc);

    return doc;
  } catch (err) {
    console.error("[notification] createNotification error:", err);
    if (required || session) throw err;
    return null;
  }
};

/** Delete resolved notifications; transactional callers can require rollback on failure. */
const deleteNotifications = async (
  filter,
  affectedUserIds,
  { session, required = false, emit = true } = {}
) => {
  let userIds = affectedUserIds ?? (filter.userId ? [filter.userId] : []);
  if (!affectedUserIds && !filter.userId) {
    try {
      userIds = await Notification.distinct("userId", filter);
    } catch (err) {
      console.warn("[notification] recipient lookup failed:", err.message);
    }
  }
  try {
    const result = session
      ? await Notification.deleteMany(filter, { session })
      : await Notification.deleteMany(filter);
    if (emit && result.deletedCount) emitNotificationsChanged(userIds);
    return result;
  } catch (err) {
    console.error("[notification] deleteNotifications error:", err);
    if (required || session) throw err;
    return null;
  }
};

const deleteNotificationsBetweenUsers = (userId, otherUserIds, { session } = {}) => {
  const userMatcher = relationalIdMatcher(userId);
  const idMatchers = (otherUserIds || []).map(relationalIdMatcher).filter(Boolean);
  return Notification.deleteMany(
    {
      $or: [
        { userId: userMatcher, fromUserId: { $in: idMatchers } },
        { userId: { $in: idMatchers }, fromUserId: userMatcher },
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
  emitNotification,
  emitNotificationsChanged,
  toPublic,
};
