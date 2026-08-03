const User = require("../models/User");
const { getRequesterIdentity } = require("../app/squadAccess");
const { isMongoObjectIdString } = require("../middlewares/authMiddleware");
const socketService = require("../services/socketService");

const normalizeAdminEmail = (email) => String(email || "").trim().toLowerCase();

const getConfiguredAdminEmail = () => normalizeAdminEmail(process.env.ADMIN_EMAIL);

const ADMIN_USER_FIELDS =
  "_id email name image isApproved ageConfirmed isAdult ageVerified ageVerification.status isSuspended isShadowBanned deletionStatus createdAt";

const toAdminUser = (user) => ({
  id: String(user._id ?? user.id),
  email: user.email,
  name: user.name,
  image: user.image ?? null,
  isApproved: user.isApproved === true,
  ageConfirmed: user.ageConfirmed === true,
  isAdult: user.isAdult === true,
  ageVerified: user.ageVerified === true,
  verificationStatus:
    user.ageVerification?.status ?? (user.ageVerified === true ? "verified" : "not_started"),
  isSuspended: user.isSuspended === true,
  isShadowBanned: user.isShadowBanned === true,
  deletionStatus: user.deletionStatus === "pending" ? "pending" : "active",
  createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
});

/**
 * Middleware to restrict access to the configured admin email.
 */
const requireAdmin = (req, res, next) => {
  const identity = getRequesterIdentity(req);
  const adminEmail = getConfiguredAdminEmail();

  if (!adminEmail) {
    return res.status(403).json({
      ok: false,
      error: { code: "ADMIN_NOT_CONFIGURED", message: "Admin access is not configured" },
    });
  }

  if (normalizeAdminEmail(identity.email) !== adminEmail) {
    return res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN", message: "Admin access required" },
    });
  }
  next();
};

const getPendingUsersHandler = async (req, res) => {
  try {
    const users = await User.find({ isApproved: false }, ADMIN_USER_FIELDS).sort({ createdAt: -1 });
    return res.json({ ok: true, data: users.map(toAdminUser) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: { message: error.message } });
  }
};

const approveUserHandler = async (req, res) => {
  const { userId } = req.params;
  if (!isMongoObjectIdString(userId)) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "A valid userId is required" },
    });
  }

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { isApproved: true },
      { new: true, select: ADMIN_USER_FIELDS }
    );
    if (!user) {
      return res.status(404).json({
        ok: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }
    return res.json({ ok: true, data: toAdminUser(user) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: { message: error.message } });
  }
};

const updateUserAccessHandler = async (req, res) => {
  const { userId } = req.params;
  const body = req.body;
  const keys = body && !Array.isArray(body) && typeof body === "object"
    ? Object.keys(body)
    : [];
  const allowedKeys = new Set(["suspended", "shadowBanned"]);

  if (
    !isMongoObjectIdString(userId) ||
    keys.length === 0 ||
    keys.some((key) => !allowedKeys.has(key)) ||
    keys.some((key) => typeof body[key] !== "boolean")
  ) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "A valid boolean access update is required" },
    });
  }

  const changes = {};
  if (body.suspended !== undefined) {
    changes.isSuspended = body.suspended;
    changes.suspendedAt = body.suspended ? new Date() : null;
  }
  if (body.shadowBanned !== undefined) changes.isShadowBanned = body.shadowBanned;

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: changes },
      { new: true, select: ADMIN_USER_FIELDS }
    );
    if (!user) {
      return res.status(404).json({
        ok: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }
    if (body.suspended === true || body.shadowBanned === true) {
      socketService.disconnectUserSockets(userId);
    }
    return res.json({ ok: true, data: toAdminUser(user) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: { message: error.message } });
  }
};

module.exports = {
  requireAdmin,
  getPendingUsersHandler,
  approveUserHandler,
  updateUserAccessHandler,
  normalizeAdminEmail,
};
