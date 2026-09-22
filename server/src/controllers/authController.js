const { isAgeCheckSatisfied } = require("../services/ageAccessService");
const User = require("../models/User");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { normalizeDisplayName } = require("../utils/identityValidation");
const { isAvatarId, isSelectableAvatarId, publicAvatar } = require("../utils/avatars");

// Tokens granted to BOTH the inviter and the invitee when a referral converts.
const REFERRAL_REWARD = 100;

// Ambiguity-free alphabet (no 0/O/1/I) for human-shareable codes.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EXCHANGE_SECRET_HEADER = "x-giggle-auth-exchange-secret";

function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function isValidEmailIdentity(value) {
  if (typeof value !== "string" || value.length > 254) return false;
  const at = value.indexOf("@");
  const lastAt = value.lastIndexOf("@");
  if (at <= 0 || at !== lastAt || at === value.length - 1) return false;
  if (/\s/.test(value)) return false;

  const domain = value.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) return false;
  return domain.split(".").every(Boolean);
}

function normalizeProfileImage(value) {
  if (typeof value !== "string") return undefined;
  const image = value.trim();
  if (!image || image.length > 2048) return undefined;

  try {
    const url = new URL(image);
    if (url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function clientAccountStatus(user) {
  if (user?.deletionStatus === "pending") return "pending_deletion";
  if (user?.isSuspended === true || user?.isShadowBanned === true) return "unavailable";
  return "active";
}

// CSPRNG-backed code: referral codes are shareable credentials, so use
// crypto.randomBytes (not Math.random) to make enumeration infeasible.
function randomCode(len = 8) {
  const buf = crypto.randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return s;
}

/** Generate a referral code guaranteed unique in the DB. */
async function generateUniqueReferralCode() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode(8);
    const clash = await User.exists({ referralCode: code });
    if (!clash) return code;
  }
  // Extremely unlikely fallback: widen the space.
  return randomCode(8) + randomCode(2);
}

/**
 * Shared session minting: find-or-create a user by email, apply an inbound
 * referral code (crediting both sides once), backfill a referral code, and
 * sign a 7-day backend JWT. Reused by every auth provider (dev exchange,
 * Google, Apple, magic-link). Returns { token, user } in the SAME shape the
 * /api/auth/exchange response uses, so all providers behave identically.
 */
async function issueSessionForEmail({ email, name, image, ref, devFixture = false } = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmailIdentity(normalizedEmail)) {
    const err = new Error("Valid email is required");
    err.code = "INVALID_REQUEST";
    throw err;
  }
  email = normalizedEmail;
  name = normalizeDisplayName(name);
  image = normalizeProfileImage(image);
  // Normalize the referral code: trim, uppercase, ignore empties.
  const refRaw = (ref || "").toString().trim().toUpperCase();
  const refCode = refRaw || null;

  let user = await User.findOne({ email });
  let referralApplied = false;

  if (!user) {
    // ── New user: mint a referral code, then try to apply an inbound ref ──
    const referralCode = await generateUniqueReferralCode();
    user = await User.create({ email, name, image, referralCode });

    if (refCode && refCode !== referralCode) {
      const referrer = await User.findOne({ referralCode: refCode });
      // Guard: must exist and not be self (by id or email).
      if (referrer && referrer.email !== email) {
        // Credit BOTH sides. Use atomic $inc so concurrent referrals are safe.
        await User.updateOne(
          { _id: referrer._id },
          { $inc: { tokens: REFERRAL_REWARD, referralCount: 1 } }
        );
        user.tokens = (user.tokens || 0) + REFERRAL_REWARD;
        user.referredBy = referrer._id.toString();
        await user.save();
        referralApplied = true;
      }
    }
  } else {
    // ── Existing user: keep info fresh + backfill a code if missing ──
    user.name = name || user.name;
    user.image = image || user.image;
    if (!user.referralCode) {
      user.referralCode = await generateUniqueReferralCode();
    }
    await user.save();
  }

  // Explicit local test identities only. OAuth and ordinary accounts never
  // receive these fixture flags, even when the development option is enabled.
  if (devFixture && process.env.NODE_ENV === "development" &&
      process.env.DEV_AUTH_ENABLED === "true" && email.endsWith("@dev.giggle.local")) {
    user.birthDate = new Date("2000-01-01T00:00:00.000Z");
    user.isAdult = true;
    user.ageConfirmed = true;
    user.ageVerified = true;
    await user.save();
  }

  const userId = user._id.toString();
  const accountStatus = clientAccountStatus(user);
  const token = jwt.sign(
    {
      sub: userId,
      userId,
      email: user.email,
      name: user.name,
      image: user.image,
      isPremium: user.isPremium || false,
      isApproved: user.isApproved || false,
      // Age-gating flags must ride in the JWT: the OAuth flow only receives the
      // token (via URL hash) and decodes it client-side, so without these the
      // gate re-appears on every login even after the user confirmed their age.
      isAdult: user.isAdult || false,
      ageConfirmed: user.ageConfirmed || false,
      ageVerified: isAgeCheckSatisfied(user),
      accountStatus,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  return {
    token,
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      image: user.image,
      avatar: publicAvatar(user.avatar),
      isPremium: user.isPremium || false,
      isApproved: user.isApproved || false,
      referralCode: user.referralCode,
      referralCount: user.referralCount || 0,
      tokens: user.tokens || 0,
      // Age-gating flags (client-facing). birthDate (PII) is NEVER included.
      isAdult: user.isAdult || false,
      ageConfirmed: user.ageConfirmed || false,
      ageVerified: isAgeCheckSatisfied(user),
      accountStatus,
      referralApplied,
      referralReward: referralApplied ? REFERRAL_REWARD : 0,
    },
  };
}

const exchangeAuth = async (req, res) => {
  // In production this route is server-to-server only: giggle-web's NextAuth
  // callback sends a shared secret after Google has authenticated the user.
  // Local development keeps passwordless/dev sign-in available.
  if (process.env.NODE_ENV === "production") {
    const expected = process.env.AUTH_EXCHANGE_SECRET;
    const provided = req.get?.(EXCHANGE_SECRET_HEADER);

    if (!expected || provided !== expected) {
      return res.status(403).json({
        ok: false,
        error: {
          code: "AUTH_EXCHANGE_FORBIDDEN",
          message: "Auth exchange is only available to trusted server callers.",
        },
      });
    }
  }
  let { email, name, image } = req.body;
  email = normalizeEmail(email);
  // Normalize the referral code: trim, uppercase, ignore empties.
  const refRaw = (req.body.ref || "").toString().trim().toUpperCase();
  const ref = refRaw || null;

  if (!email) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Email is required" },
    });
  }

  try {
    const session = await issueSessionForEmail({ email, name, image, ref, devFixture: true });
    return res.json(session);
  } catch (error) {
    if (error.code === "INVALID_REQUEST") {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_REQUEST", message: error.message || "Invalid request" },
      });
    }
    console.error("Auth Exchange Error:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "SERVER_ERROR", message: "Internal server error" },
    });
  }
};

