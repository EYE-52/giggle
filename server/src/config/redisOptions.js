const getRedisOptions = () => {
  const redisUrl = process.env.REDIS_URL;
  const isTls = redisUrl?.startsWith("rediss://");

  const baseOptions = {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    // Railway private network (*.railway.internal) is IPv6-only; family:0 lets
    // ioredis resolve both stacks (works for local IPv4 + managed/cloud too).
    family: 0,
    // Add reconnect strategy with backoff to prevent spamming.
    retryStrategy(times) {
      return Math.min(times * 200, 5000);
    },
    reconnectOnError(err) {
      return err.message.includes("READONLY");
    },
  };

  if (isTls) {
    baseOptions.tls = {
      // Secure by default: verify Redis TLS certificates unless an operator has
      // explicitly opted out for a private/self-signed environment.
      rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED === "false" ? false : true,
    };
  }

  if (redisUrl) {
    return [redisUrl, baseOptions];
  }

  return [{
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    ...baseOptions,
  }];
};

module.exports = { getRedisOptions };
