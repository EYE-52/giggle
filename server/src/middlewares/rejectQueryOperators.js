// Rejects request bodies and query strings that carry MongoDB operator keys
// (`$ne`, `$gt`, `$where`, …) at any depth. Controllers pass ids such as
// `squadId` straight into Mongoose filters, so `{"squadId":{"$ne":null}}`
// would otherwise turn an equality lookup into "match any squad". No Giggle
// client sends `$` keys, so these requests are refused outright.

const MAX_DEPTH = 20;

const hasOperatorKey = (value, depth = 0) => {
  if (!value || typeof value !== "object") return false;
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(value)) return value.some((item) => hasOperatorKey(item, depth + 1));
  return Object.keys(value).some(
    (key) => key.startsWith("$") || hasOperatorKey(value[key], depth + 1)
  );
};

const rejectQueryOperators = (req, res, next) => {
  if (hasOperatorKey(req.body) || hasOperatorKey(req.query)) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_REQUEST", message: "Request contains unsupported fields." },
    });
  }
  return next();
};

module.exports = { rejectQueryOperators, hasOperatorKey };
