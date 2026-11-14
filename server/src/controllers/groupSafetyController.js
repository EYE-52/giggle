const SafetyReport = require("../models/SafetyReport");
const { resolveGroupMember } = require("../services/groupIdentityService");
const { getRequesterIdentity } = require("../app/squadAccess");
const categories = new Set([
  "harassment",
  "hate",
  "sexual",
  "minor_safety",
  "spam",
  "other",
]);
async function reportGroupMember(req, res) {
  const category = req.body?.category,
    details =
      typeof req.body?.details === "string" ? req.body.details.trim() : "";
  if (!categories.has(category) || details.length > 500) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "INVALID_REPORT",
        message:
          "Choose a report reason and keep details under 500 characters.",
      },
    });
  }
  const { squad } = req.squadAccess,
    reporter = getRequesterIdentity(req).userId,
    target = resolveGroupMember(squad, req.params.memberId);
  if (!target || String(target.userId) === reporter) {
    return res.status(404).json({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "That person is not in this group.",
      },
    });
  }
  const filter = {
    scope: "group",
    scopeId: squad.squadId,
    reporterUserId: reporter,
    targetKey: String(target.userId),
  };
  try {
    const report = await SafetyReport.findOneAndUpdate(
      filter,
      {
        $setOnInsert: {
          ...filter,
          reporterSquadId: squad.squadId,
          targetSquadId: squad.squadId,
          targetUserIds: [String(target.userId)],
          category,
          details,
          status: "open",
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );
    return res.json({
      ok: true,
      data: { reportId: String(report._id), status: report.status },
    });
  } catch (error) {
    if (error.code === 11000) {
      try {
        const existing = await SafetyReport.findOne(filter);
        if (existing) {
          return res.json({
            ok: true,
            data: { reportId: String(existing._id), status: existing.status },
          });
        }
      } catch {
        /* A failed duplicate lookup must still return an error. */
      }
    }
    // A second target must not be reported as saved if the legacy unique index
    // is still installed. The release migration is explicit and never runs here.
    return res.status(503).json({
      ok: false,
      error: {
        code: "REPORT_UNAVAILABLE",
        message: "Report could not be saved. Try again.",
      },
    });
  }
}
module.exports = { reportGroupMember };
