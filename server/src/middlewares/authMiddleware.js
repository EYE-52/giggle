const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { hasAdultAccess } = require("../services/ageAccessService");

const isMongoObjectIdString = (value) =>
  typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

const requireIdentityAuth = (req, res, next) => {
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1];

  if (!token) {
    return res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Missing bearer token" },
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded?.userId || decoded?.sub;

    if (!isMongoObjectIdString(userId)) {
      return res.status(401).json({
        ok: false,
        error: { code: "INVALID_TOKEN", message: "Token missing required user identity" },
      });
    }

    // Keep both keys during migration so old/new controllers keep working.
    req.user = decoded;
    req.giggleIdentity = decoded;

    return next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      error: { code: "INVALID_TOKEN", message: "Invalid or expired token" },
    });
  }
};

const requireApiAuth = (req, res, next) =>
  requireIdentityAuth(req, res, async () => {
    const userId = req.user.userId || req.user.sub;
    let user;

    try {
      user = await User.findById(userId).select(
        "ageConfirmed isAdult ageVerified isSuspended isShadowBanned deletionStatus"
      );
    } catch (error) {
      console.error("Adult authorization lookup failed:", error);
      return res.status(503).json({
        ok: false,
        error: {
          code: "AUTHORIZATION_UNAVAILABLE",
          message: "Unable to verify account access",
        },
      });
    }

    if (!user) {
      return res.status(401).json({
        ok: false,
        error: { code: "INVALID_TOKEN", message: "Token user no longer exists" },
      });
    }

    req.userRecord = user;
    if (!hasAdultAccess(user)) {
      const unavailable =
        user.isSuspended === true ||
        user.isShadowBanned === true ||
        user.deletionStatus === "pending";
      const restricted = user.ageConfirmed === true && user.isAdult === false;
      return res.status(403).json({
        ok: false,
        error: unavailable
          ? { code: "ACCOUNT_UNAVAILABLE", message: "This account is unavailable" }
          : restricted
          ? { code: "AGE_RESTRICTED", message: "Giggle is available only to adults 18+" }
          : {
              code: "AGE_VERIFICATION_REQUIRED",
              message: "Verified adult access is required",
            },
      });
    }

    return next();
  });

module.exports = { requireApiAuth, requireIdentityAuth, isMongoObjectIdString };
