const jwt = require("jsonwebtoken");

const isMongoObjectIdString = (value) =>
  typeof value === "string" && /^[a-f\d]{24}$/i.test(value);

const requireApiAuth = (req, res, next) => {
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

    next();
  } catch (err) {
    return res.status(401).json({
      ok: false,
      error: { code: "INVALID_TOKEN", message: "Invalid or expired token" },
    });
  }
};

module.exports = { requireApiAuth, isMongoObjectIdString };
