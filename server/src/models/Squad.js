const mongoose = require("mongoose");

const squadMemberSchema = new mongoose.Schema({
  memberId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  providerAccountId: { type: String, required: true },
  displayName: { type: String, trim: true, maxlength: 48 },
  role: { type: String, enum: ["leader", "member"], default: "member" },
  ready: { type: Boolean, default: false },
  inLobbyVideo: { type: Boolean, default: false },
  inEncounterVideo: { type: Boolean, default: false },
  joinedAt: { type: Date, default: Date.now },
});

const squadSchema = new mongoose.Schema({
  squadId: { type: String, required: true, unique: true },
  squadCode: { type: String, required: true, unique: true },
  squadName: { type: String, trim: true, maxlength: 32, default: "Unnamed squad" },
  status: {
    type: String,
    enum: ["idle", "searching", "matched", "in_encounter"],
    default: "idle",
  },
  members: [squadMemberSchema],
  visibility: { type: String, enum: ["private", "open"], default: "private" },
  joinPolicy: { type: String, enum: ["open", "request", "invite"], default: "open" },
  // Invite-only allow-list. When joinPolicy === "invite", only userIds present
  // here (or whoever holds a valid squadCode share link) may join.
  invitedUserIds: [{ type: String }],
  joinRequests: [
    {
      userId: { type: String, required: true },
      name: { type: String, trim: true, maxlength: 48 },
      requestedAt: { type: Date, default: Date.now },
    },
  ],
  searchRegion: { type: String, default: "global" },
  tags: [{ type: String }],
  // Legacy compatibility only. Mature tags are rejected and this flag never
  // grants access; safe tag updates clear it.
  adult: { type: Boolean, default: false },
  reputationScore: { type: Number, default: 100 },
  isPremiumSquad: { type: Boolean, default: false },
  searchQueuedAt: { type: Date, default: null },
  currentEncounterId: { type: String, default: null },
  opponentSquadId: { type: String, default: null },
  matchedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  coverImage: { type: String, default: null },
});

// Indexes for hot lookups (squadId/squadCode already indexed via unique:true)
squadSchema.index({ "members.userId": 1 });
squadSchema.index({ status: 1 });

const Squad = mongoose.model("Squad", squadSchema);
const SquadMember = mongoose.model("SquadMember", squadMemberSchema);

module.exports = { Squad, SquadMember };
