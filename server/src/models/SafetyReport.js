const mongoose = require("mongoose");

const safetyReportSchema = new mongoose.Schema(
  {
    reporterUserId: { type: String, required: true, maxlength: 128 },
    reporterSquadId: { type: String, required: true, maxlength: 96 },
    targetSquadId: { type: String, required: true, maxlength: 96 },
    targetUserIds: [{ type: String, required: true, maxlength: 128 }],
    encounterId: { type: String, required: true, maxlength: 96 },
    category: {
      type: String,
      required: true,
      enum: ["harassment", "hate", "sexual", "minor_safety", "spam", "other"],
    },
    details: { type: String, default: "", maxlength: 500 },
    status: {
      type: String,
      required: true,
      enum: ["open", "reviewing", "actioned", "dismissed"],
      default: "open",
    },
    reviewedBy: { type: String, default: null, maxlength: 128 },
    reviewedAt: { type: Date, default: null },
    actionNote: { type: String, default: "", maxlength: 500 },
  },
  { timestamps: true }
);

safetyReportSchema.index(
  { reporterUserId: 1, encounterId: 1, targetSquadId: 1 },
  { unique: true }
);
safetyReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("SafetyReport", safetyReportSchema);
