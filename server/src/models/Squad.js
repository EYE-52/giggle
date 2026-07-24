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
  // True when any of the squad's tags is a "mature" (18+) vibe. Gates the squad
  // as an adult room: only 18+ users may create/join, and it matches only with
  // other adult squads. Server-computed from tags — never trusted from client.
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
