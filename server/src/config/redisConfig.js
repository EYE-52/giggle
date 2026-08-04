const Redis = require('ioredis');
const { default: Redlock } = require('redlock');
const { getRedisOptions } = require('./redisOptions');

/**
 * Production-Grade Redis Configuration
 * Optimized for Render + Upstash / Managed Redis
 */
// 1. Primary Client (Also used for Pub)
const redis = new Redis(...getRedisOptions());

// 2. Dedicated Sub Client (Sub must be separate)
const subClient = new Redis(...getRedisOptions());

// Re-use primary for Pub as allowed by Socket.io adapter
const pubClient = redis; 

const clients = [
  { name: 'Primary/Pub', client: redis },
  { name: 'Sub', client: subClient }
];

clients.forEach(({ name, client }) => {
  client.on('connect', () => {
    console.log(`Redis ${name} TCP connection established...`);
  });

  client.on('ready', () => {
    console.log(`Redis ${name} ready and authenticated ✅`);
  });

  client.on('error', (err) => {
    console.error(`Redis ${name} error: ${err.message}`);
    if (err.message.includes('WRONGPASS')) {
      console.error('CRITICAL: Redis password incorrect. Please check your REDIS_URL.');
    }
  });

  client.on('reconnecting', (ms) => {
    console.log(`Redis ${name} reconnecting in ${ms}ms...`);
  });
});

const redlock = new Redlock(
  [redis],
  {
    driftFactor: 0.01,
    retryCount: 10,
    retryDelay: 200,
    retryJitter: 200,
    automaticExtensionThreshold: 500,
  }
);

const MATCHMAKING_LOCK_RESOURCE = "lock:matchmaking";
const MATCHMAKING_LOCK_DURATION_MS = 5000;

const withMatchmakingLock = (routine) =>
  redlock.using(
    [MATCHMAKING_LOCK_RESOURCE],
    MATCHMAKING_LOCK_DURATION_MS,
    async (signal) => {
      const result = await routine(signal);
      if (signal.aborted) {
        throw signal.error || new Error("Matchmaking lock was lost");
      }
      return result;
    }
  );

module.exports = {
  redis,
  pubClient,
  subClient,
  redlock,
  withMatchmakingLock,
};
