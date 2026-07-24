// src/models/User.js

const mongoose = require("mongoose");

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
    image: {
      type: String,
    },
    reputationScore: { type: Number, default: 100 },
    reportCount: { type: Number, default: 0 },
    isShadowBanned: { type: Boolean, default: false },
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
    age: { type: Number },

    // ── Age verification / adult-content gating ───────────────────────────
    // Self-attested date of birth (PII — NEVER serialized back to the client).
    // `isAdult`/`ageConfirmed` are the client-facing flags. `ageVerified` is
    // RESERVED for a future real-ID vendor and must stay false until then.
    birthDate: { type: Date, default: null },
    isAdult: { type: Boolean, default: false },
    ageConfirmed: { type: Boolean, default: false },
    ageVerified: { type: Boolean, default: false },
    languages: [{ type: String }],
    country: { type: String }, // ISO-ish or free text, e.g. "IN", "US"
    vibes: [{ type: String, trim: true, maxlength: 15 }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
