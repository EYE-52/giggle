const mongoose = require("mongoose");

const squadMemberSchema = new mongoose.Schema({
  memberId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  providerAccountId: { type: String, required: true },
  displayName: { type: String, trim: true, maxlength: 48 },
  alias: { type: String, trim: true, maxlength: 24 },
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
  managedGroup: {type:Boolean,default:false},
  description: {type:String,maxlength:160,default:""},
  publicTopic: {type:String,enum:["games","dating","relationships","banter","deep-talks"],default:"banter"},
  language: {type:String,enum:["any","en","hi","es","fr","de","pt"],default:"any"},
  groupInvite: {type:String},
  bannedMembers: [{memberId:String,userId:String,displayName:String,alias:String,bannedAt:Date}],
  identityMode: { type: String, enum: ["names", "aliases"], default: "names", immutable: true },
  communicationMode: { type: String, enum: ["chat", "voice", "video"], default: "video", immutable: true },
  // Set only by an accepted mutual request; invites and upgrades cannot add a third principal.
  authorizedPrincipalPair: { type: [String], default: undefined, immutable: true },
  visibility: { type: String, enum: ["private", "open"], default: "private" },
  joinPolicy: { type: String, enum: ["open", "request", "invite"], default: "open" },
  // Invite-only allow-list. When joinPolicy === "invite", only userIds present
  // here (or whoever holds a valid squadCode share link) may join.
  invitedUserIds: [{ type: String }],
  joinRequests: [
    {
      userId: { type: String, required: true },
      name: { type: String, trim: true, maxlength: 48 },
      alias: { type: String, trim: true, maxlength: 24 },
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
  lastEncounterId: { type: String, default: null },
  lastEncounterEndedAt: { type: Date, default: null },
  opponentSquadId: { type: String, default: null },
  matchedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  coverImage: { type: String, default: null },
});

// Indexes for hot lookups (squadId/squadCode already indexed via unique:true)
squadSchema.index({ "members.userId": 1 });
// findSquadsForIdentity $elemMatch/$or also matches on providerAccountId.
squadSchema.index({ "members.providerAccountId": 1 });
squadSchema.index({ status: 1 });
// Oldest waiting searches are retried in bounded batches by maintenance.
squadSchema.index({ status: 1, searchQueuedAt: 1, squadId: 1 });
// Public directory: equality filters followed by newest-first ordering.
squadSchema.index({ visibility: 1, status: 1, createdAt: -1 });

const Squad = mongoose.model("Squad", squadSchema);
const SquadMember = mongoose.model("SquadMember", squadMemberSchema);

module.exports = { Squad, SquadMember };
