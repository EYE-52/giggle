const crypto = require("node:crypto");
const User = require("../models/User");
const {
  buildAgeVerificationUrl,
  createAgeVerificationSession,
  getAgeVerificationResult,
} = require("../services/yotiAgeService");

const PENDING_REUSE_MS = 10 * 60 * 1000;

function sendProviderUnavailable(res) {
  return res.status(503).json({
    ok: false,
    error: {
      code: "AGE_VERIFICATION_UNAVAILABLE",
      message: "Age verification is temporarily unavailable",
    },
  });
}

function checkDeclaration(user, res) {
  if (user.ageConfirmed !== true) {
    res.status(403).json({
      ok: false,
      error: {
        code: "AGE_DECLARATION_REQUIRED",
        message: "Confirm your date of birth before verification",
      },
    });
    return false;
  }
  if (user.isAdult !== true) {
    res.status(403).json({
      ok: false,
      error: { code: "AGE_RESTRICTED", message: "Giggle is available only to adults 18+" },
    });
    return false;
  }
  return true;
}

async function startAgeVerification(req, res) {
  try {
    const userId = req.user?.userId || req.user?.sub;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        ok: false,
        error: { code: "NOT_FOUND", message: "User not found" },
      });
    }
    if (!checkDeclaration(user, res)) return res;
    if (user.ageVerified === true) {
      return res.json({ ok: true, data: { status: "verified", ageVerified: true } });
    }

    const verification = user.ageVerification;
    const requestedAt = new Date(verification?.requestedAt).getTime();
    const pendingAge = Date.now() - requestedAt;
    const canReuse =
      verification?.provider === "yoti" &&
      verification?.status === "pending" &&
      verification?.sessionId &&
      verification?.referenceId &&
      Number.isFinite(requestedAt) &&
      pendingAge >= 0 &&
      pendingAge < PENDING_REUSE_MS;

    if (canReuse) {
      return res.json({
        ok: true,
        data: {
          status: "pending",
          ageVerified: false,
          url: buildAgeVerificationUrl(verification.sessionId),
        },
      });
    }

    const referenceId = crypto.randomUUID();
    const session = await createAgeVerificationSession({ referenceId });
    user.ageVerified = false;
    user.ageVerification = {
      provider: session.provider,
      status: "pending",
      sessionId: session.sessionId,
      referenceId,
      requestedAt: new Date(),
    };
    await user.save();

    return res.json({
      ok: true,
      data: { status: "pending", ageVerified: false, url: session.url },
    });
  } catch (error) {
    if (error?.code === "AGE_VERIFICATION_UNAVAILABLE") {
      return sendProviderUnavailable(res);
    }
    console.error("startAgeVerification Error:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "SERVER_ERROR", message: "Internal server error" },
    });
  }
}

async function getAgeVerificationStatus(req, res) {
  try {
    const userId = req.user?.userId || req.user?.sub;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        ok: false,
        error: { code: "NOT_FOUND", message: "User not found" },
      });
    }
    if (!checkDeclaration(user, res)) return res;
    if (user.ageVerified === true) {
      return res.json({ ok: true, data: { status: "verified", ageVerified: true } });
    }

    const verification = user.ageVerification;
    if (!verification?.sessionId || !verification?.referenceId) {
      return res.json({ ok: true, data: { status: "not_started", ageVerified: false } });
    }
    if (verification.status !== "pending") {
      return res.json({
        ok: true,
        data: { status: verification.status || "not_started", ageVerified: false },
      });
    }

    const result = await getAgeVerificationResult({
      sessionId: verification.sessionId,
      referenceId: verification.referenceId,
    });
    if (result.status === "pending") {
      return res.json({ ok: true, data: { status: "pending", ageVerified: false } });
    }
    if (result.status === "rejected") {
      user.ageVerified = false;
      user.ageVerification.status = "rejected";
      await user.save();
      return res.json({
        ok: true,
        data: { status: "rejected", ageVerified: false, reason: result.reason },
      });
    }

    const storedVerification = verification.toObject?.() || verification;
    user.ageVerified = true;
    user.ageVerification = {
      ...storedVerification,
      ...result.receipt,
      status: "verified",
      verifiedAt: new Date(),
    };
    await user.save();
    return res.json({ ok: true, data: { status: "verified", ageVerified: true } });
  } catch (error) {
    if (error?.code === "AGE_VERIFICATION_UNAVAILABLE") {
      return sendProviderUnavailable(res);
    }
    console.error("getAgeVerificationStatus Error:", error);
    return res.status(500).json({
      ok: false,
      error: { code: "SERVER_ERROR", message: "Internal server error" },
    });
  }
}

module.exports = { getAgeVerificationStatus, startAgeVerification };
