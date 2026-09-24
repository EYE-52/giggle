// Thin HTTP adapter for the avatar match service: the service already returns
// the full `{ httpStatus, body }` envelope, so handlers only relay it and keep
// a defensive catch that never leaks internals.
const avatarMatchService = require("../services/avatarMatchService");

const INTERNAL_ERROR_BODY = {
  ok: false,
  error: { code: "INTERNAL_ERROR", message: "Something broke" },
};
// The status endpoint is the client's feature probe: it answers, never throws.
const STATUS_OFFLINE_BODY = { ok: true, enabled: false, remainingToday: null, remainingMonth: null };

async function suggestAvatarHandler(req, res) {
  try {
    const userId = req.user?.userId || req.user?.sub;
    const result = await avatarMatchService.suggestAvatar({ userId, body: req.body });
    if (result && result.headers) {
      for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
    }
    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    // Never log the body (it carries the image) or error details.
    console.error("avatarMatch suggest error:", error?.name);
    return res.status(500).json(INTERNAL_ERROR_BODY);
  }
}

async function getSuggestStatusHandler(req, res) {
  try {
    const userId = req.user?.userId || req.user?.sub;
    const result = await avatarMatchService.getSuggestStatus({ userId });
    return res.status(result.httpStatus).json(result.body);
  } catch {
    return res.status(200).json(STATUS_OFFLINE_BODY);
  }
}

module.exports = { getSuggestStatusHandler, suggestAvatarHandler };
