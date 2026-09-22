const { isAgeCheckSatisfied } = require("../services/ageAccessService");
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

function normalizedState(user) {
  if (isAgeCheckSatisfied(user)) {
    return { status: "verified", ageVerified: true };
  }
  if (user?.ageConfirmed === true && user?.isAdult === false) {
    return { status: "restricted", ageVerified: false };
  }
  const status = ["pending", "rejected"].includes(user?.ageVerification?.status)
    ? user.ageVerification.status
    : "not_started";
  return { status, ageVerified: false };
}

async function sendCurrentState(userId, res, includePendingUrl = false) {
  const currentUser = await User.findById(userId);
  if (!currentUser) {
    return res.status(404).json({
      ok: false,
      error: { code: "NOT_FOUND", message: "User not found" },
    });
  }
  const data = normalizedState(currentUser);
  if (
    includePendingUrl &&
    data.status === "pending" &&
    currentUser.ageVerification?.provider === "yoti" &&
    currentUser.ageVerification?.sessionId &&
    currentUser.ageVerification?.referenceId
  ) {
    data.url = buildAgeVerificationUrl(currentUser.ageVerification.sessionId);
  }
  return res.json({ ok: true, data });
}

function bindingFilter(userId, verification) {
  const expected = (value) => value ?? { $exists: false };
  return {
    _id: userId,
    ageConfirmed: true,
    isAdult: true,
    ageVerified: { $ne: true },
    "ageVerification.status": expected(verification?.status),
    "ageVerification.sessionId": expected(verification?.sessionId),
    "ageVerification.referenceId": expected(verification?.referenceId),
  };
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
    if (isAgeCheckSatisfied(user)) {
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
    const nextVerification = {
      provider: session.provider,
      status: "pending",
      sessionId: session.sessionId,
      referenceId,
      requestedAt: new Date(),
    };
    // ponytail: simultaneous starts can orphan one short-lived Yoti session;
    // this compare-and-set keeps only the stored binding authoritative.
    const boundUser = await User.findOneAndUpdate(
      bindingFilter(userId, verification),
      { $set: { ageVerified: false, ageVerification: nextVerification } },
      { new: true, runValidators: true }
    );
    if (!boundUser) return sendCurrentState(userId, res, true);

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
    if (isAgeCheckSatisfied(user)) {
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
      return sendCurrentState(userId, res);
    }
    const filter = bindingFilter(userId, verification);
    if (result.status === "rejected") {
      const rejectedUser = await User.findOneAndUpdate(
        filter,
        { $set: { ageVerified: false, "ageVerification.status": "rejected" } },
        { new: true, runValidators: true }
      );
      if (!rejectedUser) return sendCurrentState(userId, res);
      return res.json({
        ok: true,
        data: { status: "rejected", ageVerified: false, reason: result.reason },
      });
    }

    const verifiedUser = await User.findOneAndUpdate(
      filter,
      {
        $set: {
          ageVerified: true,
          "ageVerification.provider": result.receipt.provider,
          "ageVerification.status": "verified",
          "ageVerification.evidenceId": result.receipt.evidenceId,
          "ageVerification.method": result.receipt.method,
          "ageVerification.threshold": result.receipt.threshold,
          "ageVerification.policyVersion": result.receipt.policyVersion,
          "ageVerification.verifiedAt": new Date(),
        },
      },
      { new: true, runValidators: true }
    );
    if (!verifiedUser) return sendCurrentState(userId, res);
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
