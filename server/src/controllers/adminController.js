const User = require("../models/User");
const { getRequesterIdentity } = require("../app/squadAccess");
const { isMongoObjectIdString } = require("../middlewares/authMiddleware");

const normalizeAdminEmail = (email) => String(email || "").trim().toLowerCase();

const getConfiguredAdminEmail = () => normalizeAdminEmail(process.env.ADMIN_EMAIL);

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
    const users = await User.find({ isApproved: false }).sort({ createdAt: -1 });
    return res.json({ ok: true, data: users });
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
    const user = await User.findByIdAndUpdate(userId, { isApproved: true }, { new: true });
    if (!user) {
      return res.status(404).json({
        ok: false,
        error: { code: "USER_NOT_FOUND", message: "User not found" },
      });
    }
    return res.json({ ok: true, data: user });
  } catch (error) {
    return res.status(500).json({ ok: false, error: { message: error.message } });
  }
};

module.exports = {
  requireAdmin,
  getPendingUsersHandler,
  approveUserHandler,
  normalizeAdminEmail,
};
