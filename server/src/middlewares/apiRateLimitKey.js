const { ipKeyGenerator } = require('express-rate-limit');
const { verifyIdentityToken } = require('./authMiddleware');

const apiRateLimitKey = (req) => {
  const token = typeof req.headers.authorization === 'string'
    ? req.headers.authorization.match(/^Bearer\s+(.+)$/i)?.[1] : null;
  if (token) {
    try {
      const identity = verifyIdentityToken(token);
      if (identity) return `user:${identity.userId}`;
    } catch { /* Missing/invalid/expired credentials retain the IP budget. */ }
  }
  return `ip:${ipKeyGenerator(req.ip)}`;
};

module.exports = { apiRateLimitKey };