/** GET /api/auth/me/referral — the authed user's invite code + stats. */
const getMyReferral = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.sub;
    let user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "User not found" } });
    }
    // Backfill a code for legacy users who hit this before re-login.
    if (!user.referralCode) {
      user.referralCode = await generateUniqueReferralCode();
      await user.save();
    }
    return res.json({
      ok: true,
      data: {
        code: user.referralCode,
        referralCount: user.referralCount || 0,
        tokens: user.tokens || 0,
        rewardPerInvite: REFERRAL_REWARD,
      },
    });
  } catch (error) {
    console.error("getMyReferral Error:", error);
    return res.status(500).json({ ok: false, error: { code: "SERVER_ERROR", message: "Internal server error" } });
  }
};

/** GET /api/me/profile — the authed user's demographics + identity. */
const getMyProfile = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.sub;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "User not found" } });
    }
    return res.json({
      ok: true,
      data: {
        gender: user.gender,
        languages: user.languages || [],
        country: user.country,
        vibes: user.vibes || [],
        name: user.name,
        email: user.email,
        avatar: publicAvatar(user.avatar),
        // Age-gating flags (client-facing). birthDate (PII) is NEVER included.
        isAdult: user.isAdult || false,
        ageConfirmed: user.ageConfirmed || false,
        ageVerified: isAgeCheckSatisfied(user),
        accountStatus: clientAccountStatus(user),
      },
    });
  } catch (error) {
    console.error("getMyProfile Error:", error);
    return res.status(500).json({ ok: false, error: { code: "SERVER_ERROR", message: "Internal server error" } });
  }
};

const normalizeProfilePatch = (body = {}) => {
  const patch = {};
  const unset = [];
  const { gender, languages, country, vibes, avatar } = body;

  if (gender !== undefined) {
    const value = String(gender).trim();
    if (typeof gender !== "string" || value.length > 32) {
      return { error: "gender must be a short string" };
    }
    patch.gender = value;
  }

  if (languages !== undefined) {
    if (
      !Array.isArray(languages) ||
      languages.some((l) => typeof l !== "string" || l.trim().length > 32)
    ) {
      return { error: "languages must be an array of short strings" };
    }
    const seenLanguages = new Set();
    patch.languages = languages
      .map((l) => l.trim())
      .filter((l) => {
        if (!l) return false;
        const key = l.toLowerCase();
        if (seenLanguages.has(key)) return false;
        seenLanguages.add(key);
        return true;
      })
      .slice(0, 20);
  }

  if (country !== undefined) {
    const value = String(country).trim();
    if (typeof country !== "string" || value.length > 64) {
      return { error: "country must be a short string" };
    }
    patch.country = value;
  }

  if (vibes !== undefined) {
    if (
      !Array.isArray(vibes) ||
      vibes.some((vibe) => typeof vibe !== "string" || vibe.trim().length > 15)
    ) {
      return { error: "vibes must be an array of short strings" };
    }
    const seenVibes = new Set();
    patch.vibes = vibes
      .map((vibe) => vibe.trim())
      .filter((vibe) => {
        if (!vibe) return false;
        const key = vibe.toLowerCase();
        if (seenVibes.has(key)) return false;
        seenVibes.add(key);
        return true;
      })
      .slice(0, 5);
  }

  if (avatar !== undefined) {
    if (avatar === null || avatar === "") {
      unset.push("avatar");
    } else if (isSelectableAvatarId(avatar)) {
      patch.avatar = avatar;
    } else if (isAvatarId(avatar)) {
      return { error: "That avatar is part of the Vibe Pack, which isn't available yet" };
    } else {
      return { error: "avatar must be one of the available avatar ids" };
    }
  }

  return { patch, unset };
};

