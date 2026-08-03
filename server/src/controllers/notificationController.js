const { Notification, emitNotificationsChanged, toPublic } = require("../models/Notification");
const mongoose = require("mongoose");

const authedUserId = (req) => req.user?.userId || req.user?.sub;

const err = (res, status, code, message) =>
  res.status(status).json({ ok: false, error: { code, message } });

// ── GET /api/notifications ───────────────────────────────────────────────────
const listNotifications = async (req, res) => {
  try {
    const myId = authedUserId(req);
    const [docs, unread] = await Promise.all([
      Notification.find({ userId: myId }).sort({ createdAt: -1 }).limit(50).lean(),
      Notification.countDocuments({ userId: myId, read: false }),
    ]);

    return res.json({
      ok: true,
      data: { notifications: docs.map(toPublic), unread },
    });
  } catch (e) {
    console.error("[notifications] list error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to list notifications");
  }
};

// ── POST /api/notifications/read-all ─────────────────────────────────────────
const markAllRead = async (req, res) => {
  try {
    const myId = authedUserId(req);
    const result = await Notification.updateMany({ userId: myId, read: false }, { $set: { read: true } });
    if (result.modifiedCount) emitNotificationsChanged(myId);
    return res.json({ ok: true, data: { unread: 0 } });
  } catch (e) {
    console.error("[notifications] read-all error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to mark all read");
  }
};

// ── POST /api/notifications/:id/read ─────────────────────────────────────────
const markOneRead = async (req, res) => {
  try {
    const myId = authedUserId(req);
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return err(res, 400, "INVALID_REQUEST", "Valid notification id is required");
    }

    const result = await Notification.updateOne({ _id: id, userId: myId }, { $set: { read: true } });
    if (!result.matchedCount) {
      return err(res, 404, "NOT_FOUND", "Notification not found");
    }
    if (result.modifiedCount) emitNotificationsChanged(myId);
    const unread = await Notification.countDocuments({ userId: myId, read: false });
    return res.json({ ok: true, data: { unread } });
  } catch (e) {
    console.error("[notifications] read one error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to mark notification read");
  }
};

// ── DELETE /api/notifications/:id ────────────────────────────────────────────
const dismissNotification = async (req, res) => {
  try {
    const myId = authedUserId(req);
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return err(res, 400, "INVALID_REQUEST", "Valid notification id is required");
    }

    await Notification.deleteOne({ _id: id, userId: myId });
    emitNotificationsChanged(myId);
    const unread = await Notification.countDocuments({ userId: myId, read: false });
    return res.json({ ok: true, data: { dismissed: true, unread } });
  } catch (e) {
    console.error("[notifications] dismiss error:", e);
    return err(res, 500, "SERVER_ERROR", "Failed to dismiss notification");
  }
};

module.exports = { listNotifications, markAllRead, markOneRead, dismissNotification };
