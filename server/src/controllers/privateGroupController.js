const mongoose = require("mongoose");
const { Squad } = require("../models/Squad");
const User = require("../models/User");
const Request = require("../models/PrivateGroupRequest");
const { withMatchmakingLock } = require("../config/redisConfig");
const {
  createNotification,
  emitNotification,
} = require("../models/Notification");
const { getRequesterIdentity } = require("../app/squadAccess");
const {
  createPrivateGroupService,
} = require("../services/privateGroupService");
const service = createPrivateGroupService({
  Squad,
  User,
  Request,
  withLock: withMatchmakingLock,
  transaction: (fn) => mongoose.connection.transaction(fn),
  notify: createNotification,
});
const handle = (work) => async (req, res) => {
  try {
    const data = await work(req, getRequesterIdentity(req).userId);
    if (data.notification) {
      emitNotification(data.notification);
    }
    const { notification, ...publicData } = data;
    return res.json({ ok: true, data: publicData });
  } catch (error) {
    if (!error.status) {
      console.error("Private group request failed:", error);
    }
    return res.status(error.status || 503).json({
      ok: false,
      error: {
        code: error.code || "REQUEST_UNAVAILABLE",
        message: error.status
          ? error.message
          : "Private requests are temporarily unavailable.",
      },
    });
  }
};
module.exports = {
  requestPrivateGroup: handle((req, userId) =>
    service.request(req.params.squadId, userId, req.body?.memberId),
  ),
  listPrivateGroups: handle(async (req, userId) => ({
    requests: await service.list(req.params.squadId, userId),
  })),
  acceptPrivateGroup: handle((req, userId) =>
    service.respond(req.params.requestId, userId, "accept"),
  ),
  declinePrivateGroup: handle((req, userId) =>
    service.respond(req.params.requestId, userId, "decline"),
  ),
  cancelPrivateGroup: handle((req, userId) =>
    service.respond(req.params.requestId, userId, "cancel"),
  ),
};
