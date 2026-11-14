const mongoose = require("mongoose");

const safetyReportSchema = new mongoose.Schema(
  {
    scope: {type:String,enum:["encounter","group"],default:"encounter"},
    scopeId: {type:String,maxlength:128},
    targetKey: {type:String,maxlength:128},
    reporterUserId: { type: String, required: true, maxlength: 128 },
    reporterSquadId: { type: String, required: true, maxlength: 96 },
    targetSquadId: { type: String, required: true, maxlength: 96 },
    targetUserIds: [{ type: String, required: true, maxlength: 128 }],
    encounterId: { type: String, required() { return this.scope !== "group"; }, maxlength: 96 },
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

// The old encounter triple index is retained in existing databases until the
// reviewed migration has backfilled and verified this replacement unique index.
safetyReportSchema.index(
  {scope:1,scopeId:1,reporterUserId:1,targetKey:1},
  {unique:true,name:"report_scope_target_v1",partialFilterExpression:{scope:{$exists:true},scopeId:{$exists:true},targetKey:{$exists:true}}}
);
safetyReportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("SafetyReport", safetyReportSchema);
