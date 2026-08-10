const User = require("../models/User");
const SafetyReport = require("../models/SafetyReport");
const { getRequesterIdentity } = require("../app/squadAccess");
const { isMongoObjectIdString } = require("../middlewares/authMiddleware");
const socketService = require("../services/socketService");

const normalizeAdminEmail = (email) => String(email || "").trim().toLowerCase();

const getConfiguredAdminEmail = () => normalizeAdminEmail(process.env.ADMIN_EMAIL);

const ADMIN_USER_FIELDS =
  "_id email name image isApproved ageConfirmed isAdult ageVerified ageVerification.status isSuspended isShadowBanned deletionStatus createdAt";
const ADMIN_REPORT_FIELDS =
  "_id reporterUserId reporterSquadId targetSquadId targetUserIds encounterId category details status reviewedBy reviewedAt actionNote createdAt updatedAt";
const REPORT_STATUSES = new Set(["open", "reviewing", "actioned", "dismissed"]);

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

const toISOString = (value) => value instanceof Date ? value.toISOString() : value ?? null;

const toAdminIdentity = (userId, usersById) => {
  const user = usersById.get(String(userId));
  return {
    userId: String(userId),
    name: user?.name ?? null,
    email: user?.email ?? null,
  };
};

const loadAdminReportIdentities = async (reports) => {
  const ids = [...new Set(reports.flatMap((report) => [
    report.reporterUserId,
    ...(report.targetUserIds || []),
  ]).map(String))];
  const users = ids.length > 0
    ? await User.find({ _id: { $in: ids } }, "_id name email")
    : [];
  return new Map(users.map((user) => [String(user._id ?? user.id), user]));
};

const toAdminReport = (report, usersById) => ({
  id: String(report._id ?? report.id),
  reporterUserId: String(report.reporterUserId),
  reporterSquadId: report.reporterSquadId,
  targetSquadId: report.targetSquadId,
  targetUserIds: (report.targetUserIds || []).map(String),
  encounterId: report.encounterId,
  category: report.category,
  details: report.details || "",
  status: report.status,
  reviewedBy: report.reviewedBy ? String(report.reviewedBy) : null,
  reviewedAt: toISOString(report.reviewedAt),
  actionNote: report.actionNote || "",
  createdAt: toISOString(report.createdAt),
  updatedAt: toISOString(report.updatedAt),
  reporter: toAdminIdentity(report.reporterUserId, usersById),
  targets: (report.targetUserIds || []).map((userId) => toAdminIdentity(userId, usersById)),
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

const listSafetyReportsHandler = async (req, res) => {
  const status = req.query?.status ?? "open";
  if (typeof status !== "string" || !REPORT_STATUSES.has(status)) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "A valid report status is required" },
    });
  }
  const parsedLimit = Number.parseInt(req.query?.limit, 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(50, Math.max(1, parsedLimit)) : 50;

  try {
    const reports = await SafetyReport.find({ status }, ADMIN_REPORT_FIELDS)
      .sort({ createdAt: 1 })
      .limit(limit);
    const usersById = await loadAdminReportIdentities(reports);
    return res.json({ ok: true, data: reports.map((report) => toAdminReport(report, usersById)) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: { message: error.message } });
  }
};

const reviewSafetyReportHandler = async (req, res) => {
  const { reportId } = req.params;
  const body = req.body;
  const keys = body && !Array.isArray(body) && typeof body === "object"
    ? Object.keys(body)
    : [];
  const actionNote = typeof body?.actionNote === "string"
    ? body.actionNote.replace(/\s+/g, " ").trim()
    : body?.actionNote;

  if (
    !isMongoObjectIdString(reportId) ||
    !keys.includes("status") ||
    keys.some((key) => !["status", "actionNote"].includes(key)) ||
    !REPORT_STATUSES.has(body?.status) ||
    (body?.actionNote !== undefined && typeof body.actionNote !== "string") ||
    (typeof actionNote === "string" && actionNote.length > 500)
  ) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "A valid report review is required" },
    });
  }

  const reviewerId = getRequesterIdentity(req).userId;
  try {
    const report = await SafetyReport.findByIdAndUpdate(
      reportId,
      {
        $set: {
          status: body.status,
          ...(body.actionNote !== undefined ? { actionNote } : {}),
          reviewedBy: String(reviewerId),
          reviewedAt: new Date(),
        },
      },
      { new: true, select: ADMIN_REPORT_FIELDS, runValidators: true }
    );
    if (!report) {
      return res.status(404).json({
        ok: false,
        error: { code: "REPORT_NOT_FOUND", message: "Report not found" },
      });
    }
    const usersById = await loadAdminReportIdentities([report]);
    return res.json({ ok: true, data: toAdminReport(report, usersById) });
  } catch (error) {
    return res.status(500).json({ ok: false, error: { message: error.message } });
  }
};

module.exports = {
  requireAdmin,
  getPendingUsersHandler,
  approveUserHandler,
  listSafetyReportsHandler,
  reviewSafetyReportHandler,
  updateUserAccessHandler,
  normalizeAdminEmail,
};
