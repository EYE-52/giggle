const formatDurationMs = (startNs) => {
  const durationNs = process.hrtime.bigint() - startNs;
  return Number(durationNs / 1000000n);
};

const SECRET_KEYS = new Set([
  "password",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "idtoken",
  "id_token",
  "authorization",
  "code",
]);

const sanitizePath = (originalUrl = "") => {
  if (typeof originalUrl !== "string") return "";
  try {
    return new URL(originalUrl, "http://local").pathname;
  } catch {
    return originalUrl.split("?")[0];
  }
};

const sanitizeValue = (value) => {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);

  const redacted = {};
  for (const [key, nested] of Object.entries(value)) {
    redacted[key] = SECRET_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : sanitizeValue(nested);
  }
  return redacted;
};

const requestLogger = ({ logRequestBody = false } = {}) => {
  return (req, res, next) => {
    const startNs = process.hrtime.bigint();
    const startedAt = new Date().toISOString();

    res.on("finish", () => {
      const durationMs = formatDurationMs(startNs);
      const hasAuthHeader = Boolean(req.headers.authorization);

      const summary = {
        time: startedAt,
        method: req.method,
        path: sanitizePath(req.originalUrl),
        status: res.statusCode,
        durationMs,
      };

      const details = {
        ip: req.ip,
        userAgent: req.get("user-agent"),
        hasAuthHeader,
        query: sanitizeValue(req.query),
      };

      if (logRequestBody && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
        details.body = sanitizeValue(req.body);
      }

      console.log("[API]", summary, details);
    });

    next();
  };
};

module.exports = { requestLogger, sanitizePath, sanitizeValue };
