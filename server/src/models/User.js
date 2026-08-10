// src/models/User.js

const mongoose = require("mongoose");

const ageVerificationSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["yoti"] },
    status: { type: String, enum: ["pending", "rejected", "verified"] },
    sessionId: { type: String, maxlength: 128 },
    referenceId: { type: String, maxlength: 100 },
    evidenceId: { type: String, maxlength: 128 },
    method: { type: String, enum: ["AGE_ESTIMATION", "DIGITAL_ID", "DOC_SCAN"] },
    threshold: { type: Number },
    policyVersion: { type: String, maxlength: 48 },
    requestedAt: { type: Date },
    verifiedAt: { type: Date },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true, 
      index: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      trim: true,
      maxlength: 48,
      index: true, // supports user search by name
    },

    // ── Friends graph ─────────────────────────────────────────────────────
    // Stored as arrays of userId strings (the other user's _id.toString()).
    friends: [{ type: String }], // accepted, mutual friends
    friendRequestsIncoming: [{ type: String }], // userIds who requested me
    friendRequestsOutgoing: [{ type: String }], // userIds I requested
    blockedUserIds: [{ type: String }],
    image: {
      type: String,
    },
    reputationScore: { type: Number, default: 100 },
    reportCount: { type: Number, default: 0 },
    isShadowBanned: { type: Boolean, default: false },
    isSuspended: { type: Boolean, default: false },
    suspendedAt: { type: Date, default: null },
    deletionStatus: { type: String, enum: ["active", "pending"], default: "active" },
    deletionRequestedAt: { type: Date, default: null },
    lastReportedAt: { type: Date },
    isPremium: { type: Boolean, default: false },
    premiumExpiresAt: { type: Date },
    isApproved: { type: Boolean, default: false },

    // ── Referrals & token wallet ──────────────────────────────────────────
    // Each user gets a unique, shareable referral code. When a new user signs
    // up via someone's code, BOTH the inviter and the invitee are credited
    // tokens (see authController). `tokens` is the server-authoritative wallet
    // balance the client syncs into its local wallet on login.
    referralCode: { type: String, unique: true, sparse: true, index: true },
    referredBy: { type: String, default: null }, // referrer's userId
    referralCount: { type: Number, default: 0 }, // how many people this user invited
    tokens: { type: Number, default: 0 },

    // ── Member demographics ───────────────────────────────────────────────
    gender: { type: String }, // "male"|"female"|"nonbinary"|"other"|"prefer_not"

    // ── Age verification / adult access ───────────────────────────────────
    // Self-attested date of birth (PII — returned only in the user's explicit data export).
    // Provider payloads, documents, biometrics, selfies and actual age are never stored.
    birthDate: { type: Date, default: null },
    isAdult: { type: Boolean, default: false },
    ageConfirmed: { type: Boolean, default: false },
    ageVerified: { type: Boolean, default: false },
    ageVerification: { type: ageVerificationSchema, default: undefined },
    languages: [{ type: String }],
    country: { type: String }, // ISO-ish or free text, e.g. "IN", "US"
    vibes: [{ type: String, trim: true, maxlength: 15 }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
