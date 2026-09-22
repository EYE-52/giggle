const Redis = require('ioredis');
const { default: Redlock } = require('redlock');
const { getRedisOptions } = require('./redisOptions');

/**
 * Production-Grade Redis Configuration
 * Optimized for Render + Upstash / Managed Redis
 */
// 1. Primary command client. Bounded retries so API requests fail fast
//    (instead of hanging forever) while Redis is unavailable.
const redis = new Redis(...getRedisOptions());

// 2. Socket.io adapter pub/sub clients keep unlimited per-request retries so
//    cross-replica broadcasts queue through a Redis blip. Pub is lazy: it only
//    connects once the adapter publishes (i.e. when sockets are initialised).
const subClient = new Redis(...getRedisOptions({ maxRetriesPerRequest: null }));
const pubClient = new Redis(...getRedisOptions({ maxRetriesPerRequest: null, lazyConnect: true }));

const clients = [
  { name: 'Primary', client: redis },
  { name: 'Pub', client: pubClient },
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

// Multi-replica guard for periodic background jobs: each tick, only the replica
// that wins a short SET NX PX lease runs the routine. The lease is not released
// early, so replicas whose timers fire a little later in the same tick skip it.
// Returns undefined (without running) when another replica holds the lease.
const runAsSingleReplica = async (jobName, leaseMs, routine) => {
  const acquired = await redis.set(
    `lock:job:${jobName}`,
    `${process.pid}:${Date.now()}`,
    'PX',
    leaseMs,
    'NX'
  );
  if (acquired !== 'OK') return undefined;
  return routine();
};

module.exports = {
  redis,
  pubClient,
  subClient,
  redlock,
  withMatchmakingLock,
  runAsSingleReplica,
};