/** PATCH /api/me/profile — update the authed user's demographics. */
const updateMyProfile = async (req, res) => {
  try {
    const normalized = normalizeProfilePatch(req.body || {});
    if (normalized.error) {
      return res.status(400).json({ ok: false, error: { code: "INVALID_REQUEST", message: normalized.error } });
    }

    const userId = req.user?.userId || req.user?.sub;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "User not found" } });
    }

    for (const [key, value] of Object.entries(normalized.patch)) {
      user[key] = value;
    }
    for (const key of normalized.unset || []) {
      user[key] = undefined;
    }

    await user.save();

    return res.json({
      ok: true,
      data: {
        gender: user.gender,
        languages: user.languages || [],
        country: user.country,
        vibes: user.vibes || [],
        name: user.name,
        email: user.email,
        avatar: publicAvatar(user.avatar),
        // Age-gating flags (client-facing). birthDate (PII) is NEVER included.
        isAdult: user.isAdult || false,
        ageConfirmed: user.ageConfirmed || false,
        ageVerified: isAgeCheckSatisfied(user),
      },
    });
  } catch (error) {
    console.error("updateMyProfile Error:", error);
    return res.status(500).json({ ok: false, error: { code: "SERVER_ERROR", message: "Internal server error" } });
  }
};

// Parse a strict "YYYY-MM-DD" string into a real UTC calendar date. Returns a
// Date (at UTC midnight) or null if malformed / not a real calendar date
// (rejects "2001-02-30", "2001-13-01", etc. via round-trip verification).
const parseBirthDate = (value) => {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

// Full years elapsed since birthDate, relative to `now` (UTC). Never negative-safe:
// a future birthDate yields a negative age (caller's range check rejects it).
const computeAge = (birthDate, now = new Date()) => {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
};

/**
 * POST /api/me/age — self-attested date of birth.
 * Body: { birthDate: "YYYY-MM-DD" }. SET-ONCE: once ageConfirmed is true it
 * cannot be changed; retries return the persisted flags. Sets birthDate, ageConfirmed=true, and
 * isAdult=(age>=18). The client ageVerified flag reflects the current access policy;
 * persisted ageVerified remains reserved for provider verification.
 */
const setMyAge = async (req, res) => {
  try {
    const date = parseBirthDate(req.body?.birthDate);
    if (!date) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_REQUEST", message: "birthDate must be a valid YYYY-MM-DD date" },
      });
    }

    const age = computeAge(date);
    if (!Number.isFinite(age) || age < 13 || age > 120) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_AGE", message: "Age must be between 13 and 120" },
      });
    }

    const userId = req.user?.userId || req.user?.sub;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "User not found" } });
    }

    // SET-ONCE: prevent re-attesting a different DOB to bypass age gating.
    if (user.ageConfirmed) {
      if (user.isAdult !== true) {
        return res.status(403).json({
          ok: false,
          error: { code: "AGE_RESTRICTED", message: "Giggle is available only to adults 18+" },
        });
      }
      return res.status(200).json({
        ok: true,
        data: {
          isAdult: true,
          ageConfirmed: true,
          ageVerified: isAgeCheckSatisfied(user),
        },
      });
    }

    user.birthDate = date;
    user.ageConfirmed = true;
    user.isAdult = age >= 18;
    user.ageVerified = false;
    await user.save();

    if (!user.isAdult) {
      return res.status(403).json({
        ok: false,
        error: { code: "AGE_RESTRICTED", message: "Giggle is available only to adults 18+" },
      });
    }

    return res.status(200).json({
      ok: true,
      data: { isAdult: true, ageConfirmed: true, ageVerified: isAgeCheckSatisfied(user) },
    });
  } catch (error) {
    console.error("setMyAge Error:", error);
    return res.status(500).json({ ok: false, error: { code: "SERVER_ERROR", message: "Internal server error" } });
  }
};

module.exports = { exchangeAuth, getMyReferral, getMyProfile, updateMyProfile, setMyAge, parseBirthDate, computeAge, normalizeProfilePatch, normalizeProfileImage, normalizeEmail, isValidEmailIdentity, REFERRAL_REWARD, issueSessionForEmail, EXCHANGE_SECRET_HEADER };
